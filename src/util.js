export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IST (ya config timezone) ki date "YYYY-MM-DD" — server UTC ho tab bhi sahi reset
export function todayKey(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export const errText = (e) => e?.description || e?.message || String(e);
export const isParseError = (e) => /can't parse entities|can't find end|unsupported start tag|entity/i.test(errText(e));
export const isBlockedError = (e) =>
  e?.error_code === 403 || /bot was blocked|user is deactivated|chat not found|kicked/i.test(errText(e));

export function htmlToPlain(html) {
  return String(html)
    .replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, (_, u, t) => `${t} (${u.replace(/&amp;/g, "&")})`)
    .replace(/<\/?(?:b|i|u|s|code|pre|blockquote)[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// Admin ko alert (10 min me ek hi baar per key) — silent failures ab pakde jaayenge
const lastAlert = new Map();
export function makeAlerter(api, adminId) {
  return async (key, text) => {
    const now = Date.now();
    if (now - (lastAlert.get(key) || 0) < 10 * 60 * 1000) return;
    lastAlert.set(key, now);
    try { await api.sendMessage(adminId, String(text).slice(0, 3500), { parse_mode: "HTML" }); } catch { /* ignore */ }
  };
}

// HTML try -> parse error par plain text fallback
export async function sendSafe(sendFn, html, opts = {}) {
  try {
    return await sendFn(html, { ...opts, parse_mode: "HTML" });
  } catch (e) {
    if (!isParseError(e)) throw e;
    const { parse_mode, ...rest } = opts;
    return await sendFn(htmlToPlain(html), rest);
  }
}

// private: chatId | group: chatId:userId  (v1 me group me sab ki history mix hoti thi + /export leak)
export const sessionKey = (ctx) =>
  ctx.chat.type === "private" ? String(ctx.chat.id) : `${ctx.chat.id}:${ctx.from?.id ?? "anon"}`;

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
