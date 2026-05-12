// ================================================================
//  🧠 StudyMind — Full Backend v2 (Fixed)
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

const MONGO_URI     = process.env.MONGO_URI
const BOT_TOKEN     = process.env.BOT_TOKEN
const GROQ_KEY      = process.env.GROQ_API_KEY
const GOOGLE_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET
const DOMAIN        = process.env.DOMAIN || `http://localhost:${PORT}`
const SECRET        = process.env.SESSION_SECRET || 'studymind-secret-2025'
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || ''

if (!MONGO_URI || !BOT_TOKEN || !GROQ_KEY) {
  console.error('MONGO_URI, BOT_TOKEN, GROQ_API_KEY kerak!')
  process.exit(1)
}

await mongoose.connect(MONGO_URI)
console.log('MongoDB ulandi')

// SCHEMAS
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

const User         = mongoose.model('User', UserSchema)
const Subject      = mongoose.model('Subject', SubjectSchema)
const StudySession = mongoose.model('StudySession', SessionSchema)
const Flashcard    = mongoose.model('Flashcard', FlashcardSchema)
const AIChat       = mongoose.model('AIChat', AIChatSchema)

// MIDDLEWARE
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

passport.serializeUser((user, done) => done(null, user._id))
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id)) } catch (e) { done(e) }
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

async function getUser(req) {
  if (req.user) return req.user
  if (req.session?.telegramUserId) return await User.findById(req.session.telegramUserId)
  return null
}

function requireAuth(req, res, next) {
  getUser(req).then(u => {
    if (!u) return res.status(401).json({ error: 'Unauthorized' })
    req.currentUser = u
    next()
  }).catch(() => res.status(401).json({ error: 'Unauthorized' }))
}

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

function sm2(card, quality) {
  let { easeFactor, interval, repetitions } = card
  if (quality >= 3) {
    interval = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(interval * easeFactor)
    repetitions++
    easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  } else { repetitions = 0; interval = 1 }
  const nextReview = new Date(Date.now() + interval * 86400000).toISOString().split('T')[0]
  return { interval, easeFactor, repetitions, nextReview }
}

const groq = new Groq({ apiKey: GROQ_KEY })

async function askAI(messages, systemPrompt) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
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
    if (e.name === 'AbortError') return 'AI javob bermadi. Qayta urinib koring.'
    return 'AI xatolik: ' + e.message
  }
}

function buildSystem(user, subject = null) {
  const lang = user?.lang || 'uz'
  const langNote = lang === 'uz' ? 'Respond in Uzbek.' : lang === 'ru' ? 'Respond in Russian.' : 'Respond in English.'
  return `You are StudyMind AI — a behavioral learning coach like a wise caring father.
${langNote} Student: ${user?.name}, Level: ${user?.level}, Streak: ${user?.streak} days.
${subject ? `Subject: ${subject.name}. Weak topics: ${subject.weakTopics?.join(', ') || 'none'}.` : ''}
Be direct, honest, specific. Max 3 short paragraphs. Use emojis naturally.`
}

// AUTH ROUTES
app.get('/auth/google', (req, res, next) => {
  if (!GOOGLE_ID || !GOOGLE_SECRET) return res.redirect('/?error=google_not_configured')
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next)
})

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=google' }),
  (req, res) => res.redirect('/app.html')
)

app.post('/auth/telegram', async (req, res) => {
  const { telegramId, name, username } = req.body
  if (!telegramId) return res.status(400).json({ error: 'telegramId kerak' })
  try {
    let user = await User.findOne({ telegramId: String(telegramId) })
    if (!user) user = await User.create({ telegramId: String(telegramId), name, telegramUsername: username })
    req.session.telegramUserId = user._id
    res.json({ ok: true, user: { name: user.name, level: user.level, xp: user.xp } })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }) })

// USER
app.get('/api/user', requireAuth, (req, res) => {
  const u = req.currentUser
  res.json({ name: u.name, email: u.email, avatar: u.avatar, lang: u.lang, level: u.level, xp: u.xp, streak: u.streak, isAdmin: u.isAdmin })
})
app.put('/api/user', requireAuth, async (req, res) => {
  if (req.body.lang) req.currentUser.lang = req.body.lang
  await req.currentUser.save()
  res.json({ ok: true })
})

// SUBJECTS
app.get('/api/subjects', requireAuth, async (req, res) => {
  res.json(await Subject.find({ userId: req.currentUser._id }).sort({ createdAt: 1 }))
})
app.post('/api/subjects', requireAuth, async (req, res) => {
  const { name, emoji, color, examDate } = req.body
  if (!name) return res.status(400).json({ error: 'name kerak' })
  res.json(await Subject.create({ userId: req.currentUser._id, name, emoji: emoji || '📚', color: color || '#6c63ff', examDate }))
})
app.put('/api/subjects/:id', requireAuth, async (req, res) => {
  const s = await Subject.findOneAndUpdate({ _id: req.params.id, userId: req.currentUser._id }, req.body, { new: true })
  if (!s) return res.status(404).json({ error: 'Topilmadi' })
  res.json(s)
})
app.delete('/api/subjects/:id', requireAuth, async (req, res) => {
  await Subject.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// SESSIONS
app.get('/api/sessions', requireAuth, async (req, res) => {
  const query = { userId: req.currentUser._id }
  if (req.query.subjectId) query.subjectId = req.query.subjectId
  res.json(await StudySession.find(query).sort({ createdAt: -1 }).limit(Number(req.query.limit) || 50))
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
  const session = await StudySession.create({ userId: req.currentUser._id, subjectId, subjectName, date, duration, score, notes, xpEarned })
  const updatedUser = await addXP(req.currentUser._id, xpEarned)
  res.json({ session, xpEarned, newXP: updatedUser.xp, level: updatedUser.level, streak: updatedUser.streak })
})

// STATS
app.get('/api/stats', requireAuth, async (req, res) => {
  const userId = req.currentUser._id
  const today = new Date().toISOString().split('T')[0]
  const u = req.currentUser
  const subjects = await Subject.find({ userId })
  const weekly = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    const s = await StudySession.find({ userId, date: d })
    weekly.push({ date: d, minutes: s.reduce((a, x) => a + (x.duration || 0), 0) })
  }
  const todaySessions = await StudySession.find({ userId, date: today })
  const todayMinutes = todaySessions.reduce((a, x) => a + (x.duration || 0), 0)
  const dueCards = await Flashcard.countDocuments({ userId, nextReview: { $lte: today } })
  const urgentSubjects = subjects.filter(s => {
    if (!s.examDate) return false
    const days = Math.ceil((new Date(s.examDate) - new Date()) / 86400000)
    return days <= 7 && days >= 0
  })
  res.json({ subjects, weekly, todayMinutes, dueCards, urgentSubjects, xp: u.xp, level: u.level, streak: u.streak })
})

// FLASHCARDS
app.get('/api/flashcards', requireAuth, async (req, res) => {
  const query = { userId: req.currentUser._id }
  if (req.query.subjectId) query.subjectId = req.query.subjectId
  if (req.query.dueOnly === 'true') query.nextReview = { $lte: new Date().toISOString().split('T')[0] }
  res.json(await Flashcard.find(query).sort({ nextReview: 1 }))
})
app.post('/api/flashcards', requireAuth, async (req, res) => {
  const { subjectId, front, back } = req.body
  if (!front || !back) return res.status(400).json({ error: 'front va back kerak' })
  res.json(await Flashcard.create({ userId: req.currentUser._id, subjectId, front, back }))
})
app.post('/api/flashcards/:id/review', requireAuth, async (req, res) => {
  const card = await Flashcard.findOne({ _id: req.params.id, userId: req.currentUser._id })
  if (!card) return res.status(404).json({ error: 'Topilmadi' })
  const updated = sm2(card, req.body.quality)
  Object.assign(card, updated)
  await card.save()
  const xp = req.body.quality >= 3 ? 5 : 2
  await addXP(req.currentUser._id, xp)
  res.json({ ...updated, xpEarned: xp })
})
app.delete('/api/flashcards/:id', requireAuth, async (req, res) => {
  await Flashcard.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// AI
app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const { message, subjectId } = req.body
  if (!message) return res.status(400).json({ error: 'message kerak' })
  const u = req.currentUser
  const subject = subjectId ? await Subject.findById(subjectId) : null
  await AIChat.create({ userId: u._id, role: 'user', content: message, subjectId })
  const history = await AIChat.find({ userId: u._id }).sort({ createdAt: -1 }).limit(10)
  const messages = history.reverse().map(m => ({ role: m.role, content: m.content }))
  const reply = await askAI(messages, buildSystem(u, subject))
  await AIChat.create({ userId: u._id, role: 'assistant', content: reply, subjectId })
  res.json({ reply })
})
app.post('/api/ai/exam-plan', requireAuth, async (req, res) => {
  const subject = await Subject.findById(req.body.subjectId)
  if (!subject) return res.status(404).json({ error: 'Fan topilmadi' })
  const daysLeft = subject.examDate ? Math.ceil((new Date(subject.examDate) - new Date()) / 86400000) : 14
  const prompt = `Create a ${daysLeft}-day study plan for: ${subject.name}. Progress: ${subject.progress}%. Format as numbered list.`
  const reply = await askAI([{ role: 'user', content: prompt }], buildSystem(req.currentUser, subject))
  res.json({ plan: reply })
})
app.post('/api/ai/summarize', requireAuth, async (req, res) => {
  const { notes, subjectId } = req.body
  if (!notes) return res.status(400).json({ error: 'notes kerak' })
  const subject = subjectId ? await Subject.findById(subjectId) : null
  const prompt = `Summarize these notes. Extract key concepts, formulas, exam questions:\n${notes.slice(0, 3000)}`
  res.json({ summary: await askAI([{ role: 'user', content: prompt }], buildSystem(req.currentUser, subject)) })
})

// PING & STATIC
app.get('/ping', (req, res) => res.send('ok'))
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'app.html')))
app.get('/app.html', (req, res) => res.sendFile(path.join(__dirname, 'app.html')))

// TELEGRAM BOT
const bot = new Telegraf(BOT_TOKEN)

const getLang = (u) => u?.lang || 'uz'

function appBtn(domain) {
  return Markup.inlineKeyboard([[Markup.button.webApp('🌐 StudyMind App', `${domain}/app.html`)]])
}

bot.start(async ctx => {
  const tid = String(ctx.from.id)
  const name = ctx.from.first_name || 'Student'
  let user = await User.findOne({ telegramId: tid })
  if (!user) user = await User.create({ telegramId: tid, name, telegramUsername: ctx.from.username })
  await ctx.reply(
    `👋 Salom *${name}*\\!\n\n🧠 *StudyMind* — aqlli o'quv assistentingiz\\.\n\nTilni tanlang:`,
    { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard([[
      Markup.button.callback("🇺🇿 O'zbek", 'lang_uz'),
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback('🇬🇧 English', 'lang_en')
    ]]) }
  )
})

bot.action(/lang_(.+)/, async ctx => {
  const lang = ctx.match[1]
  await User.findOneAndUpdate({ telegramId: String(ctx.from.id) }, { lang })
  await ctx.editMessageText('✅ Saqlandi!')
  await ctx.reply('🧠 StudyMind tayyor!', {
    ...Markup.keyboard([
      ["📚 Fanlarim", "📊 Statistika"],
      ["🧠 AI Tutor", "🌐 App"]
    ]).resize(),
    ...appBtn(DOMAIN)
  })
})

bot.hears('📚 Fanlarim', async ctx => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!user) return ctx.reply('/start bosing')
  const subjects = await Subject.find({ userId: user._id })
  if (!subjects.length) return ctx.reply('Fan qoshilmagan', appBtn(DOMAIN))
  let text = '📚 *Fanlaringiz:*\n\n'
  subjects.forEach(s => {
    const days = s.examDate ? Math.ceil((new Date(s.examDate) - new Date()) / 86400000) : null
    text += `${s.emoji} *${s.name}* — ${s.progress}%${days !== null ? ` | 📅 ${days} kun` : ''}\n`
  })
  await ctx.reply(text, { parse_mode: 'Markdown', ...appBtn(DOMAIN) })
})

bot.hears('📊 Statistika', async ctx => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!user) return ctx.reply('/start bosing')
  const today = new Date().toISOString().split('T')[0]
  const sessions = await StudySession.find({ userId: user._id, date: today })
  const min = sessions.reduce((s, x) => s + (x.duration || 0), 0)
  await ctx.reply(
    `📊 *Statistika*\n\n🔥 Streak: *${user.streak}* kun\n⭐ XP: *${user.xp}* | Lv.*${user.level}*\n⏱ Bugun: *${min}* daqiqa`,
    { parse_mode: 'Markdown', ...appBtn(DOMAIN) }
  )
})

bot.hears('🧠 AI Tutor', async ctx => {
  await ctx.reply('Savolingizni yozing:', appBtn(DOMAIN))
})

bot.hears('🌐 App', async ctx => {
  await ctx.reply('📱 StudyMind:', appBtn(DOMAIN))
})

bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return
  const user = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!user) return ctx.reply('/start bosing')
  await ctx.sendChatAction('typing')
  const reply = await askAI([{ role: 'user', content: ctx.message.text }], buildSystem(user))
  await ctx.reply(reply)
})

// Daily reminders
setInterval(async () => {
  const hour = new Date().getHours()
  if (hour !== 8 && hour !== 21) return
  const users = await User.find({ telegramId: { $exists: true, $ne: null } })
  const today = new Date().toISOString().split('T')[0]
  for (const u of users) {
    try {
      if (hour === 8) {
        await bot.telegram.sendMessage(u.telegramId, `🌅 Xayrli tong, ${u.name}!\n\n🔥 Streak: ${u.streak} kun\nBugun ham o'qing! 💪`)
      }
      if (hour === 21) {
        const s = await StudySession.find({ userId: u._id, date: today })
        const min = s.reduce((a, x) => a + (x.duration || 0), 0)
        await bot.telegram.sendMessage(u.telegramId, `🌙 Bugun ${min} daqiqa o'qidingiz!\n🔥 Streak: ${u.streak} kun ⭐`)
      }
    } catch {}
  }
}, 60 * 60 * 1000)

bot.launch({ dropPendingUpdates: true })
console.log('Telegram bot ishga tushdi')

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server port ${PORT} da ishlamoqda`)
  console.log('StudyMind tayyor!')
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
