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
*/

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `http://localhost:${PORT}`;

/* ---------- shared "room" storage (juftlik umumiy maʼlumotlari) ----------
   Har bir juftlik "kod" orqali aniqlanadi (ulash kodi). Rasm/audio kabi
   katta fayllar ham shu yerda (base64 holida) saqlanadi — shuning uchun
   JSON body limitini kattaroq qildik. Kichik loyiha uchun oddiy JSON fayl
   bazasi yetarli; kattalashsa SQLite/Mongo'ga o'tish mumkin. */

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

/* ---------- web server ---------- */

const app = express();
app.use(express.json({ limit: "25mb" })); // rasm/audio base64 uchun katta limit
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

app.get("/api/room/:code", (req, res) => {
  res.json(readRoom(req.params.code));
});

app.put("/api/room/:code", (req, res) => {
  writeRoom(req.params.code, req.body || defaultRoom());
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

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Xush kelibsiz! 💕 Ilovani ochish uchun tugmani bosing:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💌 Ilovani ochish", web_app: { url: WEB_APP_URL } }],
        ],
      },
    });
  });

  bot.on("polling_error", (err) => {
    console.error("Telegram polling xatosi:", err.message);
  });

  console.log("Telegram bot ishga tushdi (polling rejimida).");
}

/* ---------- eslatma ----------
   Endi juftlik maʼlumotlari (xotira, xatlar, musiqa, vaqt/rejalar/orzular/vazifalar)
   /api/room/:code orqali serverda (data/room-KOD.json) saqlanadi va ikkala
   sherik ham bir xil kodga ulanganda BIR XIL maʼlumotni koʻradi.
   Faqat shaxsiy profil (ism, jins, "meni bilib olish" savol-javoblari — qa
   maydoni ichida ismga bogʻlab) shaxsga tegishli boʻlib qoladi.

   Eslatma: bu oddiy fayl-baza — koʻp foydalanuvchi/katta miqyos uchun
   emas, lekin bitta juftlik uchun yetarli. Hosting qayta ishga tushganda
   fayllar saqlanib qoladi (agar hosting "ephemeral filesystem" ishlatmasa —
   masalan Render'ning bepul rejasida disk vaqti-vaqti bilan tozalanishi
   mumkin, shu holatda Render "Persistent Disk" qoʻshish yoki keyinchalik
   haqiqiy bazaga (Postgres/Mongo) oʻtish tavsiya etiladi).
------------------------------------------------- */
