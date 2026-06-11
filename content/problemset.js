// Injects the "Due Today" review card above the problem list on
// leetcode.com/problemset/. Handles late rendering and SPA navigation by
// watching the DOM rather than trusting document_idle.
(function () {
  const CARD_ID = "leetcode-anki-root";
  const SETTLE_MS = 150;

  const { SM2, Select, store, api, Lists } = globalThis.LeetcodeAnki;

  function onProblemsetPage() {
    return location.pathname.startsWith("/problemset");
  }

  // The problem list has no stable class names, so anchor on structure: it is
  // the deepest container holding most of the page's /problems/ links.
  function findProblemList() {
    const anchors = [...document.querySelectorAll('a[href^="/problems/"]')].filter((a) => {
      if (a.closest("nav") !== null) return false;
      // The daily-challenge calendar links every day of the month to
      // /problems/<slug>?envType=daily-question. If the calendar renders
      // before the table, those links would win the vote — exclude them.
      if (a.href.includes("envType=daily-question")) return false;
      return true;
    });
    if (anchors.length < 5) return null;

    const counts = new Map();
    for (const a of anchors) {
      let el = a.parentElement;
      for (let depth = 0; el && el !== document.body && depth < 8; depth++) {
        counts.set(el, (counts.get(el) || 0) + 1);
        el = el.parentElement;
      }
    }

    let best = null;
    const threshold = anchors.length * 0.6;
    for (const [el, count] of counts) {
      if (count >= threshold && (best === null || best.contains(el))) {
        best = el;
      }
    }

    // Sanity check: the real list shows difficulty labels on its rows; the
    // calendar and sidebar widgets don't. If the winner doesn't look like
    // the list, report nothing and let the observer try again post-render.
    if (best) {
      const labels = best.textContent.match(/Easy|Med\.|Medium|Hard/g);
      if (!labels || labels.length < 3) return null;
    }
    return best;
  }

  function difficultyColor(difficulty) {
    return { Easy: "#2db55d", Medium: "#ffb800", Hard: "#ff6b66" }[difficulty] || "#ffb800";
  }

  const CARD_CSS = `
    :host { display: block; margin: 0 0 16px; }
    .card {
      display: block;
      text-decoration: none;
      position: relative;
      border: 1px solid rgba(232, 147, 12, 0.55);
      background: linear-gradient(135deg, rgba(232,147,12,0.13), rgba(232,147,12,0.04) 60%);
      border-radius: 8px;
      padding: 16px 18px 14px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      transition: box-shadow 0.25s, border-color 0.25s;
    }
    a.card:hover {
      border-color: rgba(232, 147, 12, 0.9);
      box-shadow: 0 0 26px -4px rgba(232, 147, 12, 0.35);
    }
    .card.quiet {
      border-color: rgba(138, 132, 120, 0.4);
      background: rgba(138, 132, 120, 0.06);
      padding: 12px 18px;
    }
    .tag {
      position: absolute;
      top: -10px; left: 14px;
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      background: #e8930c;
      color: #1c1208;
      padding: 3px 10px;
      border-radius: 3px;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .title { font-size: 14.5px; font-weight: 500; color: #f2ecdf; }
    .num { color: #8a8478; }
    .meta { display: flex; align-items: center; gap: 12px; font-size: 10.5px; }
    .diff { font-weight: 600; }
    .due { color: #8a8478; }
    .due b { color: #ffb858; font-weight: 600; }
    .sub { margin-top: 9px; font-size: 10.5px; color: #8a8478; }
    .chip {
      display: inline-block;
      border: 1px solid #3a362f;
      border-radius: 99px;
      padding: 1px 9px;
      margin-right: 6px;
      color: #b5ad9d;
    }
    .msg { font-size: 12px; color: #8a8478; }
    .msg b { color: #b5ad9d; font-weight: 600; }
    .actions { margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
    button.act {
      font-family: inherit;
      cursor: pointer;
      background: rgba(232, 147, 12, 0.15);
      border: 1px solid rgba(232, 147, 12, 0.5);
      color: #ffb858;
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
    }
    button.act:hover { background: rgba(232, 147, 12, 0.28); }
    button.act:disabled { opacity: 0.6; cursor: default; }
    button.act.ghost {
      background: none;
      border-color: #3a362f;
      color: #b5ad9d;
    }
    button.act.ghost:hover { border-color: #8a8478; }
    @media (prefers-color-scheme: light) {
      .title { color: #2a2417; }
      .num, .due, .sub, .msg { color: #8c8270; }
      .due b { color: #b86f03; }
      .msg b { color: #5b5344; }
      .chip { border-color: #d8d0bf; color: #5b5344; }
    }
  `;

  function makeHost() {
    const host = document.createElement("div");
    host.id = CARD_ID;
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CARD_CSS;
    root.append(style);
    return { host, root };
  }

  function buildReviewCard(pick, isNew = false) {
    const { host, root } = makeHost();

    const link = document.createElement("a");
    link.className = "card";
    link.href = `/problems/${pick.slug}/`;

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = isNew ? "Leetcode Anki · New Problem" : "Leetcode Anki · Due Today";

    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("span");
    title.className = "title";
    if (pick.questionId) {
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = `${pick.questionId}. `;
      title.append(num);
    }
    title.append(pick.title || pick.slug);

    const meta = document.createElement("span");
    meta.className = "meta";
    const diff = document.createElement("span");
    diff.className = "diff";
    diff.style.color = difficultyColor(pick.difficulty);
    diff.textContent = pick.difficulty || "";
    const due = document.createElement("span");
    due.className = "due";
    if (isNew) {
      const when = document.createElement("b");
      when.textContent = "new";
      due.append(when, " · first attempt");
    } else {
      const overdue = SM2.daysBetween(pick.dueDate, SM2.today());
      const when = document.createElement("b");
      when.textContent = overdue > 0 ? `${overdue}d overdue` : "today";
      due.append("due ", when, ` · interval ${pick.intervalDays}d`);
    }
    meta.append(diff, due);

    row.append(title, meta);

    const sub = document.createElement("div");
    sub.className = "sub";
    for (const t of pick.tags || []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      sub.append(chip);
    }
    sub.append(
      pick.reps === 0
        ? " new card — first review"
        : ` ${pick.reps} review${pick.reps === 1 ? "" : "s"} · last rated ${pick.lastGrade || "—"}`
    );

    link.append(tag, row, sub);
    root.append(link);
    return host;
  }

  function buildMessageCard(strong, rest) {
    const { host, root } = makeHost();
    const card = document.createElement("div");
    card.className = "card quiet";
    const msg = document.createElement("div");
    msg.className = "msg";
    const b = document.createElement("b");
    b.textContent = `Leetcode Anki — ${strong}`;
    msg.append(b, ` ${rest}`);
    card.append(msg);
    root.append(card);
    return { host, card };
  }

  function buildOnboardingCard(settings, deckName) {
    const { host, card } = buildMessageCard(
      `deck “${deckName}” is empty.`,
      "Import your LeetCode solve history, or start a curated list from problem one."
    );

    const actions = document.createElement("div");
    actions.className = "actions";
    const setAllDisabled = (disabled) => {
      for (const b of actions.querySelectorAll("button")) b.disabled = disabled;
    };

    const importBtn = document.createElement("button");
    importBtn.className = "act";
    importBtn.textContent = "Import my solved problems";
    importBtn.addEventListener("click", async () => {
      setAllDisabled(true);
      importBtn.textContent = "importing…";
      try {
        const solved = await api.fetchSolvedQuestions();
        const added = await store.seedCards(solved);
        // added > 0 triggers store.onChange, which re-renders this card.
        if (added === 0) importBtn.textContent = "no solved problems found";
      } catch (e) {
        importBtn.textContent =
          e.message === "not-signed-in" ? "sign in to LeetCode first" : "import failed — try again";
        setAllDisabled(false);
      }
    });
    actions.append(importBtn);

    // One "add the whole list" button per bundled source list.
    for (const [key, source] of Object.entries(Lists)) {
      const btn = document.createElement("button");
      btn.className = "act ghost";
      btn.textContent = `Add ${source.name} · ${source.slugs.length} problems`;
      btn.addEventListener("click", async () => {
        setAllDisabled(true);
        try {
          const { deck, deckId, deckName } = await store.load();
          const unseen = source.slugs.filter((s) => !deck[s]);
          btn.textContent = `fetching 0/${unseen.length}…`;
          const entries = await api.fetchQuestionMetas(unseen, {
            onProgress: (done, total) => {
              btn.textContent = `fetching ${done}/${total}…`;
            },
          });
          if (entries.length === 0) throw new Error("empty");
          // The whole list joins the deck's new queue in study order; the
          // picker promotes one per day. The deck takes the list's name
          // unless the user named it themselves.
          if (deckName === "Default") await store.renameDeck(deckId, source.name);
          await store.seedCards(entries); // onChange re-renders this card
        } catch {
          btn.textContent = "couldn't reach LeetCode — try again";
          setAllDisabled(false);
        }
      });
      actions.append(btn);
    }

    card.append(actions);
    return host;
  }

  // ---------- per-row "+" buttons ----------

  // These live inside LeetCode's own rows (light DOM), so they're styled by
  // a namespaced page-level stylesheet instead of a shadow root.
  const ROW_STYLE_ID = "leetcode-anki-row-style";
  const ROW_BTN_CLASS = "leetcode-anki-add";

  function ensureRowStyle() {
    if (document.getElementById(ROW_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ROW_STYLE_ID;
    style.textContent = `
      .${ROW_BTN_CLASS} {
        flex: 0 0 auto;
        align-self: center;
        width: 20px;
        height: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 10px;
        border-radius: 5px;
        border: 1px solid rgba(232, 147, 12, 0.5);
        background: rgba(232, 147, 12, 0.12);
        color: #e8930c;
        font: 600 13px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        opacity: 0;
        transition: opacity 0.12s, background 0.12s;
        cursor: pointer;
        z-index: 5;
      }
      /* Fallback when a row has no acceptance cell: overlay inside the row,
         clear of LeetCode's hover-revealed favorite star at the right edge. */
      .${ROW_BTN_CLASS}--abs {
        position: absolute;
        right: 44px;
        top: 50%;
        transform: translateY(-50%);
        margin: 0;
      }
      a:hover .${ROW_BTN_CLASS}, .${ROW_BTN_CLASS}.busy { opacity: 1; }
      .${ROW_BTN_CLASS} { position: relative; }
      .${ROW_BTN_CLASS}::after {
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
      .${ROW_BTN_CLASS}:hover::after {
        opacity: 1;
        transform: translateX(-50%) scale(1);
      }
      .${ROW_BTN_CLASS}:hover { background: rgba(232, 147, 12, 0.28); }
      .${ROW_BTN_CLASS}.in-deck {
        border-color: transparent;
        background: transparent;
        cursor: default;
      }
      .${ROW_BTN_CLASS} img {
        display: block;
        width: 16px;
        height: 16px;
        border-radius: 4px;
      }
    `;
    document.head.append(style);
  }

  // Guard every write: an unconditional content set on each settle would
  // itself mutate the DOM and ping the observer forever, so bail when the
  // button is already in the requested state.
  function setRowButtonState(btn, inDeck) {
    if (btn.classList.contains("busy")) return;
    const state = inDeck ? "in-deck" : "add";
    if (btn.dataset.state === state) return;
    btn.dataset.state = state;
    btn.classList.toggle("in-deck", inDeck);
    btn.dataset.tip = inDeck ? "In deck" : "Add to deck";
    if (inDeck) {
      const img = document.createElement("img");
      img.src = chrome.runtime.getURL("icons/icon32.png");
      img.alt = "";
      btn.replaceChildren(img);
    } else {
      btn.textContent = "+";
    }
  }

  // The acceptance-rate cell: a leaf reading "NN.N%". It is itself a flex
  // item on the row's inner horizontal line (the row anchor is a flex
  // *column*, so climbing toward the row would land above the line — the
  // button must slot in directly before this element).
  function findAcceptanceCell(row) {
    for (const el of row.querySelectorAll("div, span")) {
      if (el.childElementCount === 0 && /^\d{1,3}(\.\d+)?%$/.test(el.textContent.trim())) {
        return el;
      }
    }
    return null;
  }

  async function metaForAdd(slug) {
    const meta = await api.fetchQuestionMeta(slug);
    if (!meta) return { title: slug, questionId: null, difficulty: "", tags: [] };
    const { paidOnly, ...rest } = meta;
    return rest;
  }

  async function decorateRows() {
    if (!onProblemsetPage()) return;
    const list = findProblemList();
    if (!list) return;
    const { deck } = await store.load();
    ensureRowStyle();

    for (const row of list.querySelectorAll('a[href^="/problems/"]')) {
      if (row.href.includes("envType=daily-question")) continue;
      const m = new URL(row.href).pathname.match(/^\/problems\/([^/]+)/);
      if (!m) continue;
      const slug = m[1];

      let btn = row.querySelector(`.${ROW_BTN_CLASS}`);
      if (!btn) {
        btn = document.createElement("span");
        btn.className = ROW_BTN_CLASS;
        btn.setAttribute("role", "button");
        btn.addEventListener("click", async (e) => {
          // The whole row is a link — keep the click from navigating.
          e.preventDefault();
          e.stopPropagation();
          if (btn.classList.contains("in-deck") || btn.classList.contains("busy")) return;
          btn.classList.add("busy");
          delete btn.dataset.state; // force a re-render after the busy text
          btn.textContent = "…";
          await store.addCard(slug, await metaForAdd(slug));
          btn.classList.remove("busy");
          setRowButtonState(btn, true);
        });
        const cell = findAcceptanceCell(row);
        if (cell) {
          cell.before(btn);
        } else {
          if (getComputedStyle(row).position === "static") row.style.position = "relative";
          btn.classList.add(`${ROW_BTN_CLASS}--abs`);
          row.append(btn);
        }
      }
      setRowButtonState(btn, deck[slug] != null);
    }
  }

  let injecting = false;

  async function inject() {
    if (!onProblemsetPage()) return;
    if (injecting || document.getElementById(CARD_ID)) return;

    const list = findProblemList();
    if (!list || !list.parentElement) return;

    injecting = true;
    try {
      const { deck, settings, deckName } = await store.load();
      if (document.getElementById(CARD_ID) || !list.isConnected) return;

      const slugs = Object.keys(deck);
      const pick = Select.pickToday(deck, SM2.today(), { newPerDay: settings.newPerDay });

      let host;
      if (pick) {
        host = buildReviewCard(pick, pick.isNew);
      } else if (slugs.length === 0) {
        host = buildOnboardingCard(settings, deckName);
      } else {
        const cards = Object.values(deck);
        const nextDue = cards.map((c) => c.dueDate).filter(Boolean).sort()[0];
        const newCount = cards.filter((c) => c.dueDate == null).length;
        host = buildMessageCard(
          "all caught up.",
          `“${deckName}” · ${slugs.length} card${slugs.length === 1 ? "" : "s"}` +
            (nextDue ? ` · next review ${nextDue}` : "") +
            (newCount ? ` · ${newCount} new in queue` : "") +
            "."
        ).host;
      }

      list.parentElement.insertBefore(host, list);
    } finally {
      injecting = false;
    }
  }

  function removeInjected() {
    document.getElementById(CARD_ID)?.remove();
  }

  async function refresh() {
    await inject();
    await decorateRows();
  }

  // Debounced re-check on every mutation. This covers four cases at once:
  // the table rendering late, React wiping our card during hydration, SPA
  // navigation onto/off the problemset page (which always mutates DOM), and
  // fresh rows from pagination/filtering that need their "+" buttons.
  let settleTimer = null;
  let lastUrl = location.href;

  function scheduleRefresh() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(refresh, SETTLE_MS);
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (!onProblemsetPage()) removeInjected();
    }
    scheduleRefresh();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Deck changed (a rating in another tab, an add/remove): re-render.
  store.onChange(() => {
    removeInjected();
    scheduleRefresh();
  });

  refresh();
})();
