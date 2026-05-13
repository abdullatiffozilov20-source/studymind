// ================================================================
//  🧠 StudyMind Pro — Full Backend v3.0
//  StudyMind + EduMind features merged
//  Express + MongoDB + Telegram + Google Auth + Groq AI
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
const SECRET        = process.env.SESSION_SECRET || 'studymind-pro-2025'
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
  role: { type: String, enum: ['student', 'parent', 'teacher'], default: 'student' },
  familyId: { type: mongoose.Schema.Types.ObjectId },
  isAdmin: { type: Boolean, default: false },
  telegramId: { type: String, unique: true, sparse: true },
  telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  grade: String,
  school: String,
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastStudyDate: String,
  createdAt: { type: Date, default: Date.now }
})

const SubjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['school', 'university'], default: 'school' },
  emoji: { type: String, default: '📚' },
  color: { type: String, default: '#534AB7' },
  examDate: String,
  progress: { type: Number, default: 0 },
  totalXP: { type: Number, default: 0 },
  weakTopics: [String],
  createdAt: { type: Date, default: Date.now }
})

const GradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  subjectName: String,
  score: { type: Number, min: 0, max: 100 },
  note: String,
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  createdAt: { type: Date, default: Date.now }
})

const StudySessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  subjectName: String,
  date: String,
  duration: Number,
  score: Number,
  notes: String,
  xpEarned: Number,
  mood: { type: Number, min: 1, max: 5, default: 3 },
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

const QuizSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  question: String,
  options: [String],
  correctIndex: Number,
  explanation: String,
  userAnswer: Number,
  isCorrect: Boolean,
  createdAt: { type: Date, default: Date.now }
})

const JournalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  mood: { type: Number, min: 1, max: 5 },
  content: String,
  tags: [String],
  isPrivate: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
})

const TopicNoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  subjectName: String,
  title: String,
  content: String,
  masteryLevel: { type: Number, min: 0, max: 100, default: 0 },
  nextReview: { type: String, default: () => new Date().toISOString().split('T')[0] },
  reviewInterval: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const BehaviorLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  focusMinutes: { type: Number, default: 0 },
  studySessions: { type: Number, default: 0 },
  questionsAsked: { type: Number, default: 0 },
  streakDays: { type: Number, default: 0 },
  avgMood: { type: Number, default: 3 },
  createdAt: { type: Date, default: Date.now }
})

const AIInsightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  generatedAt: { type: Date, default: Date.now },
  summary: String,
  strengths: [String],
  weaknesses: [String],
  recommendations: [String],
  learningStyle: String,
  bestStudyTime: String,
  careerSuggestions: mongoose.Schema.Types.Mixed,
  weekNumber: Number
})

const AIChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,
  subjectId: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now }
})

const ScheduleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  subjectId: mongoose.Schema.Types.ObjectId,
  subjectName: String,
  scheduledTime: String,
  dayOfWeek: Number,
  date: String,
  isDone: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

const User        = mongoose.model('User', UserSchema)
const Subject     = mongoose.model('Subject', SubjectSchema)
const Grade       = mongoose.model('Grade', GradeSchema)
const StudySession = mongoose.model('StudySession', StudySessionSchema)
const Flashcard   = mongoose.model('Flashcard', FlashcardSchema)
const Quiz        = mongoose.model('Quiz', QuizSchema)
const Journal     = mongoose.model('Journal', JournalSchema)
const TopicNote   = mongoose.model('TopicNote', TopicNoteSchema)
const BehaviorLog = mongoose.model('BehaviorLog', BehaviorLogSchema)
const AIInsight   = mongoose.model('AIInsight', AIInsightSchema)
const AIChat      = mongoose.model('AIChat', AIChatSchema)
const Schedule    = mongoose.model('Schedule', ScheduleSchema)

// ── MIDDLEWARE ─────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
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
  }, async (at, rt, profile, done) => {
    try {
      let user = await User.findOne({ email: profile.emails[0].value })
      if (!user) user = await User.create({
        name: profile.displayName,
        email: profile.emails[0].value,
        avatar: profile.photos[0]?.value,
        isAdmin: profile.emails[0].value === ADMIN_EMAIL
      })
      done(null, user)
    } catch (e) { done(e) }
  }))
}

// ── HELPERS ────────────────────────────────────────────────────────
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
  if (xp < 3000) return 7; if (xp < 4000) return 8; if (xp < 5500) return 9
  return Math.floor(10 + (xp - 5500) / 1000)
}

async function addXP(userId, amount) {
  const user = await User.findById(userId)
  const prevLevel = user.level
  user.xp += amount
  user.level = calcLevel(user.xp)
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (user.lastStudyDate !== today) {
    user.streak = user.lastStudyDate === yesterday ? user.streak + 1 : 1
    user.lastStudyDate = today
  }
  await user.save()

  // Update behavior log
  await BehaviorLog.findOneAndUpdate(
    { userId, date: today },
    { $inc: { focusMinutes: 0, studySessions: 1 }, streakDays: user.streak },
    { upsert: true }
  )

  return { user, leveledUp: user.level > prevLevel }
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

// ── AI ─────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })

async function askAI(messages, systemPrompt, maxTokens = 800) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      max_tokens: maxTokens,
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

function buildTutorSystem(user, subject = null, isParent = false) {
  const lang = user?.lang || 'uz'
  const langNote = lang === 'uz' ? 'Respond in Uzbek.' : lang === 'ru' ? 'Respond in Russian.' : 'Respond in English.'
  const tone = isParent
    ? 'Professional, calm tone for parents.'
    : 'Friendly, encouraging tone for students.'
  return `You are StudyMind AI — a behavioral learning coach and personal tutor.
${langNote} ${tone}
Student: ${user?.name}, Grade: ${user?.grade || 'unknown'}, Level: ${user?.level}, Streak: ${user?.streak} days.
${subject ? `Current subject: ${subject.name}. Weak topics: ${subject.weakTopics?.join(', ') || 'none'}.` : ''}
Be direct, honest, specific. Max 4 short paragraphs. Use emojis naturally. Like a wise caring mentor.`
}

// ── AUTH ROUTES ────────────────────────────────────────────────────
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

// ── USER ───────────────────────────────────────────────────────────
app.get('/api/user', requireAuth, (req, res) => {
  const u = req.currentUser
  res.json({ _id: u._id, name: u.name, email: u.email, avatar: u.avatar, lang: u.lang, level: u.level, xp: u.xp, streak: u.streak, role: u.role, grade: u.grade, school: u.school, isAdmin: u.isAdmin })
})
app.put('/api/user', requireAuth, async (req, res) => {
  const fields = ['lang', 'grade', 'school', 'role', 'name']
  fields.forEach(f => { if (req.body[f] !== undefined) req.currentUser[f] = req.body[f] })
  await req.currentUser.save()
  res.json({ ok: true })
})

// ── SUBJECTS ───────────────────────────────────────────────────────
app.get('/api/subjects', requireAuth, async (req, res) => {
  res.json(await Subject.find({ userId: req.currentUser._id }).sort({ createdAt: 1 }))
})
app.post('/api/subjects', requireAuth, async (req, res) => {
  const { name, type, emoji, color, examDate } = req.body
  if (!name) return res.status(400).json({ error: 'name kerak' })
  res.json(await Subject.create({ userId: req.currentUser._id, name, type: type || 'school', emoji: emoji || '📚', color: color || '#534AB7', examDate }))
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

// ── GRADES ─────────────────────────────────────────────────────────
app.get('/api/grades', requireAuth, async (req, res) => {
  const q = { userId: req.currentUser._id }
  if (req.query.subjectId) q.subjectId = req.query.subjectId
  res.json(await Grade.find(q).sort({ date: -1 }).limit(100))
})
app.post('/api/grades', requireAuth, async (req, res) => {
  const { subjectId, score, note, date } = req.body
  if (score === undefined) return res.status(400).json({ error: 'score kerak' })
  const subj = await Subject.findById(subjectId)
  const grade = await Grade.create({ userId: req.currentUser._id, subjectId, subjectName: subj?.name, score, note, date })
  if (subj) {
    const allGrades = await Grade.find({ userId: req.currentUser._id, subjectId })
    const avg = allGrades.reduce((s, g) => s + g.score, 0) / allGrades.length
    subj.progress = Math.round(avg)
    await subj.save()
  }
  res.json(grade)
})
app.delete('/api/grades/:id', requireAuth, async (req, res) => {
  await Grade.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// ── SESSIONS ───────────────────────────────────────────────────────
app.get('/api/sessions', requireAuth, async (req, res) => {
  const q = { userId: req.currentUser._id }
  if (req.query.subjectId) q.subjectId = req.query.subjectId
  res.json(await StudySession.find(q).sort({ createdAt: -1 }).limit(50))
})
app.post('/api/sessions', requireAuth, async (req, res) => {
  const { subjectId, duration, score, notes, mood } = req.body
  if (!duration) return res.status(400).json({ error: 'duration kerak' })
  const xpEarned = Math.floor(duration * 2) + (score ? Math.floor(score / 10) : 0) + (mood === 5 ? 10 : 0)
  const date = new Date().toISOString().split('T')[0]
  let subjectName = ''
  if (subjectId) {
    const subj = await Subject.findById(subjectId)
    subjectName = subj?.name || ''
    if (subj) { subj.totalXP += xpEarned; await subj.save() }
  }
  const session = await StudySession.create({ userId: req.currentUser._id, subjectId, subjectName, date, duration, score, notes, mood, xpEarned })
  await BehaviorLog.findOneAndUpdate(
    { userId: req.currentUser._id, date },
    { $inc: { focusMinutes: duration, studySessions: 1 } },
    { upsert: true }
  )
  const { user, leveledUp } = await addXP(req.currentUser._id, xpEarned)
  res.json({ session, xpEarned, newXP: user.xp, level: user.level, streak: user.streak, leveledUp })
})

// ── STATS ──────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, async (req, res) => {
  const userId = req.currentUser._id
  const today = new Date().toISOString().split('T')[0]
  const u = req.currentUser
  const subjects = await Subject.find({ userId })
  const weekly = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    const s = await StudySession.find({ userId, date: d })
    const j = await Journal.findOne({ userId, date: d })
    weekly.push({ date: d, minutes: s.reduce((a, x) => a + (x.duration || 0), 0), mood: j?.mood || null })
  }
  const todaySessions = await StudySession.find({ userId, date: today })
  const todayMinutes = todaySessions.reduce((a, x) => a + (x.duration || 0), 0)
  const dueCards = await Flashcard.countDocuments({ userId, nextReview: { $lte: today } })
  const dueNotes = await TopicNote.countDocuments({ userId, nextReview: { $lte: today } })
  const urgentSubjects = subjects.filter(s => {
    if (!s.examDate) return false
    const days = Math.ceil((new Date(s.examDate) - new Date()) / 86400000)
    return days <= 7 && days >= 0
  })
  const allGrades = await Grade.find({ userId }).sort({ date: -1 }).limit(50)
  const avgGrade = allGrades.length ? Math.round(allGrades.reduce((a, g) => a + g.score, 0) / allGrades.length) : 0
  const todayJournal = await Journal.findOne({ userId, date: today })
  res.json({ subjects, weekly, todayMinutes, dueCards, dueNotes, urgentSubjects, xp: u.xp, level: u.level, streak: u.streak, avgGrade, todayMood: todayJournal?.mood || null })
})

// ── FLASHCARDS ─────────────────────────────────────────────────────
app.get('/api/flashcards', requireAuth, async (req, res) => {
  const q = { userId: req.currentUser._id }
  if (req.query.subjectId) q.subjectId = req.query.subjectId
  if (req.query.dueOnly === 'true') q.nextReview = { $lte: new Date().toISOString().split('T')[0] }
  res.json(await Flashcard.find(q).sort({ nextReview: 1 }))
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
  Object.assign(card, updated); await card.save()
  const xp = req.body.quality >= 3 ? 5 : 2
  await addXP(req.currentUser._id, xp)
  await BehaviorLog.findOneAndUpdate({ userId: req.currentUser._id, date: new Date().toISOString().split('T')[0] }, { $inc: { questionsAsked: 1 } }, { upsert: true })
  res.json({ ...updated, xpEarned: xp })
})
app.delete('/api/flashcards/:id', requireAuth, async (req, res) => {
  await Flashcard.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// ── QUIZ (AI Generated) ────────────────────────────────────────────
app.post('/api/quiz/generate', requireAuth, async (req, res) => {
  const { subjectId, topicContent, count = 3 } = req.body
  const subject = subjectId ? await Subject.findById(subjectId) : null
  const prompt = `Generate ${count} multiple choice quiz questions about: ${topicContent || subject?.name || 'general study topic'}.
Format as JSON array: [{"question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"..."}]
Only return the JSON array, nothing else.`
  const reply = await askAI([{ role: 'user', content: prompt }],
    `You are a quiz generator. Return only valid JSON arrays. ${req.currentUser.lang === 'uz' ? 'Generate questions in Uzbek.' : req.currentUser.lang === 'ru' ? 'Generate questions in Russian.' : 'Generate questions in English.'}`, 1000)
  try {
    const clean = reply.replace(/```json|```/g, '').trim()
    const questions = JSON.parse(clean)
    res.json({ questions })
  } catch { res.json({ questions: [], error: 'Parsing xatolik' }) }
})

app.post('/api/quiz/answer', requireAuth, async (req, res) => {
  const { question, options, correctIndex, explanation, userAnswer, subjectId } = req.body
  const isCorrect = userAnswer === correctIndex
  await Quiz.create({ userId: req.currentUser._id, subjectId, question, options, correctIndex, explanation, userAnswer, isCorrect })
  if (isCorrect) await addXP(req.currentUser._id, 10)
  res.json({ isCorrect, xpEarned: isCorrect ? 10 : 0 })
})

// ── JOURNAL ────────────────────────────────────────────────────────
app.get('/api/journal', requireAuth, async (req, res) => {
  const q = { userId: req.currentUser._id }
  if (req.query.date) q.date = req.query.date
  const entries = await Journal.find(q).sort({ date: -1 }).limit(30)
  const isParent = req.query.parentView === 'true'
  if (isParent) {
    res.json(entries.map(e => ({ _id: e._id, date: e.date, mood: e.mood, tags: e.tags })))
  } else {
    res.json(entries)
  }
})
app.post('/api/journal', requireAuth, async (req, res) => {
  const { mood, content, date } = req.body
  const today = date || new Date().toISOString().split('T')[0]
  let entry = await Journal.findOne({ userId: req.currentUser._id, date: today })

  // AI auto-tag
  let tags = []
  if (content) {
    const tagPrompt = `Extract 3-5 keyword tags from this journal entry. Return only comma-separated words: "${content.slice(0, 500)}"`
    const tagReply = await askAI([{ role: 'user', content: tagPrompt }], 'Extract tags. Return only comma-separated keywords, no other text.', 100)
    tags = tagReply.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5)
  }

  if (entry) {
    entry.mood = mood; entry.content = content; entry.tags = tags
    await entry.save()
  } else {
    entry = await Journal.create({ userId: req.currentUser._id, date: today, mood, content, tags })
  }

  await BehaviorLog.findOneAndUpdate({ userId: req.currentUser._id, date: today }, { avgMood: mood }, { upsert: true })
  res.json(entry)
})

// ── TOPIC NOTES ────────────────────────────────────────────────────
app.get('/api/notes', requireAuth, async (req, res) => {
  const q = { userId: req.currentUser._id }
  if (req.query.subjectId) q.subjectId = req.query.subjectId
  if (req.query.dueOnly === 'true') q.nextReview = { $lte: new Date().toISOString().split('T')[0] }
  res.json(await TopicNote.find(q).sort({ updatedAt: -1 }))
})
app.post('/api/notes', requireAuth, async (req, res) => {
  const { subjectId, title, content } = req.body
  if (!title) return res.status(400).json({ error: 'title kerak' })
  const subj = subjectId ? await Subject.findById(subjectId) : null
  res.json(await TopicNote.create({ userId: req.currentUser._id, subjectId, subjectName: subj?.name, title, content }))
})
app.put('/api/notes/:id', requireAuth, async (req, res) => {
  const note = await TopicNote.findOne({ _id: req.params.id, userId: req.currentUser._id })
  if (!note) return res.status(404).json({ error: 'Topilmadi' })
  const { masteryLevel, content, title } = req.body
  if (masteryLevel !== undefined) {
    note.masteryLevel = masteryLevel
    const interval = masteryLevel >= 80 ? 7 : masteryLevel >= 50 ? 3 : 1
    note.reviewInterval = interval
    note.nextReview = new Date(Date.now() + interval * 86400000).toISOString().split('T')[0]
  }
  if (content !== undefined) note.content = content
  if (title !== undefined) note.title = title
  note.updatedAt = new Date()
  await note.save()
  res.json(note)
})
app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  await TopicNote.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// ── SCHEDULE ───────────────────────────────────────────────────────
app.get('/api/schedule', requireAuth, async (req, res) => {
  const q = { userId: req.currentUser._id }
  if (req.query.date) q.date = req.query.date
  res.json(await Schedule.find(q).sort({ scheduledTime: 1 }))
})
app.post('/api/schedule', requireAuth, async (req, res) => {
  const { title, subjectId, scheduledTime, dayOfWeek, date } = req.body
  const subj = subjectId ? await Subject.findById(subjectId) : null
  res.json(await Schedule.create({ userId: req.currentUser._id, title, subjectId, subjectName: subj?.name, scheduledTime, dayOfWeek, date }))
})
app.patch('/api/schedule/:id/done', requireAuth, async (req, res) => {
  const s = await Schedule.findOneAndUpdate({ _id: req.params.id, userId: req.currentUser._id }, { isDone: req.body.isDone }, { new: true })
  if (req.body.isDone) await addXP(req.currentUser._id, 5)
  res.json(s)
})
app.delete('/api/schedule/:id', requireAuth, async (req, res) => {
  await Schedule.findOneAndDelete({ _id: req.params.id, userId: req.currentUser._id })
  res.json({ ok: true })
})

// ── AI ROUTES ──────────────────────────────────────────────────────
app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const { message, subjectId, isParent } = req.body
  if (!message) return res.status(400).json({ error: 'message kerak' })
  const u = req.currentUser
  const subject = subjectId ? await Subject.findById(subjectId) : null
  await AIChat.create({ userId: u._id, role: 'user', content: message, subjectId })
  const history = await AIChat.find({ userId: u._id }).sort({ createdAt: -1 }).limit(8)
  const messages = history.reverse().map(m => ({ role: m.role, content: m.content }))
  const reply = await askAI(messages, buildTutorSystem(u, subject, isParent))
  await AIChat.create({ userId: u._id, role: 'assistant', content: reply, subjectId })
  await BehaviorLog.findOneAndUpdate({ userId: u._id, date: new Date().toISOString().split('T')[0] }, { $inc: { questionsAsked: 1 } }, { upsert: true })
  res.json({ reply })
})

app.post('/api/ai/weekly-insight', requireAuth, async (req, res) => {
  const u = req.currentUser
  const userId = u._id
  const grades = await Grade.find({ userId }).sort({ date: -1 }).limit(30)
  const sessions = await StudySession.find({ userId }).sort({ date: -1 }).limit(20)
  const journals = await Journal.find({ userId }).sort({ date: -1 }).limit(7)
  const behavior = await BehaviorLog.find({ userId }).sort({ date: -1 }).limit(7)
  const subjects = await Subject.find({ userId })

  const prompt = `Analyze this student's weekly data and generate insights:
Grades: ${JSON.stringify(grades.slice(0, 10))}
Study sessions: ${JSON.stringify(sessions.slice(0, 10))}
Mood (last 7 days): ${JSON.stringify(journals.map(j => ({ date: j.date, mood: j.mood })))}
Behavior: ${JSON.stringify(behavior)}
Subjects: ${JSON.stringify(subjects.map(s => ({ name: s.name, progress: s.progress })))}

Return JSON: {"summary":"...","strengths":["..."],"weaknesses":["..."],"recommendations":["..."],"learningStyle":"...","bestStudyTime":"...","careerSuggestions":[{"career":"...","match":85,"description":"..."}]}`

  const reply = await askAI([{ role: 'user', content: prompt }],
    `You are EduMind AI. Analyze student data. ${u.lang === 'uz' ? 'Respond in Uzbek.' : u.lang === 'ru' ? 'Respond in Russian.' : 'Respond in English.'} Return only valid JSON.`, 1500)

  try {
    const clean = reply.replace(/```json|```/g, '').trim()
    const data = JSON.parse(clean)
    const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))
    const insight = await AIInsight.findOneAndUpdate(
      { userId, weekNumber },
      { ...data, generatedAt: new Date(), weekNumber },
      { upsert: true, new: true }
    )
    res.json(insight)
  } catch { res.status(500).json({ error: 'Tahlil generatsiyada xatolik', raw: reply }) }
})

app.get('/api/ai/insights', requireAuth, async (req, res) => {
  res.json(await AIInsight.find({ userId: req.currentUser._id }).sort({ generatedAt: -1 }).limit(4))
})

app.post('/api/ai/exam-plan', requireAuth, async (req, res) => {
  const subject = await Subject.findById(req.body.subjectId)
  if (!subject) return res.status(404).json({ error: 'Fan topilmadi' })
  const daysLeft = subject.examDate ? Math.ceil((new Date(subject.examDate) - new Date()) / 86400000) : 14
  const prompt = `Create a realistic ${daysLeft}-day exam preparation plan for: ${subject.name}.
Progress: ${subject.progress}%. Weak topics: ${subject.weakTopics?.join(', ') || 'unknown'}.
Format as numbered list with daily tasks. Be specific and practical.`
  res.json({ plan: await askAI([{ role: 'user', content: prompt }], buildTutorSystem(req.currentUser, subject)) })
})

app.post('/api/ai/summarize', requireAuth, async (req, res) => {
  const { notes, subjectId } = req.body
  if (!notes) return res.status(400).json({ error: 'notes kerak' })
  const subject = subjectId ? await Subject.findById(subjectId) : null
  const prompt = `Summarize these notes. Extract: key concepts, important formulas/dates, likely exam questions:\n${notes.slice(0, 3000)}`
  res.json({ summary: await askAI([{ role: 'user', content: prompt }], buildTutorSystem(req.currentUser, subject)) })
})

app.post('/api/ai/career', requireAuth, async (req, res) => {
  const u = req.currentUser
  const subjects = await Subject.find({ userId: u._id })
  const grades = await Grade.find({ userId: u._id }).sort({ date: -1 }).limit(30)
  const prompt = `Based on this student's academic profile, suggest top 5 career paths:
Subjects & progress: ${JSON.stringify(subjects.map(s => ({ name: s.name, progress: s.progress })))}
Recent grades: ${JSON.stringify(grades.slice(0, 10).map(g => ({ subject: g.subjectName, score: g.score })))}
Return JSON array: [{"career":"...","match":90,"description":"...","requiredSubjects":["..."],"avgSalary":"...","studyPath":"..."}]`
  const reply = await askAI([{ role: 'user', content: prompt }],
    `Career counselor AI. ${u.lang === 'uz' ? 'Respond in Uzbek.' : u.lang === 'ru' ? 'Respond in Russian.' : 'Respond in English.'} Return only valid JSON.`, 1200)
  try {
    const clean = reply.replace(/```json|```/g, '').trim()
    res.json({ careers: JSON.parse(clean) })
  } catch { res.json({ careers: [], error: 'Parsing xatolik' }) }
})

// ── BEHAVIOR ───────────────────────────────────────────────────────
app.get('/api/behavior', requireAuth, async (req, res) => {
  res.json(await BehaviorLog.find({ userId: req.currentUser._id }).sort({ date: -1 }).limit(30))
})

// ── PING & STATIC ─────────────────────────────────────────────────
app.get('/ping', (req, res) => res.send('ok'))
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'app.html')))
app.get('/app.html', (req, res) => res.sendFile(path.join(__dirname, 'app.html')))

// ── TELEGRAM BOT ───────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN)

function appBtn() {
  return Markup.inlineKeyboard([[Markup.button.webApp('🧠 StudyMind Pro', `${DOMAIN}/app.html`)]])
}

bot.start(async ctx => {
  const tid = String(ctx.from.id)
  let user = await User.findOne({ telegramId: tid })
  if (!user) user = await User.create({ telegramId: tid, name: ctx.from.first_name || 'Student', telegramUsername: ctx.from.username })
  await ctx.reply(
    `👋 Salom, *${user.name}*!\n\n🧠 *StudyMind Pro* — aqlli o'quv assistentingiz.\n\nTilni tanlang:`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[
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
  await ctx.reply('🧠 StudyMind Pro tayyor!', {
    ...Markup.keyboard([['📚 Fanlar', '📊 Stats'], ['🧠 AI', '🌐 App']]).resize(),
  })
})

bot.hears('📚 Fanlar', async ctx => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!user) return ctx.reply('/start bosing')
  const subjects = await Subject.find({ userId: user._id })
  if (!subjects.length) return ctx.reply('Fan qoshilmagan', appBtn())
  let text = '📚 *Fanlaringiz:*\n\n'
  subjects.forEach(s => {
    const days = s.examDate ? Math.ceil((new Date(s.examDate) - new Date()) / 86400000) : null
    text += `${s.emoji} *${s.name}* — ${s.progress}%${days !== null ? ` | 📅 ${days} kun` : ''}\n`
  })
  await ctx.reply(text, { parse_mode: 'Markdown', ...appBtn() })
})

bot.hears('📊 Stats', async ctx => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!user) return ctx.reply('/start bosing')
  const today = new Date().toISOString().split('T')[0]
  const sessions = await StudySession.find({ userId: user._id, date: today })
  const min = sessions.reduce((s, x) => s + (x.duration || 0), 0)
  const dueCards = await Flashcard.countDocuments({ userId: user._id, nextReview: { $lte: today } })
  await ctx.reply(`📊 *Bugungi statistika*\n\n🔥 Streak: *${user.streak}* kun\n⭐ XP: *${user.xp}* | Lv.*${user.level}*\n⏱ Bugun: *${min}* daqiqa\n🔁 Kartalar: *${dueCards}*`, { parse_mode: 'Markdown', ...appBtn() })
})

bot.hears(['🧠 AI', '🌐 App'], async ctx => {
  await ctx.reply('📱 StudyMind Pro:', appBtn())
})

bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return
  const user = await User.findOne({ telegramId: String(ctx.from.id) })
  if (!user) return ctx.reply('/start bosing')
  await ctx.sendChatAction('typing')
  const reply = await askAI([{ role: 'user', content: ctx.message.text }], buildTutorSystem(user))
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
        const dueCards = await Flashcard.countDocuments({ userId: u._id, nextReview: { $lte: today } })
        await bot.telegram.sendMessage(u.telegramId, `🌅 Xayrli tong, ${u.name}!\n\n🔥 Streak: ${u.streak} kun | Lv.${u.level}\n🔁 Bugun takrorlash: ${dueCards} karta\n\nBugun ham o'qing! 💪`)
      }
      if (hour === 21) {
        const s = await StudySession.find({ userId: u._id, date: today })
        const min = s.reduce((a, x) => a + (x.duration || 0), 0)
        await bot.telegram.sendMessage(u.telegramId, `🌙 Bugun ${min} daqiqa o'qidingiz!\n🔥 Streak: ${u.streak} kun\n\nAjoyib! Ertaga ham davom eting ⭐`)
      }
    } catch {}
  }
}, 60 * 60 * 1000)

bot.launch({ dropPendingUpdates: true })
console.log('✅ Telegram bot ishga tushdi')

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server port ${PORT} da ishlamoqda`)
  console.log('🧠 StudyMind Pro v3.0 tayyor!')
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
