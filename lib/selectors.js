// Every LeetCode DOM selector lives here, each with a fallback chain, so a
// site redesign is a one-file fix. Browser-only (content scripts).
(function () {
  // The verdict heading shown after a submission. Primary: LeetCode's own
  // e2e test hook, which has been stable for years. Fallback: any leaf span
  // reading exactly "Accepted" — broader, and can also match rows in the
  // submission-history table, which is why a sighting only counts while a
  // submit-armed watch is active (see checkVerdict in content/problem.js),
  // never as a standalone "fresh submission" signal.
  // The submission-result element in the detail pane (LeetCode's e2e hook),
  // whatever verdict it currently shows — or null while judging.
  function findSubmissionResult() {
    return document.querySelector('[data-e2e-locator="submission-result"]');
  }

  function findAcceptedVerdict() {
    const direct = findSubmissionResult();
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

  // A terminal non-accepted verdict (Wrong Answer, TLE, …) in the result
  // pane. Primary locator only — the span fallback used for Accepted would
  // match old rows in the submission-history table, and this is used to
  // *cancel* a pending verdict watch, so a stale row must never count.
  const FAILED_VERDICTS =
    /^(Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compile Error|Output Limit Exceeded)$/;

  function findFailedVerdict() {
    const direct = findSubmissionResult();
    if (!direct) return null;
    return FAILED_VERDICTS.test(direct.textContent.trim()) ? direct : null;
  }

  // Whether a click landed on the toolbar's Submit button (step 1 of
  // solved-detection: a submission starts with this click). Primary: the
  // e2e hook, checked via closest() because the click target is usually a
  // span inside the button. Fallback: any button reading exactly "Submit".
  function isSubmitButton(el) {
    if (!(el instanceof Element)) return false;
    if (el.closest('[data-e2e-locator="console-submit-button"]')) return true;
    const btn = el.closest("button");
    return !!btn && btn.textContent.trim() === "Submit";
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

  // Clicking reset opens a confirmation dialog ("Are you sure? Your current
  // code will be discarded and reset to the default code!"); this finds its
  // Confirm button once the dialog has rendered. The caller polls for ~3s
  // after clicking reset, so matching any Confirm button would blindly
  // confirm whatever unrelated dialog happens to open in that window — the
  // button only counts if its dialog carries the reset message.
  const RESET_DIALOG_MESSAGE = /discarded and reset to the default code/i;

  function findDialogConfirmButton() {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent.trim() !== "Confirm") continue;
      const dialog = btn.closest('[role="dialog"]');
      if (dialog) {
        if (RESET_DIALOG_MESSAGE.test(dialog.textContent)) return btn;
        continue; // some other dialog's Confirm — not ours
      }
      // Fallback if the dialog wrapper loses its role attribute: climb a few
      // ancestors (stopping short of body) looking for the reset message.
      let el = btn.parentElement;
      for (let depth = 0; el && el !== document.body && depth < 8; depth++) {
        if (RESET_DIALOG_MESSAGE.test(el.textContent)) return btn;
        el = el.parentElement;
      }
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
    findSubmissionResult,
    findAcceptedVerdict,
    findFailedVerdict,
    isSubmitButton,
    findTitleAnchor,
    findToolbarAnchor,
    findEditorResetButton,
    findDialogConfirmButton,
    metaFromDom,
  };
})();
