import "dotenv/config";

const env = process.env;
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const list = (v, d = []) => (v == null || v === "" ? d : String(v).split(",").map(s => s.trim()).filter(Boolean));

const ADMIN_ID = int(env.ADMIN_ID, 5096393058);

export const config = {
  BOT_TOKEN: env.BOT_TOKEN,
  MONGO_URI: env.MONGO_DB || env.MONGO_URI,           // purana MONGO_DB name bhi chalega
  AI_API_URL: env.AI_API_URL,
  AI_SHARED_SECRET: env.AI_SHARED_SECRET || "",
  TG_API_ROOT: env.TG_API_ROOT || "",                 // sirf tests ke liye
  WEBHOOK_SECRET: env.WEBHOOK_SECRET || "",           // Vercel/webhook mode: Telegram secret_token

  ADMIN_ID,
  DAILY_LIMIT: int(env.DAILY_LIMIT, 30),
  TIMEZONE: env.TIMEZONE || "Asia/Kolkata",           // daily reset IST midnight
  FORCE_SUB_CHANNEL: (env.FORCE_SUB_CHANNEL ?? "BabuBhaiKundan").replace(/^@/, ""),
  FORCE_SUB_PHOTO: env.FORCE_SUB_PHOTO || "https://babubhaikundan.pages.dev/Assets/logo/bbk.png",
  MAX_INPUT_CHARS: int(env.MAX_INPUT_CHARS, 12000),
  GROUP_TRIGGERS: list(env.GROUP_TRIGGERS, ["ai", "bbk", "bot", "help", "solve", "explain"]).map(s => s.toLowerCase()),

  // ---- Business / Chat Automation ----
  BUSINESS_OWNERS: list(env.BUSINESS_OWNERS, [String(ADMIN_ID)]),   // sirf ye users automation use kar sakte hain
  OWNER_NAME: env.OWNER_NAME || "Kundan",
  // Privacy: customers ki chats free-tier providers ko jaati hain. Default me sirf ye providers.
  // Sab providers chahiye to: BIZ_PROVIDERS=all
  BIZ_PROVIDERS: env.BIZ_PROVIDERS === "all" ? [] : list(env.BIZ_PROVIDERS, ["groq", "cerebras", "cloudflare"]),
  BIZ_MAX_REPLIES_PER_HOUR: int(env.BIZ_MAX_REPLIES_PER_HOUR, 20),
};

export function missingConfig() {
  const missing = [];
  if (!config.BOT_TOKEN) missing.push("BOT_TOKEN");
  if (!config.MONGO_URI) missing.push("MONGO_DB (ya MONGO_URI)");
  if (!config.AI_API_URL) missing.push("AI_API_URL");
  return missing;
}

export function validateConfig() {
  const missing = missingConfig();
  if (missing.length) {
    console.error(`❌ .env me ye missing hain: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!config.AI_SHARED_SECRET) console.warn("⚠️  AI_SHARED_SECRET set nahi hai — proxy secret maangega to AI calls 401 denge.");
}
