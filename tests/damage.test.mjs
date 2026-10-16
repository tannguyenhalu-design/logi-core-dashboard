/**
 * tests/damage.test.mjs — Deterministic tests for damage counting logic.
 * Tests countedDamage() flag behavior and compAmount() field fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Inline damage-rules.js pure logic
function flag(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "x" || s === "yes" || s === "có" || s === "co";
}

function countedDamage(rows = []) {
  const hasFlag = rows.some((r) => String(r.counted ?? "").trim() !== "");
  return hasFlag ? rows.filter((r) => flag(r.counted)) : rows;
}

const COMP_AMOUNT_FIELDS = ["comp_amount_latest", "comp_amount"];

function compAmount(r) {
  for (const f of COMP_AMOUNT_FIELDS) {
    const v = r[f];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      const n = Number(v);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

test("countedDamage: when no rows have counted flag, return all rows", () => {
  const rows = [
    { order_code: "A" },
    { order_code: "B" },
    { order_code: "C" },
  ];
  const result = countedDamage(rows);
  assert.equal(result.length, 3, "all rows returned when no counted flag");
});

test("countedDamage: filter to only rows with counted=true/1/x/có", () => {
  const rows = [
    { order_code: "A", counted: "true" },
    { order_code: "B", counted: "" },
    { order_code: "C", counted: "1" },
    { order_code: "D", counted: "x" },
    { order_code: "E", counted: "có" },
    { order_code: "F", counted: "false" },
  ];
  const result = countedDamage(rows);
  const codes = result.map((r) => r.order_code);
  assert.deepEqual(codes, ["A", "C", "D", "E"], "only truthy counted rows");
});

test("countedDamage: empty array returns empty array", () => {
  assert.deepEqual(countedDamage([]), []);
});

test("compAmount: prefers comp_amount_latest over comp_amount", () => {
  const row = { comp_amount_latest: 500_000, comp_amount: 100_000 };
  assert.equal(compAmount(row), 500_000);
});

test("compAmount: falls back to comp_amount when latest is missing", () => {
  const row = { comp_amount_latest: null, comp_amount: 100_000 };
  assert.equal(compAmount(row), 100_000);
});

test("compAmount: returns 0 when both fields missing", () => {
  assert.equal(compAmount({}), 0);
});

test("compAmount: returns 0 when value is empty string", () => {
  const row = { comp_amount_latest: "", comp_amount: "" };
  assert.equal(compAmount(row), 0);
});

test("compAmount: handles numeric string values", () => {
  const row = { comp_amount_latest: "300000" };
  assert.equal(compAmount(row), 300_000);
});

test("damage total: sum compAmount across countedDamage rows", () => {
  const rows = [
    { order_code: "A", counted: "true", comp_amount_latest: 500_000 },
    { order_code: "B", counted: "false", comp_amount_latest: 200_000 }, // excluded
    { order_code: "C", counted: "x", comp_amount: 150_000 },
  ];
  const eligible = countedDamage(rows);
  const total = eligible.reduce((sum, r) => sum + compAmount(r), 0);
  assert.equal(total, 650_000, "A+C only (B excluded by counted=false)");
});
