// ================================================================
//  🧠 StudyMind — Full Backend
//  Express + MongoDB + Telegram Bot + Google Auth + Groq AI
// ================================================================

import express from 'express'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import mongoose from 'mongoose'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { Telegraf, Markup } from 'telegraf'
import Groq from 'groq-sdk'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// ── ENV ──────────────────────────────────────────────────────────
const MONGO_URI     = process.env.MONGO_URI
const BOT_TOKEN     = process.env.BOT_TOKEN
const GROQ_KEY      = process.env.GROQ_API_KEY
const GOOGLE_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET
const DOMAIN        = process.env.DOMAIN || `http://localhost:${PORT}`
const SECRET        = process.env.SESSION_SECRET || 'studymind-secret-2025'
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || ''

if (!MONGO_URI || !BOT_TOKEN || !GROQ_KEY) {
  console.error('❌ MONGO_URI, BOT_TOKEN, GROQ_API_KEY kerak!')
  process.exit(1)
}

// ── MONGODB ───────────────────────────────────────────────────────
await mongoose.connect(MONGO_URI)
console.log('✅ MongoDB ulandi')

// ── SCHEMAS ───────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  avatar: String,
  isAdmin: { type: Boolean, default: false },
  telegramId: { type: String, unique: true, sparse: true },
  telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastStudyDate: String,
  createdAt: { type: Date, default: Date.now }
})

const SubjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  id: { type: Number, default: () => Date.now() },
  name: { type: String, required: true },
  emoji: { type: String, default: '📚' },
  color: { type: String, default: '#6c63ff' },
  examDate: String,
  progress: { type: Number, default: 0 },
  totalXP: { type: Number, default: 0 },
  weakTopics: [String],
  createdAt: { type: Date, default: Date.now }
})

const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  subjectName: String,
  date: String,
  duration: Number,
  score: Number,
  notes: String,
  xpEarned: Number,
  createdAt: { type: Date, default: Date.now }
})

const FlashcardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  front: String,
  back: String,
  interval: { type: Number, default: 1 },
  easeFactor: { type: Number, default: 2.5 },
  nextReview: { type: String, default: () => new Date().toISOString().split('T')[0] },
  repetitions: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

const AIChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,
  subjectId: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now }
})

const TelegramLinkSchema = new mongoose.Schema({
  _id: String,
  userId: mongoose.Schema.Types.ObjectId
})

const User       = mongoose.model('User', UserSchema)
const Subject    = mongoose.model('Subject', SubjectSchema)
const StudySession = mongoose.model('StudySession', SessionSchema)
const Flashcard  = mongoose.model('Flashcard', FlashcardSchema)
const AIChat     = mongoose.model('AIChat', AIChatSchema)
const TelegramLink = mongoose.model('TelegramLink', TelegramLinkSchema)

// ── MIDDLEWARE ────────────────────────────────────────────────────
app.use(express.json())
app.use(express.static(__dirname))

app.use(session({
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}))

app.use(passport.initialize())
app.use(passport.session())

// ── PASSPORT ──────────────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user._id))
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id)) }
  catch (e) { done(e) }
})

if (GOOGLE_ID && GOOGLE_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_ID,
    clientSecret: GOOGLE_SECRET,
    callbackURL: `${DOMAIN}/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ email: profile.emails[0].value })
      if (!user) {
        user = await User.create({
          name: profile.displayName,
          email: profile.emails[0].value,
          avatar: profile.photos[0]?.value,
          isAdmin: profile.emails[0].value === ADMIN_EMAIL
        })
      }
      done(null, user)
    } catch (e) { done(e) }
  }))
}

// ── AUTH HELPER ───────────────────────────────────────────────────
async function getUser(req) {
  if (req.user) return req.user
  if (req.session?.telegramUserId) {
    return await User.findById(req.session.telegramUserId)
  }
  return null
}

function requireAuth(req, res, next) {
  getUser(req).then(u => {
    if (!u) return res.status(401).json({ error: 'Unauthorized' })
    req.currentUser = u
    next()
  }).catch(() => res.status(401).json({ error: 'Unauthorized' }))
}

// ── XP & LEVEL ────────────────────────────────────────────────────
function calcLevel(xp) {
  if (xp < 100) return 1; if (xp < 300) return 2; if (xp < 600) return 3
  if (xp < 1000) return 4; if (xp < 1500) return 5; if (xp < 2200) return 6
  return Math.floor(7 + (xp - 2200) / 500)
}

async function addXP(userId, amount) {
  const user = await User.findById(userId)
  user.xp += amount
  user.level = calcLevel(user.xp)
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (user.lastStudyDate !== today) {
    user.streak = user.lastStudyDate === yesterday ? user.streak + 1 : 1
    user.lastStudyDate = today
  }
  await user.save()
  return user
}

// ── SM-2 SPACED REPETITION ────────────────────────────────────────
function sm2(card, quality) {
  let { easeFactor, interval, repetitions } = card
  if (quality >= 3) {
    interval = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(interval * easeFactor)
    repetitions++
    easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  } else {
    repetitions = 0
    interval = 1
  }
  const nextReview = new Date(Date.now() + interval * 86400000).toISOString().split('T')[0]
  return { interval, easeFactor, repetitions, nextReview }
}

// ── GROQ AI ───────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })

async function askAI(messages, systemPrompt, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      max_tokens: 600,
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    }, { signal: controller.signal })
    clearTimeout(timer)
    return res.choices[0]?.message?.content || 'Javob olishda xatolik.'
  } catch (e) {
    clearTimeout(timer)
    if (e.name === 'AbortError') return '⏳ AI javob bermadi. Qayta urinib koʻring.'
    return '❌ AI xatolik: ' + e.message
  }
}

function buildSystem(user, subject = null) {
  const lang = user?.lang || 'uz'
  const langNote = lang === 'uz' ? 'Respond in Uzbek.' : lang === 'ru' ? 'Respond in Russian.' : 'Respond in English.'
  return `You are StudyMind AI — a behavioral learning coach, like a wise, caring father who tells the truth.
${langNote}
Student: ${user?.name}, Level: ${user?.level}, Streak: ${user?.streak} days, XP: ${user?.xp}.
${subject ? `Current subject: ${subject.name}. Weak topics: ${subject.weakTopics?.join(', ') || 'unknown'}.` : ''}
Be direct, specific, honest. Max 3 short paragraphs. Use emojis naturally.`
}

// ── AUTH ROUTES ───────────────────────────────────────────────────
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }))

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=google' }),
  (req, res) => res.redirect('/app.html')
)

app.post('/auth/telegram', async (req, res) => {
  const { telegramId, name, username } = req.body
  if (!telegramId) return res.status(400).json({ error: 'telegramId kerak' })
  try {
    let user = await User.findOne({ telegramId: String(telegramId) })
    if (!user) {
      user = await User.create({ telegramId: String(telegramId), name, telegramUsername: username })
    }
    req.session.telegramUserId = user._id
    res.json({ ok: true, user: { name: user.name, level: user.level, xp: user.xp } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/auth/logout', (req, res) => {
  req.session.destroy()
  res.json({ ok: true })
})

// ── USER ROUTES ───────────────────────────────────────────────────
app.get('/api/user', requireAuth, (req, res) => {
  const u = req.currentUser
  res.json({ name: u.name, email: u.email, avatar: u.avatar, lang: u.lang, level: u.level, xp: u.xp, streak: u.streak, isAdmin: u.isAdmin })
})

app.put('/api/user', requireAuth, async (req, res) => {
  const { lang } = req.body
  if (lang) req.currentUser.lang = lang
  await req.currentUser.save()
  res.json({ ok: true })
})

// ── SUBJECTS ──────────────────────────────────────────────────────
app.get('/api/subjects', requireAuth, async (req, res) => {
  const subjects = await Subject.find({ userId: req.currentUser._id }).sort({ createdAt: 1 })
  res.json(subjects)
})

app.post('/api/subjects', requireAuth, async (req, res) => {
  const { name, emoji, color, examDate } = req.body
  if (!name) return res.status(400).json({ error: 'name kerak' })
  const subject = await Subject.create({ userId: req.currentUser._id, name, emoji: emoji || '📚', color: color || '#6c63ff', examDate })
  res.json(subject)
})

app.put('/api/subjects/:id', requireAuth, async (req, res) => {
  const subject = await Subject.findOneAndUpdate(
    { _id: req.params.id, userId: req.currentUser._id },
    req.body, { new: true }
  )
  if (!subject) return res.status(404).json({ error: 'Topilmadi' })
  res.json(subject)
})

app.delete('/api/subjects/:id', requireAuth, async (req, res) => {
  await Subject.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// ── SESSIONS ──────────────────────────────────────────────────────
app.get('/api/sessions', requireAuth, async (req, res) => {
  const query = { userId: req.currentUser._id }
  if (req.query.subjectId) query.subjectId = req.query.subjectId
  const sessions = await StudySession.find(query).sort({ createdAt: -1 }).limit(Number(req.query.limit) || 50)
  res.json(sessions)
})

app.post('/api/sessions', requireAuth, async (req, res) => {
  const { subjectId, duration, score, notes } = req.body
  if (!duration) return res.status(400).json({ error: 'duration kerak' })
  const xpEarned = Math.floor(duration * 2) + (score ? Math.floor(score / 10) : 0)
  const date = new Date().toISOString().split('T')[0]

  let subjectName = ''
  if (subjectId) {
    const subj = await Subject.findById(subjectId)
    subjectName = subj?.name || ''
    if (subj) {
      subj.totalXP += xpEarned
      subj.progress = Math.min(100, subj.progress + Math.floor(duration / 10))
      await subj.save()
    }
  }

  const session = await StudySession.create({
    userId: req.currentUser._id, subjectId, subjectName, date, duration, score, notes, xpEarned
  })

  const updatedUser = await addXP(req.currentUser._id, xpEarned)
  res.json({ session, xpEarned, newXP: updatedUser.xp, level: updatedUser.level, streak: updatedUser.streak })
})

// ── STATS ─────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, async (req, res) => {
  const userId = req.currentUser._id
  const today = new Date().toISOString().split('T')[0]
  const u = req.currentUser

  const subjects = await Subject.find({ userId })

  const weekly = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    const daySessions = await StudySession.find({ userId, date: d })
    weekly.push({ date: d, minutes: daySessions.reduce((s, x) => s + (x.duration || 0), 0) })
  }

  const todaySessions = await StudySession.find({ userId, date: today })
  const todayMinutes = todaySessions.reduce((s, x) => s + (x.duration || 0), 0)

  const dueCards = await Flashcard.countDocuments({ userId, nextReview: { $lte: today } })

  const urgentSubjects = subjects.filter(s => {
    if (!s.examDate) return false
    const days = Math.ceil((new Date(s.examDate) - new Date()) / 86400000)
    return days <= 7 && days >= 0
  })

  res.json({
    subjects,
    weekly,
    todayMinutes,
    dueCards,
    urgentSubjects,
    xp: u.xp,
    level: u.level,
    streak: u.streak
  })
})

// ── FLASHCARDS ────────────────────────────────────────────────────
app.get('/api/flashcards', requireAuth, async (req, res) => {
  const query = { userId: req.currentUser._id }
  if (req.query.subjectId) query.subjectId = req.query.subjectId
  if (req.query.dueOnly === 'true') {
    query.nextReview = { $lte: new Date().toISOString().split('T')[0] }
  }
  const cards = await Flashcard.find(query).sort({ nextReview: 1 })
  res.json(cards)
})

app.post('/api/flashcards', requireAuth, async (req, res) => {
  const { subjectId, front, back } = req.body
  if (!front || !back) return res.status(400).json({ error: 'front va back kerak' })
  const card = await Flashcard.create({ userId: req.currentUser._id, subjectId, front, back })
  res.json(card)
})

app.post('/api/flashcards/:id/review', requireAuth, async (req, res) => {
  const { quality } = req.body
  const card = await Flashcard.findOne({ _id: req.params.id, userId: req.currentUser._id })
  if (!card) return res.status(404).json({ error: 'Topilmadi' })
  const updated = sm2(card, quality)
  Object.assign(card, updated)
  await card.save()
  const xp = quality >= 3 ? 5 : 2
  await addXP(req.currentUser._id, xp)
  res.json({ ...updated, xpEarned: xp })
})

app.delete('/api/flashcards/:id', requireAuth, async (req, res) => {
  await Flashcard.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// ── AI ROUTES ─────────────────────────────────────────────────────
app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const { message, subjectId } = req.body
  if (!message) return res.status(400).json({ error: 'message kerak' })

  const u = req.currentUser
  let subject = null
  if (subjectId) subject = await Subject.findById(subjectId)

  // Save user message
  await AIChat.create({ userId: u._id, role: 'user', content: message, subjectId })

  // Get recent chat history
  const history = await AIChat.find({ userId: u._id }).sort({ createdAt: -1 }).limit(10)
  const messages = history.reverse().map(m => ({ role: m.role, content: m.content }))

  const reply = await askAI(messages, buildSystem(u, subject))

  await AIChat.create({ userId: u._id, role: 'assistant', content: reply, subjectId })

  res.json({ reply })
})

app.post('/api/ai/exam-plan', requireAuth, async (req, res) => {
  const { subjectId } = req.body
  const subject = await Subject.findById(subjectId)
  if (!subject) return res.status(404).json({ error: 'Fan topilmadi' })

  const daysLeft = subject.examDate
    ? Math.ceil((new Date(subject.examDate) - new Date()) / 86400000)
    : 14

  const prompt = `Create a ${daysLeft}-day study plan for: ${subject.name}.
Weak topics: ${subject.weakTopics?.join(', ') || 'none identified yet'}.
Progress: ${subject.progress}%.
Make it realistic, day by day. Format as numbered list.`

  const reply = await askAI([{ role: 'user', content: prompt }], buildSystem(req.currentUser, subject))
  res.json({ plan: reply })
})

app.post('/api/ai/summarize', requireAuth, async (req, res) => {
  const { notes, subjectId } = req.body
  if (!notes) return res.status(400).json({ error: 'notes kerak' })
  const subject = subjectId ? await Subject.findById(subjectId) : null
  const prompt = `Summarize these student notes clearly and concisely. Extract: key concepts, important formulas/dates, likely exam questions. Notes:\n${notes.slice(0, 3000)}`
  const reply = await askAI([{ role: 'user', content: prompt }], buildSystem(req.currentUser, subject))
  res.json({ summary: reply })
})

// ── ADMIN ─────────────────────────────────────────────────────────
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  if (!req.currentUser.isAdmin) return res.status(403).json({ error: 'Admin emas' })
  const totalUsers = await User.countDocuments()
  const totalSessions = await StudySession.countDocuments()
  const totalFlashcards = await Flashcard.countDocuments()
  res.json({ totalUsers, totalSessions, totalFlashcards })
})

// ── PING ──────────────────────────────────────────────────────────
app.get('/ping', (req, res) => res.send('ok'))
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'web.html')))

// ── TELEGRAM BOT ──────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN)

async function getBotUser(telegramId) {
  return await User.findOne({ telegramId: String(telegramId) })
}

const langText = {
  uz: {
    welcome: (name) => `👋 Salom, *${name}*!\n\n🧠 *StudyMind* — aqlli oʻquv assistentingiz.\n\nXulq-atvoringizni tahlil qilib, nima uchun qiynalayotganingizni aytadi — aqlli otadek.\n\n🌐 Tilni tanlang:`,
    menu: '📚 Fanlar | 📊 Statistika | 🧠 AI Tutor | 🌐 App',
    study: '📚 Fanlarim',
    stats: '📊 Statistika',
    ai: '🧠 AI Tutor',
    openApp: '🌐 Appni ochish',
    noSubjects: '❗ Hali fan qoʻshilmagan. Appni oching va fan qoʻshing.',
    morning: (u) => `🌅 *Xayrli tong, ${u.name}!*\n\n🔥 Streak: *${u.streak}* kun\n⭐ Level: *${u.level}*\n\nBugun ham oʻqing! 💪`,
    evening: (u, min) => `🌙 *Bugun natijalari, ${u.name}!*\n\n⏱ Oʻqildi: *${min}* daqiqa\n🔥 Streak: *${u.streak}* kun\n\nAjoyib! Ertaga ham davom eting! ⭐`,
  },
  ru: {
    welcome: (name) => `👋 Привет, *${name}*!\n\n🧠 *StudyMind* — ваш умный учебный ассистент.\n\nАнализирует поведение и честно говорит почему вы застряли.\n\n🌐 Выберите язык:`,
    menu: '📚 Предметы | 📊 Статистика | 🧠 AI | 🌐 App',
    study: '📚 Мои предметы',
    stats: '📊 Статистика',
    ai: '🧠 AI Репетитор',
    openApp: '🌐 Открыть приложение',
    noSubjects: '❗ Предметов нет. Откройте приложение и добавьте.',
    morning: (u) => `🌅 *Доброе утро, ${u.name}!*\n\n🔥 Серия: *${u.streak}* дней\n⭐ Уровень: *${u.level}*\n\nВперёд! 💪`,
    evening: (u, min) => `🌙 *Итоги дня, ${u.name}!*\n\n⏱ Изучено: *${min}* минут\n🔥 Серия: *${u.streak}* дней\n\nОтлично! ⭐`,
  },
  en: {
    welcome: (name) => `👋 Hello, *${name}*!\n\n🧠 *StudyMind* — your intelligent study assistant.\n\nAnalyzes your behavior and tells you exactly why you're struggling — like a wise mentor.\n\n🌐 Choose language:`,
    menu: '📚 Subjects | 📊 Stats | 🧠 AI | 🌐 App',
    study: '📚 My Subjects',
    stats: '📊 Statistics',
    ai: '🧠 AI Tutor',
    openApp: '🌐 Open App',
    noSubjects: '❗ No subjects yet. Open the app and add subjects.',
    morning: (u) => `🌅 *Good morning, ${u.name}!*\n\n🔥 Streak: *${u.streak}* days\n⭐ Level: *${u.level}*\n\nKeep going! 💪`,
    evening: (u, min) => `🌙 *Today's summary, ${u.name}!*\n\n⏱ Studied: *${min}* minutes\n🔥 Streak: *${u.streak}* days\n\nGreat work! ⭐`,
  }
}

function T(user, key, ...args) {
  const lang = user?.lang || 'uz'
  const t = langText[lang] || langText.uz
  const val = t[key]
  return typeof val === 'function' ? val(...args) : val
}

function mainKeyboard(user) {
  const lang = user?.lang || 'uz'
  const t = langText[lang] || langText.uz
  return Markup.keyboard([
    [t.study, t.stats],
    [t.ai, t.openApp]
  ]).resize()
}

function appButton(user) {
  return Markup.inlineKeyboard([[
    Markup.button.webApp('🌐 StudyMind App', `${DOMAIN}/app.html`)
  ]])
}

// Bot commands
bot.start(async ctx => {
  const tid = String(ctx.from.id)
  const name = ctx.from.first_name || 'Student'
  let user = await getBotUser(tid)
  if (!user) {
    user = await User.create({ telegramId: tid, name, telegramUsername: ctx.from.username })
  }

  await ctx.reply(T(user, 'welcome', name), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[
      Markup.button.callback('🇺🇿 Oʻzbek', 'lang_uz'),
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback('🇬🇧 English', 'lang_en')
    ]])
  })
})

bot.action(/lang_(.+)/, async ctx => {
  const lang = ctx.match[1]
  const tid = String(ctx.from.id)
  await User.findOneAndUpdate({ telegramId: tid }, { lang })
  const user = await getBotUser(tid)
  await ctx.editMessageText(`✅ ${lang === 'uz' ? "Til saqlandi!" : lang === 'ru' ? "Язык сохранён!" : "Language saved!"}`)
  await ctx.reply(T(user, 'menu'), mainKeyboard(user))
})

bot.hears(/📚|Mening fanlarim|Мои предметы|My Subjects|Fanlarim/, async ctx => {
  const user = await getBotUser(String(ctx.from.id))
  if (!user) return ctx.reply('Avval /start bosing')
  const subjects = await Subject.find({ userId: user._id })
  if (!subjects.length) return ctx.reply(T(user, 'noSubjects'), appButton(user))

  let text = `📚 *Sizning fanlaringiz:*\n\n`
  subjects.forEach(s => {
    const days = s.examDate ? Math.ceil((new Date(s.examDate) - new Date()) / 86400000) : null
    text += `${s.emoji} *${s.name}* — ${s.progress}%`
    if (days !== null) text += ` | 📅 ${days} kun`
    text += `\n`
  })

  await ctx.reply(text, { parse_mode: 'Markdown', ...appButton(user) })
})

bot.hears(/📊|Statistika|Статистика|Statistics/, async ctx => {
  const user = await getBotUser(String(ctx.from.id))
  if (!user) return ctx.reply('Avval /start bosing')

  const today = new Date().toISOString().split('T')[0]
  const todaySessions = await StudySession.find({ userId: user._id, date: today })
  const todayMin = todaySessions.reduce((s, x) => s + (x.duration || 0), 0)
  const totalSessions = await StudySession.countDocuments({ userId: user._id })
  const dueCards = await Flashcard.countDocuments({ userId: user._id, nextReview: { $lte: today } })

  const text = `📊 *Statistika*\n\n🔥 Streak: *${user.streak}* kun\n⭐ XP: *${user.xp}* | Level: *${user.level}*\n⏱ Bugun: *${todayMin}* daqiqa\n📚 Jami sessiyalar: *${totalSessions}*\n🔁 Kartalar (bugun): *${dueCards}*`

  await ctx.reply(text, { parse_mode: 'Markdown', ...appButton(user) })
})

bot.hears(/🧠|AI Tutor|AI Репетитор/, async ctx => {
  const user = await getBotUser(String(ctx.from.id))
  if (!user) return ctx.reply('Avval /start bosing')
  await ctx.reply(
    user.lang === 'uz' ? '🧠 Savolingizni yozing — AI javob beradi:' :
    user.lang === 'ru' ? '🧠 Задайте вопрос — AI ответит:' :
    '🧠 Ask your question — AI will answer:',
    Markup.inlineKeyboard([[Markup.button.webApp('🌐 To\'liq AI', `${DOMAIN}/app.html`)]])
  )
})

bot.hears(/🌐|App|Appni ochish|Открыть приложение|Open App/, async ctx => {
  const user = await getBotUser(String(ctx.from.id))
  await ctx.reply('🌐 StudyMind:', appButton(user))
})

// AI fallback — any text
bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return
  const user = await getBotUser(String(ctx.from.id))
  if (!user) return ctx.reply('Avval /start bosing')

  await ctx.sendChatAction('typing')
  const subjects = await Subject.find({ userId: user._id })
  const system = buildSystem(user, subjects[0])
  const reply = await askAI([{ role: 'user', content: ctx.message.text }], system)
  await ctx.reply(reply, { parse_mode: 'Markdown' })
})

// Daily reminders
setInterval(async () => {
  const hour = new Date().getHours()
  if (hour !== 8 && hour !== 21) return
  const users = await User.find({ telegramId: { $exists: true, $ne: null } })
  const today = new Date().toISOString().split('T')[0]

  for (const user of users) {
    try {
      if (hour === 8) {
        await bot.telegram.sendMessage(user.telegramId, T(user, 'morning', user), { parse_mode: 'Markdown' })
      }
      if (hour === 21) {
        const sessions = await StudySession.find({ userId: user._id, date: today })
        const min = sessions.reduce((s, x) => s + (x.duration || 0), 0)
        await bot.telegram.sendMessage(user.telegramId, T(user, 'evening', user, min), { parse_mode: 'Markdown' })
      }
    } catch { }
  }
}, 60 * 60 * 1000)

bot.launch()
console.log('✅ Telegram bot ishga tushdi')

// ── START ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server port ${PORT} da ishlamoqda`)
  console.log('🧠 StudyMind tayyor!')
})
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
