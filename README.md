# Leetcode Anki

Spaced-repetition practice for LeetCode — Anki, but the cards are problems.
When you visit `leetcode.com/problemset/`, the extension pins a "Due Today"
review card above the problem list, chosen by an SM-2 scheduler from your
review history.

Full design doc: open [`PLAN.html`](PLAN.html) in a browser.

## Status: Phase 3

- ✅ Manifest V3 scaffold
- ✅ SM-2 scheduling core (`lib/sm2.js`) and deck selection (`lib/select.js`), unit-tested
- ✅ Content script that finds the problem list (MutationObserver + SPA-nav
  handling) and injects a shadow-DOM review card
- ✅ Deck persistence in `chrome.storage.local` (`lib/store.js`, unit-tested
  against an in-memory backend)
- ✅ Problem pages: "+ Add to Leetcode Anki" pill, Accepted-verdict detection, and
  the Again/Hard/Good/Easy rating overlay with live interval previews
- ✅ The problemset card now reads the real deck: most-overdue card first,
  with "deck is empty" / "all caught up" states
- ✅ Anki-style new queue: cards enter the deck **unscheduled** (`dueDate:
  null`, ordered). The picker is two-stage — due reviews always win; otherwise
  the next new card is surfaced, capped at `newPerDay` (default 1). Skipping
  days never fakes an overdue backlog.
- ✅ First-run onboarding on the problemset page: add an entire curated
  list in one click — everything lands in the new queue in order
- ✅ NeetCode 150 and Blind 75 bundled as source lists (`lib/lists.js`);
  stale or premium-only slugs are skipped automatically
- ✅ Popup: deck browser (due → new queue → scheduled) and a multi-deck
  switcher with create/rename/delete; one deck is selected at a time
- ⬜ Phase 4 remaining: stats, settings UI, and JSON export/import

## Try it

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this directory.
3. Open any problem on LeetCode and click the **"⟳ + Add to Leetcode Anki"** pill
   (bottom-right). The card is due immediately.
4. Visit <https://leetcode.com/problemset/> — the orange "Leetcode Anki · Due Today"
   card shows your most overdue problem.
5. Solve it. When the **Accepted** verdict appears, the rating overlay slides
   in — grade the recall (Again / Hard / Good / Easy) and the next review date
   is scheduled. The problemset card updates to the next due problem, or
   "all caught up".

## Releasing

`npm run package` runs the full test suite and then builds
`leetcode-anki-<version>.zip` (a red test blocks the package). The zip
contains exactly what the manifest references — `manifest.json` at the root,
`content/`, `lib/`, `popup/`, and the four icon PNGs. Tests, docs, configs,
the icon-source SVG, and `node_modules` are excluded; built zips are
gitignored.

Notes:

- **Installing from the zip** — Chrome doesn't load zips directly for
  personal use: either keep using Load Unpacked on this folder, or upload the
  zip to the Chrome Web Store developer dashboard ($5 one-time registration),
  where it can be published unlisted/private.
- **Web Store review** — expect pushback on the name "Leetcode Anki" (two
  third-party trademarks), and have a justification ready for the
  `leetcode.com` host permission. Unlisted listings get the same review as
  public ones.
- **Version bumps** — update `version` in both `manifest.json` and
  `package.json` (keep them in sync); the zip name picks up the version
  automatically.
- Store listing copy lives in [`STORE.md`](STORE.md).

## Run the tests

```sh
npm test        # or: node --test
```

The scheduler is pure functions with no DOM or `chrome.*` dependencies, so it
runs under plain Node.

## Layout

```
manifest.json            MV3 manifest
content/problemset.js    finds the problem list, injects the review card
content/problem.js       add-to-deck pill, Accepted detection, rating overlay
lib/sm2.js               SM-2: rate(card, grade) → card′
lib/select.js            pickToday(deck) → most-overdue due card
lib/store.js             deck persistence over chrome.storage.local
lib/selectors.js         every LeetCode DOM selector, with fallback chains
lib/lists.js             NeetCode 150 + Blind 75 source lists, in study order
lib/api.js               LeetCode GraphQL: question metadata
test/                    node:test suites for scheduler + store
PLAN.html                full project plan (open in a browser)
```

`lib/*.js` files load both as content-script globals (`Leetcode Anki.SM2`,
`Leetcode Anki.Select`) and as Node modules for the tests.
