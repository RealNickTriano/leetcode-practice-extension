// MAIN-world network watcher for submission verdicts. Runs in the page's own
// JS context (manifest content_scripts "world": "MAIN") so it can see the
// requests LeetCode's React app makes — a content script in the isolated world
// would only ever patch its own fetch, never the page's.
//
// LeetCode delivers a verdict over the wire, not just the DOM: a submit POST
//   POST /problems/<slug>/submit/            -> { submission_id }
// is followed by polling
//   GET  /submissions/detail/<id>/check/     -> { state, status_msg, ... }
// until state === "SUCCESS". We correlate the two so only a real submission's
// verdict counts (a "Run" uses /interpret_solution/ with its own id, so it is
// never mistaken for a submission), then postMessage it across to the isolated
// content script (content/problem.js), which owns the deck/due gate + overlay.
//
// Pure core (URL matchers + the correlating tracker) is dual-exported for node
// tests, the same way lib/sm2.js and lib/store.js are.
(function () {
  const SUBMIT_RE = /\/problems\/([^/]+)\/submit\/?$/;
  // The poll endpoint is /submissions/detail/<id>/v2/check/ on the current
  // site; the /v2/ is optional so the older /check/ shape still matches.
  const CHECK_RE = /\/submissions\/detail\/(\d+)\/(?:v2\/)?check\/?$/;

  // The poll cycles through judging states (PENDING, RUNNING_TESTS, …) and
  // lands on "SUCCESS" once the verdict is in — that's the only terminal
  // state, so match it exactly rather than trying to enumerate the rest.
  const FINISHED = "SUCCESS";

  // The human verdict. Prefer status_msg ("Accepted"/"Wrong Answer"/…); fall
  // back to the numeric status_code (10 === Accepted) if it's ever absent.
  function verdictStatus(json) {
    if (json.status_msg) return json.status_msg;
    if (json.status_code === 10) return "Accepted";
    return null;
  }

  function matchSubmit(url) {
    const m = SUBMIT_RE.exec(url || "");
    return m ? m[1] : null; // the problem slug
  }

  function matchCheck(url) {
    const m = CHECK_RE.exec(url || "");
    return m ? m[1] : null; // the submission id
  }

  // Feed it every (matching) response; it emits once per finished submission.
  // The submit response names the real submission id; only check responses for
  // that id, once judged (state SUCCESS), are verdicts. emit gets every final
  // verdict (Accepted or not) — the content script decides what to act on.
  function createVerdictTracker(emit) {
    let pending = null; // { id, slug }
    return function onResponse(url, json) {
      const submitSlug = matchSubmit(url);
      if (submitSlug && json && json.submission_id != null) {
        pending = { id: String(json.submission_id), slug: submitSlug };
        return;
      }
      const checkId = matchCheck(url);
      if (
        checkId &&
        pending &&
        checkId === pending.id &&
        json &&
        json.state === FINISHED
      ) {
        emit({ status: verdictStatus(json), slug: pending.slug, id: checkId });
        pending = null;
      }
    };
  }

  const core = { matchSubmit, matchCheck, createVerdictTracker };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = core;
    return;
  }
  if (typeof window === "undefined") return;

  // ---------- browser install (MAIN world) ----------

  // Off in prod. Flip on without editing code by running
  //   localStorage.setItem("leetcode-anki:debug", "1")
  // in the page console and reloading — the same key also turns on the
  // content-script side (content/problem.js), since they share localStorage.
  const DEBUG = (() => {
    try {
      return localStorage.getItem("leetcode-anki:debug") === "1";
    } catch {
      return false;
    }
  })();
  const log = (...a) => DEBUG && console.log("[la netwatch]", ...a);

  const tracked = createVerdictTracker((v) => {
    log("verdict →", v.status, "slug", v.slug, "id", v.id);
    try {
      window.postMessage(
        { source: "leetcode-anki", kind: "verdict", status: v.status, slug: v.slug, id: v.id },
        location.origin
      );
    } catch {
      // postMessage should never throw for a plain object, but never let the
      // watcher disturb the page.
    }
  });

  function onResponse(url, json) {
    const slug = matchSubmit(url);
    if (slug) log("submit response", slug, "→ submission_id", json && json.submission_id);
    else if (matchCheck(url)) log("check response", json && json.state, json && json.status_msg);
    tracked(url, json);
  }

  // Only matching URLs are parsed, so every other request is untouched.
  function relevant(url) {
    return !!(matchSubmit(url) || matchCheck(url));
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const res = origFetch.apply(this, args);
      try {
        const req = args[0];
        const url = typeof req === "string" ? req : req && req.url ? req.url : "";
        if (relevant(url)) {
          res
            .then((r) => r.clone().json())
            .then((json) => onResponse(url, json))
            .catch(() => {});
        }
      } catch {
        // never break the real request
      }
      return res;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url, ...rest) {
      this.__la_url = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function (...args) {
      try {
        if (relevant(this.__la_url)) {
          this.addEventListener("load", () => {
            try {
              if (this.readyState === 4 && this.status >= 200 && this.status < 300) {
                onResponse(this.__la_url, JSON.parse(this.responseText));
              }
            } catch {
              // non-JSON or parse error — ignore
            }
          });
        }
      } catch {
        // never break the real request
      }
      return origSend.apply(this, args);
    };
  }
})();
