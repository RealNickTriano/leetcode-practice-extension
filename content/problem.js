// Runs on leetcode.com/problems/<slug>. Three jobs:
//   1. A floating pill: "+ Add to Leetcode Anki" when the problem isn't in the
//      deck, or a due-date badge (with remove) when it is.
//   2. Receive the Accepted verdict from content/netwatch.js (a MAIN-world
//      network watcher) over window.postMessage.
//   3. If the accepted problem is in the deck and due, show the Anki-style
//      rating overlay and write the grade back through SM-2.
(function () {
  const PILL_ID = "leetcode-anki-pill";
  const OVERLAY_ID = "leetcode-anki-overlay";
  const SETTLE_MS = 150;

  const { SM2, store, Selectors, api } = globalThis.LeetcodeAnki;

  const GRADE_LABELS = [
    ["again", "Again", "#ff6b66"],
    ["hard", "Hard", "#ffb800"],
    ["good", "Good", "#6ecf85"],
    ["easy", "Easy", "#5ab8ff"],
  ];

  const BASE_CSS = `
    .panel {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      background: #1c1a17;
      border: 1px solid #3a362f;
      border-radius: 8px;
      color: #e8e2d6;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.6);
    }
    button {
      font-family: inherit;
      cursor: pointer;
      border: none;
      background: none;
      color: inherit;
      padding: 0;
    }
  `;

  function slugFromPath() {
    const m = location.pathname.match(/^\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  // Builds the shadow host but does NOT attach it — placement is the
  // caller's job (the pill goes inline in the toolbar, the overlay on body).
  function makeHost(id, css) {
    document.getElementById(id)?.remove();
    const host = document.createElement("div");
    host.id = id;
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = BASE_CSS + css;
    root.append(style);
    return { host, root };
  }

  // ---------- problem metadata ----------

  async function fetchMeta(slug) {
    let meta = null;
    try {
      meta = await api.fetchQuestionMeta(slug);
    } catch {
      // request failed — the DOM scrape below covers a single add
    }
    if (!meta) return Selectors.metaFromDom(slug);
    const { paidOnly, ...rest } = meta;
    return rest;
  }

  // ---------- floating pill ----------

  const PILL_CSS = `
    :host { display: block; }
    :host([data-mode="inline"]) {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
      margin-left: 10px;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .bar.inline { font-size: 11px; }
    .bar.floating {
      position: fixed;
      right: 18px;
      top: 64px;
      z-index: 999999;
      font-size: 12px;
    }
    .panel {
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      font-size: inherit;
    }
    .bar.inline .panel {
      padding: 4px 10px;
      border-radius: 6px;
      box-shadow: none;
    }
    .bar.floating .panel { padding: 8px 14px; }
    button.add {
      color: #ffb858;
      font-weight: 600;
      font-size: inherit;
    }
    button.add:hover { color: #ffd49a; }
    .due-label { color: #8a8478; }
    .due-label b { color: #ffb858; font-weight: 600; }
    button.rate {
      color: #8a8478;
      font-weight: 600;
      font-size: inherit;
      white-space: nowrap;
      background: #1c1a17;
      border: 1px solid #3a362f;
      border-radius: 6px;
      padding: 4px 10px;
    }
    button.rate.cta { color: #ffb858; }
    button.rate .grade { color: var(--c, #ffb858); }
    .bar.floating button.rate { padding: 7px 12px; }
    button.rate:hover { border-color: var(--c, #5c5648); filter: brightness(1.15); }
    button.x {
      color: #5c5648;
      font-size: 13px;
      line-height: 1;
      padding: 0 0 0 4px;
    }
    button.x:hover { color: #ff6b66; }
    button.x.armed {
      color: #ff6b66;
      font-size: 10px;
      font-weight: 600;
    }
    [data-tip] { position: relative; }
    [data-tip]::after {
      content: attr(data-tip);
      position: absolute;
      bottom: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%) scale(0.96);
      background: #262320;
      border: 1px solid #3a362f;
      color: #e8e2d6;
      font: 500 11px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      padding: 6px 9px;
      border-radius: 5px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.12s, transform 0.12s;
      z-index: 50;
    }
    [data-tip]:hover::after {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }
  `;

  // Destructive buttons take two clicks: the first arms ("sure?"), the
  // second within 2.5s fires; otherwise the button disarms itself.
  function armable(btn, action) {
    const original = btn.textContent;
    let timer = null;
    btn.addEventListener("click", () => {
      if (!btn.classList.contains("armed")) {
        btn.classList.add("armed");
        btn.textContent = "sure?";
        timer = setTimeout(() => {
          btn.classList.remove("armed");
          btn.textContent = original;
        }, 2500);
        return;
      }
      clearTimeout(timer);
      action();
    });
  }

  let pillToken = 0;
  let pillMode = null;

  // Best available placement, in preference order: next to the problem title
  // in the description pane → after the toolbar's Run/Submit group → fixed
  // top-right. Returns { mode, anchor } (anchor null for floating).
  function pillPlacement(slug) {
    const title = Selectors.findTitleAnchor(slug);
    if (title) return { mode: "title", anchor: title };
    const toolbar = Selectors.findToolbarAnchor();
    if (toolbar) return { mode: "toolbar", anchor: toolbar };
    return { mode: "floating", anchor: null };
  }

  async function renderPill() {
    const token = ++pillToken;
    const slug = slugFromPath();
    if (!slug) {
      document.getElementById(PILL_ID)?.remove();
      return;
    }

    const { deck } = await store.load();
    if (token !== pillToken) return; // a newer render superseded this one

    const card = deck[slug];
    const { host, root } = makeHost(PILL_ID, PILL_CSS);
    const { mode, anchor } = pillPlacement(slug);
    pillMode = mode;
    const display = anchor ? "inline" : "floating";
    host.dataset.mode = display;
    const bar = document.createElement("div");
    bar.className = `bar ${display}`;
    const panel = document.createElement("div");
    panel.className = "panel";

    if (!card) {
      const add = document.createElement("button");
      add.className = "add";
      add.textContent = "+ Add to Leetcode Anki";
      add.addEventListener("click", async () => {
        add.disabled = true;
        add.textContent = "adding…";
        await store.addCard(slug, await fetchMeta(slug));
        renderPill();
      });
      panel.append(add);
      bar.append(panel);
    } else {
      const label = document.createElement("span");
      label.className = "due-label";
      const when = document.createElement("b");
      if (card.dueDate == null) {
        when.textContent = "new";
      } else {
        const overdue = SM2.daysBetween(card.dueDate, SM2.today());
        when.textContent =
          overdue > 0 ? `${overdue}d overdue`
          : overdue === 0 ? "due today"
          : `due in ${-overdue}d`;
      }
      label.append("in deck · ", when);

      const x = document.createElement("button");
      x.className = "x";
      x.textContent = "✕";
      x.dataset.tip = "Remove from deck";
      armable(x, async () => {
        await store.removeCard(slug);
        renderPill();
      });
      panel.append(label, x);

      // Standalone pill beside the deck box, so a rating is one click away
      // even when submission detection misses (and to re-rate a mistake).
      const rate = document.createElement("button");
      rate.className = "rate";
      const last = GRADE_LABELS.find(([g]) => g === card.lastGrade);
      if (last) {
        rate.style.setProperty("--c", last[2]);
        const grade = document.createElement("span");
        grade.className = "grade";
        grade.textContent = last[1];
        rate.append("Rated: ", grade);
      } else {
        rate.classList.add("cta");
        rate.textContent = "Rate";
      }
      rate.dataset.tip = last ? "Re-rate this problem" : "Rate this problem manually";
      rate.addEventListener("click", () => showOverlay(slug, card));
      bar.append(panel, rate);
    }

    root.append(bar);
    if (anchor && anchor.parentElement) {
      anchor.insertAdjacentElement("afterend", host);
    } else {
      document.body.append(host);
    }
  }

  // ---------- rating overlay ----------

  const OVERLAY_CSS = `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(12, 10, 8, 0.6);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fade 0.18s ease;
    }
    .panel {
      width: min(560px, 92vw);
      padding: 28px 28px 24px;
      border-radius: 12px;
      animation: pop 0.22s cubic-bezier(0.22, 1.4, 0.36, 1);
    }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: scale(0.92); } }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 22px;
    }
    .eyebrow {
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #ffb858;
      margin-bottom: 8px;
    }
    .q { font-size: 17px; font-weight: 500; color: #f2ecdf; }
    button.x { color: #5c5648; font-size: 16px; padding: 2px 4px; }
    button.x:hover { color: #e8e2d6; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    button.grade {
      border: 1px solid #3a362f;
      background: #262320;
      border-radius: 9px;
      padding: 16px 6px 14px;
      text-align: center;
      transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    button.grade:hover {
      transform: translateY(-3px);
      border-color: var(--c);
      box-shadow: 0 6px 18px -8px var(--c);
    }
    .k { display: block; font-size: 16px; font-weight: 600; color: var(--c); }
    .v { display: block; font-size: 11px; color: #8a8478; margin-top: 6px; }
    .toast {
      font-size: 16px;
      color: #9ecf85;
      text-align: center;
      padding: 18px 0;
    }
    @media (max-width: 480px) {
      .grid { grid-template-columns: repeat(2, 1fr); }
    }
  `;

  function onOverlayKey(e) {
    if (e.key === "Escape") removeOverlay();
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.removeEventListener("keydown", onOverlayKey, true);
  }

  function showOverlay(slug, card) {
    const { host, root } = makeHost(OVERLAY_ID, OVERLAY_CSS);
    document.body.append(host);
    document.addEventListener("keydown", onOverlayKey, true);

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) removeOverlay();
    });

    const panel = document.createElement("div");
    panel.className = "panel";

    const head = document.createElement("div");
    head.className = "head";
    const heading = document.createElement("div");
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = `Leetcode Anki · ${card.title || slug}`;
    const q = document.createElement("div");
    q.className = "q";
    q.textContent = "How did that recall feel?";
    heading.append(eyebrow, q);
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "✕";
    x.addEventListener("click", removeOverlay);
    head.append(heading, x);

    const grid = document.createElement("div");
    grid.className = "grid";
    // Preview each grade off the same basis store.rateCard will use, so a
    // correction (re-rating a not-yet-due card) shows the interval it actually
    // produces, not one compounded onto the prior rating.
    const { base, date } = SM2.reviewBasis(card);
    for (const [grade, label, color] of GRADE_LABELS) {
      const days = SM2.rate(base, grade, date).intervalDays;
      const btn = document.createElement("button");
      btn.className = "grade";
      btn.style.setProperty("--c", color);
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = label;
      const v = document.createElement("span");
      v.className = "v";
      v.textContent = `${days} day${days === 1 ? "" : "s"}`;
      btn.append(k, v);
      btn.addEventListener("click", async () => {
        const updated = await store.rateCard(slug, grade);
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = `✓ next review in ${updated.intervalDays}d — ${updated.dueDate}`;
        panel.replaceChildren(toast);
        setTimeout(removeOverlay, 2500);
        renderPill();
      });
      grid.append(btn);
    }

    panel.append(head, grid);
    backdrop.append(panel);
    root.append(backdrop);
  }

  // ---------- editor code reset ----------

  // When you open a deck card for review, the editor is reset to the blank
  // template via LeetCode's own toolbar reset button (plus the Confirm in
  // the dialog it opens) — real recall, Anki-style, no peeking at your old
  // solution.
  //
  // Guard rails: only deck cards that are actually reviewable (due today,
  // overdue, or in the new queue), and at most once per problem per day —
  // so navigating away and back mid-solve never wipes work in progress.
  let pendingResetSlug = null;

  function resetMarkerKey(slug) {
    return `leetcode-anki-reset:${slug}`;
  }

  async function queueDraftReset(slug) {
    try {
      if (localStorage.getItem(resetMarkerKey(slug)) === SM2.today()) return;
      const { deck, settings } = await store.load();
      const card = deck[slug];
      const reviewable = card && (card.dueDate == null || card.dueDate <= SM2.today());
      if (!reviewable || settings.resetCode === false) return;
      pendingResetSlug = slug;
    } catch {
      // storage unavailable — skip
    }
  }

  // Runs on every DOM settle until the editor toolbar exists (it mounts
  // well after navigation), then clicks reset and confirms the dialog.
  function attemptDraftReset() {
    const slug = slugFromPath();
    if (!pendingResetSlug || pendingResetSlug !== slug) return;
    const resetBtn = Selectors.findEditorResetButton();
    if (!resetBtn) return; // editor not mounted yet — retry next settle

    pendingResetSlug = null;
    resetBtn.click();

    let tries = 0;
    const timer = setInterval(() => {
      const confirm = Selectors.findDialogConfirmButton();
      if (confirm) confirm.click();
      // Stop once confirmed, or after ~3s if no dialog ever appeared
      // (LeetCode skips it when the editor is already pristine).
      if (confirm || ++tries > 20) {
        clearInterval(timer);
        try {
          localStorage.setItem(resetMarkerKey(slug), SM2.today());
        } catch {
          // marker is best-effort
        }
      }
    }, 150);
  }

  // ---------- accepted detection ----------

  // The verdict comes from content/netwatch.js, which wraps the page's fetch/
  // XHR in the MAIN world and postMessages the result of each finished
  // submission across the world boundary. That's unambiguous — it's *this*
  // submission's verdict, never an old "Accepted" row in the history table —
  // and fires exactly once per submission, so all this side has to do is gate
  // it on the deck/due state. Every accepted submission gets its own prompt:
  // closing the overlay without rating and submitting again re-prompts (a card
  // stays promptable until it's actually rated, which schedules it forward).
  async function maybePrompt(slug) {
    // Only for the problem currently open: a verdict that lands after you've
    // navigated to a different problem must not prompt for the old one.
    if (!slug || slug !== slugFromPath()) return;
    const { deck } = await store.load();
    const card = deck[slug];
    // Prompt for due reviews and for new-queue cards (solving a new card is
    // its introduction, whenever it happens); skip future-scheduled ones.
    if (!card || (card.dueDate != null && card.dueDate > SM2.today())) return;
    showOverlay(slug, card);
  }

  // Off in prod; enable with localStorage.setItem("leetcode-anki:debug", "1")
  // (the same key turns on content/netwatch.js — shared localStorage).
  const DEBUG = (() => {
    try {
      return localStorage.getItem("leetcode-anki:debug") === "1";
    } catch {
      return false;
    }
  })();

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== "leetcode-anki" || d.kind !== "verdict") return;
    if (DEBUG) console.log("[la problem] verdict received →", d.status, "slug", d.slug);
    if (d.status === "Accepted") maybePrompt(d.slug);
  });

  // ---------- wiring ----------

  let settleTimer = null;
  let lastUrl = location.href;
  let lastSlug = slugFromPath();

  function onSettle() {
    const slug = slugFromPath();
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (slug !== lastSlug) {
        lastSlug = slug;
        removeOverlay();
        renderPill();
        if (slug) queueDraftReset(slug);
      }
    }
    if (slug) {
      // Re-assert the pill if React re-rendered its container and dropped
      // it, and relocate it whenever a better anchor appears (the title
      // renders late, or comes back when switching tabs).
      if (
        !document.getElementById(PILL_ID) ||
        pillPlacement(slug).mode !== pillMode
      ) {
        renderPill();
      }
      attemptDraftReset();
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(onSettle, SETTLE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  store.onChange(() => renderPill());
  renderPill();
  if (lastSlug) queueDraftReset(lastSlug);
})();
