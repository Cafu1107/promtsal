# Security

## How Promtsal handles your API key

Promtsal is a static site with no server of its own.

- Your Gemini API key is sent only to `generativelanguage.googleapis.com`, straight from your browser, in the `x-goog-api-key` header.
- By default the key lives in `sessionStorage` and is gone when you close the tab. It goes to `localStorage` only if you tick **Remember on this device**. **Delete key** and **Delete all local data** in Settings remove it.
- A Content Security Policy blocks every other network destination, all inline and third-party scripts, and `eval`. Trusted Types are enforced, and the code never uses `innerHTML`, so model output and stored data are rendered as text and can't run scripts.
- No analytics, no cookies, no tracking. The only third party loaded is Google Fonts.

The checks in `scripts/check.mjs` enforce the CSP rules, the absence of `innerHTML`/`eval`, and scan the repository for committed keys. CI runs them before every deploy.

## Recommendations for users

- Create a key in [Google AI Studio](https://aistudio.google.com/apikey) just for Promtsal.
- In Google Cloud Console, add a **Websites** restriction to the key so it only works on `https://cafu1107.github.io/*`.
- On the free tier, Google may use what you send to improve its products. Don't send passwords, personal data or secrets.

## Reporting a vulnerability

Please report security problems privately through [GitHub's private vulnerability reporting](https://github.com/Cafu1107/promtsal/security/advisories/new) rather than a public issue. I'll reply as soon as I can.
