import { InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { escapeHtml, errText } from "./util.js";

const VERIFY_MS = 5 * 60 * 60 * 1000;
const verified = new Map();       // userId -> ts   (persistent host: ab cold-start reset nahi hota)
const groupNotice = new Map();    // userId -> ts

export const joinKeyboard = () =>
  new InlineKeyboard().url("📢 Join Update Channel", `https://t.me/${config.FORCE_SUB_CHANNEL}`).row().text("✅ I've Joined", "checksub");

// v1 bug: har error ko "NOT_JOINED" maan liya jaata tha (bot admin na ho to sab lock).
// Ab: sirf left/kicked = not joined. Baaki errors -> fail-open + admin alert.
export async function isSubscribed(api, userId, alert) {
  if (!config.FORCE_SUB_CHANNEL) return true;
  const t = verified.get(userId);
  if (t && Date.now() - t < VERIFY_MS) return true;
  try {
    const m = await api.getChatMember(`@${config.FORCE_SUB_CHANNEL}`, userId);
    if (m.status === "left" || m.status === "kicked") return false;
    if (m.status === "restricted" && m.is_member === false) return false;
    verified.set(userId, Date.now());
    if (verified.size > 20000) verified.delete(verified.keys().next().value);
    return true;
  } catch (e) {
    alert?.("forcesub", `⚠️ <b>Force-sub check fail</b>\n<code>${escapeHtml(errText(e))}</code>\nBot channel <code>@${config.FORCE_SUB_CHANNEL}</code> me admin hai? Tab tak users ko allow kiya ja raha hai.`);
    return true;
  }
}

export async function ensureSubscribed(ctx, alert) {
  if (!config.FORCE_SUB_CHANNEL) return true;
  const userId = ctx.from.id;
  if (await isSubscribed(ctx.api, userId, alert)) return true;

  if (ctx.chat.type !== "private") {
    const last = groupNotice.get(userId) || 0;
    if (Date.now() - last > 60 * 60 * 1000) {
      groupNotice.set(userId, Date.now());
      await ctx.reply(`⚠️ To use this bot, join our channel first:\n\n👉 https://t.me/${config.FORCE_SUB_CHANNEL}`,
        { reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true } }).catch(() => {});
    }
    return false;
  }

  const caption = `<b>Hi <a href="tg://user?id=${userId}">${escapeHtml(ctx.from.first_name)}</a> 👋\n\nTo use this bot, please join our official channel first.\n\nAfter joining, click button below.</b>`;
  try {
    await ctx.api.sendPhoto(ctx.chat.id, config.FORCE_SUB_PHOTO, { caption, parse_mode: "HTML", reply_markup: joinKeyboard() });
  } catch {
    await ctx.reply(caption, { parse_mode: "HTML", reply_markup: joinKeyboard() }).catch(() => {});
  }
  return false;
}
