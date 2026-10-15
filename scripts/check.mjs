// Promtsal checks: syntax, i18n parity, engine behaviour, page security settings, and a secret scan.
// Usage: node scripts/check.mjs   (CI runs it before every deploy)
import { readFileSync, readdirSync } from "node:fs";
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
const html = read("web/index.html");
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
check("CSP: nothing but our own files and the Gemini API", () => {
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.match(csp, /font-src 'self'(;|$)/);
  assert.match(csp, /connect-src https:\/\/generativelanguage\.googleapis\.com(;|$)/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(!/unsafe-|data: *;|\*/.test(csp.replace("img-src 'self' data:", "")), "no unsafe-*, wildcards or data: outside img-src");
  const origins = csp.match(/https?:\/\/[^\s;]+/g) || [];
  assert.deepEqual(origins, ["https://generativelanguage.googleapis.com"]);
});
check("CSP: Trusted Types enforced and no policy may be created", () => {
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.match(csp, /trusted-types 'none'/);
});
check("index.html loads no third-party files and has no inline script", () => {
  // Look at every <script>/<link> opening tag, any case or quoting, rather than one exact spelling.
  const tags = [...html.matchAll(/<(script|link)\b[^>]*>/gi)].map((m) => m[0]);
  assert.ok(tags.some((tag) => /^<script/i.test(tag)), "scripts found");
  for (const tag of tags) {
    if (/^<script/i.test(tag)) assert.match(tag, /\bsrc\s*=/i, "inline script: " + tag);
    assert.ok(!/\b(?:src|href)\s*=\s*["']?\s*(?:[a-z][\w+.-]*:|\/\/)/i.test(tag), "only relative URLs: " + tag);
  }
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  for (const m of html.matchAll(/target="_blank"[^>]*>/g)) assert.match(m[0], /rel="noopener noreferrer"/);
});
check("self-hosted fonts exist, are WOFF2 and ship with their licenses", () => {
  const css = read("web/fonts/fonts.css");
  const files = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]))];
  assert.ok(files.length >= 4, "font files referenced");
  for (const f of files) {
    assert.match(f, /^[\w.-]+\.woff2$/, "local file name: " + f);
    assert.equal(readFileSync(join(root, "web/fonts", f)).subarray(0, 4).toString("latin1"), "wOF2", f);
  }
  for (const lic of ["OFL-BricolageGrotesque.txt", "OFL-InstrumentSans.txt", "OFL-IBMPlexMono.txt"]) {
    assert.match(read("web/fonts/" + lic), /SIL OPEN FONT LICENSE/, lic);
  }
});
check("no innerHTML / eval in browser code", () => {
  for (const f of ["web/js/app.js", "web/js/engine.js", "web/js/providers.js", "web/js/i18n.js"]) {
    const src = read(f);
    assert.ok(!/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setTimeout\(\s*["'`]/.test(src), f);
  }
});
check("web build refuses to run inside another site's frame", () => {
  const src = read("web/js/app.js");
  assert.match(src, /if \(BUILD === "web"\) \{[\s\S]{0,200}window\.top !== window\.self/);
});

console.log("\nkey handling");
check("Gemini calls send the key in a header, origin-only Referer, no cookies, capped output", () => {
  const src = read("web/js/providers.js");
  assert.match(src, /"x-goog-api-key": key/);
  assert.ok(!/[?&]key=/.test(src), "key must never go in the URL");
  assert.match(src, /referrerPolicy: "strict-origin"/);
  assert.match(src, /credentials: "omit"/);
  assert.match(src, /maxOutputTokens: MAX_OUTPUT_TOKENS/);
});
check("validKey accepts key-shaped strings and rejects the rest", () => {
  const ok = sandbox.PS.providers.validKey;
  assert.equal(ok("test_" + "x".repeat(30)), true);
  for (const bad of ["", "short", "has space " + "x".repeat(30), "line\nbreak" + "x".repeat(30), "ş".repeat(30), "x".repeat(300), null]) {
    assert.equal(ok(bad), false, JSON.stringify(bad));
  }
});
check("the key lives in sessionStorage unless the visitor asks to remember it", () => {
  const src = read("web/js/app.js");
  assert.match(src, /if \(remember\) \{ localStorage\.setItem\(KEY \+ "key", v\); sessionStorage\.removeItem\(KEY \+ "key"\); \}/);
  assert.match(src, /else \{ sessionStorage\.setItem\(KEY \+ "key", v\); localStorage\.removeItem\(KEY \+ "key"\); \}/);
  assert.match(src, /if \(!P\.validKey\(v\)\)/);
});

console.log("\nCI");
check("workflow: least privilege, SHA-pinned actions, no persisted token", () => {
  const wf = read(".github/workflows/pages.yml");
  assert.match(wf, /^permissions:\n  contents: read\n\n/m);
  const uses = [...wf.matchAll(/uses: ([^\s#]+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 5);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, "pin to a full SHA: " + u);
  const checkouts = (wf.match(/actions\/checkout@/g) || []).length;
  assert.equal((wf.match(/persist-credentials: false/g) || []).length, checkouts);
});

console.log("\nsecrets");
check("no API keys or tokens in the repository", () => {
  const patterns = [/AIza[0-9A-Za-z_-]{35}/, /ya29\.[0-9A-Za-z_-]{20,}/, /sk-ant-[0-9A-Za-z_-]{20,}/, /sk-[A-Za-z0-9]{32,}/,
    /gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{40,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  const skip = new Set([".git", "node_modules", "dist"]);
  const binary = /\.(png|jpe?g|gif|webp|ico|woff2?)$/i;
  const hits = [];
  (function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!ent.isFile() || binary.test(ent.name)) continue;
      // Read once and size-check the buffer (no stat-then-read race).
      const buf = readFileSync(p);
      if (buf.length > 2e6) continue;
      const text = buf.toString("utf8");
      for (const re of patterns) if (re.test(text)) hits.push(relative(root, p) + " ~ " + re);
    }
  })(root);
  assert.deepEqual(hits, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
