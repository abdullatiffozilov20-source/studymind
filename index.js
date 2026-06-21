// Twin — AI Learning Companion (backend)
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
  // Twin profili — AI vaqt o'tishi bilan shu yerni to'ldiradi va o'qiydi
  understanding: {
    strengths: [String],
    weakSpots: [String],
    summary: String, // bir necha jumlali umumiy holat
    updatedAt: Date
  },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
})

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,
  imageUrl: String, // agar rasm yuborilgan bo'lsa (base64 yoki vaqtinchalik)
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
  if (q >= 3) { interval = rep===0?1:rep===1?6:Math.round(interval*ef); rep++; ef=Math.max(1.3,ef+0.1-(5-q)*(0.08+(5-q)*0.02)) } else { rep=0; interval=1 }
  return { interval, easeFactor: ef, repetitions: rep, nextReview: new Date(Date.now()+interval*86400000).toISOString().split('T')[0] }
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

// Vision — rasmni o'qish uchun (Groq vision model)
async function aiVision(imageBase64, prompt, system) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const r = await groq.chat.completions.create({
      model: 'llama-3.2-90b-vision-preview',
      max_tokens: 700,
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
Shuni hisobga olib, tushuntirishlaringni shaxsiylashtir — qiynalgan joyini soddaroq tushuntir, kuchli joyida tezroq o'tib ket.`
  }

  return `Sen Twin — foydalanuvchining shaxsiy o'rganish hamrohisan. ChatGPT kabi erkin gaplashasan, lekin orqa fonda uning o'rganish jarayonini kuzatib, eslab borasan.
${langNote}
Foydalanuvchi: ${user?.name}
Hozirgi mavzular: ${topicList||'hali yo\'q'}
${activeTopic?`Hozir gaplashayotgan mavzu: ${activeTopic.emoji}${activeTopic.name}`:''}
${twinContext}

QOIDALAR:
1. Tabiiy, qisqa va foydali javob ber — ortiqcha cho'zma, lekin sovuq ham bo'lma.
2. Foydalanuvchi yangi narsa o'rganayotganini sezsang va bu mavjud mavzularga mos kelmasa, yangi mavzu taklif qil: [NEWTOPIC:Nomi]
3. Agar mavjud mavzuga aloqador bo'lsa: [TOPIC:MavzuNomi]
4. Agar vazifa/eslatma kerak bo'lsa (masalan "ertaga imtihonim bor"): [REMIND:sarlavha:YYYY-MM-DD yoki bo'sh]
5. Agar flashcard yaratish foydali bo'lsa (talaba biror faktni/qoidani o'rgandi): [FC:savol|javob]
6. Bugungi sana: ${todayStr()}
7. Hech qachon forma to'ldirishni so'rama — suhbatdan o'zing tushunib ol.`
}

function extractFromAI(text) {
  const r = {}
  const nt = text.match(/\[NEWTOPIC:([^\]]+)\]/i); if (nt) r.newTopic = nt[1].trim()
  const tp = text.match(/\[TOPIC:([^\]]+)\]/i); if (tp) r.topicName = tp[1].trim()
  const rm = text.match(/\[REMIND:([^:]+):([^\]]*)\]/i); if (rm) r.reminder = { title: rm[1].trim(), dueDate: rm[2].trim() }
  const fcs = [...text.matchAll(/\[FC:([^|]+)\|([^\]]+)\]/gi)]
  if (fcs.length) r.flashcards = fcs.map(m => ({ front: m[1].trim(), back: m[2].trim() }))
  return r
}

function cleanText(t) {
  return t.replace(/\[NEWTOPIC:[^\]]+\]/gi,'').replace(/\[TOPIC:[^\]]+\]/gi,'').replace(/\[REMIND:[^\]]+\]/gi,'').replace(/\[FC:[^\]]+\]/gi,'').replace(/\n{3,}/g,'\n\n').trim()
}

// Twin xotirasini yangilash — mavzu bo'yicha tushunish profilini AI orqali yangilaydi
async function updateUnderstanding(topicId, userId) {
  const topic = await Topic.findById(topicId)
  if (!topic) return
  const recentChats = await Chat.find({ userId, topicId }).sort({ createdAt: -1 }).limit(20)
  if (recentChats.length < 4) return // hali yetarli ma'lumot yo'q

  const history = recentChats.reverse().map(c => `${c.role==='user'?'Foydalanuvchi':'Twin'}: ${c.content}`).join('\n')
  const system = `Quyidagi suhbat asosida foydalanuvchining shu mavzudagi holatini tahlil qil.
FAQAT JSON qaytar, boshqa hech narsa yozma:
{"strengths":["...","..."],"weakSpots":["...","..."],"summary":"bir-ikki jumlali umumiy xulosa"}
O'zbek tilida yoz. Agar yetarli ma'lumot bo'lmasa, bo'sh array va qisqa summary qaytar.`
  const reply = await ai([{role:'user',content:history}], system, 300)
  const text = reply.replace(/```json|```/g,'').trim()
  try {
    const parsed = JSON.parse(text)
    topic.understanding = {
      strengths: parsed.strengths||[], weakSpots: parsed.weakSpots||[],
      summary: parsed.summary||'', updatedAt: new Date()
    }
    await topic.save()
  } catch {}
}

// Mavzuni nomi bo'yicha topish yoki yaratish
async function findOrCreateTopic(userId, name) {
  if (!name) return null
  const existing = await Topic.findOne({ userId, name: new RegExp('^'+name.trim()+'$','i') })
  if (existing) return existing
  return await Topic.create({ userId, name: name.trim(), emoji: pickEmoji(name) })
}

function pickEmoji(name) {
  const n = name.toLowerCase()
  if (/ingliz|english|til|language|франц|испан/.test(n)) return '🗣️'
  if (/matemat|math|algebra|geometr/.test(n)) return '📐'
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
app.patch('/api/topics/:id', auth, async (req,res) => {
  const t = await Topic.findOneAndUpdate({_id:req.params.id,userId:req.u._id},req.body,{new:true})
  res.json(t)
})
app.delete('/api/topics/:id', auth, async (req,res) => {
  await Topic.findOneAndDelete({_id:req.params.id,userId:req.u._id})
  res.json({ok:true})
})
app.get('/api/topics/:id/chat', auth, async (req,res) => {
  res.json(await Chat.find({userId:req.u._id,topicId:req.params.id}).sort({createdAt:1}).limit(50))
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

  // Yangi mavzu yaratish yoki mavjudiga bog'lash
  let resolvedTopic = activeTopic
  if (extracted.newTopic && !activeTopic) {
    resolvedTopic = await findOrCreateTopic(u._id, extracted.newTopic)
  } else if (extracted.topicName && !activeTopic) {
    resolvedTopic = await findOrCreateTopic(u._id, extracted.topicName)
  }
  if (resolvedTopic) { resolvedTopic.lastActivityAt = new Date(); await resolvedTopic.save() }

  let savedReminder = null
  if (extracted.reminder) {
    savedReminder = await Reminder.create({userId:u._id,topicId:resolvedTopic?._id,title:extracted.reminder.title,dueDate:extracted.reminder.dueDate||''})
  }
  let savedCards = []
  if (extracted.flashcards?.length) {
    for (const fc of extracted.flashcards) {
      savedCards.push(await Flashcard.create({userId:u._id,topicId:resolvedTopic?._id,topicName:resolvedTopic?.name,front:fc.front,back:fc.back}))
    }
  }

  await Chat.create({userId:u._id,role:'assistant',content:cleanReply,topicId:resolvedTopic?._id,extractedData:extracted})

  // Twin xotirasini fon rejimda yangilash (javobni kutmaymiz)
  if (resolvedTopic) updateUnderstanding(resolvedTopic._id, u._id).catch(()=>{})

  res.json({reply:cleanReply, topic:resolvedTopic, savedReminder, savedCards})
})

// ── CHAT (rasm — Homework Camera) ──────────────────────────────
app.post('/api/chat/image', auth, async (req,res) => {
  const {imageBase64, message, topicId} = req.body
  if(!imageBase64) return res.status(400).json({error:'Rasm kerak'})
  const u=req.u
  const topics = await Topic.find({userId:u._id})
  let activeTopic = topicId ? await Topic.findById(topicId) : null

  const lang = u.lang||'uz'
  const langNote = lang==='uz'?'FAQAT o\'zbek tilida.':lang==='ru'?'ТОЛЬКО русский.':'ONLY English.'
  const visionSystem = `Sen Twin — o'quv yordamchisan. Rasmda uy vazifasi, darslik sahifasi, qo'lyozma yoki kod bo'lishi mumkin. ${langNote}
Rasmni tahlil qil va qisqa tushuntir: nima haqida, qaysi mavzuga oid. Agar vazifa/muddat ko'rinsa ayt.
QOIDALAR:
1. Mavzu nomi: [TOPIC:Nomi] yoki yangi bo'lsa [NEWTOPIC:Nomi]
2. Agar muddat bor bo'lsa: [REMIND:sarlavha:YYYY-MM-DD]
3. Foydali bo'lsa flashcard: [FC:savol|javob]
4. Qisqa va aniq javob ber, 3-4 gapdan oshma.`

  const userPrompt = message?.trim() || "Bu rasmda nima bor? Tushuntir va kerak bo'lsa yordam ber."
  const rawReply = await aiVision(imageBase64, userPrompt, visionSystem)
  const extracted = extractFromAI(rawReply)
  const cleanReply = cleanText(rawReply)

  let resolvedTopic = activeTopic
  if (extracted.newTopic && !activeTopic) resolvedTopic = await findOrCreateTopic(u._id, extracted.newTopic)
  else if (extracted.topicName && !activeTopic) resolvedTopic = await findOrCreateTopic(u._id, extracted.topicName)
  if (resolvedTopic) { resolvedTopic.lastActivityAt = new Date(); await resolvedTopic.save() }

  await Chat.create({userId:u._id,role:'user',content:userPrompt,topicId:resolvedTopic?._id,imageUrl:'[rasm yuborildi]'})

  let savedReminder = null
  if (extracted.reminder) savedReminder = await Reminder.create({userId:u._id,topicId:resolvedTopic?._id,title:extracted.reminder.title,dueDate:extracted.reminder.dueDate||''})
  let savedCards = []
  if (extracted.flashcards?.length) {
    for (const fc of extracted.flashcards) savedCards.push(await Flashcard.create({userId:u._id,topicId:resolvedTopic?._id,topicName:resolvedTopic?.name,front:fc.front,back:fc.back}))
  }

  await Chat.create({userId:u._id,role:'assistant',content:cleanReply,topicId:resolvedTopic?._id,extractedData:extracted})
  if (resolvedTopic) updateUnderstanding(resolvedTopic._id, u._id).catch(()=>{})

  res.json({reply:cleanReply, topic:resolvedTopic, savedReminder, savedCards})
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

// ── TODAY (passiv natija ko'rinishi) ───────────────────────────
app.get('/api/today', auth, async (req,res) => {
  const u=req.u
  const reminders = await Reminder.find({userId:u._id,isDone:false}).sort({dueDate:1}).limit(10)
  const dueCards = await Flashcard.countDocuments({userId:u._id,nextReview:{$lte:todayStr()}})
  const recentTopics = await Topic.find({userId:u._id}).sort({lastActivityAt:-1}).limit(5)
  const recentChats = await Chat.find({userId:u._id,role:'user'}).sort({createdAt:-1}).limit(5)
  res.json({reminders, dueCards, recentTopics, recentActivity: recentChats.map(c=>({content:c.content,createdAt:c.createdAt}))})
})

// ── STATIC ──────────────────────────────────────────────────────
app.get('/ping', (_,res) => res.send('ok'))
app.get('/', (_,res) => res.sendFile(path.join(__dirname,'app.html')))
app.get('/app.html', (_,res) => res.sendFile(path.join(__dirname,'app.html')))

// ── TELEGRAM BOT (oddiy, web app ochish uchun) ─────────────────
let bot = null
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN)
  function appBtn() { return Markup.inlineKeyboard([[Markup.button.webApp('🧠 Twin ochish',`${DOMAIN}/app.html`)]]) }

  bot.start(async ctx => {
    const tid=String(ctx.from.id)
    let u=await User.findOne({telegramId:tid})
    if(!u) u=await User.create({telegramId:tid,name:ctx.from.first_name||'Foydalanuvchi',telegramUsername:ctx.from.username})
    await ctx.reply(`👋 Salom, ${u.name}!\n\n🧠 Men sizning Twin'ingizman — nimani o'rganayotgan bo'lsangiz, shu haqida gaplashing, men sizga yordam beraman.`, appBtn())
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

app.listen(PORT,'0.0.0.0',()=>{ console.log(`✅ Server ${PORT}`); console.log('🧠 Twin v1.0') })
process.once('SIGINT',()=>bot?.stop('SIGINT'))
process.once('SIGTERM',()=>bot?.stop('SIGTERM'))
