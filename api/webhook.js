// Vercel Serverless Function — Telegram webhook.  URL:  https://<project>.vercel.app/api/webhook
// Flow: secret check -> dedupe (update_id) -> bot.handleUpdate (poora handle hone tak await) -> 200
import { timingSafeEqual } from "node:crypto";
import { config, missingConfig } from "../src/config.js";
import { connectDB, claimUpdate } from "../src/db.js";
import { createBot } from "../src/bot.js";
import { errText } from "../src/util.js";

let ready = null;                                   // warm instance me ek baar init
function init() {
  if (!ready) {
    ready = (async () => {
      await connectDB({ maxPoolSize: 5 });
      const { bot } = createBot({ mode: "webhook" });
      await bot.init();
      return bot;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: true, mode: "webhook" });   // health
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const missing = missingConfig();
  if (!config.WEBHOOK_SECRET) missing.push("WEBHOOK_SECRET");
  if (missing.length) {
    console.error("Missing env:", missing.join(", "));
    return res.status(500).json({ error: "server misconfigured" });
  }

  // Sirf Telegram (secret_token jo setWebhook me diya) — v1 me koi bhi fake update bhej ke admin ban sakta tha
  if (!safeEqual(req.headers["x-telegram-bot-api-secret-token"] || "", config.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  let update = req.body;
  if (typeof update === "string") { try { update = JSON.parse(update); } catch { update = null; } }
  if (!update || typeof update.update_id !== "number") return res.status(400).json({ error: "bad update" });

  let bot;
  try { bot = await init(); }
  catch (e) { console.error("init failed:", errText(e)); return res.status(500).json({ error: "init failed" }); }   // 500 => Telegram baad me retry karega

  if (!(await claimUpdate(update.update_id).catch(() => true))) return res.status(200).json({ ok: true, duplicate: true });

  try { await bot.handleUpdate(update); }
  catch (e) { console.error("handleUpdate:", errText(e)); }
  return res.status(200).json({ ok: true });         // hamesha 200: poison update pe Telegram retry-storm nahi
}
