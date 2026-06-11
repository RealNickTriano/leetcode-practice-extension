// SM-2 scheduling core. Pure functions, no DOM, no chrome.* — runs both as a
// content-script global (LeetcodeAnki.SM2) and as a Node module for tests.
(function () {
  const MIN_EASE = 1.3;
  const DEFAULT_EASE = 2.5;
  const GRADES = ["again", "hard", "good", "easy"];

  // Dates are ISO "YYYY-MM-DD" strings in local time; scheduling is
  // day-granular so wall-clock time never matters.
  function today(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDays(isoDate, days) {
    const d = new Date(`${isoDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    return today(d);
  }

  function daysBetween(isoFrom, isoTo) {
    const from = new Date(`${isoFrom}T00:00:00`);
    const to = new Date(`${isoTo}T00:00:00`);
    return Math.round((to - from) / 86400000);
  }

  // New cards are unscheduled (dueDate null): they wait in the deck's new
  // queue and only get a schedule when first rated. This is what lets a
  // seeded 150-problem list sit in the deck without faking overdue reviews.
  function newCard(meta, onDate = today()) {
    return {
      ...meta,
      ease: DEFAULT_EASE,
      intervalDays: 0,
      reps: 0,
      dueDate: null,
      addedAt: onDate,
    };
  }

  function rate(card, grade, onDate = today()) {
    if (!GRADES.includes(grade)) {
      throw new Error(`unknown grade: ${grade}`);
    }

    if (grade === "again") {
      return {
        ...card,
        reps: 0,
        intervalDays: 1,
        ease: Math.max(MIN_EASE, card.ease - 0.2),
        dueDate: addDays(onDate, 1),
      };
    }

    const ease =
      grade === "hard" ? Math.max(MIN_EASE, card.ease - 0.15)
      : grade === "easy" ? card.ease + 0.15
      : card.ease;

    // Anki-style departures from textbook SM-2 on the first two reviews,
    // so the grade buttons preview distinct intervals: Easy on a new card
    // skips ahead (Anki's "easy interval"), Hard on the second review
    // shortens the standard 6-day graduation.
    const intervalDays =
      card.reps === 0 ? (grade === "easy" ? 4 : 1)
      : card.reps === 1 ? (grade === "hard" ? 3 : grade === "easy" ? 8 : 6)
      : Math.max(
          card.intervalDays + 1,
          Math.round(
            card.intervalDays *
              (grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease)
          )
        );

    return {
      ...card,
      ease,
      intervalDays,
      reps: card.reps + 1,
      dueDate: addDays(onDate, intervalDays),
    };
  }

  const SM2 = { rate, newCard, today, addDays, daysBetween, MIN_EASE, DEFAULT_EASE, GRADES };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SM2;
  } else {
    globalThis.LeetcodeAnki = globalThis.LeetcodeAnki || {};
    globalThis.LeetcodeAnki.SM2 = SM2;
  }
})();
