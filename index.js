/* index.js
   Express serveri app.html'ni (Telegram Mini App) taqdim etadi va
   Telegram botga /start buyrug'i orqali "Ilovani ochish" tugmasini chiqaradi.

   Kerakli muhit o'zgaruvchilari (.env yoki hosting panelida sozlang):
     BOT_TOKEN      — @BotFather'dan olingan token (majburiy)
     WEB_APP_URL    — app.html joylashgan HTTPS manzil, masalan:
                       https://sizning-domeningiz.com/
                       (Telegram web_app tugmasi faqat HTTPS bilan ishlaydi,
                        localhost bilan ishlamaydi — deploy qilingandan keyin shu yerga qo'ying)
     PORT           — server porti (ixtiyoriy, default 3000)

   MUHIM — agar ulanish "ishlamayapti" boʻlsa eng koʻp uchraydigan sabab:
   ba'zi bepul hostinglar (Render Free va h.k.) diskni har safar qayta
   ishga tushganda TOZALAB yuboradi ("ephemeral filesystem"). Bu holatda
   shu faylda saqlangan /data papkasi ham oʻchib ketadi va kod haqiqatda
   "unutiladi". Agar shu muammo boʻlsa, hosting panelida "Persistent Disk"
   yoqing (Render'da bor xizmat) yoki VPS'ga oʻting — aks holda kod har
   safar tasodifiy vaqtda yoʻqolib turaveradi.
*/

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `http://localhost:${PORT}`;

/* ---------- shared "room" storage (juftlik umumiy maʼlumotlari) ---------- */

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function roomPath(code) {
  const safe = String(code).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return path.join(DATA_DIR, `room-${safe}.json`);
}
function defaultRoom() {
  return { memories: [], letters: [], tracks: [], timeline: [], plans: [], bucket: [], tasks: [], qa: {}, mapPins: [], anniversaries: [] };
}
function readRoom(code) {
  try {
    const p = roomPath(code);
    if (!fs.existsSync(p)) return defaultRoom();
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) { return defaultRoom(); }
}
function writeRoom(code, data) {
  fs.writeFileSync(roomPath(code), JSON.stringify(data));
}
function roomExists(code) {
  return fs.existsSync(roomPath(code));
}

// Har bir savol-javob (qa) faqat "kimdir aynan shu savolni so'ragan" bo'lsa
// ko'rsatiladi — hech kim so'ramagan / tasodifan qolib ketgan javoblar
// tashqariga chiqarilmaydi (shaxsiy profil himoyasi uchun asosiy chora).
function redactRoom(room) {
  const askedKeys = new Set();
  Object.values(room.qa || {}).forEach(person => {
    (person.selectedForPartner || []).forEach(k => askedKeys.add(k));
  });
  const redactedQa = {};
  Object.entries(room.qa || {}).forEach(([name, person]) => {
    const answers = {};
    Object.entries(person.answers || {}).forEach(([key, val]) => {
      if (askedKeys.has(key)) answers[key] = val;
    });
    redactedQa[name] = { answers, selectedForPartner: person.selectedForPartner || [], avatar: person.avatar };
  });
  return { ...room, qa: redactedQa };
}

/* ---------- identity (Telegram foydalanuvchisi <-> xona) ----------
   Bu — profil ochib ketsa yoki ilova/telefon almashtirilsa ham,
   Telegram akkaunti orqali eski profilga qaytadan ulanish imkonini beradi. */

const IDENTITY_PATH = path.join(DATA_DIR, "identities.json");
function readIdentities() {
  try {
    if (!fs.existsSync(IDENTITY_PATH)) return {};
    return JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
  } catch (e) { return {}; }
}
function writeIdentities(data) {
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(data));
}

/* ---------- web server ---------- */

const app = express();
app.use(express.json({ limit: "25mb" })); // rasm/audio base64 uchun katta limit
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

app.get("/api/room-exists/:code", (req, res) => {
  res.json({ exists: roomExists(req.params.code) });
});

app.get("/api/room/:code", (req, res) => {
  res.json(redactRoom(readRoom(req.params.code)));
});

app.put("/api/room/:code", (req, res) => {
  writeRoom(req.params.code, req.body || defaultRoom());
  res.json({ ok: true });
});

app.get("/api/identity/:tgId", (req, res) => {
  const identities = readIdentities();
  const entry = identities[req.params.tgId];
  if (!entry) return res.status(404).json({ found: false });
  res.json({ found: true, ...entry });
});

app.post("/api/identity", (req, res) => {
  const { tgId, roomCode, name, gender } = req.body || {};
  if (!tgId || !roomCode) return res.status(400).json({ ok: false, error: "tgId va roomCode kerak" });
  const identities = readIdentities();
  identities[String(tgId)] = { roomCode, name, gender, savedAt: Date.now() };
  writeIdentities(identities);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Web server ishlamoqda: http://localhost:${PORT}`);
});

/* ---------- telegram bot ---------- */

if (!BOT_TOKEN) {
  console.warn(
    "BOT_TOKEN topilmadi — bot ishga tushmadi, faqat web server ishlayapti.\n" +
    "Botni ham ishga tushirish uchun BOT_TOKEN muhit o'zgaruvchisini sozlang."
  );
} else {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  // Botni ishga tushirishda: eski loyihadan qolgan buyruqlar roʻyxatini
  // yangisi bilan almashtiramiz, va "Ilova" menyusi tugmasini shu ilovaga bogʻlaymiz.
  bot.setMyCommands([
    { command: "start", description: "Ilovani boshlash / qayta ochish" },
    { command: "help", description: "Yordam" },
  ]).catch(err => console.error("setMyCommands xatosi:", err.message));

  bot.setChatMenuButton({
    menu_button: { type: "web_app", text: "Ilova", web_app: { url: WEB_APP_URL } },
  }).catch(err => console.error("setChatMenuButton xatosi:", err.message));

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      // Eski loyihadan qolgan doimiy (custom) klaviaturani tozalaymiz —
      // aks holda eski tugmalar ("Fanlar", "Stats" va h.k.) ekranda qolib ketaveradi.
      await bot.sendMessage(chatId, "🧹 Eski menyu tozalandi.", {
        reply_markup: { remove_keyboard: true },
      });
      await bot.sendMessage(chatId,
        "Xush kelibsiz! 💕\n\nBu — ikkalangiz uchun maxsus ilova: xotiralar, xatlar, musiqa, muhim sanalar va yana ko'p narsa — barchasi bitta joyda.\n\nBoshlash uchun pastdagi tugmani bosing 👇",
        {
          reply_markup: {
            inline_keyboard: [[{ text: "💌 Ilovani ochish", web_app: { url: WEB_APP_URL } }]],
          },
        }
      );
    } catch (err) {
      console.error("/start ichida xatolik:", err.message);
    }
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
      "Yordam:\n/start — ilovani ochish tugmasini qayta chiqarish\n\nAgar tugma ishlamasa, botni bloklab, qayta yozib ko'ring."
    ).catch(() => {});
  });

  bot.on("polling_error", (err) => {
    // 409 xatosi odatda: shu bot tokeni bilan BOSHQA joyda (masalan eski
    // deploy hali ishlab turibdi) parallel ravishda polling ishlayapti degani —
    // shu holatda /start HECH KIMGA ishlamaydi. Eski deployni to'xtating.
    if (String(err.message).includes("409")) {
      console.error("Telegram polling 409 xatosi — bu tokendan BOSHQA joyda ham bot ishlab turgan bo'lishi mumkin (masalan eski deploy). Faqat bitta joyda ishga tushiring.");
    } else {
      console.error("Telegram polling xatosi:", err.message);
    }
  });

  console.log("Telegram bot ishga tushdi (polling rejimida).");
}

/* ---------- eslatma ----------
   Endi juftlik maʼlumotlari (xotira, xatlar, musiqa, vaqt/rejalar/orzular/vazifalar)
   /api/room/:code orqali serverda (data/room-KOD.json) saqlanadi va ikkala
   sherik ham bir xil kodga ulanganda BIR XIL maʼlumotni koʻradi.

   Yangi: /api/identity orqali Telegram foydalanuvchi ID'si xonaga bog'lanadi —
   ilova o'chirilib qayta o'rnatilsa yoki localStorage tozalansa ham, xuddi shu
   Telegram akkaunt bilan kirilsa, eski xonaga avtomatik qaytadan ulanadi.

   Javoblar (qa.answers) endi faqat "kimdir aynan shu savolni so'ragan" bo'lsa
   qaytariladi (redactRoom) — bu asosiy shaxsiylik chorasi.
------------------------------------------------- */
