// Firefox loads the background as an event page — a hidden DOM document — not a
// service worker, so `typeof document === "undefined"` can't identify the
// background context the way it does under Chrome's service worker. This file is
// listed first in the Firefox manifest's background.scripts, before
// lib/store.js decides whether to be the real store or a message-passing proxy,
// so the flag is set by the time that decision runs. Chrome never loads this
// file (it detects the service worker directly) and so never needs the flag.
globalThis.__LEETCODE_ANKI_BACKGROUND__ = true;
