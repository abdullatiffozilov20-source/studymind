[README.md](https://github.com/user-attachments/files/27593921/README.md)
# 🧠 StudyMind AI Bot

Telegram Bot + Web Mini App

## Fayllar
- `index.js` — Bot + server kodi
- `web.html` — Dashboard (Telegram Mini App)
- `package.json` — Dependencies

## GitHub → Render deploy

### 1. GitHub
```
1. github.com → New repository → "studymind-bot"
2. Uchala faylni upload qiling
```

### 2. Render
```
1. render.com → New → Web Service
2. GitHub repo ni ulang
3. Build Command: npm install
4. Start Command: npm start
5. Environment Variables:
   TELEGRAM_BOT_TOKEN = (BotFather dan)
   ANTHROPIC_API_KEY  = (console.anthropic.com dan)
   APP_URL            = (Render bergan URL, masalan: https://studymind-bot.onrender.com)
6. Deploy!
```

### 3. Tayyor!
Botga /start yuboring.
