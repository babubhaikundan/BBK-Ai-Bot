// Per-chat "Trigger reply" helpers (pure functions -> unit-testable).
// Keyword aaye to owner ka exact message jaata hai (AI nahi).

export const normalizeText = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// "Baat Kar, CALL ; message karne\nunse baat" -> ["baat kar","call","message karne","unse baat"]
export function parseKeywords(input, { max = 20, maxLen = 40 } = {}) {
  const out = [];
  for (const raw of String(input ?? "").split(/[,\n;|]+/)) {
    const k = normalizeText(raw).slice(0, maxLen);
    if (k.length >= 2 && !out.includes(k)) out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

// substring match (Hinglish spellings/suffix: "baat kar" -> baat karni / baat karwa do)
export function matchesTrigger(text, keywords) {
  const t = normalizeText(text);
  if (!t) return false;
  return (keywords || []).some((k) => { const n = normalizeText(k); return n.length > 0 && t.includes(n); });
}
