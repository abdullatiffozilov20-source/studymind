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
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `http://localhost:${PORT}`;

/* ---------- web server ---------- */

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // app.html, va agar boshqa statik fayllar qo'shsangiz ham shu yerdan xizmat qiladi

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
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

/* ---------- keyingi qadam uchun eslatma ----------
   Hozircha "Mening profilim"dagi javoblar va xotiralar brauzerning
   localStorage'ida saqlanadi — bu shaxsiy, faqat o'sha qurilmada qoladi.

   Ikkala sherikning ma'lumotlari HAQIQIY ravishda bir joyda uchrashishi
   (masalan, siz yozgan javobni sherigingiz o'z tugmachasida ko'rishi) uchun
   shu index.js ichiga:
     1) bir baza (masalan SQLite, MongoDB yoki oddiy JSON fayl) qo'shish,
     2) Telegram Web App'dan keladigan foydalanuvchi ID (Telegram.WebApp.initDataUnsafe.user.id)
        orqali kimning javobi ekanini aniqlash,
     3) /api/answers kabi endpoint orqali app.html'dan fetch() bilan saqlash/o'qish
   kerak bo'ladi. Tayyor bo'lganingizda ayting — shu qismini ham qo'shib beraman.
------------------------------------------------- */
