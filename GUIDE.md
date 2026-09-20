# BBK AI Bot — Use Guide

## Users ke liye
| Command | Kya karta hai |
|---|---|
| `/start` | Welcome + force-sub check (channel join karna padta hai) |
| `/help` | Commands ki list |
| `/stats` | Aaj kitne messages use hue, kitne bache (limit 30/day, reset IST midnight) |
| `/clear` | AI ki memory clear (naya topic shuru karne ke liye) |
| `/export` | Apni chat history `.txt` me download |
| `/about` | Bot ki info |

**Private chat:** seedha sawal/code/problem bhejo. AI pichle 20 messages yaad rakhta hai.
**Group me bot kab bolta hai:** (1) `@botusername` mention, (2) bot ke message ka reply, (3) message me trigger word: `ai, bbk, bot, help, solve, explain`.
Group me har user ki memory alag hai (koi doosre ki chat nahi dekh sakta). Trigger words badalne ke liye `.env` me `GROUP_TRIGGERS`.

## Admin (sirf ADMIN_ID)
| Command | Kya karta hai |
|---|---|
| `/stats` | Dashboard: total users, aaj active, aaj ke messages, blocked, business connections |
| `/broadcast <text>` | Sabko message (HTML allowed: `<b>bold</b>`). Pehle tujhe preview aata hai; HTML galat ho to cancel |
| `/bresume` | Paused broadcast aage badhao (Vercel pe 240s baad broadcast khud rukta hai) |
| `/ban <user_id>` / `/unban <user_id>` | User ko band / chalu |
| `/models` | Har AI model ko ping: ✅ chal raha / ❌ dead + kaunsi API key missing |
| `/business` | Business automation panel |

Admin ki daily limit nahi hoti.

## Business / Chat Automation (sirf BUSINESS_OWNERS)
Setup: BotFather → Bot Settings → **Business Mode** ON → Telegram (Premium) → Settings → Telegram Business → **Chatbots** → bot add, "Reply to messages" ON.

| Command / button | Kya karta hai |
|---|---|
| `/business` | Panel: Automation ON/OFF · Default mode (AI / Fixed) · Scope (Selected chats / All chats) · Chats list |
| `/bizwelcome <text>` (`off`) | Welcome — sirf customer ke **pehle** message par |
| `/bizreply <text>` (`off`) | Default fixed reply |
| `/bizprompt <text>` (`reset`) | AI ko extra instructions (jaise: "hum 10-6 open hain, price 500") |
| `/bizcool <min>` | Fixed reply dobara bhejne se pehle wait (default 360) |
| `/bizpause <min>` | Tu khud reply kare to AI itne min chup (default 30) |
| `/cancel` | Custom-reply likhna cancel |
| Chat ka **"Manage bot"** button | Us chat ka panel: Enable/Disable, Mode (Default→AI→Fixed→Off), Custom reply |

Modes: **AI** = AI jawab deta hai · **Fixed** = tera likha text · **Off** = us chat me chup.
Default: automation OFF + sirf selected chats. Customer ko kabhi error nahi dikhta.

## Rules jo duplicate se bachate hain
Welcome ek baar · fixed reply cooldown · same message dobara aaye to ek hi reply · edited/deleted par reply nahi · tera apna message ya bot ka echo ignore · max 20 replies/hour/chat.
