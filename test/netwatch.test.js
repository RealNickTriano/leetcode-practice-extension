const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchSubmit, matchCheck, createVerdictTracker } = require("../content/netwatch.js");

const SUBMIT = "https://leetcode.com/problems/two-sum/submit/";
const CHECK = "https://leetcode.com/submissions/detail/42/v2/check/";

function tracker() {
  const emitted = [];
  const onResponse = createVerdictTracker((v) => emitted.push(v));
  return { onResponse, emitted };
}

test("submit then Accepted check emits once with slug and id", () => {
  const { onResponse, emitted } = tracker();
  onResponse(SUBMIT, { submission_id: 42 });
  // Real v2 finished shape: state SUCCESS, status_code 10, status_msg Accepted.
  onResponse(CHECK, { state: "SUCCESS", status_code: 10, status_msg: "Accepted", run_success: true });
  assert.deepEqual(emitted, [{ status: "Accepted", slug: "two-sum", id: "42" }]);
});

test("verdict falls back to status_code when status_msg is absent", () => {
  const { onResponse, emitted } = tracker();
  onResponse(SUBMIT, { submission_id: 42 });
  onResponse(CHECK, { state: "SUCCESS", status_code: 10 }); // no status_msg
  assert.deepEqual(emitted, [{ status: "Accepted", slug: "two-sum", id: "42" }]);
});

test("intermediate judging states don't emit; only SUCCESS does", () => {
  const { onResponse, emitted } = tracker();
  onResponse(SUBMIT, { submission_id: 42 });
  // Real poll cycle: PENDING -> RUNNING_TESTS -> SUCCESS. The non-terminal
  // states must not emit a premature (null) verdict and clear `pending`.
  onResponse(CHECK, { state: "PENDING" });
  onResponse(CHECK, { state: "RUNNING_TESTS" });
  assert.equal(emitted.length, 0);
  onResponse(CHECK, { state: "SUCCESS", status_msg: "Accepted" });
  assert.deepEqual(emitted, [{ status: "Accepted", slug: "two-sum", id: "42" }]);
});

test("a check with no preceding submit is ignored", () => {
  const { onResponse, emitted } = tracker();
  onResponse(CHECK, { state: "SUCCESS", status_msg: "Accepted" });
  assert.equal(emitted.length, 0);
});

test("Run (interpret_solution) never misfires", () => {
  const { onResponse, emitted } = tracker();
  // Run polls a check for an id that no submit ever named.
  onResponse("https://leetcode.com/submissions/detail/interpret-id/check/", {
    state: "SUCCESS",
    status_msg: "Accepted",
  });
  assert.equal(emitted.length, 0);
});

test("a failed verdict still emits its status — the gate decides, not the core", () => {
  const { onResponse, emitted } = tracker();
  onResponse(SUBMIT, { submission_id: 42 });
  onResponse(CHECK, { state: "SUCCESS", status_msg: "Wrong Answer" });
  assert.deepEqual(emitted, [{ status: "Wrong Answer", slug: "two-sum", id: "42" }]);
});

test("each finished submission emits once (id cleared after a verdict)", () => {
  const { onResponse, emitted } = tracker();
  onResponse(SUBMIT, { submission_id: 42 });
  onResponse(CHECK, { state: "SUCCESS", status_msg: "Accepted" });
  onResponse(CHECK, { state: "SUCCESS", status_msg: "Accepted" }); // duplicate poll
  assert.equal(emitted.length, 1);
});

test("matchSubmit / matchCheck accept real shapes and reject others", () => {
  assert.equal(matchSubmit(SUBMIT), "two-sum");
  assert.equal(matchSubmit("/problems/lru-cache/submit/"), "lru-cache"); // relative
  assert.equal(matchSubmit("/problems/two-sum/interpret_solution/"), null);
  assert.equal(matchSubmit(CHECK), null);

  assert.equal(matchCheck(CHECK), "42"); // v2 shape
  assert.equal(matchCheck("/submissions/detail/999/v2/check/"), "999"); // relative v2
  assert.equal(matchCheck("/submissions/detail/999/check/"), "999"); // legacy shape
  assert.equal(matchCheck(SUBMIT), null);
  assert.equal(matchCheck("/submissions/detail/abc/check/"), null); // non-numeric
});
