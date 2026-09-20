# BBK AI Bot v2

```
Telegram ──> bot (Oracle VPS, long polling, grammY) ──> proxy (Cloudflare Pages Function) ──> Groq / Cerebras / Gemini / Workers AI / OpenRouter / Mistral / HF
```

> **Do modes:** Vercel (webhook, server RAM 0) **ya** Oracle/pm2 (polling). Ek token pe ek hi mode chalao.
> Tere Oracle server pe RAM peak pe full hota hai, isliye **Vercel recommended** (section 2A).

## 1) Proxy update (Cloudflare Pages)
1. `proxy/functions/api/ai-chat.js` ko apne repo ke `functions/api/ai-chat.js` se replace karo, deploy.
2. Pages → Settings → **Variables and Secrets**:

| Name | Note |
|---|---|
| `AI_SHARED_SECRET` | random lamba string (bot ke `.env` me same) |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | already hain |
| `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY` | naye |
| `MISTRAL_API_KEY`, `HF_API_KEY` | optional |
| `LEGACY_OPEN=1` | **sirf tab tak** jab tak purana Vercel bot band nahi hota |
| `MODELS_JSON` | optional: model list override (deploy ke bina) |

3. (Optional, no key needed) Pages → Settings → Functions → **Bindings → Workers AI**, variable name `AI`.
4. Purane Vercel bot ko bina `LEGACY_OPEN` chalana ho: uske `axios.post(config.AI_API_URL, body, {...})` me headers me `'X-BBK-Secret': process.env.AI_SHARED_SECRET` add karo.

Free-tier model lineups jaldi badalte hain. Koi model mar jaaye to code change nahi: `MODELS_JSON` me naya daalo. Admin `/models` command sab ko ping karke dead/alive dikhata hai.

## 2A) Bot on Vercel (webhook) — recommended
1. `bot/` folder ko GitHub repo me daalo. Vercel → New Project → import → **Root Directory = `bot`**, Framework = Other. (Purane v1 project me hi deploy karoge to URL wahi `/api/webhook` rahega.)
2. Vercel → Settings → Environment Variables:

| Name | Value |
|---|---|
| `BOT_TOKEN`, `MONGO_DB`, `AI_API_URL`, `AI_SHARED_SECRET` | wahi jo `.env.example` me hain |
| `WEBHOOK_SECRET` | random 16+ chars, sirf `A-Z a-z 0-9 _ -` |
| `ADMIN_ID`, `BUSINESS_OWNERS`, `DAILY_LIMIT`, `FORCE_SUB_CHANNEL`, `BIZ_PROVIDERS` | optional (defaults `.env.example` me) |

3. MongoDB Atlas → Network Access → **0.0.0.0/0** allow (Vercel ke IP badalte rehte hain).
4. Deploy. Check: `https://<project>.vercel.app/api/webhook` kholo → `{"ok":true,"mode":"webhook"}`.
5. Webhook set karo (Termux/PC me, `bot/` folder me, ek baar `npm i` ke baad):
```bash
BOT_TOKEN=... WEBHOOK_SECRET=... WEBHOOK_URL=https://<project>.vercel.app/api/webhook node scripts/set-webhook.js
```
Ye webhook + secret + business updates + commands menu sab set karta hai. (Bina Termux ke: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=<URL> -d secret_token=<SECRET> -d 'allowed_updates=["message","edited_message","callback_query","business_connection","business_message","edited_business_message","deleted_business_messages"]'` — par commands menu tab set nahi hota.)
6. Test: bot ko `/start`, admin se `/models`.

Vercel ke trade-offs: idle ke baad pehla reply 1-3s slow (cold start) · `/broadcast` 240s baad khud pause hota hai, `/bresume` se aage · function limit 300s (Hobby) · Vercel Hobby non-commercial use ke liye hai.
Wapas Oracle/polling: `npm run webhook:delete`, phir 2B.

## 2B) Bot on Oracle VPS (polling)

**Easy way (recommended):** zip server pe copy karo, phir
```bash
bash deploy/setup-server.sh BBK-Ai-Bot-v2.zip      # ya: unzip karke  bash BBK-Ai-Bot-v2/deploy/setup-server.sh
```
Ye alag folder `~/bbk-ai-bot-v2` banata hai (apna node_modules + `.env` + pm2 process), Node 20+ na ho to nvm se alag Node 22 lagata hai, `.env` ke 4 required values puchta hai, pm2 me chalata hai. Dubara chalao = update (`.env` safe).

**Manual way:**
```bash
node -v   # 20+ chahiye. Nahi to: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
cd bot && cp .env.example .env && nano .env
npm ci --omit=dev
sudo npm i -g pm2
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup   # startup ka printed command chala do
pm2 logs bbk-ai-bot
```
* Bot start par webhook khud hata deta hai. **Vercel project pause/delete karo**, warna dono ek token pe fight karenge (409).
* Existing users/limits/sessions same MongoDB collections me chalte rahenge (daily counter ek baar reset hoga: date format IST me badla).
* 1GB RAM: `free -m` check karo; swap 1GB add kar lo agar baaki bots bhi chal rahe hain.

## 3) Business / Chat Automation (Secretary mode)
1. BotFather → `/mybots` → bot → **Bot Settings → Business Mode** → ON
2. Telegram (Premium account) → **Settings → Telegram Business → Chatbots** → bot add karo, **"Reply to messages"** ON, chats select karo
3. Bot me `/business` → panel. Default: automation **OFF**, scope **selected chats only**.
4. Kisi chat ke liye: us chat ke top me Telegram ka **"Manage bot"** button → panel khulega (enable/mode/custom reply).

Rules: welcome sirf pehle customer message par · fixed reply cooldown (default 6h) · owner ne khud reply kiya to AI 30 min pause · duplicate/edited/deleted messages par reply nahi · bot ka apna echo ignore · max 20 replies/hour/chat · AI fail ho to customer ko kuch nahi jaata (admin ko alert).
Commands: `/bizwelcome`, `/bizreply`, `/bizprompt`, `/bizcool <min>`, `/bizpause <min>`.

**Privacy:** default me customer chats sirf `groq, cerebras, cloudflare` ko jaati hain. Gemini/Mistral free tier me data provider ke training me use ho sakta hai — isliye default me band. `BIZ_PROVIDERS=all` se khol sakte ho.

## Tests
```bash
cd proxy && node --test test/proxy.test.mjs
cd bot && npm test            # format + db + e2e (mock Telegram, polling)
cd bot && E2E_MODE=webhook node --test test/e2e.test.js   # wahi scenarios Vercel-webhook handler pe  — MongoDB chahiye (TEST_MONGO=mongodb://...)
# real MongoDB (Atlas TEST db) pe atomicity tests bhi: TEST_REAL_MONGO=1 TEST_MONGO=<uri> npm test
```
