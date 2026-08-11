import { test } from "node:test";
import assert from "node:assert/strict";
import { planIdleCuts } from "../lib/harness.mjs";

/**
 * The numbers below come from a real two-app run against a staging backend:
 * cold boots of twelve to sixteen seconds around interactions of two to five.
 */

const span = ([a, b]) => Number((b - a).toFixed(3));
const total = (keep) => Number(keep.reduce((sum, s) => sum + span(s), 0).toFixed(3));

test("caps a long still at the limit and keeps the rest whole", () => {
  const { keep, removed } = planIdleCuts({
    stretches: [[5, 17]],
    duration: 40,
    maxIdle: 3,
  });

  assert.deepEqual(keep, [
    [0, 8],
    [17, 40],
  ]);
  assert.equal(removed, 9);
  assert.equal(total(keep), 31);
});

test("joins stretches split by a spinner tick before capping", () => {
  // A boot that freezedetect reports in three pieces is one idle moment, so the
  // cap has to apply once. Capping each piece would leave 9s instead of 3s.
  const split = planIdleCuts({
    stretches: [
      [5, 9.6],
      [10, 14.2],
      [14.5, 18],
    ],
    duration: 30,
    maxIdle: 3,
  });

  assert.equal(split.merged.length, 1);
  assert.deepEqual(split.merged[0], [5, 18]);
  assert.equal(split.removed, 10);
  assert.equal(total(split.keep), 20);
});

test("leaves genuinely separate moments alone", () => {
  const { merged } = planIdleCuts({
    stretches: [
      [5, 9],
      [12, 16],
    ],
    duration: 30,
    maxIdle: 3,
  });

  assert.equal(merged.length, 2);
});

test("keeps a still that is already within the limit", () => {
  const { keep, removed } = planIdleCuts({
    stretches: [[4, 6]],
    duration: 20,
    maxIdle: 3,
  });

  assert.equal(removed, 0);
  assert.equal(total(keep), 20);
});

test("handles a run that ends while still frozen", () => {
  const { keep, removed } = planIdleCuts({
    stretches: [[10, 25]],
    duration: 25,
    maxIdle: 3,
  });

  assert.deepEqual(keep, [[0, 13]]);
  assert.equal(removed, 12);
});

test("never drops footage between two idle moments", () => {
  const { keep } = planIdleCuts({
    stretches: [
      [5, 12],
      [20, 28],
    ],
    duration: 35,
    maxIdle: 3,
  });

  // The interaction from 12s to 20s is the point of the recording.
  const covered = (t) => keep.some(([a, b]) => t >= a && t <= b);
  for (const t of [12.5, 15, 19.9]) assert.ok(covered(t), `${t}s was cut`);
});

test("a run with no dead air is left untouched", () => {
  const { keep, removed } = planIdleCuts({
    stretches: [],
    duration: 42,
    maxIdle: 3,
  });

  assert.deepEqual(keep, [[0, 42]]);
  assert.equal(removed, 0);
});
