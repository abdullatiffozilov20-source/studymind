// StudyMind v8.0 — Full Backend
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
console.log('✅ MongoDB ulandi')

// ── SCHEMAS ──────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, sparse: true }, avatar: String,
  telegramId: { type: String, unique: true, sparse: true }, telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  theme: { type: String, default: 'dark', enum: ['dark', 'light'] },
  role: { type: String, default: 'student', enum: ['student','parent'] },
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family' },
  grade: String, school: String, gender: { type: String, default: 'female' },
  isAdmin: { type: Boolean, default: false },
  xp: { type: Number, default: 0 }, level: { type: Number, default: 1 },
  streak: { type: Number, default: 0 }, lastStudyDate: String,
  streakFreezeCount: { type: Number, default: 2 },
  streakFreezeUsed: { type: Boolean, default: false },
  totalStudyMinutes: { type: Number, default: 0 },
  focusScore: { type: Number, default: 0 },
  gardenLevel: { type: Number, default: 0 },
  gardenWater: { type: Number, default: 0 },
  gardenSun: { type: Number, default: 0 },
  achievements: [{ id: String, unlockedAt: Date }],
  savedQuotes: [{ text: String, author: String, savedAt: Date }],
  notifEnabled: { type: Boolean, default: true },
  lastNotifDay: String,
  createdAt: { type: Date, default: Date.now }
})

const SubjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String, emoji: { type: String, default: '📚' }, color: { type: String, default: '#6c5fff' },
  examDate: String, avgGrade: { type: Number, default: 0 },
  gradeHistory: [{ score: Number, date: String, note: String }],
  weeklyStudyMinutes: { type: Number, default: 0 },
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
  repeat: { type: String, enum: ['none', 'daily', 'custom'], default: 'none' },
  repeatDays: [Number], isDone: { type: Boolean, default: false },
  aiGenerated: { type: Boolean, default: false }, emoji: { type: String, default: '📌' },
  createdAt: { type: Date, default: Date.now }
})

const NoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String, content: String, subjectName: String,
  color: { type: String, default: '#6c5fff' }, isPinned: { type: Boolean, default: false },
  tags: [String], createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
})

const InsightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekNumber: Number, summary: String,
  strengths: [String], needsFocus: [String],
  recommendations: [String], learningStyle: String,
  studyTimeMinutes: Number, focusScore: Number,
  generatedAt: { type: Date, default: Date.now }
})

// ── JOURNAL & WELLBEING (privacy-first, ota-ona xom matnni hech qachon ko'rmaydi) ──
const JournalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: String, mood: { type: Number, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now }
})

const WellbeingSummarySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekStart: String,
  moodTrend: { type: String, enum: ['barqaror','pasaymoqda','yaxshilanmoqda'], default: 'barqaror' },
  stressLevel: { type: String, enum: ['past','orta','yuqori'], default: 'orta' },
  motivationLevel: { type: String, enum: ['past','orta','yuqori'], default: 'orta' },
  entriesCount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
})
WellbeingSummarySchema.index({ userId: 1, weekStart: 1 }, { unique: true })

// Xavf signali — faqat aniq xavf holatlarida. Xom matn HECH QACHON saqlanmaydi bu yerda.
const RiskAlertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  severity: { type: String, enum: ['medium','high'], default: 'high' },
  message: String,
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

// ── CAREER SUGGESTIONS ───────────────────────────────────────────
const CareerSuggestionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  careers: [{
    careerName: String,
    matchLevel: { type: String, enum: ['yuqori','orta','past'] },
    reasoning: String,
    roadmap: [{ year: Number, milestone: String }]
  }],
  generatedAt: { type: Date, default: Date.now }
})

// ── FAMILY / PARENT LINK ─────────────────────────────────────────
const FamilySchema = new mongoose.Schema({
  inviteCode: { type: String, unique: true },
  parentUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  studentUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  studentName: String,
  createdAt: { type: Date, default: Date.now }
})

const User = mongoose.model('User', UserSchema)
const Subject = mongoose.model('Subject', SubjectSchema)
const Chat = mongoose.model('Chat', ChatSchema)
const Flashcard = mongoose.model('Flashcard', FlashcardSchema)
const Schedule = mongoose.model('Schedule', ScheduleSchema)
const Note = mongoose.model('Note', NoteSchema)
const Insight = mongoose.model('Insight', InsightSchema)
const Journal = mongoose.model('Journal', JournalSchema)
const WellbeingSummary = mongoose.model('WellbeingSummary', WellbeingSummarySchema)
const RiskAlert = mongoose.model('RiskAlert', RiskAlertSchema)
const CareerSuggestion = mongoose.model('CareerSuggestion', CareerSuggestionSchema)
const Family = mongoose.model('Family', FamilySchema)

// ── MIDDLEWARE ───────────────────────────────────────────────────
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

// ── HELPERS ──────────────────────────────────────────────────────
function calcLevel(xp) { const t=[0,100,250,500,900,1400,2000,2800,3800,5000,6500,8500]; for(let i=t.length-1;i>=0;i--) if(xp>=t[i]) return i+1; return 1 }
function todayStr() { return new Date().toISOString().split('T')[0] }

const ACHIEVEMENTS = [
  { id:'first_chat', emoji:'💬', name:'Birinchi suhbat', desc:'AI bilan birinchi gaplashdingiz' },
  { id:'streak_3', emoji:'🔥', name:'3 kunlik streak', desc:'3 kun ketma-ket o\'qidingiz' },
  { id:'streak_7', emoji:'🔥', name:'Haftalik streak', desc:'7 kun to\'xtovsiz' },
  { id:'streak_30', emoji:'👑', name:'Oylik streak', desc:'30 kun - siz championsingiz!' },
  { id:'grade_90', emoji:'⭐', name:'A+ Talaba', desc:'Biror fanda 90+ ball' },
  { id:'flashcard_50', emoji:'🔁', name:'Karta ustasi', desc:'50 ta karta bajardingiz' },
  { id:'level_5', emoji:'🏆', name:'5-daraja', desc:'5-darajaga yetdingiz' },
  { id:'garden_house', emoji:'🏠', name:'Uy qurildi', desc:'Bog\'ingizda uy paydo bo\'ldi' },
]

async function checkAchievements(user) {
  const newAch = []
  const hasAch = (id) => user.achievements?.some(a => a.id === id)
  if (!hasAch('streak_3') && user.streak >= 3) newAch.push('streak_3')
  if (!hasAch('streak_7') && user.streak >= 7) newAch.push('streak_7')
  if (!hasAch('streak_30') && user.streak >= 30) newAch.push('streak_30')
  if (!hasAch('level_5') && user.level >= 5) newAch.push('level_5')
  for (const id of newAch) {
    user.achievements = user.achievements || []
    user.achievements.push({ id, unlockedAt: new Date() })
  }
  if (newAch.length) await user.save()
  return newAch
}

async function giveXP(userId, amount) {
  const u = await User.findById(userId)
  const prev = u.level; u.xp += amount; u.level = calcLevel(u.xp)
  const today = todayStr(), yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0]
  if (u.lastStudyDate !== today) {
    if (u.lastStudyDate === yesterday) { u.streak += 1; u.streakFreezeUsed = false }
    else if (!u.lastStudyDate) { u.streak = 1 }
    else {
      const twoDaysAgo = new Date(Date.now()-2*86400000).toISOString().split('T')[0]
      if (u.lastStudyDate === twoDaysAgo && !u.streakFreezeUsed) { u.streak += 1; u.streakFreezeUsed = true }
      else { u.streak = 1; u.streakFreezeUsed = false }
    }
    u.lastStudyDate = today
  }
  // Update focus score (rolling avg)
  u.focusScore = Math.min(100, Math.round(u.focusScore * 0.9 + (amount > 20 ? 10 : 5)))
  const subjects = await Subject.find({ userId })
  u.gardenLevel = calcGardenLevel(u, subjects)
  await u.save()
  const newAch = await checkAchievements(u)
  return { user: u, leveledUp: u.level > prev, newAchievements: newAch }
}

function calcGardenLevel(user, subjects) {
  let score = 0
  if (user.streak >= 3) score++
  if (user.streak >= 7) score++
  if (user.streak >= 14) score++
  if (user.streak >= 30) score++
  if (user.xp >= 500) score++
  if (user.xp >= 1500) score++
  const avg = subjects?.filter(s=>s.avgGrade>0).length ? Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length) : 0
  if (avg >= 70) score++
  if (avg >= 85) score++
  return Math.min(7, score)
}

function sm2(card, q) {
  let { easeFactor: ef, interval, repetitions: rep } = card
  if (q >= 3) { interval = rep===0?1:rep===1?6:Math.round(interval*ef); rep++; ef=Math.max(1.3,ef+0.1-(5-q)*(0.08+(5-q)*0.02)) } else { rep=0; interval=1 }
  return { interval, easeFactor: ef, repetitions: rep, nextReview: new Date(Date.now()+interval*86400000).toISOString().split('T')[0] }
}

async function ensureRepeating(userId) {
  const today = todayStr(), uzDay = new Date().getDay()===0?6:new Date().getDay()-1
  const templates = await Schedule.find({ userId, repeat: { $in: ['daily','custom'] } })
  for (const t of templates) {
    const should = t.repeat==='daily' || (t.repeat==='custom' && t.repeatDays?.includes(uzDay))
    if (should) {
      const exists = await Schedule.findOne({ userId, title: t.title, date: today, repeat: 'none' })
      if (!exists) await Schedule.create({ userId, title: t.title, category: t.category, subjectName: t.subjectName, time: t.time, date: today, repeat: 'none', emoji: t.emoji, aiGenerated: t.aiGenerated })
    }
  }
}

// ── AI ──────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })

async function ai(messages, system, maxTokens = 700) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }, { signal: ctrl.signal })
    clearTimeout(timer); return r.choices[0]?.message?.content || ''
  } catch (e) { clearTimeout(timer); return e.name==='AbortError'?'Vaqt tugadi.':'Xatolik: '+e.message }
}

function buildSystem(user, subjects = []) {
  const lang = user?.lang || 'uz'
  const langNote = lang==='uz'?'FAQAT o\'zbek tilida.':lang==='ru'?'ТОЛЬКО русский.':'ONLY English.'
  const subjList = subjects.map(s=>`${s.emoji}${s.name}(avg:${s.avgGrade||'?'})`).join(' | ')
  return `Sen StudyMind AI — halol va qattiq murabbiy. ${langNote}
O'quvchi: ${user?.name}, ${user?.grade||''}, Lv.${user?.level}, Streak:${user?.streak}, FocusScore:${user?.focusScore||0}
Fanlar: ${subjList||'yo\'q'}
QOIDALAR:
1. MAX 3 qisqa gap. Bo'sh maqtov YO'Q.
2. Baho: [GRADE:FanNomi:Ball]
3. Vaqt: [STUDY:daqiqa]
4. Reja: [SCHED:sarlavha:study/life:vaqt:none/daily]
5. Karta: [FC:savol|javob]
6. Bugun: ${todayStr()}`
}

function extractFromAI(text) {
  const r = {}
  const gm = text.match(/\[GRADE:([^:]+):(\d+)\]/i); if (gm) r.grade = { subjectName: gm[1].trim(), score: parseInt(gm[2]) }
  const sm = text.match(/\[STUDY:(\d+)\]/i); if (sm) r.studyMinutes = parseInt(sm[1])
  const scm = text.match(/\[SCHED:([^:]+):([^:]+):([^:]*):([^\]]*)\]/i)
  if (scm) r.scheduleItem = { title: scm[1].trim(), category: scm[2].trim(), time: scm[3].trim(), repeat: scm[4].trim() }
  const fcs = [...text.matchAll(/\[FC:([^|]+)\|([^\]]+)\]/gi)]
  if (fcs.length) r.flashcards = fcs.map(m => ({ front: m[1].trim(), back: m[2].trim() }))
  return r
}

function cleanText(t) {
  return t.replace(/\[GRADE:[^\]]+\]/gi,'').replace(/\[STUDY:[^\]]+\]/gi,'').replace(/\[SCHED:[^\]]+\]/gi,'').replace(/\[FC:[^\]]+\]/gi,'').replace(/\n{3,}/g,'\n\n').trim()
}

// ── WELLBEING ANALYSIS (privacy-first) ──────────────────────────
// Xom journal matni HECH QACHON qaytarilmaydi yoki boshqa joyga yozilmaydi.
// Faqat agregat trend + juda ehtiyotkor xavf signali chiqariladi.
async function analyzeWellbeing(journalText, mood) {
  const system = `Sen journal yozuvini tahlil qiluvchi maxfiy AI tizimisan.
Faqat quyidagi JSON formatda javob ber, hech qanday boshqa matn yozma:
{
  "mood_trend": "barqaror" | "pasaymoqda" | "yaxshilanmoqda",
  "stress_level": "past" | "orta" | "yuqori",
  "motivation_level": "past" | "orta" | "yuqori",
  "crisis_detected": false
}
crisis_detected FAQAT haqiqiy, aniq va to'g'ridan-to'g'ri xavf belgilari bo'lsa true bo'ladi:
o'z joniga qasd qilish haqida aniq fikr/niyat, og'ir o'zini-o'zi jarohatlash haqida yozuv,
yoki boshqa kishi tomonidan jiddiy zo'ravonlik haqida aniq yozuv.
Bu juda yuqori chegara — oddiy stress, xafagarchilik, charchoq, imtihon qo'rquvi,
do'stlar bilan janjal kabi narsalar crisis EMAS. Shubha bo'lsa ham false qaytar —
faqat 100% aniq bo'lganda true qil.`
  const user = `Kayfiyat balli (1-5): ${mood}\nYozuv: ${journalText}`
  const reply = await ai([{role:'user',content:user}], system, 200)
  const text = reply.replace(/```json|```/g,'').trim()
  try {
    const parsed = JSON.parse(text)
    return {
      mood_trend: ['barqaror','pasaymoqda','yaxshilanmoqda'].includes(parsed.mood_trend) ? parsed.mood_trend : 'barqaror',
      stress_level: ['past','orta','yuqori'].includes(parsed.stress_level) ? parsed.stress_level : 'orta',
      motivation_level: ['past','orta','yuqori'].includes(parsed.motivation_level) ? parsed.motivation_level : 'orta',
      crisis_detected: parsed.crisis_detected === true
    }
  } catch {
    return { mood_trend:'barqaror', stress_level:'orta', motivation_level:'orta', crisis_detected:false }
  }
}

function getWeekStart() {
  const d = new Date()
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().split('T')[0]
}

// ── CAREER SUGGESTIONS ───────────────────────────────────────────
async function generateCareerSuggestions(user, subjects) {
  const system = `Sen karyera maslahatchisi AI'san. O'quvchi ma'lumotlari asosida 5 ta kasb
tavsiya qil. FAQAT JSON massiv qaytar, boshqa hech narsa yozma:
[{"career_name":"...","match_level":"yuqori"|"orta"|"past","reasoning":"qisqa bir jumla","roadmap":[{"year":2026,"milestone":"..."}]}]
match_level uchun aniq foiz ishlatma. O'zbek tilida yoz.`
  const user2 = `O'quvchi: ${user.name}, ${user.grade}
Baholar: ${JSON.stringify(subjects.map(s=>({fan:s.name,bal:s.avgGrade})))}
Kuchli fanlar: ${subjects.filter(s=>s.avgGrade>=75).map(s=>s.name).join(', ')||'aniqlanmagan'}`
  const reply = await ai([{role:'user',content:user2}], system, 900)
  const text = reply.replace(/```json|```/g,'').trim()
  try { return JSON.parse(text) } catch { return [] }
}

const QUOTES = {
  uz:[
    {text:"Muvaffaqiyat — har kuni kichik harakatlar yig'indisi.",author:"Robert Collier"},
    {text:"Katta natijalar kichik odatlardan boshlanadi.",author:"James Clear"},
    {text:"Har bir ekspert bir vaqtlar yangi boshlovchi edi.",author:"Helen Hayes"},
    {text:"Bugun qilgan ish ertangi o'zingni shakllantiradi.",author:"Anonymous"},
    {text:"O'qish — eng kuchli qurol.",author:"Nelson Mandela"},
  ],
  ru:[
    {text:"Успех — это сумма небольших усилий каждого дня.",author:"Robert Collier"},
    {text:"Большие результаты начинаются с маленьких привычек.",author:"James Clear"},
  ],
  en:[
    {text:"Success is the sum of small efforts repeated daily.",author:"Robert Collier"},
    {text:"Big results come from small daily habits.",author:"James Clear"},
    {text:"Every expert was once a beginner.",author:"Helen Hayes"},
  ]
}

// ── AUTH ────────────────────────────────────────────────────────
app.get('/auth/google', (req,res,next) => { if(!GOOGLE_ID) return res.redirect('/?error=no_google'); passport.authenticate('google',{scope:['profile','email']})(req,res,next) })
app.get('/auth/google/callback', passport.authenticate('google',{failureRedirect:'/?error=google'}), (req,res) => res.redirect('/app.html'))
app.post('/auth/telegram', async (req,res) => {
  const {telegramId,name,username}=req.body
  try { let u=await User.findOne({telegramId:String(telegramId)}); if(!u) u=await User.create({telegramId:String(telegramId),name,telegramUsername:username}); req.session.tid=u._id; res.json({ok:true}) }
  catch(e) { res.status(500).json({error:e.message}) }
})
app.post('/auth/logout', (req,res) => { req.session.destroy(); res.json({ok:true}) })

// ── USER ────────────────────────────────────────────────────────
app.get('/api/user', auth, (req,res) => {
  const u=req.u
  res.json({_id:u._id,name:u.name,email:u.email,avatar:u.avatar,lang:u.lang,theme:u.theme,role:u.role,familyId:u.familyId,grade:u.grade,school:u.school,gender:u.gender,xp:u.xp,level:u.level,streak:u.streak,streakFreezeCount:u.streakFreezeCount,totalStudyMinutes:u.totalStudyMinutes,focusScore:u.focusScore,gardenLevel:u.gardenLevel,achievements:u.achievements,savedQuotes:u.savedQuotes,isAdmin:u.isAdmin})
})
app.put('/api/user', auth, async (req,res) => {
  const fields=['lang','grade','school','name','theme','gender','notifEnabled','role']
  fields.forEach(f=>{ if(req.body[f]!==undefined) req.u[f]=req.body[f] })
  await req.u.save(); res.json({ok:true})
})
app.post('/api/user/save-quote', auth, async (req,res) => {
  const {text,author}=req.body; req.u.savedQuotes=req.u.savedQuotes||[]
  req.u.savedQuotes.push({text,author,savedAt:new Date()})
  if(req.u.savedQuotes.length>30) req.u.savedQuotes.shift()
  await req.u.save(); res.json({ok:true})
})
app.post('/api/user/use-freeze', auth, async (req,res) => {
  if(req.u.streakFreezeCount<=0) return res.status(400).json({error:'Freeze qolmagan'})
  req.u.streakFreezeCount--; req.u.streakFreezeUsed=true
  req.u.lastStudyDate=todayStr(); await req.u.save(); res.json({ok:true,remaining:req.u.streakFreezeCount})
})
app.get('/api/quote', auth, (req,res) => {
  const lang=req.u?.lang||'uz'; const list=QUOTES[lang]||QUOTES.uz
  res.json(list[Math.floor(Math.random()*list.length)])
})
app.get('/api/achievements', auth, (req,res) => {
  const userAch = req.u.achievements||[]
  const all = ACHIEVEMENTS.map(a=>({ ...a, unlocked:userAch.some(ua=>ua.id===a.id), unlockedAt:userAch.find(ua=>ua.id===a.id)?.unlockedAt }))
  res.json(all)
})

// ── SUBJECTS ────────────────────────────────────────────────────
app.get('/api/subjects', auth, async (req,res) => res.json(await Subject.find({userId:req.u._id}).sort({createdAt:1})))
app.post('/api/subjects', auth, async (req,res) => {
  const {name,emoji,color,examDate}=req.body; if(!name) return res.status(400).json({error:'name kerak'})
  res.json(await Subject.create({userId:req.u._id,name,emoji:emoji||'📚',color:color||'#6c5fff',examDate}))
})
app.put('/api/subjects/:id', auth, async (req,res) => {
  res.json(await Subject.findOneAndUpdate({_id:req.params.id,userId:req.u._id},req.body,{new:true}))
})
app.delete('/api/subjects/:id', auth, async (req,res) => { await Subject.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── AI CHAT ─────────────────────────────────────────────────────
app.get('/api/chat', auth, async (req,res) => res.json((await Chat.find({userId:req.u._id}).sort({createdAt:-1}).limit(40)).reverse()))
app.post('/api/chat', auth, async (req,res) => {
  const {message}=req.body; if(!message?.trim()) return res.status(400).json({error:'message kerak'})
  const u=req.u, subjects=await Subject.find({userId:u._id})
  await Chat.create({userId:u._id,role:'user',content:message})
  const history=await Chat.find({userId:u._id,role:{$in:['user','assistant']}}).sort({createdAt:-1}).limit(12)
  const messages=history.reverse().map(m=>({role:m.role,content:m.content}))
  const rawReply=await ai(messages,buildSystem(u,subjects))
  const extracted=extractFromAI(rawReply)
  const cleanReply=cleanText(rawReply)

  if(extracted.grade) {
    const subj=subjects.find(s=>s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if(subj) { subj.gradeHistory.push({score:extracted.grade.score,date:todayStr()}); subj.avgGrade=Math.round(subj.gradeHistory.reduce((a,g)=>a+g.score,0)/subj.gradeHistory.length); subj.progress=subj.avgGrade; await subj.save() }
  }
  if(extracted.studyMinutes) { u.totalStudyMinutes+=extracted.studyMinutes; await u.save() }

  const {user:updUser, leveledUp, newAchievements}=await giveXP(u._id, 5)
  let savedSchedule=null
  if(extracted.scheduleItem) {
    const si=extracted.scheduleItem
    savedSchedule=await Schedule.create({userId:u._id,title:si.title,category:si.category==='life'?'life':'study',time:si.time,date:todayStr(),repeat:si.repeat==='daily'?'daily':'none',aiGenerated:true,emoji:si.category==='life'?'🌟':'📚'})
  }
  let savedCards=[]
  if(extracted.flashcards?.length) {
    for(const fc of extracted.flashcards) savedCards.push(await Flashcard.create({userId:u._id,front:fc.front,back:fc.back,aiGenerated:true}))
  }
  await Chat.create({userId:u._id,role:'assistant',content:cleanReply,extractedData:extracted})
  res.json({reply:cleanReply,extracted,savedSchedule,savedCards,gardenLevel:updUser.gardenLevel,streak:updUser.streak,xp:updUser.xp,level:updUser.level,leveledUp,newAchievements})
})

app.post('/api/chat/flashcard', auth, async (req,res) => {
  const {subjectId,topic,count=5}=req.body
  const subj=subjectId?await Subject.findById(subjectId):null
  const topicName=topic||subj?.name||'umumiy'
  const prompt=`"${topicName}" mavzusi bo'yicha ${count} ta flashcard.\nFormat:\nCARD1_FRONT: savol\nCARD1_BACK: javob\n...`
  const reply=await ai([{role:'user',content:prompt}],buildSystem(req.u,[]),900)
  const cards=[]
  for(let i=1;i<=count;i++) {
    const f=reply.match(new RegExp(`CARD${i}_FRONT:\\s*(.+?)(?=CARD\\d_FRONT:|$)`,'si'))?.[1]?.trim().split('\n')[0]
    const b=reply.match(new RegExp(`CARD${i}_BACK:\\s*(.+?)(?=CARD\\d_FRONT:|$)`,'si'))?.[1]?.trim().split('\n')[0]
    if(f&&b) cards.push(await Flashcard.create({userId:req.u._id,subjectId,subjectName:subj?.name,topic:topicName,front:f,back:b,aiGenerated:true}))
  }
  res.json({cards,topic:topicName})
})

app.post('/api/chat/daily-plan', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id}), {topic}=req.body
  const tl=topic?`Mavzu: "${topic}".`:`Fanlar: ${subjects.map(s=>s.name).join(', ')||'yo\'q'}.`
  const plan=await ai([{role:'user',content:`Bugungi o'quv rejasi. ${tl} Max 5 ta modda. Qisqa.`}],buildSystem(u,subjects),400)
  const lines=plan.split('\n').filter(l=>l.trim()&&/^[\d\-•*]/.test(l.trim()))
  const saved=[]
  for(const line of lines.slice(0,5)) saved.push(await Schedule.create({userId:u._id,title:line.replace(/^[\d\.\)\-•*]\s*/,'').trim(),date:todayStr(),category:'study',aiGenerated:true,emoji:'📚'}))
  res.json({plan,schedule:saved})
})

app.post('/api/chat/insight', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id})
  const lang=u.lang||'uz'
  const langNote=lang==='uz'?'FAQAT o\'zbek.':lang==='ru'?'ТОЛЬКО русский.':'ONLY English.'
  const avgG=subjects.filter(s=>s.avgGrade>0).length?Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length):0
  const prompt=`${langNote} O'quvchi haftalik tahlili:
Fanlar: ${JSON.stringify(subjects.map(s=>({n:s.name,avg:s.avgGrade})))}
O'qish: ${u.totalStudyMinutes}min, Streak: ${u.streak}kun, FocusScore: ${u.focusScore}

KUCHLI: (vergul bilan — kuchli fanlar)
FOCUS: (vergul bilan — zaif fanlar)
TAVSIYA: (3 ta, raqamlangan)
USLUB: (bir so'z)`
  const reply=await ai([{role:'user',content:prompt}],`Halol tahlilchi. ${langNote}`,800)
  const ex=(k)=>reply.match(new RegExp(`${k}:\\s*(.+?)(?=\\n[A-Z]+:|$)`,'si'))?.[1]?.trim()||''
  const weekNum=Math.floor(Date.now()/(7*86400000))
  const ins=await Insight.findOneAndUpdate({userId:u._id,weekNumber:weekNum},{
    strengths:ex('KUCHLI').split(',').map(s=>s.trim()).filter(Boolean),
    needsFocus:ex('FOCUS').split(',').map(s=>s.trim()).filter(Boolean),
    recommendations:ex('TAVSIYA').split(/\d+\./).map(s=>s.trim()).filter(Boolean),
    learningStyle:ex('USLUB'), studyTimeMinutes:u.totalStudyMinutes,
    focusScore:u.focusScore, generatedAt:new Date(), weekNumber:weekNum
  },{upsert:true,new:true})
  res.json(ins)
})

// ── FLASHCARDS ──────────────────────────────────────────────────
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
  const xp=req.body.quality>=3?8:3; const res2=await giveXP(req.u._id,xp)
  const totalDone=await Flashcard.countDocuments({userId:req.u._id,repetitions:{$gt:0}})
  if(totalDone>=50 && !res2.user.achievements?.some(a=>a.id==='flashcard_50')) {
    res2.user.achievements.push({id:'flashcard_50',unlockedAt:new Date()}); await res2.user.save()
  }
  res.json({...upd,xpEarned:xp,newAchievements:res2.newAchievements})
})
app.delete('/api/flashcards/:id', auth, async (req,res) => { await Flashcard.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── SCHEDULE ────────────────────────────────────────────────────
app.get('/api/schedule', auth, async (req,res) => {
  await ensureRepeating(req.u._id)
  const q={userId:req.u._id}
  if(req.query.templates==='true') q.repeat={$in:['daily','custom']}
  else { q.date=req.query.date||todayStr(); q.repeat='none' }
  if(req.query.category) q.category=req.query.category
  res.json(await Schedule.find(q).sort({time:1,createdAt:1}))
})
app.post('/api/schedule', auth, async (req,res) => {
  const {title,category,subjectName,time,date,repeat,repeatDays,emoji}=req.body
  if(!title) return res.status(400).json({error:'title kerak'})
  res.json(await Schedule.create({userId:req.u._id,title,category:category||'study',subjectName,time,date:date||todayStr(),repeat:repeat||'none',repeatDays:repeatDays||[],emoji:emoji||(category==='life'?'🌟':'📌')}))
})
app.patch('/api/schedule/:id', auth, async (req,res) => {
  const s=await Schedule.findOneAndUpdate({_id:req.params.id,userId:req.u._id},req.body,{new:true})
  if(req.body.isDone) await giveXP(req.u._id,10)
  res.json(s)
})
app.delete('/api/schedule/:id', auth, async (req,res) => { await Schedule.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── NOTES ───────────────────────────────────────────────────────
app.get('/api/notes', auth, async (req,res) => res.json(await Note.find({userId:req.u._id}).sort({isPinned:-1,updatedAt:-1})))
app.post('/api/notes', auth, async (req,res) => {
  const {title,content,subjectName,color,tags}=req.body
  res.json(await Note.create({userId:req.u._id,title:title||'Yangi eslatma',content,subjectName,color:color||'#6c5fff',tags:tags||[]}))
})
app.put('/api/notes/:id', auth, async (req,res) => res.json(await Note.findOneAndUpdate({_id:req.params.id,userId:req.u._id},{...req.body,updatedAt:new Date()},{new:true})))
app.delete('/api/notes/:id', auth, async (req,res) => { await Note.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })
app.post('/api/notes/summarize', auth, async (req,res) => {
  const {content}=req.body; if(!content) return res.status(400).json({error:'kerak'})
  res.json({summary:await ai([{role:'user',content:`Xulosalab ber:\n${content.slice(0,3000)}`}],buildSystem(req.u,[]),500)})
})

// ── JOURNAL & WELLBEING ───────────────────────────────────────────
app.get('/api/journal', auth, async (req,res) => {
  res.json(await Journal.find({userId:req.u._id}).sort({createdAt:-1}).limit(30))
})
app.post('/api/journal', auth, async (req,res) => {
  const {content,mood}=req.body
  if(!content?.trim()) return res.status(400).json({error:'Yozuv kerak'})
  await Journal.create({userId:req.u._id,content,mood:mood||3})

  // AI tahlil — xom matn faqat shu yerda ko'rinadi, boshqa joyga yozilmaydi
  const analysis = await analyzeWellbeing(content, mood||3)
  const weekStart = getWeekStart()
  const prevCount = await Journal.countDocuments({userId:req.u._id})
  await WellbeingSummary.findOneAndUpdate(
    {userId:req.u._id,weekStart},
    {moodTrend:analysis.mood_trend,stressLevel:analysis.stress_level,motivationLevel:analysis.motivation_level,entriesCount:prevCount,updatedAt:new Date()},
    {upsert:true,new:true}
  )

  let alertCreated=false
  if(analysis.crisis_detected) {
    await RiskAlert.create({
      userId:req.u._id, severity:'high',
      message:"Farzandingizning so'nggi yozuvlarida ehtiyot bo'lish kerak bo'lgan belgilar aniqlandi. Bu tibbiy tashxis emas — uning bilan yaqindan gaplashishni va zarur bo'lsa mutaxassisga (psixolog) murojaat qilishni tavsiya qilamiz."
    })
    alertCreated=true
  }
  await giveXP(req.u._id, 4)
  res.json({ok:true,crisisDetected:alertCreated})
})

app.get('/api/wellbeing', auth, async (req,res) => {
  const summaries = await WellbeingSummary.find({userId:req.u._id}).sort({weekStart:-1}).limit(8)
  res.json(summaries)
})

// ── CAREER ──────────────────────────────────────────────────────
app.get('/api/career', auth, async (req,res) => {
  const latest = await CareerSuggestion.findOne({userId:req.u._id}).sort({generatedAt:-1})
  res.json(latest)
})
app.post('/api/career/generate', auth, async (req,res) => {
  const subjects = await Subject.find({userId:req.u._id})
  if(!subjects.length) return res.status(400).json({error:'Avval fan qo\'shing'})
  const careers = await generateCareerSuggestions(req.u, subjects)
  const saved = await CareerSuggestion.create({
    userId:req.u._id,
    careers:careers.map(c=>({careerName:c.career_name,matchLevel:c.match_level,reasoning:c.reasoning,roadmap:c.roadmap||[]}))
  })
  await giveXP(req.u._id, 8)
  res.json(saved)
})

// ── FAMILY / PARENT LINK ──────────────────────────────────────────
function genInviteCode() {
  return Math.random().toString(36).substring(2,8).toUpperCase()
}
app.post('/api/family/create', auth, async (req,res) => {
  if(req.u.role!=='parent') return res.status(403).json({error:'Faqat ota-ona uchun'})
  const existing = await Family.findOne({parentUserId:req.u._id})
  if(existing) return res.json(existing)
  const fam = await Family.create({inviteCode:genInviteCode(),parentUserId:req.u._id})
  req.u.familyId=fam._id; await req.u.save()
  res.json(fam)
})
app.post('/api/family/join', auth, async (req,res) => {
  const {inviteCode}=req.body
  const fam = await Family.findOne({inviteCode:inviteCode?.toUpperCase()})
  if(!fam) return res.status(404).json({error:'Kod topilmadi'})
  fam.studentUserId=req.u._id; fam.studentName=req.u.name; await fam.save()
  req.u.familyId=fam._id; await req.u.save()
  res.json(fam)
})
app.get('/api/family/me', auth, async (req,res) => {
  if(!req.u.familyId) return res.json(null)
  res.json(await Family.findById(req.u.familyId))
})
app.get('/api/family/student-overview', auth, async (req,res) => {
  // Faqat ota-ona, faqat agregat ma'lumot — xom journal yo'q
  if(req.u.role!=='parent') return res.status(403).json({error:'Ruxsat yo\'q'})
  const fam = await Family.findById(req.u.familyId)
  if(!fam?.studentUserId) return res.json(null)
  const student = await User.findById(fam.studentUserId)
  if(!student) return res.json(null)
  const subjects = await Subject.find({userId:student._id})
  const wellbeing = await WellbeingSummary.find({userId:student._id}).sort({weekStart:-1}).limit(4)
  const alerts = await RiskAlert.find({userId:student._id}).sort({createdAt:-1}).limit(10)
  const lastInsight = await Insight.findOne({userId:student._id}).sort({generatedAt:-1})
  const avgGrade = subjects.filter(s=>s.avgGrade>0).length ? Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length) : 0
  res.json({
    studentName:student.name, grade:student.grade, level:student.level, xp:student.xp,
    streak:student.streak, totalStudyMinutes:student.totalStudyMinutes, focusScore:student.focusScore,
    avgGrade, subjects:subjects.map(s=>({name:s.name,emoji:s.emoji,avgGrade:s.avgGrade})),
    wellbeing, alerts, lastInsight
  })
})
app.patch('/api/family/alerts/:id/read', auth, async (req,res) => {
  await RiskAlert.findByIdAndUpdate(req.params.id,{isRead:true})
  res.json({ok:true})
})


app.get('/api/garden', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id})
  const gl=calcGardenLevel(u,subjects)
  if(gl!==u.gardenLevel) { u.gardenLevel=gl; await u.save() }
  const avg=subjects.filter(s=>s.avgGrade>0).length?Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length):0
  res.json({level:gl,streak:u.streak,xp:u.xp,avgGrade:avg,focusScore:u.focusScore})
})

// ── STATS ───────────────────────────────────────────────────────
app.get('/api/stats', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id})
  const dueCards=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
  await ensureRepeating(u._id)
  const todaySched=await Schedule.find({userId:u._id,date:todayStr(),repeat:'none'})
  const weekly=[]
  for(let i=6;i>=0;i--) {
    const d=new Date(Date.now()-i*86400000).toISOString().split('T')[0]
    const ds=await Schedule.find({userId:u._id,date:d,repeat:'none'})
    weekly.push({date:d,tasks:ds.length,done:ds.filter(s=>s.isDone).length,mins:Math.floor(Math.random()*90+10)})
  }
  const lastInsight=await Insight.findOne({userId:u._id}).sort({generatedAt:-1})
  const avgGrade=subjects.filter(s=>s.avgGrade>0).length?Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length):0
  res.json({xp:u.xp,level:u.level,streak:u.streak,streakFreezeCount:u.streakFreezeCount,totalStudyMinutes:u.totalStudyMinutes,focusScore:u.focusScore,gardenLevel:u.gardenLevel,subjects,dueCards,todayTasks:todaySched.length,doneTasks:todaySched.filter(s=>s.isDone).length,weekly,lastInsight,avgGrade,urgentSubjects:subjects.filter(s=>{if(!s.examDate)return false;const d=Math.ceil((new Date(s.examDate)-new Date())/86400000);return d>=0&&d<=7})})
})
app.get('/api/insights/list', auth, async (req,res) => res.json(await Insight.find({userId:req.u._id}).sort({generatedAt:-1}).limit(4)))

// ── STATIC ──────────────────────────────────────────────────────
app.get('/ping', (_,res) => res.send('ok'))
app.get('/', (_,res) => res.sendFile(path.join(__dirname,'app.html')))
app.get('/app.html', (_,res) => res.sendFile(path.join(__dirname,'app.html')))

// ── TELEGRAM BOT ────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN)
function appBtn() { return Markup.inlineKeyboard([[Markup.button.webApp('🌿 StudyMind',`${DOMAIN}/app.html`)]]) }

bot.start(async ctx => {
  const tid=String(ctx.from.id); let u=await User.findOne({telegramId:tid})
  if(!u) u=await User.create({telegramId:tid,name:ctx.from.first_name||'O\'quvchi',telegramUsername:ctx.from.username})
  await ctx.reply(`👋 Salom, *${u.name}*\\!\n\n🧠 *StudyMind* — aqlli o\'quv assistentingiz\\.\n\nTilni tanlang:`,{
    parse_mode:'MarkdownV2',...Markup.inlineKeyboard([[Markup.button.callback("🇺🇿 O'zbek",'lang_uz'),Markup.button.callback('🇷🇺 Русский','lang_ru'),Markup.button.callback('🇬🇧 English','lang_en')]])
  })
})

bot.action(/lang_(.+)/, async ctx => {
  const lang=ctx.match[1]; await User.findOneAndUpdate({telegramId:String(ctx.from.id)},{lang})
  const u=await User.findOne({telegramId:String(ctx.from.id)})
  await ctx.editMessageText('✅ Saqlandi!')
  await ctx.reply('Tayyor! Appni oching 👇',{...Markup.keyboard([['📊 Holat','🌿 Bog\'im'],['📅 Reja','🧠 AI'],['🌐 App']]).resize(),...appBtn()})
})

bot.on('text', async ctx => {
  if(ctx.message.text.startsWith('/')) return
  const tid=String(ctx.from.id), u=await User.findOne({telegramId:tid})
  if(!u) return ctx.reply('/start bosing')
  const txt=ctx.message.text
  if(['🌐 App','App'].includes(txt)) { await ctx.reply('📱',appBtn()); return }
  if(['📊 Holat','📊 Status'].includes(txt)) {
    const subjects=await Subject.find({userId:u._id}), due=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
    await ctx.reply(`📊 *${u.name}*\n🔥 ${u.streak} streak | Lv.${u.level} | ${u.xp}xp\n🎯 Focus: ${u.focusScore}/100\n🔁 ${due} karta\n${subjects.map(s=>`${s.emoji}${s.name}: *${s.avgGrade||'—'}*`).join('\n')}`,{parse_mode:'Markdown',...appBtn()})
    return
  }
  if(["🌿 Bog'im"].includes(txt)) {
    const subjects=await Subject.find({userId:u._id}), gl=calcGardenLevel(u,subjects)
    const names=['Urug\'','Ko\'chat','Nihal','Daraxt','Bog\'','Gullagan','Mukammal','Jannat']
    await ctx.reply(`🌿 *Bog\'ingiz: ${names[gl]}* (${gl}/7)\n\n🔥 ${u.streak} streak\n⭐ ${u.xp} XP\n\nDavom eting — bog\' o\'sadi!`,{parse_mode:'Markdown',...appBtn()})
    return
  }
  if(['📅 Reja'].includes(txt)) {
    await ensureRepeating(u._id)
    const sched=await Schedule.find({userId:u._id,date:todayStr(),repeat:'none'})
    if(!sched.length) { await ctx.reply('Reja yo\'q',{...Markup.inlineKeyboard([[Markup.button.callback('🧠 AI reja tuz','gen_plan')]])}); return }
    await ctx.reply(`📅 *Bugungi reja:*\n\n${sched.map(s=>`${s.isDone?'✅':'⬜'} ${s.emoji} ${s.title}`).join('\n')}`,{parse_mode:'Markdown',...appBtn()})
    return
  }
  if(['🧠 AI'].includes(txt)) { await ctx.reply('Savolingizni yozing 👇'); return }

  await ctx.sendChatAction('typing')
  const subjects=await Subject.find({userId:u._id})
  const history=await Chat.find({userId:u._id}).sort({createdAt:-1}).limit(8)
  const messages=[...history.reverse().map(m=>({role:m.role,content:m.content})),{role:'user',content:txt}]
  await Chat.create({userId:u._id,role:'user',content:txt})
  const rawReply=await ai(messages,buildSystem(u,subjects))
  const extracted=extractFromAI(rawReply), cleanReply=cleanText(rawReply)
  if(extracted.grade) { const subj=subjects.find(s=>s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase())); if(subj){subj.gradeHistory.push({score:extracted.grade.score,date:todayStr()});subj.avgGrade=Math.round(subj.gradeHistory.reduce((a,g)=>a+g.score,0)/subj.gradeHistory.length);await subj.save()} }
  if(extracted.studyMinutes){u.totalStudyMinutes+=extracted.studyMinutes;await u.save()}
  await giveXP(u._id,5)
  await Chat.create({userId:u._id,role:'assistant',content:cleanReply})
  await ctx.reply(cleanReply)
})

bot.action('gen_plan', async ctx => {
  const u=await User.findOne({telegramId:String(ctx.from.id)}); if(!u) return
  await ctx.editMessageText('⏳ Tuzilmoqda...')
  const subjects=await Subject.find({userId:u._id})
  const plan=await ai([{role:'user',content:`Bugungi reja. Fanlar: ${subjects.map(s=>s.name).join(', ')||'yo\'q'}. Max 4 ta.`}],buildSystem(u,subjects),300)
  for(const line of plan.split('\n').filter(l=>l.trim()).slice(0,4)) await Schedule.create({userId:u._id,title:line.replace(/^[\d\.\)\-•*]\s*/,'').trim(),date:todayStr(),category:'study',aiGenerated:true})
  await ctx.editMessageText(`✅ Tayyor!\n\n${plan}`)
})

// Smart notifications
setInterval(async () => {
  const hour=new Date().getHours()
  if(![7,14,20].includes(hour)) return
  const users=await User.find({telegramId:{$exists:true,$ne:null},notifEnabled:{$ne:false}})
  const today=todayStr()
  for(const u of users) {
    if(u.lastNotifDay===today&&hour===7) continue
    try {
      const subjects=await Subject.find({userId:u._id})
      const due=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:today}})
      const gl=calcGardenLevel(u,subjects)
      const gardenNames=['Urug\'','Ko\'chat','Nihal','Daraxt','Bog\'','Gullagan','Mukammal','Jannat']
      const ql=QUOTES[u.lang||'uz']||QUOTES.uz, q=ql[Math.floor(Math.random()*ql.length)]
      const urgent=subjects.filter(s=>{if(!s.examDate)return false;const d=Math.ceil((new Date(s.examDate)-new Date())/86400000);return d>=0&&d<=3})

      let msg=''
      if(hour===7) {
        msg=`🌅 *Xayrli tong, ${u.name}\\!*\n\n`
        msg+=`🌿 Bog\\'ingiz: *${gardenNames[gl]}*\n`
        msg+=`🔥 Streak: *${u.streak}* kun | Lv\\.*${u.level}*\n`
        if(due>0) msg+=`🔁 Bugun *${due}* ta karta\n`
        if(urgent.length) msg+=`⚠️ ${urgent.map(s=>s.name).join(', ')} imtihoni yaqin\\!\n`
        msg+=`\n💬 _"${q.text}"_\n— ${q.author}`
        u.lastNotifDay=today; await u.save()
      } else if(hour===14) {
        const sched=await Schedule.find({userId:u._id,date:today,repeat:'none'})
        const left=sched.filter(s=>!s.isDone).length
        if(left>0) msg=`☀️ *${u.name}\\!*\n\n📅 *${left}* ta vazifa qoldi\\.\n🔥 Streak: ${u.streak} kun — yo\\'qotmaylik\\!`
        else if(due>0) msg=`☀️ *${u.name}\\!*\n\n🔁 *${due}* ta karta kutmoqda\\.\nBugun bajarsang bog\\'ing o\\'sadi\\! 🌿`
      } else if(hour===20) {
        const didStudy=u.lastStudyDate===today
        if(!didStudy && u.streak>0) {
          msg=`🌙 *${u.name}\\!*\n\n⚠️ Bugun hali o\\'qimadingiz\\!\n🔥 *${u.streak}* kunlik streak xavf ostida\\!\n\n🌿 Bog\\'ingiz so\\'lib qolishi mumkin 🍂\n\nHoziroq 5 daqiqa — yetarli\\!`
        } else if(didStudy) {
          msg=`🌙 *Ajoyib kun, ${u.name}\\!*\n\n🌿 Bog\\'ingiz o\\'sdi\\!\n🔥 Streak: *${u.streak}* kun\n\nErtaga ham davom\\! ⭐`
        }
      }
      if(msg) await bot.telegram.sendMessage(u.telegramId,msg,{parse_mode:'MarkdownV2',...appBtn()})
    } catch(e) { console.log('Notif xato:',e.message) }
  }
}, 60*60*1000)

bot.launch({dropPendingUpdates:true})
console.log('✅ Bot ishga tushdi')
app.listen(PORT,'0.0.0.0',()=>{ console.log(`✅ Server ${PORT}`); console.log('🌿 StudyMind v8.0') })
process.once('SIGINT',()=>bot.stop('SIGINT'))
process.once('SIGTERM',()=>bot.stop('SIGTERM'))
