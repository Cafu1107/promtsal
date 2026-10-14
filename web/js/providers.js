// Promtsal providers. Both return { text, truncated, usage } or throw { code, message, text? }.
// - Gemini: the visitor's own API key, sent from the browser straight to Google. No server in between.
// - Claude: only inside claude.ai, through the artifact runtime (the viewer's own Claude account).
(function (root) {
  "use strict";
  const PS = (root.PS = root.PS || {});
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
  const FETCH_OPTS = { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" };

  const fail = (code, message, text) => ({ code, message: message || "", text });

  async function errorFrom(res) {
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    const err = (body && body.error) || {};
    const msg = typeof err.message === "string" ? err.message : "";
    const status = err.status || "";
    if (res.status === 401 || status === "UNAUTHENTICATED" || (res.status === 400 && /api key/i.test(msg))) return fail("bad_key", msg);
    if (res.status === 403) return fail("forbidden", msg);
    if (res.status === 404) return fail("model_not_found", msg);
    if (res.status === 429) return fail("rate_limited", msg);
    if (res.status >= 500) return fail("unavailable", msg);
    if (res.status === 400) return fail("bad_request", msg);
    return fail("upstream_error", msg);
  }
  const netError = (e, text) => (e && e.name === "AbortError" ? fail("cancelled", "", text) : fail("network", e && e.message, text));

  const SKIP = /(tts|image|live|audio|embedding|aqa|robotics|computer-use|transcribe|translate|omni)/i;

  async function geminiModels(key, signal) {
    let res;
    try {
      res = await fetch(GEMINI + "/models?pageSize=1000", { ...FETCH_OPTS, signal, headers: { "x-goog-api-key": key } });
    } catch (e) { throw netError(e); }
    if (!res.ok) throw await errorFrom(res);
    const data = await res.json();
    return (data.models || [])
      .filter((m) => m && typeof m.name === "string" && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }))
      .filter((m) => /^gemini/i.test(m.id) && !SKIP.test(m.id));
  }

  const BLOCKED = /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION)$/;

  async function geminiRun({ key, model, system, user, signal, onText }) {
    let res;
    try {
      res = await fetch(GEMINI + "/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse", {
        ...FETCH_OPTS,
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
        }),
      });
    } catch (e) { throw netError(e); }
    if (!res.ok) throw await errorFrom(res);
    if (!res.body) throw fail("upstream_error", "empty body");

    let text = "", usage = null, finish = "", blocked = "", buf = "", data = [];
    const handle = (json) => {
      let c;
      try { c = JSON.parse(json); } catch (e) { return; }
      if (c.error) throw fail(c.error.code === 429 ? "rate_limited" : "upstream_error", c.error.message);
      if (c.promptFeedback && c.promptFeedback.blockReason) blocked = c.promptFeedback.blockReason;
      const cand = c.candidates && c.candidates[0];
      if (cand) {
        let added = false;
        for (const p of (cand.content && cand.content.parts) || []) {
          if (p && !p.thought && typeof p.text === "string" && p.text) { text += p.text; added = true; }
        }
        if (added && onText) onText(text);
        if (cand.finishReason) finish = cand.finishReason;
      }
      if (c.usageMetadata) usage = c.usageMetadata;
    };
    const flush = () => {
      if (!data.length) return;
      const json = data.join("\n");
      data = [];
      handle(json);
    };
    const eat = (line) => {
      line = line.replace(/\r$/, "");
      if (!line) flush();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    };

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        lines.forEach(eat);
      }
      buf += dec.decode();
      buf.split("\n").forEach(eat);
      flush();
    } catch (e) {
      if (e && e.code) { e.text = text; throw e; }
      throw netError(e, text);
    }

    if (blocked || BLOCKED.test(finish)) throw fail("refused", blocked || finish);
    if (!text.trim()) throw fail("empty_completion");
    return {
      text,
      truncated: finish === "MAX_TOKENS",
      usage: usage
        ? { input: usage.promptTokenCount || 0, output: usage.candidatesTokenCount || 0, thinking: usage.thoughtsTokenCount || 0 }
        : null,
    };
  }

  // claude.ai artifact runtime: `claude.use("sample")` resolves a function, or null where it cannot run.
  let samplePromise = null;
  function claudeSample() {
    if (!samplePromise) {
      const c = root.claude;
      samplePromise = c && typeof c.use === "function" ? c.use("sample").catch(() => null) : Promise.resolve(null);
    }
    return samplePromise;
  }

  async function claudeRun({ system, user, mode, signal, onText, fresh }) {
    const sample = await claudeSample();
    if (!sample) throw fail("capability_disabled");
    const opts = { signal, modelTier: mode === "clean" ? "quick" : "default", onText: (u) => onText && onText(u.text) };
    if (fresh) opts.cache = false;
    try {
      const r = await sample(system + "\n\n" + user, opts);
      return { text: r.text, truncated: !!r.truncated, usage: null };
    } catch (e) {
      throw fail((e && e.code) || "upstream_error", e && e.message, e && e.text);
    }
  }

  PS.providers = { geminiModels, geminiRun, claudeSample, claudeRun };
})(typeof window !== "undefined" ? window : globalThis);
