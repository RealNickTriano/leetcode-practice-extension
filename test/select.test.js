const { test } = require("node:test");
const assert = require("node:assert/strict");
const Select = require("../lib/select.js");

const TODAY = "2026-06-11";

function card(dueDate, ease = 2.5) {
  return { ease, intervalDays: 6, reps: 2, dueDate };
}

function freshCard(order) {
  return { ease: 2.5, intervalDays: 0, reps: 0, dueDate: null, order };
}

test("picks the most overdue card", () => {
  const deck = {
    "two-sum": card("2026-06-10"),
    "valid-anagram": card("2026-06-01"),
    "lru-cache": card("2026-06-11"),
  };
  assert.equal(Select.pickToday(deck, TODAY).slug, "valid-anagram");
});

test("ignores cards due in the future", () => {
  const deck = {
    "two-sum": card("2026-06-15"),
    "lru-cache": card("2026-07-01"),
  };
  assert.equal(Select.pickToday(deck, TODAY), null);
});

test("due today counts as due", () => {
  const deck = { "two-sum": card(TODAY) };
  assert.equal(Select.pickToday(deck, TODAY).slug, "two-sum");
});

test("ties broken by lower ease (weaker card first)", () => {
  const deck = {
    "strong-card": card("2026-06-05", 2.8),
    "weak-card": card("2026-06-05", 1.6),
  };
  assert.equal(Select.pickToday(deck, TODAY).slug, "weak-card");
});

test("full ties broken by slug for determinism", () => {
  const deck = {
    "b-problem": card("2026-06-05"),
    "a-problem": card("2026-06-05"),
  };
  assert.equal(Select.pickToday(deck, TODAY).slug, "a-problem");
});

test("empty deck → null", () => {
  assert.equal(Select.pickToday({}, TODAY), null);
});

// ----- the new queue (stage 2) -----

test("a due review beats the new queue", () => {
  const deck = {
    "fresh-one": freshCard(1),
    "two-sum": card(TODAY),
  };
  const pick = Select.pickToday(deck, TODAY);
  assert.equal(pick.slug, "two-sum");
  assert.equal(pick.isNew, false);
});

test("nothing due → first new card in queue order, flagged isNew", () => {
  const deck = {
    "z-later": freshCard(5),
    "a-first": freshCard(2),
    "future-review": card("2026-07-01"),
  };
  const pick = Select.pickToday(deck, TODAY);
  assert.equal(pick.slug, "a-first");
  assert.equal(pick.isNew, true);
});

test("introducedAt today spends the new-card budget", () => {
  const deck = {
    introduced: { ...card("2026-06-12"), introducedAt: TODAY },
    waiting: freshCard(1),
  };
  assert.equal(Select.pickToday(deck, TODAY), null);
  // budget resets the next day
  const tomorrow = "2026-06-12";
  const pick = Select.pickToday(deck, tomorrow);
  assert.equal(pick.slug, "introduced"); // now a due review, stage 1
});

test("newPerDay > 1 allows another new card the same day", () => {
  const deck = {
    introduced: { ...card("2026-06-12"), introducedAt: TODAY },
    waiting: freshCard(1),
  };
  const pick = Select.pickToday(deck, TODAY, { newPerDay: 2 });
  assert.equal(pick.slug, "waiting");
  assert.equal(pick.isNew, true);
});

test("newCards returns the queue in order", () => {
  const deck = {
    b: freshCard(2),
    a: freshCard(1),
    scheduled: card(TODAY),
  };
  assert.deepEqual(
    Select.newCards(deck).map(([slug]) => slug),
    ["a", "b"]
  );
});

test("dueCards returns only due entries", () => {
  const deck = {
    "due-1": card("2026-06-01"),
    "future-1": card("2026-08-01"),
  };
  const due = Select.dueCards(deck, TODAY);
  assert.equal(due.length, 1);
  assert.equal(due[0][0], "due-1");
});
