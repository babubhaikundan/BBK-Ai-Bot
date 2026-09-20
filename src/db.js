import mongoose from "mongoose";
import { config } from "./config.js";

const { Schema } = mongoose;
const opts = { versionKey: false };

// ---- Schemas (User/Session collections purane bot ke saath compatible) ----
const User = mongoose.model("User", new Schema({
  userId: { type: String, unique: true, index: true },
  date: String,
  count: { type: Number, default: 0 },
  firstName: String,
  username: String,
  banned: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastSeen: Date,
}, opts));

const Session = mongoose.model("Session", new Schema({
  chatId: { type: String, unique: true, index: true },
  history: [{ role: String, content: String, _id: false }],
  updatedAt: { type: Date, index: { expireAfterSeconds: 30 * 86400 } },   // 30 din baad auto-delete
}, opts));

const BusinessConnection = mongoose.model("BusinessConnection", new Schema({
  connId: { type: String, unique: true, index: true },
  ownerId: { type: String, index: true },
  userChatId: String,
  enabled: { type: Boolean, default: true },
  canReply: { type: Boolean, default: false },
  automation: { type: Boolean, default: false },
  mode: { type: String, default: "ai" },              // ai | fixed
  allowAll: { type: Boolean, default: false },        // false = sirf selected chats
  welcomeText: { type: String, default: "" },
  fixedText: { type: String, default: "" },
  prompt: { type: String, default: "" },
  cooldownMin: { type: Number, default: 360 },
  pauseMin: { type: Number, default: 30 },
  updatedAt: Date,
}, opts));

const bizChatSchema = new Schema({
  connId: String,
  chatId: String,
  name: { type: String, default: "" },
  username: { type: String, default: "" },
  allowed: { type: Boolean, default: null },          // null = inherit (allowAll)
  mode: { type: String, default: "" },                // "" inherit | ai | fixed | off
  fixedText: { type: String, default: "" },
  welcomeSent: { type: Boolean, default: false },
  firstSeenAt: Date,
  lastMsgAt: Date,
  lastAutoAt: Date,
  lastOwnerAt: Date,
  msgCount: { type: Number, default: 0 },
}, opts);
bizChatSchema.index({ connId: 1, chatId: 1 }, { unique: true });
const BizChat = mongoose.model("BizChat", bizChatSchema);

const Processed = mongoose.model("BizProcessed", new Schema({
  key: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 2 * 86400 } },
}, opts));

const OwnerState = mongoose.model("OwnerState", new Schema({
  ownerId: { type: String, unique: true },
  connId: String,
  chatId: String,
  at: { type: Date, default: Date.now, index: { expireAfterSeconds: 900 } },
}, opts));

const RateWindow = mongoose.model("RateWindow", new Schema({
  key: { type: String, unique: true },
  start: Date,
  n: { type: Number, default: 0 },
  expireAt: { type: Date, index: { expireAfterSeconds: 0 } },
}, opts));

const BroadcastJob = mongoose.model("BroadcastJob", new Schema({
  key: { type: String, unique: true, default: "current" },
  text: String, adminChat: String, cursor: { type: String, default: "" },
  total: { type: Number, default: 0 }, ok: { type: Number, default: 0 },
  fail: { type: Number, default: 0 }, blocked: { type: Number, default: 0 },
  done: { type: Boolean, default: false }, startedAt: { type: Date, default: Date.now },
}, opts));

// ---- Connection ----
export async function connectDB({ maxPoolSize = 10 } = {}) {
  if (mongoose.connection.readyState === 1) return;          // serverless: warm instance me dobara connect nahi
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize });
  const res = await Promise.allSettled(Object.values(mongoose.models).map((m) => m.init()));
  res.forEach((r, i) => {
    if (r.status === "rejected") console.warn(`⚠️ Index build issue (${Object.keys(mongoose.models)[i]}):`, r.reason?.message);
  });
}
export const disconnectDB = () => mongoose.disconnect();

const dupKey = (e) => e?.code === 11000;

// ---- Users / limits (atomic) ----
export async function touchUser(from) {
  const id = String(from.id);
  const set = { firstName: from.first_name || "", username: from.username || "", lastSeen: new Date(), blocked: false };
  try {
    await User.updateOne({ userId: id }, { $set: set, $setOnInsert: { createdAt: new Date(), date: "", count: 0 } }, { upsert: true });
  } catch (e) { if (!dupKey(e)) throw e; }
}

export async function consumeLimit(userId, limit, today, retry = true) {
  const id = String(userId), now = new Date();
  let d = await User.findOneAndUpdate(
    { userId: id, date: today, count: { $lt: limit } },
    { $inc: { count: 1 }, $set: { lastSeen: now } }, { new: true });
  if (d) return { ok: true, used: d.count };

  d = await User.findOneAndUpdate(                       // naya din: reset
    { userId: id, date: { $ne: today } },
    { $set: { date: today, count: 1, lastSeen: now } }, { new: true });
  if (d) return { ok: true, used: 1 };

  if (!(await User.exists({ userId: id }))) {
    try { await User.create({ userId: id, date: today, count: 1, lastSeen: now }); return { ok: true, used: 1 }; }
    catch (e) { if (!dupKey(e) || !retry) throw e; return consumeLimit(userId, limit, today, false); }
  }
  return { ok: false, used: limit };
}

export async function refundLimit(userId, today) {
  await User.updateOne({ userId: String(userId), date: today, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

export async function getUsage(userId, today) {
  const u = await User.findOne({ userId: String(userId) }).lean();
  return u && u.date === today ? u.count : 0;
}

const banCache = new Map();
export async function isBanned(userId) {
  const id = String(userId), c = banCache.get(id);
  if (c && c.until > Date.now()) return c.v;
  const v = !!(await User.exists({ userId: id, banned: true }));
  banCache.set(id, { v, until: Date.now() + 60000 });
  return v;
}
export async function setBan(userId, banned) {
  const id = String(userId);
  banCache.delete(id);
  await User.updateOne({ userId: id }, { $set: { banned }, $setOnInsert: { createdAt: new Date(), date: "", count: 0 } }, { upsert: true });
}

export async function markBlocked(userId) {
  await User.updateOne({ userId: String(userId) }, { $set: { blocked: true } });
}

const targetFilter = (after = "") => ({ userId: after ? { $gt: after, $regex: "^[0-9]+$" } : { $regex: "^[0-9]+$" }, banned: { $ne: true }, blocked: { $ne: true } });   // groups (negative ids) skip
export async function broadcastTargets(after = "", limit = 100000) {
  const docs = await User.find(targetFilter(after)).sort({ userId: 1 }).limit(limit).select("userId").lean();
  return docs.map((d) => d.userId);
}
export const countTargets = () => User.countDocuments(targetFilter(""));

export async function adminStats(today) {
  const [totalUsers, blocked, activeToday, sum, conns] = await Promise.all([
    User.countDocuments({ userId: { $regex: "^[0-9]" } }),
    User.countDocuments({ blocked: true }),
    User.countDocuments({ date: today }),
    User.aggregate([{ $match: { date: today } }, { $group: { _id: null, t: { $sum: "$count" } } }]),
    BusinessConnection.countDocuments({ enabled: true }),
  ]);
  return { totalUsers, blocked, activeToday, msgsToday: sum[0]?.t || 0, bizConnections: conns };
}

// ---- Sessions (atomic push, race-free) ----
export async function getHistory(key) {
  const s = await Session.findOne({ chatId: String(key) }).lean();
  return s?.history || [];
}

export async function pushMessage(key, role, content, max = 20, retry = true) {
  try {
    const s = await Session.findOneAndUpdate(
      { chatId: String(key) },
      { $push: { history: { $each: [{ role, content }], $slice: -max } }, $set: { updatedAt: new Date() } },
      { upsert: true, new: true }).lean();
    return s.history;
  } catch (e) {
    if (dupKey(e) && retry) return pushMessage(key, role, content, max, false);
    throw e;
  }
}
export const popLast = (key) => Session.updateOne({ chatId: String(key) }, { $pop: { history: 1 } });
export const clearSession = (key) => Session.deleteOne({ chatId: String(key) });

// ---- Business connections ----
const connCache = new Map();
const cacheGet = (id) => { const c = connCache.get(id); return c && c.until > Date.now() ? c.v : undefined; };

export async function upsertConnection(connId, fields) {
  connCache.delete(connId);
  return BusinessConnection.findOneAndUpdate(
    { connId }, { $set: { ...fields, updatedAt: new Date() } },
    { upsert: true, new: true }).lean();
}
export async function getConnection(connId) {
  const c = cacheGet(connId);
  if (c !== undefined) return c;
  const v = await BusinessConnection.findOne({ connId }).lean();
  connCache.set(connId, { v, until: Date.now() + 30000 });
  return v;
}
export const getConnectionByOwner = (ownerId) =>
  BusinessConnection.findOne({ ownerId: String(ownerId), enabled: true }).sort({ updatedAt: -1 }).lean();
export async function updateConnection(connId, patch) {
  connCache.delete(connId);
  return BusinessConnection.findOneAndUpdate({ connId }, { $set: { ...patch, updatedAt: new Date() } }, { new: true }).lean();
}

export async function claimMessage(key) {
  try { await Processed.create({ key }); return true; }
  catch (e) { if (dupKey(e)) return false; throw e; }
}

export async function touchBizChat(connId, chatId, { name, username } = {}) {
  const filter = { connId, chatId: String(chatId) };
  const set = { lastMsgAt: new Date() };
  if (name) set.name = name;
  if (username) set.username = username;
  try {
    return await BizChat.findOneAndUpdate(filter,
      { $set: set, $inc: { msgCount: 1 }, $setOnInsert: { firstSeenAt: new Date() } },
      { upsert: true, new: true }).lean();
  } catch (e) {
    if (!dupKey(e)) throw e;
    return BizChat.findOneAndUpdate(filter, { $set: set, $inc: { msgCount: 1 } }, { new: true }).lean();
  }
}
export async function markOwnerActive(connId, chatId) {
  try {
    await BizChat.updateOne({ connId, chatId: String(chatId) },
      { $set: { lastOwnerAt: new Date() }, $setOnInsert: { firstSeenAt: new Date(), welcomeSent: true } }, { upsert: true });
  } catch (e) { if (!dupKey(e)) throw e; }
}
// atomic: sirf pehli baar true
export async function claimWelcome(connId, chatId) {
  const d = await BizChat.findOneAndUpdate(
    { connId, chatId: String(chatId), welcomeSent: { $ne: true } }, { $set: { welcomeSent: true } });
  return !!d;
}
// atomic cooldown claim (fixed replies)
export async function claimAutoReply(connId, chatId, cooldownMs) {
  const d = await BizChat.findOneAndUpdate(
    { connId, chatId: String(chatId), $or: [{ lastAutoAt: null }, { lastAutoAt: { $lt: new Date(Date.now() - cooldownMs) } }] },
    { $set: { lastAutoAt: new Date() } });
  return !!d;
}
export const setAutoReplied = (connId, chatId) =>
  BizChat.updateOne({ connId, chatId: String(chatId) }, { $set: { lastAutoAt: new Date() } });
export const getBizChat = (connId, chatId) => BizChat.findOne({ connId, chatId: String(chatId) }).lean();
export async function updateBizChat(connId, chatId, patch) {
  const filter = { connId, chatId: String(chatId) };
  const update = { $setOnInsert: { firstSeenAt: new Date() } };
  if (patch && Object.keys(patch).length) update.$set = patch;          // khaali $set kuch engines me error deta hai
  try {
    return await BizChat.findOneAndUpdate(filter, update, { upsert: true, new: true }).lean();
  } catch (e) {
    if (!dupKey(e)) throw e;
    return BizChat.findOneAndUpdate(filter, update.$set ? { $set: patch } : {}, { new: true }).lean();
  }
}
export async function listBizChats(connId, skip = 0, limit = 8) {
  const [items, total] = await Promise.all([
    BizChat.find({ connId }).sort({ lastMsgAt: -1 }).skip(skip).limit(limit).lean(),
    BizChat.countDocuments({ connId }),
  ]);
  return { items, total };
}

// ---- Webhook-mode helpers (serverless: in-memory state par bharosa nahi) ----
export const claimUpdate = (updateId) => claimMessage(`u:${updateId}`);          // Telegram retry / duplicate update dedupe

export async function markSent(connId, chatId, msgId) {
  try { await Processed.create({ key: `sent:${connId}:${chatId}:${msgId}` }); } catch (e) { if (!dupKey(e)) throw e; }
}
export const wasSent = async (connId, chatId, msgId) => !!(await Processed.exists({ key: `sent:${connId}:${chatId}:${msgId}` }));

export async function setAwaiting(ownerId, connId, chatId) {
  await OwnerState.findOneAndUpdate({ ownerId: String(ownerId) }, { $set: { connId, chatId: String(chatId), at: new Date() } }, { upsert: true });
}
export const takeAwaiting = (ownerId) => OwnerState.findOneAndDelete({ ownerId: String(ownerId) }).lean();
export const dropAwaiting = async (ownerId) => !!(await OwnerState.findOneAndDelete({ ownerId: String(ownerId) }));

// sliding-window counter (per chat hourly cap) — atomic conditional updates
export async function bumpWindow(key, limit, windowMs, retry = true) {
  const now = Date.now(), from = new Date(now - windowMs), fresh = { start: new Date(now), n: 1, expireAt: new Date(now + 2 * windowMs) };
  if (await RateWindow.findOneAndUpdate({ key, start: { $gte: from }, n: { $lt: limit } }, { $inc: { n: 1 } })) return true;
  if (await RateWindow.findOneAndUpdate({ key, start: { $lt: from } }, { $set: fresh })) return true;
  if (!(await RateWindow.exists({ key }))) {
    try { await RateWindow.create({ key, ...fresh }); return true; }
    catch (e) { if (!dupKey(e) || !retry) throw e; return bumpWindow(key, limit, windowMs, false); }
  }
  return false;
}

// ---- Broadcast job (resume-able; serverless time limit ke liye) ----
export async function startBroadcast(text, adminChat, total) {
  await BroadcastJob.deleteMany({});
  return BroadcastJob.create({ key: "current", text, adminChat: String(adminChat), total });
}
export const getBroadcast = () => BroadcastJob.findOne({ key: "current" }).lean();
export const saveBroadcast = (patch) => BroadcastJob.updateOne({ key: "current" }, { $set: patch });
