import { config } from "./config.js";
import { sleep } from "./util.js";

function headers() {
  const h = { "Content-Type": "application/json" };
  if (config.AI_SHARED_SECRET) h["X-BBK-Secret"] = config.AI_SHARED_SECRET;
  return h;
}

// Proxy khud provider chain + failover karta hai (provider:"auto"). Bot sirf ek call karta hai.
export async function askAI({ messages, system, providers, timeoutMs = 65000 }) {
  const body = { provider: "auto", channel: "telegram", messages };
  if (system) body.system = system;
  if (providers?.length) body.providers = providers;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(config.AI_API_URL, {
        method: "POST", headers: headers(), body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.text) return { text: data.text, provider: data.provider, model: data.model };
      // HTTP error: proxy ne already sab try kar liya -> retry nahi
      const err = new Error(data?.error || `AI proxy HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    } catch (e) {
      lastErr = e;
      if (e.status || e.name === "TimeoutError") throw e;   // sirf network glitch pe retry
      await sleep(700);
    }
  }
  throw lastErr;
}

export async function aiHealth() {
  const res = await fetch(config.AI_API_URL, {
    method: "POST", headers: headers(), body: JSON.stringify({ health: true }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
