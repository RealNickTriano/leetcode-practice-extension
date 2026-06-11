// Every LeetCode DOM selector lives here, each with a fallback chain, so a
// site redesign is a one-file fix. Browser-only (content scripts).
(function () {
  // The verdict heading shown after a submission. Primary: LeetCode's own
  // e2e test hook, which has been stable for years. Fallback: any leaf span
  // reading exactly "Accepted" — broader, and can also match rows in the
  // submission-history table, which is why callers must treat a sighting as
  // "at most one prompt per page visit", not as a fresh submission event.
  function findAcceptedVerdict() {
    const direct = document.querySelector('[data-e2e-locator="submission-result"]');
    if (direct) {
      return direct.textContent.trim() === "Accepted" ? direct : null;
    }
    for (const el of document.querySelectorAll("span")) {
      if (el.childElementCount === 0 && el.textContent.trim() === "Accepted") {
        return el;
      }
    }
    return null;
  }

  // The problem title link in the description pane — text like "1. Two Sum".
  // The number-prefix check filters out other links to the same problem
  // (breadcrumbs, related lists). Returns the element to insert after.
  function findTitleAnchor(slug) {
    for (const a of document.querySelectorAll(`a[href^="/problems/${slug}"]`)) {
      if (/^\d+\.\s/.test(a.textContent.trim())) return a;
    }
    return null;
  }

  // Fallback pill anchor when the title isn't rendered (e.g. the Submissions
  // tab): after the Run/Submit button group in the top toolbar. Primary: the
  // submit button's e2e hook (its parent is the button group). Fallback: the
  // legacy #ide-top-btns container.
  function findToolbarAnchor() {
    const submit = document.querySelector('[data-e2e-locator="console-submit-button"]');
    if (submit) return submit.parentElement || submit;
    return document.querySelector("#ide-top-btns");
  }

  // The editor toolbar's "reset to default code" button, identified by its
  // arrow-rotate-left icon (Font Awesome data-icon attributes are stable
  // across LeetCode's class-name churn).
  function findEditorResetButton() {
    const icon = document.querySelector('svg[data-icon="arrow-rotate-left"]');
    return icon ? icon.closest("button") : null;
  }

  // Clicking reset opens a confirmation dialog; this finds its Confirm
  // button once the dialog has rendered.
  function findDialogConfirmButton() {
    for (const btn of document.querySelectorAll('[role="dialog"] button')) {
      if (btn.textContent.trim() === "Confirm") return btn;
    }
    return null;
  }

  // DOM-scraped problem metadata, used only if the GraphQL lookup fails.
  function metaFromDom(slug) {
    let title = (document.title || "").replace(/\s*[-|–]\s*LeetCode.*$/i, "").trim() || slug;
    let questionId = null;

    // The problem-page header is a link to the problem itself, with text
    // like "3. Longest Substring Without Repeating Characters".
    const header = document.querySelector(`a[href^="/problems/${slug}"]`);
    const m = header && header.textContent.trim().match(/^(\d+)\.\s+(.+)$/);
    if (m) {
      questionId = Number(m[1]);
      title = m[2];
    }

    let difficulty = null;
    for (const el of document.querySelectorAll("div, span")) {
      if (el.childElementCount === 0 && /^(Easy|Medium|Hard)$/.test(el.textContent.trim())) {
        difficulty = el.textContent.trim();
        break;
      }
    }

    return { title, questionId, difficulty: difficulty || "Medium", tags: [] };
  }

  globalThis.LeetcodeAnki = globalThis.LeetcodeAnki || {};
  globalThis.LeetcodeAnki.Selectors = {
    findAcceptedVerdict,
    findTitleAnchor,
    findToolbarAnchor,
    findEditorResetButton,
    findDialogConfirmButton,
    metaFromDom,
  };
})();
