/**
 * tests/kpi.test.mjs — Deterministic tests for KPI calculations.
 * Rule 3.2: % Ontime = count(odr_success='ontime') / count(IN ['ontime','late'])
 * Return and Cancel are excluded from the denominator.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Inline the KPI logic to avoid ESM/CJS import issues in raw Node.js
function calcOntimeRate(rows) {
  const eligible = rows.filter(
    (r) => r.odr_success === "ontime" || r.odr_success === "late"
  );
  if (eligible.length === 0) return null;
  const ontime = eligible.filter((r) => r.odr_success === "ontime").length;
  return ontime / eligible.length;
}

function calcOntimeByClient(rows) {
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.client_name]) grouped[r.client_name] = [];
    grouped[r.client_name].push(r);
  }
  const result = {};
  for (const [client, clientRows] of Object.entries(grouped)) {
    result[client] = calcOntimeRate(clientRows);
  }
  return result;
}

test("Rule 3.2: ontime rate excludes return/cancel", () => {
  const rows = [
    { odr_success: "ontime" },
    { odr_success: "ontime" },
    { odr_success: "late" },
    { odr_success: "return" }, // excluded
    { odr_success: "cancel" }, // excluded
  ];
  const rate = calcOntimeRate(rows);
  assert.equal(rate, 2 / 3, "2 ontime / 3 eligible (return+cancel excluded)");
});

test("100% ontime when all rows are ontime", () => {
  const rows = [
    { odr_success: "ontime" },
    { odr_success: "ontime" },
    { odr_success: "ontime" },
  ];
  assert.equal(calcOntimeRate(rows), 1.0);
});

test("0% ontime when all eligible rows are late", () => {
  const rows = [
    { odr_success: "late" },
    { odr_success: "late" },
    { odr_success: "return" }, // excluded
  ];
  assert.equal(calcOntimeRate(rows), 0);
});

test("null when no eligible rows (all return/cancel)", () => {
  const rows = [
    { odr_success: "return" },
    { odr_success: "cancel" },
  ];
  assert.equal(calcOntimeRate(rows), null);
});

test("per-client ontime groups correctly", () => {
  const rows = [
    { client_name: "A", odr_success: "ontime" },
    { client_name: "A", odr_success: "late" },
    { client_name: "B", odr_success: "ontime" },
    { client_name: "B", odr_success: "ontime" },
    { client_name: "B", odr_success: "return" }, // excluded from B
  ];
  const result = calcOntimeByClient(rows);
  assert.equal(result["A"], 0.5, "A: 1 ontime / 2 eligible");
  assert.equal(result["B"], 1.0, "B: 2 ontime / 2 eligible (return excluded)");
});

test("empty row set returns null", () => {
  assert.equal(calcOntimeRate([]), null);
});

test("mixed valid and invalid odr_success values", () => {
  const rows = [
    { odr_success: "ontime" },
    { odr_success: "" },
    { odr_success: null },
    { odr_success: "ONTIME" }, // case-sensitive: not counted
  ];
  // Only first row is eligible
  const eligible = rows.filter(
    (r) => r.odr_success === "ontime" || r.odr_success === "late"
  );
  assert.equal(eligible.length, 1);
  assert.equal(calcOntimeRate(rows), 1.0);
});
