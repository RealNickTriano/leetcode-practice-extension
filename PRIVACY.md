# Privacy Policy — Leetcode Anki

_Last updated: June 12, 2026_

Leetcode Anki is a browser extension that adds spaced-repetition practice
scheduling to leetcode.com.

## Data collection

**Leetcode Anki does not collect, transmit, sell, or share any data.** There
is no server, no account, no analytics, and no tracking of any kind.

## Data storage

All extension data is stored locally on your device using the browser's
`chrome.storage.local` API. This consists of:

- the LeetCode problems you choose to add to your practice decks;
- each problem's scheduling state (ease factor, review interval, due date);
- a log of the review ratings you assign yourself;
- extension settings.

This data never leaves your browser. Uninstalling the extension deletes it.

## Network requests

The extension runs only on leetcode.com. It makes requests solely to
LeetCode's own API (`leetcode.com/graphql`), using your existing LeetCode
session, to read problem metadata (title, difficulty, topic tags). The
responses are stored locally as described above and are not sent anywhere
else. No requests are made to any other domain.

## Permissions

- **storage** — to keep your deck and review schedule on your device.
- **leetcode.com host access** — to display the daily recommended problem on
  the problems page, add "add to deck" buttons, and detect accepted
  submissions so you can rate your recall.

## Changes

If this policy ever changes, the updated version will be posted at this same
URL with a revised date.
