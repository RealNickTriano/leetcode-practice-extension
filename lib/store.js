// Deck persistence over chrome.storage.local. Supports multiple decks with
// one selected; every card operation targets the selected deck, and load()
// exposes its cards as `deck` so content scripts stay agnostic of the
// multi-deck structure. The backend is injected so the same code runs
// against a fake in Node tests (see memoryBackend below).
//
// In the browser, the real store lives only in the background service
// worker (background.js); content scripts and the popup get a message proxy
// instead, so every read-modify-write serializes through one instance.
(function () {
  const DEFAULT_SETTINGS = { newPerDay: 1, resetCode: true, rolloverHour: 0, showTags: true };

  function createStore(backend, SM2) {
    function deckIdFor(name, taken) {
      const base =
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      return id;
    }

    // Full state, migrating the v1 single-deck shape ({ deck: {...} }) into
    // decks/currentDeckId on first touch.
    async function loadRaw() {
      const got = await backend.get([
        "decks",
        "currentDeckId",
        "deck",
        "reviewLog",
        "settings",
      ]);
      let { decks, currentDeckId } = got;
      let dirty = false;

      if (!decks || Object.keys(decks).length === 0) {
        decks = { default: { name: "Default", cards: got.deck || {} } };
        dirty = true;
      }
      if (!currentDeckId || !decks[currentDeckId]) {
        currentDeckId = Object.keys(decks)[0];
        dirty = true;
      }
      if (dirty) {
        await backend.set({ decks, currentDeckId });
        if (got.deck && backend.remove) await backend.remove(["deck"]);
      }

      return {
        decks,
        currentDeckId,
        reviewLog: got.reviewLog || [],
        settings: { ...DEFAULT_SETTINGS, ...got.settings },
      };
    }

    async function load() {
      const s = await loadRaw();
      const current = s.decks[s.currentDeckId];
      return { ...s, deckId: s.currentDeckId, deckName: current.name, deck: current.cards };
    }

    // ----- card operations (selected deck) -----

    // Position at the back of the deck's new queue.
    function nextOrder(cards) {
      let max = 0;
      for (const c of Object.values(cards)) {
        if (typeof c.order === "number" && c.order > max) max = c.order;
      }
      return max + 1;
    }

    // No-op if the slug is already in the deck — re-adding must never reset
    // a card's scheduling state.
    async function addCard(slug, meta, onDate = SM2.today()) {
      const s = await loadRaw();
      const cards = s.decks[s.currentDeckId].cards;
      if (cards[slug]) return cards[slug];
      const card = SM2.newCard(meta, onDate);
      card.order = nextOrder(cards);
      cards[slug] = card;
      await backend.set({ decks: s.decks });
      return card;
    }

    // Bulk import (a curated list). Cards join the new
    // queue unscheduled, in input order — the picker promotes them one per
    // day as capacity allows, so nothing ever fakes an overdue review.
    // Existing cards are never touched.
    async function seedCards(entries, onDate = SM2.today()) {
      const s = await loadRaw();
      const cards = s.decks[s.currentDeckId].cards;
      let order = nextOrder(cards);
      let added = 0;
      for (const { slug, ...meta } of entries) {
        if (!slug || cards[slug]) continue;
        const card = SM2.newCard(meta, onDate);
        card.order = order++;
        cards[slug] = card;
        added++;
      }
      if (added > 0) await backend.set({ decks: s.decks });
      return added;
    }

    async function removeCard(slug) {
      const s = await loadRaw();
      const cards = s.decks[s.currentDeckId].cards;
      if (!(slug in cards)) return;
      delete cards[slug];
      await backend.set({ decks: s.decks });
    }

    async function rateCard(slug, grade, onDate = SM2.today()) {
      const s = await loadRaw();
      const cards = s.decks[s.currentDeckId].cards;
      const card = cards[slug];
      if (!card) throw new Error(`not in deck: ${slug}`);

      // Re-rating a card that's already scheduled into the future is a
      // correction: rebuild from the state captured before that rating, on its
      // original date, and replace its log row — as if the bad grade never
      // happened. A new / due / overdue card is a fresh review off its current
      // state. (See SM2.reviewBasis.)
      const { base, date, correction } = SM2.reviewBasis(card, onDate);
      if (correction) {
        for (let i = s.reviewLog.length - 1; i >= 0; i--) {
          if (s.reviewLog[i].slug === slug && s.reviewLog[i].deckId === s.currentDeckId) {
            s.reviewLog.splice(i, 1);
            break;
          }
        }
      }

      // Snapshot the pre-rating state so a later correction can roll back to it;
      // strip its own prevReview so snapshots don't nest across reviews.
      const snapshot = { ...base };
      delete snapshot.prevReview;
      const updated = {
        ...SM2.rate(base, grade, date),
        lastGrade: grade,
        prevReview: { state: snapshot, date },
      };
      // First rating promotes a new card out of the queue; the stamp is what
      // the picker counts against the newPerDay budget.
      if (base.dueDate == null && !base.introducedAt) updated.introducedAt = date;
      cards[slug] = updated;
      // intervalDays is the card's interval *going into* this review — the
      // gap that was actually being tested. Stamped so future stats can
      // weight retention by interval; the card's own state only ever holds
      // the post-review value.
      s.reviewLog.push({
        slug,
        date,
        grade,
        deckId: s.currentDeckId,
        intervalDays: base.intervalDays,
      });
      await backend.set({ decks: s.decks, reviewLog: s.reviewLog });
      return updated;
    }

    async function updateSettings(partial) {
      const s = await loadRaw();
      const settings = { ...s.settings, ...partial };
      await backend.set({ settings });
      return settings;
    }

    // ----- backup -----

    // Everything needed to recreate the extension's state on another
    // machine, in a versioned envelope.
    async function exportState() {
      const s = await loadRaw();
      return {
        app: "leetcode-anki",
        version: 1,
        exportedAt: new Date().toISOString(),
        decks: s.decks,
        currentDeckId: s.currentDeckId,
        reviewLog: s.reviewLog,
        settings: s.settings,
      };
    }

    // Replaces ALL local state with the backup — import is a transfer, not
    // a merge. Validates the deck shape and throws on anything that doesn't
    // look like an export; everything else self-heals (unknown selected
    // deck, missing log, settings merged over current defaults).
    async function importState(state) {
      if (!state || typeof state !== "object") throw new Error("invalid backup");
      if (typeof state.version === "number" && state.version > 1) {
        throw new Error(`backup version ${state.version} is newer than this extension`);
      }
      const decks = state.decks;
      if (!decks || typeof decks !== "object" || Object.keys(decks).length === 0) {
        throw new Error("invalid backup: no decks");
      }
      for (const [id, d] of Object.entries(decks)) {
        if (!d || typeof d.name !== "string" || !d.cards || typeof d.cards !== "object") {
          throw new Error(`invalid backup: bad deck "${id}"`);
        }
      }
      await backend.set({
        decks,
        currentDeckId: decks[state.currentDeckId] ? state.currentDeckId : Object.keys(decks)[0],
        reviewLog: Array.isArray(state.reviewLog) ? state.reviewLog : [],
        settings: { ...DEFAULT_SETTINGS, ...(state.settings || {}) },
      });
    }

    // ----- deck operations -----

    // Creating a deck also selects it.
    async function createDeck(name) {
      const s = await loadRaw();
      const id = deckIdFor(name, new Set(Object.keys(s.decks)));
      s.decks[id] = { name: name.trim() || "Deck", cards: {} };
      await backend.set({ decks: s.decks, currentDeckId: id });
      return id;
    }

    async function renameDeck(id, name) {
      const s = await loadRaw();
      if (!s.decks[id]) throw new Error(`no such deck: ${id}`);
      s.decks[id].name = name.trim() || s.decks[id].name;
      await backend.set({ decks: s.decks });
    }

    async function selectDeck(id) {
      const s = await loadRaw();
      if (!s.decks[id]) throw new Error(`no such deck: ${id}`);
      await backend.set({ currentDeckId: id });
    }

    // Deleting the last deck leaves a fresh empty Default so there is always
    // a selected deck.
    async function deleteDeck(id) {
      const s = await loadRaw();
      if (!s.decks[id]) return;
      delete s.decks[id];
      if (Object.keys(s.decks).length === 0) {
        s.decks.default = { name: "Default", cards: {} };
      }
      const currentDeckId = s.decks[s.currentDeckId]
        ? s.currentDeckId
        : Object.keys(s.decks)[0];
      await backend.set({ decks: s.decks, currentDeckId });
    }

    // chrome.storage has no transactions, and every operation above is a
    // read-modify-write over the whole decks object — two interleaved
    // operations would clobber each other's writes. So all operations run
    // through this queue, one at a time. The queue only covers one store
    // instance; cross-context safety comes from routing every context's
    // calls to the single instance in the background worker (background.js).
    let chain = Promise.resolve();
    function serialized(fn) {
      return (...args) => {
        const run = chain.then(() => fn(...args));
        chain = run.then(
          () => {},
          () => {} // a failed op must not wedge the queue
        );
        return run;
      };
    }

    const ops = {
      load,
      addCard,
      seedCards,
      removeCard,
      rateCard,
      updateSettings,
      exportState,
      importState,
      createDeck,
      renameDeck,
      selectDeck,
      deleteDeck,
    };
    for (const name of Object.keys(ops)) ops[name] = serialized(ops[name]);
    return ops;
  }

  // In-memory chrome.storage.local stand-in for tests.
  function memoryBackend(initial = {}) {
    const data = { ...initial };
    return {
      async get(keys) {
        const out = {};
        for (const k of keys) if (k in data) out[k] = data[k];
        return out;
      },
      async set(entries) {
        Object.assign(data, entries);
      },
      async remove(keys) {
        for (const k of keys) delete data[k];
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createStore, memoryBackend, DEFAULT_SETTINGS };
  } else {
    const LeetcodeAnki = globalThis.LeetcodeAnki;

    // Keep SM2's day-rollover hour in line with the stored setting, in this
    // and every other context (worker, content scripts, popup) — every
    // SM2.today() call site inherits it. settingsReady lets the background
    // worker hold its first store op until the initial sync lands.
    const syncRollover = () =>
      chrome.storage.local.get("settings").then(({ settings }) => {
        LeetcodeAnki.SM2.setRolloverHour(
          settings && settings.rolloverHour != null
            ? settings.rolloverHour
            : DEFAULT_SETTINGS.rolloverHour
        );
      });
    LeetcodeAnki.settingsReady = syncRollover();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) syncRollover();
    });

    if (typeof document === "undefined") {
      // Background service worker: the one real store. Every write in the
      // extension happens through this instance, so its internal queue is a
      // global write lock.
      LeetcodeAnki.store = createStore(chrome.storage.local, LeetcodeAnki.SM2);
    } else {
      // Content script / popup: a proxy that forwards every call to the
      // background worker, so concurrent writes from any number of tabs and
      // the popup serialize in one place. createStore is called with null
      // backends just to enumerate the method names — nothing touches the
      // backend until a method runs.
      const call =
        (method) =>
        async (...args) => {
          const res = await chrome.runtime.sendMessage({
            type: "leetcode-anki:store",
            method,
            args,
          });
          if (!res) throw new Error("no response from background worker");
          if (!res.ok) throw new Error(res.error);
          return res.result;
        };
      LeetcodeAnki.store = {};
      for (const method of Object.keys(createStore(null, null))) {
        LeetcodeAnki.store[method] = call(method);
      }
      LeetcodeAnki.store.onChange = (cb) =>
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === "local") cb(changes);
        });
    }
  }
})();
