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
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const scripts = [...body.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
body = body.replace(/<script src="[^"]+"><\/script>\s*/g, "").trim();

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
