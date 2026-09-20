// Usage:  WEBHOOK_URL=https://<project>.vercel.app/api/webhook  node scripts/set-webhook.js
//         node scripts/set-webhook.js --delete        (polling/Oracle pe wapas jaane se pehle)
// Env: BOT_TOKEN, WEBHOOK_SECRET (Vercel wala wahi), ADMIN_ID (optional), DROP_PENDING=1 (optional)
import "dotenv/config";
import { ALLOWED_UPDATES, ADMIN_COMMANDS, USER_COMMANDS } from "../src/constants.js";

const { BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET, TG_API_ROOT } = process.env;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "5096393058", 10);
const base = TG_API_ROOT || "https://api.telegram.org";
if (!BOT_TOKEN) { console.error("❌ BOT_TOKEN missing"); process.exit(1); }

async function call(method, body = {}) {
  const res = await fetch(`${base}/bot${BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) { console.error(`❌ ${method}: ${j.description || res.status}`); process.exit(1); }
  return j.result;
}

if (process.argv.includes("--delete")) {
  await call("deleteWebhook", { drop_pending_updates: process.env.DROP_PENDING === "1" });
  console.log("✅ Webhook deleted (ab polling/Oracle chala sakte ho)");
  process.exit(0);
}

if (!WEBHOOK_URL || !/^https:\/\//.test(WEBHOOK_URL)) { console.error("❌ WEBHOOK_URL (https://...) missing"); process.exit(1); }
if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16 || !/^[A-Za-z0-9_-]+$/.test(WEBHOOK_SECRET)) {
  console.error("❌ WEBHOOK_SECRET: 16+ chars, sirf A-Z a-z 0-9 _ - (Telegram ka rule)"); process.exit(1);
}

await call("setWebhook", {
  url: WEBHOOK_URL,
  secret_token: WEBHOOK_SECRET,
  allowed_updates: ALLOWED_UPDATES,               // business_* updates ke bina Chat Automation kaam nahi karega
  max_connections: 20,
  drop_pending_updates: process.env.DROP_PENDING === "1",
});
await call("setMyCommands", { commands: USER_COMMANDS });
await call("setMyCommands", { commands: ADMIN_COMMANDS, scope: { type: "chat", chat_id: ADMIN_ID } });
const info = await call("getWebhookInfo");
console.log("✅ Webhook set:", info.url);
console.log("   pending:", info.pending_update_count, "| last error:", info.last_error_message || "none");
