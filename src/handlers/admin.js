import { config } from "../config.js";
import { aiHealth } from "../ai.js";
import { broadcastTargets, countTargets, startBroadcast, getBroadcast, saveBroadcast, setBan, markBlocked } from "../db.js";
import { escapeHtml, isBlockedError, isParseError, sleep, errText } from "../util.js";

export function registerAdmin(bot, { mode = "polling" } = {}) {
  const budgetMs = mode === "webhook" ? 240_000 : Infinity;      // serverless: 300s limit se pehle pause, /bresume se aage
  const admin = (ctx) => ctx.from?.id === config.ADMIN_ID;
  const deny = (ctx) => ctx.reply("❌ <b>Access Denied</b>", { parse_mode: "HTML" });

  bot.command("broadcast", async (ctx) => {
    if (!admin(ctx)) return deny(ctx);
    const body = ctx.match?.trim();
    if (!body) return ctx.reply("Usage: <code>/broadcast your message</code> (HTML allowed)", { parse_mode: "HTML" });
    const final = `📢 <b>Broadcast Message</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${body}\n\n<i>~By Admin</i>`;

    // pehle admin ko preview: bad HTML ho to sab users pe fail hone se pehle pata chale
    try { await ctx.api.sendMessage(ctx.chat.id, final, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }); }
    catch (e) { return ctx.reply(isParseError(e) ? "❌ Message ka HTML invalid hai. Tags check karo, broadcast cancel." : `❌ ${escapeHtml(errText(e))}`, { parse_mode: "HTML" }); }

    const total = await countTargets();
    if (!total) return ctx.reply("⚠️ Database me abhi koi user nahi hai.");
    await startBroadcast(final, ctx.chat.id, total);
    await ctx.reply(`🚀 <b>Broadcast Started!</b>\nSending message to ${total} users...`, { parse_mode: "HTML" });
    const p = runBroadcast(ctx.api).catch((e) => ctx.api.sendMessage(ctx.chat.id, `❌ Broadcast error: ${escapeHtml(errText(e))}`, { parse_mode: "HTML" }).catch(() => {}));
    if (mode === "webhook") await p;                 // serverless: invocation zinda rakhna padta hai; polling: background
  });

  bot.command("bresume", async (ctx) => {
    if (!admin(ctx)) return deny(ctx);
    const job = await getBroadcast();
    if (!job || job.done) return ctx.reply("ℹ️ Koi paused broadcast nahi hai.");
    await ctx.reply(`▶️ Resuming... (${job.ok + job.fail}/${job.total} ho chuke)`);
    const p = runBroadcast(ctx.api).catch(() => {});
    if (mode === "webhook") await p;
  });

  async function runBroadcast(api) {
    const job = await getBroadcast();
    if (!job || job.done) return;
    const opts = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    const t0 = Date.now();
    let { cursor, ok, fail, blocked } = job;
    for (;;) {
      const batch = await broadcastTargets(cursor, 100);
      if (!batch.length) break;
      for (const uid of batch) {
        if (Date.now() - t0 > budgetMs) {
          await saveBroadcast({ cursor, ok, fail, blocked });
          await api.sendMessage(Number(job.adminChat), `⏸ <b>Broadcast paused</b> (time limit)\n🟢 ${ok}  🔴 ${fail}  /  ${job.total}\n/bresume se aage badhao.`, { parse_mode: "HTML" }).catch(() => {});
          return;
        }
        try { await api.sendMessage(uid, job.text, opts); ok++; }
        catch (e) { fail++; if (isBlockedError(e)) { blocked++; await markBlocked(uid).catch(() => {}); } }
        cursor = uid;
        await sleep(50);
      }
      await saveBroadcast({ cursor, ok, fail, blocked });
    }
    await saveBroadcast({ cursor, ok, fail, blocked, done: true });
    await api.sendMessage(Number(job.adminChat), `✅ <b>Broadcast Complete!</b>\n\n🟢 Sent: ${ok}\n🔴 Failed: ${fail}\n🚫 Marked blocked: ${blocked}`, { parse_mode: "HTML" }).catch(() => {});
  }

  const banCmd = (name, value) => bot.command(name, async (ctx) => {
    if (!admin(ctx)) return deny(ctx);
    const id = (ctx.match || "").trim();
    if (!/^\d+$/.test(id)) return ctx.reply(`Usage: <code>/${name} user_id</code>`, { parse_mode: "HTML" });
    await setBan(id, value);
    await ctx.reply(`${value ? "🚫 Banned" : "✅ Unbanned"}: <code>${id}</code>`, { parse_mode: "HTML" });
  });
  banCmd("ban", true); banCmd("unban", false);

  bot.command("models", async (ctx) => {
    if (!admin(ctx)) return deny(ctx);
    const wait = await ctx.reply("🩺 Models ping ho rahe hain...");
    try {
      const h = await aiHealth();
      const lines = h.results.map((r) => r.ok ? `✅ <code>${escapeHtml(r.p)}/${escapeHtml(r.m)}</code> ${r.ms}ms` : `❌ <code>${escapeHtml(r.p)}/${escapeHtml(r.m)}</code> ${escapeHtml(r.kind)}`);
      const nc = h.notConfigured?.length ? `\n\n🔑 Key/binding missing: ${h.notConfigured.map(escapeHtml).join(", ")}` : "";
      await ctx.api.editMessageText(ctx.chat.id, wait.message_id, `🩺 <b>AI model health</b>\n\n${lines.join("\n")}${nc}`, { parse_mode: "HTML" });
    } catch (e) {
      await ctx.api.editMessageText(ctx.chat.id, wait.message_id, `❌ Health check fail: ${escapeHtml(errText(e))}`, { parse_mode: "HTML" }).catch(() => {});
    }
  });
}
