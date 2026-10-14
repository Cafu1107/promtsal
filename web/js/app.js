// Promtsal UI. Renders everything with textContent / DOM nodes (never innerHTML), so model output
// and stored data can't inject markup. Two builds share this file:
// - "web" (GitHub Pages): the visitor's own Gemini key, kept in this browser only.
// - "artifact" (claude.ai): Claude through the viewer's account; no key.
(function () {
  "use strict";
  const PS = window.PS;
  const E = PS.engine, P = PS.providers, t = PS.t;
  const BUILD = window.PS_BUILD === "artifact" ? "artifact" : "web";
  const MAX_CHARS = 40000;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------------------------------------------------------------------------
  // Storage (every access guarded: private windows and blocked storage throw)
  // ---------------------------------------------------------------------------
  const KEY = "promtsal:";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  // The API key: sessionStorage by default (gone when the tab closes), localStorage only when the
  // visitor ticks "remember". Kept in memory too, so it still works when storage is blocked.
  let memKey = "";
  const keyStore = {
    get() {
      try { return sessionStorage.getItem(KEY + "key") || localStorage.getItem(KEY + "key") || memKey; } catch (e) { return memKey; }
    },
    remembered() { try { return !!localStorage.getItem(KEY + "key"); } catch (e) { return false; } },
    set(v, remember) {
      memKey = v;
      try {
        if (remember) { localStorage.setItem(KEY + "key", v); sessionStorage.removeItem(KEY + "key"); }
        else { sessionStorage.setItem(KEY + "key", v); localStorage.removeItem(KEY + "key"); }
      } catch (e) { /* memory only */ }
    },
    clear() {
      memKey = "";
      try { sessionStorage.removeItem(KEY + "key"); localStorage.removeItem(KEY + "key"); } catch (e) { /* nothing stored */ }
    },
  };
  function wipeStorage() {
    keyStore.clear();
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(KEY)) localStorage.removeItem(k);
      }
    } catch (e) { /* storage unavailable */ }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const pick = (list, v, d) => (list.includes(v) ? v : d);
  const isModelId = (v) => typeof v === "string" && /^[\w.-]{1,80}$/.test(v);
  const navLang = (navigator.language || "tr").toLowerCase().startsWith("tr") ? "tr" : "en";

  const state = {
    ui: pick(["tr", "en"], store.get("ui"), navLang),
    mode: pick(E.MODES, store.get("mode"), "boost"),
    target: pick(E.TARGETS, store.get("target"), "general"),
    lang: pick(E.LANGS, store.get("lang"), "same"),
    models: {
      clean: isModelId(store.get("model.clean")) ? store.get("model.clean") : E.DEFAULT_MODELS.clean,
      boost: isModelId(store.get("model.boost")) ? store.get("model.boost") : E.DEFAULT_MODELS.boost,
    },
    modelList: null,
    rules: typeof store.get("rules") === "string" ? store.get("rules") : "",
    rulesOn: store.get("rulesOn") !== false,
    view: "prompt",
    current: null,
    ctl: null,
    asked: false,
    status: null,
    notice: "",
  };
  const ml = store.get("modelList");
  if (Array.isArray(ml)) state.modelList = ml.filter((m) => m && isModelId(m.id)).map((m) => ({ id: m.id, label: typeof m.label === "string" ? m.label : m.id }));

  const strArr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
  function cleanEntry(h) {
    if (!h || typeof h.input !== "string" || typeof h.prompt !== "string") return null;
    return {
      id: typeof h.id === "string" ? h.id : newId(),
      ts: Number.isFinite(h.ts) ? h.ts : 0,
      input: h.input,
      prompt: h.prompt,
      mode: pick(E.MODES, h.mode, "boost"),
      target: pick(E.TARGETS, h.target, "general"),
      lang: pick(E.LANGS, h.lang, "same"),
      changes: strArr(h.changes),
      questions: (Array.isArray(h.questions) ? h.questions : [])
        .filter((q) => q && typeof q.q === "string")
        .map((q) => ({ q: q.q, options: strArr(q.options), answer: typeof q.answer === "string" ? q.answer : "" })),
      answered: (Array.isArray(h.answered) ? h.answered : []).filter((a) => a && typeof a.q === "string" && typeof a.a === "string"),
      provider: h.provider === "claude" ? "claude" : h.provider === "gemini" ? "gemini" : "",
      model: isModelId(h.model) ? h.model : "",
      usage: h.usage && Number.isFinite(h.usage.input) ? { input: h.usage.input, output: h.usage.output || 0, thinking: h.usage.thinking || 0 } : null,
    };
  }
  let history = (Array.isArray(store.get("history")) ? store.get("history") : []).map(cleanEntry).filter(Boolean);
  let myTemplates = (Array.isArray(store.get("templates")) ? store.get("templates") : [])
    .filter((x) => x && typeof x.name === "string" && typeof x.text === "string")
    .map((x) => ({ id: typeof x.id === "string" ? x.id : newId(), name: x.name, text: x.text, target: pick(E.TARGETS, x.target, "general") }));

  function makeExample(lang) {
    const ex = JSON.parse(JSON.stringify(E.EXAMPLES[lang]));
    return Object.assign(ex, { example: true, exampleLang: lang, id: "example", ts: 0, answered: [], provider: "", model: "", usage: null });
  }

  // ---------------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------------
  const ui = {};
  for (const id of ["notice", "src", "lint", "srcCount", "srcNote", "srcNoteText", "undoBtn", "health", "healthScore", "healthBar",
    "healthList", "modeHint", "runBtn", "stopBtn", "provBtn", "estimate", "proof", "sampleBadge", "status", "out", "legend",
    "stats", "regenBtn", "copyBtn", "usage", "notes", "changesBox", "changes", "qBox", "qCount", "questions", "applyBtn",
    "hist", "histBtn", "histCount", "histClear", "histEmpty", "histList", "footText", "tplBtn", "setBtn",
    "setDlg", "keyInput", "keyShow", "keyRemember", "keySave", "keyClear", "keyStatus", "modelClean", "modelBoost", "modelsHint",
    "rulesInput", "rulesApply", "wipeBtn", "wipeStatus", "tplDlg", "tplBuiltin", "tplMine", "tplMineEmpty", "tplName", "tplSave", "tplStatus"]) {
    ui[id] = $(id);
  }

  // ---------------------------------------------------------------------------
  // Formatting and text
  // ---------------------------------------------------------------------------
  const fmtInt = (n) => new Intl.NumberFormat(state.ui === "tr" ? "tr-TR" : "en-US").format(n);
  const fmtUSD = (c) => "$" + (c < 0.01 ? c.toFixed(4) : c.toFixed(3));
  const modelFor = (mode) => state.models[mode] || E.DEFAULT_MODELS[mode];
  const currentRules = () => (state.rulesOn ? state.rules : "");

  function applyI18n() {
    PS.lang = state.ui;
    document.documentElement.lang = state.ui;
    for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
    for (const n of document.querySelectorAll("[data-i18n-ph]")) n.placeholder = t(n.dataset.i18nPh);
    for (const n of document.querySelectorAll("[data-i18n-aria]")) n.setAttribute("aria-label", t(n.dataset.i18nAria));
    const md = document.querySelector('meta[name="description"]');
    if (md) md.content = t("meta.description");
    ui.footText.textContent = t(BUILD === "artifact" ? "foot.claude" : "foot.web");
    ui.modelsHint.textContent = t("models.hint", { date: E.PRICES_CHECKED });
  }

  function setStatus(key, tone, vars) {
    state.status = key ? { key, tone: tone || "", vars: vars || null } : null;
    renderStatus();
  }
  function renderStatus() {
    const s = state.status;
    ui.status.textContent = s ? t(s.key, s.vars) : "";
    if (s && s.tone) ui.status.dataset.tone = s.tone; else delete ui.status.dataset.tone;
  }
  function showNotice(key) {
    state.notice = key;
    ui.notice.textContent = key ? t(key) : "";
    ui.notice.hidden = !key;
  }
  function fstatus(node, text, tone) {
    node.textContent = text || "";
    if (tone) node.dataset.tone = tone; else delete node.dataset.tone;
  }

  const CLAUDE_GONE = new Set(["sampling_disabled", "not_declared", "capability_removed", "capability_disabled"]);
  function errKey(code) {
    if (CLAUDE_GONE.has(code)) return "err.capability_disabled";
    const known = ["bad_key", "forbidden", "model_not_found", "bad_request", "rate_limited", "unavailable", "network", "refused",
      "empty_completion", "prompt_too_large", "not_granted", "session_expired"];
    return known.includes(code) ? "err." + code : "err.generic";
  }

  // ---------------------------------------------------------------------------
  // Segmented controls
  // ---------------------------------------------------------------------------
  const segSync = {};
  function bindSeg(key, list, onChange) {
    const group = document.querySelector('.seg[data-key="' + key + '"]');
    const sync = () => {
      for (const b of group.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.v === state[key]));
    };
    group.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !list.includes(b.dataset.v) || state[key] === b.dataset.v) return;
      state[key] = b.dataset.v;
      store.set(key, state[key]);
      sync();
      if (onChange) onChange();
    });
    segSync[key] = sync;
    sync();
  }

  // ---------------------------------------------------------------------------
  // Input: word count, health check with underlines, estimate
  // ---------------------------------------------------------------------------
  const updateSrcCount = () => { ui.srcCount.textContent = t("src.words", { n: fmtInt(E.words(ui.src.value)) }); };
  const updateModeHint = () => { ui.modeHint.textContent = t("hint." + state.mode); };

  function renderLint(text, marks) {
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const m of marks) {
      if (m.start < pos) continue;
      if (m.start > pos) frag.append(text.slice(pos, m.start));
      frag.append(el("mark", "m-" + m.type, text.slice(m.start, m.end)));
      pos = m.end;
    }
    frag.append(text.slice(pos) + "\n");
    ui.lint.replaceChildren(frag);
    ui.lint.scrollTop = ui.src.scrollTop;
  }

  function updateHealth() {
    const text = ui.src.value;
    const h = E.health(text, { target: state.target });
    renderLint(text, h.marks);
    ui.health.dataset.level = h.level;
    ui.healthBar.style.setProperty("--score", h.score == null ? 0 : h.score);
    if (h.score == null) {
      ui.healthScore.textContent = "";
      delete ui.healthScore.dataset.level;
      ui.healthList.replaceChildren(el("li", "plain", t("health.empty")));
      return;
    }
    ui.healthScore.dataset.level = h.level;
    ui.healthScore.textContent = h.score + "/100 · " + t("health." + h.level);
    if (!h.findings.length) {
      ui.healthList.replaceChildren(el("li", "plain", t("f.none")));
      return;
    }
    ui.healthList.replaceChildren(...h.findings.map((f) => {
      const li = el("li", "t-" + f.type);
      li.append(el("span", "k", f.type === "runon" ? t("f.runon", { n: f.longest }) : t("f." + f.type)));
      if (f.words && f.words.length) li.append(": " + f.words.join(", "));
      if (f.n > 1 && f.type !== "runon") li.append(" ×" + f.n);
      return li;
    }));
  }

  function updateEstimate() {
    const text = ui.src.value.trim();
    if (!text) { ui.estimate.textContent = ""; return; }
    const req = E.buildRequest({ input: text, mode: state.mode, target: state.target, lang: state.lang, uiLang: state.ui, rules: currentRules() });
    const inTok = Math.ceil(req.system.length / 4) + E.estimateTokens(req.user);
    const outTok = E.estimateOutput(E.estimateTokens(text), state.mode);
    let s = t("est.tokens", { in: fmtInt(inTok), out: fmtInt(outTok) });
    if (BUILD === "artifact") {
      s += " · " + t("est.claude");
    } else {
      const c = E.cost(modelFor(state.mode), inTok, outTok);
      s += " · " + (c == null ? t("est.unknownPrice") : t("est.cost", { cost: fmtUSD(c) }) + " · " + t("est.free"));
    }
    ui.estimate.textContent = s;
  }

  function updateProvider() {
    if (BUILD === "artifact") {
      ui.provBtn.textContent = t("prov.claude");
      ui.provBtn.classList.remove("need");
      return;
    }
    const has = !!keyStore.get();
    ui.provBtn.textContent = has ? t("prov.gemini", { model: modelFor(state.mode) }) : t("prov.needKey");
    ui.provBtn.classList.toggle("need", !has);
  }

  let healthTimer = 0, estTimer = 0, draftTimer = 0;
  function onSrcInput() {
    updateSrcCount();
    clearTimeout(healthTimer);
    healthTimer = setTimeout(updateHealth, 120);
    clearTimeout(estTimer);
    estTimer = setTimeout(updateEstimate, 250);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => store.set("draft", ui.src.value), 300);
  }
  ui.src.addEventListener("input", () => { ui.srcNote.hidden = true; onSrcInput(); });
  ui.src.addEventListener("scroll", () => { ui.lint.scrollTop = ui.src.scrollTop; });
  ui.src.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run("new"); }
  });

  // ---------------------------------------------------------------------------
  // Result rendering
  // ---------------------------------------------------------------------------
  function renderDiff(ops) {
    const frag = document.createDocumentFragment();
    let group = null, groupOp = null, lastWasNl = true, any = false;
    const flush = () => { if (group) frag.append(group); group = null; groupOp = null; };
    for (const [op, tok] of ops) {
      const nl = tok[0] === "\n";
      const space = any && !lastWasNl && !nl ? " " : "";
      if (op === "=") {
        flush();
        frag.append(space + tok);
      } else {
        if (groupOp !== op) {
          flush();
          if (space) frag.append(space);
          group = document.createElement(op === "-" ? "del" : "ins");
          groupOp = op;
        } else if (space) {
          group.append(space);
        }
        if (nl) {
          group.append(el("span", "pil", "¶"));
          if (op === "+") { flush(); frag.append(tok); }
        } else {
          group.append(tok);
        }
      }
      any = true;
      lastWasNl = nl && op !== "-";
    }
    flush();
    return frag;
  }

  function syncTabs() {
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.view === state.view));
  }
  function renderView() {
    const cur = state.current;
    syncTabs();
    ui.legend.hidden = true;
    ui.out.className = "out";
    if (!cur) { ui.out.className = "out empty"; ui.out.textContent = t("out.empty"); return; }
    if (state.view === "prompt") { ui.out.textContent = cur.prompt; return; }
    if (cur.lang !== "same") { ui.out.className = "out empty"; ui.out.textContent = t("diff.translated"); return; }
    const ops = E.diffTokens(cur.input, cur.prompt);
    if (!ops) { ui.out.className = "out empty"; ui.out.textContent = t("diff.tooLong"); return; }
    ui.out.replaceChildren(renderDiff(ops));
    ui.legend.hidden = false;
  }

  function render() {
    const cur = state.current;
    ui.sampleBadge.hidden = !(cur && cur.example);
    ui.regenBtn.hidden = !cur || !!cur.example;
    ui.copyBtn.disabled = !cur || !!state.ctl;
    renderView();
    if (!cur) {
      ui.stats.textContent = "";
      ui.usage.hidden = true;
      ui.notes.hidden = true;
      return;
    }
    const a = E.words(cur.input), b = E.words(cur.prompt);
    const parts = [t("stats.words", { a: fmtInt(a), b: fmtInt(b) })];
    if (a && b !== a && cur.lang === "same") {
      const p = Math.round(Math.abs(b - a) / a * 100);
      parts.push(t(b < a ? "stats.shorter" : "stats.longer", { p }));
    }
    parts.push(t("mode." + cur.mode), t("target." + cur.target));
    if (cur.lang !== "same") parts.push(t("lang." + cur.lang));
    if (cur.model) parts.push(cur.model);
    else if (cur.provider === "claude") parts.push("Claude");
    ui.stats.textContent = parts.join(" · ");

    if (cur.usage) {
      let s = t("usage.line", { in: fmtInt(cur.usage.input), out: fmtInt(cur.usage.output), th: fmtInt(cur.usage.thinking) });
      const c = cur.model ? E.cost(cur.model, cur.usage.input, cur.usage.output + cur.usage.thinking, new Date(cur.ts || Date.now())) : null;
      if (c != null) s += " · " + t("usage.cost", { cost: fmtUSD(c) });
      ui.usage.textContent = s;
      ui.usage.hidden = false;
    } else {
      ui.usage.hidden = true;
    }

    ui.changes.replaceChildren(...cur.changes.map((c) => el("li", null, c)));
    ui.changesBox.hidden = !cur.changes.length;
    renderQuestions(cur);
    ui.notes.hidden = !cur.changes.length && !cur.questions.length;
    for (const li of ui.histList.children) li.classList.toggle("active", li.dataset.id === cur.id);
  }

  let persistTimer = 0;
  const persistSoon = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => store.set("history", history), 300);
  };
  function updateApply() {
    const cur = state.current;
    ui.applyBtn.disabled = !!state.ctl || !cur || !cur.questions.some((q) => q.answer && q.answer.trim());
  }
  function renderQuestions(cur) {
    const qs = cur.questions;
    ui.qBox.hidden = !qs.length;
    ui.qCount.textContent = t("q.count", { n: qs.length });
    ui.questions.replaceChildren();
    qs.forEach((q, i) => {
      const box = el("div", "q");
      const id = "q-" + i;
      const lab = el("label", null, q.q);
      lab.htmlFor = id;
      const input = el("input");
      input.id = id;
      input.type = "text";
      input.autocomplete = "off";
      input.placeholder = t(q.options.length ? "q.pick" : "q.answer");
      input.value = q.answer || "";
      const chipEls = [];
      const syncChips = () => { for (const c of chipEls) c.setAttribute("aria-pressed", String(input.value === c.textContent)); };
      box.append(lab);
      if (q.options.length) {
        const chips = el("div", "chips");
        for (const o of q.options) {
          const c = el("button", "chip", o);
          c.type = "button";
          c.addEventListener("click", () => {
            input.value = input.value === o ? "" : o;
            q.answer = input.value;
            syncChips(); updateApply(); persistSoon();
          });
          chipEls.push(c);
          chips.append(c);
        }
        box.append(chips);
      }
      input.addEventListener("input", () => { q.answer = input.value; syncChips(); updateApply(); persistSoon(); });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !ui.applyBtn.disabled) run("refine"); });
      syncChips();
      box.append(input);
      ui.questions.append(box);
    });
    updateApply();
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  function saveHistory(entry) {
    history = [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, 40);
    store.set("history", history);
    renderHistory();
  }
  function renderHistory() {
    const fmt = new Intl.DateTimeFormat(state.ui === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    ui.histCount.textContent = String(history.length);
    ui.histEmpty.hidden = history.length > 0;
    ui.histClear.hidden = !history.length;
    ui.histList.replaceChildren();
    for (const h of history) {
      const li = el("li", "hist-item");
      li.dataset.id = h.id;
      if (state.current && state.current.id === h.id) li.classList.add("active");
      const open = el("button", "hist-open");
      open.type = "button";
      const meta = [h.ts ? fmt.format(h.ts) : "", t("mode." + h.mode), t("target." + h.target), h.model].filter(Boolean).join(" · ");
      open.append(el("span", "txt", h.input.replace(/\s+/g, " ").slice(0, 180)), el("span", "meta", meta));
      open.addEventListener("click", () => restore(h));
      const del = el("button", "hist-del", t("hist.del"));
      del.type = "button";
      del.setAttribute("aria-label", t("hist.delAria"));
      del.addEventListener("click", () => {
        history = history.filter((x) => x !== h);
        store.set("history", history);
        renderHistory();
      });
      li.append(open, del);
      ui.histList.append(li);
    }
  }
  function restore(h) {
    if (state.ctl) return;
    state.current = h;
    ui.src.value = h.input;
    store.set("draft", h.input);
    state.mode = h.mode; state.target = h.target; state.lang = h.lang;
    for (const k of ["mode", "target", "lang"]) { store.set(k, state[k]); segSync[k](); }
    state.view = "prompt";
    setStatus("");
    refreshAll();
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }
  ui.histBtn.addEventListener("click", () => {
    const opening = ui.hist.hidden;
    ui.hist.hidden = !opening;
    ui.histBtn.setAttribute("aria-expanded", String(opening));
    if (opening) ui.hist.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
  function armConfirm(btn, labelKey, confirmKey, action) {
    let armed = 0;
    btn.addEventListener("click", () => {
      if (!armed) {
        btn.textContent = t(confirmKey);
        armed = setTimeout(() => { armed = 0; btn.textContent = t(labelKey); }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      btn.textContent = t(labelKey);
      action();
    });
  }
  armConfirm(ui.histClear, "hist.clear", "hist.confirm", () => {
    history = [];
    store.set("history", history);
    renderHistory();
  });

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------
  function setBusy(on) {
    ui.runBtn.disabled = on;
    ui.runBtn.textContent = t(on ? "running" : "run");
    ui.stopBtn.hidden = !on;
    ui.regenBtn.disabled = on;
    ui.copyBtn.disabled = on || !state.current;
    updateApply();
  }

  async function run(kind) {
    if (state.ctl) return;
    const cur = state.current;
    if (kind !== "new" && !cur) return;
    const input = kind === "new" ? ui.src.value.trim() : cur.input;
    if (!input) { setStatus("st.needInput", "warn"); ui.src.focus(); return; }
    if (input.length > MAX_CHARS) { setStatus("st.tooLong", "warn"); return; }
    const key = BUILD === "web" ? keyStore.get() : "";
    if (BUILD === "web" && !key) { setStatus("st.needKey", "warn"); openSettings(true); return; }

    const settings = { mode: state.mode, target: state.target, lang: state.lang };
    let answered = [], prev = "";
    const open = [];
    if (kind !== "new") answered = (cur.answered || []).slice();
    if (kind === "refine") {
      for (const q of cur.questions) {
        if (q.answer && q.answer.trim()) answered.push({ q: q.q, a: q.answer.trim() });
        else open.push(q.q);
      }
      prev = cur.prompt;
    }
    const req = E.buildRequest({ input, ...settings, uiLang: state.ui, prev, answered, open, rules: currentRules() });
    const model = BUILD === "web" ? modelFor(settings.mode) : "";
    const entry = {
      id: kind !== "new" && !cur.example ? cur.id : newId(),
      ts: Date.now(), input, ...settings, prompt: "", changes: [], questions: [], answered,
      provider: BUILD === "web" ? "gemini" : "claude", model, usage: null,
    };

    const ctl = new AbortController();
    state.ctl = ctl;
    ui.srcNote.hidden = true;
    setBusy(true);
    setStatus(BUILD === "artifact" && !state.asked ? "st.asking" : "st.thinking", "busy");
    state.asked = true;
    if (window.innerWidth <= 900) ui.proof.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });

    let streaming = false;
    const onText = (txt) => {
      if (ctl.signal.aborted) return;
      const p = E.parse(txt, false);
      if (!p.prompt) return;
      if (!streaming) {
        streaming = true;
        setStatus("st.writing", "busy");
        state.view = "prompt";
        syncTabs();
        ui.sampleBadge.hidden = true;
        ui.notes.hidden = true;
        ui.legend.hidden = true;
        ui.usage.hidden = true;
        ui.stats.textContent = "";
        ui.out.className = "out";
      }
      ui.out.textContent = p.prompt;
    };

    try {
      const res = BUILD === "web"
        ? await P.geminiRun({ key, model, system: req.system, user: req.user, signal: ctl.signal, onText })
        : await P.claudeRun({ system: req.system, user: req.user, mode: settings.mode, signal: ctl.signal, onText, fresh: kind !== "new" });
      const p = E.parse(res.text, true);
      if (!p.prompt) throw { code: "empty_completion" };
      Object.assign(entry, { prompt: p.prompt, changes: p.changes, questions: p.questions, usage: res.usage || null });
      state.current = entry;
      state.view = "prompt";
      saveHistory(entry);
      setStatus(res.truncated ? "st.truncated" : "", res.truncated ? "warn" : "");
    } catch (e) {
      const code = e && e.code;
      if (code === "cancelled") setStatus("st.stopped", "");
      else setStatus(errKey(code), "error", { msg: String((e && e.message) || "").slice(0, 200) });
    } finally {
      state.ctl = null;
      setBusy(false);
      render();
      updateProvider();
    }
  }

  ui.runBtn.addEventListener("click", () => run("new"));
  ui.regenBtn.addEventListener("click", () => run("regen"));
  ui.applyBtn.addEventListener("click", () => run("refine"));
  ui.stopBtn.addEventListener("click", () => { if (state.ctl) state.ctl.abort(); });
  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      if (state.ctl) return;
      state.view = b.dataset.view;
      renderView();
    });
  }

  ui.copyBtn.addEventListener("click", () => {
    const text = state.current && state.current.prompt;
    if (!text) return;
    const fallback = () => {
      state.view = "prompt";
      renderView();
      const r = document.createRange();
      r.selectNodeContents(ui.out);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      setStatus("st.copyFallback", "warn");
    };
    try {
      navigator.clipboard.writeText(text).then(() => {
        ui.copyBtn.textContent = t("out.copied");
        setTimeout(() => { ui.copyBtn.textContent = t("out.copy"); }, 1600);
      }, fallback);
    } catch (e) { fallback(); }
  });

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------
  function showDialog(d) {
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); }
    else d.setAttribute("open", "");
  }
  function closeDialog(d) {
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
  }
  for (const d of [ui.setDlg, ui.tplDlg]) {
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-close]")) closeDialog(d);
    });
  }

  // Templates -----------------------------------------------------------------
  let undoState = null;
  function renderTemplates() {
    const item = (tpl, mine) => {
      const li = el("li", "tpl-item");
      const use = el("button", "tpl-use");
      use.type = "button";
      const name = el("span", "tpl-name", tpl.name);
      name.append(el("span", "tpl-tag", t("target." + tpl.target)));
      use.append(name, el("span", "tpl-prev", tpl.text));
      use.addEventListener("click", () => useTemplate(tpl));
      li.append(use);
      if (mine) {
        const del = el("button", "tpl-del", t("tpl.del"));
        del.type = "button";
        del.addEventListener("click", () => {
          myTemplates = myTemplates.filter((x) => x.id !== tpl.id);
          store.set("templates", myTemplates);
          renderTemplates();
        });
        li.append(del);
      }
      return li;
    };
    ui.tplBuiltin.replaceChildren(...E.TEMPLATES[state.ui].map((x) => item(x, false)));
    ui.tplMine.replaceChildren(...myTemplates.map((x) => item(x, true)));
    ui.tplMineEmpty.hidden = myTemplates.length > 0;
  }
  function useTemplate(tpl) {
    undoState = { text: ui.src.value, target: state.target };
    ui.src.value = tpl.text;
    if (state.target !== tpl.target) {
      state.target = tpl.target;
      store.set("target", state.target);
      segSync.target();
    }
    onSrcInput();
    ui.srcNoteText.textContent = t("src.templateLoaded");
    ui.srcNote.hidden = false;
    closeDialog(ui.tplDlg);
    ui.src.focus();
    const i = tpl.text.indexOf("["), j = tpl.text.indexOf("]", i);
    if (i >= 0 && j > i) ui.src.setSelectionRange(i, j + 1);
  }
  ui.undoBtn.addEventListener("click", () => {
    if (!undoState) return;
    ui.src.value = undoState.text;
    state.target = undoState.target;
    store.set("target", state.target);
    segSync.target();
    undoState = null;
    ui.srcNote.hidden = true;
    onSrcInput();
    ui.src.focus();
  });
  ui.tplBtn.addEventListener("click", () => {
    renderTemplates();
    fstatus(ui.tplStatus, "");
    showDialog(ui.tplDlg);
  });
  ui.tplSave.addEventListener("click", () => {
    const name = ui.tplName.value.trim();
    const text = ui.src.value.trim();
    if (!text) { fstatus(ui.tplStatus, t("tpl.needText"), "warn"); return; }
    if (!name) { fstatus(ui.tplStatus, t("tpl.needName"), "warn"); ui.tplName.focus(); return; }
    myTemplates = [{ id: newId(), name: name.slice(0, 60), text: text.slice(0, MAX_CHARS), target: state.target }, ...myTemplates].slice(0, 50);
    store.set("templates", myTemplates);
    ui.tplName.value = "";
    renderTemplates();
    fstatus(ui.tplStatus, t("tpl.saved"), "ok");
  });

  // Settings ------------------------------------------------------------------
  function fillModelSelects() {
    const seen = new Set();
    const list = [];
    const add = (id, label) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      list.push({ id, label: label || id });
    };
    if (state.modelList && state.modelList.length) state.modelList.forEach((m) => add(m.id, m.label));
    else Object.keys(E.PRICES).forEach((id) => add(id));
    add(state.models.clean);
    add(state.models.boost);
    for (const [sel, mode] of [[ui.modelClean, "clean"], [ui.modelBoost, "boost"]]) {
      sel.replaceChildren(...list.map((m) => {
        const o = el("option", null, m.label && m.label !== m.id ? m.label + " · " + m.id : m.id);
        o.value = m.id;
        return o;
      }));
      sel.value = modelFor(mode);
    }
  }
  function openSettings(focusKey) {
    ui.keyInput.value = keyStore.get();
    ui.keyInput.type = "password";
    ui.keyShow.textContent = t("key.show");
    ui.keyRemember.checked = keyStore.remembered();
    fstatus(ui.keyStatus, "");
    fstatus(ui.wipeStatus, "");
    ui.rulesInput.value = state.rules;
    ui.rulesApply.checked = state.rulesOn;
    fillModelSelects();
    showDialog(ui.setDlg);
    if (focusKey && BUILD === "web") ui.keyInput.focus();
  }
  ui.setBtn.addEventListener("click", () => openSettings(false));
  ui.provBtn.addEventListener("click", () => openSettings(BUILD === "web" && !keyStore.get()));

  ui.keyShow.addEventListener("click", () => {
    const show = ui.keyInput.type === "password";
    ui.keyInput.type = show ? "text" : "password";
    ui.keyShow.textContent = t(show ? "key.hide" : "key.show");
  });
  ui.keyRemember.addEventListener("change", () => {
    const k = keyStore.get();
    if (k) keyStore.set(k, ui.keyRemember.checked);
  });
  ui.keySave.addEventListener("click", async () => {
    const v = ui.keyInput.value.trim();
    if (!v) { fstatus(ui.keyStatus, t("key.empty"), "warn"); return; }
    ui.keySave.disabled = true;
    fstatus(ui.keyStatus, t("key.testing"));
    try {
      const models = await P.geminiModels(v);
      keyStore.set(v, ui.keyRemember.checked);
      state.modelList = models;
      store.set("modelList", models);
      fillModelSelects();
      fstatus(ui.keyStatus, t("key.ok", { n: models.length }), "ok");
      if (state.status && state.status.key === "st.needKey") setStatus("");
    } catch (e) {
      const code = e && e.code;
      if (code === "bad_key" || code === "forbidden") {
        fstatus(ui.keyStatus, t(errKey(code)), "error");
      } else {
        keyStore.set(v, ui.keyRemember.checked);
        fstatus(ui.keyStatus, t("key.savedOffline", { msg: t(errKey(code), { msg: (e && e.message) || "" }) }), "warn");
      }
    } finally {
      ui.keySave.disabled = false;
      updateProvider();
      updateEstimate();
    }
  });
  ui.keyClear.addEventListener("click", () => {
    keyStore.clear();
    ui.keyInput.value = "";
    fstatus(ui.keyStatus, t("key.cleared"), "ok");
    updateProvider();
  });
  for (const [sel, mode] of [[ui.modelClean, "clean"], [ui.modelBoost, "boost"]]) {
    sel.addEventListener("change", () => {
      if (!isModelId(sel.value)) return;
      state.models[mode] = sel.value;
      store.set("model." + mode, sel.value);
      updateProvider();
      updateEstimate();
    });
  }
  let rulesTimer = 0;
  ui.rulesInput.addEventListener("input", () => {
    state.rules = ui.rulesInput.value.slice(0, 2000);
    clearTimeout(rulesTimer);
    rulesTimer = setTimeout(() => { store.set("rules", state.rules); updateEstimate(); }, 300);
  });
  ui.rulesApply.addEventListener("change", () => {
    state.rulesOn = ui.rulesApply.checked;
    store.set("rulesOn", state.rulesOn);
    updateEstimate();
  });
  armConfirm(ui.wipeBtn, "data.wipe", "data.confirm", () => {
    wipeStorage();
    history = [];
    myTemplates = [];
    state.rules = "";
    state.rulesOn = true;
    state.modelList = null;
    state.models = { ...E.DEFAULT_MODELS };
    state.current = makeExample(state.ui);
    ui.src.value = state.current.input;
    ui.keyInput.value = "";
    ui.rulesInput.value = "";
    ui.rulesApply.checked = true;
    fillModelSelects();
    fstatus(ui.wipeStatus, t("data.wiped"), "ok");
    setStatus("st.example");
    refreshAll();
  });

  // ---------------------------------------------------------------------------
  // Interface language and start-up
  // ---------------------------------------------------------------------------
  function refreshInput() {
    updateSrcCount();
    updateHealth();
    updateEstimate();
  }
  function refreshAll() {
    updateModeHint();
    refreshInput();
    updateProvider();
    renderStatus();
    if (state.notice) showNotice(state.notice);
    renderHistory();
    render();
    setBusy(!!state.ctl);
  }
  function onUiLang() {
    applyI18n();
    if (state.current && state.current.example) {
      const showingExample = ui.src.value.trim() === E.EXAMPLES[state.current.exampleLang].input;
      state.current = makeExample(state.ui);
      if (showingExample) {
        ui.src.value = state.current.input;
        store.set("draft", ui.src.value);
      }
    }
    if (ui.tplDlg.open) renderTemplates();
    refreshAll();
  }

  for (const n of document.querySelectorAll("[data-build]")) n.hidden = n.dataset.build !== BUILD;
  bindSeg("mode", E.MODES, () => { updateModeHint(); updateEstimate(); updateProvider(); });
  bindSeg("target", E.TARGETS, () => { updateHealth(); updateEstimate(); });
  bindSeg("lang", E.LANGS, updateEstimate);
  bindSeg("ui", ["tr", "en"], onUiLang);
  applyI18n();

  const draft = store.get("draft");
  if (history.length) {
    state.current = history[0];
    ui.src.value = typeof draft === "string" ? draft : history[0].input;
  } else {
    state.current = makeExample(state.ui);
    ui.src.value = typeof draft === "string" && draft.trim() ? draft : state.current.input;
    setStatus("st.example");
  }
  refreshAll();

  if (BUILD === "artifact") {
    P.claudeSample().then((s) => { if (!s) showNotice("st.unavailable"); });
  }
})();
