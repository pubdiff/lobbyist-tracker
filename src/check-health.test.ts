import { test } from "node:test";
import assert from "node:assert/strict";
import { assessSourceHealth } from "./check-health.ts";

test("a source with no snapshot this run fails (the VIC drop case)", () => {
  assert.equal(assessSourceHealth(false, 263, null).ok, false);
  assert.equal(assessSourceHealth(false, null, null).ok, false);
});

test("zero records fails", () => {
  assert.equal(assessSourceHealth(true, 457, 0).ok, false);
});

test("bootstrap / no prior snapshot passes", () => {
  assert.equal(assessSourceHealth(true, null, 263).ok, true);
  assert.equal(assessSourceHealth(true, 0, 263).ok, true);
});

test("a sharp count drop fails (partial fetch)", () => {
  assert.equal(assessSourceHealth(true, 457, 200).ok, false); // ~56%
  assert.equal(assessSourceHealth(true, 128, 80).ok, false); // ~37%
});

test("normal week-to-week churn passes", () => {
  assert.equal(assessSourceHealth(true, 457, 455).ok, true);
  assert.equal(assessSourceHealth(true, 263, 268).ok, true); // growth
  assert.equal(assessSourceHealth(true, 126, 120).ok, true); // ~5% drop
});

test("threshold is configurable", () => {
  assert.equal(assessSourceHealth(true, 100, 80, 0.1).ok, false); // 20% > 10%
  assert.equal(assessSourceHealth(true, 100, 80, 0.5).ok, true); // 20% < 50%
});
