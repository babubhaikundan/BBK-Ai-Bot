// Telegram Business / Chat Automation ("Secretary mode")
//
// Flow:  customer msg -> business_message -> (rules) -> reply owner ke account se (business_connection_id)
// Control: bot ke private chat me /business panel  +  managed chat ka "Manage bot" button (/start bizChat<id>)
//
// Rules jo duplicate/loop rokte hain:
//  1. Owner ka apna message / bot ka apna echo (sender_business_bot ya sent-id) -> kabhi reply nahi
//  2. Har (chat, message_id) sirf ek baar process (DB unique claim)
//  3. Welcome sirf pehle customer message par (atomic flag)
//  4. Fixed reply: cooldown (default 6h) per chat
//  5. Owner ne haal hi me khud reply kiya -> AI pause (default 30 min)
//  6. Har chat pe max replies/hour cap (loop / abuse guard)
//  7. Edited / deleted messages par reply nahi
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { askAI } from "../ai.js";
import { renderChunks } from "../format.js";
import { escapeHtml, sendSafe, errText } from "../util.js";
import { parseKeywords, matchesTrigger } from "../triggers.js";
import {
  upsertConnection, getConnection, getConnectionByOwner, updateConnection, claimMessage,
  touchBizChat, markOwnerActive, claimWelcome, claimAutoReply, claimTrigger, setAutoReplied,
  getBizChat, updateBizChat, listBizChats, pushMessage, popLast,
  markSent, wasSent, setAwaiting, takeAwaiting, dropAwaiting, bumpWindow,
} from "../db.js";

const MODE_LABEL = { ai: "🤖 AI", fixed: "📝 Fixed", off: "⛔ Off", "": "↩️ Default" };
const NEXT_CHAT_MODE = { "": "ai", ai: "fixed", fixed: "off", off: "" };

export function registerBusiness(bot, { alert }) {
  const owners = new Set(config.BUSINESS_OWNERS.map(String));
  const isOwner = (id) => owners.has(String(id));

  // NOTE: echo-guard, hourly cap aur owner-input state DB me hain (serverless instances ke beech share hote hain)

  // ---- sending (always via business connection => message owner ke naam se jaata hai) ----
  const sendPlain = async (api, connId, chatId, text) => {
    const m = await api.sendMessage(chatId, text, { business_connection_id: connId, link_preview_options: { is_disabled: true } });
    await markSent(connId, chatId, m.message_id);
  };
  const sendHtml = async (api, connId, chatId, html) => {
    const m = await sendSafe((t, o) => api.sendMessage(chatId, t, o), html,
      { business_connection_id: connId, link_preview_options: { is_disabled: true } });
    await markSent(connId, chatId, m.message_id);
  };

  const bizSystem = (conn, chat = {}) =>
    `You are the AI assistant of ${config.OWNER_NAME} (Kundan Yadav), replying inside his personal Telegram chats while he is unavailable. ` +
    `Say you are his AI assistant if asked (never claim to be human). Be brief, polite and helpful; reply in the customer's language (Hinglish if they write Hindi/Hinglish). ` +
    `If something needs ${config.OWNER_NAME} personally (money, meetings, private info, decisions, commitments) say you will pass the message on and he will reply soon. ` +
    `Do not invent facts about ${config.OWNER_NAME}. Keep replies short (1-4 sentences) unless asked for detail. No markdown tables or headings.` +
    (conn.prompt ? `\n\nOwner instructions:\n${conn.prompt}` : "") +
    (chat.prompt ? `\n\nInstructions for THIS specific customer chat (they override the general rules above where they conflict):\n${chat.prompt}` : "") +
    (chat.triggerReply && chat.triggers?.length
      ? `\n\nIMPORTANT for this customer: never connect them with ${config.OWNER_NAME}. If they ask — in any wording or language, even without exact keywords — to talk to, call, message, reach or get a reply from him, do NOT offer to pass a message and do NOT say he will reply. Refuse politely in ONE short line` + (chat.triggerRefusal ? `, using exactly this line: "${chat.triggerRefusal}"` : "") + "."
      : "");

  // =====================================================================
  //  business_connection
  // =====================================================================
  bot.on("business_connection", async (ctx) => {
    const c = ctx.businessConnection;
    const ownerId = String(c.user.id);
    if (!isOwner(ownerId)) {
      await ctx.api.sendMessage(c.user_chat_id, "🔒 Business automation abhi private hai. Ye bot sirf owner ke liye enabled hai.").catch(() => {});
      return;
    }
    const canReply = c.rights?.can_reply ?? c.can_reply ?? false;      // can_reply Bot API 9.0 me deprecated -> rights
    await upsertConnection(c.id, { ownerId, userChatId: String(c.user_chat_id), enabled: !!c.is_enabled, canReply: !!canReply });
    const msg = !c.is_enabled ? "❌ <b>Business bot disconnect ho gaya.</b>"
      : !canReply ? "⚠️ <b>Connected</b>, par <b>\"Reply to messages\"</b> permission off hai — Telegram → Settings → Business → Chatbots me on karo."
      : "✅ <b>Business automation connected!</b>\n\n/business se control karo. Default me automation <b>OFF</b> hai aur sirf <b>selected chats</b> me chalegi.";
    await ctx.api.sendMessage(c.user_chat_id, msg, { parse_mode: "HTML" }).catch(() => {});
  });

  // =====================================================================
  //  business_message  (customer + owner dono ke messages yahin aate hain)
  // =====================================================================
  bot.on("business_message", async (ctx) => {
    try { await onBusinessMessage(ctx); }
    catch (e) { alert("biz-err", `🚨 <b>Business handler error</b>\n<code>${escapeHtml(errText(e)).slice(0, 500)}</code>`); }
  });

  // edited / deleted: kabhi reply nahi (duplicate auto-reply se bachne ke liye)
  bot.on("edited_business_message", () => {});
  bot.on("deleted_business_messages", () => {});

  async function loadConnection(ctx, connId) {
    let conn = await getConnection(connId);
    if (conn) return conn;
    try {                                            // connection update miss hua ho to Telegram se pooch lo
      const c = await ctx.getBusinessConnection();
      if (!isOwner(c.user.id)) return null;
      conn = await upsertConnection(c.id, {
        ownerId: String(c.user.id), userChatId: String(c.user_chat_id), enabled: !!c.is_enabled,
        canReply: !!(c.rights?.can_reply ?? c.can_reply),
      });
    } catch { conn = null; }
    return conn;
  }

  async function onBusinessMessage(ctx) {
    const m = ctx.businessMessage ?? ctx.msg;
    const connId = m.business_connection_id;
    const chatId = String(m.chat.id);
    const conn = await loadConnection(ctx, connId);
    if (!conn || !conn.enabled || !isOwner(conn.ownerId)) return;

    // ---- owner ka message? ----
    if (String(m.from?.id) === conn.ownerId) {
      if (m.sender_business_bot || (await wasSent(connId, chatId, m.message_id))) return;   // hamara apna echo
      await markOwnerActive(connId, chatId);                                       // owner khud baat kar raha hai
      return;
    }
    if (!m.from || m.from.is_bot) return;

    const name = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(" ") || m.chat.title || "";
    if (!m.text) { await touchBizChat(connId, chatId, { name, username: m.chat.username }); return; }   // abhi sirf text
    if (!(await claimMessage(`${connId}:${chatId}:${m.message_id}`))) return;                          // duplicate delivery

    const chat = await touchBizChat(connId, chatId, { name, username: m.chat.username });
    const isFirst = await claimWelcome(connId, chatId);                     // atomic: sirf pehle message par true

    if (!conn.canReply || !conn.automation) return;
    if (!(chat.allowed ?? conn.allowAll)) return;                           // selected chats only
    const mode = chat.mode || conn.mode;
    if (mode === "off") return;
    if (chat.lastOwnerAt && Date.now() - new Date(chat.lastOwnerAt).getTime() < conn.pauseMin * 60_000) return;
    if (!(await bumpWindow(`biz:${connId}:${chatId}`, config.BIZ_MAX_REPLIES_PER_HOUR, 3600_000))) {          // hourly cap (DB)
      // pehle chup-chaap skip hota tha. Ab owner ko har chat ke liye ghante me ek baar alert.
      const hourBucket = Math.floor(Date.now() / 3600_000);
      if (await claimMessage(`capalert:${connId}:${chatId}:${hourBucket}`)) {
        alert(`biz-cap:${chatId}:${hourBucket}`, `⚠️ <b>Business hourly limit</b>\nChat <code>${chatId}</code> (${escapeHtml(chat.name || "?")}) ne ${config.BIZ_MAX_REPLIES_PER_HOUR} messages/ghanta cross kar diye, AI jawab rok raha hai (agle ghante me apne aap chalu). Badhane ke liye Vercel env <code>BIZ_MAX_REPLIES_PER_HOUR</code> badlo.`);
      }
      return;
    }

    const api = ctx.api;
    const welcomed = isFirst && !!conn.welcomeText;
    if (welcomed) await sendPlain(api, connId, m.chat.id, conn.welcomeText);      // welcome fixed-reply cooldown consume nahi karta

    // ---- Trigger reply (per chat): keyword -> owner ka exact message (AI nahi), cooldown ke saath ----
    if (chat.triggerReply && chat.triggers?.length && matchesTrigger(m.text, chat.triggers)) {
      if (await claimTrigger(connId, chatId, conn.cooldownMin * 60_000)) {
        try { await sendPlain(api, connId, m.chat.id, chat.triggerReply); }                 // hu-ba-hu
        catch (e) { await updateBizChat(connId, chatId, { lastTriggerAt: null }); throw e; }   // send fail => cooldown wapas
        const hk = `biz:${connId}:${chatId}`;
        await pushMessage(hk, "user", m.text, 30).catch(() => {});
        await pushMessage(hk, "assistant", chat.triggerReply, 30).catch(() => {});       // AI ko pata rahe ki kya bheja gaya
        return;
      }
      // cooldown chal raha hai: neeche AI jawab dega (refusal rule ke saath)
    }

    if (mode === "fixed") {
      if (welcomed) return;                                                 // welcome hi pehla reply hai
      const text = chat.fixedText || conn.fixedText;
      if (!text) return;
      if (!(await claimAutoReply(connId, chatId, conn.cooldownMin * 60_000))) return;
      await sendPlain(api, connId, m.chat.id, text);
      return;
    }

    // ---- AI mode ----
    api.sendChatAction(m.chat.id, "typing", { business_connection_id: connId }).catch(() => {});
    const key = `biz:${connId}:${chatId}`;
    try {
      const history = await pushMessage(key, "user", m.text, 30);
      const ai = await askAI({ messages: history, system: bizSystem(conn, chat), providers: config.BIZ_PROVIDERS });
      await pushMessage(key, "assistant", ai.text, 30);
      for (const html of renderChunks(ai.text)) await sendHtml(api, connId, m.chat.id, html);
      await setAutoReplied(connId, chatId);
    } catch (e) {
      await popLast(key).catch(() => {});                                   // customer ko kabhi error nahi dikhta
      alert("biz-ai", `🚨 <b>Business AI reply fail</b> (chat <code>${chatId}</code>)\n<code>${escapeHtml(errText(e)).slice(0, 400)}</code>`);
    }
  }

  // =====================================================================
  //  Owner controls (private chat)
  // =====================================================================

  const onOff = (v) => (v ? "ON ✅" : "OFF ⛔");
  const preview = (t) => (t ? `<i>${escapeHtml(t.length > 80 ? t.slice(0, 80) + "…" : t)}</i>` : "—");

  const SETUP = `\n\n<b>Setup:</b>\n1) BotFather → /mybots → bot → <b>Bot Settings → Business Mode</b> ON\n2) Telegram (Premium) → <b>Settings → Telegram Business → Chatbots</b> → is bot ko add karo\n3) Permission: <b>Reply to messages</b> ✅ (chats select karo)`;

  function panel(c) {
    const text =
`🤖 <b>Business Automation</b>

Connection: ${c.enabled ? "✅ connected" : "❌ disconnected"}${c.canReply ? "" : " (⚠️ reply permission off)"}
Automation: <b>${onOff(c.automation)}</b>
Default mode: <b>${MODE_LABEL[c.mode]}</b>
Scope: <b>${c.allowAll ? "All chats" : "Selected chats only"}</b>
Welcome (1st msg): ${preview(c.welcomeText)}
Fixed reply: ${preview(c.fixedText)}
AI instructions: ${preview(c.prompt)}
Fixed-reply cooldown: <b>${c.cooldownMin} min</b> · Owner-active pause: <b>${c.pauseMin} min</b>

<b>Commands</b>
/bizwelcome <code>text | off</code>
/bizreply <code>text | off</code> (default fixed reply)
/bizprompt <code>text | reset</code> (AI ko extra instructions)
/bizcool <code>minutes</code> · /bizpause <code>minutes</code>

<i>Kisi chat ko control karne ke liye: us chat ke top me <b>"Manage bot"</b> button dabao, ya 💬 Chats.</i>`;
    const kb = new InlineKeyboard()
      .text(`⚡ Automation: ${onOff(c.automation)}`, "biz:auto").row()
      .text(`🔀 Default mode: ${MODE_LABEL[c.mode]}`, "biz:mode").row()
      .text(`👥 Scope: ${c.allowAll ? "All chats" : "Selected only"}`, "biz:scope").row()
      .text("💬 Chats", "biz:chats:0").text("🔄 Refresh", "biz:panel");
    return { text, kb };
  }

  function chatPanel(c, ch) {
    const on = (ch.allowed ?? c.allowAll) && (ch.mode || c.mode) !== "off";
    const text =
`💬 <b>${escapeHtml(ch.name || "Chat")}</b>${ch.username ? ` (@${escapeHtml(ch.username)})` : ""}
ID: <code>${ch.chatId}</code>

Automation here: <b>${on ? "ON ✅" : "OFF ⛔"}</b> ${ch.allowed == null ? "(default)" : "(explicit)"}
Mode: <b>${MODE_LABEL[ch.mode || ""]}</b>${ch.mode ? "" : ` → ${MODE_LABEL[c.mode]}`}
Custom reply: ${preview(ch.fixedText)}
AI instructions: ${preview(ch.prompt)}
Trigger words: ${ch.triggers?.length ? escapeHtml(ch.triggers.join(", ")) : "—"}
Trigger reply: ${preview(ch.triggerReply)}
AI refusal line: ${preview(ch.triggerRefusal)}
Messages seen: ${ch.msgCount || 0}${ch.lastOwnerAt ? `\nLast owner reply: ${new Date(ch.lastOwnerAt).toLocaleString("en-IN", { timeZone: config.TIMEZONE })}` : ""}`;
    const kb = new InlineKeyboard()
      .text(`${on ? "⛔ Disable" : "✅ Enable"} here`, `biz:ct:${ch.chatId}`).row()
      .text(`🔀 Mode: ${MODE_LABEL[ch.mode || ""]}`, `biz:cm:${ch.chatId}`).row()
      .text("✏️ Set custom reply", `biz:cr:${ch.chatId}`).text("🗑 Clear reply", `biz:cx:${ch.chatId}`).row()
      .text("🧠 AI instructions", `biz:cp:${ch.chatId}`).text("🗑 Clear AI instr.", `biz:cq:${ch.chatId}`).row()
      .text("🎯 Trigger reply", `biz:ck:${ch.chatId}`).text("🗑 Clear trigger", `biz:cn:${ch.chatId}`).row()
      .text("⬅️ Back", "biz:chats:0");
    return { text, kb };
  }

  const ownerConn = (ctx) => (isOwner(ctx.from?.id) ? getConnectionByOwner(ctx.from.id) : null);
  const noConn = (ctx) => ctx.reply("ℹ️ Abhi koi business connection nahi mila." + SETUP, { parse_mode: "HTML" });

  const show = async (ctx, { text, kb }) => {
    try { await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } }); }
    catch (e) { if (!/not modified/i.test(errText(e))) await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb }); }
  };

  bot.command("business", async (ctx) => {
    if (ctx.chat.type !== "private" || !isOwner(ctx.from?.id)) return;
    const c = await ownerConn(ctx);
    if (!c) return noConn(ctx);
    const p = panel(c);
    await ctx.reply(p.text, { parse_mode: "HTML", reply_markup: p.kb });
  });

  const setter = (name, fn) => bot.command(name, async (ctx) => {
    if (ctx.chat.type !== "private" || !isOwner(ctx.from?.id)) return;
    const c = await ownerConn(ctx);
    if (!c) return noConn(ctx);
    const arg = (ctx.match || "").trim();
    if (!arg) return ctx.reply(`Usage: <code>/${name} ...</code>  (/business me examples)`, { parse_mode: "HTML" });
    const [patch, reply] = fn(arg);
    if (!patch) return ctx.reply(reply);
    await updateConnection(c.connId, patch);
    await ctx.reply(reply, { parse_mode: "HTML" });
  });
  const off = (s) => /^(off|none|clear)$/i.test(s);
  // limit se lamba text kat jaata hai — ab chup-chaap nahi, warning ke saath
  const cutNote = (t, max) => (t.length > max ? `\n⚠️ Text ${t.length} characters ka tha, sirf pehle ${max} save hue (${t.length - max} characters cut). Chhota karke dobara bhejo.` : "");
  setter("bizwelcome", (a) => off(a) ? [{ welcomeText: "" }, "🗑 Welcome message hata diya."] : [{ welcomeText: a.slice(0, 1000) }, "✅ Welcome message set (sirf pehle customer message par jaayega)." + cutNote(a, 1000)]);
  setter("bizreply", (a) => off(a) ? [{ fixedText: "" }, "🗑 Default fixed reply hata diya."] : [{ fixedText: a.slice(0, 1000) }, "✅ Default fixed reply set." + cutNote(a, 1000)]);
  setter("bizprompt", (a) => /^reset$/i.test(a) ? [{ prompt: "" }, "🗑 AI instructions reset."] : [{ prompt: a.slice(0, 2000) }, "✅ AI instructions set." + cutNote(a, 2000)]);
  const mins = (field, label) => (a) => { const n = parseInt(a, 10); return Number.isFinite(n) && n >= 0 && n <= 10080 ? [{ [field]: n }, `✅ ${label}: ${n} min`] : [null, "❌ 0-10080 ke beech minutes do."]; };
  setter("bizcool", mins("cooldownMin", "Fixed-reply cooldown"));
  setter("bizpause", mins("pauseMin", "Owner-active pause"));

  // Telegram "Manage bot" button -> /start bizChat<id>
  async function handleBizStart(ctx) {
    const m = String(ctx.match || "").match(/^biz_?Chat(-?\d+)$/i);
    if (!m || !isOwner(ctx.from?.id)) return false;
    const c = await ownerConn(ctx);
    if (!c) { await noConn(ctx); return true; }
    const ch = (await getBizChat(c.connId, m[1])) ?? (await updateBizChat(c.connId, m[1], {}));
    const p = chatPanel(c, ch);
    await ctx.reply(p.text, { parse_mode: "HTML", reply_markup: p.kb });
    return true;
  }

  async function listView(c, page) {
    const per = 8;
    const { items, total } = await listBizChats(c.connId, page * per, per);
    const kb = new InlineKeyboard();
    for (const ch of items) {
      const on = (ch.allowed ?? c.allowAll) && (ch.mode || c.mode) !== "off";
      kb.text(`${on ? "✅" : "⛔"} ${ch.name || ch.chatId}`.slice(0, 40), `biz:c:${ch.chatId}`).row();
    }
    if (page > 0) kb.text("◀️", `biz:chats:${page - 1}`);
    if ((page + 1) * per < total) kb.text("▶️", `biz:chats:${page + 1}`);
    kb.row().text("⬅️ Back", "biz:panel");
    return { text: `💬 <b>Chats</b> (${total})\n\n✅ = automation on, ⛔ = off. Chat kholne ke liye dabao.${total ? "" : "\n\n<i>Abhi tak kisi customer ka message nahi aaya.</i>"}`, kb };
  }

  bot.callbackQuery(/^biz:/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.answerCallbackQuery();
    const c = await ownerConn(ctx);
    if (!c) { await ctx.answerCallbackQuery({ text: "Connection nahi mila", show_alert: true }); return; }
    const [, act, arg] = ctx.callbackQuery.data.split(":");
    let view;

    if (act === "panel") view = panel(c);
    else if (act === "auto") view = panel(await updateConnection(c.connId, { automation: !c.automation }));
    else if (act === "mode") view = panel(await updateConnection(c.connId, { mode: c.mode === "ai" ? "fixed" : "ai" }));
    else if (act === "scope") view = panel(await updateConnection(c.connId, { allowAll: !c.allowAll }));
    else if (act === "chats") view = await listView(c, parseInt(arg, 10) || 0);
    else {
      const chatId = arg;
      let ch = (await getBizChat(c.connId, chatId)) ?? (await updateBizChat(c.connId, chatId, {}));
      if (act === "ct") {
        const on = (ch.allowed ?? c.allowAll) && (ch.mode || c.mode) !== "off";
        ch = await updateBizChat(c.connId, chatId, { allowed: !on, ...(!on && ch.mode === "off" ? { mode: "" } : {}) });
      }
      else if (act === "cm") ch = await updateBizChat(c.connId, chatId, { mode: NEXT_CHAT_MODE[ch.mode || ""] });
      else if (act === "cx") ch = await updateBizChat(c.connId, chatId, { fixedText: "", ...(ch.mode === "fixed" ? { mode: "" } : {}) });
      else if (act === "cq") ch = await updateBizChat(c.connId, chatId, { prompt: "" });
      else if (act === "cn") ch = await updateBizChat(c.connId, chatId, { triggers: [], triggerReply: "", triggerRefusal: "", lastTriggerAt: null });
      else if (act === "ck") {
        await setAwaiting(ctx.from.id, c.connId, chatId, "tkeys");
        await ctx.answerCallbackQuery();
        await ctx.reply("🎯 Step 1/3 — Keywords bhejo (comma se alag), jaise: baat kar, call, message karne, unse baat\nCustomer ke message me inme se koi bhi aaye to tumhara exact message jaayega (cancel: /cancel).");
        return;
      }
      else if (act === "cp") {
        await setAwaiting(ctx.from.id, c.connId, chatId, "prompt");
        await ctx.answerCallbackQuery();
        await ctx.reply("🧠 Is chat (customer) ke liye AI instructions bhejo, jaise: \"ye mera dost hai, casual Hinglish me baat karo\" (cancel: /cancel). Ye sirf is chat pe lagenge, aur global /bizprompt ke saath judenge.");
        return;
      }
      else if (act === "cr") {
        await setAwaiting(ctx.from.id, c.connId, chatId);
        await ctx.answerCallbackQuery();
        await ctx.reply("✏️ Is chat ke liye custom reply text bhejo (cancel: /cancel). Ye reply is customer ko fixed mode me jaayega.");
        return;
      }
      view = chatPanel(c, ch);
    }
    await ctx.answerCallbackQuery();
    await show(ctx, view);
  });

  // owner ka next text message = custom reply for a chat
  async function handleOwnerInput(ctx) {
    if (!isOwner(ctx.from?.id)) return false;             // DB sirf owner ke messages par touch hota hai
    const st = await takeAwaiting(ctx.from.id);
    if (!st) return false;
    if (Date.now() - new Date(st.at).getTime() > 10 * 60_000) return false;
    const text = ctx.msg.text.trim();
    if (/^\/?cancel$/i.test(text)) { await ctx.reply("Cancel ho gaya."); return true; }
    const c = await getConnection(st.connId);
    if (st.kind === "tkeys") {
      const keys = parseKeywords(text);
      if (!keys.length) {
        await setAwaiting(ctx.from.id, st.connId, st.chatId, "tkeys");
        await ctx.reply("⚠️ Koi valid keyword nahi mila. Comma se alag karke bhejo, jaise: baat kar, call");
        return true;
      }
      await updateBizChat(st.connId, st.chatId, { triggers: keys });
      await setAwaiting(ctx.from.id, st.connId, st.chatId, "ttext");
      await ctx.reply(`✅ Keywords save (${keys.length}): ${keys.join(", ")}\n\n🎯 Step 2/3 — Ab wo exact message bhejo jo bhejna hai (max 4000 characters). Last ki line (jaise "mai usse aapki baat nahi karwa sakta") isi message me daal do. (cancel: /cancel)`);
      return true;
    }
    if (st.kind === "ttext") {
      await updateBizChat(st.connId, st.chatId, { triggerReply: text.slice(0, 4000), lastTriggerAt: null });
      await setAwaiting(ctx.from.id, st.connId, st.chatId, "trefuse");
      await ctx.reply(`✅ Message save (${Math.min(text.length, 4000)} characters).${cutNote(text, 4000)}\n\n🎯 Step 3/3 — Ab ek chhoti refusal line bhejo (max 300 characters). Keyword na mile par bhi agar customer baat karwane jaisi request kare, ya cooldown chal raha ho, to AI sirf ye line bhejega. Jaise: mai usse aapki baat nahi karwa sakta\nSkip karne ke liye: -`);
      return true;
    }
    if (st.kind === "trefuse") {
      const line = text === "-" ? "" : text.slice(0, 300);
      const ch = await updateBizChat(st.connId, st.chatId, { triggerRefusal: line, allowed: true });   // trigger tabhi chalta hai jab chat me automation ON ho
      const p = chatPanel(c, ch);
      await ctx.reply("✅ Trigger reply ready (is chat me automation ON)." + cutNote(text, 300) + "\n\n" + p.text, { parse_mode: "HTML", reply_markup: p.kb });
      return true;
    }
    if (st.kind === "prompt") {
      const ch = await updateBizChat(st.connId, st.chatId, { prompt: text.slice(0, 1500) });   // mode/allowed ko nahi chhedta
      const p = chatPanel(c, ch);
      await ctx.reply("✅ Is chat ke liye AI instructions save ho gaye." + cutNote(text, 1500) + "\n\n" + p.text, { parse_mode: "HTML", reply_markup: p.kb });
      return true;
    }
    const ch = await updateBizChat(st.connId, st.chatId, { fixedText: text.slice(0, 1000), mode: "fixed", allowed: true });
    const p = chatPanel(c, ch);
    await ctx.reply("✅ Custom reply set (is chat me automation ON + Fixed mode)." + cutNote(text, 1000) + "\n\n" + p.text, { parse_mode: "HTML", reply_markup: p.kb });
    return true;
  }
  bot.command("cancel", async (ctx) => { if (isOwner(ctx.from?.id) && (await dropAwaiting(ctx.from.id))) await ctx.reply("Cancel ho gaya."); });

  return { handleBizStart, handleOwnerInput };
}