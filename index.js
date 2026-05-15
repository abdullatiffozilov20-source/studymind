// ================================================================
//  🧠 StudyMind — AI-First Student Assistant v4.0
//  Olib tashlangan: manual baho kiritish, murakkab career UI
//  Qoldirilgan: AI chat (asosiy), fanlar, streak, flashcard, schedule
//  AI: barcha ma'lumotlarni o'zi yig'adi suhbat orqali
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
const SECRET        = process.env.SESSION_SECRET || 'studymind-2025'
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || ''

if (!MONGO_URI || !BOT_TOKEN || !GROQ_KEY) {
  console.error('MONGO_URI, BOT_TOKEN, GROQ_API_KEY kerak!')
  process.exit(1)
}

await mongoose.connect(MONGO_URI)
console.log('✅ MongoDB ulandi')

// ── SCHEMAS ───────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  avatar: String,
  telegramId: { type: String, unique: true, sparse: true },
  telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  grade: String,   // "11-sinf", "2-kurs"
  school: String,
  isAdmin: { type: Boolean, default: false },
  // Gamification
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  streak: { type: Number, default: 0 },
  lastStudyDate: String,
  // Behavior (AI tomonidan to'ldiriladi)
  totalStudyMinutes: { type: Number, default: 0 },
  avgMood: { type: Number, default: 3 },
  createdAt: { type: Date, default: Date.now }
})

const SubjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  emoji: { type: String, default: '📚' },
  color: { type: String, default: '#534AB7' },
  examDate: String,
  // AI tomonidan yangilanadi
  avgGrade: { type: Number, default: 0 },
  gradeHistory: [{ score: Number, date: String, note: String }], // AI suhbatdan chiqaradi
  weakTopics: [String],
  progress: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

// AI chat — asosiy
const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant', 'system'] },
  content: String,
  // AI suhbatdan chiqargan ma'lumotlar
  extractedData: {
    grade: { subjectName: String, score: Number, note: String },
    studyMinutes: Number,
    mood: Number,
    completedTask: String,
  },
  createdAt: { type: Date, default: Date.now }
})

const FlashcardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  subjectName: String,
  front: String,
  back: String,
  // SM-2
  interval: { type: Number, default: 1 },
  easeFactor: { type: Number, default: 2.5 },
  nextReview: { type: String, default: () => new Date().toISOString().split('T')[0] },
  repetitions: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

const ScheduleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  subjectName: String,
  time: String,
  date: String,
  isDone: { type: Boolean, default: false },
  // AI tomonidan yaratilgan
  aiGenerated: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

const InsightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekNumber: Number,
  summary: String,
  strengths: [String],
  weaknesses: [String],
  recommendations: [String],
  learningStyle: String,
  bestStudyTime: String,
  generatedAt: { type: Date, default: Date.now }
})

const User      = mongoose.model('User', UserSchema)
const Subject   = mongoose.model('Subject', SubjectSchema)
const Chat      = mongoose.model('Chat', ChatSchema)
const Flashcard = mongoose.model('Flashcard', FlashcardSchema)
const Schedule  = mongoose.model('Schedule', ScheduleSchema)
const Insight   = mongoose.model('Insight', InsightSchema)

// ── MIDDLEWARE ─────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }))
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

passport.serializeUser((u, done) => done(null, u._id))
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id)) } catch (e) { done(e) }
})

if (GOOGLE_ID && GOOGLE_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_ID, clientSecret: GOOGLE_SECRET,
    callbackURL: `${DOMAIN}/auth/google/callback`
  }, async (at, rt, profile, done) => {
    try {
      let u = await User.findOne({ email: profile.emails[0].value })
      if (!u) u = await User.create({
        name: profile.displayName,
        email: profile.emails[0].value,
        avatar: profile.photos[0]?.value,
        isAdmin: profile.emails[0].value === ADMIN_EMAIL
      })
      done(null, u)
    } catch (e) { done(e) }
  }))
}

async function getUser(req) {
  if (req.user) return req.user
  if (req.session?.tid) return await User.findById(req.session.tid)
  return null
}

function auth(req, res, next) {
  getUser(req).then(u => {
    if (!u) return res.status(401).json({ error: 'Unauthorized' })
    req.u = u; next()
  }).catch(() => res.status(401).json({ error: 'Unauthorized' }))
}

// ── LEVEL & XP ─────────────────────────────────────────────────────
function calcLevel(xp) {
  const thresholds = [0,100,250,500,900,1400,2000,2800,3800,5000]
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (xp >= thresholds[i]) return i + 1
  }
  return 1
}

async function giveXP(userId, amount) {
  const u = await User.findById(userId)
  const prev = u.level
  u.xp += amount
  u.level = calcLevel(u.xp)
  const today = todayStr()
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (u.lastStudyDate !== today) {
    u.streak = u.lastStudyDate === yesterday ? u.streak + 1 : 1
    u.lastStudyDate = today
  }
  await u.save()
  return { user: u, leveledUp: u.level > prev }
}

function todayStr() { return new Date().toISOString().split('T')[0] }

// ── SM-2 ──────────────────────────────────────────────────────────
function sm2(card, q) {
  let { easeFactor: ef, interval, repetitions: rep } = card
  if (q >= 3) {
    interval = rep === 0 ? 1 : rep === 1 ? 6 : Math.round(interval * ef)
    rep++
    ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  } else { rep = 0; interval = 1 }
  const nextReview = new Date(Date.now() + interval * 86400000).toISOString().split('T')[0]
  return { interval, easeFactor: ef, repetitions: rep, nextReview }
}

// ── GROQ AI ───────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })

async function ai(messages, system, maxTokens = 700) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const r = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages]
    }, { signal: ctrl.signal })
    clearTimeout(t)
    return r.choices[0]?.message?.content || ''
  } catch (e) {
    clearTimeout(t)
    return e.name === 'AbortError' ? 'Vaqt tugadi. Qayta urinib koring.' : 'Xatolik: ' + e.message
  }
}

// Asosiy AI system prompt — "ota kabi" murabbiy
function buildSystem(user, subjects = []) {
  const lang = user?.lang || 'uz'
  const langNote = lang === 'uz' ? 'Faqat O\'zbek tilida javob ber.' : lang === 'ru' ? 'Отвечай только на русском.' : 'Respond in English only.'
  const subjList = subjects.map(s => `${s.emoji}${s.name}(o'rtacha:${s.avgGrade||'?'}, zaif:${s.weakTopics?.join(',')||'noma\'lum'})`).join(', ')

  return `Sen StudyMind AI — ${user?.name||'o\'quvchi'}ning shaxsiy o'quv assistentisan. Ota kabi mehribon, lekin to'g'ri so'z.

${langNote}

O'quvchi ma'lumotlari:
- Ism: ${user?.name}, Sinf: ${user?.grade||'noma\'lum'}, Maktab: ${user?.school||'noma\'lum'}
- Daraja: Lv.${user?.level}, XP: ${user?.xp}, Streak: ${user?.streak} kun
- Fanlar: ${subjList || 'hali qo\'shilmagan'}

Qoidalar:
1. Qisqa va aniq yoz (max 3 qisqa paragraf)
2. Bahoni o'quvchi aytsa — EXTRACT qil va [GRADE:FanNomi:Ball] formatda yoz (javob oxirida)
3. Vaqtni aytsa — [STUDY:daqiqa] formatda yoz
4. Kayfiyatni anglasang — [MOOD:1-5] yoz
5. Flashcard yaratishni taklif et, quiz ber, ertangi plan tuz
6. HECH QACHON to'g'ridan javob berma — o'quvchini o'ylat
7. Doim rag'batlantir, ammo real bo'l

Bugungi sana: ${todayStr()}`
}

// AI javobidan ma'lumot chiqarish
function extractFromAI(text) {
  const result = {}
  const gradeMatch = text.match(/\[GRADE:([^:]+):(\d+)\]/i)
  if (gradeMatch) result.grade = { subjectName: gradeMatch[1].trim(), score: parseInt(gradeMatch[2]) }
  const studyMatch = text.match(/\[STUDY:(\d+)\]/i)
  if (studyMatch) result.studyMinutes = parseInt(studyMatch[1])
  const moodMatch = text.match(/\[MOOD:([1-5])\]/i)
  if (moodMatch) result.mood = parseInt(moodMatch[1])
  return result
}

// Clean text (teglarsiz)
function cleanText(text) {
  return text.replace(/\[GRADE:[^\]]+\]/gi, '').replace(/\[STUDY:[^\]]+\]/gi, '').replace(/\[MOOD:[^\]]+\]/gi, '').trim()
}

// ── AUTH ──────────────────────────────────────────────────────────
app.get('/auth/google', (req, res, next) => {
  if (!GOOGLE_ID) return res.redirect('/?error=no_google')
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next)
})
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=google' }),
  (req, res) => res.redirect('/app.html')
)
app.post('/auth/telegram', async (req, res) => {
  const { telegramId, name, username } = req.body
  try {
    let u = await User.findOne({ telegramId: String(telegramId) })
    if (!u) u = await User.create({ telegramId: String(telegramId), name, telegramUsername: username })
    req.session.tid = u._id
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }) })

// ── USER ──────────────────────────────────────────────────────────
app.get('/api/user', auth, (req, res) => {
  const u = req.u
  res.json({ _id: u._id, name: u.name, email: u.email, avatar: u.avatar, lang: u.lang, grade: u.grade, school: u.school, xp: u.xp, level: u.level, streak: u.streak, totalStudyMinutes: u.totalStudyMinutes, isAdmin: u.isAdmin })
})
app.put('/api/user', auth, async (req, res) => {
  const fields = ['lang', 'grade', 'school', 'name']
  fields.forEach(f => { if (req.body[f] !== undefined) req.u[f] = req.body[f] })
  await req.u.save(); res.json({ ok: true })
})

// ── SUBJECTS ──────────────────────────────────────────────────────
app.get('/api/subjects', auth, async (req, res) => {
  res.json(await Subject.find({ userId: req.u._id }).sort({ createdAt: 1 }))
})
app.post('/api/subjects', auth, async (req, res) => {
  const { name, emoji, color, examDate } = req.body
  if (!name) return res.status(400).json({ error: 'name kerak' })
  res.json(await Subject.create({ userId: req.u._id, name, emoji: emoji || '📚', color: color || '#534AB7', examDate }))
})
app.delete('/api/subjects/:id', auth, async (req, res) => {
  await Subject.findOneAndDelete({ _id: req.params.id, userId: req.u._id })
  res.json({ ok: true })
})

// ── AI CHAT (Asosiy funksiya) ─────────────────────────────────────
app.get('/api/chat', auth, async (req, res) => {
  const chats = await Chat.find({ userId: req.u._id })
    .sort({ createdAt: -1 }).limit(30)
  res.json(chats.reverse())
})

app.post('/api/chat', auth, async (req, res) => {
  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'message kerak' })

  const u = req.u
  const subjects = await Subject.find({ userId: u._id })

  // Save user message
  await Chat.create({ userId: u._id, role: 'user', content: message })

  // Get recent history
  const history = await Chat.find({ userId: u._id, role: { $in: ['user', 'assistant'] } })
    .sort({ createdAt: -1 }).limit(12)
  const messages = history.reverse().map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))

  // AI javob
  const rawReply = await ai(messages, buildSystem(u, subjects))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  // AI chiqargan ma'lumotlarni saqlash
  if (extracted.grade) {
    const subj = subjects.find(s => s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if (subj) {
      subj.gradeHistory.push({ score: extracted.grade.score, date: todayStr(), note: 'AI suhbatdan' })
      const total = subj.gradeHistory.reduce((a, g) => a + g.score, 0)
      subj.avgGrade = Math.round(total / subj.gradeHistory.length)
      subj.progress = subj.avgGrade
      await subj.save()
    }
    await giveXP(u._id, 5)
  }

  if (extracted.studyMinutes) {
    u.totalStudyMinutes += extracted.studyMinutes
    await giveXP(u._id, Math.floor(extracted.studyMinutes * 1.5))
    await u.save()
  }

  if (extracted.mood) {
    u.avgMood = Math.round((u.avgMood + extracted.mood) / 2)
    await u.save()
  }

  // Save AI message
  const saved = await Chat.create({
    userId: u._id, role: 'assistant', content: cleanReply,
    extractedData: Object.keys(extracted).length ? extracted : undefined
  })

  res.json({ reply: cleanReply, extracted })
})

// AI dan flashcard yaratish
app.post('/api/chat/flashcard', auth, async (req, res) => {
  const { subjectId, topic } = req.body
  const subj = subjectId ? await Subject.findById(subjectId) : null
  const u = req.u

  const prompt = `${topic || subj?.name || 'o\'qilgan mavzu'} haqida 3 ta flashcard yarat.
Format (faqat shu format, boshqa narsa yozma):
CARD1_FRONT: savol
CARD1_BACK: javob
CARD2_FRONT: savol
CARD2_BACK: javob
CARD3_FRONT: savol
CARD3_BACK: javob`

  const reply = await ai([{ role: 'user', content: prompt }], buildSystem(u, []))

  // Parse cards
  const cards = []
  for (let i = 1; i <= 3; i++) {
    const front = reply.match(new RegExp(`CARD${i}_FRONT:\\s*(.+)`, 'i'))?.[1]?.trim()
    const back = reply.match(new RegExp(`CARD${i}_BACK:\\s*(.+)`, 'i'))?.[1]?.trim()
    if (front && back) {
      const card = await Flashcard.create({ userId: u._id, subjectId, subjectName: subj?.name, front, back })
      cards.push(card)
    }
  }

  res.json({ cards })
})

// AI weekly insight
app.post('/api/chat/insight', auth, async (req, res) => {
  const u = req.u
  const subjects = await Subject.find({ userId: u._id })
  const recentChats = await Chat.find({ userId: u._id }).sort({ createdAt: -1 }).limit(50)

  const prompt = `O'quvchi ma'lumotlari asosida haftalik tahlil yoz:
Fanlar: ${JSON.stringify(subjects.map(s => ({ name: s.name, avg: s.avgGrade, weak: s.weakTopics })))}
Jami o'qish: ${u.totalStudyMinutes} daqiqa, Streak: ${u.streak} kun, Kayfiyat: ${u.avgMood}/5
So'nggi suhbatlar soni: ${recentChats.length}

JSON format qaytarma — oddiy matnda yoz:
XULOSA: (2-3 jumla)
KUCHLI: (vergul bilan)
ZAIF: (vergul bilan)
TAVSIYA: (3 ta, raqamlangan)
USLUB: (vizual/audial/kinestetik)
VAQT: (eng yaxshi o'qish vaqti)`

  const reply = await ai([{ role: 'user', content: prompt }], buildSystem(u, subjects), 1000)

  const extract = (key) => reply.match(new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 'si'))?.[1]?.trim() || ''

  const weekNum = Math.floor(Date.now() / (7 * 86400000))
  const insight = await Insight.findOneAndUpdate(
    { userId: u._id, weekNumber: weekNum },
    {
      summary: extract('XULOSA'),
      strengths: extract('KUCHLI').split(',').map(s => s.trim()).filter(Boolean),
      weaknesses: extract('ZAIF').split(',').map(s => s.trim()).filter(Boolean),
      recommendations: extract('TAVSIYA').split(/\d+\./).map(s => s.trim()).filter(Boolean),
      learningStyle: extract('USLUB'),
      bestStudyTime: extract('VAQT'),
      generatedAt: new Date(), weekNumber: weekNum
    },
    { upsert: true, new: true }
  )

  res.json(insight)
})

// AI daily plan
app.post('/api/chat/daily-plan', auth, async (req, res) => {
  const u = req.u
  const subjects = await Subject.find({ userId: u._id })

  const prompt = `Bugun uchun o'quv rejasi tuz.
Fanlar: ${subjects.map(s => `${s.emoji}${s.name}(avg:${s.avgGrade})`).join(', ')}
Streak: ${u.streak} kun. Vaqt: 2 soat.

Reja (qisqa, amaliy, raqamlangan ro'yxat):`

  const plan = await ai([{ role: 'user', content: prompt }], buildSystem(u, subjects), 400)

  // Save to schedule
  const lines = plan.split('\n').filter(l => l.trim() && /^\d/.test(l.trim()))
  const saved = []
  for (const line of lines.slice(0, 5)) {
    const s = await Schedule.create({
      userId: u._id, title: line.replace(/^\d+[\.\)]\s*/, '').trim(),
      date: todayStr(), aiGenerated: true
    })
    saved.push(s)
  }

  res.json({ plan, schedule: saved })
})

// ── FLASHCARDS ────────────────────────────────────────────────────
app.get('/api/flashcards', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.dueOnly === 'true') q.nextReview = { $lte: todayStr() }
  if (req.query.subjectId) q.subjectId = req.query.subjectId
  res.json(await Flashcard.find(q).sort({ nextReview: 1 }))
})
app.post('/api/flashcards', auth, async (req, res) => {
  const { front, back, subjectId, subjectName } = req.body
  if (!front || !back) return res.status(400).json({ error: 'front va back kerak' })
  res.json(await Flashcard.create({ userId: req.u._id, subjectId, subjectName, front, back }))
})
app.post('/api/flashcards/:id/review', auth, async (req, res) => {
  const card = await Flashcard.findOne({ _id: req.params.id, userId: req.u._id })
  if (!card) return res.status(404).json({ error: 'Topilmadi' })
  const upd = sm2(card, req.body.quality)
  Object.assign(card, upd); await card.save()
  const xp = req.body.quality >= 3 ? 5 : 2
  await giveXP(req.u._id, xp)
  res.json({ ...upd, xpEarned: xp })
})
app.delete('/api/flashcards/:id', auth, async (req, res) => {
  await Flashcard.findOneAndDelete({ _id: req.params.id, userId: req.u._id })
  res.json({ ok: true })
})

// ── SCHEDULE ──────────────────────────────────────────────────────
app.get('/api/schedule', auth, async (req, res) => {
  const date = req.query.date || todayStr()
  res.json(await Schedule.find({ userId: req.u._id, date }).sort({ time: 1 }))
})
app.post('/api/schedule', auth, async (req, res) => {
  const { title, subjectName, time, date } = req.body
  res.json(await Schedule.create({ userId: req.u._id, title, subjectName, time, date: date || todayStr() }))
})
app.patch('/api/schedule/:id', auth, async (req, res) => {
  const s = await Schedule.findOneAndUpdate({ _id: req.params.id, userId: req.u._id }, { isDone: req.body.isDone }, { new: true })
  if (req.body.isDone) await giveXP(req.u._id, 10)
  res.json(s)
})
app.delete('/api/schedule/:id', auth, async (req, res) => {
  await Schedule.findOneAndDelete({ _id: req.params.id, userId: req.u._id })
  res.json({ ok: true })
})

// ── STATS ─────────────────────────────────────────────────────────
app.get('/api/stats', auth, async (req, res) => {
  const u = req.u
  const subjects = await Subject.find({ userId: u._id })
  const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
  const todaySchedule = await Schedule.find({ userId: u._id, date: todayStr() })
  const doneTasks = todaySchedule.filter(s => s.isDone).length
  const lastInsight = await Insight.findOne({ userId: u._id }).sort({ generatedAt: -1 })

  res.json({
    xp: u.xp, level: u.level, streak: u.streak,
    totalStudyMinutes: u.totalStudyMinutes,
    avgMood: u.avgMood,
    subjects, dueCards,
    todayTasks: todaySchedule.length,
    doneTasks,
    lastInsight,
    urgentSubjects: subjects.filter(s => {
      if (!s.examDate) return false
      const d = Math.ceil((new Date(s.examDate) - new Date()) / 86400000)
      return d >= 0 && d <= 7
    })
  })
})

// ── INSIGHTS ─────────────────────────────────────────────────────
app.get('/api/insights', auth, async (req, res) => {
  res.json(await Insight.find({ userId: req.u._id }).sort({ generatedAt: -1 }).limit(4))
})

// ── PING & STATIC ────────────────────────────────────────────────
app.get('/ping', (_, res) => res.send('ok'))
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))
app.get('/app.html', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))

// ── TELEGRAM BOT ─────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN)

function appBtn() {
  return Markup.inlineKeyboard([[Markup.button.webApp('🧠 StudyMind', `${DOMAIN}/app.html`)]])
}

bot.start(async ctx => {
  const tid = String(ctx.from.id)
  let u = await User.findOne({ telegramId: tid })
  if (!u) u = await User.create({ telegramId: tid, name: ctx.from.first_name || 'O\'quvchi', telegramUsername: ctx.from.username })

  await ctx.reply(`👋 Salom, *${u.name}*!\n\n🧠 Men *StudyMind AI* — sening shaxsiy o'quv murabbiyingman.\n\nTilni tanlang:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[
      Markup.button.callback("🇺🇿 O'zbek", 'lang_uz'),
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback('🇬🇧 English', 'lang_en')
    ]])
  })
})

bot.action(/lang_(.+)/, async ctx => {
  const lang = ctx.match[1]
  await User.findOneAndUpdate({ telegramId: String(ctx.from.id) }, { lang })
  await ctx.editMessageText('✅ Saqlandi!')
  await ctx.reply(`Salom! Men bilan istalgan vaqt gaplash:\n\n• "Bugun matematikadan 85 oldim"\n• "Fizika tushunmayapman"\n• "Bugun 45 daqiqa o'qidim"\n\nYoki appni och 👇`, {
    ...Markup.keyboard([['💬 Gaplash', '📊 Statistika'], ['📅 Bugungi reja', '🌐 App']]).resize(),
  })
})

// Telegram orqali AI chat
bot.hears('💬 Gaplash', async ctx => {
  await ctx.reply('Yozing — nima bo\'ldi bugun? 🧠')
})

bot.hears('📊 Statistika', async ctx => {
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!u) return ctx.reply('/start bosing')
  const subjects = await Subject.find({ userId: u._id })
  const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
  let text = `📊 *${u.name} statistikasi*\n\n`
  text += `🔥 Streak: *${u.streak}* kun | ⭐ Lv.*${u.level}* | XP: *${u.xp}*\n`
  text += `⏱ Jami: *${u.totalStudyMinutes}* daqiqa | 🔁 Kartalar: *${dueCards}*\n\n`
  if (subjects.length) {
    text += `📚 *Fanlar:*\n`
    subjects.forEach(s => { text += `${s.emoji} ${s.name} — ${s.avgGrade ? s.avgGrade+'%' : '—'}\n` })
  }
  await ctx.reply(text, { parse_mode: 'Markdown', ...appBtn() })
})

bot.hears('📅 Bugungi reja', async ctx => {
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!u) return ctx.reply('/start bosing')
  const schedule = await Schedule.find({ userId: u._id, date: todayStr() })
  if (!schedule.length) {
    await ctx.reply('Bugun reja yo\'q. AI rejani yaratsinmi?', {
      ...Markup.inlineKeyboard([[Markup.button.callback('✅ Ha, yaratsin', 'gen_plan')]])
    })
  } else {
    let text = `📅 *Bugungi reja:*\n\n`
    schedule.forEach(s => { text += `${s.isDone ? '✅' : '⬜'} ${s.title}\n` })
    await ctx.reply(text, { parse_mode: 'Markdown', ...appBtn() })
  }
})

bot.action('gen_plan', async ctx => {
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!u) return
  await ctx.editMessageText('⏳ Reja tuzilmoqda...')
  const subjects = await Subject.find({ userId: u._id })
  const prompt = `Bugun uchun o'quv rejasi tuz. Fanlar: ${subjects.map(s => s.name).join(', ') || 'umumiy'}. Max 4 ta vazifa, qisqa.`
  const plan = await ai([{ role: 'user', content: prompt }], buildSystem(u, subjects), 300)
  const lines = plan.split('\n').filter(l => l.trim())
  for (const line of lines.slice(0, 4)) {
    await Schedule.create({ userId: u._id, title: line.replace(/^[\d\.\)\-]\s*/, '').trim(), date: todayStr(), aiGenerated: true })
  }
  await ctx.editMessageText(`✅ Reja tayyor!\n\n${plan}`)
})

bot.hears('🌐 App', async ctx => {
  await ctx.reply('📱 StudyMind:', appBtn())
})

// AI chat via Telegram
bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return
  const tid = String(ctx.from.id)
  let u = await User.findOne({ telegramId: tid })
  if (!u) return ctx.reply('/start bosing')

  await ctx.sendChatAction('typing')
  const subjects = await Subject.find({ userId: u._id })
  const history = await Chat.find({ userId: u._id, role: { $in: ['user', 'assistant'] } }).sort({ createdAt: -1 }).limit(8)
  const messages = [...history.reverse().map(m => ({ role: m.role, content: m.content })), { role: 'user', content: ctx.message.text }]

  await Chat.create({ userId: u._id, role: 'user', content: ctx.message.text })
  const rawReply = await ai(messages, buildSystem(u, subjects))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  // Save extracted data
  if (extracted.grade) {
    const subj = subjects.find(s => s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if (subj) {
      subj.gradeHistory.push({ score: extracted.grade.score, date: todayStr() })
      subj.avgGrade = Math.round(subj.gradeHistory.reduce((a, g) => a + g.score, 0) / subj.gradeHistory.length)
      await subj.save()
    }
    await giveXP(u._id, 5)
  }
  if (extracted.studyMinutes) { u.totalStudyMinutes += extracted.studyMinutes; await giveXP(u._id, Math.floor(extracted.studyMinutes * 1.5)) }

  await Chat.create({ userId: u._id, role: 'assistant', content: cleanReply, extractedData: extracted })
  await ctx.reply(cleanReply, { parse_mode: 'Markdown' })
})

// Daily reminders
setInterval(async () => {
  const hour = new Date().getHours()
  if (hour !== 8 && hour !== 21) return
  const users = await User.find({ telegramId: { $exists: true, $ne: null } })
  for (const u of users) {
    try {
      const subjects = await Subject.find({ userId: u._id })
      const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
      if (hour === 8) {
        const urgentSubjs = subjects.filter(s => {
          if (!s.examDate) return false
          const d = Math.ceil((new Date(s.examDate) - new Date()) / 86400000)
          return d >= 0 && d <= 7
        })
        let msg = `🌅 *Xayrli tong, ${u.name}!*\n\n🔥 Streak: *${u.streak}* kun | Lv.*${u.level}*`
        if (dueCards > 0) msg += `\n🔁 Bugun *${dueCards}* ta karta takrorlash kerak`
        if (urgentSubjs.length) msg += `\n⚠️ ${urgentSubjs.map(s => s.name).join(', ')} imtihoni yaqin!`
        msg += `\n\nBugun ham bitta qadamdan boshlaylik 💪`
        await bot.telegram.sendMessage(u.telegramId, msg, { parse_mode: 'Markdown' })
      }
      if (hour === 21) {
        const todaySchedule = await Schedule.find({ userId: u._id, date: todayStr() })
        const done = todaySchedule.filter(s => s.isDone).length
        let msg = `🌙 *Bugungi natijalar, ${u.name}!*\n\n`
        msg += `✅ Bajarildi: *${done}/${todaySchedule.length}*\n`
        msg += `⏱ O'qildi: *${u.totalStudyMinutes}* daqiqa jami\n`
        msg += `🔥 Streak: *${u.streak}* kun\n\nErtaga yana davom etamiz! ⭐`
        await bot.telegram.sendMessage(u.telegramId, msg, { parse_mode: 'Markdown' })
      }
    } catch {}
  }
}, 60 * 60 * 1000)

bot.launch({ dropPendingUpdates: true })
console.log('✅ Telegram bot ishga tushdi')

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server port ${PORT}`)
  console.log('🧠 StudyMind v4.0 tayyor!')
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
