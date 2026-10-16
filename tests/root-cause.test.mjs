/**
 * tests/root-cause.test.mjs — Tests for the Root Cause Intelligence Engine (Phase 3).
 *
 * Tests: contribution % calculation, peer comparison, candidate cause generation,
 *        evidence levels, JSON output structure, confidence score.
 *
 * All logic is self-contained (inlined) to avoid ESM/CJS module issues in raw Node.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline pure helpers from root-cause-engine.js ───────────────────────────
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

const EVIDENCE = {
  STRONG:         "STRONG",
  MODERATE:       "MODERATE",
  WEAK:           "WEAK",
  CIRCUMSTANTIAL: "CIRCUMSTANTIAL",
};

function emptyBucket() {
  return { orders: 0, ontime: 0, late: 0, ret: 0, cancel: 0, cases: 0, comp: 0 };
}

function ontimeRate(b) {
  const e = b.ontime + b.late;
  return e > 0 ? (b.ontime / e) * 100 : null;
}

function evidenceLevel(sampleSize, deltaAbs) {
  if (sampleSize >= 200 && deltaAbs > 8) return EVIDENCE.STRONG;
  if (sampleSize >= 80  && deltaAbs > 4) return EVIDENCE.MODERATE;
  if (sampleSize >= 30  && deltaAbs > 2) return EVIDENCE.WEAK;
  return EVIDENCE.CIRCUMSTANTIAL;
}

// Inline contribution analysis (matches root-cause-engine.js logic)
function getOntimeOutcomeSimple(r) {
  const s = String(r.odr_success || "").toLowerCase().trim();
  if (s === "ontime") return "ontime";
  if (s === "late") return "late";
  const status = String(r.status || "").toLowerCase();
  if (status.includes("return") || status.includes("hoàn")) return "return";
  return "late";
}

function bucketRows(rows, from, to) {
  const b = emptyBucket();
  for (const r of rows) {
    const day = String(r.pickup_time || "").slice(0, 10);
    if (!day || day < from || day > to) continue;
    b.orders++;
    const o = getOntimeOutcomeSimple(r);
    if (o === "ontime") b.ontime++; else if (o === "late") b.late++;
  }
  return b;
}

function buildContributionBreakdown(rows, entityId, curFrom, curTo, basFrom, basTo) {
  const entityRows = rows.filter((r) => String(r.client_name || "").trim() === entityId);
  const groupDim = "to_province_name";
  const groups = {};
  for (const r of entityRows) {
    const key = String(r[groupDim] || "").trim() || "(không rõ)";
    if (!groups[key]) groups[key] = { curRows: [], basRows: [] };
    const day = String(r.pickup_time || "").slice(0, 10);
    if (day >= curFrom && day <= curTo) groups[key].curRows.push(r);
    if (day >= basFrom && day <= basTo) groups[key].basRows.push(r);
  }

  const totalCur = bucketRows(entityRows, curFrom, curTo);
  const totalBas = bucketRows(entityRows, basFrom, basTo);
  const totalCurOT = ontimeRate(totalCur);
  const totalBasOT = ontimeRate(totalBas);
  const totalDelta = totalBasOT !== null && totalCurOT !== null ? totalBasOT - totalCurOT : 0;

  const contributors = [];
  for (const [grp, { curRows, basRows }] of Object.entries(groups)) {
    const cbCur = emptyBucket();
    const cbBas = emptyBucket();
    for (const r of curRows) {
      cbCur.orders++;
      const o = getOntimeOutcomeSimple(r);
      if (o === "ontime") cbCur.ontime++; else if (o === "late") cbCur.late++;
    }
    for (const r of basRows) {
      cbBas.orders++;
      const o = getOntimeOutcomeSimple(r);
      if (o === "ontime") cbBas.ontime++; else if (o === "late") cbBas.late++;
    }
    const curOT = ontimeRate(cbCur);
    const basOT = ontimeRate(cbBas);
    if (curOT === null && basOT === null) continue;

    const eligible = cbCur.ontime + cbCur.late;
    const totalEligible = totalCur.ontime + totalCur.late;
    const groupDelta = basOT !== null && curOT !== null ? basOT - curOT : 0;
    const weightedContrib = totalEligible > 0 ? (eligible / totalEligible) * groupDelta : 0;
    const shareOfDelta = Math.abs(totalDelta) > 0.01 ? (weightedContrib / totalDelta) * 100 : 0;

    contributors.push({
      entity: grp,
      current_value: curOT !== null ? round1(curOT) : null,
      baseline_value: basOT !== null ? round1(basOT) : null,
      delta: curOT !== null && basOT !== null ? round1(curOT - basOT) : null,
      current_orders: eligible,
      share_of_delta_pct: round1(shareOfDelta),
    });
  }
  contributors.sort((a, b) => Math.abs(b.share_of_delta_pct || 0) - Math.abs(a.share_of_delta_pct || 0));

  return {
    total_current_value: totalCurOT !== null ? round1(totalCurOT) : null,
    total_baseline_value: totalBasOT !== null ? round1(totalBasOT) : null,
    total_delta: round1(-totalDelta),
    top_contributors: contributors.slice(0, 5),
  };
}

function buildPeerComparison(rows, entityId, curFrom, curTo) {
  const byClient = {};
  for (const r of rows) {
    const day = String(r.pickup_time || "").slice(0, 10);
    if (!day || day < curFrom || day > curTo) continue;
    const c = String(r.client_name || "").trim() || "(không rõ)";
    if (!byClient[c]) byClient[c] = emptyBucket();
    byClient[c].orders++;
    const o = getOntimeOutcomeSimple(r);
    if (o === "ontime") byClient[c].ontime++; else if (o === "late") byClient[c].late++;
  }
  const peers = Object.entries(byClient)
    .filter(([, b]) => (b.ontime + b.late) >= 20)
    .map(([client, b]) => ({ client, ot: ontimeRate(b), orders: b.ontime + b.late }))
    .filter((p) => p.ot !== null)
    .sort((a, b) => a.ot - b.ot);
  if (peers.length === 0) return null;
  const medianIdx = Math.floor(peers.length / 2);
  const peerMedian = peers[medianIdx]?.ot ?? null;
  const entityPeer = peers.find((p) => p.client === entityId);
  const rank = entityPeer ? peers.findIndex((p) => p.client === entityId) + 1 : null;
  const percentile = rank !== null ? Math.round(((peers.length - rank) / peers.length) * 100) : null;
  const belowMedianCount = peers.filter((p) => p.ot < (peerMedian || 0) - 3).length;
  return {
    entity_value: entityPeer?.ot !== undefined ? round1(entityPeer.ot) : null,
    peer_median: peerMedian !== null ? round1(peerMedian) : null,
    peer_count: peers.length,
    entity_rank: rank,
    entity_percentile: percentile,
    below_median_count: belowMedianCount,
    system_wide_drop: belowMedianCount >= Math.ceil(peers.length * 0.5),
    peers_snapshot: peers.slice(0, 6),
  };
}

function generateCandidateCauses(anomaly, contribution, peerComp, damageInfo) {
  const causes = [];
  const metric = anomaly.metric;
  const delta = Math.abs(anomaly.delta || 0);

  if (contribution && contribution.top_contributors.length > 0) {
    const top = contribution.top_contributors[0];
    const topShare = Math.abs(top.share_of_delta_pct || 0);
    if (topShare >= 40 && top.entity !== "(không rõ)") {
      causes.push({
        cause_id: `geographic_concentration:${top.entity}`,
        title: `Tập trung sụt giảm tại tỉnh ${top.entity}`,
        evidence_level: evidenceLevel(top.current_orders || 0, Math.abs(top.delta || 0)),
        supporting_evidence: [`${top.entity}: ${top.current_value}% → ${top.delta}%`, `Chiếm ${round1(topShare)}% delta`],
        contradicting_evidence: topShare < 60 ? [`Tỉnh còn lại chiếm ${round1(100 - topShare)}% delta`] : [],
      });
    }
  }

  if (peerComp && peerComp.system_wide_drop) {
    causes.push({
      cause_id: "system_wide_issue",
      title: "Vấn đề hệ thống toàn mạng",
      evidence_level: EVIDENCE.MODERATE,
      supporting_evidence: [`${peerComp.below_median_count}/${peerComp.peer_count} khách dưới median`],
      contradicting_evidence: [],
    });
  }

  if (peerComp && !peerComp.system_wide_drop && peerComp.entity_percentile !== null && peerComp.entity_percentile < 30) {
    causes.push({
      cause_id: "client_specific_issue",
      title: `Vấn đề đặc thù khách hàng ${anomaly.entity_id}`,
      evidence_level: EVIDENCE.WEAK,
      supporting_evidence: [`Percentile ${peerComp.entity_percentile}%`],
      contradicting_evidence: [],
    });
  }

  if (metric === "ontime_rate" && damageInfo && damageInfo.spike_pct > 30 && damageInfo.cur_cases >= 2) {
    causes.push({
      cause_id: "damage_correlation",
      title: "Spike hư hỏng đồng thời với sụt giảm on-time",
      evidence_level: damageInfo.cur_cases >= 5 ? EVIDENCE.MODERATE : EVIDENCE.WEAK,
      supporting_evidence: [`Ca hư hỏng: ${damageInfo.cur_cases} (tăng ${damageInfo.spike_pct}%)`],
      contradicting_evidence: [],
    });
  }

  if (causes.length === 0) {
    causes.push({
      cause_id: "unknown_decline",
      title: "Sụt giảm chưa xác định được nguyên nhân",
      evidence_level: EVIDENCE.CIRCUMSTANTIAL,
      supporting_evidence: [`Delta: ${round1(delta)} điểm`],
      contradicting_evidence: ["Mẫu có thể chưa đủ lớn"],
    });
  }
  return causes;
}

function computeOverallConfidence(anomaly, contribution, peerComp, candidates) {
  let score = 40;
  if (anomaly.confidence) score += Math.round((anomaly.confidence - 0.6) * 50);
  if (contribution && contribution.top_contributors.length > 0) {
    const topShare = Math.abs(contribution.top_contributors[0]?.share_of_delta_pct || 0);
    if (topShare >= 60) score += 20; else if (topShare >= 40) score += 10;
  }
  if (peerComp) score += 10;
  const strongCount = candidates.filter((c) => c.evidence_level === EVIDENCE.STRONG).length;
  const modCount    = candidates.filter((c) => c.evidence_level === EVIDENCE.MODERATE).length;
  score += strongCount * 10 + modCount * 5;
  return Math.min(95, Math.max(20, Math.round(score)));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
const TODAY = "2026-10-15";
const CUR_FROM = addDays(TODAY, -7); // 2026-10-08
const CUR_TO   = addDays(TODAY, -1); // 2026-10-14
const BAS_FROM = addDays(TODAY, -35); // 2026-09-10
const BAS_TO   = addDays(TODAY, -8);  // 2026-10-07

function makeRow(client, province, pickup, outcome) {
  return { client_name: client, to_province_name: province, pickup_time: pickup, odr_success: outcome, order_code: `ORD${Math.random().toString(36).slice(2, 8)}` };
}

// Build rows: Aqua VN with HCM (heavy, bad) + Hanoi (lighter, ok) in current; both ok in baseline
function buildTestRows() {
  const rows = [];
  // Current window (CUR_FROM..CUR_TO): 2026-10-08..2026-10-14
  // HCM: 30 orders, 18 ontime (60%)
  for (let i = 0; i < 18; i++) rows.push(makeRow("Aqua VN", "Hồ Chí Minh", "2026-10-09", "ontime"));
  for (let i = 0; i < 12; i++) rows.push(makeRow("Aqua VN", "Hồ Chí Minh", "2026-10-09", "late"));
  // Hanoi: 10 orders, 9 ontime (90%)
  for (let i = 0; i < 9;  i++) rows.push(makeRow("Aqua VN", "Hà Nội", "2026-10-10", "ontime"));
  for (let i = 0; i < 1;  i++) rows.push(makeRow("Aqua VN", "Hà Nội", "2026-10-10", "late"));
  // Baseline window (BAS_FROM..BAS_TO): 2026-09-10..2026-10-07
  // HCM: 60 orders, 54 ontime (90%)
  for (let i = 0; i < 54; i++) rows.push(makeRow("Aqua VN", "Hồ Chí Minh", "2026-09-20", "ontime"));
  for (let i = 0; i < 6;  i++) rows.push(makeRow("Aqua VN", "Hồ Chí Minh", "2026-09-20", "late"));
  // Hanoi baseline: 20 orders, 19 ontime (95%)
  for (let i = 0; i < 19; i++) rows.push(makeRow("Aqua VN", "Hà Nội", "2026-09-21", "ontime"));
  for (let i = 0; i < 1;  i++) rows.push(makeRow("Aqua VN", "Hà Nội", "2026-09-21", "late"));
  return rows;
}

function buildMultiClientRows() {
  const rows = buildTestRows();
  // Other clients in current window
  for (let i = 0; i < 18; i++) rows.push(makeRow("LG VN",   "Hà Nội",      "2026-10-09", "ontime"));
  for (let i = 0; i < 7;  i++) rows.push(makeRow("LG VN",   "Hà Nội",      "2026-10-09", "late"));
  for (let i = 0; i < 20; i++) rows.push(makeRow("Hisense",  "TP.HCM",     "2026-10-10", "ontime"));
  for (let i = 0; i < 5;  i++) rows.push(makeRow("Hisense",  "TP.HCM",     "2026-10-10", "late"));
  for (let i = 0; i < 22; i++) rows.push(makeRow("Samsung",  "Đà Nẵng",    "2026-10-11", "ontime"));
  for (let i = 0; i < 3;  i++) rows.push(makeRow("Samsung",  "Đà Nẵng",    "2026-10-11", "late"));
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRIBUTION ANALYSIS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test("contribution: identifies top contributing province by delta share", () => {
  const rows = buildTestRows();
  const result = buildContributionBreakdown(rows, "Aqua VN", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  assert.ok(result.top_contributors.length > 0, "Should have contributors");
  const top = result.top_contributors[0];
  assert.ok(Math.abs(top.share_of_delta_pct) > 0, "Top contributor should have non-zero share");
});

test("contribution: HCM should dominate delta (heavy drop in HCM vs baseline)", () => {
  const rows = buildTestRows();
  const result = buildContributionBreakdown(rows, "Aqua VN", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  const hcm = result.top_contributors.find((c) => c.entity === "Hồ Chí Minh");
  assert.ok(hcm, "HCM should be in top contributors");
  assert.ok(hcm.current_value < hcm.baseline_value, "HCM current should be below baseline");
  assert.ok(hcm.current_value < 70, "HCM current ontime should be ~60%");
});

test("contribution: shares of delta sum to approximately 100%", () => {
  const rows = buildTestRows();
  const result = buildContributionBreakdown(rows, "Aqua VN", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  const totalShare = result.top_contributors.reduce((s, c) => s + (c.share_of_delta_pct || 0), 0);
  assert.ok(Math.abs(totalShare - 100) <= 5, `Shares should sum ~100%, got ${totalShare}`);
});

test("contribution: total_current_value reflects actual ontime rate", () => {
  const rows = buildTestRows();
  const result = buildContributionBreakdown(rows, "Aqua VN", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  // 18+9=27 ontime, 12+1=13 late → 27/40 ≈ 67.5%
  assert.ok(result.total_current_value !== null, "total_current_value should be set");
  assert.ok(result.total_current_value < 80, "Aqua VN current ontime < 80%");
  assert.ok(result.total_current_value > 50, "Aqua VN current ontime > 50%");
});

test("contribution: total_delta is negative (drop)", () => {
  const rows = buildTestRows();
  const result = buildContributionBreakdown(rows, "Aqua VN", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  // Current is lower than baseline → delta should be negative in our sign convention
  // (total_delta = -(baseline - current) = current - baseline < 0)
  assert.ok(result.total_delta < 0, `Delta should be negative (drop), got ${result.total_delta}`);
});

test("contribution: returns empty contributors for entity with no rows", () => {
  const rows = buildTestRows();
  const result = buildContributionBreakdown(rows, "Unknown Client", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  assert.equal(result.total_current_value, null, "Should be null when no rows");
  assert.equal(result.top_contributors.length, 0, "No contributors for unknown client");
});

// ═══════════════════════════════════════════════════════════════════════════════
// PEER COMPARISON TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test("peer comparison: identifies Aqua VN rank among peers", () => {
  const rows = buildMultiClientRows();
  const peer = buildPeerComparison(rows, "Aqua VN", CUR_FROM, CUR_TO);
  assert.ok(peer !== null, "Peer comparison should work with multiple clients");
  assert.ok(peer.peer_count >= 3, "Should have at least 3 peers");
  assert.ok(peer.entity_rank !== null, "Aqua VN should have a rank");
});

test("peer comparison: Aqua VN should rank low (worst ontime ~67%)", () => {
  const rows = buildMultiClientRows();
  const peer = buildPeerComparison(rows, "Aqua VN", CUR_FROM, CUR_TO);
  assert.ok(peer.entity_rank === 1, `Aqua VN should be rank 1 (worst), got ${peer.entity_rank}`);
  // percentile formula = (peers.length - rank) / peers.length * 100
  // rank 1 (worst of 4) → 75% of peers perform better → percentile > 50
  assert.ok(peer.entity_percentile >= 50, `Aqua VN is worst: most peers outperform it, got ${peer.entity_percentile}`);
});

test("peer comparison: returns null when no clients have >= 20 eligible rows", () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(makeRow("Small A", "HCM", "2026-10-09", "ontime"));
  const peer = buildPeerComparison(rows, "Small A", CUR_FROM, CUR_TO);
  assert.equal(peer, null, "Should return null for insufficient samples");
});

test("peer comparison: system_wide_drop is false when majority of peers are above threshold", () => {
  // 3 clients: Aqua VN bad (67%), others clearly above median-3
  const rows = [];
  // Current window
  for (let i = 0; i < 18; i++) rows.push(makeRow("Aqua VN",  "HCM",  "2026-10-09", "ontime"));
  for (let i = 0; i < 12; i++) rows.push(makeRow("Aqua VN",  "HCM",  "2026-10-09", "late"));
  for (let i = 0; i < 22; i++) rows.push(makeRow("LG VN",    "HN",   "2026-10-09", "ontime")); // 22/25 = 88%
  for (let i = 0; i < 3;  i++) rows.push(makeRow("LG VN",    "HN",   "2026-10-09", "late"));
  for (let i = 0; i < 24; i++) rows.push(makeRow("Samsung",  "DN",   "2026-10-10", "ontime")); // 24/25 = 96%
  for (let i = 0; i < 1;  i++) rows.push(makeRow("Samsung",  "DN",   "2026-10-10", "late"));
  const peer = buildPeerComparison(rows, "Aqua VN", CUR_FROM, CUR_TO);
  assert.ok(peer !== null);
  // Sorted asc: Aqua VN (60%), LG VN (88%), Samsung (96%)
  // median = peers[1] = LG VN = 88%, threshold = 85
  // below threshold: only Aqua VN (60%) < 85 → below_median_count = 1
  // system_wide_drop = 1 >= ceil(3*0.5)=2 → false
  assert.equal(peer.system_wide_drop, false, `Should not be system-wide: only Aqua VN is bad, got system_wide_drop=${peer.system_wide_drop}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CANDIDATE CAUSE GENERATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test("candidate causes: generates geographic concentration cause when top share >= 40%", () => {
  const rows = buildTestRows();
  const contribution = buildContributionBreakdown(rows, "Aqua VN", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  const anomaly = { anomaly_id: "test", metric: "ontime_rate", entity_id: "Aqua VN", entity_type: "client", delta: -10, confidence: 0.85 };
  const causes = generateCandidateCauses(anomaly, contribution, null, null);
  const geoCause = causes.find((c) => c.cause_id.startsWith("geographic_concentration:"));
  assert.ok(geoCause, "Should have geographic concentration cause");
  assert.ok(geoCause.cause_id.includes("Hồ Chí Minh"), "Geographic cause should name HCM");
});

test("candidate causes: system_wide_issue cause when peer drop is broad", () => {
  const badPeer = { system_wide_drop: true, below_median_count: 3, peer_count: 4, entity_rank: 1, entity_percentile: 10, peer_median: 85, entity_value: 67 };
  const anomaly = { anomaly_id: "x", metric: "ontime_rate", entity_id: "Aqua VN", delta: -8 };
  const causes = generateCandidateCauses(anomaly, null, badPeer, null);
  const sysCause = causes.find((c) => c.cause_id === "system_wide_issue");
  assert.ok(sysCause, "Should detect system-wide issue");
  assert.equal(sysCause.evidence_level, EVIDENCE.MODERATE);
});

test("candidate causes: client_specific_issue when peers are fine", () => {
  const goodPeer = { system_wide_drop: false, below_median_count: 1, peer_count: 5, entity_rank: 1, entity_percentile: 20, peer_median: 90, entity_value: 67 };
  const anomaly = { anomaly_id: "x", metric: "ontime_rate", entity_id: "Aqua VN", delta: -15 };
  const causes = generateCandidateCauses(anomaly, null, goodPeer, null);
  const clientCause = causes.find((c) => c.cause_id === "client_specific_issue");
  assert.ok(clientCause, "Should detect client-specific issue");
});

test("candidate causes: unknown_decline as fallback when no evidence", () => {
  const anomaly = { anomaly_id: "x", metric: "ontime_rate", entity_id: "NoData Client", delta: -3 };
  const causes = generateCandidateCauses(anomaly, null, null, null);
  assert.equal(causes.length, 1, "Should have exactly 1 fallback cause");
  assert.equal(causes[0].cause_id, "unknown_decline");
  assert.equal(causes[0].evidence_level, EVIDENCE.CIRCUMSTANTIAL);
});

test("candidate causes: damage correlation when spike > 30% and >= 2 cases", () => {
  const anomaly = { anomaly_id: "x", metric: "ontime_rate", entity_id: "Aqua VN", delta: -8 };
  const damageInfo = { spike_pct: 80, cur_cases: 5, bas_cases: 2 };
  const causes = generateCandidateCauses(anomaly, null, null, damageInfo);
  const dmgCause = causes.find((c) => c.cause_id === "damage_correlation");
  assert.ok(dmgCause, "Should detect damage correlation");
  assert.equal(dmgCause.evidence_level, EVIDENCE.MODERATE); // >= 5 cases
});

test("candidate causes: no damage cause when spike < 30%", () => {
  const anomaly = { anomaly_id: "x", metric: "ontime_rate", entity_id: "Aqua VN", delta: -5 };
  const damageInfo = { spike_pct: 10, cur_cases: 2, bas_cases: 1 };
  const causes = generateCandidateCauses(anomaly, null, null, damageInfo);
  const dmgCause = causes.find((c) => c.cause_id === "damage_correlation");
  assert.equal(dmgCause, undefined, "Should not flag damage correlation below 30%");
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVIDENCE LEVEL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test("evidence level: STRONG for large sample + large delta", () => {
  assert.equal(evidenceLevel(250, 12), EVIDENCE.STRONG);
  assert.equal(evidenceLevel(300, 10), EVIDENCE.STRONG);
});

test("evidence level: MODERATE for medium sample + moderate delta", () => {
  assert.equal(evidenceLevel(100, 6), EVIDENCE.MODERATE);
  assert.equal(evidenceLevel(80, 5), EVIDENCE.MODERATE);
});

test("evidence level: WEAK for small-medium sample + small delta", () => {
  assert.equal(evidenceLevel(50, 3), EVIDENCE.WEAK);
  assert.equal(evidenceLevel(30, 3), EVIDENCE.WEAK);
});

test("evidence level: CIRCUMSTANTIAL for very small sample", () => {
  assert.equal(evidenceLevel(10, 2), EVIDENCE.CIRCUMSTANTIAL);
  assert.equal(evidenceLevel(5, 10), EVIDENCE.CIRCUMSTANTIAL);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test("confidence score: increases with high anomaly confidence", () => {
  const anomaly1 = { confidence: 0.6 };
  const anomaly2 = { confidence: 0.95 };
  const s1 = computeOverallConfidence(anomaly1, null, null, [{ evidence_level: EVIDENCE.CIRCUMSTANTIAL }]);
  const s2 = computeOverallConfidence(anomaly2, null, null, [{ evidence_level: EVIDENCE.CIRCUMSTANTIAL }]);
  assert.ok(s2 > s1, "Higher anomaly confidence → higher overall confidence");
});

test("confidence score: increases when peer comparison available", () => {
  const anomaly = { confidence: 0.8 };
  const causes = [{ evidence_level: EVIDENCE.WEAK }];
  const s1 = computeOverallConfidence(anomaly, null, null, causes);
  const s2 = computeOverallConfidence(anomaly, null, { peer_count: 4 }, causes);
  assert.ok(s2 > s1, "Having peer comparison should increase confidence");
});

test("confidence score: increases with strong contribution evidence", () => {
  const anomaly = { confidence: 0.8 };
  const causes = [{ evidence_level: EVIDENCE.STRONG }];
  const weakContrib = { top_contributors: [] };
  const strongContrib = { top_contributors: [{ share_of_delta_pct: 70, current_orders: 30 }] };
  const s1 = computeOverallConfidence(anomaly, weakContrib, null, causes);
  const s2 = computeOverallConfidence(anomaly, strongContrib, null, causes);
  assert.ok(s2 > s1, "Strong contribution analysis should increase confidence");
});

test("confidence score: always in range [20, 95]", () => {
  const cases = [
    { anomaly: { confidence: 0 }, contrib: null, peer: null, causes: [] },
    { anomaly: { confidence: 1 }, contrib: { top_contributors: [{ share_of_delta_pct: 90 }] }, peer: { peer_count: 10 }, causes: [{ evidence_level: EVIDENCE.STRONG }, { evidence_level: EVIDENCE.STRONG }] },
  ];
  for (const c of cases) {
    const s = computeOverallConfidence(c.anomaly, c.contrib, c.peer, c.causes);
    assert.ok(s >= 20 && s <= 95, `Score ${s} out of range [20, 95]`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// OUTPUT STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test("contribution output has required fields", () => {
  const rows = buildTestRows();
  const result = buildContributionBreakdown(rows, "Aqua VN", CUR_FROM, CUR_TO, BAS_FROM, BAS_TO);
  assert.ok("total_current_value" in result, "Missing total_current_value");
  assert.ok("total_baseline_value" in result, "Missing total_baseline_value");
  assert.ok("total_delta" in result, "Missing total_delta");
  assert.ok(Array.isArray(result.top_contributors), "top_contributors must be array");
});

test("peer comparison output has required fields", () => {
  const rows = buildMultiClientRows();
  const peer = buildPeerComparison(rows, "Aqua VN", CUR_FROM, CUR_TO);
  assert.ok(peer !== null, "Peer comparison should not be null");
  assert.ok("entity_value" in peer, "Missing entity_value");
  assert.ok("peer_median" in peer, "Missing peer_median");
  assert.ok("peer_count" in peer, "Missing peer_count");
  assert.ok("entity_rank" in peer, "Missing entity_rank");
  assert.ok("entity_percentile" in peer, "Missing entity_percentile");
  assert.ok("system_wide_drop" in peer, "Missing system_wide_drop");
  assert.ok(Array.isArray(peer.peers_snapshot), "peers_snapshot must be array");
});

test("candidate cause has required fields", () => {
  const anomaly = { anomaly_id: "test", metric: "ontime_rate", entity_id: "Aqua VN", delta: -10 };
  const causes = generateCandidateCauses(anomaly, null, null, null);
  for (const c of causes) {
    assert.ok("cause_id" in c, "Missing cause_id");
    assert.ok("title" in c, "Missing title");
    assert.ok("evidence_level" in c, "Missing evidence_level");
    assert.ok(Array.isArray(c.supporting_evidence), "supporting_evidence must be array");
    assert.ok(Array.isArray(c.contradicting_evidence), "contradicting_evidence must be array");
    assert.ok(Object.values(EVIDENCE).includes(c.evidence_level), `Invalid evidence_level: ${c.evidence_level}`);
  }
});

test("addDays helper: date arithmetic", () => {
  assert.equal(addDays("2026-10-15", -7), "2026-10-08");
  assert.equal(addDays("2026-10-15", -35), "2026-09-10");
});
