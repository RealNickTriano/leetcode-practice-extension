const { test } = require("node:test");
const assert = require("node:assert/strict");
const Lists = require("../lib/lists.js");

const nc150 = Lists["neetcode-150"].slugs;
const blind75 = Lists["blind-75"].slugs;

test("expected list sizes", () => {
  assert.equal(nc150.length, 150);
  assert.equal(blind75.length, 75);
});

test("no duplicate slugs within a list", () => {
  assert.equal(new Set(nc150).size, nc150.length);
  assert.equal(new Set(blind75).size, blind75.length);
});

test("slugs are well-formed", () => {
  for (const slug of [...nc150, ...blind75]) {
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, slug);
  }
});

test("Blind 75 is a subset of NeetCode 150", () => {
  const all = new Set(nc150);
  const missing = blind75.filter((s) => !all.has(s));
  assert.deepEqual(missing, []);
});
