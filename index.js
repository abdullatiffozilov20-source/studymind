// Twin v2 — AI Learning Companion (backend)
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
const SECRET = process.env.SESSION_SECRET || 'twin-secret-2026'

if (!MONGO_URI || !GROQ_KEY) { console.error('ENV kerak: MONGO_URI, GROQ_API_KEY'); process.exit(1) }
await mongoose.connect(MONGO_URI)
console.log('✅ MongoDB ulandi')

// ── SCHEMAS ──────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, sparse: true }, avatar: String,
  telegramId: { type: String, unique: true, sparse: true }, telegramUsername: String,
  lang: { type: String, default: 'uz', enum: ['uz', 'ru', 'en'] },
  theme: { type: String, default: 'dark', enum: ['dark', 'light'] },
  createdAt: { type: Date, default: Date.now }
})

// Mavzu — universal: bitta dars ham, uzoq muddatli ko'nikma ham bo'lishi mumkin
const TopicSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String, emoji: { type: String, default: '📘' },
  description: String,
  isDone: { type: Boolean, default: false },
  progress: { type: Number, default: 0 }, // 0-100, AI hisoblaydi
  understanding: {
    strengths: [String],
    weakSpots: [String],
    summary: String,
    updatedAt: Date
  },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
})

// Har bir mavzu ostida o'rganilgan alohida "material" — masalan yuklangan rasm/dars natijasi
const MaterialSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', required: true },
  title: String, // AI qisqa nom beradi, masalan "12-masala: integrallar"
  type: { type: String, enum: ['image','text'], default: 'text' },
  imageData: String, // base64, agar rasm bo'lsa
  summary: String, // AI tahlili natijasi
  detectedSubject: String,
  detectedTask: String,
  detectedDueDate: String,
  confidence: Number, // 0-100
  createdAt: { type: Date, default: Date.now }
})

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,
  imageUrl: String,
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

// Test/Quiz — bir nechta savol turidagi mustahkamlash mashqi
const QuizSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  topicName: String,
  questions: [{
    type: { type: String, enum: ['mcq','truefalse','fillblank'] },
    question: String,
    options: [String], // mcq uchun
    correctAnswer: String,
    explanation: String
  }],
  lastScore: Number, // foiz
  attemptsCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

const ReminderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  title: String,
  dueDate: String,
  isDone: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

const User = mongoose.model('User', UserSchema)
const Topic = mongoose.model('Topic', TopicSchema)
const Material = mongoose.model('Material', MaterialSchema)
const Chat = mongoose.model('Chat', ChatSchema)
const Flashcard = mongoose.model('Flashcard', FlashcardSchema)
const Quiz = mongoose.model('Quiz', QuizSchema)
const Reminder = mongoose.model('Reminder', ReminderSchema)

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(express.json({ limit: '12mb' }))
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
  if (q >= 3) { interval = rep===0?1:rep===1?6:Math.round(interval*ef); rep++; ef=Math.max(1.3,ef+0.1-(5-q)*(0.08+(5-q)*0.02)) } else { rep=0; interval=1 }
  return { interval, easeFactor: ef, repetitions: rep, nextReview: new Date(Date.now()+interval*86400000).toISOString().split('T')[0] }
}

function youtubeSearchUrl(query) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
}

// ── AI (Groq) ────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_KEY })

async function ai(messages, system, maxTokens = 700) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const r = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }, { signal: ctrl.signal })
    clearTimeout(timer); return r.choices[0]?.message?.content || ''
  } catch (e) { clearTimeout(timer); return e.name==='AbortError'?'Vaqt tugadi, qayta urinib ko\'ring.':'Xatolik: '+e.message }
}

async function aiVision(imageBase64, prompt, system) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const r = await groq.chat.completions.create({
      model: 'llama-3.2-90b-vision-preview',
      max_tokens: 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]}
      ]
    }, { signal: ctrl.signal })
    clearTimeout(timer); return r.choices[0]?.message?.content || ''
  } catch (e) { clearTimeout(timer); return e.name==='AbortError'?'Vaqt tugadi.':'Xatolik: '+e.message }
}

function buildSystem(user, topics, activeTopic) {
  const lang = user?.lang || 'uz'
  const langNote = lang==='uz'?'FAQAT o\'zbek tilida javob ber.':lang==='ru'?'Отвечай ТОЛЬКО на русском.':'Reply ONLY in English.'
  const topicList = topics.slice(0,8).map(t=>`${t.emoji}${t.name}`).join(' | ')

  let twinContext = ''
  if (activeTopic?.understanding?.summary) {
    twinContext = `\nBu mavzu bo'yicha foydalanuvchi haqida bilganlaring: ${activeTopic.understanding.summary}
Kuchli tomonlari: ${activeTopic.understanding.strengths?.join(', ')||'hali aniqlanmagan'}
Qiynaladigan joylari: ${activeTopic.understanding.weakSpots?.join(', ')||'hali aniqlanmagan'}
Shuni hisobga olib, tushuntirishlaringni shaxsiylashtir.`
  }

  return `Sen Twin — foydalanuvchining shaxsiy o'rganish hamrohisan. Erkin va tabiiy gaplashasan, lekin orqa fonda uning o'rganish jarayonini kuzatib, eslab borasan.
${langNote}
Foydalanuvchi: ${user?.name}
Hozirgi mavzular: ${topicList||'hali yo\'q'}
${activeTopic?`Hozir gaplashayotgan mavzu: ${activeTopic.emoji}${activeTopic.name}`:''}
${twinContext}

QOIDALAR:
1. Tabiiy, qisqa va foydali javob ber.
2. Foydalanuvchi yangi narsa o'rganayotganini sezsang: [NEWTOPIC:Nomi]
3. Mavjud mavzuga aloqador bo'lsa: [TOPIC:MavzuNomi]
4. Vazifa/eslatma kerak bo'lsa: [REMIND:sarlavha:YYYY-MM-DD yoki bo'sh]
5. Foydali bo'lsa flashcard: [FC:savol|javob]
6. Agar tushuntirish chuqur bo'lsa va video yordam berishi mumkin bo'lsa: [YT:qidiruv so'zi]
7. Bugungi sana: ${todayStr()}
8. Hech qachon forma to'ldirishni so'rama.`
}

function extractFromAI(text) {
  const r = {}
  const nt = text.match(/\[NEWTOPIC:([^\]]+)\]/i); if (nt) r.newTopic = nt[1].trim()
  const tp = text.match(/\[TOPIC:([^\]]+)\]/i); if (tp) r.topicName = tp[1].trim()
  const rm = text.match(/\[REMIND:([^:]+):([^\]]*)\]/i); if (rm) r.reminder = { title: rm[1].trim(), dueDate: rm[2].trim() }
  const fcs = [...text.matchAll(/\[FC:([^|]+)\|([^\]]+)\]/gi)]
  if (fcs.length) r.flashcards = fcs.map(m => ({ front: m[1].trim(), back: m[2].trim() }))
  const yt = text.match(/\[YT:([^\]]+)\]/i); if (yt) r.youtubeQuery = yt[1].trim()
  return r
}

function cleanText(t) {
  return t.replace(/\[NEWTOPIC:[^\]]+\]/gi,'').replace(/\[TOPIC:[^\]]+\]/gi,'').replace(/\[REMIND:[^\]]+\]/gi,'').replace(/\[FC:[^\]]+\]/gi,'').replace(/\[YT:[^\]]+\]/gi,'').replace(/\n{3,}/g,'\n\n').trim()
}

async function updateUnderstanding(topicId, userId) {
  const topic = await Topic.findById(topicId)
  if (!topic) return
  const recentChats = await Chat.find({ userId, topicId }).sort({ createdAt: -1 }).limit(20)
  if (recentChats.length < 4) return

  const history = recentChats.reverse().map(c => `${c.role==='user'?'Foydalanuvchi':'Twin'}: ${c.content}`).join('\n')
  const system = `Quyidagi suhbat asosida foydalanuvchining shu mavzudagi holatini tahlil qil.
FAQAT JSON qaytar:
{"strengths":["...","..."],"weakSpots":["...","..."],"summary":"bir-ikki jumlali xulosa","progress":0-100}
O'zbek tilida yoz. progress - foydalanuvchining shu mavzuni qanchalik o'zlashtirgani (taxminiy foiz).`
  const reply = await ai([{role:'user',content:history}], system, 300)
  const text = reply.replace(/```json|```/g,'').trim()
  try {
    const parsed = JSON.parse(text)
    topic.understanding = { strengths: parsed.strengths||[], weakSpots: parsed.weakSpots||[], summary: parsed.summary||'', updatedAt: new Date() }
    if (typeof parsed.progress === 'number') topic.progress = Math.max(0, Math.min(100, parsed.progress))
    await topic.save()
  } catch {}
}

async function findOrCreateTopic(userId, name) {
  if (!name) return null
  const existing = await Topic.findOne({ userId, name: new RegExp('^'+name.trim()+'$','i') })
  if (existing) return existing
  return await Topic.create({ userId, name: name.trim(), emoji: pickEmoji(name) })
}

function pickEmoji(name) {
  const n = name.toLowerCase()
  if (/ingliz|english|til|language|франц|испан|french|spanish/.test(n)) return '🗣️'
  if (/matemat|math|algebra|geometr|integral|calculus/.test(n)) return '📐'
  if (/dastur|kod|python|javascript|react|code|program/.test(n)) return '💻'
  if (/gitara|guitar|musiqa|piano|music/.test(n)) return '🎸'
  if (/fizika|physics/.test(n)) return '⚛️'
  if (/kimyo|chemistry/.test(n)) return '🧪'
  if (/tarix|history/.test(n)) return '🏛️'
  if (/biolog/.test(n)) return '🧬'
  if (/sport|fitness|gym/.test(n)) return '🏋️'
  if (/rasm|chizish|art|draw/.test(n)) return '🎨'
  return '📘'
}

// Quiz generatsiyasi — turli formatdagi savollar
async function generateQuiz(topic, lang, count=5) {
  const langNote = lang==='uz'?'O\'zbek tilida.':lang==='ru'?'На русском.':'In English.'
  const context = topic.understanding?.summary ? `Foydalanuvchi holati: ${topic.understanding.summary}` : ''
  const system = `"${topic.name}" mavzusi bo'yicha ${count} ta turli xil savol tuz. ${langNote}
${context}
FAQAT JSON massiv qaytar, hech narsa qo'shma:
[
  {"type":"mcq","question":"...","options":["A","B","C","D"],"correctAnswer":"A","explanation":"qisqa tushuntirish"},
  {"type":"truefalse","question":"...","correctAnswer":"true","explanation":"..."},
  {"type":"fillblank","question":"... ___ ...","correctAnswer":"so'z","explanation":"..."}
]
Turlarni aralashtir. Savollar mavzuga mos, foydali va xilma-xil bo'lsin.`
  const reply = await ai([{role:'user',content:'Generatsiya qil'}], system, 1200)
  const text = reply.replace(/```json|```/g,'').trim()
  try { return JSON.parse(text) } catch { return [] }
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
  res.json({_id:u._id,name:u.name,email:u.email,avatar:u.avatar,lang:u.lang,theme:u.theme})
})
app.put('/api/user', auth, async (req,res) => {
  const fields=['lang','theme','name']
  fields.forEach(f=>{ if(req.body[f]!==undefined) req.u[f]=req.body[f] })
  await req.u.save(); res.json({ok:true})
})

// ── TOPICS ──────────────────────────────────────────────────────
app.get('/api/topics', auth, async (req,res) => {
  res.json(await Topic.find({userId:req.u._id}).sort({lastActivityAt:-1}))
})
app.post('/api/topics', auth, async (req,res) => {
  const {name,emoji,description}=req.body
  if(!name?.trim()) return res.status(400).json({error:'Nom kerak'})
  const t = await Topic.create({userId:req.u._id,name:name.trim(),emoji:emoji||pickEmoji(name),description})
  res.json(t)
})
app.get('/api/topics/:id', auth, async (req,res) => {
  res.json(await Topic.findOne({_id:req.params.id,userId:req.u._id}))
})
app.patch('/api/topics/:id', auth, async (req,res) => {
  const t = await Topic.findOneAndUpdate({_id:req.params.id,userId:req.u._id},req.body,{new:true})
  res.json(t)
})
app.delete('/api/topics/:id', auth, async (req,res) => {
  await Topic.findOneAndDelete({_id:req.params.id,userId:req.u._id})
  await Material.deleteMany({topicId:req.params.id,userId:req.u._id})
  res.json({ok:true})
})
app.get('/api/topics/:id/chat', auth, async (req,res) => {
  res.json(await Chat.find({userId:req.u._id,topicId:req.params.id}).sort({createdAt:1}).limit(50))
})
app.get('/api/topics/:id/materials', auth, async (req,res) => {
  res.json(await Material.find({userId:req.u._id,topicId:req.params.id}).sort({createdAt:-1}))
})

// ── CHAT (matn) ─────────────────────────────────────────────────
app.post('/api/chat', auth, async (req,res) => {
  const {message, topicId}=req.body
  if(!message?.trim()) return res.status(400).json({error:'message kerak'})
  const u=req.u
  const topics = await Topic.find({userId:u._id})
  let activeTopic = topicId ? await Topic.findById(topicId) : null

  await Chat.create({userId:u._id,role:'user',content:message,topicId:activeTopic?._id})

  const historyQuery = activeTopic ? {userId:u._id,topicId:activeTopic._id} : {userId:u._id,topicId:null}
  const history = await Chat.find(historyQuery).sort({createdAt:-1}).limit(14)
  const messages = history.reverse().map(m=>({role:m.role,content:m.content}))

  const rawReply = await ai(messages, buildSystem(u, topics, activeTopic))
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  let resolvedTopic = activeTopic
  if (extracted.newTopic && !activeTopic) resolvedTopic = await findOrCreateTopic(u._id, extracted.newTopic)
  else if (extracted.topicName && !activeTopic) resolvedTopic = await findOrCreateTopic(u._id, extracted.topicName)
  if (resolvedTopic) { resolvedTopic.lastActivityAt = new Date(); await resolvedTopic.save() }

  let savedReminder = null
  if (extracted.reminder) savedReminder = await Reminder.create({userId:u._id,topicId:resolvedTopic?._id,title:extracted.reminder.title,dueDate:extracted.reminder.dueDate||''})
  let savedCards = []
  if (extracted.flashcards?.length) {
    for (const fc of extracted.flashcards) savedCards.push(await Flashcard.create({userId:u._id,topicId:resolvedTopic?._id,topicName:resolvedTopic?.name,front:fc.front,back:fc.back}))
  }
  let youtubeLink = null
  if (extracted.youtubeQuery) youtubeLink = { query: extracted.youtubeQuery, url: youtubeSearchUrl(extracted.youtubeQuery) }

  await Chat.create({userId:u._id,role:'assistant',content:cleanReply,topicId:resolvedTopic?._id,extractedData:extracted})
  if (resolvedTopic) updateUnderstanding(resolvedTopic._id, u._id).catch(()=>{})

  res.json({reply:cleanReply, topic:resolvedTopic, savedReminder, savedCards, youtubeLink})
})

// ── CHAT (rasm — Learning Camera) ──────────────────────────────
app.post('/api/chat/image', auth, async (req,res) => {
  const {imageBase64, message, topicId} = req.body
  if(!imageBase64) return res.status(400).json({error:'Rasm kerak'})
  const u=req.u
  let activeTopic = topicId ? await Topic.findById(topicId) : null

  const lang = u.lang||'uz'
  const langNote = lang==='uz'?'FAQAT o\'zbek tilida.':lang==='ru'?'ТОЛЬКО русский.':'ONLY English.'

  // 1-bosqich: rasmni tahlil qilib, strukturalangan ma'lumot olamiz
  const analysisSystem = `Sen Twin — o'quv yordamchisan. Rasmda uy vazifasi, darslik sahifasi, qo'lyozma yoki kod bo'lishi mumkin. ${langNote}
FAQAT JSON qaytar, hech narsa qo'shma:
{"subject":"fan nomi","task":"vazifa qisqacha tavsifi","dueDate":"YYYY-MM-DD yoki bo'sh","confidence":0-100,"explanation":"2-3 jumlali tushuntirish","title":"qisqa nom material uchun"}`
  const userPrompt = message?.trim() || "Bu rasmni tahlil qil"
  const rawAnalysis = await aiVision(imageBase64, userPrompt, analysisSystem)
  const cleanedJson = rawAnalysis.replace(/```json|```/g,'').trim()
  let analysis = {}
  try { analysis = JSON.parse(cleanedJson) } catch { analysis = { explanation: rawAnalysis, subject: '', task: '', confidence: 50, title: 'Yuklangan material' } }

  let resolvedTopic = activeTopic
  if (!resolvedTopic && analysis.subject) resolvedTopic = await findOrCreateTopic(u._id, analysis.subject)
  if (resolvedTopic) { resolvedTopic.lastActivityAt = new Date(); await resolvedTopic.save() }

  // Material sifatida saqlaymiz — bu mavzu ostida alohida ko'rinadi
  const material = await Material.create({
    userId:u._id, topicId:resolvedTopic?._id, title:analysis.title||'Yuklangan material',
    type:'image', imageData:imageBase64, summary:analysis.explanation||'',
    detectedSubject:analysis.subject||'', detectedTask:analysis.task||'',
    detectedDueDate:analysis.dueDate||'', confidence:analysis.confidence||50
  })

  await Chat.create({userId:u._id,role:'user',content:userPrompt,topicId:resolvedTopic?._id,imageUrl:imageBase64})
  await Chat.create({userId:u._id,role:'assistant',content:analysis.explanation||'Tahlil qilindi',topicId:resolvedTopic?._id})

  if (resolvedTopic) updateUnderstanding(resolvedTopic._id, u._id).catch(()=>{})

  res.json({
    materialId: material._id,
    topic: resolvedTopic,
    analysis: { subject: analysis.subject, task: analysis.task, dueDate: analysis.dueDate, confidence: analysis.confidence, explanation: analysis.explanation }
  })
})

// Material asosida harakat — tugmalar bosilganda
app.post('/api/materials/:id/action', auth, async (req,res) => {
  const { action } = req.body // 'reminder' | 'flashcard' | 'explain' | 'quiz'
  const material = await Material.findOne({_id:req.params.id,userId:req.u._id})
  if (!material) return res.status(404).json({error:'Topilmadi'})

  if (action === 'reminder') {
    const r = await Reminder.create({userId:req.u._id,topicId:material.topicId,title:material.detectedTask||material.title,dueDate:material.detectedDueDate||''})
    return res.json({reminder:r})
  }
  if (action === 'flashcard') {
    const lang = req.u.lang||'uz'
    const system = `Quyidagi material asosida 3 ta flashcard tuz. FAQAT JSON: [{"front":"...","back":"..."}]. ${lang==='uz'?'O\'zbek tilida.':lang==='ru'?'На русском.':'In English.'}`
    const reply = await ai([{role:'user',content:material.summary+' '+material.detectedTask}], system, 500)
    const text = reply.replace(/```json|```/g,'').trim()
    let cards = []
    try { cards = JSON.parse(text) } catch {}
    const saved = []
    for (const c of cards) saved.push(await Flashcard.create({userId:req.u._id,topicId:material.topicId,front:c.front,back:c.back}))
    return res.json({flashcards:saved})
  }
  if (action === 'explain') {
    const lang = req.u.lang||'uz'
    const langNote = lang==='uz'?'O\'zbek tilida.':lang==='ru'?'На русском.':'In English.'
    const explanation = await ai([{role:'user',content:`"${material.detectedTask||material.title}" mavzusini chuqurroq tushuntir, misol bilan.`}], `Sen Twin o'qituvchisan. ${langNote} Aniq va tushunarli tushuntir.`, 600)
    return res.json({explanation})
  }
  res.status(400).json({error:'Noma\'lum amal'})
})

// ── QUIZ ────────────────────────────────────────────────────────
app.post('/api/topics/:id/quiz/generate', auth, async (req,res) => {
  const topic = await Topic.findOne({_id:req.params.id,userId:req.u._id})
  if (!topic) return res.status(404).json({error:'Topilmadi'})
  const questions = await generateQuiz(topic, req.u.lang||'uz', req.body.count||5)
  if (!questions.length) return res.status(500).json({error:'Test yaratilmadi, qayta urinib ko\'ring'})
  const quiz = await Quiz.create({userId:req.u._id,topicId:topic._id,topicName:topic.name,questions})
  res.json(quiz)
})
app.get('/api/topics/:id/quiz', auth, async (req,res) => {
  const quiz = await Quiz.findOne({userId:req.u._id,topicId:req.params.id}).sort({createdAt:-1})
  res.json(quiz)
})
app.post('/api/quiz/:id/submit', auth, async (req,res) => {
  const { score } = req.body // foiz
  const quiz = await Quiz.findOneAndUpdate({_id:req.params.id,userId:req.u._id},{lastScore:score,$inc:{attemptsCount:1}},{new:true})
  res.json(quiz)
})

// ── FLASHCARDS ──────────────────────────────────────────────────
app.get('/api/flashcards', auth, async (req,res) => {
  const q={userId:req.u._id}
  if(req.query.dueOnly==='true') q.nextReview={$lte:todayStr()}
  if(req.query.topicId) q.topicId=req.query.topicId
  res.json(await Flashcard.find(q).sort({nextReview:1}))
})
app.post('/api/flashcards/:id/review', auth, async (req,res) => {
  const card=await Flashcard.findOne({_id:req.params.id,userId:req.u._id})
  if(!card) return res.status(404).json({error:'Topilmadi'})
  const upd=sm2(card,req.body.quality); Object.assign(card,upd); await card.save()
  res.json(upd)
})
app.delete('/api/flashcards/:id', auth, async (req,res) => { await Flashcard.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── REMINDERS ───────────────────────────────────────────────────
app.get('/api/reminders', auth, async (req,res) => {
  res.json(await Reminder.find({userId:req.u._id,isDone:false}).sort({dueDate:1,createdAt:-1}))
})
app.patch('/api/reminders/:id', auth, async (req,res) => {
  res.json(await Reminder.findOneAndUpdate({_id:req.params.id,userId:req.u._id},req.body,{new:true}))
})
app.delete('/api/reminders/:id', auth, async (req,res) => { await Reminder.findOneAndDelete({_id:req.params.id,userId:req.u._id}); res.json({ok:true}) })

// ── TODAY ───────────────────────────────────────────────────────
app.get('/api/today', auth, async (req,res) => {
  const u=req.u
  const reminders = await Reminder.find({userId:u._id,isDone:false}).sort({dueDate:1}).limit(10)
  const dueCards = await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
  const recentTopics = await Topic.find({userId:u._id}).sort({lastActivityAt:-1}).limit(6)
  const recentChats = await Chat.find({userId:u._id,role:'user'}).sort({createdAt:-1}).limit(5)
  res.json({reminders, dueCards, recentTopics, recentActivity: recentChats.map(c=>({content:c.content,createdAt:c.createdAt}))})
})

// ── STATIC ──────────────────────────────────────────────────────
app.get('/ping', (_,res) => res.send('ok'))
app.get('/', (_,res) => res.sendFile(path.join(__dirname,'app.html')))
app.get('/app.html', (_,res) => res.sendFile(path.join(__dirname,'app.html')))

// ── TELEGRAM BOT ────────────────────────────────────────────────
let bot = null
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN)
  function appBtn() { return Markup.inlineKeyboard([[Markup.button.webApp('🧠 Twin ochish',`${DOMAIN}/app.html`)]]) }

  bot.start(async ctx => {
    const tid=String(ctx.from.id)
    let u=await User.findOne({telegramId:tid})
    if(!u) u=await User.create({telegramId:tid,name:ctx.from.first_name||'Foydalanuvchi',telegramUsername:ctx.from.username})
    await ctx.reply(`👋 Salom, ${u.name}!\n\n🧠 Men sizning Twin'ingizman — nimani o'rganayotgan bo'lsangiz, shu haqida gaplashing.`, appBtn())
  })

  bot.on('text', async ctx => {
    if(ctx.message.text.startsWith('/')) return
    const tid=String(ctx.from.id)
    const u=await User.findOne({telegramId:tid})
    if(!u) return ctx.reply('/start bosing')
    await ctx.sendChatAction('typing')
    const topics = await Topic.find({userId:u._id})
    const history = await Chat.find({userId:u._id,topicId:null}).sort({createdAt:-1}).limit(10)
    const messages=[...history.reverse().map(m=>({role:m.role,content:m.content})),{role:'user',content:ctx.message.text}]
    await Chat.create({userId:u._id,role:'user',content:ctx.message.text})
    const rawReply = await ai(messages, buildSystem(u, topics, null))
    const extracted = extractFromAI(rawReply)
    const cleanReply = cleanText(rawReply)
    let resolvedTopic = null
    if (extracted.newTopic) resolvedTopic = await findOrCreateTopic(u._id, extracted.newTopic)
    else if (extracted.topicName) resolvedTopic = await findOrCreateTopic(u._id, extracted.topicName)
    await Chat.create({userId:u._id,role:'assistant',content:cleanReply,topicId:resolvedTopic?._id})
    await ctx.reply(cleanReply, appBtn())
  })

  try {
    await bot.launch({dropPendingUpdates:true})
    console.log('✅ Bot ishga tushdi')
  } catch(e) {
    console.log('⚠️ Bot ishga tushmadi, faqat web rejimda davom etyapti:', e.message)
  }
}

app.listen(PORT,'0.0.0.0',()=>{ console.log(`✅ Server ${PORT}`); console.log('🧠 Twin v2.0') })
process.once('SIGINT',()=>bot?.stop('SIGINT'))
process.once('SIGTERM',()=>bot?.stop('SIGTERM'))
