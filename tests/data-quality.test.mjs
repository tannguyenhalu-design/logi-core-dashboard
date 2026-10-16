/**
 * tests/data-quality.test.mjs — Tests for the quality score formula.
 * computeQualityScore: 6 criteria, 0-100, GREEN≥80 / YELLOW50-79 / RED<50
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Inline the quality score logic (mirrors lib/data-health.js computeQualityScore)
const SHEET_ERRORS = ["#N/A", "#VALUE!", "#REF!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!"];
const SCAN_FIELDS = ["order_code", "client_name", "kho_lay", "kho_giao", "from_province_name", "to_province_name", "status", "pickup_time"];

function hasError(v) {
  const s = String(v ?? "");
  return SHEET_ERRORS.some((e) => s.startsWith(e));
}

function scanDataHealth(ltlRows) {
  let errorCells = 0, zeroWeight = 0, emptyKhoLay = 0, emptyKhoGiao = 0;
  let emptyOrderCode = 0, nullPickupTimes = 0, emptyProject = 0;
  const codeCounts = new Map();

  for (const r of ltlRows) {
    for (const f of SCAN_FIELDS) {
      if (hasError(r[f])) errorCells++;
    }
    if (!Number(r.weight || 0)) zeroWeight++;
    if (!String(r.kho_lay || "").trim()) emptyKhoLay++;
    if (!String(r.kho_giao || "").trim()) emptyKhoGiao++;
    if (!String(r.pickup_time || "").trim()) nullPickupTimes++;
    if (!String(r.client_name || "").trim()) emptyProject++;
    const code = String(r.order_code || "").trim();
    if (!code) emptyOrderCode++;
    else codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
  }
  const duplicateOrderCodes = [...codeCounts.values()].filter((n) => n > 1).length;
  return { errorCells, zeroWeight, emptyKhoLay, emptyKhoGiao, emptyOrderCode, nullPickupTimes, duplicateOrderCodes, emptyProject, total: ltlRows.length };
}

function computeQualityScore(base) {
  if (!base?.ltlRows) return { score: 0, status: "RED", breakdown: { reason: "No snapshot" } };

  const dh = scanDataHealth(base.ltlRows);
  const total = Math.max(dh.total, 1);

  const missingRequired = dh.emptyOrderCode + dh.emptyProject + dh.nullPickupTimes;
  const missingRate = missingRequired / total;
  const completeness = Math.max(0, Math.round(25 * (1 - Math.min(missingRate * 10, 1))));

  const maxErrors = total * SCAN_FIELDS.length;
  const errorRate = maxErrors > 0 ? dh.errorCells / maxErrors : 0;
  const validity = Math.max(0, Math.round(20 * (1 - Math.min(errorRate * 20, 1))));

  const dupRate = dh.duplicateOrderCodes / total;
  const uniqueness = Math.max(0, Math.round(20 * (1 - Math.min(dupRate * 100, 1))));

  const ageMs = base.builtAt ? Date.now() - new Date(base.builtAt).getTime() : Infinity;
  const ageHrs = ageMs / 3_600_000;
  const freshness = ageHrs < 6 ? 15 : ageHrs < 12 ? 12 : ageHrs < 24 ? 6 : 0;

  const volumeOk = total >= 100 && total <= 600_000;
  const volumeAnomaly = volumeOk ? 10 : 0;

  const khoEmptyRate = (dh.emptyKhoLay + dh.emptyKhoGiao) / (total * 2);
  const referentialConsistency = Math.max(0, Math.round(10 * (1 - Math.min(khoEmptyRate * 5, 1))));

  const score = completeness + validity + uniqueness + freshness + volumeAnomaly + referentialConsistency;
  const status = score >= 80 ? "GREEN" : score >= 50 ? "YELLOW" : "RED";
  return { score, status, breakdown: { completeness: { score: completeness, max: 25 }, validity: { score: validity, max: 20 }, uniqueness: { score: uniqueness, max: 20 }, freshness: { score: freshness, max: 15 }, volumeAnomaly: { score: volumeAnomaly, max: 10 }, referentialConsistency: { score: referentialConsistency, max: 10 } } };
}

function makeGoodRow(i) {
  return {
    order_code: `ORD${String(i).padStart(6, "0")}`,
    client_name: "Aqua VN",
    status: "delivered",
    pickup_time: "2026-10-01T08:00:00",
    kho_lay: "HAN1",
    kho_giao: "HAN2",
    from_province_name: "Hà Nội",
    to_province_name: "Hải Phòng",
  };
}

const goodRows = Array.from({ length: 500 }, (_, i) => makeGoodRow(i));

test("GREEN score ≥ 80 with clean data and fresh snapshot", () => {
  const base = {
    ltlRows: goodRows,
    builtAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), // 3h ago
  };
  const { score, status } = computeQualityScore(base);
  assert.ok(score >= 80, `Expected GREEN (≥80), got ${score}`);
  assert.equal(status, "GREEN");
});

test("RED score < 50 when no snapshot", () => {
  const { score, status } = computeQualityScore(null);
  assert.equal(score, 0);
  assert.equal(status, "RED");
});

test("volumeAnomaly score = 0 when row count < 100, reduces total score", () => {
  const fewRows = Array.from({ length: 5 }, (_, i) => makeGoodRow(i));
  const manyRows = Array.from({ length: 500 }, (_, i) => makeGoodRow(i));
  const ts = new Date(Date.now() - 1_800_000).toISOString(); // 30min ago

  const fewBase = { ltlRows: fewRows, builtAt: ts };
  const manyBase = { ltlRows: manyRows, builtAt: ts };

  const fewResult = computeQualityScore(fewBase);
  const manyResult = computeQualityScore(manyBase);

  assert.equal(fewResult.breakdown.volumeAnomaly.score, 0, "volumeAnomaly = 0 for < 100 rows");
  assert.equal(manyResult.breakdown.volumeAnomaly.score, 10, "volumeAnomaly = 10 for 500 rows");
  assert.ok(fewResult.score < manyResult.score, "low volume reduces total score");
});

test("freshness drops to 0 after 24h", () => {
  const base = {
    ltlRows: goodRows,
    builtAt: new Date(Date.now() - 25 * 3_600_000).toISOString(), // 25h ago
  };
  const { breakdown } = computeQualityScore(base);
  assert.equal(breakdown.freshness.score, 0, "freshness should be 0 after 24h");
});

test("uniqueness penalized for duplicates", () => {
  const dupRows = [
    ...goodRows,
    ...goodRows.slice(0, 50), // 50 duplicate order codes
  ];
  const base = { ltlRows: dupRows, builtAt: new Date(Date.now() - 1_800_000).toISOString() };
  const cleanBase = { ltlRows: goodRows, builtAt: new Date(Date.now() - 1_800_000).toISOString() };
  const clean = computeQualityScore(cleanBase);
  const withDups = computeQualityScore(base);
  assert.ok(withDups.breakdown.uniqueness.score < clean.breakdown.uniqueness.score, "duplicates lower uniqueness score");
});

test("completeness penalized for missing required fields", () => {
  const badRows = Array.from({ length: 200 }, (_, i) => ({
    order_code: `ORD${i}`,
    // missing: client_name, pickup_time
    status: "delivered",
  }));
  const base = { ltlRows: badRows, builtAt: new Date(Date.now() - 1_800_000).toISOString() };
  const { breakdown } = computeQualityScore(base);
  assert.ok(breakdown.completeness.score < 25, `completeness should be less than 25 with missing fields, got ${breakdown.completeness.score}`);
});

test("score components sum to total", () => {
  const base = { ltlRows: goodRows, builtAt: new Date(Date.now() - 1_800_000).toISOString() };
  const { score, breakdown } = computeQualityScore(base);
  const sum = Object.values(breakdown).reduce((s, b) => s + (b.score ?? 0), 0);
  assert.equal(sum, score, "sum of breakdown.score should equal total score");
});
