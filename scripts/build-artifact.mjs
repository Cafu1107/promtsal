// Builds the single-file claude.ai artifact version of Promtsal from web/.
// Usage: node scripts/build-artifact.mjs  ->  dist/promtsal.html
// The artifact uses Claude through the viewer's claude.ai account (the `sample` capability),
// so the Gemini key settings are hidden there. Fonts are embedded as data URIs: the artifact is one
// file and loads nothing from third parties.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = (p) => join(root, "web", p);
const html = readFileSync(web("index.html"), "utf8");

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
let body = html.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i)[1];
// External script tags in any case/quoting; whatever is left afterwards must contain no script at all.
const SCRIPT_TAG = /<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)["']?[^>]*>\s*<\/script\b[^>]*>/gi;
const scripts = [...body.matchAll(SCRIPT_TAG)].map((m) => m[1]);
// Strip until nothing changes, then fail closed if any script tag survived.
for (let prev = ""; prev !== body; ) {
  prev = body;
  body = body.replace(SCRIPT_TAG, "");
}
body = body.trim();
if (/<\/?script\b/i.test(body)) throw new Error("index.html has a script tag the build can't inline.");
for (const src of scripts) if (!/^[\w./-]+\.js$/.test(src) || src.includes("..")) throw new Error("Unexpected script path: " + src);

const fonts = readFileSync(web("fonts/fonts.css"), "utf8").replace(/url\(([\w.-]+\.woff2)\)/g, (m, file) =>
  `url(data:font/woff2;base64,${readFileSync(web("fonts/" + file)).toString("base64")})`);
const css = readFileSync(web("app.css"), "utf8");
const js = scripts.map((src) => `// ---- ${src} ----\n` + readFileSync(web(src), "utf8")).join("\n");
if (/<\/script/i.test(js)) throw new Error("A script contains '</script', which would end the inline block early.");
if (/<\/style/i.test(fonts + css)) throw new Error("A stylesheet contains '</style'.");

const out = `${title}
<style>
${fonts}
${css}
</style>
${body}
<script>
window.PS_BUILD = "artifact";
${js}
</script>
`;

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "promtsal.html"), out);
console.log(`dist/promtsal.html  ${(out.length / 1024).toFixed(1)} KB  (${scripts.length} scripts and fonts inlined)`);
