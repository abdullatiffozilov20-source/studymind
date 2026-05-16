// ================================================================
//  StudyMind v7.0
//  + Auto Garden (streak+xp+grade asosida o'sadi)
//  + Streak Freeze (1 kun kechiriladi)
//  + Kuchli Telegram notifications
//  + Zamonaviy bot UI
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
  grade: String, school: String, isAdmin: { type: Boolean, default: false },
  xp: { type: Number, default: 0 }, level: { type: Number, default: 1 },
  streak: { type: Number, default: 0 }, lastStudyDate: String,
  streakFreezeUsed: { type: Boolean, default: false }, // Bir kun kechiriladi
  totalStudyMinutes: { type: Number, default: 0 },
  // Garden state — avtomatik hisoblanadi
  gardenLevel: { type: Number, default: 0 }, // 0-7
  gardenLastUpdate: String,
  savedQuotes: [{ text: String, author: String, savedAt: Date }],
  // Notification settings
  notifEnabled: { type: Boolean, default: true },
  lastNotifDay: String, // qo'sh notification 2x yuborilmasin
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
  subjectName: String, time: String, date: String,
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

// ── HELPERS ────────────────────────────────────────────────────────
function calcLevel(xp) { const t=[0,100,250,500,900,1400,2000,2800,3800,5000]; for(let i=t.length-1;i>=0;i--) if(xp>=t[i]) return i+1; return 1 }
function todayStr() { return new Date().toISOString().split('T')[0] }

// Garden level: streak + xp + avgGrade asosida (0-7)
function calcGardenLevel(user, subjects) {
  const streak = user.streak || 0
  const xp = user.xp || 0
  const avgG = subjects?.length ? Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/Math.max(subjects.filter(s=>s.avgGrade>0).length,1)) : 0

  let score = 0
  // Streak contribution (0-3)
  if (streak >= 30) score += 3
  else if (streak >= 14) score += 2
  else if (streak >= 3) score += 1

  // XP contribution (0-2)
  if (xp >= 1000) score += 2
  else if (xp >= 300) score += 1

  // Grade contribution (0-2)
  if (avgG >= 80) score += 2
  else if (avgG >= 60) score += 1

  return Math.min(7, score)
}

async function giveXP(userId, amount) {
  const u = await User.findById(userId)
  const prev = u.level
  u.xp += amount; u.level = calcLevel(u.xp)
  const today = todayStr()
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  if (u.lastStudyDate !== today) {
    if (u.lastStudyDate === yesterday) {
      // Ketma-ket kun
      u.streak += 1
      u.streakFreezeUsed = false // Reset freeze
    } else if (!u.lastStudyDate) {
      u.streak = 1
    } else {
      // Gap bor — freeze?
      const twoDaysAgo = new Date(Date.now() - 2*86400000).toISOString().split('T')[0]
      if (u.lastStudyDate === twoDaysAgo && !u.streakFreezeUsed) {
        // 1 kun kechiriladi (Streak Freeze)
        u.streak += 1
        u.streakFreezeUsed = true
      } else {
        u.streak = 1
        u.streakFreezeUsed = false
      }
    }
    u.lastStudyDate = today
  }

  // Garden update
  const subjects = await Subject.find({ userId })
  u.gardenLevel = calcGardenLevel(u, subjects)
  u.gardenLastUpdate = today

  await u.save()
  return { user: u, leveledUp: u.level > prev }
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
      if (!exists) await Schedule.create({ userId, title: t.title, category: t.category, subjectName: t.subjectName, time: t.time, date: today, repeat: 'none', emoji: t.emoji, aiGenerated: t.aiGenerated })
    }
  }
}

// ── AI ─────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })

async function ai(messages, system, maxTokens = 600) {
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
  const gardenState = ['🌱 urug\'','🌿 ko\'chat','🌳 nihal','🌲 daraxt','🏡 bog\'','🌸 gullagan','🌈 mukammal'][user?.gardenLevel||0]
  return `Sen StudyMind AI — halol, qattiq, real murabbiy.
${langNote}
O'quvchi: ${user?.name}, ${user?.grade||''}, Lv.${user?.level}, Streak:${user?.streak}kun
Fanlar: ${subjList||'yo\'q'}
Bog\' holati: ${gardenState}
QOIDALAR:
1. MAX 3 qisqa gap. Bo'sh maqtov YO'Q.
2. Baho aytilsa: [GRADE:FanNomi:Ball]
3. Vaqt aytilsa: [STUDY:daqiqa]
4. Reja so'rasa: [SCHED:sarlavha:study/life:vaqt:none/daily]
5. Karta so'rasa: [FC:savol|javob]
6. Bugun: ${todayStr()}`
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
  return t.replace(/\[GRADE:[^\]]+\]/gi,'').replace(/\[STUDY:[^\]]+\]/gi,'').replace(/\[SCHED:[^\]]+\]/gi,'').replace(/\[FC:[^\]]+\]/gi,'').replace(/\n{3,}/g,'\n\n').trim()
}

const QUOTES = {
  uz:[
    {text:"Muvaffaqiyat — har kuni kichik harakatlar yig'indisi.",author:"Robert Collier"},
    {text:"O'qish — eng kuchli qurol.",author:"Nelson Mandela"},
    {text:"Katta natijalar kichik odatlardan.",author:"James Clear"},
    {text:"Har bir ekspert bir vaqtlar yangi boshlovchi edi.",author:"Helen Hayes"},
  ],
  ru:[
    {text:"Успех — это сумма небольших усилий каждого дня.",author:"Robert Collier"},
    {text:"Большие результаты начинаются с маленьких привычек.",author:"James Clear"},
  ],
  en:[
    {text:"Success is the sum of small efforts repeated daily.",author:"Robert Collier"},
    {text:"Big results come from small daily habits.",author:"James Clear"},
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
  res.json({_id:u._id,name:u.name,email:u.email,avatar:u.avatar,lang:u.lang,grade:u.grade,school:u.school,xp:u.xp,level:u.level,streak:u.streak,totalStudyMinutes:u.totalStudyMinutes,gardenLevel:u.gardenLevel,savedQuotes:u.savedQuotes,isAdmin:u.isAdmin})
})
app.put('/api/user', auth, async (req,res) => {
  const fields=['lang','grade','school','name','notifEnabled']
  fields.forEach(f=>{ if(req.body[f]!==undefined) req.u[f]=req.body[f] })
  await req.u.save(); res.json({ok:true})
})
app.post('/api/user/save-quote', auth, async (req,res) => {
  const {text,author}=req.body
  req.u.savedQuotes=req.u.savedQuotes||[]
  req.u.savedQuotes.push({text,author,savedAt:new Date()})
  if(req.u.savedQuotes.length>30) req.u.savedQuotes.shift()
  await req.u.save(); res.json({ok:true})
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
  res.json(await Subject.create({userId:req.u._id,name,emoji:emoji||'📚',color:color||'#6c63ff',examDate}))
})
app.delete('/api/subjects/:id', auth, async (req,res) => { await Subject.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── AI CHAT ────────────────────────────────────────────────────────
app.get('/api/chat', auth, async (req,res) => res.json((await Chat.find({userId:req.u._id}).sort({createdAt:-1}).limit(30)).reverse()))

app.post('/api/chat', auth, async (req,res) => {
  const {message}=req.body
  if(!message?.trim()) return res.status(400).json({error:'message kerak'})
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
    await giveXP(u._id,5)
  }
  if(extracted.studyMinutes) { u.totalStudyMinutes+=extracted.studyMinutes; await giveXP(u._id,Math.floor(extracted.studyMinutes*1.5)); await u.save() }

  // AI bilan gaplashish o'zi XP beradi (engagement)
  const {user:updUser} = await giveXP(u._id, 3)

  let savedSchedule=null
  if(extracted.scheduleItem) {
    const si=extracted.scheduleItem
    savedSchedule=await Schedule.create({userId:u._id,title:si.title,category:si.category==='life'?'life':'study',time:si.time,date:todayStr(),repeat:si.repeat==='daily'?'daily':'none',aiGenerated:true,emoji:si.category==='life'?'🌟':'📚'})
  }
  let savedCards=[]
  if(extracted.flashcards?.length) {
    for(const fc of extracted.flashcards) { const c=await Flashcard.create({userId:u._id,front:fc.front,back:fc.back,aiGenerated:true}); savedCards.push(c) }
  }

  await Chat.create({userId:u._id,role:'assistant',content:cleanReply,extractedData:extracted})
  res.json({reply:cleanReply,extracted,savedSchedule,savedCards,gardenLevel:updUser.gardenLevel,streak:updUser.streak})
})

app.post('/api/chat/flashcard', auth, async (req,res) => {
  const {subjectId,topic,count=5}=req.body
  const subj=subjectId?await Subject.findById(subjectId):null
  const topicName=topic||subj?.name||'umumiy'
  const u=req.u
  const prompt=`"${topicName}" mavzusi bo'yicha ${count} ta flashcard.\nFormat:\nCARD1_FRONT: savol\nCARD1_BACK: javob\n...`
  const reply=await ai([{role:'user',content:prompt}],buildSystem(u,[]),900)
  const cards=[]
  for(let i=1;i<=count;i++) {
    const f=reply.match(new RegExp(`CARD${i}_FRONT:\\s*(.+?)(?=CARD\\d_FRONT:|$)`,'si'))?.[1]?.trim().split('\n')[0]
    const b=reply.match(new RegExp(`CARD${i}_BACK:\\s*(.+?)(?=CARD\\d_FRONT:|$)`,'si'))?.[1]?.trim().split('\n')[0]
    if(f&&b) { const c=await Flashcard.create({userId:u._id,subjectId,subjectName:subj?.name,topic:topicName,front:f,back:b,aiGenerated:true}); cards.push(c) }
  }
  res.json({cards,topic:topicName})
})

app.post('/api/chat/daily-plan', auth, async (req,res) => {
  const u=req.u, subjects=await Subject.find({userId:u._id})
  const {topic}=req.body
  const tl=topic?`Mavzu: "${topic}".`:`Fanlar: ${subjects.map(s=>s.name).join(', ')||'yo\'q'}.`
  const plan=await ai([{role:'user',content:`Bugungi o'quv rejasi. ${tl} Max 5 ta modda. Qisqa.`}],buildSystem(u,subjects),400)
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
  const prompt=`${langNote} O'quvchi tahlili:
Fanlar: ${JSON.stringify(subjects.map(s=>({n:s.name,avg:s.avgGrade})))}
O'qish: ${u.totalStudyMinutes}min, Streak: ${u.streak}kun
XULOSA: (2 gap)\nKUCHLI: (vergul)\nZAIF: (vergul)\nTAVSIYA: (3 ta)\nUSLUB: (bir so'z)\nVAQT:`
  const reply=await ai([{role:'user',content:prompt}],`Halol tahlilchi. ${langNote}`,800)
  const ex=(k)=>reply.match(new RegExp(`${k}:\\s*(.+?)(?=\\n[A-Z]+:|$)`,'si'))?.[1]?.trim()||''
  const weekNum=Math.floor(Date.now()/(7*86400000))
  const ins=await Insight.findOneAndUpdate({userId:u._id,weekNumber:weekNum},{summary:ex('XULOSA'),strengths:ex('KUCHLI').split(',').map(s=>s.trim()).filter(Boolean),weaknesses:ex('ZAIF').split(',').map(s=>s.trim()).filter(Boolean),recommendations:ex('TAVSIYA').split(/\d+\./).map(s=>s.trim()).filter(Boolean),learningStyle:ex('USLUB'),bestStudyTime:ex('VAQT'),generatedAt:new Date(),weekNumber:weekNum},{upsert:true,new:true})
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
  const xp=req.body.quality>=3?5:2; await giveXP(req.u._id,xp)
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

// ── NOTES ─────────────────────────────────────────────────────────
app.get('/api/notes', auth, async (req,res) => res.json(await Note.find({userId:req.u._id}).sort({isPinned:-1,updatedAt:-1})))
app.post('/api/notes', auth, async (req,res) => {
  const {title,content,subjectName,color,tags}=req.body
  res.json(await Note.create({userId:req.u._id,title:title||'Yangi eslatma',content,subjectName,color:color||'#6c63ff',tags:tags||[]}))
})
app.put('/api/notes/:id', auth, async (req,res) => res.json(await Note.findOneAndUpdate({_id:req.params.id,userId:req.u._id},{...req.body,updatedAt:new Date()},{new:true})))
app.delete('/api/notes/:id', auth, async (req,res) => { await Note.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })
app.post('/api/notes/summarize', auth, async (req,res) => {
  const {content}=req.body
  if(!content) return res.status(400).json({error:'kerak'})
  res.json({summary:await ai([{role:'user',content:`Xulosalab ber:\n${content.slice(0,3000)}`}],buildSystem(req.u,[]),500)})
})

// ── GARDEN API ────────────────────────────────────────────────────
app.get('/api/garden', auth, async (req,res) => {
  const u=req.u
  const subjects=await Subject.find({userId:u._id})
  const gl=calcGardenLevel(u,subjects)
  if(gl!==u.gardenLevel) { u.gardenLevel=gl; u.gardenLastUpdate=todayStr(); await u.save() }
  res.json({ level:u.gardenLevel, streak:u.streak, xp:u.xp, avgGrade: subjects.filter(s=>s.avgGrade>0).length?Math.round(subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length):0 })
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
    weekly.push({date:d,tasks:ds.length,done:ds.filter(s=>s.isDone).length})
  }
  const lastInsight=await Insight.findOne({userId:u._id}).sort({generatedAt:-1})
  const gardenLevel=calcGardenLevel(u,subjects)
  res.json({xp:u.xp,level:u.level,streak:u.streak,totalStudyMinutes:u.totalStudyMinutes,subjects,dueCards,todayTasks:todaySched.length,doneTasks:todaySched.filter(s=>s.isDone).length,weekly,lastInsight,gardenLevel,urgentSubjects:subjects.filter(s=>{if(!s.examDate)return false;const d=Math.ceil((new Date(s.examDate)-new Date())/86400000);return d>=0&&d<=7})})
})
app.get('/api/insights', auth, async (req,res) => res.json(await Insight.find({userId:req.u._id}).sort({generatedAt:-1}).limit(4)))

// ── STATIC ────────────────────────────────────────────────────────
app.get('/ping', (_,res) => res.send('ok'))
app.get('/', (_,res) => res.sendFile(path.join(__dirname,'app.html')))
app.get('/app.html', (_,res) => res.sendFile(path.join(__dirname,'app.html')))

// ── TELEGRAM BOT ──────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN)

function appBtn() { return Markup.inlineKeyboard([[Markup.button.webApp('🌿 StudyMind Pro',`${DOMAIN}/app.html`)]]) }
function mainKb(lang) {
  const kb = {
    uz: [['📚 Fanlarim','🌿 Bog\'im'],['📊 Bugungi holat','📅 Reja'],['🧠 AI savol','🌐 App']],
    ru: [['📚 Предметы','🌿 Сад'],['📊 Статистика','📅 План'],['🧠 AI вопрос','🌐 App']],
    en: [['📚 Subjects','🌿 Garden'],['📊 Status','📅 Plan'],['🧠 Ask AI','🌐 App']]
  }
  return Markup.keyboard(kb[lang]||kb.uz).resize()
}

// Garden emoji by level
function gardenEmoji(level) {
  const g=['🌱','🌿','🌳','🌲','🏡','🌸','🌺','🌈']
  return g[Math.min(level,7)]
}
function gardenName(level, lang) {
  const uz=['Urug\'','Ko\'chat','Nihal','Daraxt','Bog\'','Gullagan bog\'','Mukammal bog\'','Jannat bog\'']
  const ru=['Семя','Росток','Саженец','Дерево','Сад','Цветущий сад','Идеальный сад','Райский сад']
  const en=['Seed','Sprout','Sapling','Tree','Garden','Blooming Garden','Perfect Garden','Paradise Garden']
  const arr = lang==='ru'?ru:lang==='en'?en:uz
  return arr[Math.min(level,7)]
}

bot.start(async ctx => {
  const tid=String(ctx.from.id)
  let u=await User.findOne({telegramId:tid})
  if(!u) u=await User.create({telegramId:tid,name:ctx.from.first_name||'O\'quvchi',telegramUsername:ctx.from.username})
  await ctx.reply(`👋 Salom, *${u.name}*\\!\n\n🧠 *StudyMind Pro* — aqlli o\'quv assistentingiz\\.\n\nTilni tanlang:`,{
    parse_mode:'MarkdownV2',
    ...Markup.inlineKeyboard([[Markup.button.callback("🇺🇿 O'zbek",'lang_uz'),Markup.button.callback('🇷🇺 Русский','lang_ru'),Markup.button.callback('🇬🇧 English','lang_en')]])
  })
})

bot.action(/lang_(.+)/, async ctx => {
  const lang=ctx.match[1]
  await User.findOneAndUpdate({telegramId:String(ctx.from.id)},{lang})
  const u=await User.findOne({telegramId:String(ctx.from.id)})
  const msgs={uz:'✅ Til saqlandi! Xush kelibsiz 🌿',ru:'✅ Язык сохранён! Добро пожаловать 🌿',en:'✅ Language saved! Welcome 🌿'}
  await ctx.editMessageText(msgs[lang]||msgs.uz)
  await ctx.reply(`${gardenEmoji(u.gardenLevel||0)} Sizning bog'ingiz: *${gardenName(u.gardenLevel||0,lang)}*\n\nHar safar o'qisangiz bog' o'sadi 🌱`,{parse_mode:'Markdown',...mainKb(lang)})
})

// Smart handlers
bot.on('text', async ctx => {
  if(ctx.message.text.startsWith('/')) return
  const tid=String(ctx.from.id)
  const u=await User.findOne({telegramId:tid})
  if(!u) return ctx.reply('/start bosing')
  const lang=u.lang||'uz'
  const txt=ctx.message.text

  // ── 📚 Fanlarim ──
  if(['📚 Fanlarim','📚 Предметы','📚 Subjects'].includes(txt)) {
    const subjects=await Subject.find({userId:u._id})
    if(!subjects.length) {
      const msg={uz:'Hali fan qo\'shilmagan. Appni oching va fan qo\'shing 👇',ru:'Предметов нет. Откройте приложение 👇',en:'No subjects yet. Open the app 👇'}
      return ctx.reply(msg[lang]||msg.uz,appBtn())
    }
    let text=`📚 *Fanlarim* — ${subjects.length} ta\n\n`
    for(const s of subjects) {
      const days=s.examDate?Math.ceil((new Date(s.examDate)-new Date())/86400000):null
      const bar='█'.repeat(Math.round((s.avgGrade||0)/10))+'░'.repeat(10-Math.round((s.avgGrade||0)/10))
      text+=`${s.emoji} *${s.name}*\n`
      text+=`${bar} ${s.avgGrade||'—'}%\n`
      if(days!==null) text+=`📅 ${days} kun qoldi${days<=7?' ⚠️':''}\n`
      text+='\n'
    }
    await ctx.reply(text,{parse_mode:'Markdown',...appBtn()})
    return
  }

  // ── 🌿 Bog'im ──
  if(['🌿 Bog\'im','🌿 Сад','🌿 Garden'].includes(txt)) {
    const subjects=await Subject.find({userId:u._id})
    const gl=calcGardenLevel(u,subjects)
    const nextLevels=[
      {need:'3 kun streak',done:u.streak>=3},
      {need:'14 kun streak',done:u.streak>=14},
      {need:'300 XP',done:u.xp>=300},
      {need:'1000 XP',done:u.xp>=1000},
      {need:'O\'rtacha baho 60+',done:subjects.filter(s=>s.avgGrade>0).length&&subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length>=60},
      {need:'O\'rtacha baho 80+',done:subjects.filter(s=>s.avgGrade>0).length&&subjects.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects.filter(s=>s.avgGrade>0).length>=80},
    ]
    let text=`${gardenEmoji(gl)} *${gardenName(gl,lang)}* (${gl}/7)\n\n`
    text+=`🔥 Streak: *${u.streak}* kun\n⭐ XP: *${u.xp}*\n\n`
    text+=`📈 *Rivojlanish yo'li:*\n`
    nextLevels.forEach(n=>{ text+=`${n.done?'✅':'⬜'} ${n.need}\n` })
    text+=`\n_Har o'qish — bog' o'sadi!_`
    await ctx.reply(text,{parse_mode:'Markdown',...appBtn()})
    return
  }

  // ── 📊 Bugungi holat ──
  if(['📊 Bugungi holat','📊 Статистика','📊 Status'].includes(txt)) {
    const subjects=await Subject.find({userId:u._id})
    const dueCards=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
    await ensureRepeating(u._id)
    const sched=await Schedule.find({userId:u._id,date:todayStr(),repeat:'none'})
    const done=sched.filter(s=>s.isDone).length
    const gl=calcGardenLevel(u,subjects)
    let text=`📊 *Bugungi holat*\n\n`
    text+=`${gardenEmoji(gl)} Bog': *${gardenName(gl,lang)}*\n`
    text+=`🔥 Streak: *${u.streak}* kun | Lv.*${u.level}*\n`
    text+=`⭐ XP: *${u.xp}*\n`
    text+=`✅ Reja: *${done}/${sched.length}* bajarildi\n`
    text+=`🔁 Kartalar: *${dueCards}* ta\n`
    if(u.xp>0) {
      const subjects2=await Subject.find({userId:u._id})
      const avgG=subjects2.filter(s=>s.avgGrade>0).length?Math.round(subjects2.filter(s=>s.avgGrade>0).reduce((a,s)=>a+s.avgGrade,0)/subjects2.filter(s=>s.avgGrade>0).length):0
      if(avgG) text+=`📊 O'rtacha baho: *${avgG}*\n`
    }
    await ctx.reply(text,{parse_mode:'Markdown',...appBtn()})
    return
  }

  // ── 📅 Reja ──
  if(['📅 Reja','📅 План','📅 Plan'].includes(txt)) {
    await ensureRepeating(u._id)
    const sched=await Schedule.find({userId:u._id,date:todayStr(),repeat:'none'})
    if(!sched.length) {
      await ctx.reply('Bugun reja yo\'q.',{...Markup.inlineKeyboard([[Markup.button.callback('🧠 AI reja tuz','gen_plan')]])})
      return
    }
    const studyItems=sched.filter(s=>s.category==='study')
    const lifeItems=sched.filter(s=>s.category==='life')
    let text=`📅 *Bugungi reja*\n\n`
    if(studyItems.length) { text+=`📚 *O'quv:*\n`; studyItems.forEach(s=>text+=`${s.isDone?'✅':'⬜'} ${s.emoji} ${s.title}\n`); text+='\n' }
    if(lifeItems.length) { text+=`🌟 *Hayot:*\n`; lifeItems.forEach(s=>text+=`${s.isDone?'✅':'⬜'} ${s.emoji} ${s.title}\n`) }
    const pct=sched.length?Math.round(sched.filter(s=>s.isDone).length/sched.length*100):0
    text+=`\n📈 Bajarildi: *${pct}%*`
    await ctx.reply(text,{parse_mode:'Markdown',...appBtn()})
    return
  }

  // ── 🧠 AI savol ──
  if(['🧠 AI savol','🧠 AI вопрос','🧠 Ask AI'].includes(txt)) {
    const msgs={uz:'Savolingizni yozing 👇',ru:'Напишите ваш вопрос 👇',en:'Write your question 👇'}
    await ctx.reply(msgs[lang]||msgs.uz)
    return
  }

  // ── 🌐 App ──
  if(txt==='🌐 App') { await ctx.reply('📱 StudyMind Pro:',appBtn()); return }

  // ── AI chat ──
  await ctx.sendChatAction('typing')
  const subjects=await Subject.find({userId:u._id})
  const history=await Chat.find({userId:u._id}).sort({createdAt:-1}).limit(8)
  const messages=[...history.reverse().map(m=>({role:m.role,content:m.content})),{role:'user',content:txt}]
  await Chat.create({userId:u._id,role:'user',content:txt})
  const rawReply=await ai(messages,buildSystem(u,subjects))
  const extracted=extractFromAI(rawReply)
  const cleanReply=cleanText(rawReply)
  if(extracted.grade) {
    const subj=subjects.find(s=>s.name.toLowerCase().includes(extracted.grade.subjectName.toLowerCase()))
    if(subj){ subj.gradeHistory.push({score:extracted.grade.score,date:todayStr()}); subj.avgGrade=Math.round(subj.gradeHistory.reduce((a,g)=>a+g.score,0)/subj.gradeHistory.length); await subj.save() }
  }
  if(extracted.studyMinutes){ u.totalStudyMinutes+=extracted.studyMinutes; await giveXP(u._id,Math.floor(extracted.studyMinutes*1.5)) }
  await giveXP(u._id,3)
  if(extracted.scheduleItem){ const si=extracted.scheduleItem; await Schedule.create({userId:u._id,title:si.title,category:si.category==='life'?'life':'study',date:todayStr(),repeat:si.repeat==='daily'?'daily':'none',aiGenerated:true}) }
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

// ── AQLLI NOTIFICATIONS ───────────────────────────────────────────
async function sendSmartNotifications() {
  const hour=new Date().getHours()
  const today=todayStr()
  const users=await User.find({telegramId:{$exists:true,$ne:null},notifEnabled:{$ne:false}})

  for(const u of users) {
    if(u.lastNotifDay===today) continue // Bir kun bir marta max

    try {
      const subjects=await Subject.find({userId:u._id})
      const dueCards=await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:today}})
      const sched=await Schedule.find({userId:u._id,date:today,repeat:'none'})
      const doneTasks=sched.filter(s=>s.isDone).length
      const gl=calcGardenLevel(u,subjects)
      const lang=u.lang||'uz'
      const ql=QUOTES[lang]||QUOTES.uz
      const q=ql[Math.floor(Math.random()*ql.length)]
      const urgentSubjs=subjects.filter(s=>{if(!s.examDate)return false;const d=Math.ceil((new Date(s.examDate)-new Date())/86400000);return d>=0&&d<=3})

      let msg=''

      if(hour===7) {
        // 🌅 Ertalab — motivatsiya + bog' + reja
        msg=`🌅 *Xayrli tong, ${u.name}\\!*\n\n`
        msg+=`${gardenEmoji(gl)} Bog'ingiz: *${gardenName(gl,lang)}*\n`
        msg+=`🔥 Streak: *${u.streak}* kun\n`
        if(dueCards>0) msg+=`🔁 Bugun *${dueCards}* ta karta takrorlash\n`
        if(urgentSubjs.length) msg+=`⚠️ ${urgentSubjs.map(s=>s.name).join(', ')} imtihoni yaqin\\!\n`
        msg+=`\n💬 _"${q.text}"_\n— ${q.author}`

      } else if(hour===14) {
        // 🌤️ Kunduzi — progress reminder
        if(doneTasks<sched.length) {
          const left=sched.length-doneTasks
          msg=`☀️ *${u.name}, tushlik dam olish vaqti\\!*\n\n`
          msg+=`📅 Reja: *${doneTasks}/${sched.length}* bajarildi\n`
          msg+=`${left} ta vazifa qoldi\\. Kechgacha ulgurasiz\\! 💪\n\n`
          msg+=`${gardenEmoji(gl)} Bog' siz bilan o'sishni kutmoqda 🌱`
        } else if(dueCards>0) {
          msg=`☀️ *${u.name}\\!*\n\n🔁 *${dueCards}* ta karta kutmoqda\\.\nBugun bajarsangiz bog' o'sadi\\! ${gardenEmoji(gl)}`
        }

      } else if(hour===20) {
        // 🌙 Kechqurun — yakuniy natija
        const yesterday=new Date(Date.now()-86400000).toISOString().split('T')[0]
        const didStudyToday=u.lastStudyDate===today

        if(!didStudyToday) {
          // Kelmagan — streak xavfi
          const streakAtRisk=u.streak>0
          msg=`🌙 *${u.name}\\!*\n\n`
          if(streakAtRisk) {
            msg+=`⚠️ Bugun hali o'qimadingiz\\!\n🔥 *${u.streak}* kunlik streak xavf ostida\\!\n\n`
            msg+=`${gardenEmoji(gl)} Bog'ingiz so'lib qolishi mumkin 🍂\n\n`
            msg+=`Hoziroq bir narsa qiling — 5 daqiqa ham yetarli\\!`
          } else {
            msg+=`Bugun o'qish vaqti\\! ${gardenEmoji(gl)} Bog'ingizni o'stiraylik 🌱`
          }
        } else {
          // Kelgan — kechki natija
          msg=`🌙 *Bugungi natijalar, ${u.name}\\!*\n\n`
          msg+=`${gardenEmoji(gl)} Bog': *${gardenName(gl,lang)}*\n`
          msg+=`🔥 Streak: *${u.streak}* kun\n`
          msg+=`✅ Reja: *${doneTasks}/${sched.length}*\n`
          if(dueCards>0) msg+=`🔁 Ertaga: *${dueCards}* ta karta\n`
          msg+=`\n_Zo'r\\! Ertaga ham davom\\!_ ⭐`
        }

      } else if(hour===22 && urgentSubjs.length) {
        // 🚨 Imtihon yaqin reminder
        msg=`🚨 *Imtihon yaqin\\!*\n\n`
        urgentSubjs.forEach(s=>{
          const d=Math.ceil((new Date(s.examDate)-new Date())/86400000)
          msg+=`${s.emoji} *${s.name}* — *${d}* kun qoldi\\!\n`
        })
        msg+=`\nHoziroq AI bilan tayyorlanishni boshlang\\! 🧠`
      }

      if(msg) {
        await bot.telegram.sendMessage(u.telegramId,msg,{parse_mode:'MarkdownV2',...appBtn()})
        if(hour===7) { u.lastNotifDay=today; await u.save() }
      }
    } catch(e) { console.log('Notif xato:',e.message) }
  }
}

// Har soatda tekshir
setInterval(sendSmartNotifications, 60 * 60 * 1000)

bot.launch({dropPendingUpdates:true})
console.log('✅ Telegram bot ishga tushdi')
app.listen(PORT,'0.0.0.0',()=>{ console.log(`✅ Server ${PORT}`); console.log('🌿 StudyMind v7.0') })
process.once('SIGINT',()=>bot.stop('SIGINT'))
process.once('SIGTERM',()=>bot.stop('SIGTERM'))
