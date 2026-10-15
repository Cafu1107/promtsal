# Security

## How Promtsal handles your API key

Promtsal is a static site with no server of its own.

- Your Gemini API key is sent only to `generativelanguage.googleapis.com`, straight from your browser, in the `x-goog-api-key` header. It never goes in a URL, and requests carry no cookies.
- By default the key lives in `sessionStorage` and is gone when you close the tab. It goes to `localStorage` only if you tick **Remember on this device**. **Delete key** and **Delete all local data** in Settings remove it. Text that doesn't look like a key (spaces, line breaks, wrong length) is rejected before it is stored.
- When the Settings dialog closes, the key is cleared from the page's input field.
- Requests to Google send only the site's origin (`https://cafu1107.github.io/`) as `Referer`, never the page path. Google needs it to honour a key's **Websites** restriction.
- Each answer is capped at 16,384 output tokens so a runaway reply can't run up a bill on a paid key.

## How the page protects itself

- **No third parties.** Fonts are self-hosted. The only other host the page can reach is the Gemini API. No analytics, no cookies, no tracking.
- **Content Security Policy** (meta tag): `default-src 'none'`; scripts, styles and fonts only from the site itself; `connect-src` only the Gemini API; no inline scripts, no `eval`, `base-uri`/`form-action`/`object-src` set to `'none'`.
- **Trusted Types** are required and no policy may be created (`trusted-types 'none'`). The code never uses `innerHTML`; model output and stored data are rendered as text and can't run scripts.
- **Clickjacking guard.** GitHub Pages can't send `X-Frame-Options` or `frame-ancestors`, so the page refuses to run inside another site's frame and offers a link to open it in its own tab.
- **History is optional.** Prompts can be sensitive. Turning off **Keep history and the draft** deletes what is stored and stops saving.

## How the repository is protected

- `scripts/check.mjs` enforces all of the above (CSP rules, no `innerHTML`/`eval`, header-only key, origin-only Referer, key format, frame guard, SHA-pinned actions) and scans the repository for committed keys. CI runs it before every deploy.
- GitHub Actions are pinned to full commit SHAs, workflow tokens are read-only by default, and only the deploy job may write to Pages. Dependabot proposes action updates.
- Secret scanning with push protection, CodeQL code scanning and Dependabot alerts are on. The `main` branch can't be force-pushed or deleted.

## Recommendations for users

- Create a key in [Google AI Studio](https://aistudio.google.com/apikey) just for Promtsal.
- In Google Cloud Console, add a **Websites** restriction to the key so it only works on `https://cafu1107.github.io/*`.
- On the free tier, Google may use what you send to improve its products. Don't send passwords, personal data or secrets.

## Reporting a vulnerability

Please report security problems privately through [GitHub's private vulnerability reporting](https://github.com/Cafu1107/promtsal/security/advisories/new) rather than a public issue. I'll reply as soon as I can.
