# Contributing

Thanks for helping. Promtsal is plain HTML, CSS and JavaScript with no dependencies and no build step for the site.

## Run it locally

```bash
cd web
python -m http.server 8000   # or: npx serve .
```

Open http://localhost:8000 and enter a Gemini API key in Settings.

## Before you open a pull request

```bash
node scripts/check.mjs          # tests, i18n parity, CSP rules, secret scan
node scripts/build-artifact.mjs # the claude.ai single-file build still works
```

## Ground rules

- **Never render HTML from strings.** Use `textContent` and DOM nodes. `innerHTML`, `eval` and inline scripts are blocked by the CSP and by the checks.
- **Every interface string goes in `web/js/i18n.js`** in both `tr` and `en`.
- **Don't add network destinations** without a good reason; each one needs a CSP change and a note in `SECURITY.md`.
- **The model must not invent facts.** Changes to the instructions in `web/js/engine.js` should keep the "ask instead of guessing" rule.

## Project layout

| Path | What it is |
| --- | --- |
| `web/index.html` | Page markup and CSP |
| `web/app.css` | Styles (light and dark) |
| `web/js/i18n.js` | Turkish and English strings |
| `web/js/engine.js` | Model instructions, reply parsing, diff, health check, prices, templates |
| `web/js/providers.js` | Gemini (browser to Google) and Claude (claude.ai artifact) calls |
| `web/js/app.js` | Interface |
| `scripts/check.mjs` | Tests and security checks |
| `scripts/build-artifact.mjs` | Builds `dist/promtsal.html` for claude.ai |
