// Promtsal checks: syntax, i18n parity, engine behaviour, page security settings, and a secret scan.
// Usage: node scripts/check.mjs   (CI runs it before every deploy)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("  ok    " + name); }
  catch (e) { failed++; console.log("  FAIL  " + name + "\n        " + (e && e.message ? e.message.split("\n").join("\n        ") : e)); }
}

// Load the browser scripts that don't touch the DOM into one sandbox.
const sandbox = {};
vm.createContext(sandbox);
for (const f of ["web/js/i18n.js", "web/js/engine.js", "web/js/providers.js"]) {
  check("parses: " + f, () => vm.runInContext(read(f), sandbox, { filename: f }));
}
check("parses: web/js/app.js", () => new vm.Script(read("web/js/app.js"), { filename: "web/js/app.js" }));
const PS = sandbox.PS;
const plain = (x) => JSON.parse(JSON.stringify(x)); // values from the vm realm have other prototypes
const E = PS.engine;

console.log("\ni18n");
check("tr and en have the same keys", () => {
  const tr = Object.keys(PS.STRINGS.tr).sort(), en = Object.keys(PS.STRINGS.en).sort();
  const missingEn = tr.filter((k) => !en.includes(k)), missingTr = en.filter((k) => !tr.includes(k));
  assert.deepEqual({ missingEn, missingTr }, { missingEn: [], missingTr: [] });
});
check("no empty strings", () => {
  for (const lang of ["tr", "en"]) for (const [k, v] of Object.entries(PS.STRINGS[lang])) assert.ok(v.trim(), lang + ": " + k);
});
check("every data-i18n key in index.html exists", () => {
  const html = read("web/index.html");
  const keys = [...html.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)].map((m) => m[1]);
  const missing = keys.filter((k) => !(k in PS.STRINGS.tr));
  assert.deepEqual(missing, []);
});
check("every t(\"…\") key in app.js exists", () => {
  const src = read("web/js/app.js");
  const keys = [...src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"\s*[,)]/g)].map((m) => m[1]);
  const missing = [...new Set(keys)].filter((k) => !(k in PS.STRINGS.tr));
  assert.deepEqual(missing, []);
});
check("templates exist in both languages with the same ids", () => {
  assert.deepEqual(E.TEMPLATES.tr.map((x) => x.id), E.TEMPLATES.en.map((x) => x.id));
  for (const x of [...E.TEMPLATES.tr, ...E.TEMPLATES.en]) assert.ok(E.TARGETS.includes(x.target), x.id);
});

console.log("\nengine");
check("buildRequest puts the input in <input> and the rules in system", () => {
  const r = E.buildRequest({ input: "merhaba dünya", mode: "clean", target: "agent", lang: "en", uiLang: "tr", rules: "Test iste." });
  assert.match(r.user, /<input>\nmerhaba dünya\n<\/input>$/);
  assert.match(r.system, /MODE: CLEAN UP/);
  assert.match(r.system, /TARGET: CODING AGENT/);
  assert.match(r.system, /natural, fluent English/);
  assert.match(r.system, /<preferences>\nTest iste\.\n<\/preferences>/);
  assert.match(r.system, /Write <changes> and <questions> in Turkish\./);
});
check("buildRequest carries previous version and answers", () => {
  const r = E.buildRequest({ input: "x", prev: "eski", answered: [{ q: "Dil?", a: "Python" }], open: ["Ad?"], uiLang: "en" });
  assert.match(r.user, /<previous>\neski\n<\/previous>/);
  assert.match(r.user, /- Dil\? → Python/);
  assert.match(r.user, /Questions left unanswered:\n- Ad\?/);
});
check("parse reads all three sections", () => {
  const p = E.parse('<prompt>\nYeni promt.\n</prompt>\n<changes>\n- Bir\n- İki\n</changes>\n<questions>\n{"q": "Hangi dil?", "options": ["TR", "EN"]}\nbozuk satır\n</questions>', true);
  assert.equal(p.prompt, "Yeni promt.");
  assert.deepEqual(plain(p.changes), ["Bir", "İki"]);
  assert.equal(p.questions.length, 1);
  assert.deepEqual(plain(p.questions[0]), { q: "Hangi dil?", options: ["TR", "EN"], answer: "" });
});
check("parse handles a partial stream", () => {
  assert.equal(E.parse("<prompt>\nYarım met", false).prompt, "Yarım met");
  assert.equal(E.parse("düşünüyor", false).prompt, "");
});
check("parse falls back to the whole reply without tags", () => {
  assert.equal(E.parse("Sadece metin.", true).prompt, "Sadece metin.");
});
check("diffTokens marks removed and added words", () => {
  const ops = E.diffTokens("bana sana yap", "bana yap şunu");
  assert.deepEqual(plain(ops), [["=", "bana"], ["-", "sana"], ["=", "yap"], ["+", "şunu"]]);
});
check("health flags the messy example", () => {
  const h = E.health(E.EXAMPLES.tr.input + " şey yani falan bir şey");
  assert.ok(h.score < 80, "score " + h.score);
  const types = h.findings.map((f) => f.type);
  for (const t of ["vague", "filler", "nopunct"]) assert.ok(types.includes(t), "missing " + t + " in " + types);
  assert.ok(h.marks.every((m) => m.end > m.start));
});
check("health keeps Turkish reduplication and 'bir şey' as one mark", () => {
  const h = E.health("Dosyaları tek tek oku ve bir şey yapma.");
  assert.ok(!h.findings.some((f) => f.type === "repeat"));
  const vague = h.marks.filter((m) => m.type === "vague");
  assert.equal(vague.length, 1);
  assert.ok(!h.marks.some((m) => m.type === "filler"));
});
check("health scores a clear prompt well", () => {
  const h = E.health("Write a Python script that renames photos in a folder by their EXIF date. Output the script as one code block.");
  assert.ok(h.score >= 85, "score " + h.score + " " + JSON.stringify(h.findings));
});
check("cost uses dated prices and returns null for unknown models", () => {
  const before = E.cost("gemini-3.8-flash", 1e6, 0, new Date("2026-10-15"));
  const after = E.cost("gemini-3.8-flash", 1e6, 0, new Date("2027-01-02"));
  assert.equal(before, 0.75);
  assert.equal(after, 1.5);
  assert.equal(E.cost("unknown-model", 1000, 1000), null);
  for (const m of Object.values(E.DEFAULT_MODELS)) assert.ok(E.PRICES[m], "default model has a price: " + m);
});

console.log("\npage security");
check("index.html has a strict CSP", () => {
  const html = read("web/index.html");
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /connect-src https:\/\/generativelanguage\.googleapis\.com(;|$)/);
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), "no unsafe-* sources");
  assert.ok(!/<script>/.test(html), "no inline scripts");
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});
check("no innerHTML / eval in browser code", () => {
  for (const f of ["web/js/app.js", "web/js/engine.js", "web/js/providers.js", "web/js/i18n.js"]) {
    const src = read(f);
    assert.ok(!/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(src), f);
  }
});

console.log("\nsecrets");
check("no API keys or tokens in the repository", () => {
  const patterns = [/AIza[0-9A-Za-z_-]{35}/, /sk-ant-[0-9A-Za-z_-]{20,}/, /sk-[A-Za-z0-9]{32,}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  const skip = new Set([".git", "node_modules", "dist"]);
  const hits = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (statSync(p).size > 2e6) continue;
      const text = readFileSync(p, "utf8");
      for (const re of patterns) if (re.test(text)) hits.push(relative(root, p) + " ~ " + re);
    }
  })(root);
  assert.deepEqual(hits, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
