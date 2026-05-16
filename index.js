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
const MONGO_URI = process.env.MONGO_URI
const BOT_TOKEN = process.env.BOT_TOKEN
const GROQ_KEY = process.env.GROQ_API_KEY
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`
const SECRET = process.env.SESSION_SECRET || 'studymind-2025'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''

if (!MONGO_URI || !BOT_TOKEN || !GROQ_KEY) { console.error('ENV kerak!'); process.exit(1) }
await mongoose.connect(MONGO_URI)
console.log('MongoDB ulandi')

const UserSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, sparse: true }, avatar: String,
  telegramId: { type: String, unique: true, sparse: true }, telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  grade: String, school: String, isAdmin: { type: Boolean, default: false },
  xp: { type: Number, default: 0 }, level: { type: Number, default: 1 },
  streak: { type: Number, default: 0 }, lastStudyDate: String,
  totalStudyMinutes: { type: Number, default: 0 },
  savedQuotes: [{ text: String, author: String, savedAt: Date }],
  createdAt: { type: Date, default: Date.now }
})

const SubjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String, emoji: { type: String, default: '📚' }, color: { type: String, default: '#534AB7' },
  examDate: String, avgGrade: { type: Number, default: 0 },
  gradeHistory: [{ score: Number, date: String, note: String }],
  weakTopics: [String], progress: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant'] }, content: String,
  extractedData: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
})

const FlashcardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId, subjectName: String, topic: String,
  front: String, back: String,
  interval: { type: Number, default: 1 }, easeFactor: { type: Number, default: 2.5 },
  nextReview: { type: String, default: () => new Date().toISOString().split('T')[0] },
  repetitions: { type: Number, default: 0 }, aiGenerated: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

const ScheduleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String, category: { type: String, enum: ['study', 'life'], default: 'study' },
  subjectName: String, time: String, date: String,
  repeat: { type: String, enum: ['none', 'daily', 'weekly', 'custom'], default: 'none' },
  repeatDays: [Number], isDone: { type: Boolean, default: false },
  aiGenerated: { type: Boolean, default: false }, emoji: { type: String, default: '📌' },
  createdAt: { type: Date, default: Date.now }
})

const NoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String, content: String, subjectName: String,
  color: { type: String, default: '#5b4cf5' }, isPinned: { type: Boolean, default: false },
  tags: [String], createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
})

const InsightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekNumber: Number, summary: String, strengths: [String], weaknesses: [String],
  recommendations: [String], learningStyle: String, bestStudyTime: String,
  generatedAt: { type: Date, default: Date.now }
})

const User = mongoose.model('User', UserSchema)
const Subject = mongoose.model('Subject', SubjectSchema)
const Chat = mongoose.model('Chat', ChatSchema)
const Flashcard = mongoose.model('Flashcard', FlashcardSchema)
const Schedule = mongoose.model('Schedule', ScheduleSchema)
const Note = mongoose.model('Note', NoteSchema)
const Insight = mongoose.model('Insight', InsightSchema)

app.use(express.json({ limit: '5mb' }))
app.use(express.static(__dirname))
app.use(session({ secret: SECRET, resave: false, saveUninitialized: false, store: MongoStore.create({ mongoUrl: MONGO_URI }), cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } }))
app.use(passport.initialize())
app.use(passport.session())
passport.serializeUser((u, done) => done(null, u._id))
passport.deserializeUser(async (id, done) => { try { done(null, await User.findById(id)) } catch (e) { done(e) } })

if (GOOGLE_ID && GOOGLE_SECRET) {
  passport.use(new GoogleStrategy({ clientID: GOOGLE_ID, clientSecret: GOOGLE_SECRET, callbackURL: `${DOMAIN}/auth/google/callback` }, async (at, rt, profile, done) => {
    try {
      let u = await User.findOne({ email: profile.emails[0].value })
      if (!u) u = await User.create({ name: profile.displayName, email: profile.emails[0].value, avatar: profile.photos[0]?.value, isAdmin: profile.emails[0].value === ADMIN_EMAIL })
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
  getUser(req).then(u => { if (!u) return res.status(401).json({ error: 'Unauthorized' }); req.u = u; next() }).catch(() => res.status(401).json({ error: 'Unauthorized' }))
}

function calcLevel(xp) { const t = [0, 100, 250, 500, 900, 1400, 2000, 2800, 3800, 5000]; for (let i = t.length - 1; i >= 0; i--) if (xp >= t[i]) return i + 1; return 1 }
function todayStr() { return new Date().toISOString().split('T')[0] }

async function giveXP(userId, amount) {
  const u = await User.findById(userId)
  const prev = u.level; u.xp += amount; u.level = calcLevel(u.xp)
  const today = todayStr(), yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (u.lastStudyDate !== today) { u.streak = u.lastStudyDate === yesterday ? u.streak + 1 : 1; u.lastStudyDate = today }
  await u.save(); return { user: u, leveledUp: u.level > prev }
}

function sm2(card, q) {
  let { easeFactor: ef, interval, repetitions: rep } = card
  if (q >= 3) { interval = rep === 0 ? 1 : rep === 1 ? 6 : Math.round(interval * ef); rep++; ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)) } else { rep = 0; interval = 1 }
  return { interval, easeFactor: ef, repetitions: rep, nextReview: new Date(Date.now() + interval * 86400000).toISOString().split('T')[0] }
}

async function ensureRepeating(userId) {
  const today = todayStr()
  const uzDay = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
  const templates = await Schedule.find({ userId, repeat: { $in: ['daily', 'custom'] } })
  for (const t of templates) {
    let should = t.repeat === 'daily' || (t.repeat === 'custom' && t.repeatDays?.includes(uzDay))
    if (should) {
      const exists = await Schedule.findOne({ userId, title: t.title, date: today, repeat: 'none' })
      if (!exists) await Schedule.create({ userId, title: t.title, category: t.category, subjectName: t.subjectName, time: t.time, date: today, repeat: 'none', emoji: t.emoji, aiGenerated: t.aiGenerated })
    }
  }
}

const groq = new Groq({ apiKey: GROQ_KEY })

async function ai(messages, system, maxTokens = 600) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }, { signal: ctrl.signal })
    clearTimeout(timer); return r.choices[0]?.message?.content || ''
  } catch (e) { clearTimeout(timer); return e.name === 'AbortError' ? 'Vaqt tugadi.' : 'Xatolik: ' + e.message }
}

function buildSystem(user, subjects = []) {
  const lang = user?.lang || 'uz'
  const langNote = lang === 'uz' ? 'FAQAT o\'zbek tilida yoz. Boshqa til MUMKIN EMAS.' : lang === 'ru' ? 'Пиши ТОЛЬКО на русском. Другие языки ЗАПРЕЩЕНЫ.' : 'Write ONLY in English. No other language.'
  const subjList = subjects.map(s => `${s.emoji}${s.name}(avg:${s.avgGrade || '?'},zaif:${s.weakTopics?.slice(0, 2).join(',') || '?'})`).join(' | ')
  return `Sen StudyMind AI. Halol, qattiq, real murabbiy. Ota kabi — yaxshilikni ham, kamchilikni ham to'g'ri aytasan.

${langNote}

O'quvchi: ${user?.name || '?'}, ${user?.grade || ''}, ${user?.school || ''}
Lv.${user?.level}, Streak:${user?.streak}kun, XP:${user?.xp}
Fanlar: ${subjList || 'fan qo\'shilmagan'}

QOIDALAR:
1. MAX 3 qisqa gap. Keraksiz so'z yo'q.
2. "Zo'r!", "Ajoyib!" — YO'Q. Bo'sh maqtov YO'Q.
3. Kamchilik bo'lsa — to'g'ridan ayt, yechim ber.
4. Baho aytilsa: [GRADE:FanNomi:Ball]
5. O'qish vaqti aytilsa: [STUDY:daqiqa]
6. Reja so'rasa: [SCHED:sarlavha:study/life:vaqt:none/daily/mon-fri]
7. Karta so'rasa: [FC:savol|javob]
8. Savol bo'lsa avval o'ylat, keyin javob.
9. Bugun: ${todayStr()}`
}

function extractFromAI(text) {
  const r = {}
  const gm = text.match(/\[GRADE:([^:]+):(\d+)\]/i)
  if (gm) r.grade = { subjectName: gm[1].trim(), score: parseInt(gm[2]) }
  const sm = text.match(/\[STUDY:(\d+)\]/i)
  if (sm) r.studyMinutes = parseInt(sm[1])
  const scm = text.match(/\[SCHED:([^:]+):([^:]+):([^:]*):([^\]]*)\]/i)
  if (scm) r.scheduleItem = { title: scm[1].trim(), category: scm[2].trim(), time: scm[3].trim(), repeat: scm[4].trim() }
  const fcs = [...text.matchAll(/\[FC:([^|]+)\|([^\]]+)\]/gi)]
  if (fcs.length) r.flashcards = fcs.map(m => ({ front: m[1].trim(), back: m[2].trim() }))
  return r
}

function cleanText(t) {
  return t.replace(/\[GRADE:[^\]]+\]/gi, '').replace(/\[STUDY:[^\]]+\]/gi, '').replace(/\[SCHED:[^\]]+\]/gi, '').replace(/\[FC:[^\]]+\]/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}

function parseRepeatDays(r) {
  if (!r || r === 'none' || r === 'daily') return []
  const m = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6, du: 0, se: 1, ch: 2, pa: 3, ju: 4, sh: 5, ya: 6 }
  return r.split(/[-,]/).map(d => m[d.trim().toLowerCase()]).filter(d => d !== undefined)
}

const QUOTES = {
  uz: [
    { text: "Muvaffaqiyat — har kuni kichik harakatlar yig'indisi.", author: "Robert Collier" },
    { text: "O'qish — eng kuchli qurol, dunyoni o'zgartira oladigan.", author: "Nelson Mandela" },
    { text: "Katta natijalar kichik odatlardan boshlanadi.", author: "James Clear" },
    { text: "Yiqilish muvaffaqiyatsizlik emas — qolish muvaffaqiyatsizlik.", author: "Mary Pickford" },
    { text: "Har bir ekspert bir vaqtlar yangi boshlovchi edi.", author: "Helen Hayes" },
    { text: "Bugun qilgan ish ertangi o'zingni shakllantiradi.", author: "Anonymous" },
  ],
  ru: [
    { text: "Успех — это сумма небольших усилий каждого дня.", author: "Robert Collier" },
    { text: "Образование — самое мощное оружие.", author: "Nelson Mandela" },
    { text: "Большие результаты начинаются с маленьких привычек.", author: "James Clear" },
    { text: "Падение — не неудача. Остаться лежать — неудача.", author: "Mary Pickford" },
  ],
  en: [
    { text: "Success is the sum of small efforts repeated daily.", author: "Robert Collier" },
    { text: "Education is the most powerful weapon.", author: "Nelson Mandela" },
    { text: "Big results come from small daily habits.", author: "James Clear" },
    { text: "Falling is not failure. Staying down is failure.", author: "Mary Pickford" },
  ]
}

app.get('/auth/google', (req, res, next) => { if (!GOOGLE_ID) return res.redirect('/?error=no_google'); passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next) })
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?error=google' }), (req, res) => res.redirect('/app.html'))
app.post('/auth/telegram', async (req, res) => {
  const { telegramId, name, username } = req.body
  try { let u = await User.findOne({ telegramId: String(telegramId) }); if (!u) u = await User.create({ telegramId: String(telegramId), name, telegramUsername: username }); req.session.tid = u._id; res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }) })

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
  req.u.savedQuotes = req.u.savedQuotes || []
  req.u.savedQuotes.push({ text, author, savedAt: new Date() })
  if (req.u.savedQuotes.length > 30) req.u.savedQuotes.shift()
  await req.u.save(); res.json({ ok: true })
})

app.get('/api/quote', auth, (req, res) => {
  const lang = req.u?.lang || 'uz'
  const list = QUOTES[lang] || QUOTES.uz
  res.json(list[Math.floor(Math.random() * list.length)])
})

app.get('/api/subjects', auth, async (req, res) => res.json(await Subject.find({ userId: req.u._id }).sort({ createdAt: 1 })))
app.post('/api/subjects', auth, async (req, res) => {
  const { name, emoji, color, examDate } = req.body
  if (!name) return res.status(400).json({ error: 'name kerak' })
  res.json(await Subject.create({ userId: req.u._id, name, emoji: emoji || '📚', color: color || '#534AB7', examDate }))
})
app.delete('/api/subjects/:id', auth, async (req, res) => { await Subject.findOneAndDelete({ _id: req.params.id, userId: req.u._id }); res.json({ ok: true }) })

app.get('/api/chat', auth, async (req, res) => res.json((await Chat.find({ userId: req.u._id }).sort({ createdAt: -1 }).limit(30)).reverse()))

app.post('/api/chat', auth, async (req, res) => {
  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'message kerak' })
  const u = req.u, subjects = await Subject.find({ userId: u._id })
  await Chat.create({ userId: u._id, role: 'user', content: message })
  const history = await Chat.find({ userId: u._id, role: { $in: ['user', 'assistant'] } }).sort({ createdAt: -1 }).limit(12)
  const messages = history.reverse().map(m => ({ role: m.role, content: m.content }))
  const rawReply = await ai(messages, buildSystem(u, subjects))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  if (extracted.grade) {
    const subj = subjects.find(s => s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if (subj) { subj.gradeHistory.push({ score: extracted.grade.score, date: todayStr() }); subj.avgGrade = Math.round(subj.gradeHistory.reduce((a, g) => a + g.score, 0) / subj.gradeHistory.length); subj.progress = subj.avgGrade; await subj.save() }
    await giveXP(u._id, 5)
  }
  if (extracted.studyMinutes) { u.totalStudyMinutes += extracted.studyMinutes; await giveXP(u._id, Math.floor(extracted.studyMinutes * 1.5)); await u.save() }

  let savedSchedule = null
  if (extracted.scheduleItem) {
    const si = extracted.scheduleItem
    const repeatDays = parseRepeatDays(si.repeat)
    savedSchedule = await Schedule.create({ userId: u._id, title: si.title, category: si.category === 'life' ? 'life' : 'study', time: si.time, date: todayStr(), repeat: si.repeat === 'daily' ? 'daily' : repeatDays.length ? 'custom' : 'none', repeatDays, aiGenerated: true, emoji: si.category === 'life' ? '🌟' : '📚' })
  }

  let savedCards = []
  if (extracted.flashcards?.length) {
    for (const fc of extracted.flashcards) { const c = await Flashcard.create({ userId: u._id, front: fc.front, back: fc.back, aiGenerated: true }); savedCards.push(c) }
  }

  await Chat.create({ userId: u._id, role: 'assistant', content: cleanReply, extractedData: extracted })
  res.json({ reply: cleanReply, extracted, savedSchedule, savedCards })
})

app.post('/api/chat/flashcard', auth, async (req, res) => {
  const { subjectId, topic, count = 5 } = req.body
  const subj = subjectId ? await Subject.findById(subjectId) : null
  const topicName = topic || subj?.name || 'umumiy'
  const u = req.u
  const prompt = `"${topicName}" mavzusi bo'yicha ${count} ta flashcard yarat. Format:\nCARD1_FRONT: savol\nCARD1_BACK: javob\n...`
  const reply = await ai([{ role: 'user', content: prompt }], buildSystem(u, []), 900)
  const cards = []
  for (let i = 1; i <= count; i++) {
    const f = reply.match(new RegExp(`CARD${i}_FRONT:\\s*(.+?)(?=CARD\\d_FRONT:|$)`, 'si'))?.[1]?.trim().split('\n')[0]
    const b = reply.match(new RegExp(`CARD${i}_BACK:\\s*(.+?)(?=CARD\\d_FRONT:|$)`, 'si'))?.[1]?.trim().split('\n')[0]
    if (f && b) { const c = await Flashcard.create({ userId: u._id, subjectId, subjectName: subj?.name, topic: topicName, front: f, back: b, aiGenerated: true }); cards.push(c) }
  }
  res.json({ cards, topic: topicName })
})

app.post('/api/chat/daily-plan', auth, async (req, res) => {
  const u = req.u, subjects = await Subject.find({ userId: u._id })
  const { topic } = req.body
  const topicLine = topic ? `Mavzu: "${topic}".` : `Fanlar: ${subjects.map(s => s.name).join(', ') || 'yo\'q'}.`
  const prompt = `Bugungi o'quv rejasi. ${topicLine} Max 5 ta modda. Qisqa, raqamlangan.`
  const plan = await ai([{ role: 'user', content: prompt }], buildSystem(u, subjects), 400)
  const lines = plan.split('\n').filter(l => l.trim() && /^[\d\-•*]/.test(l.trim()))
  const saved = []
  for (const line of lines.slice(0, 5)) {
    const s = await Schedule.create({ userId: u._id, title: line.replace(/^[\d\.\)\-•*]\s*/, '').trim(), date: todayStr(), category: 'study', aiGenerated: true, emoji: '📚' })
    saved.push(s)
  }
  res.json({ plan, schedule: saved })
})

app.post('/api/chat/insight', auth, async (req, res) => {
  const u = req.u, subjects = await Subject.find({ userId: u._id })
  const lang = u.lang || 'uz'
  const langNote = lang === 'uz' ? 'FAQAT o\'zbek tilida.' : lang === 'ru' ? 'ТОЛЬКО русский.' : 'ONLY English.'
  const prompt = `O'quvchi tahlili. ${langNote}
Fanlar: ${JSON.stringify(subjects.map(s => ({ n: s.name, avg: s.avgGrade, zaif: s.weakTopics })))}
O'qish: ${u.totalStudyMinutes}min, Streak: ${u.streak}kun

XULOSA: (2 gap - nima yaxshi, nima yomon)
KUCHLI: (vergul bilan)
ZAIF: (vergul bilan)
TAVSIYA: (3 ta, raqamlangan)
USLUB: (bir so'z)
VAQT: (qachon samarali)`
  const reply = await ai([{ role: 'user', content: prompt }], `Halol tahlilchi. ${langNote}`, 800)
  const ex = (k) => reply.match(new RegExp(`${k}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 'si'))?.[1]?.trim() || ''
  const weekNum = Math.floor(Date.now() / (7 * 86400000))
  const ins = await Insight.findOneAndUpdate({ userId: u._id, weekNumber: weekNum }, { summary: ex('XULOSA'), strengths: ex('KUCHLI').split(',').map(s => s.trim()).filter(Boolean), weaknesses: ex('ZAIF').split(',').map(s => s.trim()).filter(Boolean), recommendations: ex('TAVSIYA').split(/\d+\./).map(s => s.trim()).filter(Boolean), learningStyle: ex('USLUB'), bestStudyTime: ex('VAQT'), generatedAt: new Date(), weekNumber: weekNum }, { upsert: true, new: true })
  res.json(ins)
})

app.get('/api/flashcards', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.dueOnly === 'true') q.nextReview = { $lte: todayStr() }
  if (req.query.subjectId) q.subjectId = req.query.subjectId
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
app.delete('/api/flashcards/:id', auth, async (req, res) => { await Flashcard.findOneAndDelete({ _id: req.params.id, userId: req.u._id }); res.json({ ok: true }) })

app.get('/api/schedule', auth, async (req, res) => {
  await ensureRepeating(req.u._id)
  const q = { userId: req.u._id }
  if (req.query.templates === 'true') q.repeat = { $in: ['daily', 'custom'] }
  else { q.date = req.query.date || todayStr(); q.repeat = 'none' }
  if (req.query.category) q.category = req.query.category
  res.json(await Schedule.find(q).sort({ time: 1, createdAt: 1 }))
})
app.post('/api/schedule', auth, async (req, res) => {
  const { title, category, subjectName, time, date, repeat, repeatDays, emoji } = req.body
  if (!title) return res.status(400).json({ error: 'title kerak' })
  res.json(await Schedule.create({ userId: req.u._id, title, category: category || 'study', subjectName, time, date: date || todayStr(), repeat: repeat || 'none', repeatDays: repeatDays || [], emoji: emoji || (category === 'life' ? '🌟' : '📌') }))
})
app.patch('/api/schedule/:id', auth, async (req, res) => {
  const s = await Schedule.findOneAndUpdate({ _id: req.params.id, userId: req.u._id }, req.body, { new: true })
  if (req.body.isDone) await giveXP(req.u._id, 10)
  res.json(s)
})
app.delete('/api/schedule/:id', auth, async (req, res) => { await Schedule.findOneAndDelete({ _id: req.params.id, userId: req.u._id }); res.json({ ok: true }) })

app.get('/api/notes', auth, async (req, res) => res.json(await Note.find({ userId: req.u._id }).sort({ isPinned: -1, updatedAt: -1 })))
app.post('/api/notes', auth, async (req, res) => {
  const { title, content, subjectName, color, tags } = req.body
  res.json(await Note.create({ userId: req.u._id, title: title || 'Yangi eslatma', content, subjectName, color: color || '#5b4cf5', tags: tags || [] }))
})
app.put('/api/notes/:id', auth, async (req, res) => res.json(await Note.findOneAndUpdate({ _id: req.params.id, userId: req.u._id }, { ...req.body, updatedAt: new Date() }, { new: true })))
app.delete('/api/notes/:id', auth, async (req, res) => { await Note.findOneAndDelete({ _id: req.params.id, userId: req.u._id }); res.json({ ok: true }) })
app.post('/api/notes/summarize', auth, async (req, res) => {
  const { content } = req.body
  if (!content) return res.status(400).json({ error: 'content kerak' })
  const prompt = `Bu konspektni xulosalab ber. Asosiy tushunchalar, formulalar, imtihon savollari. Qisqa:\n${content.slice(0, 3000)}`
  res.json({ summary: await ai([{ role: 'user', content: prompt }], buildSystem(req.u, []), 500) })
})

app.get('/api/stats', auth, async (req, res) => {
  const u = req.u, subjects = await Subject.find({ userId: u._id })
  const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
  await ensureRepeating(u._id)
  const todaySched = await Schedule.find({ userId: u._id, date: todayStr(), repeat: 'none' })
  const weekly = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    const ds = await Schedule.find({ userId: u._id, date: d, repeat: 'none' })
    weekly.push({ date: d, tasks: ds.length, done: ds.filter(s => s.isDone).length })
  }
  const lastInsight = await Insight.findOne({ userId: u._id }).sort({ generatedAt: -1 })
  res.json({ xp: u.xp, level: u.level, streak: u.streak, totalStudyMinutes: u.totalStudyMinutes, subjects, dueCards, todayTasks: todaySched.length, doneTasks: todaySched.filter(s => s.isDone).length, weekly, lastInsight, urgentSubjects: subjects.filter(s => { if (!s.examDate) return false; const d = Math.ceil((new Date(s.examDate) - new Date()) / 86400000); return d >= 0 && d <= 7 }) })
})

app.get('/api/insights', auth, async (req, res) => res.json(await Insight.find({ userId: req.u._id }).sort({ generatedAt: -1 }).limit(4)))

app.get('/ping', (_, res) => res.send('ok'))
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))
app.get('/app.html', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))

const bot = new Telegraf(BOT_TOKEN)
function appBtn() { return Markup.inlineKeyboard([[Markup.button.webApp('🧠 StudyMind', `${DOMAIN}/app.html`)]]) }

const BOT_TEXT = {
  uz: { start: n => `👋 Salom, *${n}*!\n\n🧠 Men *StudyMind AI* — halol murabbiyingman.\n\nTilni tanlang:`, ok: '✅ Saqlandi!', ready: 'Tayyor! Istalgan vaqt yozing yoki appni oching 👇' },
  ru: { start: n => `👋 Привет, *${n}*!\n\n🧠 Я *StudyMind AI* — честный наставник.\n\nВыберите язык:`, ok: '✅ Сохранено!', ready: 'Готово! Пишите или откройте приложение 👇' },
  en: { start: n => `👋 Hello, *${n}*!\n\n🧠 I'm *StudyMind AI* — your honest coach.\n\nChoose language:`, ok: '✅ Saved!', ready: 'Ready! Write anytime or open the app 👇' }
}

bot.start(async ctx => {
  const tid = String(ctx.from.id)
  let u = await User.findOne({ telegramId: tid })
  if (!u) u = await User.create({ telegramId: tid, name: ctx.from.first_name || 'O\'quvchi', telegramUsername: ctx.from.username })
  const txt = (BOT_TEXT[u.lang || 'uz'] || BOT_TEXT.uz).start(u.name)
  await ctx.reply(txt, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback("🇺🇿 O'zbek", 'lang_uz'), Markup.button.callback('🇷🇺 Русский', 'lang_ru'), Markup.button.callback('🇬🇧 English', 'lang_en')]]) })
})

bot.action(/lang_(.+)/, async ctx => {
  const lang = ctx.match[1]
  await User.findOneAndUpdate({ telegramId: String(ctx.from.id) }, { lang })
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  const t = (BOT_TEXT[lang] || BOT_TEXT.uz)
  await ctx.editMessageText(t.ok)
  await ctx.reply(t.ready, { ...Markup.keyboard([['📊 Stats', '📅 Reja'], ['🧠 AI', '🌐 App']]).resize() })
})

bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return
  const tid = String(ctx.from.id)
  const u = await User.findOne({ telegramId: tid })
  if (!u) return ctx.reply('/start bosing')
  if (ctx.message.text === '🌐 App') { await ctx.reply('📱 StudyMind:', appBtn()); return }
  if (['📊 Stats', '📊 Статистика', '📊 Statistics'].includes(ctx.message.text)) {
    const subjects = await Subject.find({ userId: u._id })
    const due = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
    await ctx.reply(`📊 *${u.name}*\n\n🔥 ${u.streak} kun | Lv.${u.level} | ${u.xp}xp\n🔁 ${due} karta\n\n${subjects.map(s => `${s.emoji}${s.name}: *${s.avgGrade || '—'}*`).join('\n')}`, { parse_mode: 'Markdown', ...appBtn() })
    return
  }
  if (['📅 Reja', '📅 Plan'].includes(ctx.message.text)) {
    await ensureRepeating(u._id)
    const sched = await Schedule.find({ userId: u._id, date: todayStr(), repeat: 'none' })
    if (!sched.length) { await ctx.reply('Reja yo\'q', { ...Markup.inlineKeyboard([[Markup.button.callback('✅ AI reja tuz', 'gen_plan')]]) }); return }
    await ctx.reply('📅 *Bugungi reja:*\n\n' + sched.map(s => `${s.isDone ? '✅' : '⬜'} ${s.emoji || ''} ${s.title}`).join('\n'), { parse_mode: 'Markdown', ...appBtn() })
    return
  }

  await ctx.sendChatAction('typing')
  const subjects = await Subject.find({ userId: u._id })
  const history = await Chat.find({ userId: u._id }).sort({ createdAt: -1 }).limit(8)
  const messages = [...history.reverse().map(m => ({ role: m.role, content: m.content })), { role: 'user', content: ctx.message.text }]
  await Chat.create({ userId: u._id, role: 'user', content: ctx.message.text })
  const rawReply = await ai(messages, buildSystem(u, subjects))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)
  if (extracted.grade) { const subj = subjects.find(s => s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase())); if (subj) { subj.gradeHistory.push({ score: extracted.grade.score, date: todayStr() }); subj.avgGrade = Math.round(subj.gradeHistory.reduce((a, g) => a + g.score, 0) / subj.gradeHistory.length); await subj.save() } }
  if (extracted.studyMinutes) { u.totalStudyMinutes += extracted.studyMinutes; await giveXP(u._id, Math.floor(extracted.studyMinutes * 1.5)) }
  if (extracted.scheduleItem) { const si = extracted.scheduleItem; await Schedule.create({ userId: u._id, title: si.title, category: si.category === 'life' ? 'life' : 'study', date: todayStr(), repeat: si.repeat === 'daily' ? 'daily' : 'none', aiGenerated: true }) }
  await Chat.create({ userId: u._id, role: 'assistant', content: cleanReply })
  await ctx.reply(cleanReply)
})

bot.action('gen_plan', async ctx => {
  const u = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!u) return
  await ctx.editMessageText('⏳ Reja tuzilmoqda...')
  const subjects = await Subject.find({ userId: u._id })
  const plan = await ai([{ role: 'user', content: `Bugungi o'quv rejasi. Fanlar: ${subjects.map(s => s.name).join(', ') || 'yo\'q'}. Max 4 ta.` }], buildSystem(u, subjects), 300)
  const lines = plan.split('\n').filter(l => l.trim())
  for (const line of lines.slice(0, 4)) await Schedule.create({ userId: u._id, title: line.replace(/^[\d\.\)\-•*]\s*/, '').trim(), date: todayStr(), category: 'study', aiGenerated: true })
  await ctx.editMessageText(`✅ Reja tayyor!\n\n${plan}`)
})

setInterval(async () => {
  const hour = new Date().getHours()
  if (hour !== 8 && hour !== 21) return
  const users = await User.find({ telegramId: { $exists: true, $ne: null } })
  for (const u of users) {
    try {
      const due = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
      const ql = QUOTES[u.lang || 'uz'] || QUOTES.uz
      const q = ql[Math.floor(Math.random() * ql.length)]
      if (hour === 8) await bot.telegram.sendMessage(u.telegramId, `🌅 *Xayrli tong, ${u.name}!*\n🔥 ${u.streak} kun | Lv.${u.level}${due > 0 ? `\n🔁 ${due} ta karta` : ''}\n\n_"${q.text}"_\n— ${q.author}`, { parse_mode: 'Markdown' })
      if (hour === 21) await bot.telegram.sendMessage(u.telegramId, `🌙 *${u.name}*\n⏱ ${u.totalStudyMinutes} daqiqa | 🔥 ${u.streak} kun`, { parse_mode: 'Markdown' })
    } catch {}
  }
}, 60 * 60 * 1000)

bot.launch({ dropPendingUpdates: true })
console.log('Telegram bot ishga tushdi')
app.listen(PORT, '0.0.0.0', () => { console.log(`Server port ${PORT}`); console.log('StudyMind v6.0 tayyor!') })
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
