// Bot factory — polling (Oracle/pm2) aur webhook (Vercel) dono yahi use karte hain.
import { Bot, GrammyError, HttpError } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { sequentialize } from "@grammyjs/runner";
import { config } from "./config.js";
import { ADMIN_COMMANDS, USER_COMMANDS } from "./constants.js";
import { makeAlerter, errText, escapeHtml } from "./util.js";
import { registerBusiness } from "./handlers/business.js";
import { registerBasic } from "./handlers/basic.js";
import { registerAdmin } from "./handlers/admin.js";
import { registerChat } from "./handlers/chat.js";

export function createBot({ mode = "polling" } = {}) {
  const bot = new Bot(config.BOT_TOKEN, config.TG_API_ROOT ? { client: { apiRoot: config.TG_API_ROOT } } : {});
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 20 }));   // 429 flood-wait auto handle
  const alert = makeAlerter(bot.api, config.ADMIN_ID);

  // Ek chat ke updates sequential (ek hi instance ke andar), alag chats parallel
  bot.use(sequentialize((ctx) => String(ctx.chat?.id ?? ctx.from?.id ?? "x")));

  // Koi handler error process/invocation crash nahi karega
  bot.catch((err) => {
    const e = err.error;
    const kind = e instanceof GrammyError ? "Telegram API" : e instanceof HttpError ? "Network" : "Handler";
    console.error(`[${kind}] update ${err.ctx?.update?.update_id}:`, errText(e));
    alert(`err:${kind}:${errText(e).slice(0, 60)}`, `🚨 <b>${kind} error</b>\n<code>${escapeHtml(errText(e)).slice(0, 600)}</code>`);
  });

  const biz = registerBusiness(bot, { alert });
  registerBasic(bot, { alert, biz });
  registerAdmin(bot, { mode });
  registerChat(bot, { alert, biz });
  return { bot, alert };
}

export async function setCommands(api) {
  await api.setMyCommands(USER_COMMANDS);
  await api.setMyCommands(ADMIN_COMMANDS, { scope: { type: "chat", chat_id: config.ADMIN_ID } });
}
