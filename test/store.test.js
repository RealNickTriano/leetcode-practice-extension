const { test } = require("node:test");
const assert = require("node:assert/strict");
const SM2 = require("../lib/sm2.js");
const { createStore, memoryBackend } = require("../lib/store.js");

const DAY = "2026-06-11";
const META = { title: "Two Sum", questionId: 1, difficulty: "Easy", tags: ["array"] };

test("load returns defaults on empty storage", async () => {
  const store = createStore(memoryBackend(), SM2);
  const state = await store.load();
  assert.deepEqual(state.deck, {});
  assert.deepEqual(state.reviewLog, []);
  assert.equal(state.settings.newPerDay, 1);
});

test("addCard creates an unscheduled card at the back of the queue", async () => {
  const store = createStore(memoryBackend(), SM2);
  const card = await store.addCard("two-sum", META, DAY);
  assert.equal(card.title, "Two Sum");
  assert.equal(card.dueDate, null);
  assert.equal(card.reps, 0);
  assert.equal(card.order, 1);
  const second = await store.addCard("lru-cache", META, DAY);
  assert.equal(second.order, 2);
});

test("re-adding never resets scheduling state", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  const rated = await store.rateCard("two-sum", "good", DAY);
  const again = await store.addCard("two-sum", META, DAY);
  assert.equal(again.reps, rated.reps);
  assert.equal(again.dueDate, rated.dueDate);
});

test("rateCard applies SM-2, records lastGrade, appends the log", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  const updated = await store.rateCard("two-sum", "good", DAY);
  assert.equal(updated.reps, 1);
  assert.equal(updated.intervalDays, 1);
  assert.equal(updated.dueDate, "2026-06-12");
  assert.equal(updated.lastGrade, "good");
  assert.equal(updated.introducedAt, DAY); // promoted out of the new queue

  const { deck, reviewLog } = await store.load();
  assert.equal(deck["two-sum"].dueDate, "2026-06-12");
  assert.deepEqual(reviewLog, [
    // intervalDays = the interval going into the review (0: new card)
    { slug: "two-sum", date: DAY, grade: "good", deckId: "default", intervalDays: 0 },
  ]);
});

test("rateCard on an unknown slug throws", async () => {
  const store = createStore(memoryBackend(), SM2);
  await assert.rejects(() => store.rateCard("nope", "good", DAY), /not in deck/);
});

test("re-rating a not-yet-due card corrects it instead of compounding", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  await store.rateCard("two-sum", "good", DAY); // due DAY+1, not yet due
  const corrected = await store.rateCard("two-sum", "easy", DAY);

  // Identical to a single "easy" on the brand-new card.
  assert.equal(corrected.reps, 1);
  assert.equal(corrected.intervalDays, 4);
  assert.equal(corrected.dueDate, "2026-06-15"); // DAY + 4
  assert.equal(corrected.lastGrade, "easy");

  const { reviewLog } = await store.load();
  assert.equal(reviewLog.length, 1); // the "good" row was replaced, not appended
  assert.deepEqual(reviewLog, [
    { slug: "two-sum", date: DAY, grade: "easy", deckId: "default", intervalDays: 0 },
  ]);
});

test("correction keeps the original review date even a day later", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  await store.rateCard("two-sum", "easy", DAY); // due DAY+4
  const next = "2026-06-12"; // DAY + 1; card still not due (DAY+4 > DAY+1)
  const corrected = await store.rateCard("two-sum", "hard", next);

  // Rebuilt from the new card on the *original* date, not `next`.
  assert.equal(corrected.intervalDays, 1); // reps 0 + hard
  assert.equal(corrected.dueDate, "2026-06-12"); // DAY + 1, off DAY
  const { reviewLog } = await store.load();
  assert.equal(reviewLog.length, 1);
  assert.equal(reviewLog[0].date, DAY);
  assert.equal(reviewLog[0].grade, "hard");
});

test("rating a card that is due again is a fresh review, not a correction", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  await store.rateCard("two-sum", "good", DAY); // due DAY+1
  const next = "2026-06-12"; // DAY + 1 — card is due
  const second = await store.rateCard("two-sum", "good", next);

  assert.equal(second.reps, 2); // advanced from the prior review, not reset
  const { reviewLog } = await store.load();
  assert.equal(reviewLog.length, 2); // appended, not replaced
});

test("corrections are repeatable (fixing a fix)", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  await store.rateCard("two-sum", "good", DAY);
  await store.rateCard("two-sum", "easy", DAY);
  const corrected = await store.rateCard("two-sum", "again", DAY);

  // Equal to a single "again" on the brand-new card.
  assert.equal(corrected.reps, 0);
  assert.equal(corrected.dueDate, "2026-06-12"); // DAY + 1
  assert.equal(corrected.lastGrade, "again");
  const { reviewLog } = await store.load();
  assert.equal(reviewLog.length, 1);
  assert.equal(reviewLog[0].grade, "again");
});

test("a future-due card without prevReview rates as a new review", async () => {
  const backend = memoryBackend();
  const s = createStore(backend, SM2);
  await s.addCard("two-sum", META, DAY);
  // Simulate a legacy card: scheduled into the future but lacking prevReview.
  const raw = await backend.get(["decks"]);
  raw.decks.default.cards["two-sum"] = {
    ...raw.decks.default.cards["two-sum"],
    intervalDays: 6,
    reps: 2,
    dueDate: "2026-06-20",
  };
  await backend.set({ decks: raw.decks });

  const rated = await s.rateCard("two-sum", "good", DAY);
  assert.equal(rated.reps, 3); // advanced from current state — new review
  const { reviewLog } = await s.load();
  assert.equal(reviewLog.length, 1);
});

test("seedCards adds unscheduled cards in queue order", async () => {
  const store = createStore(memoryBackend(), SM2);
  const added = await store.seedCards(
    [
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
      { slug: "c", title: "C" },
    ],
    DAY
  );
  assert.equal(added, 3);
  const { deck } = await store.load();
  assert.equal(deck.a.dueDate, null);
  assert.equal(deck.c.dueDate, null);
  assert.deepEqual(
    [deck.a.order, deck.b.order, deck.c.order],
    [1, 2, 3]
  );
  assert.equal(deck.a.addedAt, DAY);
});

test("seedCards skips existing cards, queues behind them", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("a", META, DAY); // order 1
  const rated = await store.rateCard("a", "good", DAY);
  const added = await store.seedCards(
    [
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
    ],
    DAY
  );
  assert.equal(added, 1);
  const { deck } = await store.load();
  assert.equal(deck.a.dueDate, rated.dueDate); // untouched
  assert.equal(deck.b.dueDate, null);
  assert.equal(deck.b.order, 2);
});

test("removeCard deletes the card, leaves the log", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  await store.rateCard("two-sum", "good", DAY);
  await store.removeCard("two-sum");
  const { deck, reviewLog } = await store.load();
  assert.equal(deck["two-sum"], undefined);
  assert.equal(reviewLog.length, 1);
});

test("updateSettings merges partial changes", async () => {
  const store = createStore(memoryBackend(), SM2);
  const settings = await store.updateSettings({ newPerDay: 3 });
  assert.equal(settings.newPerDay, 3);
  assert.equal(settings.resetCode, true); // defaults preserved
  const s = await store.load();
  assert.equal(s.settings.newPerDay, 3);
});

// Like real chrome.storage: values are copied (not shared references) and
// each call yields to the event loop, so an unserialized read-modify-write
// race actually loses writes here — memoryBackend's shared references would
// mask it.
function cloningBackend() {
  const data = {};
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    async get(keys) {
      await tick();
      const out = {};
      for (const k of keys) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(entries) {
      await tick();
      Object.assign(data, structuredClone(entries));
    },
    async remove(keys) {
      await tick();
      for (const k of keys) delete data[k];
    },
  };
}

test("concurrent operations serialize instead of clobbering each other", async () => {
  const store = createStore(cloningBackend(), SM2);
  await store.addCard("a", META, DAY);
  await Promise.all([
    store.addCard("b", META, DAY),
    store.rateCard("a", "good", DAY),
    store.seedCards([{ slug: "c", title: "C" }, { slug: "d", title: "D" }], DAY),
    store.updateSettings({ newPerDay: 2 }),
  ]);
  const s = await store.load();
  assert.deepEqual(Object.keys(s.deck).sort(), ["a", "b", "c", "d"]);
  assert.equal(s.deck.a.reps, 1); // the rating survived the concurrent adds
  assert.equal(s.reviewLog.length, 1);
  assert.equal(s.settings.newPerDay, 2);
});

// ----- backup -----

test("exportState → importState round-trips into a fresh store", async () => {
  const src = createStore(memoryBackend(), SM2);
  await src.addCard("two-sum", META, DAY);
  await src.rateCard("two-sum", "good", DAY);
  await src.createDeck("Second");
  await src.updateSettings({ newPerDay: 3 });
  const backup = await src.exportState();

  const dst = createStore(memoryBackend(), SM2);
  await dst.addCard("stale-card", META, DAY); // must be replaced, not merged
  await dst.importState(backup);

  const s = await dst.load();
  assert.equal(s.deckId, "second"); // selection travels with the backup
  assert.equal(s.decks.default.cards["two-sum"].reps, 1);
  assert.equal(s.decks.default.cards["stale-card"], undefined);
  assert.equal(s.settings.newPerDay, 3);
  assert.equal(s.reviewLog.length, 1);
});

test("importState rejects non-backup data", async () => {
  const store = createStore(memoryBackend(), SM2);
  await assert.rejects(() => store.importState(null), /invalid backup/);
  await assert.rejects(() => store.importState({ foo: 1 }), /invalid backup/);
  await assert.rejects(
    () => store.importState({ decks: { d: { cards: {} } } }), // deck without a name
    /bad deck/
  );
  await assert.rejects(() => store.importState({ version: 2, decks: {} }), /newer/);
});

test("importState self-heals an unknown selected deck", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.importState({
    decks: { only: { name: "Only", cards: {} } },
    currentDeckId: "nope",
  });
  assert.equal((await store.load()).deckId, "only");
});

// ----- multiple decks -----

test("migrates v1 single-deck storage to decks/currentDeckId", async () => {
  const v1Card = { title: "Two Sum", ease: 2.5, intervalDays: 6, reps: 2, dueDate: DAY };
  const backend = memoryBackend({ deck: { "two-sum": v1Card } });
  const store = createStore(backend, SM2);
  const s = await store.load();
  assert.equal(s.deckId, "default");
  assert.equal(s.deckName, "Default");
  assert.deepEqual(s.deck["two-sum"], v1Card);
  const raw = await backend.get(["deck", "decks"]);
  assert.equal(raw.deck, undefined); // old key cleaned up
  assert.ok(raw.decks.default);
});

test("createDeck selects the new deck; card ops target it", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  const id = await store.createDeck("Graph Practice");
  assert.equal(id, "graph-practice");

  let s = await store.load();
  assert.equal(s.deckId, "graph-practice");
  assert.deepEqual(s.deck, {}); // new deck is empty

  await store.addCard("clone-graph", META, DAY);
  s = await store.load();
  assert.ok(s.deck["clone-graph"]);
  assert.equal(s.decks.default.cards["clone-graph"], undefined);
  assert.ok(s.decks.default.cards["two-sum"]);
});

test("the same problem schedules independently in different decks", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  await store.createDeck("Second");
  await store.addCard("two-sum", META, DAY);
  await store.rateCard("two-sum", "good", DAY);

  const s = await store.load();
  assert.equal(s.decks.second.cards["two-sum"].reps, 1);
  assert.equal(s.decks.default.cards["two-sum"].reps, 0); // untouched
});

test("renameDeck changes the name, keeps the id and cards", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  await store.renameDeck("default", "NeetCode 150");
  const s = await store.load();
  assert.equal(s.deckId, "default");
  assert.equal(s.deckName, "NeetCode 150");
  assert.ok(s.deck["two-sum"]);
  await assert.rejects(() => store.renameDeck("nope", "x"), /no such deck/);
});

test("selectDeck switches; unknown deck throws", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.createDeck("Second");
  await store.selectDeck("default");
  assert.equal((await store.load()).deckId, "default");
  await assert.rejects(() => store.selectDeck("nope"), /no such deck/);
});

test("deck ids are de-duplicated", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.createDeck("Default");
  assert.equal((await store.load()).deckId, "default-2");
});

test("deleteDeck moves selection; deleting the last deck leaves an empty Default", async () => {
  const store = createStore(memoryBackend(), SM2);
  await store.addCard("two-sum", META, DAY);
  const id = await store.createDeck("Second");
  await store.deleteDeck(id);
  let s = await store.load();
  assert.equal(s.deckId, "default");
  assert.ok(s.deck["two-sum"]);

  await store.deleteDeck("default");
  s = await store.load();
  assert.equal(s.deckId, "default");
  assert.deepEqual(s.deck, {});
});
