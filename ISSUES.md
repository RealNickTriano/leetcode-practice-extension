# Known Issues

From a code review on 2026-06-12. Ordered by priority within each section.

## Minor

- **`reviewLog` grows unbounded** (`lib/store.js`) and is rewritten in full
  on every rating. Fine for years at human review rates against the 10 MB
  quota, but worth a cap eventually — nothing reads it yet.
- **Both content scripts run on every `leetcode.com` page**, each with its
  own subtree-wide MutationObserver. They guard and debounce correctly, so
  this is perf noise rather than a bug, but splitting the manifest matches
  (`/problemset*` vs `/problems/*`) would halve the observer load.

## Fixed

### Review prompt missed when the Submissions pane was open during submit (fixed 2026-06-12)

The verdict watch relied on a visibility *edge* of the "Accepted" text. With
the Submissions pane open, old Accepted rows kept the text visible from arm
time onward, so the edge never fired and an accepted submission produced no
rating prompt.

**Fix:** the watch now prefers a navigation signal — submitting takes the
page to the new submission's own URL (`/problems/<slug>/submissions/<id>/`),
and a fresh id while armed pins the watch to that submission's result pane,
which old history rows can't poison. The edge-based detection remains as a
fallback when no navigation is observed.

### Read-modify-write races in the store (fixed 2026-06-12)

Every store operation was `loadRaw() → mutate → set({ decks })`, writing the
entire decks object, with no transactions and up to three contexts writing
concurrently (popup + content scripts in multiple tabs) — a rating in one
tab could be silently clobbered by an add in another.

**Fix:** all storage writes now go through a single store instance in a new
background service worker (`background.js`); content scripts and the popup
get a message proxy (see `lib/store.js`). The store also serializes its
operations through an internal promise queue, covered by a regression test
that loses writes against the old implementation.

### GraphQL-level errors were silently ignored (fixed 2026-06-12)

`lib/api.js` (`gql`) treated a 200 response with an `errors` array as
success, and `fetchQuestionMeta` masked any failure as "slug doesn't exist"
— so a rate-limit during a 150-problem seed silently dropped problems,
seeding a hollow deck.

**Fix:** `gql` now throws on a non-empty `errors` array, and
`fetchQuestionMeta` no longer swallows failures (verified against the live
API: an unknown slug returns `{ data: { question: null } }` with no errors,
so stale list entries still skip gracefully). A bulk seed aborts loudly and
the onboarding card shows "couldn't reach LeetCode — try again"; single-card
adds catch the error and fall back to DOM-scraped metadata.

### Rating overlay fired when opening the Submissions tab (fixed 2026-06-12)

Accepted-detection was single-step: `checkVerdict` prompted whenever an
"Accepted" text newly became visible. The selector fallback matches any leaf
span reading "Accepted", so old rows in the submission-history table
triggered the overlay just by opening the Submissions tab — no submission
required.

**Fix:** detection is now two-step. A click on the Submit button (or
Ctrl/Cmd+Enter) arms a verdict watch for 3 minutes; only an Accepted verdict
that newly appears while armed prompts. A freshly appearing failed verdict
(Wrong Answer, TLE, …) or navigating to another problem disarms the watch —
"freshly appearing" because a stale Wrong Answer still on screen from the
previous attempt must not kill the watch for a re-submission.

### Dialog auto-confirm clicked Confirm in *any* dialog (fixed 2026-06-12)

`content/problem.js` (`attemptDraftReset`) polls for up to ~3 seconds after
clicking LeetCode's editor reset button and clicked the first
`[role="dialog"]` button labeled "Confirm" — whatever dialog that was, so an
unrelated modal opening in that window (premium upsell, submission dialog)
would have been confirmed blindly.

**Fix:** `Selectors.findDialogConfirmButton` now only accepts a Confirm
button whose dialog carries the reset dialog's message ("…discarded and
reset to the default code"), with an ancestor-text fallback in case the
`role="dialog"` wrapper changes.
