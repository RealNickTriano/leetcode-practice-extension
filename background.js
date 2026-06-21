// Background service worker: the single owner of all storage writes.
// Content scripts and the popup proxy their store calls here as messages
// (see lib/store.js), so read-modify-write operations from any number of
// tabs serialize through one store instance — chrome.storage has no
// transactions, and concurrent writers would clobber each other.
// Chrome runs this as a service worker, where the lib modules must be pulled
// in with importScripts. Firefox runs it as an event page and loads those same
// files via the manifest's background.scripts array, so importScripts is absent
// there — guard the call so this one file works under both browsers.
if (typeof importScripts === "function") {
  importScripts("lib/sm2.js", "lib/store.js");
}

const { store, settingsReady } = globalThis.LeetcodeAnki;
const METHODS = new Set(Object.keys(store));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "leetcode-anki:store" || !METHODS.has(msg.method)) {
    return false;
  }
  // Wait for the day-rollover hour to be synced from settings on a cold
  // worker start — store ops stamp dates with SM2.today().
  settingsReady
    .then(() => store[msg.method](...(msg.args || [])))
    .then(
    (result) => sendResponse({ ok: true, result }),
    (e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
  );
  return true; // async response — keep the channel open
});
