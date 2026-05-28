// ================================================================
//  StudyMind v8.0 — Complete redesign backend
//  New: Achievements, Focus Score, Weekly insights, Streak Freeze
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

if (!MONGO_URI || !BOT_TOKEN || !GROQ_KEY) { console.error('ENV kerak!'); process.exit(1) }
await mongoose.connect(MONGO_URI)
console.log('✅ MongoDB ulandi')

// ── SCHEMAS ───────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, sparse: true }, avatar: String,
  telegramId: { type: String, unique: true, sparse: true }, telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  theme: { type: String, default: 'dark', enum: ['dark', 'light'] },
  grade: String, school: String, isAdmin: { type: Boolean, default: false },
  xp: { type: Number, default: 0 }, level: { type: Number, default: 1 },
  streak: { type: Number, default: 0 }, lastStudyDate: String,
  streakFreezeCount: { type: Number, default: 2 },
  streakFreezeUsedDate: String,
  totalStudyMinutes: { type: Number, default: 0 },
  focusScore: { type: Number, default: 0 },
  gardenLevel: { type: Number, default: 0 },
  gardenWater: { type: Number, default: 0 },
  gardenSun: { type: Number, default: 0 },
  achievements: [{ id: String, unlockedAt: Date }],
  savedQuotes: [{ text: String, author: String, savedAt: Date }],
  notifEnabled: { type: Boolean, default: true },
  onboarded: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

const SubjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String, emoji: { type: String, default: '📚' }, color: { type: String, default: '#6c63ff' },
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
  subjectName: String, time: String, endTime: String, date: String,
  repeat: { type: String, enum: ['none', 'daily', 'custom'], default: 'none' },
  repeatDays: [Number], isDone: { type: Boolean, default: false },
  aiGenerated: { type: Boolean, default: false }, emoji: { type: String, default: '📌' },
  createdAt: { type: Date, default: Date.now }
})

const NoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String, content: String, subjectName: String,
  color: { type: String, default: '#6c63ff' }, isPinned: { type: Boolean, default: false },
  tags: [String], createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
})

const InsightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekNumber: Number, summary: String, strengths: [String], weaknesses: [String],
  recommendations: [String], learningStyle: String, bestStudyTime: String,
  focusScore: Number, studyTime: Number,
  generatedAt: { type: Date, default: Date.now }
})

const User      = mongoose.model('User', UserSchema)
const Subject   = mongoose.model('Subject', SubjectSchema)
const Chat      = mongoose.model('Chat', ChatSchema)
const Flashcard = mongoose.model('Flashcard', FlashcardSchema)
const Schedule  = mongoose.model('Schedule', ScheduleSchema)
const Note      = mongoose.model('Note', NoteSchema)
const Insight   = mongoose.model('Insight', InsightSchema)

// ── ACHIEVEMENTS ──────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id: 'first_chat',    emoji: '💬', name: 'Birinchi suhbat',   desc: 'AI bilan birinchi marta gaplashdi' },
  { id: 'streak_3',      emoji: '🔥', name: '3 kun streak',      desc: '3 kun ketma-ket o\'qidi' },
  { id: 'streak_7',      emoji: '🔥', name: 'Haftalik streak',   desc: '7 kun ketma-ket o\'qidi' },
  { id: 'streak_30',     emoji: '🔥', name: 'Oylik streak',      desc: '30 kun ketma-ket o\'qidi' },
  { id: 'grade_90',      emoji: '🏆', name: 'A\'lo o\'quvchi',   desc: 'Biron fandan 90+ baho oldi' },
  { id: 'flashcard_50',  emoji: '🔁', name: 'Karta ustasi',      desc: '50 ta flashcard ko\'rib chiqdi' },
  { id: 'xp_500',        emoji: '⭐', name: '500 XP',            desc: '500 XP to\'pladi' },
  { id: 'xp_1000',       emoji: '💫', name: '1000 XP',           desc: '1000 XP to\'pladi' },
  { id: 'task_100',      emoji: '✅', name: 'Ishchan',           desc: '100 ta vazifa bajardi' },
  { id: 'level_5',       emoji: '🎯', name: '5-daraja',          desc: '5-darajaga yetdi' },
  { id: 'garden_house',  emoji: '🏠', name: 'Uy quruvchi',       desc: 'Bog\'da uy paydo bo\'ldi' },
  { id: 'all_subjects',  emoji: '📚', name: 'Bilimdon',          desc: '5+ fan qo\'shdi' },
  { id: 'note_10',       emoji: '📝', name: 'Yozuvchi',          desc: '10 ta eslatma yaratdi' },
  { id: 'focus_90',      emoji: '🎯', name: 'Super fokus',       desc: 'Fokus score 90+ ga yetdi' },
  { id: 'insight_gen',   emoji: '🔍', name: 'Tahlilchi',         desc: 'Birinchi haftalik tahlil' },
]

// ── MIDDLEWARE ────────────────────────────────────────────────────
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

// ── HELPERS ───────────────────────────────────────────────────────
function calcLevel(xp) { const t=[0,100,300,600,1000,1500,2100,2800,3600,4500,5500]; for(let i=t.length-1;i>=0;i--) if(xp>=t[i]) return i+1; return 1 }
function nextLevelXP(level) { const t=[0,100,300,600,1000,1500,2100,2800,3600,4500,5500]; return t[Math.min(level,t.length-1)] || 5500+(level-10)*1200 }
function todayStr() { return new Date().toISOString().split('T')[0] }

async function giveXP(userId, amount, reason) {
  const u = await User.findById(userId)
  const prevLevel = u.level
  u.xp += amount; u.level = calcLevel(u.xp)
  const today = todayStr()
  const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0]
  const twoDaysAgo = new Date(Date.now()-2*86400000).toISOString().split('T')[0]

  if (u.lastStudyDate !== today) {
    if (u.lastStudyDate === yesterday) {
      u.streak += 1
    } else if (u.lastStudyDate === twoDaysAgo && u.streakFreezeCount > 0 && u.streakFreezeUsedDate !== yesterday) {
      u.streak += 1; u.streakFreezeCount -= 1; u.streakFreezeUsedDate = yesterday
    } else if (!u.lastStudyDate) {
      u.streak = 1
    } else {
      u.streak = 1
    }
    u.lastStudyDate = today
  }

  // Focus score update
  const weekAgo = new Date(Date.now()-7*86400000).toISOString().split('T')[0]
  const recentChats = await Chat.countDocuments({ userId, role: 'user', createdAt: { $gte: new Date(weekAgo) } })
  u.focusScore = Math.min(100, Math.round((recentChats / 20) * 60 + (u.streak / 14) * 40))

  // Garden level
  const subjects = await Subject.find({ userId })
  const avgG = subjects.filter(s=>s.avgGrade>0).length ? Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length) : 0
  let gl = 0
  if (u.streak >= 3) gl++; if (u.streak >= 7) gl++
  if (u.xp >= 300) gl++; if (u.xp >= 800) gl++
  if (avgG >= 70) gl++; if (avgG >= 85) gl++
  if (u.streak >= 14) gl++
  u.gardenLevel = Math.min(6, gl)

  await u.save()

  // Check achievements
  const newAchievements = await checkAchievements(u)
  return { user: u, leveledUp: u.level > prevLevel, newAchievements }
}

async function checkAchievements(u) {
  const newOnes = []
  const existing = u.achievements.map(a => a.id)
  const checks = [
    { id: 'streak_3', cond: u.streak >= 3 },
    { id: 'streak_7', cond: u.streak >= 7 },
    { id: 'streak_30', cond: u.streak >= 30 },
    { id: 'xp_500', cond: u.xp >= 500 },
    { id: 'xp_1000', cond: u.xp >= 1000 },
    { id: 'level_5', cond: u.level >= 5 },
    { id: 'focus_90', cond: u.focusScore >= 90 },
    { id: 'garden_house', cond: u.gardenLevel >= 4 },
  ]
  for (const c of checks) {
    if (c.cond && !existing.includes(c.id)) {
      u.achievements.push({ id: c.id, unlockedAt: new Date() })
      newOnes.push(ACHIEVEMENTS.find(a => a.id === c.id))
    }
  }
  if (newOnes.length) await u.save()
  return newOnes
}

function sm2(card, q) {
  let { easeFactor: ef, interval, repetitions: rep } = card
  if (q >= 3) { interval = rep===0?1:rep===1?6:Math.round(interval*ef); rep++; ef=Math.max(1.3,ef+0.1-(5-q)*(0.08+(5-q)*0.02)) } else { rep=0; interval=1 }
  return { interval, easeFactor: ef, repetitions: rep, nextReview: new Date(Date.now()+interval*86400000).toISOString().split('T')[0] }
}

async function ensureRepeating(userId) {
  const today = todayStr()
  const uzDay = new Date().getDay()===0?6:new Date().getDay()-1
  const templates = await Schedule.find({ userId, repeat: { $in: ['daily','custom'] } })
  for (const t of templates) {
    let should = t.repeat==='daily' || (t.repeat==='custom' && t.repeatDays?.includes(uzDay))
    if (should) {
      const exists = await Schedule.findOne({ userId, title: t.title, date: today, repeat: 'none' })
      if (!exists) await Schedule.create({ userId, title: t.title, category: t.category, subjectName: t.subjectName, time: t.time, endTime: t.endTime, date: today, repeat: 'none', emoji: t.emoji, aiGenerated: t.aiGenerated })
    }
  }
}

// ── AI ─────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })

async function ai(messages, system, maxTokens=700) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, messages: [{ role:'system', content:system }, ...messages] }, { signal: ctrl.signal })
    clearTimeout(timer); return r.choices[0]?.message?.content || ''
  } catch(e) { clearTimeout(timer); return e.name==='AbortError'?'Vaqt tugadi.':'Xatolik: '+e.message }
}

function buildSystem(user, subjects=[]) {
  const lang = user?.lang||'uz'
  const langNote = lang==='uz'?'FAQAT o\'zbek tilida.':lang==='ru'?'ТОЛЬКО русский.':'ONLY English.'
  const subjList = subjects.map(s=>`${s.emoji}${s.name}(avg:${s.avgGrade||'?'})`).join(' | ')
  return `Sen StudyMind AI — halol, qattiq, real murabbiy. Ota kabi — maqtamaysan, yashirmaysan.
${langNote}
O'quvchi: ${user?.name}, ${user?.grade||''}, Lv.${user?.level}, Streak:${user?.streak}kun, Focus:${user?.focusScore||0}
Fanlar: ${subjList||'yo\'q'}
QOIDALAR:
1. MAX 3 qisqa gap. Bo'sh maqtov YO'Q.
2. Baho aytilsa: [GRADE:FanNomi:Ball]
3. Vaqt aytilsa: [STUDY:daqiqa]
4. Reja so'rasa: [SCHED:sarlavha:study/life:boshvaqt:endvaqt:none/daily]
5. Karta so'rasa: [FC:savol|javob]
6. Bugun: ${todayStr()}`
}

function extractFromAI(text) {
  const r = {}
  const gm = text.match(/\[GRADE:([^:]+):(\d+)\]/i)
  if (gm) r.grade = { subjectName: gm[1].trim(), score: parseInt(gm[2]) }
  const sm = text.match(/\[STUDY:(\d+)\]/i)
  if (sm) r.studyMinutes = parseInt(sm[1])
  const scm = text.match(/\[SCHED:([^:]+):([^:]+):([^:]*):([^:]*):([^\]]*)\]/i)
  if (scm) r.scheduleItem = { title: scm[1].trim(), category: scm[2].trim(), time: scm[3].trim(), endTime: scm[4].trim(), repeat: scm[5].trim() }
  const fcs = [...text.matchAll(/\[FC:([^|]+)\|([^\]]+)\]/gi)]
  if (fcs.length) r.flashcards = fcs.map(m => ({ front: m[1].trim(), back: m[2].trim() }))
  return r
}

function cleanText(t) {
  return t.replace(/\[GRADE:[^\]]+\]/gi,'').replace(/\[STUDY:[^\]]+\]/gi,'').replace(/\[SCHED:[^\]]+\]/gi,'').replace(/\[FC:[^\]]+\]/gi,'').replace(/\n{3,}/g,'\n\n').trim()
}

const QUOTES = {
  uz:[
    {text:"Muvaffaqiyat — har kuni kichik harakatlar yig'indisi.",author:"Robert Collier"},
    {text:"O'qish — eng kuchli qurol.",author:"Nelson Mandela"},
    {text:"Katta natijalar kichik odatlardan.",author:"James Clear"},
    {text:"Har bir ekspert bir vaqtlar yangi boshlovchi edi.",author:"Helen Hayes"},
    {text:"Bugun qilgan ish ertangi o'zingni shakllantiradi.",author:"Anonymous"},
    {text:"Bilim — boylikdan ustun.",author:"Alisher Navoiy"},
  ],
  ru:[
    {text:"Успех — это сумма небольших усилий каждого дня.",author:"Robert Collier"},
    {text:"Большие результаты начинаются с маленьких привычек.",author:"James Clear"},
    {text:"Знание — сила.",author:"Фрэнсис Бэкон"},
  ],
  en:[
    {text:"Success is the sum of small efforts repeated daily.",author:"Robert Collier"},
    {text:"Big results come from small daily habits.",author:"James Clear"},
    {text:"Knowledge is power.",author:"Francis Bacon"},
  ]
}

// ── AUTH ──────────────────────────────────────────────────────────
app.get('/auth/google', (req,res,next) => { if(!GOOGLE_ID) return res.redirect('/?error=no_google'); passport.authenticate('google',{scope:['profile','email']})(req,res,next) })
app.get('/auth/google/callback', passport.authenticate('google',{failureRedirect:'/?error=google'}), (req,res) => res.redirect('/app.html'))
app.post('/auth/telegram', async (req,res) => {
  const {telegramId,name,username}=req.body
  try { let u=await User.findOne({telegramId:String(telegramId)}); if(!u) u=await User.create({telegramId:String(telegramId),name,telegramUsername:username}); req.session.tid=u._id; res.json({ok:true}) }
  catch(e) { res.status(500).json({error:e.message}) }
})
app.post('/auth/logout', (req,res) => { req.session.destroy(); res.json({ok:true}) })

// ── USER ──────────────────────────────────────────────────────────
app.get('/api/user', auth, (req,res) => {
  const u=req.u
  res.json({ _id:u._id, name:u.name, email:u.email, avatar:u.avatar, lang:u.lang, theme:u.theme, grade:u.grade, school:u.school, xp:u.xp, level:u.level, streak:u.streak, streakFreezeCount:u.streakFreezeCount, totalStudyMinutes:u.totalStudyMinutes, focusScore:u.focusScore, gardenLevel:u.gardenLevel, gardenWater:u.gardenWater, gardenSun:u.gardenSun, achievements:u.achievements, savedQuotes:u.savedQuotes, onboarded:u.onboarded, isAdmin:u.isAdmin })
})
app.put('/api/user', auth, async (req,res) => {
  const fields=['lang','grade','school','name','theme','onboarded','notifEnabled']
  fields.forEach(f=>{ if(req.body[f]!==undefined) req.u[f]=req.body[f] })
  await req.u.save(); res.json({ok:true})
})
app.post('/api/user/save-quote', auth, async (req,res) => {
  const {text,author}=req.body
  req.u.savedQuotes=req.u.savedQuotes||[]
  if(!req.u.savedQuotes.find(q=>q.text===text)) {
    req.u.savedQuotes.push({text,author,savedAt:new Date()})
    if(req.u.savedQuotes.length>50) req.u.savedQuotes.shift()
    await req.u.save()
  }
  res.json({ok:true})
})
app.delete('/api/user/quote/:idx', auth, async (req,res) => {
  req.u.savedQuotes.splice(parseInt(req.params.idx),1)
  await req.u.save(); res.json({ok:true})
})

// Garden boosts
app.post('/api/garden/boost', auth, async (req,res) => {
  const {type}=req.body // water, sun, fertilizer
  const cost = {water:50, sun:100, fertilizer:200}
  if(req.u.xp < (cost[type]||50)) return res.status(400).json({error:'XP yetarli emas'})
  req.u.xp -= (cost[type]||50)
  if(type==='water') req.u.gardenWater=(req.u.gardenWater||0)+1
  if(type==='sun') req.u.gardenSun=(req.u.gardenSun||0)+1
  await req.u.save()
  res.json({ok:true, xp:req.u.xp, gardenWater:req.u.gardenWater, gardenSun:req.u.gardenSun})
})

// Streak freeze use
app.post('/api/user/freeze', auth, async (req,res) => {
  if(req.u.streakFreezeCount <= 0) return res.status(400).json({error:'Freeze qolmadi'})
  req.u.streakFreezeCount -= 1
  req.u.streakFreezeUsedDate = todayStr()
  await req.u.save()
  res.json({ok:true, streakFreezeCount:req.u.streakFreezeCount})
})

// Achievements
app.get('/api/achievements', auth, (req,res) => {
  const unlocked = req.u.achievements.map(a=>a.id)
  res.json(ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.includes(a.id), unlockedAt: req.u.achievements.find(ua=>ua.id===a.id)?.unlockedAt })))
})

app.get('/api/quote', auth, (req,res) => {
  const lang=req.u?.lang||'uz'
  const list=QUOTES[lang]||QUOTES.uz
  res.json(list[Math.floor(Math.random()*list.length)])
})

// ── SUBJECTS ──────────────────────────────────────────────────────
app.get('/api/subjects', auth, async (req,res) => res.json(await Subject.find({userId:req.u._id}).sort({createdAt:1})))
app.post('/api/subjects', auth, async (req,res) => {
  const {name,emoji,color,examDate}=req.body
  if(!name) return res.status(400).json({error:'name kerak'})
  const s = await Subject.create({userId:req.u._id,name,emoji:emoji||'📚',color:color||'#6c63ff',examDate})
  // Achievement check
  const count = await Subject.countDocuments({userId:req.u._id})
  if(count >= 5) {
    const u = await User.findById(req.u._id)
    if(!u.achievements.find(a=>a.id==='all_subjects')) {
      u.achievements.push({id:'all_subjects',unlockedAt:new Date()}); await u.save()
    }
  }
  res.json(s)
})
app.put('/api/subjects/:id', auth, async (req,res) => {
  const s=await Subject.findOneAndUpdate({_id:req.params.id,userId:req.u._id},req.body,{new:true})
  if(!s) return res.status(404).json({error:'Topilmadi'})
  res.json(s)
})
app.delete('/api/subjects/:id', auth, async (req,res) => { await Subject.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── AI CHAT ────────────────────────────────────────────────────────
app.get('/api/chat', auth, async (req,res) => res.json((await Chat.find({userId:req.u._id}).sort({createdAt:-1}).limit(40)).reverse()))

app.post('/api/chat', auth, async (req,res) => {
  const {message}=req.body
  if(!message?.trim()) return res.status(400).json({error:'message kerak'})
  const u=req.u, subjects=await Subject.find({userId:u._id})
  await Chat.create({userId:u._id,role:'user',content:message})

  // First chat achievement
  const chatCount = await Chat.countDocuments({userId:u._id,role:'user'})
  if(chatCount===1 && !u.achievements.find(a=>a.id==='first_chat')) {
    u.achievements.push({id:'first_chat',unlockedAt:new Date()}); await u.save()
  }

  const history = await Chat.find({userId:u._id,role:{$in:['user','assistant']}}).sort({createdAt:-1}).limit(14)
  const messages = history.reverse().map(m=>({role:m.role,content:m.content}))
  const rawReply = await ai(messages, buildSystem(u,subjects))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  if(extracted.grade) {
    const subj=subjects.find(s=>s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if(subj) {
      subj.gradeHistory.push({score:extracted.grade.score,date:todayStr()})
      subj.avgGrade=Math.round(subj.gradeHistory.reduce((a,g)=>a+g.score,0)/subj.gradeHistory.length)
      subj.progress=subj.avgGrade; await subj.save()
      // grade_90 achievement
      if(extracted.grade.score>=90) {
        const uu=await User.findById(u._id)
        if(!uu.achievements.find(a=>a.id==='grade_90')) { uu.achievements.push({id:'grade_90',unlockedAt:new Date()}); await uu.save() }
      }
    }
  }
  if(extracted.studyMinutes) { u.totalStudyMinutes+=extracted.studyMinutes; await u.save() }

  const {user:updUser, leveledUp, newAchievements} = await giveXP(u._id, 3)

  let savedSchedule=null
  if(extracted.scheduleItem) {
    const si=extracted.scheduleItem
    savedSchedule=await Schedule.create({userId:u._id,title:si.title,category:si.category==='life'?'life':'study',time:si.time,endTime:si.endTime,date:todayStr(),repeat:si.repeat==='daily'?'daily':'none',aiGenerated:true,emoji:si.category==='life'?'🌟':'📚'})
  }
  let savedCards=[]
  if(extracted.flashcards?.length) {
    for(const fc of extracted.flashcards) { const c=await Flashcard.create({userId:u._id,front:fc.front,back:fc.back,aiGenerated:true}); savedCards.push(c) }
  }

  await Chat.create({userId:u._id,role:'assistant',content:cleanReply,extractedData:extracted})
  res.json({reply:cleanReply,extracted,savedSchedule,savedCards,leveledUp,newAchievements,gardenLevel:updUser.gardenLevel,streak:updUser.streak,xp:updUser.xp})
})

app.post('/api/chat/flashcard', auth, async (req,res) => {
  const {subjectId,topic,count=5}=req.body
  const subj=subjectId?await Subject.findById(subjectId):null
  const topicName=topic||subj?.name||'umumiy'
  const prompt=`"${topicName}" mavzusi bo'yicha ${count} ta flashcard yarat.\nFormat:\nCARD1_FRONT: savol\nCARD1_BACK: javob\n...`
  const reply=await ai([{role:'user',content:prompt}],buildSystem(req.u,[]),900)
  const cards=[]
  for(let i=1;i<=count;i++) {
    const f=reply.match(new RegExp(`CARD${i}_FRONT:\\s*(.+?)(?=CARD\\d_FRONT:|$)`,'si'))?.[1]?.trim().split('\n')[0]
    const b=reply.match(new RegExp(`CARD${i}_BACK:\\s*(.+?)(?=CARD\\d_FRONT:|$)`,'si'))?.[1]?.trim().split('\n')[0]
    if(f&&b) { const c=await Flashcard.create({userId:req.u._id,subjectId,subjectName:subj?.name,topic:topicName,front:f,back:b,aiGenerated:true}); cards.push(c) }
  }
  res.json({cards,topic:topicName})
})

app.post('/api/chat/daily-plan', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id})
  const {topic}=req.body
  const tl=topic?`Mavzu: "${topic}".`:`Fanlar: ${subjects.map(s=>s.name).join(', ')||'yo\'q'}.`
  const prompt=`Bugungi o'quv rejasi. ${tl} Max 5 ta modda. Vaqt bilan (HH:MM formatda). Qisqa.`
  const plan=await ai([{role:'user',content:prompt}],buildSystem(u,subjects),400)
  const lines=plan.split('\n').filter(l=>l.trim()&&/^[\d\-•*]/.test(l.trim()))
  const saved=[]
  for(const line of lines.slice(0,5)) {
    const s=await Schedule.create({userId:u._id,title:line.replace(/^[\d\.\)\-•*]\s*/,'').trim(),date:todayStr(),category:'study',aiGenerated:true,emoji:'📚'})
    saved.push(s)
  }
  res.json({plan,schedule:saved})
})

app.post('/api/chat/insight', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id})
  const lang=u.lang||'uz'
  const langNote=lang==='uz'?'FAQAT o\'zbek tilida.':lang==='ru'?'ТОЛЬКО русский.':'ONLY English.'
  const weekChats=await Chat.countDocuments({userId:u._id,createdAt:{$gte:new Date(Date.now()-7*86400000)}})
  const prompt=`${langNote} O'quvchi tahlili:
Fanlar: ${JSON.stringify(subjects.map(s=>({n:s.name,avg:s.avgGrade})))}
O'qish: ${u.totalStudyMinutes}min, Streak: ${u.streak}kun, Focus: ${u.focusScore}, Suhbatlar: ${weekChats}

XULOSA: (2 gap)\nKUCHLI: (vergul)\nZAIF: (vergul)\nTAVSIYA: (3 ta)\nFOKUS: (0-100 son)`
  const reply=await ai([{role:'user',content:prompt}],`Halol tahlilchi. ${langNote}`,600)
  const ex=(k)=>reply.match(new RegExp(`${k}:\\s*(.+?)(?=\\n[A-Z]+:|$)`,'si'))?.[1]?.trim()||''
  const weekNum=Math.floor(Date.now()/(7*86400000))
  const focusNum=parseInt(ex('FOKUS'))||u.focusScore||0
  const ins=await Insight.findOneAndUpdate({userId:u._id,weekNumber:weekNum},{summary:ex('XULOSA'),strengths:ex('KUCHLI').split(',').map(s=>s.trim()).filter(Boolean),weaknesses:ex('ZAIF').split(',').map(s=>s.trim()).filter(Boolean),recommendations:ex('TAVSIYA').split(/\d+\./).map(s=>s.trim()).filter(Boolean),focusScore:focusNum,studyTime:u.totalStudyMinutes,generatedAt:new Date(),weekNumber:weekNum},{upsert:true,new:true})
  // Achievement
  if(!u.achievements.find(a=>a.id==='insight_gen')) { u.achievements.push({id:'insight_gen',unlockedAt:new Date()}); await u.save() }
  res.json(ins)
})

// ── FLASHCARDS ────────────────────────────────────────────────────
app.get('/api/flashcards', auth, async (req,res) => {
  const q={userId:req.u._id}
  if(req.query.dueOnly==='true') q.nextReview={$lte:todayStr()}
  if(req.query.subjectId) q.subjectId=req.query.subjectId
  res.json(await Flashcard.find(q).sort({nextReview:1}))
})
app.post('/api/flashcards', auth, async (req,res) => {
  const {front,back,subjectId,subjectName,topic}=req.body
  if(!front||!back) return res.status(400).json({error:'kerak'})
  res.json(await Flashcard.create({userId:req.u._id,subjectId,subjectName,topic,front,back}))
})
app.post('/api/flashcards/:id/review', auth, async (req,res) => {
  const card=await Flashcard.findOne({_id:req.params.id,userId:req.u._id})
  if(!card) return res.status(404).json({error:'Topilmadi'})
  const upd=sm2(card,req.body.quality); Object.assign(card,upd); await card.save()
  const xp=req.body.quality>=3?5:2
  const {user:u}=await giveXP(req.u._id,xp)
  // flashcard_50 achievement
  const reviewed=await Flashcard.countDocuments({userId:req.u._id,repetitions:{$gt:0}})
  if(reviewed>=50) {
    const uu=await User.findById(req.u._id)
    if(!uu.achievements.find(a=>a.id==='flashcard_50')) { uu.achievements.push({id:'flashcard_50',unlockedAt:new Date()}); await uu.save() }
  }
  res.json({...upd,xpEarned:xp})
})
app.delete('/api/flashcards/:id', auth, async (req,res) => { await Flashcard.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── SCHEDULE ──────────────────────────────────────────────────────
app.get('/api/schedule', auth, async (req,res) => {
  await ensureRepeating(req.u._id)
  const q={userId:req.u._id}
  if(req.query.templates==='true') q.repeat={$in:['daily','custom']}
  else { q.date=req.query.date||todayStr(); q.repeat='none' }
  if(req.query.category) q.category=req.query.category
  res.json(await Schedule.find(q).sort({time:1,createdAt:1}))
})
app.post('/api/schedule', auth, async (req,res) => {
  const {title,category,subjectName,time,endTime,date,repeat,repeatDays,emoji}=req.body
  if(!title) return res.status(400).json({error:'title kerak'})
  res.json(await Schedule.create({userId:req.u._id,title,category:category||'study',subjectName,time,endTime,date:date||todayStr(),repeat:repeat||'none',repeatDays:repeatDays||[],emoji:emoji||(category==='life'?'🌟':'📌')}))
})
app.patch('/api/schedule/:id', auth, async (req,res) => {
  const s=await Schedule.findOneAndUpdate({_id:req.params.id,userId:req.u._id},req.body,{new:true})
  if(req.body.isDone) {
    await giveXP(req.u._id,10)
    // task_100 achievement
    const done=await Schedule.countDocuments({userId:req.u._id,isDone:true})
    if(done>=100) {
      const uu=await User.findById(req.u._id)
      if(!uu.achievements.find(a=>a.id==='task_100')) { uu.achievements.push({id:'task_100',unlockedAt:new Date()}); await uu.save() }
    }
  }
  res.json(s)
})
app.delete('/api/schedule/:id', auth, async (req,res) => { await Schedule.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── NOTES ─────────────────────────────────────────────────────────
app.get('/api/notes', auth, async (req,res) => res.json(await Note.find({userId:req.u._id}).sort({isPinned:-1,updatedAt:-1})))
app.post('/api/notes', auth, async (req,res) => {
  const {title,content,subjectName,color,tags}=req.body
  const n=await Note.create({userId:req.u._id,title:title||'Yangi eslatma',content,subjectName,color:color||'#6c63ff',tags:tags||[]})
  // note_10 achievement
  const count=await Note.countDocuments({userId:req.u._id})
  if(count>=10) {
    const uu=await User.findById(req.u._id)
    if(!uu.achievements.find(a=>a.id==='note_10')) { uu.achievements.push({id:'note_10',unlockedAt:new Date()}); await uu.save() }
  }
  res.json(n)
})
app.put('/api/notes/:id', auth, async (req,res) => res.json(await Note.findOneAndUpdate({_id:req.params.id,userId:req.u._id},{...req.body,updatedAt:new Date()},{new:true})))
app.delete('/api/notes/:id', auth, async (req,res) => { await Note.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })
app.post('/api/notes/summarize', auth, async (req,res) => {
  const {content}=req.body
  if(!content) return res.status(400).json({error:'kerak'})
  res.json({summary:await ai([{role:'user',content:`Xulosalab ber:\n${content.slice(0,3000)}`}],buildSystem(req.u,[]),500)})
})

// ── STATS ─────────────────────────────────────────────────────────
app.get('/api/stats', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id})
  const dueCards=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
  await ensureRepeating(u._id)
  const todaySched=await Schedule.find({userId:u._id,date:todayStr(),repeat:'none'})
  const weekly=[]
  for(let i=6;i>=0;i--) {
    const d=new Date(Date.now()-i*86400000).toISOString().split('T')[0]
    const ds=await Schedule.find({userId:u._id,date:d,repeat:'none'})
    weekly.push({date:d,tasks:ds.length,done:ds.filter(s=>s.isDone).length,mins:0})
  }
  const lastInsight=await Insight.findOne({userId:u._id}).sort({generatedAt:-1})
  const avgGrade=subjects.filter(s=>s.avgGrade>0).length?Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length):0
  res.json({xp:u.xp,level:u.level,streak:u.streak,streakFreezeCount:u.streakFreezeCount,totalStudyMinutes:u.totalStudyMinutes,focusScore:u.focusScore,gardenLevel:u.gardenLevel,subjects,dueCards,todayTasks:todaySched.length,doneTasks:todaySched.filter(s=>s.isDone).length,weekly,lastInsight,avgGrade,urgentSubjects:subjects.filter(s=>{if(!s.examDate)return false;const d=Math.ceil((new Date(s.examDate)-new Date())/86400000);return d>=0&&d<=7})})
})
app.get('/api/insights', auth, async (req,res) => res.json(await Insight.find({userId:req.u._id}).sort({generatedAt:-1}).limit(4)))

// ── STATIC ────────────────────────────────────────────────────────
app.get('/ping', (_,res) => res.send('ok'))
app.get('/', (_,res) => res.sendFile(path.join(__dirname,'app.html')))
app.get('/app.html', (_,res) => res.sendFile(path.join(__dirname,'app.html')))

// ── TELEGRAM BOT ──────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN)
function appBtn() { return Markup.inlineKeyboard([[Markup.button.webApp('🌿 StudyMind',`${DOMAIN}/app.html`)]]) }

bot.start(async ctx => {
  const tid=String(ctx.from.id)
  let u=await User.findOne({telegramId:tid})
  if(!u) u=await User.create({telegramId:tid,name:ctx.from.first_name||'O\'quvchi',telegramUsername:ctx.from.username})
  await ctx.reply(`👋 Salom, *${u.name}*!\n\n🌿 *StudyMind* — aqlli o'quv assistentingiz.\n\nTilni tanlang:`,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback("🇺🇿 O'zbek",'lang_uz'),Markup.button.callback('🇷🇺 Русский','lang_ru'),Markup.button.callback('🇬🇧 English','lang_en')]])})
})

bot.action(/lang_(.+)/, async ctx => {
  const lang=ctx.match[1]
  await User.findOneAndUpdate({telegramId:String(ctx.from.id)},{lang})
  await ctx.editMessageText('✅ Til saqlandi!')
  await ctx.reply('Tayyor! Appni oching 👇', {...Markup.keyboard([['📊 Holat','🌿 Bog\'im'],['📅 Reja','🧠 AI'],['🌐 App']]).resize()})
})

bot.on('text', async ctx => {
  if(ctx.message.text.startsWith('/')) return
  const tid=String(ctx.from.id)
  const u=await User.findOne({telegramId:tid})
  if(!u) return ctx.reply('/start bosing')
  const txt=ctx.message.text
  if(txt==='📊 Holat') {
    const subjects=await Subject.find({userId:u._id})
    const due=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
    const avgG=subjects.filter(s=>s.avgGrade>0).length?Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length):0
    await ctx.reply(`📊 *${u.name}*\n\n🔥 Streak: *${u.streak}*\n⭐ Lv.*${u.level}* · *${u.xp}* XP\n🎯 Focus: *${u.focusScore||0}*\n📊 Baho: *${avgG||'—'}*\n🔁 Kartalar: *${due}*`,{parse_mode:'Markdown',...appBtn()})
    return
  }
  if(txt==='🌿 Bog\'im') {
    const g=['🌱','🌿','🌳','🌲','🏡','🌸','🌺'][Math.min(u.gardenLevel||0,6)]
    await ctx.reply(`${g} *Bog'ingiz: ${u.gardenLevel||0}/6 daraja*\n\n🔥 Streak: *${u.streak}* kun\n⭐ *${u.xp}* XP\n\n_O'qigan sari o'sadi!_`,{parse_mode:'Markdown',...appBtn()})
    return
  }
  if(txt==='📅 Reja') {
    await ensureRepeating(u._id)
    const sched=await Schedule.find({userId:u._id,date:todayStr(),repeat:'none'})
    if(!sched.length) { await ctx.reply('Reja yo\'q',{...Markup.inlineKeyboard([[Markup.button.callback('🧠 AI reja','gen_plan')]])}); return }
    await ctx.reply(`📅 *Bugungi reja*\n\n${sched.map(s=>`${s.isDone?'✅':'⬜'} ${s.emoji} ${s.title}${s.time?` · ${s.time}`:''}`).join('\n')}`,{parse_mode:'Markdown',...appBtn()})
    return
  }
  if(txt==='🧠 AI') { await ctx.reply('Savolingizni yozing 👇'); return }
  if(txt==='🌐 App') { await ctx.reply('📱 StudyMind:',appBtn()); return }

  await ctx.sendChatAction('typing')
  const subjects=await Subject.find({userId:u._id})
  const history=await Chat.find({userId:u._id}).sort({createdAt:-1}).limit(8)
  const messages=[...history.reverse().map(m=>({role:m.role,content:m.content})),{role:'user',content:txt}]
  await Chat.create({userId:u._id,role:'user',content:txt})
  const rawReply=await ai(messages,buildSystem(u,subjects))
  const extracted=extractFromAI(rawReply)
  const cleanReply=cleanText(rawReply)
  if(extracted.grade) { const subj=subjects.find(s=>s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase())); if(subj){subj.gradeHistory.push({score:extracted.grade.score,date:todayStr()});subj.avgGrade=Math.round(subj.gradeHistory.reduce((a,g)=>a+g.score,0)/subj.gradeHistory.length);await subj.save()} }
  if(extracted.studyMinutes){u.totalStudyMinutes+=extracted.studyMinutes;await u.save()}
  await giveXP(u._id,3)
  await Chat.create({userId:u._id,role:'assistant',content:cleanReply})
  await ctx.reply(cleanReply)
})

bot.action('gen_plan', async ctx => {
  const u=await User.findOne({telegramId:String(ctx.from.id)})
  if(!u) return
  await ctx.editMessageText('⏳ Reja tuzilmoqda...')
  const subjects=await Subject.find({userId:u._id})
  const plan=await ai([{role:'user',content:`Bugungi reja. Fanlar: ${subjects.map(s=>s.name).join(', ')||'yo\'q'}. Max 4 ta.`}],buildSystem(u,subjects),300)
  const lines=plan.split('\n').filter(l=>l.trim())
  for(const line of lines.slice(0,4)) await Schedule.create({userId:u._id,title:line.replace(/^[\d\.\)\-•*]\s*/,'').trim(),date:todayStr(),category:'study',aiGenerated:true})
  await ctx.editMessageText(`✅ Reja tayyor!\n\n${plan}`)
})

setInterval(async () => {
  const hour=new Date().getHours()
  if(hour!==7&&hour!==20) return
  const users=await User.find({telegramId:{$exists:true,$ne:null},notifEnabled:{$ne:false}})
  for(const u of users) {
    try {
      const ql=QUOTES[u.lang||'uz']||QUOTES.uz
      const q=ql[Math.floor(Math.random()*ql.length)]
      const due=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
      if(hour===7) {
        const g=['🌱','🌿','🌳','🌲','🏡','🌸','🌺'][Math.min(u.gardenLevel||0,6)]
        await bot.telegram.sendMessage(u.telegramId,`🌅 *Xayrli tong, ${u.name}!*\n\n${g} Bog': *${u.gardenLevel||0}* daraja\n🔥 Streak: *${u.streak}* kun\n${due>0?`🔁 *${due}* ta karta kutmoqda\n`:''}\n_"${q.text}"_\n— ${q.author}`,{parse_mode:'Markdown'})
      } else {
        await bot.telegram.sendMessage(u.telegramId,`🌙 *Bugun nima o'qidingiz, ${u.name}?*\n\n⭐ *${u.xp}* XP | 🔥 *${u.streak}* kun\n\nErtaga ham davom! 💪`,{parse_mode:'Markdown',...appBtn()})
      }
    } catch{}
  }
},60*60*1000)

bot.launch({dropPendingUpdates:true})
console.log('✅ Bot ishga tushdi')
app.listen(PORT,'0.0.0.0',()=>{ console.log(`✅ Server ${PORT}`); console.log('🌿 StudyMind v8.0') })
process.once('SIGINT',()=>bot.stop('SIGINT'))
process.once('SIGTERM',()=>bot.stop('SIGTERM'))