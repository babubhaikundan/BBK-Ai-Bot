// Pure data (config/env import nahi) — bot, webhook aur set-webhook script teeno use karte hain
export const ALLOWED_UPDATES = [
  "message", "edited_message", "callback_query",
  "business_connection", "business_message", "edited_business_message", "deleted_business_messages",
];

export const USER_COMMANDS = [
  { command: "start", description: "🚀 Start the bot" },
  { command: "help", description: "📖 All commands" },
  { command: "stats", description: "📊 Daily usage & limit" },
  { command: "clear", description: "🧹 Clear chat memory" },
  { command: "export", description: "💾 Download chat history" },
  { command: "about", description: "🤖 About the bot" },
];

export const ADMIN_COMMANDS = [
  ...USER_COMMANDS,
  { command: "business", description: "🤝 Business automation panel" },
  { command: "bizwelcome", description: "👋 Set welcome msg (first message only)" },
  { command: "bizreply", description: "💬 Set default fixed reply" },
  { command: "bizprompt", description: "🧠 Extra instructions for AI replies" },
  { command: "bizcool", description: "⏳ Fixed-reply cooldown (minutes)" },
  { command: "bizpause", description: "🔕 AI pause after you reply (minutes)" },
  { command: "cancel", description: "❌ Cancel custom-reply input" },
  { command: "broadcast", description: "📢 Send message to all users" },
  { command: "bresume", description: "🔁 Resume paused broadcast" },
  { command: "models", description: "🩺 AI model health check" },
  { command: "ban", description: "🚫 Ban user by id" },
  { command: "unban", description: "✅ Unban user by id" },
];
