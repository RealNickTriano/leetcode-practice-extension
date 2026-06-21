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
- ✅ Settings tab in the popup: reset-code-on-review and show-topic-tags
  toggles, new-cards-per-day, and day rollover hour (Anki-style "next day
  starts at 4am"; default midnight)
- ✅ JSON backup: export/import the full state (decks, review log, settings)
  from the popup's settings tab — importing replaces local state
- ✅ Stats tab in the popup: deck maturity (new/learning/mature) and a 7-day
  due forecast; ratings now also log the interval that was tested
- ⬜ Phase 4 remaining: more stats (pass rate, trouble problems, weak topics)

## Try it

### Chrome

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this directory.

### Firefox

Firefox loads a different manifest (`manifest.firefox.json`) — see
[Cross-browser support](#cross-browser-support) for why.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.firefox.json`
   (not `manifest.json`).

Then, in either browser:

3. Open any problem on LeetCode and click the **"⟳ + Add to Leetcode Anki"** pill
   (bottom-right). The card is due immediately.
4. Visit <https://leetcode.com/problemset/> — the orange "Leetcode Anki · Due Today"
   card shows your most overdue problem.
5. Solve it. When the **Accepted** verdict appears, the rating overlay slides
   in — grade the recall (Again / Hard / Good / Easy) and the next review date
   is scheduled. The problemset card updates to the next due problem, or
   "all caught up".

## Cross-browser support

The same source runs on Chrome and Firefox; only the manifest and how the
background loads differ.

- **`manifest.json`** is the Chrome (Manifest V3) manifest. Its background is a
  **service worker** that pulls in `lib/` with `importScripts`.
- **`manifest.firefox.json`** is the Firefox manifest. Firefox runs the
  background as an **event page** (a hidden DOM document, not a service worker),
  so it lists the same files under `background.scripts` instead — `importScripts`
  is unavailable there and `background.js` guards the call. It also adds the
  required `browser_specific_settings.gecko` block.

Two source files bridge the gap:

- `background.js` only calls `importScripts` when it exists (Chrome).
- `lib/store.js` must know when it's the background context (the one real store)
  versus a content script / popup (a message-passing proxy). Chrome's service
  worker has no `document`, which is the tell; Firefox's event page does, so
  `lib/bg-context.js` (first in the Firefox `background.scripts`) sets an
  explicit flag that `store.js` checks.

`strict_min_version` is **128.0**: declarative `"world": "MAIN"` content scripts
(used by `content/netwatch.js`) are only supported from Firefox 128.

## Releasing

`npm run package` runs the full test suite and then builds
`builds/leetcode-anki-<version>.zip` (a red test blocks the package). The zip
contains exactly what the Chrome manifest references — `manifest.json` and
`background.js` at the root, `content/`, `lib/`, `popup/`, and the four
icon PNGs. Tests, docs, configs,
the icon-source SVG, and `node_modules` are excluded; built zips are
gitignored.

`npm run package:firefox` does the same for Firefox, building
`builds/leetcode-anki-firefox-<version>.zip` with `manifest.firefox.json`
staged in as `manifest.json` at the zip root.

Notes:

- **Installing from the zip** — Chrome doesn't load zips directly for
  personal use: either keep using Load Unpacked on this folder, or upload the
  zip to the Chrome Web Store developer dashboard ($5 one-time registration),
  where it can be published unlisted/private.
- **Web Store review** — expect pushback on the name "Leetcode Anki" (two
  third-party trademarks), and have a justification ready for the
  `leetcode.com` host permission. Unlisted listings get the same review as
  public ones.
- **Version bumps** — update `version` in `manifest.json`,
  `manifest.firefox.json`, and `package.json` (keep all three in sync); the zip
  names pick up the version automatically.
- **Firefox / AMO** — submit the `package:firefox` zip to
  [addons.mozilla.org](https://addons.mozilla.org). Run `npx web-ext lint` over
  a staged Firefox build first to catch manifest issues the way AMO review
  will.
  - ⚠️ **Set the add-on ID before the first submission.** `gecko.id` in
    `manifest.firefox.json` is a placeholder (`leetcode-anki@CHANGEME.example.com`).
    Replace it with the owner's address (e.g. `leetcode-anki@yourdomain`) — the
    ID is permanent once published and ties the listing to the owner's AMO
    account, so it shouldn't be guessed by a contributor.
- Store listing copy lives in [`STORE.md`](STORE.md).

## Run the tests

```sh
npm test        # or: node --test
```

The scheduler is pure functions with no DOM or `chrome.*` dependencies, so it
runs under plain Node.

## Layout

```
manifest.json            MV3 manifest (Chrome — service worker background)
manifest.firefox.json    MV3 manifest (Firefox — event-page background)
background.js            background — owns all storage writes
lib/bg-context.js        flags the Firefox event page as the background context
content/problemset.js    finds the problem list, injects the review card
content/problem.js       add-to-deck pill, Accepted detection, rating overlay
lib/sm2.js               SM-2: rate(card, grade) → card′
lib/select.js            pickToday(deck) → most-overdue due card
lib/store.js             deck persistence over chrome.storage.local
lib/stats.js             deck maturity buckets + due-date forecast
lib/selectors.js         every LeetCode DOM selector, with fallback chains
lib/lists.js             NeetCode 150 + Blind 75 source lists, in study order
lib/api.js               LeetCode GraphQL: question metadata
test/                    node:test suites for scheduler + store
PLAN.html                full project plan (open in a browser)
```

`lib/*.js` files load both as content-script globals (`Leetcode Anki.SM2`,
`Leetcode Anki.Select`) and as Node modules for the tests.
