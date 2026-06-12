const { test } = require("node:test");
const assert = require("node:assert/strict");
const SM2 = require("../lib/sm2.js");

const DAY = "2026-06-11";

function card(overrides = {}) {
  return { ease: 2.5, intervalDays: 0, reps: 0, dueDate: DAY, ...overrides };
}

test("newCard starts unscheduled, in the new queue", () => {
  const c = SM2.newCard({ title: "Two Sum" }, DAY);
  assert.equal(c.ease, SM2.DEFAULT_EASE);
  assert.equal(c.reps, 0);
  assert.equal(c.dueDate, null);
  assert.equal(c.addedAt, DAY);
  assert.equal(c.title, "Two Sum");
});

test("good: first review → 1 day", () => {
  const c = SM2.rate(card(), "good", DAY);
  assert.equal(c.intervalDays, 1);
  assert.equal(c.reps, 1);
  assert.equal(c.ease, 2.5);
  assert.equal(c.dueDate, "2026-06-12");
});

test("good: second review → 6 days", () => {
  const c = SM2.rate(card({ reps: 1, intervalDays: 1 }), "good", DAY);
  assert.equal(c.intervalDays, 6);
  assert.equal(c.dueDate, "2026-06-17");
});

test("easy: first review skips ahead 4 days (Anki easy interval)", () => {
  const c = SM2.rate(card(), "easy", DAY);
  assert.equal(c.intervalDays, 4);
  assert.equal(c.ease, 2.65);
  assert.equal(c.dueDate, "2026-06-15");
});

test("second review: hard → 3 days, easy → 8 days", () => {
  const hard = SM2.rate(card({ reps: 1, intervalDays: 1 }), "hard", DAY);
  assert.equal(hard.intervalDays, 3);
  const easy = SM2.rate(card({ reps: 1, intervalDays: 1 }), "easy", DAY);
  assert.equal(easy.intervalDays, 8);
});

test("good: third review → interval × ease", () => {
  const c = SM2.rate(card({ reps: 2, intervalDays: 6 }), "good", DAY);
  assert.equal(c.intervalDays, 15); // round(6 × 2.5)
  assert.equal(c.reps, 3);
});

test("again: resets reps, interval 1, ease −0.2", () => {
  const c = SM2.rate(card({ reps: 4, intervalDays: 35 }), "again", DAY);
  assert.equal(c.reps, 0);
  assert.equal(c.intervalDays, 1);
  assert.equal(c.ease, 2.3);
  assert.equal(c.dueDate, "2026-06-12");
});

test("hard: interval × 1.2, ease −0.15", () => {
  const c = SM2.rate(card({ reps: 3, intervalDays: 15 }), "hard", DAY);
  assert.equal(c.intervalDays, 18); // round(15 × 1.2)
  assert.equal(c.ease, 2.35);
});

test("easy: interval × ease × 1.3, ease +0.15", () => {
  const c = SM2.rate(card({ reps: 2, intervalDays: 6 }), "easy", DAY);
  assert.equal(c.ease, 2.65);
  assert.equal(c.intervalDays, 21); // round(6 × 2.65 × 1.3) = round(20.67)
});

test("ease never drops below the 1.3 floor", () => {
  let c = card({ ease: 1.35 });
  c = SM2.rate(c, "again", DAY);
  assert.equal(c.ease, SM2.MIN_EASE);
  c = SM2.rate(c, "hard", DAY);
  assert.equal(c.ease, SM2.MIN_EASE);
});

test("successful reviews always grow the interval, even at floor ease", () => {
  // hard at small intervals: round(1 × 1.2) would stay 1 without the +1 guard
  const c = SM2.rate(card({ reps: 2, intervalDays: 1, ease: 1.3 }), "hard", DAY);
  assert.ok(c.intervalDays > 1);
});

test("rate does not mutate the input card", () => {
  const before = card({ reps: 2, intervalDays: 6 });
  const frozen = JSON.stringify(before);
  SM2.rate(before, "good", DAY);
  assert.equal(JSON.stringify(before), frozen);
});

test("unknown grade throws", () => {
  assert.throws(() => SM2.rate(card(), "meh", DAY), /unknown grade/);
});

test("addDays crosses month boundaries", () => {
  assert.equal(SM2.addDays("2026-06-28", 6), "2026-07-04");
});

test("today rolls over at the given hour, not midnight", () => {
  const lateNight = new Date("2026-06-12T02:30:00");
  assert.equal(SM2.today(lateNight, 4), "2026-06-11"); // still "yesterday"
  assert.equal(SM2.today(lateNight, 0), "2026-06-12"); // midnight rollover
  const morning = new Date("2026-06-12T05:00:00");
  assert.equal(SM2.today(morning, 4), "2026-06-12");
});

test("the rollover hour never shifts addDays — it's exact date math", () => {
  SM2.setRolloverHour(12);
  try {
    assert.equal(SM2.addDays("2026-06-28", 1), "2026-06-29");
  } finally {
    SM2.setRolloverHour(SM2.DEFAULT_ROLLOVER_HOUR);
  }
});

test("daysBetween", () => {
  assert.equal(SM2.daysBetween("2026-06-01", "2026-06-11"), 10);
  assert.equal(SM2.daysBetween("2026-06-11", "2026-06-01"), -10);
});
