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
    { slug: "two-sum", date: DAY, grade: "good", deckId: "default" },
  ]);
});

test("rateCard on an unknown slug throws", async () => {
  const store = createStore(memoryBackend(), SM2);
  await assert.rejects(() => store.rateCard("nope", "good", DAY), /not in deck/);
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
