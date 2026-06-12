const { test } = require("node:test");
const assert = require("node:assert/strict");
const Stats = require("../lib/stats.js");

const DAY = "2026-06-11";

function card(overrides = {}) {
  return { ease: 2.5, intervalDays: 1, reps: 1, dueDate: DAY, ...overrides };
}

test("maturity buckets: new / learning / mature", () => {
  const deck = {
    a: card({ dueDate: null, intervalDays: 0, reps: 0 }), // new
    b: card({ intervalDays: 6 }), // learning
    c: card({ intervalDays: 20 }), // learning, just under the line
    d: card({ intervalDays: 21 }), // mature, exactly at the line
    e: card({ intervalDays: 90 }), // mature
  };
  assert.deepEqual(Stats.maturity(deck), {
    new: 1,
    learning: 2,
    mature: 2,
    total: 5,
  });
});

test("maturity of an empty deck is all zeros", () => {
  assert.deepEqual(Stats.maturity({}), { new: 0, learning: 0, mature: 0, total: 0 });
});

test("forecast counts due cards per day, folding overdue into today", () => {
  const deck = {
    overdue: card({ dueDate: "2026-06-01" }), // 10 days late → today's bucket
    today: card({ dueDate: DAY }),
    tomorrow: card({ dueDate: "2026-06-12" }),
    nextWeek: card({ dueDate: "2026-06-17" }), // day 6, last bucket
    beyond: card({ dueDate: "2026-06-18" }), // day 7, outside the window
    fresh: card({ dueDate: null }), // new cards aren't scheduled
  };
  assert.deepEqual(Stats.forecast(deck, DAY, 7), [2, 1, 0, 0, 0, 0, 1]);
});
