# Manual browser test plan

End-to-end checks to run in Chrome before a release. The unit suite covers
the pure core (scheduler, picker, store, stats); everything here is what it
*can't* cover — MV3 worker messaging and lifecycle, LeetCode DOM
integration, and the popup UI.

Setup: `chrome://extensions` → Developer mode → Load unpacked on this
directory (or drop the built zip's contents). Start from a clean profile or
clear the extension's storage for the onboarding checks.

## 1. Background worker & storage (highest risk — every store call crosses a message boundary)

- [ ] **Cold start.** Right after loading the extension, open the popup
      before visiting any LeetCode page. Deck view renders (no "no response
      from background worker" errors).
- [ ] **Worker idle restart.** Open a problem page, wait ≥60s without
      touching anything (the worker idles out ~30s), then click the pill's
      add button. The card is added — the message wakes the worker.
- [ ] **Two-tab serialization.** Open two tabs on the problemset page. Add
      cards rapidly via the row "+" buttons in both tabs, alternating. Open
      the popup: every clicked card is present (no lost writes).
- [ ] **Cross-tab live update.** With the popup open, rate a card in a tab.
      The popup re-renders the new due date without being reopened.
- [ ] **Extension reload while a tab is open.** Reload the extension, then
      use the already-open LeetCode tab. Stale content scripts may error
      (acceptable) but a page refresh restores everything.

## 2. Onboarding & deck building

- [ ] **Empty-deck card.** On `leetcode.com/problemset/` with an empty deck,
      the onboarding card shows list buttons (no import button — that
      feature was removed).
- [ ] **Seed NeetCode 150.** Click it. Progress counter ticks ("fetching
      N/150…"), deck takes the list's name, problems land in the new queue
      in study order, review card shows the first problem as "new".
- [ ] **Seed failure.** With network blocked (DevTools offline), the button
      shows "couldn't reach LeetCode — try again" and the deck stays empty —
      no partial import.
- [ ] **Row "+" buttons.** Hover a problem row → "+" appears; click adds
      without navigating; button flips to the extension icon ("In deck").
      Survives pagination and filtering.
- [ ] **Problem-page pill.** "+ Add to Leetcode Anki" next to the title;
      after adding it shows "in deck · new" with a working remove (✕ arms
      "sure?" first). Pill survives switching Description/Submissions tabs
      and SPA navigation between problems.

## 3. Submission detection (network-based — content/netwatch.js wraps the page's fetch/XHR in the MAIN world and postMessages the verdict)

- [ ] **Plain flow.** Open a due/new deck problem, submit a correct solution.
      Rating overlay appears once on Accepted.
- [ ] **Keyboard submit.** Ctrl/Cmd+Enter instead of the Submit button.
      Overlay still appears on Accepted (detection is at the network layer, so
      how you triggered the submit doesn't matter).
- [ ] **Run never prompts.** Click **Run** (not Submit) with passing sample
      cases. No overlay — Run uses a different endpoint.
- [ ] **Failed submit never prompts.** Submit a wrong solution. No overlay.
- [ ] **Browsing only never prompts.** With a due card's problem open, browse
      the Submissions tab and open old Accepted submissions without submitting.
      No overlay (no submit request is made).
- [ ] **Navigate away before the verdict.** Submit, then immediately switch to
      a different problem before judging finishes. No overlay on the new
      problem (the verdict's slug no longer matches the open one).
- [ ] **Non-deck problem.** Submit an accepted solution on a problem not in
      the deck. No overlay.
- [ ] **Future-scheduled card.** Rate a card (due in N days), resubmit the
      same problem. No overlay — it's not due.
- [ ] **No console errors** from the wrapped fetch/XHR during running,
      submitting, and ordinary navigation.

## 4. Review flow

- [ ] **Rating overlay.** All four buttons show distinct interval previews;
      Escape and the backdrop close it; choosing a grade shows the "next
      review in Nd" toast and the problemset card moves to the next pick.
- [ ] **Reset code on review.** With the setting on, opening a due deck
      problem resets the editor to the template (confirm dialog handled
      automatically). Opening it a second time the same day does NOT reset
      (work-in-progress guard). With the setting off, never resets.
- [ ] **Reset never confirms a foreign dialog.** While on a problem with a
      pending reset, no other dialog (premium modal etc.) gets auto-confirmed
      — only the "discarded and reset to the default code" dialog.
- [ ] **Due Today card states.** Most-overdue card first; "all caught up"
      with next-review date when nothing is due; new-card introduction
      respects the new-per-day cap (rate today's new card, card shows the
      next due review or caught-up, not another new card).

## 5. Popup

- [ ] **Deck browser.** Rows grouped due → new queue → scheduled; counts
      header correct; click-through opens the problem; ✕ removes (armed).
- [ ] **Deck switcher.** Create (auto-selects), rename (prefilled input,
      Enter commits, Escape closes), delete (armed "sure?"), deleting the
      last deck leaves an empty Default. Switching decks closes an open
      rename row.
- [ ] **Stats tab.** Maturity bar segments and counts match the deck; the
      7-day forecast's today column includes overdue cards; updates live
      after rating in another tab.
- [ ] **Settings persist.** Toggle each setting, close and reopen the popup
      — values stick. New-per-day and rollover steppers clamp (try typing
      99 and -3).

## 6. Settings behavior (not just persistence)

- [ ] **New cards per day.** Set to 2 with a seeded deck: two new cards get
      introduced today (rate the first; the card offers the second).
- [ ] **Day rollover hour.** Set to 4. Between midnight and 4am, the
      problemset card and popup count a just-after-midnight session as the
      previous day (or: verify "today" labels don't flip at midnight).
- [ ] **Show topic tags off.** Problemset review card hides the tag chips;
      the reps/last-grade line remains.

## 7. Backup

- [ ] **Export.** Downloads `leetcode-anki-backup-<date>.json` containing
      decks, reviewLog, settings.
- [ ] **Import replaces.** Modify the deck after exporting (add/remove a
      card), then import the file (button arms "sure?" first). State matches
      the backup exactly; deck view re-renders; "imported ✓" flashes.
- [ ] **Import garbage.** Pick a non-JSON file → "not a JSON file"; a JSON
      file without decks → "invalid backup: no decks". State untouched.
- [ ] **Cross-machine.** Import the export on a second profile/machine —
      decks, schedule, settings, and selected deck all carry over.

## 8. Visual / environment

- [ ] **Light mode.** `prefers-color-scheme: light` — problemset card text
      is readable (it has light-mode overrides).
- [ ] **No console errors** on problemset, problem page, and popup during
      all of the above.
- [ ] **Packaged zip.** Load the unpacked *zip contents* (not the repo) once
      — confirms the manifest references nothing outside the package.
