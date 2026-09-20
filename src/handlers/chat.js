import { config } from "../config.js";
import { askAI } from "../ai.js";
import { renderChunks } from "../format.js";
import { escapeHtml, escapeRegex, sendSafe, sessionKey, todayKey, errText } from "../util.js";
import { ensureSubscribed } from "../forcesub.js";
import { touchUser, isBanned, consumeLimit, refundLimit, pushMessage, popLast } from "../db.js";

async function deliver(ctx, pending, chunks) {
  const chatId = ctx.chat.id;
  const opts = { link_preview_options: { is_disabled: true } };
  let usePending = !!pending;
  for (const html of chunks) {
    if (usePending) {
      usePending = false;
      try { await sendSafe((t, o) => ctx.api.editMessageText(chatId, pending.message_id, t, o), html, opts); continue; }
      catch { ctx.api.deleteMessage(chatId, pending.message_id).catch(() => {}); }   // edit fail -> naya message
    }
    await sendSafe((t, o) => ctx.api.sendMessage(chatId, t, o), html, opts);
  }
}

export function registerChat(bot, { alert, biz }) {
  bot.on("message:text", async (ctx) => {
    let text = ctx.msg.text;
    if (text.startsWith("/")) return;

    // linked-channel posts / channel identity: ignore. Anonymous admin = sender_chat is the group itself.
    const sc = ctx.msg.sender_chat;
    if (sc && sc.id !== ctx.chat.id) return;
    const anon = !!sc && sc.id === ctx.chat.id;

    if (ctx.chat.type === "private" && (await biz.handleOwnerInput(ctx))) return;   // owner setting reply text etc.

    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      const lower = text.toLowerCase();
      const uname = (ctx.me.username || "").toLowerCase();
      const mentioned = !!uname && lower.includes(`@${uname}`);
      const replyToBot = ctx.msg.reply_to_message?.from?.id === ctx.me.id;     // v1: username compare
      const trigger = config.GROUP_TRIGGERS.some((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, "i").test(lower));
      if (!mentioned && !replyToBot && !trigger) return;
      if (mentioned) text = text.replace(new RegExp(`@${escapeRegex(uname)}`, "gi"), "").trim();
      if (!text) return;
    }

    const userId = ctx.from.id;
    if (!anon) {
      if (ctx.chat.type === "private") await touchUser(ctx.from).catch(() => {});   // limit se pehle, sequential
      if (await isBanned(userId)) return;
      if (!(await ensureSubscribed(ctx, alert))) return;
    }

    if (text.length > config.MAX_INPUT_CHARS) {
      return ctx.reply(`⚠️ Message bahut lamba hai (max ${config.MAX_INPUT_CHARS} characters). Chhota karke bhejo.`);
    }

    const today = todayKey(config.TIMEZONE);
    const trackerId = anon ? ctx.chat.id : userId;
    const exempt = userId === config.ADMIN_ID && !anon;                     // admin unlimited
    if (!exempt) {
      const r = await consumeLimit(trackerId, config.DAILY_LIMIT, today);
      if (!r.ok) return ctx.reply("⚠️ <b>Daily Limit Reached!</b>\n\nYou have used your daily limit.\nCome back tomorrow!", { parse_mode: "HTML" });
    }

    const key = sessionKey(ctx);
    let pending = null;
    let typing = null;
    try {
      pending = await ctx.reply("⏳ <i>BabuBhaiKundan AI is thinking...</i> 🧠",
        { parse_mode: "HTML", reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true } });
      typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), 4500);

      const history = await pushMessage(key, "user", text);
      const ai = await askAI({ messages: history });
      await pushMessage(key, "assistant", ai.text);
      await deliver(ctx, pending, renderChunks(ai.text));
    } catch (e) {
      // history me orphan user-message na rahe + limit wapas
      await popLast(key).catch(() => {});
      if (!exempt) await refundLimit(trackerId, today).catch(() => {});
      alert("ai-fail", `🚨 <b>AI reply fail</b>\n<code>${escapeHtml(errText(e)).slice(0, 500)}</code>`);
      const msg = "⚠️ <b>AI abhi busy hai.</b>\nThodi der baad try karo 🙏\n<i>(Ye message tumhari limit me count nahi hua)</i>";
      if (pending) await ctx.api.editMessageText(ctx.chat.id, pending.message_id, msg, { parse_mode: "HTML" }).catch(() => ctx.reply(msg, { parse_mode: "HTML" }).catch(() => {}));
      else await ctx.reply(msg, { parse_mode: "HTML" }).catch(() => {});
    } finally {
      if (typing) clearInterval(typing);
    }
  });
}
