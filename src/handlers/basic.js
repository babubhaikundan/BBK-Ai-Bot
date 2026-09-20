import { InlineKeyboard, InputFile } from "grammy";
import { config } from "../config.js";
import { escapeHtml, sessionKey, todayKey } from "../util.js";
import { ensureSubscribed, isSubscribed } from "../forcesub.js";
import { touchUser, getUsage, adminStats, getHistory, clearSession } from "../db.js";

const welcomeText = (name) => `
<b>🤖 BabuBhaiKundan AI - Assistant</b>

Hello <b>${escapeHtml(name)}</b> 👋

I am an advanced AI assistant created by <b>𝕂𝕦𝕟𝕕𝕒𝕟 𝕐𝕒𝕕𝕒𝕧 ⚠️</b>  
👷‍♂️ <i>Civil Engineer by Degree</i>  
👨‍💻 <i>Developer by Passion</i>

📞<b> Contact: @kundan_yadav_bot ✅️</b>

<b>✨ Key Features</b>
🔄 <b>Multi-AI Rotation</b> – fast & reliable responses  
🧠 <b>Smart Memory</b> – understands conversation context  
📊 <b>Daily Limit</b> – ${config.DAILY_LIMIT} free messages per day  

<b>🛠️ Useful Commands</b>
📊 /stats – check daily usage & remaining limit  
🧹 /clear – clear chat memory & start fresh  
💾 /export – download chat history (.txt)  
ℹ️ /about – information about the bot  

<i>Send any question, code, or problem to get started 🚀</i>
`;

const AFTER_JOIN = `
<b>🤖 BabuBhaiKundan AI</b>

Welcome 🎉

<b>⚡ Fast • Smart • Reliable AI Assistant</b>

💻 Coding help
📚 Study & exam help
🧠 Doubt solving
📝 Writing & explanations

<b>🛠️ Commands</b>
🤖 /start – start fresh session  
📊 /stats – check daily usage  
🧹 /clear – clear chat memory  
💾 /export – download chat history  
ℹ️ /about – bot information  
📞 Contact - @kundan_yadav_bot ✅️

<i>Send any message to start chatting 🚀</i>
`;

const startKb = () => new InlineKeyboard().url("🌐 Website", "https://babubhaikundan.pages.dev").row().text("🧹 Clear Memory", "clear");

export function registerBasic(bot, { alert, biz }) {
  const isAdmin = (ctx) => ctx.from?.id === config.ADMIN_ID;

  bot.command("start", async (ctx) => {
    if (ctx.chat.type === "private" && ctx.match && (await biz.handleBizStart(ctx))) return;   // Telegram "Manage bot" button
    if (ctx.from) await touchUser(ctx.from).catch(() => {});
    if (!(await ensureSubscribed(ctx, alert))) return;
    await ctx.reply(welcomeText(ctx.from?.first_name || "there"), { parse_mode: "HTML", reply_markup: startKb() });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(welcomeText(ctx.from?.first_name || "there"), { parse_mode: "HTML", reply_markup: startKb() });
  });

  bot.command("about", async (ctx) => {
    await ctx.reply(`
🤖 <b>BabuBhaiKundan AI</b>

Created with ❤️ by <b>Kundan Yadav</b>

👷‍♂️ <b>Civil Engineer by Degree</b>
👨‍💻 <b>Developer by Passion</b>

This bot uses a highly advanced Multi-API Rotation system (Gemini, Groq, Cerebras, Cloudflare & more) for blazing-fast and non-stop responses.
`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("🌍 Visit Official Website", "https://babubhaikundan.pages.dev") });
  });

  bot.command("stats", async (ctx) => {
    const today = todayKey(config.TIMEZONE);
    if (isAdmin(ctx)) {
      const s = await adminStats(today);
      return ctx.reply(`
👑 <b>ADMIN DASHBOARD</b> 👑

👥 <b>Total Users:</b> ${s.totalUsers}
🔥 <b>Active Today:</b> ${s.activeToday}
💬 <b>Messages Sent Today:</b> ${s.msgsToday}
🚫 <b>Blocked the bot:</b> ${s.blocked}
🤝 <b>Business connections:</b> ${s.bizConnections}

<i>Babu Bhai, your bot is growing! 🚀</i>`, { parse_mode: "HTML" });
    }
    const used = await getUsage(ctx.from.id, today);
    await ctx.reply(`
📊 <b>Your Daily Dashboard</b>

👤 <b>User:</b> ${escapeHtml(ctx.from.first_name)}
💬 <b>Messages Used:</b> ${used}
⏳ <b>Remaining Limit:</b> ${Math.max(0, config.DAILY_LIMIT - used)}
📈 <b>Total Daily Limit:</b> ${config.DAILY_LIMIT}

<i>Limits reset everyday at midnight (IST)! 🕛</i>`, { parse_mode: "HTML" });
  });

  const doClear = async (ctx) => { await clearSession(sessionKey(ctx)); };

  bot.command("clear", async (ctx) => {
    await doClear(ctx);
    await ctx.reply("🧹 <b>Memory Cleared!</b>\n\nAI ne picchli saari baatein bhula di hain. Let's start a fresh chat ✨", { parse_mode: "HTML" });
  });

  bot.command("export", async (ctx) => {
    const session = await getHistory(sessionKey(ctx));
    if (!session.length) return ctx.reply("⚠️ History is empty!");
    let txt = "=== BBK AI Chat History ===\n\n";
    for (const s of session) txt += `[${String(s.role).toUpperCase()}]:\n${s.content}\n\n`;
    await ctx.replyWithDocument(new InputFile(Buffer.from(txt, "utf-8"), `Chat_${ctx.chat.id}.txt`),
      { caption: "💾 <b>Your Chat History!</b>", parse_mode: "HTML" });
  });

  bot.callbackQuery("clear", async (ctx) => {
    if (ctx.chat) await clearSession(sessionKey(ctx));
    await ctx.answerCallbackQuery({ text: "Memory cleared!" });
    await ctx.reply("🧹 <b>Memory cleared!</b>", { parse_mode: "HTML" });
  });

  // v1 bug: bina join kiye dabane par naya prompt spam hota tha. Ab silent re-check.
  bot.callbackQuery("checksub", async (ctx) => {
    if (await isSubscribed(ctx.api, ctx.from.id, alert)) {
      await ctx.answerCallbackQuery({ text: "✅ Thank you for joining!", show_alert: true });
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply(AFTER_JOIN, { parse_mode: "HTML" });
    } else {
      await ctx.answerCallbackQuery({ text: "💀 Abbey yaar Join Channel then use my Bot...", show_alert: true });
    }
  });
}
