// Deck persistence over chrome.storage.local. Supports multiple decks with
// one selected; every card operation targets the selected deck, and load()
// exposes its cards as `deck` so content scripts stay agnostic of the
// multi-deck structure. The backend is injected so the same code runs
// against a fake in Node tests (see memoryBackend below).
(function () {
  const DEFAULT_SETTINGS = { newPerDay: 1, sourceList: "neetcode-150", resetCode: true };

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

    // Bulk import (a curated list or solve history). Cards join the new
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
      const updated = { ...SM2.rate(card, grade, onDate), lastGrade: grade };
      // First rating promotes a new card out of the queue; the stamp is what
      // the picker counts against the newPerDay budget.
      if (card.dueDate == null && !card.introducedAt) updated.introducedAt = onDate;
      cards[slug] = updated;
      s.reviewLog.push({ slug, date: onDate, grade, deckId: s.currentDeckId });
      await backend.set({ decks: s.decks, reviewLog: s.reviewLog });
      return updated;
    }

    async function updateSettings(partial) {
      const s = await loadRaw();
      const settings = { ...s.settings, ...partial };
      await backend.set({ settings });
      return settings;
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

    return {
      load,
      addCard,
      seedCards,
      removeCard,
      rateCard,
      updateSettings,
      createDeck,
      renameDeck,
      selectDeck,
      deleteDeck,
    };
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
    LeetcodeAnki.store = createStore(chrome.storage.local, LeetcodeAnki.SM2);
    LeetcodeAnki.store.onChange = (cb) =>
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") cb(changes);
      });
  }
})();
