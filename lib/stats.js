// Deck statistics. Pure functions; mirror of lib/select.js in how it loads
// (content-script/popup global LeetcodeAnki.Stats, or Node module).
(function () {
  const SM2 =
    typeof module !== "undefined" && module.exports
      ? require("./sm2.js")
      : globalThis.LeetcodeAnki.SM2;

  // Anki's convention: a card is "mature" once its interval reaches 21 days.
  const MATURE_DAYS = 21;

  // Buckets: new (unscheduled, waiting in the queue), learning (scheduled,
  // interval still short), mature (interval ≥ MATURE_DAYS).
  function maturity(deck) {
    const m = { new: 0, learning: 0, mature: 0, total: 0 };
    for (const card of Object.values(deck)) {
      if (card.dueDate == null) m.new++;
      else if (card.intervalDays >= MATURE_DAYS) m.mature++;
      else m.learning++;
      m.total++;
    }
    return m;
  }

  // Due counts for `days` consecutive days starting at onDate. The first
  // bucket folds in the overdue backlog — it's all due today.
  function forecast(deck, onDate = SM2.today(), days = 7) {
    const counts = new Array(days).fill(0);
    for (const card of Object.values(deck)) {
      if (card.dueDate == null) continue;
      const i = Math.max(0, SM2.daysBetween(onDate, card.dueDate));
      if (i < days) counts[i]++;
    }
    return counts;
  }

  const Stats = { maturity, forecast, MATURE_DAYS };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Stats;
  } else {
    globalThis.LeetcodeAnki.Stats = Stats;
  }
})();
