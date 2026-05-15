// ================================================================
//  🧠 StudyMind v5.0 — AI-First Student Assistant
//  Yangi: Schedule (hayot+o'quv, takrorlanadigan, AI qo'shadi)
//         Flashcard (mavzu bo'yicha AI yaratadi)
//         Notes (tezda saqlash joyi)
//         Motivatsiya gaplari
//         Ovozli AI (Web Speech API)
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
  grade: String,
  school: String,
  isAdmin: { type: Boolean, default: false },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  streak: { type: Number, default: 0 },
  lastStudyDate: String,
  totalStudyMinutes: { type: Number, default: 0 },
  avgMood: { type: Number, default: 3 },
  savedQuotes: [{ text: String, author: String, savedAt: Date }],
  createdAt: { type: Date, default: Date.now }
})

const SubjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  emoji: { type: String, default: '📚' },
  color: { type: String, default: '#534AB7' },
  examDate: String,
  avgGrade: { type: Number, default: 0 },
  gradeHistory: [{ score: Number, date: String, note: String }],
  weakTopics: [String],
  progress: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,
  extractedData: {
    grade: { subjectName: String, score: Number },
    studyMinutes: Number,
    mood: Number,
    scheduleItem: { title: String, category: String, time: String, date: String, repeat: String }
  },
  createdAt: { type: Date, default: Date.now }
})

const FlashcardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  subjectName: String,
  topic: String,
  front: String,
  back: String,
  interval: { type: Number, default: 1 },
  easeFactor: { type: Number, default: 2.5 },
  nextReview: { type: String, default: () => new Date().toISOString().split('T')[0] },
  repetitions: { type: Number, default: 0 },
  aiGenerated: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

// Yangi: kengaytirilgan schedule
const ScheduleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  category: { type: String, enum: ['study', 'life'], default: 'study' }, // o'quv yoki hayot
  subjectName: String,
  time: String,
  date: String, // aniq sana
  repeat: { type: String, enum: ['none', 'daily', 'weekly', 'custom'], default: 'none' },
  repeatDays: [Number], // 0=Du, 1=Se ... 6=Ya
  isDone: { type: Boolean, default: false },
  aiGenerated: { type: Boolean, default: false },
  emoji: { type: String, default: '📌' },
  createdAt: { type: Date, default: Date.now }
})

// Yangi: notes (tezda saqlash)
const NoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  content: String,
  subjectName: String,
  color: { type: String, default: '#5b4cf5' },
  isPinned: { type: Boolean, default: false },
  tags: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
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
const Note      = mongoose.model('Note', NoteSchema)
const Insight   = mongoose.model('Insight', InsightSchema)

// ── MIDDLEWARE ─────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }))
app.use(express.static(__dirname))
app.use(session({
  secret: SECRET, resave: false, saveUninitialized: false,
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
        name: profile.displayName, email: profile.emails[0].value,
        avatar: profile.photos[0]?.value, isAdmin: profile.emails[0].value === ADMIN_EMAIL
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

// ── HELPERS ────────────────────────────────────────────────────────
function calcLevel(xp) {
  const t = [0,100,250,500,900,1400,2000,2800,3800,5000]
  for (let i = t.length - 1; i >= 0; i--) if (xp >= t[i]) return i + 1
  return 1
}

async function giveXP(userId, amount) {
  const u = await User.findById(userId)
  const prev = u.level
  u.xp += amount; u.level = calcLevel(u.xp)
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

function sm2(card, q) {
  let { easeFactor: ef, interval, repetitions: rep } = card
  if (q >= 3) {
    interval = rep === 0 ? 1 : rep === 1 ? 6 : Math.round(interval * ef)
    rep++; ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  } else { rep = 0; interval = 1 }
  return { interval, easeFactor: ef, repetitions: rep, nextReview: new Date(Date.now() + interval * 86400000).toISOString().split('T')[0] }
}

// Takrorlanadigan schedule itemlarni bugun uchun yaratish
async function ensureRepeatingSchedules(userId) {
  const today = todayStr()
  const dayOfWeek = new Date().getDay() // 0=Sun, 1=Mon...
  const uzDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // 0=Du, 6=Ya

  const templates = await Schedule.find({
    userId,
    repeat: { $in: ['daily', 'weekly', 'custom'] }
  })

  for (const tmpl of templates) {
    let shouldCreate = false
    if (tmpl.repeat === 'daily') shouldCreate = true
    if (tmpl.repeat === 'weekly' && tmpl.repeatDays?.includes(uzDay)) shouldCreate = true
    if (tmpl.repeat === 'custom' && tmpl.repeatDays?.includes(uzDay)) shouldCreate = true

    if (shouldCreate) {
      const exists = await Schedule.findOne({ userId, title: tmpl.title, date: today, repeat: 'none' })
      if (!exists) {
        await Schedule.create({
          userId, title: tmpl.title, category: tmpl.category,
          subjectName: tmpl.subjectName, time: tmpl.time,
          date: today, repeat: 'none', emoji: tmpl.emoji,
          aiGenerated: tmpl.aiGenerated
        })
      }
    }
  }
}

// ── AI ─────────────────────────────────────────────────────────────
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
    return e.name === 'AbortError' ? 'Vaqt tugadi.' : 'Xatolik: ' + e.message
  }
}

function buildSystem(user, subjects = []) {
  const lang = user?.lang || 'uz'
  const langNote = lang === 'uz' ? 'Faqat O\'zbek tilida.' : lang === 'ru' ? 'Только русский.' : 'English only.'
  const subjList = subjects.map(s => `${s.emoji}${s.name}(avg:${s.avgGrade||'?'},zaif:${s.weakTopics?.slice(0,2).join(',')||'?'})`).join(' | ')

  return `Sen StudyMind AI — ${user?.name||'o\'quvchi'}ning ota kabi mehribon, haqiqatgo'y murabbiyisan.
${langNote}
O'quvchi: ${user?.name}, ${user?.grade||''}, ${user?.school||''}
Lv.${user?.level}, XP:${user?.xp}, Streak:${user?.streak}kun
Fanlar: ${subjList||'yo\'q'}

Qoidalar:
1. Javob qisqa (max 3 paragraf), oddiy til
2. Baho aytilsa: [GRADE:FanNomi:Ball] yoz
3. Vaqt aytilsa: [STUDY:daqiqa] yoz  
4. Kun tartibi so'rasa: [SCHED:sarlavha:kategori:vaqt:takror] yoz
   Kategoriya: study yoki life
   Takror: none/daily/weekly/mon,wed,fri
5. Flashcard yarat desa: [FC:front|back] har karta uchun
6. Hech qachon to'g'ri javob berma — o'ylat
7. Bugun: ${todayStr()}`
}

function extractFromAI(text) {
  const result = {}
  const gm = text.match(/\[GRADE:([^:]+):(\d+)\]/i)
  if (gm) result.grade = { subjectName: gm[1].trim(), score: parseInt(gm[2]) }
  const sm = text.match(/\[STUDY:(\d+)\]/i)
  if (sm) result.studyMinutes = parseInt(sm[1])
  const scm = text.match(/\[SCHED:([^:]+):([^:]+):([^:]*):([^\]]*)\]/i)
  if (scm) result.scheduleItem = { title: scm[1].trim(), category: scm[2].trim(), time: scm[3].trim(), repeat: scm[4].trim() }
  const fcMatches = [...text.matchAll(/\[FC:([^|]+)\|([^\]]+)\]/gi)]
  if (fcMatches.length) result.flashcards = fcMatches.map(m => ({ front: m[1].trim(), back: m[2].trim() }))
  return result
}

function cleanText(text) {
  return text.replace(/\[GRADE:[^\]]+\]/gi, '')
    .replace(/\[STUDY:[^\]]+\]/gi, '')
    .replace(/\[SCHED:[^\]]+\]/gi, '')
    .replace(/\[FC:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}

// Motivatsiya gaplari
const QUOTES = [
  { text: "Muvaffaqiyat — har kuni kichik harakatlar yig'indisi.", author: "Robert Collier" },
  { text: "O'qish — eng kuchli qurol, dunyoni o'zgartira oladigan.", author: "Nelson Mandela" },
  { text: "Bugun qiyin bo'lsa, ertaga oson bo'ladi.", author: "Robert Schuller" },
  { text: "Hech qachon o'rganishni to'xtatma, hayot ham to'xtamaydi.", author: "Albert Einstein" },
  { text: "Maqsading yo'q bo'lsa — yo'lingni yo'qotasan.", author: "Confucius" },
  { text: "Katta natijalar kichik odatlardan boshlanadi.", author: "James Clear" },
  { text: "Yiqilish — muvaffaqiyatsizlik emas, yiqilganda qolish — muvaffaqiyatsizlik.", author: "Mary Pickford" },
  { text: "Vaqtingni boshqara olsang — hayotingni boshqara olasan.", author: "Peter Drucker" },
  { text: "Qiyin yo'llar ko'pincha eng chiroyli joylarga olib boradi.", author: "Anonymous" },
  { text: "Har bir ekspert bir vaqtlar yangi boshlovchi edi.", author: "Helen Hayes" },
  { text: "O'z vaqtida bir soat ishlash, kechikib 3 soat ishlashdan samaraliroq.", author: "Benjamin Franklin" },
  { text: "Orzulamasdan amalga oshirmayman, harakat qilmasdan esa erishmayman.", author: "Walt Disney" },
]

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
  res.json({ _id: u._id, name: u.name, email: u.email, avatar: u.avatar, lang: u.lang, grade: u.grade, school: u.school, xp: u.xp, level: u.level, streak: u.streak, totalStudyMinutes: u.totalStudyMinutes, savedQuotes: u.savedQuotes, isAdmin: u.isAdmin })
})
app.put('/api/user', auth, async (req, res) => {
  const fields = ['lang', 'grade', 'school', 'name']
  fields.forEach(f => { if (req.body[f] !== undefined) req.u[f] = req.body[f] })
  await req.u.save(); res.json({ ok: true })
})
app.post('/api/user/save-quote', auth, async (req, res) => {
  const { text, author } = req.body
  req.u.savedQuotes.push({ text, author, savedAt: new Date() })
  if (req.u.savedQuotes.length > 20) req.u.savedQuotes.shift()
  await req.u.save(); res.json({ ok: true })
})
app.get('/api/user/quotes', auth, (req, res) => {
  res.json(req.u.savedQuotes || [])
})

// ── QUOTE ────────────────────────────────────────────────────────
app.get('/api/quote', (req, res) => {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)]
  res.json(q)
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

// ── AI CHAT ────────────────────────────────────────────────────────
app.get('/api/chat', auth, async (req, res) => {
  const chats = await Chat.find({ userId: req.u._id }).sort({ createdAt: -1 }).limit(30)
  res.json(chats.reverse())
})

app.post('/api/chat', auth, async (req, res) => {
  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'message kerak' })
  const u = req.u
  const subjects = await Subject.find({ userId: u._id })

  await Chat.create({ userId: u._id, role: 'user', content: message })
  const history = await Chat.find({ userId: u._id, role: { $in: ['user', 'assistant'] } }).sort({ createdAt: -1 }).limit(12)
  const messages = history.reverse().map(m => ({ role: m.role, content: m.content }))

  const rawReply = await ai(messages, buildSystem(u, subjects))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  // Save extracted grade
  if (extracted.grade) {
    const subj = subjects.find(s => s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if (subj) {
      subj.gradeHistory.push({ score: extracted.grade.score, date: todayStr() })
      subj.avgGrade = Math.round(subj.gradeHistory.reduce((a, g) => a + g.score, 0) / subj.gradeHistory.length)
      subj.progress = subj.avgGrade; await subj.save()
    }
    await giveXP(u._id, 5)
  }

  // Save extracted study time
  if (extracted.studyMinutes) {
    u.totalStudyMinutes += extracted.studyMinutes
    await giveXP(u._id, Math.floor(extracted.studyMinutes * 1.5))
    await u.save()
  }

  // Save extracted schedule item
  let savedSchedule = null
  if (extracted.scheduleItem) {
    const si = extracted.scheduleItem
    const repeatDays = parseRepeatDays(si.repeat)
    savedSchedule = await Schedule.create({
      userId: u._id, title: si.title,
      category: si.category === 'life' ? 'life' : 'study',
      time: si.time, date: todayStr(),
      repeat: si.repeat === 'daily' ? 'daily' : repeatDays.length ? 'custom' : 'none',
      repeatDays, aiGenerated: true,
      emoji: si.category === 'life' ? '🌟' : '📚'
    })
  }

  // Save extracted flashcards
  let savedCards = []
  if (extracted.flashcards?.length) {
    for (const fc of extracted.flashcards) {
      const card = await Flashcard.create({ userId: u._id, front: fc.front, back: fc.back, aiGenerated: true })
      savedCards.push(card)
    }
  }

  await Chat.create({ userId: u._id, role: 'assistant', content: cleanReply, extractedData: extracted })
  res.json({ reply: cleanReply, extracted, savedSchedule, savedCards })
})

function parseRepeatDays(repeat) {
  if (!repeat || repeat === 'none' || repeat === 'daily') return []
  if (repeat === 'weekly') return []
  const dayMap = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6, du: 0, se: 1, ch: 2, pa: 3, ju: 4, sh: 5, ya: 6 }
  return repeat.split(',').map(d => dayMap[d.trim().toLowerCase()]).filter(d => d !== undefined)
}

// AI flashcard generation by topic
app.post('/api/chat/flashcard', auth, async (req, res) => {
  const { subjectId, topic, count = 5 } = req.body
  const subj = subjectId ? await Subject.findById(subjectId) : null
  const topicName = topic || subj?.name || 'umumiy mavzu'
  const u = req.u

  const prompt = `"${topicName}" mavzusi bo'yicha ${count} ta flashcard yarat. 
Format (faqat shu):
CARD1_FRONT: savol
CARD1_BACK: javob
...CARD${count}_FRONT: savol
CARD${count}_BACK: javob`

  const reply = await ai([{ role: 'user', content: prompt }], buildSystem(u, []), 800)

  const cards = []
  for (let i = 1; i <= count; i++) {
    const f = reply.match(new RegExp(`CARD${i}_FRONT:\\s*(.+?)(?=CARD\\d|$)`, 'si'))?.[1]?.trim().split('\n')[0]
    const b = reply.match(new RegExp(`CARD${i}_BACK:\\s*(.+?)(?=CARD\\d|$)`, 'si'))?.[1]?.trim().split('\n')[0]
    if (f && b) {
      const card = await Flashcard.create({ userId: u._id, subjectId, subjectName: subj?.name, topic: topicName, front: f, back: b, aiGenerated: true })
      cards.push(card)
    }
  }
  res.json({ cards, topic: topicName })
})

// AI daily plan
app.post('/api/chat/daily-plan', auth, async (req, res) => {
  const u = req.u
  const subjects = await Subject.find({ userId: u._id })
  const prompt = `Bugun uchun o'quv rejasi tuz. Fanlar: ${subjects.map(s => s.name).join(', ') || 'yo\'q'}. Streak: ${u.streak}kun. Max 5 ta modda. Qisqa va amaliy.`
  const plan = await ai([{ role: 'user', content: prompt }], buildSystem(u, subjects), 400)
  const lines = plan.split('\n').filter(l => l.trim() && /^[\d\-•*]/.test(l.trim()))
  const saved = []
  for (const line of lines.slice(0, 5)) {
    const s = await Schedule.create({
      userId: u._id, title: line.replace(/^[\d\.\)\-•*]\s*/, '').trim(),
      date: todayStr(), category: 'study', aiGenerated: true, emoji: '📚'
    })
    saved.push(s)
  }
  res.json({ plan, schedule: saved })
})

// AI weekly insight
app.post('/api/chat/insight', auth, async (req, res) => {
  const u = req.u
  const subjects = await Subject.find({ userId: u._id })
  const chats = await Chat.find({ userId: u._id }).sort({ createdAt: -1 }).limit(30)
  const prompt = `O'quvchi tahlili (oddiy matnda, JSON emas):
Fanlar: ${JSON.stringify(subjects.map(s => ({ n: s.name, avg: s.avgGrade })))}
O'qish: ${u.totalStudyMinutes}min, Streak: ${u.streak}, Suhbatlar: ${chats.length}

XULOSA: (2-3 jumla)
KUCHLI: (vergul bilan)
ZAIF: (vergul bilan)
TAVSIYA: (3 ta, raqamlangan)
USLUB: (bir so'z)
VAQT: (qachon yaxshi o'qiydi)`

  const reply = await ai([{ role: 'user', content: prompt }], buildSystem(u, subjects), 800)
  const ex = (k) => reply.match(new RegExp(`${k}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 'si'))?.[1]?.trim() || ''
  const weekNum = Math.floor(Date.now() / (7 * 86400000))
  const ins = await Insight.findOneAndUpdate(
    { userId: u._id, weekNumber: weekNum },
    { summary: ex('XULOSA'), strengths: ex('KUCHLI').split(',').map(s => s.trim()).filter(Boolean), weaknesses: ex('ZAIF').split(',').map(s => s.trim()).filter(Boolean), recommendations: ex('TAVSIYA').split(/\d+\./).map(s => s.trim()).filter(Boolean), learningStyle: ex('USLUB'), bestStudyTime: ex('VAQT'), generatedAt: new Date(), weekNumber: weekNum },
    { upsert: true, new: true }
  )
  res.json(ins)
})

// ── FLASHCARDS ────────────────────────────────────────────────────
app.get('/api/flashcards', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.dueOnly === 'true') q.nextReview = { $lte: todayStr() }
  if (req.query.subjectId) q.subjectId = req.query.subjectId
  if (req.query.topic) q.topic = req.query.topic
  res.json(await Flashcard.find(q).sort({ nextReview: 1 }))
})
app.post('/api/flashcards', auth, async (req, res) => {
  const { front, back, subjectId, subjectName, topic } = req.body
  if (!front || !back) return res.status(400).json({ error: 'front va back kerak' })
  res.json(await Flashcard.create({ userId: req.u._id, subjectId, subjectName, topic, front, back }))
})
app.post('/api/flashcards/:id/review', auth, async (req, res) => {
  const card = await Flashcard.findOne({ _id: req.params.id, userId: req.u._id })
  if (!card) return res.status(404).json({ error: 'Topilmadi' })
  const upd = sm2(card, req.body.quality); Object.assign(card, upd); await card.save()
  const xp = req.body.quality >= 3 ? 5 : 2; await giveXP(req.u._id, xp)
  res.json({ ...upd, xpEarned: xp })
})
app.delete('/api/flashcards/:id', auth, async (req, res) => {
  await Flashcard.findOneAndDelete({ _id: req.params.id, userId: req.u._id })
  res.json({ ok: true })
})

// ── SCHEDULE ──────────────────────────────────────────────────────
app.get('/api/schedule', auth, async (req, res) => {
  await ensureRepeatingSchedules(req.u._id)
  const date = req.query.date || todayStr()
  const category = req.query.category // 'study' | 'life' | undefined (all)
  const q = { userId: req.u._id }
  if (req.query.templates === 'true') {
    q.repeat = { $in: ['daily', 'weekly', 'custom'] }
  } else {
    q.date = date; q.repeat = 'none'
  }
  if (category) q.category = category
  res.json(await Schedule.find(q).sort({ time: 1, createdAt: 1 }))
})

app.post('/api/schedule', auth, async (req, res) => {
  const { title, category, subjectName, time, date, repeat, repeatDays, emoji } = req.body
  if (!title) return res.status(400).json({ error: 'title kerak' })
  res.json(await Schedule.create({
    userId: req.u._id, title, category: category || 'study',
    subjectName, time, date: date || todayStr(),
    repeat: repeat || 'none', repeatDays: repeatDays || [],
    emoji: emoji || (category === 'life' ? '🌟' : '📚')
  }))
})

app.patch('/api/schedule/:id', auth, async (req, res) => {
  const s = await Schedule.findOneAndUpdate({ _id: req.params.id, userId: req.u._id }, req.body, { new: true })
  if (req.body.isDone) await giveXP(req.u._id, 10)
  res.json(s)
})

app.delete('/api/schedule/:id', auth, async (req, res) => {
  await Schedule.findOneAndDelete({ _id: req.params.id, userId: req.u._id })
  res.json({ ok: true })
})

// ── NOTES ─────────────────────────────────────────────────────────
app.get('/api/notes', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.subjectName) q.subjectName = req.query.subjectName
  res.json(await Note.find(q).sort({ isPinned: -1, updatedAt: -1 }))
})
app.post('/api/notes', auth, async (req, res) => {
  const { title, content, subjectName, color, tags } = req.body
  res.json(await Note.create({ userId: req.u._id, title: title || 'Yangi eslatma', content, subjectName, color: color || '#5b4cf5', tags: tags || [] }))
})
app.put('/api/notes/:id', auth, async (req, res) => {
  const n = await Note.findOneAndUpdate({ _id: req.params.id, userId: req.u._id }, { ...req.body, updatedAt: new Date() }, { new: true })
  res.json(n)
})
app.delete('/api/notes/:id', auth, async (req, res) => {
  await Note.findOneAndDelete({ _id: req.params.id, userId: req.u._id })
  res.json({ ok: true })
})

// AI note summarize
app.post('/api/notes/summarize', auth, async (req, res) => {
  const { content, subjectName } = req.body
  if (!content) return res.status(400).json({ error: 'content kerak' })
  const prompt = `Bu konspektni xulosalab ber. Asosiy tushunchalar, formulalar va imtihon savollari. Qisqa va aniq:\n${content.slice(0, 3000)}`
  const summary = await ai([{ role: 'user', content: prompt }], buildSystem(req.u, []), 500)
  res.json({ summary })
})

// ── STATS ─────────────────────────────────────────────────────────
app.get('/api/stats', auth, async (req, res) => {
  const u = req.u
  const subjects = await Subject.find({ userId: u._id })
  const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
  await ensureRepeatingSchedules(u._id)
  const todaySchedule = await Schedule.find({ userId: u._id, date: todayStr(), repeat: 'none' })
  const done = todaySchedule.filter(s => s.isDone).length
  const weekly = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    const daySched = await Schedule.find({ userId: u._id, date: d, repeat: 'none' })
    weekly.push({ date: d, tasks: daySched.length, done: daySched.filter(s => s.isDone).length })
  }
  const lastInsight = await Insight.findOne({ userId: u._id }).sort({ generatedAt: -1 })
  const notesCount = await Note.countDocuments({ userId: u._id })
  res.json({
    xp: u.xp, level: u.level, streak: u.streak,
    totalStudyMinutes: u.totalStudyMinutes,
    subjects, dueCards,
    todayTasks: todaySchedule.length, doneTasks: done,
    weekly, lastInsight, notesCount,
    urgentSubjects: subjects.filter(s => {
      if (!s.examDate) return false
      const d = Math.ceil((new Date(s.examDate) - new Date()) / 86400000)
      return d >= 0 && d <= 7
    })
  })
})

app.get('/api/insights', auth, async (req, res) => {
  res.json(await Insight.find({ userId: req.u._id }).sort({ generatedAt: -1 }).limit(4))
})

// ── PING & STATIC ─────────────────────────────────────────────────
app.get('/ping', (_, res) => res.send('ok'))
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))
app.get('/app.html', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))

// ── TELEGRAM BOT ──────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN)

function appBtn() {
  return Markup.inlineKeyboard([[Markup.button.webApp('🧠 StudyMind', `${DOMAIN}/app.html`)]])
}

bot.start(async ctx => {
  const tid = String(ctx.from.id)
  let u = await User.findOne({ telegramId: tid })
  if (!u) u = await User.create({ telegramId: tid, name: ctx.from.first_name || 'O\'quvchi', telegramUsername: ctx.from.username })
  await ctx.reply(`👋 Salom, *${u.name}*!\n\n🧠 Men *StudyMind AI* — murabbiyingman.\n\nTilni tanlang:`, {
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
  await ctx.reply('Tayyor! Istalgan vaqt yozing yoki appni oching 👇', {
    ...Markup.keyboard([['📊 Statistika', '📅 Bugungi reja'], ['🧠 AI bilan gaplash', '🌐 App']]).resize()
  })
})

bot.hears('📊 Statistika', async ctx => {
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!u) return ctx.reply('/start bosing')
  const subjects = await Subject.find({ userId: u._id })
  const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
  let text = `📊 *${u.name}*\n\n🔥 Streak: *${u.streak}* kun | Lv.*${u.level}*\n⭐ XP: *${u.xp}*\n🔁 Kartalar: *${dueCards}*\n\n`
  if (subjects.length) text += subjects.map(s => `${s.emoji} ${s.name}: *${s.avgGrade||'—'}*`).join('\n')
  await ctx.reply(text, { parse_mode: 'Markdown', ...appBtn() })
})

bot.hears('📅 Bugungi reja', async ctx => {
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!u) return ctx.reply('/start bosing')
  await ensureRepeatingSchedules(u._id)
  const schedule = await Schedule.find({ userId: u._id, date: todayStr(), repeat: 'none' })
  if (!schedule.length) return ctx.reply('Reja yo\'q. Yaratsinmi?', { ...Markup.inlineKeyboard([[Markup.button.callback('✅ Ha', 'gen_plan')]]) })
  const text = `📅 *Bugungi reja:*\n\n${schedule.map(s => `${s.isDone ? '✅' : '⬜'} ${s.emoji||''} ${s.title}`).join('\n')}`
  await ctx.reply(text, { parse_mode: 'Markdown', ...appBtn() })
})

bot.action('gen_plan', async ctx => {
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!u) return
  await ctx.editMessageText('⏳ Reja tuzilmoqda...')
  const subjects = await Subject.find({ userId: u._id })
  const prompt = `Bugun uchun o'quv rejasi. Fanlar: ${subjects.map(s => s.name).join(', ') || 'yo\'q'}. Max 4 ta modda.`
  const plan = await ai([{ role: 'user', content: prompt }], buildSystem(u, subjects), 300)
  const lines = plan.split('\n').filter(l => l.trim())
  for (const line of lines.slice(0, 4)) {
    await Schedule.create({ userId: u._id, title: line.replace(/^[\d\.\)\-•*]\s*/, '').trim(), date: todayStr(), category: 'study', aiGenerated: true })
  }
  await ctx.editMessageText(`✅ Reja tayyor!\n\n${plan}`)
})

bot.hears('🧠 AI bilan gaplash', async ctx => {
  await ctx.reply('Yozing — nima bo\'ldi? 🧠')
})

bot.hears('🌐 App', async ctx => {
  await ctx.reply('📱 StudyMind:', appBtn())
})

bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return
  const tid = String(ctx.from.id)
  let u = await User.findOne({ telegramId: tid })
  if (!u) return ctx.reply('/start bosing')
  await ctx.sendChatAction('typing')
  const subjects = await Subject.find({ userId: u._id })
  const history = await Chat.find({ userId: u._id }).sort({ createdAt: -1 }).limit(8)
  const messages = [...history.reverse().map(m => ({ role: m.role, content: m.content })), { role: 'user', content: ctx.message.text }]
  await Chat.create({ userId: u._id, role: 'user', content: ctx.message.text })
  const rawReply = await ai(messages, buildSystem(u, subjects))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)
  if (extracted.grade) {
    const subj = subjects.find(s => s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if (subj) { subj.gradeHistory.push({ score: extracted.grade.score, date: todayStr() }); subj.avgGrade = Math.round(subj.gradeHistory.reduce((a, g) => a + g.score, 0) / subj.gradeHistory.length); await subj.save() }
  }
  if (extracted.studyMinutes) { u.totalStudyMinutes += extracted.studyMinutes; await giveXP(u._id, Math.floor(extracted.studyMinutes * 1.5)) }
  await Chat.create({ userId: u._id, role: 'assistant', content: cleanReply })
  await ctx.reply(cleanReply)
})

// Daily reminders
setInterval(async () => {
  const hour = new Date().getHours()
  if (hour !== 8 && hour !== 21) return
  const users = await User.find({ telegramId: { $exists: true, $ne: null } })
  for (const u of users) {
    try {
      const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
      if (hour === 8) {
        const q = QUOTES[Math.floor(Math.random() * QUOTES.length)]
        await bot.telegram.sendMessage(u.telegramId, `🌅 *Xayrli tong, ${u.name}!*\n\n🔥 Streak: *${u.streak}* kun | Lv.*${u.level}*\n${dueCards > 0 ? `🔁 Bugun *${dueCards}* ta karta\n` : ''}💬 _"${q.text}"_\n— ${q.author}`, { parse_mode: 'Markdown' })
      }
      if (hour === 21) {
        await bot.telegram.sendMessage(u.telegramId, `🌙 *Bugungi natijalar, ${u.name}!*\n\n⏱ Jami: *${u.totalStudyMinutes}* daqiqa\n🔥 Streak: *${u.streak}* kun\n\nErtaga ham davom! ⭐`, { parse_mode: 'Markdown' })
      }
    } catch {}
  }
}, 60 * 60 * 1000)

bot.launch({ dropPendingUpdates: true })
console.log('✅ Telegram bot ishga tushdi')

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server port ${PORT}`)
  console.log('🧠 StudyMind v5.0 tayyor!')
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
