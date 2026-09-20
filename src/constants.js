// Pure data (config/env import nahi) — bot, webhook aur set-webhook script teeno use karte hain
export const ALLOWED_UPDATES = [
  "message", "edited_message", "callback_query",
  "business_connection", "business_message", "edited_business_message", "deleted_business_messages",
];

export const USER_COMMANDS = [
  { command: "start", description: "Start the bot" },
  { command: "stats", description: "Daily usage & limit" },
  { command: "clear", description: "Clear chat memory" },
  { command: "export", description: "Download chat history" },
  { command: "about", description: "About the bot" },
  { command: "help", description: "Help" },
];

export const ADMIN_COMMANDS = [
  ...USER_COMMANDS,
  { command: "business", description: "Business automation panel" },
  { command: "broadcast", description: "Admin: broadcast" },
  { command: "bresume", description: "Admin: resume paused broadcast" },
  { command: "models", description: "Admin: AI model health" },
  { command: "ban", description: "Admin: ban user id" },
  { command: "unban", description: "Admin: unban user id" },
];
