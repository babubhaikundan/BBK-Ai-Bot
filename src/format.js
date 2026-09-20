// Markdown (AI output) -> Telegram HTML.
// v1 ke bugs jo fix hue: code ke andar formatting, snake_case italic, c++/c# tag,
// 4096 limit (chunking ab *formatted* HTML pe), split code fence, tables, links, LaTeX.
import { escapeHtml as esc } from "./util.js";

const CODE_WRAP = (lang, body) =>
  `<pre><code${lang ? ` class="language-${lang}"` : ""}>${esc(body)}</code></pre>`;

const cleanLang = (l) => (l || "").replace(/[^A-Za-z0-9_+#.-]/g, "").slice(0, 20);

// ---- 1. blocks: fenced code vs text ------------------------------------
function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let buf = [], inCode = false, lang = "", code = [];
  const flush = () => { if (buf.length) { blocks.push({ type: "text", body: buf.join("\n") }); buf = []; } };

  for (const line of lines) {
    if (!inCode) {
      const single = line.match(/^\s*```([^`\n]+)```\s*$/);          // ```code``` ek line me
      if (single) { flush(); blocks.push({ type: "code", lang: "", body: single[1] }); continue; }
      const open = line.match(/^\s*```([^`\n]*)$/);
      if (open) { flush(); inCode = true; lang = cleanLang(open[1].trim().split(/\s+/)[0]); code = []; continue; }
      buf.push(line);
    } else if (/^\s*```\s*$/.test(line)) {
      blocks.push({ type: "code", lang, body: code.join("\n") });
      inCode = false;
    } else code.push(line);
  }
  if (inCode) blocks.push({ type: "code", lang, body: code.join("\n") });   // unclosed fence (truncated reply)
  flush();
  return blocks;
}

// ---- 2. text formatting ---------------------------------------------------
function tableToPre(lines) {
  const rows = lines
    .filter((l, i) => !(i === 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(l)))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*|__|`/g, "")));
  const cols = Math.max(...rows.map((r) => r.length));
  const w = Array.from({ length: cols }, (_, i) => Math.min(24, Math.max(...rows.map((r) => (r[i] || "").length))));
  const total = w.reduce((a, b) => a + b, 0) + 3 * (cols - 1);
  const out = rows.map((r) => total <= 60
    ? r.map((c, i) => (c || "").padEnd(w[i])).join(" │ ").trimEnd()
    : r.join(" │ "));
  return out.join("\n");
}

// Telegram rules: tags balanced, <pre> me sirf <code>, <code> me kuch nahi
export function isBalanced(html) {
  const re = /<(\/?)(b|i|s|u|code|pre|a|blockquote)(?:\s[^>]*)?>/g;
  const stack = [];
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag] = m;
    if (!close) {
      const top = stack[stack.length - 1];
      if ((top === "pre" && tag !== "code") || top === "code") return false;
      stack.push(tag);
    } else if (stack.pop() !== tag) return false;
  }
  return stack.length === 0;
}

function formatText(input) {
  const rich = formatRich(input, true);
  if (isBalanced(rich)) return rich;
  return formatRich(input, false);          // overlapping markup -> inline formatting chhod ke safe output
}

function formatRich(input, inline) {
  let t = input;
  const stash = [];
  const hold = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };

  // tables (contiguous pipe lines with separator row)
  const lines = t.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; ) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) j++;
      const run = lines.slice(i, j);
      if (run.length >= 2 && /^\s*\|?[\s:|-]+\|?\s*$/.test(run[1])) { kept.push(hold(`<pre>${esc(tableToPre(run))}</pre>`)); i = j; continue; }
    }
    kept.push(lines[i]); i++;
  }
  t = kept.join("\n");

  // inline code, LaTeX (raw dikhane ke bajay monospace)
  t = t.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  t = t.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g, (_, a, b, c) => hold(`<code>${esc((a || b || c).trim())}</code>`));

  t = esc(t);
  if (!inline) {
    t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
    return t.replace(/\n{3,}/g, "\n\n").trim();
  }

  // blockquotes (> text)
  t = t.replace(/(?:^&gt; ?.*(?:\n|$))+/gm, (m) =>
    `<blockquote>${m.replace(/^&gt; ?/gm, "").trimEnd()}</blockquote>\n`);

  t = t
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)"]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "<b>$1</b>")
    .replace(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, "<b>$1</b>")
    .replace(/(?<![\w])__(?=\S)([^\n]+?)(?<=\S)__(?![\w])/g, "<b>$1</b>")
    .replace(/~~(?=\S)([^\n]+?)(?<=\S)~~/g, "<s>$1</s>")
    .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, "<i>$1</i>")
    .replace(/(?<![\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w])/g, "<i>$1</i>")   // snake_case safe
    .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ");

  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

// ---- 3. chunking (formatted HTML <= limit) ------------------------------------
function splitCode(block, limit) {
  const overhead = CODE_WRAP(block.lang, "").length;
  const room = limit - overhead - 8;
  const out = [];
  let cur = [], curLen = 0;
  const push = () => { if (cur.length) { out.push(CODE_WRAP(block.lang, cur.join("\n"))); cur = []; curLen = 0; } };
  for (let line of block.body.split("\n")) {
    while (esc(line).length > room) {                      // ek hi line bahut lambi
      let cut = Math.max(1, Math.floor(room / 5));
      while (cut < line.length && esc(line.slice(0, cut + 50)).length <= room) cut += 50;
      push(); out.push(CODE_WRAP(block.lang, line.slice(0, cut))); line = line.slice(cut);
    }
    const l = esc(line).length + 1;
    if (curLen + l > room) push();
    cur.push(line); curLen += l;
  }
  push();
  return out;
}

function splitText(body, limit) {
  const out = [];
  for (const para of body.split(/\n{2,}/)) {
    const html = formatText(para);
    if (!html) continue;
    if (html.length <= limit) { out.push(html); continue; }
    let group = [];
    const flush = () => { if (group.length) { const h = formatText(group.join("\n")); if (h) out.push(h); group = []; } };
    for (let line of para.split("\n")) {
      while (formatText(line).length > limit) {              // single giant line
        flush();
        const piece = line.slice(0, 1200); line = line.slice(1200);
        out.push(formatText(piece));
      }
      const tryGroup = [...group, line].join("\n");
      if (formatText(tryGroup).length > limit) { flush(); }
      group.push(line);
    }
    flush();
  }
  return out;
}

export function renderChunks(markdown, limit = 4000) {
  const pieces = [];
  for (const b of parseBlocks(String(markdown ?? ""))) {
    if (b.type === "code") { if (b.body.trim()) pieces.push(...splitCode(b, limit)); }
    else pieces.push(...splitText(b.body, limit));
  }
  const out = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + 2 + p.length > limit) { out.push(cur); cur = p; }
    else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}
