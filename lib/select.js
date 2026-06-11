// Picks today's problem from the deck. Pure functions; mirror of lib/sm2.js
// in how it loads (content-script global LeetcodeAnki.Select, or Node module).
(function () {
  const SM2 =
    typeof module !== "undefined" && module.exports
      ? require("./sm2.js")
      : globalThis.LeetcodeAnki.SM2;

  // A card is either scheduled (has a dueDate) or new (dueDate null,
  // waiting in the new queue in `order` sequence).
  function isNew(card) {
    return card.dueDate == null;
  }

  function dueCards(deck, onDate = SM2.today()) {
    return Object.entries(deck).filter(
      ([, card]) => !isNew(card) && card.dueDate <= onDate
    );
  }

  function newCards(deck) {
    return Object.entries(deck)
      .filter(([, card]) => isNew(card))
      .sort(
        ([slugA, a], [slugB, b]) =>
          (a.order ?? 0) - (b.order ?? 0) || (slugA < slugB ? -1 : 1)
      );
  }

  // Cards promoted out of the new queue today (stamped by store.rateCard).
  function introducedToday(deck, onDate) {
    return Object.values(deck).filter((c) => c.introducedAt === onDate).length;
  }

  // Two stages: due reviews always win — most overdue first, tie-break by
  // ease ascending (weakest first), then slug for determinism. Otherwise
  // surface the next new card in queue order, unless today's new-card
  // budget is already spent. Returns { slug, isNew, ...card } or null.
  function pickToday(deck, onDate = SM2.today(), { newPerDay = 1 } = {}) {
    const due = dueCards(deck, onDate);
    if (due.length > 0) {
      due.sort(([slugA, a], [slugB, b]) => {
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        if (a.ease !== b.ease) return a.ease - b.ease;
        return slugA < slugB ? -1 : 1;
      });
      const [slug, card] = due[0];
      return { slug, ...card, isNew: false };
    }

    if (introducedToday(deck, onDate) >= newPerDay) return null;
    const fresh = newCards(deck);
    if (fresh.length === 0) return null;
    const [slug, card] = fresh[0];
    return { slug, ...card, isNew: true };
  }

  const Select = { pickToday, dueCards, newCards };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Select;
  } else {
    globalThis.LeetcodeAnki.Select = Select;
  }
})();
