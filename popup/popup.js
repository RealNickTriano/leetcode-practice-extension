// Popup deck browser: every card sorted by due date (most overdue first),
// click-through to the problem, remove with ✕. Re-renders on storage change.
(function () {
  const { SM2, store } = globalThis.LeetcodeAnki;

  const countsEl = document.getElementById("counts");
  const listEl = document.getElementById("list");
  const deckSelect = document.getElementById("deck-select");
  const deckNewBtn = document.getElementById("deck-new");
  const deckRenameBtn = document.getElementById("deck-rename");
  const deckDelBtn = document.getElementById("deck-del");
  const nameRow = document.getElementById("namedeck-row");
  const nameInput = document.getElementById("namedeck-name");
  const nameConfirm = document.getElementById("namedeck-confirm");
  const resetCodeSwitch = document.getElementById("set-reset-code");
  const showTagsSwitch = document.getElementById("set-show-tags");
  const newPerDayInput = document.getElementById("set-new-per-day");
  const rolloverInput = document.getElementById("set-rollover-hour");

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

  function dueLabel(card, today) {
    if (card.dueDate == null) return { text: "new", due: false, isNew: true };
    const overdue = SM2.daysBetween(card.dueDate, today);
    if (overdue > 0) return { text: `${overdue}d overdue`, due: true };
    if (overdue === 0) return { text: "due today", due: true };
    return { text: `due in ${-overdue}d`, due: false };
  }

  function buildRow(slug, card, today) {
    const { text, due } = dueLabel(card, today);

    const row = document.createElement("div");
    row.className = due ? "row due" : "row";

    const main = document.createElement("a");
    main.className = "row-main";
    main.href = `https://leetcode.com/problems/${slug}/`;
    main.target = "_blank";
    main.rel = "noopener";

    const titleLine = document.createElement("div");
    titleLine.className = "title-line";
    const title = document.createElement("span");
    title.className = "title";
    if (card.questionId) {
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = `${card.questionId}. `;
      title.append(num);
    }
    title.append(card.title || slug);
    const diff = document.createElement("span");
    diff.className = `diff ${card.difficulty || ""}`;
    diff.textContent = card.difficulty || "";
    titleLine.append(title, diff);

    const metaLine = document.createElement("div");
    metaLine.className = "meta-line";
    const when = document.createElement("span");
    when.className = due ? "when" : "when future";
    when.textContent = text;
    if (card.dueDate == null) {
      metaLine.append(when, " · waiting in queue");
    } else {
      metaLine.append(
        when,
        ` · ivl ${card.intervalDays}d · ease ${card.ease.toFixed(2)} · ` +
          `${card.reps} rep${card.reps === 1 ? "" : "s"}` +
          (card.lastGrade ? ` · ${card.lastGrade}` : "")
      );
    }

    main.append(titleLine, metaLine);

    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "✕";
    x.dataset.tip = "Remove from deck";
    armable(x, () => store.removeCard(slug));

    row.append(main, x);
    return row;
  }

  function buildEmpty() {
    const div = document.createElement("div");
    div.className = "empty";
    const b = document.createElement("b");
    b.textContent = "This deck is empty.";
    div.append(
      b,
      document.createElement("br"),
      "Visit the LeetCode problems page to start a curated list, " +
        "or open any problem and click “+ Add to Leetcode Anki”."
    );
    return div;
  }

  let currentDeckName = ""; // prefill for the rename row

  async function render() {
    const { deck, decks, deckId, deckName, settings } = await store.load();
    const today = SM2.today();
    currentDeckName = deckName;

    resetCodeSwitch.checked = settings.resetCode !== false;
    showTagsSwitch.checked = settings.showTags !== false;
    newPerDayInput.value = settings.newPerDay;
    rolloverInput.value = settings.rolloverHour;

    deckSelect.replaceChildren(
      ...Object.entries(decks).map(([id, d]) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = `${d.name} (${Object.keys(d.cards).length})`;
        opt.selected = id === deckId;
        return opt;
      })
    );
    disarmDelete();

    // Three groups, mirroring the picker: due reviews, then the new queue
    // in introduction order, then future-scheduled reviews.
    const rank = (c) => (c.dueDate == null ? 1 : c.dueDate <= today ? 0 : 2);
    const entries = Object.entries(deck).sort(([aSlug, a], [bSlug, b]) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (rank(a) === 1) return (a.order ?? 0) - (b.order ?? 0);
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      if (a.ease !== b.ease) return a.ease - b.ease;
      return aSlug < bSlug ? -1 : 1;
    });

    const dueCount = entries.filter(([, c]) => rank(c) === 0).length;
    const newCount = entries.filter(([, c]) => rank(c) === 1).length;
    countsEl.replaceChildren();
    if (entries.length > 0) {
      const b = document.createElement("b");
      b.textContent = `${dueCount} due`;
      countsEl.append(
        b,
        ` · ${newCount} new · ${entries.length} card${entries.length === 1 ? "" : "s"}`
      );
    }

    if (entries.length === 0) {
      listEl.replaceChildren(buildEmpty());
      return;
    }
    listEl.replaceChildren(...entries.map(([slug, card]) => buildRow(slug, card, today)));
  }

  // ----- deck switcher -----

  let delArmTimer = null;

  function disarmDelete() {
    clearTimeout(delArmTimer);
    deckDelBtn.classList.remove("armed");
    deckDelBtn.textContent = "delete";
  }

  deckSelect.addEventListener("change", () => {
    closeNameRow(); // a rename prefill for the old deck would be stale
    store.selectDeck(deckSelect.value);
  });

  // One input row serves both "new deck" and "rename deck": the mode picks
  // the confirm label, the prefill, and which store call commits it.
  let nameMode = null; // "create" | "rename" | null (row hidden)

  function openNameRow(mode) {
    nameMode = mode;
    nameRow.classList.remove("hidden");
    nameConfirm.textContent = mode === "rename" ? "rename" : "create";
    nameInput.value = mode === "rename" ? currentDeckName : "";
    nameInput.focus();
    nameInput.select();
  }

  function closeNameRow() {
    nameMode = null;
    nameRow.classList.add("hidden");
  }

  // Clicking a mode's own button again closes the row; clicking the other
  // button switches modes.
  deckNewBtn.addEventListener("click", () =>
    nameMode === "create" ? closeNameRow() : openNameRow("create")
  );
  deckRenameBtn.addEventListener("click", () =>
    nameMode === "rename" ? closeNameRow() : openNameRow("rename")
  );

  async function confirmName() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const mode = nameMode;
    closeNameRow();
    if (mode === "rename") {
      await store.renameDeck(deckSelect.value, name); // onChange re-renders
    } else {
      await store.createDeck(name); // also selects it; onChange re-renders
    }
  }

  nameConfirm.addEventListener("click", confirmName);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmName();
    if (e.key === "Escape") closeNameRow();
  });

  // Deleting a whole deck is destructive, so it takes two clicks: the first
  // arms the button ("sure?"), the second within 3s actually deletes.
  deckDelBtn.addEventListener("click", async () => {
    if (!deckDelBtn.classList.contains("armed")) {
      deckDelBtn.classList.add("armed");
      deckDelBtn.textContent = "sure?";
      delArmTimer = setTimeout(disarmDelete, 3000);
      return;
    }
    disarmDelete();
    closeNameRow(); // a rename prefill for the deleted deck would be stale
    await store.deleteDeck(deckSelect.value); // onChange re-renders
  });

  // ----- tabs & settings -----

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      document.body.dataset.tab = tab.dataset.tab;
    });
  }

  resetCodeSwitch.addEventListener("change", () => {
    store.updateSettings({ resetCode: resetCodeSwitch.checked });
  });

  showTagsSwitch.addEventListener("change", () => {
    store.updateSettings({ showTags: showTagsSwitch.checked });
  });

  // A stepper saves its setting clamped to a whole number in [min, max],
  // writing the clamped value back so the field always shows what was saved.
  function wireStepper(input, decId, incId, key, min, max) {
    const save = (value) => {
      const n = Math.max(min, Math.min(max, Math.floor(Number(value)) || 0));
      input.value = n;
      store.updateSettings({ [key]: n });
    };
    input.addEventListener("change", () => save(input.value));
    document
      .getElementById(decId)
      .addEventListener("click", () => save(Number(input.value) - 1));
    document
      .getElementById(incId)
      .addEventListener("click", () => save(Number(input.value) + 1));
  }

  wireStepper(newPerDayInput, "new-per-day-dec", "new-per-day-inc", "newPerDay", 0, 10);
  wireStepper(rolloverInput, "rollover-dec", "rollover-inc", "rolloverHour", 0, 12);

  store.onChange(render);
  render();
})();
