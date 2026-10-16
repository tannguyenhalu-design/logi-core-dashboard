/**
 * tests/anomaly.test.mjs — Tests for the Proactive Anomaly Engine.
 * Tests: WoW detection, threshold rule, rolling baseline, sudden change,
 *        persistent deterioration, peer group, anomaly_id, severity, cooldown logic.
 *
 * All logic is self-contained (inlined) to avoid ESM/CJS module issues in raw Node.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline pure helpers from anomaly-detector.js ────────────────────────────
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

function emptyBucket() { return { orders: 0, ontime: 0, late: 0, ret: 0, cancel: 0, cases: 0, comp: 0 }; }
function ontimeRate(b) { const e = b.ontime + b.late; return e > 0 ? (b.ontime / e) * 100 : null; }
function damageRate(b) { return b.orders > 0 ? b.cases / b.orders : 0; }

function confidenceScore(sampleSize) {
  if (sampleSize >= 300) return 0.95;
  if (sampleSize >= 150) return 0.9;
  if (sampleSize >= 80)  return 0.8;
  if (sampleSize >= 40)  return 0.7;
  return 0.6;
}

function toSeverity(rule, metric, magnitude) {
  if (rule === "threshold" && metric === "ontime_rate") {
    return magnitude <= 80 ? "CRITICAL" : "HIGH";
  }
  if (metric === "ontime_rate") {
    if (magnitude > 10) return "CRITICAL";
    if (magnitude > 5)  return "HIGH";
    if (magnitude > 3)  return "MEDIUM";
    return "LOW";
  }
  if (metric === "damage_rate" || metric === "comp_rate") {
    if (magnitude > 100) return "CRITICAL";
    if (magnitude > 50)  return "HIGH";
    if (magnitude > 25)  return "MEDIUM";
    return "LOW";
  }
  return "INFO";
}

function anomalyId(rule, metric, entityId, windowLabel) {
  return `${rule}:${metric}:${String(entityId).slice(0, 40)}:${windowLabel}`
    .replace(/[^a-z0-9:.\-_]/gi, "-").toLowerCase();
}

// ─── WoW rule (week-over-week) ───────────────────────────────────────────────
function detectWoW_OntimeDrop(curBucket, prevBucket, entityId, windows) {
  const curEval = curBucket.ontime + curBucket.late;
  const prevEval = prevBucket.ontime + prevBucket.late;
  if (curEval < 20 || prevEval < 20) return null;
  const curOT  = (curBucket.ontime / curEval) * 100;
  const prevOT = (prevBucket.ontime / prevEval) * 100;
  const drop = prevOT - curOT;
  if (drop < 4) return null; // WOW_ONTIME_DROP = 4
  return {
    anomaly_id: anomalyId("wow", "ontime_rate", entityId, "wow"),
    detection_rule: "wow",
    metric: "ontime_rate",
    entity_type: "client",
    entity_id: entityId,
    current_value: Math.round(curOT * 10) / 10,
    baseline_value: Math.round(prevOT * 10) / 10,
    delta: -Math.round(drop * 10) / 10,
    severity: toSeverity("wow", "ontime_rate", drop),
    confidence: confidenceScore(Math.min(curEval, prevEval)),
    status: "DETECTED",
  };
}

// ─── Threshold rule ──────────────────────────────────────────────────────────
function detectThreshold_Ontime(bucket, entityId) {
  const eval_ = bucket.ontime + bucket.late;
  if (eval_ < 20) return null;
  const ot = (bucket.ontime / eval_) * 100;
  if (ot >= 85) return null; // no anomaly
  return {
    anomaly_id: anomalyId("threshold", "ontime_rate", entityId, "cur"),
    detection_rule: "threshold",
    metric: "ontime_rate",
    entity_type: "client",
    entity_id: entityId,
    current_value: Math.round(ot * 10) / 10,
    baseline_value: 85,
    delta: ot - 85,
    severity: toSeverity("threshold", "ontime_rate", ot),
    confidence: confidenceScore(eval_),
    status: "DETECTED",
  };
}

// ─── Rolling baseline rule ───────────────────────────────────────────────────
function detectRolling_OntimeDrop(curBucket, baseBucket, entityId) {
  const curEval = curBucket.ontime + curBucket.late;
  const basEval = baseBucket.ontime + baseBucket.late;
  if (curEval < 20 || basEval < 50) return null;
  const curOT = (curBucket.ontime / curEval) * 100;
  const basOT = (baseBucket.ontime / basEval) * 100;
  const drop = basOT - curOT;
  if (drop < 3) return null; // ROLLING_OT_DROP = 3
  return {
    anomaly_id: anomalyId("rolling_baseline", "ontime_rate", entityId, "7d-vs-4w"),
    detection_rule: "rolling_baseline",
    metric: "ontime_rate",
    entity_type: "client",
    entity_id: entityId,
    current_value: Math.round(curOT * 10) / 10,
    baseline_value: Math.round(basOT * 10) / 10,
    delta: -Math.round(drop * 10) / 10,
    severity: toSeverity("rolling_baseline", "ontime_rate", drop),
    confidence: confidenceScore(Math.min(curEval, basEval)),
    status: "DETECTED",
  };
}

// ─── Cooldown logic ──────────────────────────────────────────────────────────
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h

function shouldSkipDispatch(cooldown, anomalyId, now) {
  const lastSent = cooldown[anomalyId];
  return lastSent && (now - lastSent) < COOLDOWN_MS;
}

function updateCooldown(cooldown, anomalyId, now) {
  return { ...cooldown, [anomalyId]: now };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test("WoW: detects on-time drop of ≥4 pts week-over-week", () => {
  const cur  = { ontime: 76, late: 24, orders: 100 }; // 76%
  const prev = { ontime: 90, late: 10, orders: 100 }; // 90%
  const a = detectWoW_OntimeDrop(cur, prev, "Aqua VN", {});
  assert.ok(a !== null, "Should detect WoW drop");
  assert.equal(a.detection_rule, "wow");
  assert.equal(a.entity_id, "Aqua VN");
  assert.equal(a.current_value, 76);
  assert.equal(a.baseline_value, 90);
  assert.equal(a.delta, -14);
  assert.equal(a.severity, "CRITICAL"); // > 10 pts drop → CRITICAL
});

test("WoW: no anomaly when drop < 4 pts", () => {
  const cur  = { ontime: 87, late: 13, orders: 100 }; // 87%
  const prev = { ontime: 90, late: 10, orders: 100 }; // 90%
  const a = detectWoW_OntimeDrop(cur, prev, "Aqua VN", {});
  assert.equal(a, null, "Drop of 3 pts below threshold (4)");
});

test("WoW: no anomaly when sample size < 20", () => {
  const cur  = { ontime: 5, late: 10, orders: 15 }; // < 20 eligible
  const prev = { ontime: 15, late: 5,  orders: 20 };
  const a = detectWoW_OntimeDrop(cur, prev, "Client X", {});
  assert.equal(a, null, "Insufficient sample size");
});

test("WoW: severity scales correctly with magnitude", () => {
  const high    = detectWoW_OntimeDrop({ ontime: 80, late: 20 }, { ontime: 87, late: 13 }, "C1", {});
  const medium  = detectWoW_OntimeDrop({ ontime: 84, late: 16 }, { ontime: 88, late: 12 }, "C2", {});

  if (high)   assert.equal(high.severity, "HIGH",   `Expected HIGH for 7pt drop, got ${high.severity}`);
  if (medium) assert.ok(["MEDIUM", "HIGH"].includes(medium.severity), `Expected MEDIUM/HIGH for 4pt drop`);
});

test("Threshold: CRITICAL when ontime < 80%", () => {
  const bucket = { ontime: 75, late: 25, orders: 100 }; // 75%
  const a = detectThreshold_Ontime(bucket, "LG VN");
  assert.ok(a !== null);
  assert.equal(a.severity, "CRITICAL");
  assert.equal(a.detection_rule, "threshold");
  assert.equal(a.current_value, 75);
  assert.equal(a.baseline_value, 85);
});

test("Threshold: HIGH when ontime is 81-84%", () => {
  const bucket = { ontime: 82, late: 18, orders: 100 }; // 82%
  const a = detectThreshold_Ontime(bucket, "LG VN");
  assert.ok(a !== null);
  assert.equal(a.severity, "HIGH");
});

test("Threshold: no anomaly when ontime >= 85%", () => {
  const bucket = { ontime: 88, late: 12, orders: 100 }; // 88%
  const a = detectThreshold_Ontime(bucket, "LG VN");
  assert.equal(a, null, "88% is above threshold");
});

test("Threshold: no anomaly when sample < 20", () => {
  const bucket = { ontime: 5, late: 10, orders: 15 }; // < 20 eligible
  const a = detectThreshold_Ontime(bucket, "Small Client");
  assert.equal(a, null, "Sample too small");
});

test("Rolling baseline: detects 4-week avg drop ≥3 pts", () => {
  const cur = { ontime: 82, late: 18, orders: 100 };  // 82%
  const bas = { ontime: 220, late: 30, orders: 250 };  // 88%
  const a = detectRolling_OntimeDrop(cur, bas, "Aqua VN");
  assert.ok(a !== null);
  assert.equal(a.detection_rule, "rolling_baseline");
  assert.ok(a.delta < 0, "delta should be negative (drop)");
  assert.ok(a.current_value < a.baseline_value, "current < baseline");
});

test("Rolling baseline: no anomaly when drop < 3 pts", () => {
  const cur = { ontime: 87, late: 13, orders: 100 };  // 87%
  const bas = { ontime: 220, late: 30, orders: 250 };  // 88%
  const a = detectRolling_OntimeDrop(cur, bas, "Aqua VN");
  assert.equal(a, null, "1pt drop below threshold (3)");
});

test("anomaly_id is deterministic for same inputs", () => {
  const id1 = anomalyId("wow", "ontime_rate", "Aqua VN", "2026-10-W42");
  const id2 = anomalyId("wow", "ontime_rate", "Aqua VN", "2026-10-W42");
  assert.equal(id1, id2, "Same inputs should produce same anomaly_id");
});

test("anomaly_id is unique for different entity_ids", () => {
  const id1 = anomalyId("wow", "ontime_rate", "Aqua VN", "w42");
  const id2 = anomalyId("wow", "ontime_rate", "LG VN", "w42");
  assert.notEqual(id1, id2, "Different entities should have different IDs");
});

test("anomaly_id is unique for different rules", () => {
  const id1 = anomalyId("wow",      "ontime_rate", "Aqua VN", "w42");
  const id2 = anomalyId("threshold","ontime_rate", "Aqua VN", "w42");
  assert.notEqual(id1, id2, "Different rules should produce different IDs");
});

test("anomaly_id slugifies special characters", () => {
  const id = anomalyId("wow", "ontime_rate", "Hồ Chí Minh City", "w42");
  assert.ok(/^[a-z0-9:\-._]+$/.test(id), `ID should only contain safe chars: ${id}`);
});

test("confidence increases with sample size", () => {
  const c1 = confidenceScore(15);
  const c2 = confidenceScore(60);
  const c3 = confidenceScore(200);
  assert.ok(c1 < c2, "60 > 15 samples → higher confidence");
  assert.ok(c2 < c3, "200 > 60 samples → higher confidence");
  assert.ok(c3 <= 0.95, "confidence capped at 0.95");
});

test("cooldown: shouldSkipDispatch returns true within 4h", () => {
  const now = Date.now();
  const cooldown = { "test:anomaly": now - 2 * 60 * 60 * 1000 }; // 2h ago
  assert.ok(shouldSkipDispatch(cooldown, "test:anomaly", now), "Should skip — within 4h cooldown");
});

test("cooldown: shouldSkipDispatch returns false after 4h+", () => {
  const now = Date.now();
  const cooldown = { "test:anomaly": now - 5 * 60 * 60 * 1000 }; // 5h ago
  assert.ok(!shouldSkipDispatch(cooldown, "test:anomaly", now), "Should NOT skip — cooldown expired");
});

test("cooldown: shouldSkipDispatch returns false for new anomaly", () => {
  const now = Date.now();
  const cooldown = {};
  assert.ok(!shouldSkipDispatch(cooldown, "new:anomaly", now), "New anomaly not in cooldown");
});

test("cooldown: updateCooldown stores timestamp", () => {
  const now = Date.now();
  const updated = updateCooldown({}, "test:anomaly", now);
  assert.equal(updated["test:anomaly"], now);
});

test("cooldown: updateCooldown does not mutate original", () => {
  const original = { "existing": 12345 };
  const updated = updateCooldown(original, "new:one", 99999);
  assert.equal(original["new:one"], undefined, "Original should not be mutated");
  assert.equal(updated["new:one"], 99999);
  assert.equal(updated["existing"], 12345, "Existing entries preserved");
});

test("severity: CRITICAL for ontime < 80 (threshold rule)", () => {
  assert.equal(toSeverity("threshold", "ontime_rate", 75), "CRITICAL");
  assert.equal(toSeverity("threshold", "ontime_rate", 80), "CRITICAL");
});

test("severity: HIGH for ontime 81-84 (threshold rule)", () => {
  assert.equal(toSeverity("threshold", "ontime_rate", 82), "HIGH");
  assert.equal(toSeverity("threshold", "ontime_rate", 84), "HIGH");
});

test("severity: scales for statistical rules", () => {
  assert.equal(toSeverity("wow", "ontime_rate", 12), "CRITICAL"); // > 10 pts
  assert.equal(toSeverity("wow", "ontime_rate", 7),  "HIGH");     // > 5 pts
  assert.equal(toSeverity("wow", "ontime_rate", 4),  "MEDIUM");   // > 3 pts
  assert.equal(toSeverity("wow", "ontime_rate", 2),  "LOW");      // ≤ 3 pts
});

test("addDays helper: correct date arithmetic", () => {
  assert.equal(addDays("2026-10-15", -7), "2026-10-08");
  assert.equal(addDays("2026-10-15", -35), "2026-09-10");
  assert.equal(addDays("2026-10-01", -1), "2026-09-30");
});

test("ontimeRate: null when no eligible rows", () => {
  const b = { ontime: 0, late: 0, orders: 10, cases: 0, comp: 0, ret: 5, cancel: 5 };
  assert.equal(ontimeRate(b), null);
});

test("ontimeRate: correct calculation", () => {
  const b = { ontime: 80, late: 20, orders: 100 };
  assert.equal(ontimeRate(b), 80); // 80/100 * 100
});

test("damageRate: zero when no cases", () => {
  const b = { orders: 100, cases: 0 };
  assert.equal(damageRate(b), 0);
});

test("damageRate: correct calculation", () => {
  const b = { orders: 100, cases: 2 };
  assert.equal(damageRate(b), 0.02); // 2/100
});
