// Twin — AI Learning Companion. Backend.
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
const SECRET = process.env.SESSION_SECRET || 'twin-2026'

if (!MONGO_URI || !GROQ_KEY) { console.error('ENV kerak: MONGO_URI, GROQ_API_KEY'); process.exit(1) }
await mongoose.connect(MONGO_URI)
console.log('✅ MongoDB ulandi')

// ── SCHEMAS ──────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, sparse: true }, avatar: String,
  telegramId: { type: String, unique: true, sparse: true }, telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  theme: { type: String, default: 'dark', enum: ['dark', 'light'] },
  notifEnabled: { type: Boolean, default: true },
  lastActiveDate: String,
  createdAt: { type: Date, default: Date.now }
})

// Markaziy obyekt — Mavzu. Bu ham fan, ham ko'nikma, ham bitta loyiha bo'lishi mumkin.
const TopicSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  emoji: { type: String, default: '📘' },
  color: { type: String, default: '#6c5fff' },
  isArchived: { type: Boolean, default: false }, // "tugadi" holati, ixtiyoriy
  // Twin profili — AI vaqt o'tishi bilan to'ldiradi va yangilaydi
  understanding: {
    strengths: [String],
    weakSpots: [String],
    notes: String, // AI uchun erkin formatdagi xulosa, keyingi suhbatlarda kontekst sifatida ishlatiladi
    lastUpdated: Date
  },
  messageCount: { type: Number, default: 0 },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
})

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }, // null bo'lishi mumkin — umumiy suhbat
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,
  imageUrl: String, // agar rasm yuborilgan bo'lsa (base64 yoki saqlangan)
  extractedData: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
})

const FlashcardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  topicName: String,
  front: String, back: String,
  interval: { type: Number, default: 1 }, easeFactor: { type: Number, default: 2.5 },
  nextReview: { type: String, default: () => new Date().toISOString().split('T')[0] },
  repetitions: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

// Eslatma — biror narsani saqlash uchun (vazifa, deadline, fikr)
const ReminderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  title: String,
  dueDate: String, // YYYY-MM-DD, ixtiyoriy
  isDone: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

const User = mongoose.model('User', UserSchema)
const Topic = mongoose.model('Topic', TopicSchema)
const Chat = mongoose.model('Chat', ChatSchema)
const Flashcard = mongoose.model('Flashcard', FlashcardSchema)
const Reminder = mongoose.model('Reminder', ReminderSchema)

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(express.json({ limit: '12mb' })) // rasm uchun katta limit
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
      if (!u) u = await User.create({ name: profile.displayName, email: profile.emails[0].value, avatar: profile.photos[0]?.value })
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

// ── HELPERS ──────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().split('T')[0] }

function sm2(card, q) {
  let { easeFactor: ef, interval, repetitions: rep } = card
  if (q >= 3) { interval = rep === 0 ? 1 : rep === 1 ? 6 : Math.round(interval * ef); rep++; ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)) } else { rep = 0; interval = 1 }
  return { interval, easeFactor: ef, repetitions: rep, nextReview: new Date(Date.now() + interval * 86400000).toISOString().split('T')[0] }
}

// ── AI ──────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })
const TEXT_MODEL = 'llama-3.3-70b-versatile'
const VISION_MODEL = 'llama-3.2-90b-vision-preview'

async function ai(messages, system, maxTokens = 700, model = TEXT_MODEL) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const r = await groq.chat.completions.create({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }, { signal: ctrl.signal })
    clearTimeout(timer); return r.choices[0]?.message?.content || ''
  } catch (e) { clearTimeout(timer); return e.name === 'AbortError' ? 'Vaqt tugadi, qaytadan urinib ko\'ring.' : 'Xatolik: ' + e.message }
}

// Rasm bilan AI chaqiruv (vision model, base64 image uchun)
async function aiVision(imageBase64, userText, system) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const r = await groq.chat.completions.create({
      model: VISION_MODEL, max_tokens: 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: userText || 'Bu rasmda nima yozilgan? Tahlil qil.' },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]}
      ]
    }, { signal: ctrl.signal })
    clearTimeout(timer); return r.choices[0]?.message?.content || ''
  } catch (e) { clearTimeout(timer); return e.name === 'AbortError' ? 'Vaqt tugadi.' : 'Rasmni tahlil qilib bo\'lmadi: ' + e.message }
}

function langNote(lang) {
  return lang === 'uz' ? 'FAQAT o\'zbek tilida javob ber.' : lang === 'ru' ? 'Отвечай ТОЛЬКО на русском.' : 'Respond ONLY in English.'
}

// Asosiy system prompt — Twin shaxsiyati
function buildSystem(user, topics, activeTopic) {
  const lang = user?.lang || 'uz'
  const topicList = topics.map(t => `${t.emoji}${t.name}`).join(', ') || 'hali yo\'q'
  let twinMemory = ''
  if (activeTopic?.understanding?.notes) {
    twinMemory = `\n\nBu mavzu bo'yicha foydalanuvchi haqida bilganlaring: ${activeTopic.understanding.notes}`
    if (activeTopic.understanding.weakSpots?.length) twinMemory += `\nQiynaladigan joylar: ${activeTopic.understanding.weakSpots.join(', ')}`
    if (activeTopic.understanding.strengths?.length) twinMemory += `\nKuchli tomonlari: ${activeTopic.understanding.strengths.join(', ')}`
  }

  return `Sen Twin — foydalanuvchining shaxsiy AI o'rganish hamrohisan. ${langNote(lang)}
Sen shunchaki ma'lumot beruvchi emassan — sen uning o'rganish jarayonini kuzatib, eslab, vaqt o'tishi bilan uni yaxshiroq tushunadigan hamrohsan.

Foydalanuvchi: ${user?.name || 'Do\'stim'}
Uning mavzulari: ${topicList}
${activeTopic ? `Hozir gaplashilayotgan mavzu: ${activeTopic.emoji}${activeTopic.name}` : ''}
${twinMemory}

QOIDALAR:
1. Tabiiy, qisqa, do'stona gaplash — ChatGPT kabi, lekin shaxsiylashtirilgan. Bo'sh maqtov yo'q.
2. Agar foydalanuvchi nimadir o'rgangani, baho olgani, yangi narsa boshlagani haqida yozsa — buni avtomatik tushun va belgilarni ishlat (pastda).
3. Agar foydalanuvchi yangi mavzu haqida gapirsa (hozirgi ro'yxatda yo'q narsa), [NEWTOPIC:nom:emoji] bilan belgila.
4. Eslatma/vazifa/deadline aytilsa: [REMIND:sarlavha:YYYY-MM-DD yoki bo'sh]
5. Agar foydalanuvchi biror narsani tushunmasligini aytsa yoki xato qilsa, buni [WEAK:nima haqida] bilan belgila — bu Twin xotirasiga yoziladi.
6. Agar foydalanuvchi biror narsani yaxshi bilishini ko'rsatsa, [STRONG:nima haqida] bilan belgila.
7. Flashcard yaratish so'ralsa: [FC:savol|javob] (bir nechta bo'lishi mumkin)
8. Bugungi sana: ${todayStr()}
9. Javoblaring qisqa va aniq bo'lsin — odam chatda charchamasin.`
}

function extractFromAI(text) {
  const r = {}
  const nt = text.match(/\[NEWTOPIC:([^:]+):([^\]]+)\]/i); if (nt) r.newTopic = { name: nt[1].trim(), emoji: nt[2].trim() }
  const rm = text.match(/\[REMIND:([^:]+):([^\]]*)\]/i); if (rm) r.reminder = { title: rm[1].trim(), dueDate: rm[2].trim() }
  const wk = [...text.matchAll(/\[WEAK:([^\]]+)\]/gi)]; if (wk.length) r.weakSpots = wk.map(m => m[1].trim())
  const st = [...text.matchAll(/\[STRONG:([^\]]+)\]/gi)]; if (st.length) r.strengths = st.map(m => m[1].trim())
  const fcs = [...text.matchAll(/\[FC:([^|]+)\|([^\]]+)\]/gi)]; if (fcs.length) r.flashcards = fcs.map(m => ({ front: m[1].trim(), back: m[2].trim() }))
  return r
}

function cleanText(t) {
  return t.replace(/\[NEWTOPIC:[^\]]+\]/gi, '').replace(/\[REMIND:[^\]]+\]/gi, '').replace(/\[WEAK:[^\]]+\]/gi, '').replace(/\[STRONG:[^\]]+\]/gi, '').replace(/\[FC:[^\]]+\]/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}

// Topic tushunish profilini AI orqali yangilash (vaqti-vaqti bilan chaqiriladi)
async function updateTopicUnderstanding(topic, recentMessages, lang) {
  const system = `Foydalanuvchining "${topic.name}" mavzusidagi so'nggi suhbatlarini tahlil qil. ${langNote(lang)}
FAQAT JSON qaytar:
{"strengths":["..."],"weakSpots":["..."],"notes":"qisqa, 1-2 jumlali xulosa, keyingi suhbatlarda foydali bo'ladigan"}`
  const convo = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')
  const reply = await ai([{ role: 'user', content: convo }], system, 400)
  const text = reply.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(text)
    topic.understanding = {
      strengths: parsed.strengths || topic.understanding?.strengths || [],
      weakSpots: parsed.weakSpots || topic.understanding?.weakSpots || [],
      notes: parsed.notes || topic.understanding?.notes || '',
      lastUpdated: new Date()
    }
    await topic.save()
  } catch {}
}

// ── AUTH ────────────────────────────────────────────────────────
app.get('/auth/google', (req, res, next) => { if (!GOOGLE_ID) return res.redirect('/?error=no_google'); passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next) })
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?error=google' }), (req, res) => res.redirect('/app.html'))
app.post('/auth/telegram', async (req, res) => {
  const { telegramId, name, username } = req.body
  try { let u = await User.findOne({ telegramId: String(telegramId) }); if (!u) u = await User.create({ telegramId: String(telegramId), name, telegramUsername: username }); req.session.tid = u._id; res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }) })

// ── USER ────────────────────────────────────────────────────────
app.get('/api/user', auth, (req, res) => {
  const u = req.u
  res.json({ _id: u._id, name: u.name, email: u.email, avatar: u.avatar, lang: u.lang, theme: u.theme })
})
app.put('/api/user', auth, async (req, res) => {
  const fields = ['lang', 'name', 'theme', 'notifEnabled']
  fields.forEach(f => { if (req.body[f] !== undefined) req.u[f] = req.body[f] })
  await req.u.save(); res.json({ ok: true })
})

// ── TOPICS ──────────────────────────────────────────────────────
app.get('/api/topics', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.includeArchived !== 'true') q.isArchived = { $ne: true }
  res.json(await Topic.find(q).sort({ lastActivityAt: -1 }))
})
app.post('/api/topics', auth, async (req, res) => {
  const { name, emoji, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Nom kerak' })
  res.json(await Topic.create({ userId: req.u._id, name: name.trim(), emoji: emoji || '📘', color: color || '#6c5fff' }))
})
app.get('/api/topics/:id', auth, async (req, res) => {
  const topic = await Topic.findOne({ _id: req.params.id, userId: req.u._id })
  if (!topic) return res.status(404).json({ error: 'Topilmadi' })
  res.json(topic)
})
app.patch('/api/topics/:id', auth, async (req, res) => {
  const allowed = ['name', 'emoji', 'color', 'isArchived']
  const upd = {}; allowed.forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f] })
  res.json(await Topic.findOneAndUpdate({ _id: req.params.id, userId: req.u._id }, upd, { new: true }))
})
app.delete('/api/topics/:id', auth, async (req, res) => {
  await Topic.findOneAndDelete({ _id: req.params.id, userId: req.u._id })
  await Chat.deleteMany({ topicId: req.params.id, userId: req.u._id })
  await Flashcard.deleteMany({ topicId: req.params.id, userId: req.u._id })
  await Reminder.deleteMany({ topicId: req.params.id, userId: req.u._id })
  res.json({ ok: true })
})

// ── CHAT (markaziy oqim) ────────────────────────────────────────
app.get('/api/chat', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.topicId) q.topicId = req.query.topicId
  else if (req.query.topicId === '') q.topicId = null
  const limit = req.query.topicId ? 60 : 30
  res.json((await Chat.find(q).sort({ createdAt: -1 }).limit(limit)).reverse())
})

app.post('/api/chat', auth, async (req, res) => {
  const { message, topicId, imageBase64 } = req.body
  if (!message?.trim() && !imageBase64) return res.status(400).json({ error: 'Xabar yoki rasm kerak' })
  const u = req.u
  const topics = await Topic.find({ userId: u._id, isArchived: { $ne: true } })
  let activeTopic = topicId ? topics.find(t => String(t._id) === topicId) : null

  await Chat.create({ userId: u._id, topicId: activeTopic?._id, role: 'user', content: message || '[rasm yuborildi]', imageUrl: imageBase64 ? 'sent' : undefined })

  let rawReply
  if (imageBase64) {
    const visionSystem = `Sen Twin — o'rganish hamrohisan. ${langNote(u.lang)} Foydalanuvchi rasm yubordi (uy vazifasi, darslik sahifasi, qo'lyozma yoki shunga o'xshash). Rasmni o'qib, qisqacha tushuntir: nima haqida, qaysi mavzuga tegishli. Agar vazifa yoki deadline ko'rinsa, [REMIND:sarlavha:YYYY-MM-DD yoki bo'sh] bilan belgila. Agar yangi mavzu bo'lsa [NEWTOPIC:nom:emoji] bilan belgila. Bugungi sana: ${todayStr()}`
    rawReply = await aiVision(imageBase64, message || '', visionSystem)
  } else {
    const history = await Chat.find({ userId: u._id, topicId: activeTopic?._id || null }).sort({ createdAt: -1 }).limit(14)
    const messages = history.reverse().map(m => ({ role: m.role, content: m.content }))
    rawReply = await ai(messages, buildSystem(u, topics, activeTopic))
  }

  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  // Yangi mavzu avtomatik yaratiladi
  let newTopicCreated = null
  if (extracted.newTopic && !activeTopic) {
    const exists = topics.find(t => t.name.toLowerCase() === extracted.newTopic.name.toLowerCase())
    if (!exists) {
      newTopicCreated = await Topic.create({ userId: u._id, name: extracted.newTopic.name, emoji: extracted.newTopic.emoji || '📘' })
      activeTopic = newTopicCreated
    } else activeTopic = exists
  }

  if (activeTopic) { activeTopic.messageCount = (activeTopic.messageCount || 0) + 1; activeTopic.lastActivityAt = new Date(); await activeTopic.save() }

  let savedReminder = null
  if (extracted.reminder) savedReminder = await Reminder.create({ userId: u._id, topicId: activeTopic?._id, title: extracted.reminder.title, dueDate: extracted.reminder.dueDate || '' })

  let savedCards = []
  if (extracted.flashcards?.length) for (const fc of extracted.flashcards) savedCards.push(await Flashcard.create({ userId: u._id, topicId: activeTopic?._id, topicName: activeTopic?.name, front: fc.front, back: fc.back }))

  // Twin xotirasini yangilash (zaif/kuchli tomonlar)
  if (activeTopic && (extracted.weakSpots?.length || extracted.strengths?.length)) {
    activeTopic.understanding = activeTopic.understanding || {}
    if (extracted.weakSpots?.length) {
      activeTopic.understanding.weakSpots = [...new Set([...(activeTopic.understanding.weakSpots || []), ...extracted.weakSpots])].slice(-8)
    }
    if (extracted.strengths?.length) {
      activeTopic.understanding.strengths = [...new Set([...(activeTopic.understanding.strengths || []), ...extracted.strengths])].slice(-8)
    }
    activeTopic.understanding.lastUpdated = new Date()
    await activeTopic.save()
  }

  await Chat.create({ userId: u._id, topicId: activeTopic?._id, role: 'assistant', content: cleanReply, extractedData: extracted })
  u.lastActiveDate = todayStr(); await u.save()

  res.json({ reply: cleanReply, extracted, newTopic: newTopicCreated, savedReminder, savedCards, topicId: activeTopic?._id })
})

// Vaqti-vaqti bilan Twin profilini chuqurroq yangilash (10+ xabardan keyin chaqiriladi frontenddan)
app.post('/api/topics/:id/refresh-understanding', auth, async (req, res) => {
  const topic = await Topic.findOne({ _id: req.params.id, userId: req.u._id })
  if (!topic) return res.status(404).json({ error: 'Topilmadi' })
  const recent = await Chat.find({ userId: req.u._id, topicId: topic._id }).sort({ createdAt: -1 }).limit(20)
  await updateTopicUnderstanding(topic, recent.reverse(), req.u.lang)
  res.json(topic)
})

// ── FLASHCARDS ──────────────────────────────────────────────────
app.get('/api/flashcards', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.dueOnly === 'true') q.nextReview = { $lte: todayStr() }
  if (req.query.topicId) q.topicId = req.query.topicId
  res.json(await Flashcard.find(q).sort({ nextReview: 1 }))
})
app.post('/api/flashcards', auth, async (req, res) => {
  const { front, back, topicId, topicName } = req.body
  if (!front || !back) return res.status(400).json({ error: 'Kerak' })
  res.json(await Flashcard.create({ userId: req.u._id, topicId, topicName, front, back }))
})
app.post('/api/flashcards/:id/review', auth, async (req, res) => {
  const card = await Flashcard.findOne({ _id: req.params.id, userId: req.u._id })
  if (!card) return res.status(404).json({ error: 'Topilmadi' })
  const upd = sm2(card, req.body.quality); Object.assign(card, upd); await card.save()
  res.json(upd)
})
app.delete('/api/flashcards/:id', auth, async (req, res) => { await Flashcard.findOneAndDelete({ _id: req.params.id, userId: req.u._id }); res.json({ ok: true }) })

app.post('/api/flashcards/generate', auth, async (req, res) => {
  const { topicId, count = 5 } = req.body
  const topic = topicId ? await Topic.findById(topicId) : null
  const topicName = topic?.name || 'umumiy'
  const prompt = `"${topicName}" mavzusi bo'yicha ${count} ta flashcard.\nFormat:\nCARD1_FRONT: savol\nCARD1_BACK: javob\n...`
  const reply = await ai([{ role: 'user', content: prompt }], `Sen Twin — o'rganish hamrohisan. ${langNote(req.u.lang)}`, 900)
  const cards = []
  for (let i = 1; i <= count; i++) {
    const f = reply.match(new RegExp(`CARD${i}_FRONT:\\s*(.+?)(?=CARD\\d_FRONT:|$)`, 'si'))?.[1]?.trim().split('\n')[0]
    const b = reply.match(new RegExp(`CARD${i}_BACK:\\s*(.+?)(?=CARD\\d_FRONT:|$)`, 'si'))?.[1]?.trim().split('\n')[0]
    if (f && b) cards.push(await Flashcard.create({ userId: req.u._id, topicId, topicName, front: f, back: b }))
  }
  res.json({ cards, topic: topicName })
})

// ── REMINDERS ───────────────────────────────────────────────────
app.get('/api/reminders', auth, async (req, res) => {
  const q = { userId: req.u._id }
  if (req.query.activeOnly === 'true') q.isDone = false
  res.json(await Reminder.find(q).sort({ dueDate: 1, createdAt: -1 }))
})
app.post('/api/reminders', auth, async (req, res) => {
  const { title, dueDate, topicId } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Kerak' })
  res.json(await Reminder.create({ userId: req.u._id, title: title.trim(), dueDate: dueDate || '', topicId }))
})
app.patch('/api/reminders/:id', auth, async (req, res) => res.json(await Reminder.findOneAndUpdate({ _id: req.params.id, userId: req.u._id }, req.body, { new: true })))
app.delete('/api/reminders/:id', auth, async (req, res) => { await Reminder.findOneAndDelete({ _id: req.params.id, userId: req.u._id }); res.json({ ok: true }) })

// ── TODAY (passiv natija ko'rinishi) ───────────────────────────
app.get('/api/today', auth, async (req, res) => {
  const u = req.u
  const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: todayStr() } })
  const activeReminders = await Reminder.find({ userId: u._id, isDone: false }).sort({ dueDate: 1 }).limit(8)
  const recentTopics = await Topic.find({ userId: u._id, isArchived: { $ne: true } }).sort({ lastActivityAt: -1 }).limit(5)
  const recentChats = await Chat.find({ userId: u._id, role: 'assistant' }).sort({ createdAt: -1 }).limit(3)
  res.json({ dueCards, activeReminders, recentTopics, recentChats })
})

// ── STATIC ──────────────────────────────────────────────────────
app.get('/ping', (_, res) => res.send('ok'))
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))
app.get('/app.html', (_, res) => res.sendFile(path.join(__dirname, 'app.html')))

// ── TELEGRAM BOT ────────────────────────────────────────────────
let bot = null
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN)
  function appBtn() { return Markup.inlineKeyboard([[Markup.button.webApp('🧠 Twin', `${DOMAIN}/app.html`)]]) }

  bot.start(async ctx => {
    const tid = String(ctx.from.id); let u = await User.findOne({ telegramId: tid })
    if (!u) u = await User.create({ telegramId: tid, name: ctx.from.first_name || 'Do\'stim', telegramUsername: ctx.from.username })
    await ctx.reply(`👋 Salom, ${u.name}!\n\n🧠 Men Twin — sizning shaxsiy o'rganish hamrohingizman.\n\nNimani o'rganmoqchisiz? Shunchaki yozing, gapiring, yoki rasm yuboring — qolganini men hal qilaman.`, appBtn())
  })

  bot.on('text', async ctx => {
    if (ctx.message.text.startsWith('/')) return
    const tid = String(ctx.from.id), u = await User.findOne({ telegramId: tid })
    if (!u) return ctx.reply('/start bosing')
    await ctx.sendChatAction('typing')
    const topics = await Topic.find({ userId: u._id, isArchived: { $ne: true } })
    const history = await Chat.find({ userId: u._id, topicId: null }).sort({ createdAt: -1 }).limit(10)
    const messages = [...history.reverse().map(m => ({ role: m.role, content: m.content })), { role: 'user', content: ctx.message.text }]
    await Chat.create({ userId: u._id, role: 'user', content: ctx.message.text })
    const rawReply = await ai(messages, buildSystem(u, topics, null))
    const extracted = extractFromAI(rawReply)
    const cleanReply = cleanText(rawReply)
    if (extracted.newTopic) {
      const exists = topics.find(t => t.name.toLowerCase() === extracted.newTopic.name.toLowerCase())
      if (!exists) await Topic.create({ userId: u._id, name: extracted.newTopic.name, emoji: extracted.newTopic.emoji || '📘' })
    }
    await Chat.create({ userId: u._id, role: 'assistant', content: cleanReply })
    await ctx.reply(cleanReply, appBtn())
  })

  bot.on('photo', async ctx => {
    const tid = String(ctx.from.id), u = await User.findOne({ telegramId: tid })
    if (!u) return ctx.reply('/start bosing')
    await ctx.reply('📸 Rasmni ko\'rish uchun ilovani oching — u yerda tahlil qilaman.', appBtn())
  })

  bot.launch({ dropPendingUpdates: true }).then(() => console.log('✅ Bot ishga tushdi')).catch(e => console.log('⚠️ Bot ishga tushmadi, faqat web rejimda davom etyapti:', e.message))
}

app.listen(PORT, '0.0.0.0', () => { console.log(`✅ Server ${PORT}`); console.log('🧠 Twin v1.0') })
if (bot) { process.once('SIGINT', () => bot.stop('SIGINT')); process.once('SIGTERM', () => bot.stop('SIGTERM')) }
