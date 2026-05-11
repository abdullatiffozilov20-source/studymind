// ============================================================
//  🧠 StudyMind AI — Telegram Bot + Web Mini App
//  GitHub → Render deploy uchun tayyor
// ============================================================

import TelegramBot from 'node-telegram-bot-api'
import Anthropic from '@anthropic-ai/sdk'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── CONFIG ────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const PORT = process.env.PORT || 3000
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`
const DB_FILE = './data.json'

if (!TOKEN || !ANTHROPIC_KEY) {
  console.error('❌ TELEGRAM_BOT_TOKEN va ANTHROPIC_API_KEY kerak!')
  process.exit(1)
}

const bot = new TelegramBot(TOKEN, { polling: true })
const ai = new Anthropic({ apiKey: ANTHROPIC_KEY })
const app = express()
app.use(express.json())
app.use(express.static(__dirname))

// ── DATABASE ──────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }))
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }
  catch { return { users: {} } }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

function getUser(id) {
  return loadDB().users[String(id)] || null
}

function saveUser(id, user) {
  const db = loadDB()
  db.users[String(id)] = user
  saveDB(db)
}

function createUser(id, name) {
  const user = {
    id: String(id), name, lang: 'uz',
    subjects: [], xp: 0, level: 1,
    streak: { current: 0, longest: 0, lastDate: null },
    sessions: [],
    behavior: { totalMin: 0, count: 0, avoided: [], bestHour: null, mostStudied: null }
  }
  saveUser(id, user)
  return user
}

// ── HELPERS ───────────────────────────────────────────────────
function updateStreak(user) {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (user.streak.lastDate === today) return
  user.streak.current = user.streak.lastDate === yesterday ? user.streak.current + 1 : 1
  user.streak.longest = Math.max(user.streak.longest, user.streak.current)
  user.streak.lastDate = today
}

function analyzeBehavior(user) {
  const sessions = user.sessions
  if (!sessions.length) return
  user.behavior.totalMin = sessions.reduce((s, x) => s + x.minutes, 0)
  user.behavior.count = sessions.length
  const counts = {}
  sessions.forEach(s => counts[s.subject] = (counts[s.subject] || 0) + s.minutes)
  user.behavior.mostStudied = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
  const hours = {}
  sessions.forEach(s => {
    if (!hours[s.hour]) hours[s.hour] = { total: 0, n: 0 }
    hours[s.hour].total += s.minutes; hours[s.hour].n++
  })
  const best = Object.entries(hours).sort((a, b) => (b[1].total / b[1].n) - (a[1].total / a[1].n))[0]
  user.behavior.bestHour = best ? Number(best[0]) : null
  const fiveDaysAgo = Date.now() - 5 * 86400000
  const recent = new Set(sessions.filter(s => new Date(s.date).getTime() > fiveDaysAgo).map(s => s.subject))
  user.behavior.avoided = user.subjects.filter(s => !recent.has(s))
}

function getLevel(xp) {
  if (xp < 100) return 1; if (xp < 300) return 2; if (xp < 600) return 3
  if (xp < 1000) return 4; if (xp < 1500) return 5; if (xp < 2200) return 6
  return Math.floor(7 + (xp - 2200) / 500)
}

const levelNames = ['', 'Beginner', 'Student', 'Learner', 'Focused', 'Scholar', 'Expert', 'Master']
function getLevelName(l) { return levelNames[l] || 'Legend' }

// ── IN-MEMORY STATE ───────────────────────────────────────────
const state = {}
const getState = id => state[id] || null
const setState = (id, s) => { state[id] = s }
const clearState = id => { delete state[id] }

// ── AI ────────────────────────────────────────────────────────
async function askClaude(message, user, mode = 'tutor') {
  const lang = user?.lang || 'uz'
  const langNote = lang === 'uz' ? 'Respond in Uzbek.' : lang === 'ru' ? 'Respond in Russian.' : 'Respond in English.'

  let system = `You are StudyMind AI, a personal study behavioral coach. ${langNote}
Student: ${user?.name}, Subjects: ${user?.subjects?.join(', ')}, Streak: ${user?.streak?.current} days, Level: ${user?.level}.
Keep responses SHORT (max 3 paragraphs). Use simple emojis. Be direct and honest.`

  if (mode === 'behavior') {
    const recent = user.sessions.slice(-15).map(s => `${s.date} ${s.hour}:00 ${s.subject} ${s.minutes}min mood:${s.mood}`).join('\n')
    system += `\nMode: Behavioral analysis. Recent sessions:\n${recent}\nAvoided subjects: ${user.behavior.avoided?.join(', ') || 'none'}\nBest hour: ${user.behavior.bestHour}:00\nGive: 1 specific pattern you see, 1 honest problem, 1 concrete action for tomorrow.`
  } else if (mode === 'plan') {
    system += `\nMode: Daily plan. Subjects: ${user.subjects.join(', ')}. Avoided: ${user.behavior.avoided?.join(', ') || 'none'}. Best hour: ${user.behavior.bestHour ?? 'flexible'}:00. Make 3 study blocks, start with weakest subject. Short numbered list. Add 1 motivating sentence.`
  }

  try {
    const res = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: message }]
    })
    return res.content[0]?.text || 'Xatolik yuz berdi.'
  } catch (e) {
    if (e.status === 429) return '⏳ AI band. 30 soniyadan keyin qayta urinib koʻring.'
    return '❌ AI xatolik: ' + e.message
  }
}

// ── KEYBOARDS ─────────────────────────────────────────────────
const mainMenu = () => ({
  reply_markup: {
    keyboard: [
      [{ text: '📚 Oʻqish' }, { text: '📅 Reja' }],
      [{ text: '📊 Statistika' }, { text: '🧬 Tahlil' }],
      [{ text: '🧠 AI Tutor' }, { text: '🌐 Dashboard' }]
    ],
    resize_keyboard: true, persistent: true
  }
})

const subjectKb = subjects => ({
  reply_markup: {
    inline_keyboard: [
      ...subjects.map(s => [{ text: `📚 ${s}`, callback_data: `subj_${s}` }]),
      [{ text: '➕ Yangi fan', callback_data: 'subj_add' }]
    ]
  }
})

const minutesKb = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: '15 min', callback_data: 'min_15' }, { text: '25 min', callback_data: 'min_25' }, { text: '45 min', callback_data: 'min_45' }],
      [{ text: '60 min', callback_data: 'min_60' }, { text: '90 min', callback_data: 'min_90' }, { text: '✍️ Oʻzim', callback_data: 'min_custom' }]
    ]
  }
})

const moodKb = () => ({
  reply_markup: {
    inline_keyboard: [[
      { text: '😔 Qiyin', callback_data: 'mood_hard' },
      { text: '😐 Normal', callback_data: 'mood_ok' },
      { text: '😊 Yaxshi', callback_data: 'mood_good' },
      { text: '🔥 Aʼlo', callback_data: 'mood_great' }
    ]]
  }
})

const langKb = () => ({
  reply_markup: {
    inline_keyboard: [[
      { text: '🇺🇿 Oʻzbek', callback_data: 'lang_uz' },
      { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
      { text: '🇬🇧 English', callback_data: 'lang_en' }
    ]]
  }
})

const cancelKb = () => ({
  reply_markup: { inline_keyboard: [[{ text: '❌ Bekor', callback_data: 'cancel' }]] }
})

const md = (id, text, extra = {}) =>
  bot.sendMessage(id, text, { parse_mode: 'Markdown', ...extra })

// ── /start ────────────────────────────────────────────────────
bot.onText(/\/start/, async msg => {
  const id = msg.from.id
  const name = msg.from.first_name || 'Student'
  let user = getUser(id)
  if (!user) {
    createUser(id, name)
    setState(id, 'onboarding_lang')
    await md(id,
      `👋 Salom *${name}*\\!\n\n🧠 *StudyMind AI* — shaxsiy oʻquv assistentingiz\\.\n\nXulq\\-atvoringizni tahlil qiladi va nima uchun qiynalayotganingizni rostini aytadi\\.\n\n🌐 Tilni tanlang:`,
      { parse_mode: 'MarkdownV2', ...langKb() }
    )
  } else {
    clearState(id)
    await md(id,
      `👋 Qaytib keldingiz, *${user.name}*\\!\n🔥 Streak: *${user.streak.current}* kun \\| ⭐ *${user.xp}* XP`,
      { parse_mode: 'MarkdownV2', ...mainMenu() }
    )
  }
})

// ── CALLBACKS ─────────────────────────────────────────────────
bot.on('callback_query', async q => {
  const id = q.from.id
  const data = q.data
  const s = getState(id)
  let user = getUser(id)
  await bot.answerCallbackQuery(q.id)

  if (data.startsWith('lang_')) {
    const lang = data.replace('lang_', '')
    user.lang = lang; saveUser(id, user)
    setState(id, 'onboarding_subjects')
    const msgs = {
      uz: '✅ Til saqlandi\\!\n\n📚 Qaysi fanlarni oʻqiysiz\\?\n*Vergul* bilan yozing:\n\nMasalan: *Matematika, Fizika, Ingliz tili*',
      ru: '✅ Язык сохранён\\!\n\n📚 Какие предметы изучаете\\?\nЧерез *запятую*:\n\nНапример: *Математика, Физика*',
      en: '✅ Language saved\\!\n\n📚 Which subjects do you study\\?\nSeparate with *commas*:\n\nExample: *Math, Physics, English*'
    }
    return bot.sendMessage(id, msgs[lang], { parse_mode: 'MarkdownV2' })
  }

  if (data === 'cancel') { clearState(id); return md(id, '✅ Bekor qilindi.', mainMenu()) }

  if (data.startsWith('subj_')) {
    if (data === 'subj_add') { setState(id, 'add_subject'); return md(id, '📚 Yangi fan nomini yozing:', cancelKb()) }
    const subject = data.replace('subj_', '')
    setState(id, { step: 'minutes', subject })
    return md(id, '⏱ Qancha vaqt oʻqidingiz?', minutesKb())
  }

  if (data.startsWith('min_')) {
    if (data === 'min_custom') {
      setState(id, { ...s, step: 'minutes_custom' })
      return md(id, '✍️ Daqiqalar sonini yozing (1–600):', cancelKb())
    }
    const minutes = parseInt(data.replace('min_', ''))
    setState(id, { ...s, step: 'mood', minutes })
    return md(id, '💭 Sessiya qanday oʻtdi?', moodKb())
  }

  if (data.startsWith('mood_')) {
    const moodMap = { mood_hard: 'hard', mood_ok: 'ok', mood_good: 'good', mood_great: 'great' }
    const mood = moodMap[data] || 'ok'
    const { subject, minutes } = s || {}
    if (!subject || !minutes) { clearState(id); return md(id, '❌ Xatolik. Qayta urinib koʻring.', mainMenu()) }

    const xp = Math.floor(minutes * 1.5) + (mood === 'great' ? 10 : 0)
    const session = {
      date: new Date().toISOString().split('T')[0],
      hour: new Date().getHours(),
      subject, minutes, mood
    }
    user.sessions.push(session)
    if (user.sessions.length > 100) user.sessions = user.sessions.slice(-100)
    user.xp += xp
    user.level = getLevel(user.xp)
    analyzeBehavior(user)
    updateStreak(user)
    clearState(id)
    saveUser(id, user)

    await md(id, `✅ *${subject}* — ${minutes} daqiqa\n\n\\+${xp} XP 🎯\n🔥 Streak: *${user.streak.current}* kun`, { parse_mode: 'MarkdownV2', ...mainMenu() })

    const milestones = [3, 7, 14, 30, 60, 100]
    if (milestones.includes(user.streak.current)) {
      setTimeout(() => md(id, `🔥 *${user.streak.current} kunlik streak\\!* Ajoyib\\!`, { parse_mode: 'MarkdownV2' }), 1200)
    }
  }
})

// ── MESSAGES ──────────────────────────────────────────────────
bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return
  const id = msg.from.id
  const text = msg.text.trim()
  let user = getUser(id)
  const s = getState(id)

  // Menu
  if (text === '📚 Oʻqish') {
    if (!user?.subjects?.length) return md(id, '❗ Avval fan qoʻshing\\. /start', { parse_mode: 'MarkdownV2' })
    setState(id, { step: 'subject' })
    return md(id, '📚 Qaysi fanni oʻqidingiz?', subjectKb(user.subjects))
  }

  if (text === '📅 Reja') {
    if (!user?.subjects?.length) return md(id, '❗ Avval fan qoʻshing\\. /start', { parse_mode: 'MarkdownV2' })
    await md(id, '📅 Reja tuzilmoqda\\.\\.\\. ⏳', { parse_mode: 'MarkdownV2' })
    const plan = await askClaude('Make my daily study plan', user, 'plan')
    return md(id, `📅 *Bugungi Reja*\n\n${plan}`, mainMenu())
  }

  if (text === '📊 Statistika') {
    if (!user) return
    const b = user.behavior
    const hrs = Math.floor(b.totalMin / 60), mins = b.totalMin % 60
    return md(id,
      `📊 *Statistika*\n\n🔥 Streak: *${user.streak.current}* kun \\(rekord: ${user.streak.longest}\\)\n⭐ XP: *${user.xp}* \\| Daraja: *${user.level}* — ${getLevelName(user.level)}\n⏱ Jami: *${hrs}s ${mins}d*\n📚 Sessiyalar: *${b.count}*\n🌟 Koʻp oʻqilgan: *${b.mostStudied || '—'}*\n⚡ Eng yaxshi soat: *${b.bestHour !== null ? b.bestHour + ':00' : '—'}*\n⚠️ Qochilayotgan: *${b.avoided?.join(', ') || 'yoʻq'}*`,
      { parse_mode: 'MarkdownV2', ...mainMenu() }
    )
  }

  if (text === '🧬 Tahlil') {
    if (!user || user.behavior.count < 3) {
      return md(id, '📊 Tahlil uchun kamida *3 ta sessiya* kerak\\.', { parse_mode: 'MarkdownV2' })
    }
    await md(id, '🧬 Tahlil qilinmoqda\\.\\.\\.', { parse_mode: 'MarkdownV2' })
    const result = await askClaude('Analyze my study behavior', user, 'behavior')
    return md(id, `🧬 *Behavioral Analysis*\n\n${result}`, mainMenu())
  }

  if (text === '🧠 AI Tutor') {
    setState(id, 'tutor')
    return md(id, '🧠 *AI Tutor rejimi*\n\nIstalgan savolingizni yozing\\.\n\n/cancel — chiqish', { parse_mode: 'MarkdownV2', ...cancelKb() })
  }

  if (text === '🌐 Dashboard') {
    const url = `${APP_URL}/web.html?uid=${id}`
    return bot.sendMessage(id, '🌐 Dashboard:', {
      reply_markup: {
        inline_keyboard: [[{ text: '📊 Dashboardni ochish', web_app: { url } }]]
      }
    })
  }

  // State flows
  if (s === 'onboarding_subjects') {
    const subjects = text.split(',').map(x => x.trim()).filter(Boolean)
    if (!subjects.length) return md(id, '❗ Kamida 1 ta fan kiriting\\.')
    user.subjects = subjects; saveUser(id, user); clearState(id)
    return md(id, `✅ Saqlandi: ${subjects.map(s => `*${s}*`).join(', ')}\n\n🎯 Tayyor\\!`, { parse_mode: 'MarkdownV2', ...mainMenu() })
  }

  if (s === 'add_subject') {
    user.subjects.push(text); saveUser(id, user); clearState(id)
    return md(id, `✅ *${text}* qoʻshildi\\!`, { parse_mode: 'MarkdownV2', ...mainMenu() })
  }

  if (s?.step === 'minutes_custom') {
    const minutes = parseInt(text)
    if (isNaN(minutes) || minutes < 1 || minutes > 600) return md(id, '❗ 1–600 orasida son kiriting\\.')
    setState(id, { ...s, step: 'mood', minutes })
    return md(id, '💭 Sessiya qanday oʻtdi?', moodKb())
  }

  // AI Tutor fallback
  if (!user) return
  await bot.sendChatAction(id, 'typing')
  const answer = await askClaude(text, user, 'tutor')
  return md(id, answer, s === 'tutor' ? cancelKb() : mainMenu())
})

// ── DAILY REMINDERS (har soat tekshiriladi) ───────────────────
setInterval(async () => {
  const hour = new Date().getHours()
  if (hour !== 8 && hour !== 20) return
  const db = loadDB()
  const today = new Date().toISOString().split('T')[0]
  for (const [uid, user] of Object.entries(db.users)) {
    if (!user.subjects?.length) continue
    try {
      if (hour === 8) {
        await md(uid, `🌅 *Xayrli tong, ${user.name}\\!*\n\n🔥 Streak: *${user.streak.current}* kun \\| ⭐ *${user.xp}* XP\n\nBugun ham oʻqing\\! 💪`, { parse_mode: 'MarkdownV2' })
      }
      if (hour === 20 && user.streak.lastDate !== today && user.streak.current > 0) {
        await md(uid, `⚠️ *${user.name}, bugun hali oʻqimadingiz\\!*\n\n🔥 *${user.streak.current}* kunlik streak xavf ostida\\!\n\nHozir *15 daqiqa* ham yetarli ⏱`, { parse_mode: 'MarkdownV2' })
      }
    } catch { }
  }
}, 60 * 60 * 1000)

// ── WEB API (Dashboard uchun) ──────────────────────────────────
app.get('/api/user/:id', (req, res) => {
  const user = getUser(req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(user)
})

app.get('/api/stats', (req, res) => {
  const db = loadDB()
  const users = Object.values(db.users)
  res.json({ totalUsers: users.length, totalSessions: users.reduce((s, u) => s + u.behavior.count, 0) })
})

// ── START EXPRESS ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Web server port ${PORT} da ishlamoqda`))

bot.on('polling_error', err => console.error('Bot error:', err.message))
console.log('🧠 StudyMind AI Bot ishga tushdi!')
