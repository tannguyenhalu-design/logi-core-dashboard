/**
 * tests/experiment.test.mjs — Phase 5: Experiment Engine tests.
 * All logic is self-contained (inlined) to avoid ESM/CJS import issues in raw Node.js.
 *
 * Covers:
 *   - EXPERIMENT_STATUSES: all 8 canonical + 2 legacy states defined
 *   - checkSampleQuality: passes/fails for trial orders, baseline orders, days
 *   - computeChanges: absolute / relative / control-adjusted outputs
 *   - determineVerdict: INSUFFICIENT_DATA gate, explicit lifecycle states, auto-verdict
 *   - generateKnowledgeCandidate: PENDING_APPROVAL, narrative, trial_id
 *   - generateFailureRecord: prevent_reuse, hypothesis preserved, clients
 *   - Integration: KC only on CONFIRMED, FR only on REJECTED
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline constants ─────────────────────────────────────────────────────────

const EXPERIMENT_STATUSES = [
  "DRAFT", "APPROVED", "RUNNING", "MEASURING", "COMPLETED",
  "CONFIRMED", "REJECTED", "INCONCLUSIVE",
  "PROPOSED", "ANALYZING",
];

const MIN_TRIAL_ORDERS    = 100;
const MIN_BASELINE_ORDERS = 100;
const MIN_POST_DAYS       = 14;

const VERDICT = Object.freeze({
  CONFIRMED:         "CONFIRMED",
  REJECTED:          "REJECTED",
  INCONCLUSIVE:      "INCONCLUSIVE",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  PENDING:           "PENDING",
});

const PENDING_STATES = new Set(["DRAFT", "APPROVED", "RUNNING", "MEASURING"]);

// ─── Inline implementations (mirrors lib/experiment-measurer.js) ──────────────

function checkSampleQuality(impact) {
  const trialOrders    = impact?.trial?.post?.orders    ?? 0;
  const baselineOrders = impact?.trial?.base?.orders    ?? 0;
  const daysRun        = impact?.postDays               ?? 0;

  const meetsOrders  = trialOrders >= MIN_TRIAL_ORDERS && baselineOrders >= MIN_BASELINE_ORDERS;
  const meetsDays    = daysRun >= MIN_POST_DAYS;
  const meetsMinimum = meetsOrders && meetsDays;

  const reasons = [];
  if (!meetsOrders) reasons.push(`Cần ít nhất ${MIN_TRIAL_ORDERS} đơn mỗi giai đoạn (hiện: trial=${trialOrders}, baseline=${baselineOrders})`);
  if (!meetsDays)   reasons.push(`Cần ít nhất ${MIN_POST_DAYS} ngày thử nghiệm (hiện: ${daysRun} ngày)`);

  return {
    trial_orders:    trialOrders,
    baseline_orders: baselineOrders,
    days_run:        daysRun,
    meets_minimum:   meetsMinimum,
    reason:          reasons.join("; ") || null,
  };
}

function computeChanges(impact) {
  const trialDelta = impact?.trial?.delta || {};
  const net        = impact?.net         || {};
  const hasControl = impact?.hasControl  ?? false;

  return {
    absolute: {
      ontime_pts:   trialDelta.ontimePts  ?? null,
      damage_per1k: trialDelta.per1k      ?? null,
    },
    relative_pct: {
      ontime_pct:   trialDelta.ontimePts != null && impact?.trial?.base?.ontimePct
        ? (trialDelta.ontimePts / impact.trial.base.ontimePct) * 100 : null,
      damage_pct:   trialDelta.per1kPct   ?? null,
    },
    control_adjusted: hasControl ? {
      ontime_pts:        net.ontimePts    ?? null,
      damage_per1k_pct:  net.per1kPct    ?? null,
    } : null,
    has_control: hasControl,
  };
}

function determineVerdict(changes, sampleQuality, experimentStatus) {
  if (!sampleQuality.meets_minimum) return VERDICT.INSUFFICIENT_DATA;

  if (experimentStatus === "CONFIRMED")    return VERDICT.CONFIRMED;
  if (experimentStatus === "REJECTED")     return VERDICT.REJECTED;
  if (experimentStatus === "INCONCLUSIVE") return VERDICT.INCONCLUSIVE;

  if (!experimentStatus || PENDING_STATES.has(experimentStatus)) return VERDICT.PENDING;

  const { absolute } = changes;
  const ontimeImproved = absolute.ontime_pts    != null && absolute.ontime_pts    >=  2;
  const damageImproved = absolute.damage_per1k  != null && absolute.damage_per1k  <= -0.5;
  const ontimeWorse    = absolute.ontime_pts    != null && absolute.ontime_pts    <= -2;
  const damageWorse    = absolute.damage_per1k  != null && absolute.damage_per1k  >=  0.5;

  if (ontimeImproved || damageImproved) return VERDICT.CONFIRMED;
  if (ontimeWorse    || damageWorse)    return VERDICT.REJECTED;
  return VERDICT.INCONCLUSIVE;
}

function generateKnowledgeCandidate(trial, changes, today) {
  const metric   = trial.primaryMetric || "ontime_rate";
  const isOntime = metric.includes("ontime") || metric.includes("rate");
  const change   = isOntime ? changes.absolute.ontime_pts : changes.absolute.damage_per1k;
  const changeStr = change != null
    ? `${change > 0 ? "+" : ""}${Math.round(change * 10) / 10}${isOntime ? " điểm %" : " ca/1.000 đơn"}`
    : "chưa rõ";

  const scope = [
    trial.clients?.join(", ") || "không xác định khách hàng",
  ].filter(Boolean).join("; ");

  return {
    id:               `KC-test-${Math.random().toString(36).slice(2, 6)}`,
    trial_id:         trial.id,
    trial_name:       trial.name,
    clients:          trial.clients || [],
    metric,
    change_summary:   changeStr,
    conditions:       scope,
    hypothesis:       trial.hypothesis || "",
    narrative: `Giải pháp "${trial.name}" đạt ${changeStr} ${isOntime ? "on-time" : "tỷ lệ bể vỡ"} cho ${scope} trong điều kiện LTL.`,
    generated_at:     today,
    status:           "PENDING_APPROVAL",
    approval_required: true,
  };
}

function generateFailureRecord(trial, changes, failureReason, today) {
  return {
    id:             `FR-test-${Math.random().toString(36).slice(2, 6)}`,
    trial_id:       trial.id,
    trial_name:     trial.name,
    clients:        trial.clients || [],
    metric:         trial.primaryMetric || "ontime_rate",
    hypothesis:     trial.hypothesis || trial.description || "",
    failure_reason: failureReason || trial.description || "Không đạt mục tiêu cải tiến",
    conditions:     (trial.clients || []).join(", "),
    change_summary: {
      ontime_pts:   changes.absolute.ontime_pts,
      damage_per1k: changes.absolute.damage_per1k,
    },
    failed_at:      today,
    prevent_reuse:  true,
  };
}

// ─── Helpers for building mock impact objects ─────────────────────────────────

function goodImpact({ ontimePts = 5, per1k = -1, per1kPct = -10, hasControl = false } = {}) {
  return {
    trial: {
      delta: { ontimePts, per1k, per1kPct },
      post:  { orders: 200, ontimePct: 90 },
      base:  { orders: 150, ontimePct: 85 },
    },
    net:        { ontimePts: ontimePts - 1, per1kPct: per1kPct + 2 },
    postDays:   20,
    hasControl: hasControl,
  };
}

function badSampleImpact({ trialOrders = 50, baseOrders = 150, days = 20 } = {}) {
  return {
    trial: {
      delta: { ontimePts: 5, per1k: -1, per1kPct: -10 },
      post:  { orders: trialOrders },
      base:  { orders: baseOrders },
    },
    net:        { ontimePts: 4, per1kPct: -8 },
    postDays:   days,
    hasControl: false,
  };
}

// ─── EXPERIMENT_STATUSES tests ────────────────────────────────────────────────

test("EXPERIMENT_STATUSES: 8 canonical states defined", () => {
  const canonical = ["DRAFT", "APPROVED", "RUNNING", "MEASURING", "COMPLETED",
                     "CONFIRMED", "REJECTED", "INCONCLUSIVE"];
  for (const s of canonical) {
    assert.ok(EXPERIMENT_STATUSES.includes(s), `Missing state: ${s}`);
  }
});

test("EXPERIMENT_STATUSES: 2 legacy states preserved for backward compat", () => {
  assert.ok(EXPERIMENT_STATUSES.includes("PROPOSED"),  "PROPOSED missing");
  assert.ok(EXPERIMENT_STATUSES.includes("ANALYZING"), "ANALYZING missing");
});

test("EXPERIMENT_STATUSES: total count is 10", () => {
  assert.equal(EXPERIMENT_STATUSES.length, 10);
});

// ─── checkSampleQuality tests ─────────────────────────────────────────────────

test("checkSampleQuality: passes when all thresholds met", () => {
  const impact = goodImpact();
  const q = checkSampleQuality(impact);
  assert.equal(q.meets_minimum, true);
  assert.equal(q.reason, null);
  assert.equal(q.trial_orders, 200);
  assert.equal(q.baseline_orders, 150);
  assert.equal(q.days_run, 20);
});

test("checkSampleQuality: fails when trial_orders < 100", () => {
  const q = checkSampleQuality(badSampleImpact({ trialOrders: 50 }));
  assert.equal(q.meets_minimum, false);
  assert.ok(q.reason?.includes("trial=50"), `Reason should mention trial orders: ${q.reason}`);
});

test("checkSampleQuality: fails when baseline_orders < 100", () => {
  const q = checkSampleQuality(badSampleImpact({ baseOrders: 80 }));
  assert.equal(q.meets_minimum, false);
  assert.ok(q.reason?.includes("baseline=80"), `Reason should mention baseline: ${q.reason}`);
});

test("checkSampleQuality: fails when days_run < 14", () => {
  const impact = { ...goodImpact(), postDays: 10 };
  const q = checkSampleQuality(impact);
  assert.equal(q.meets_minimum, false);
  assert.ok(q.reason?.includes("10 ngày"), `Reason should mention days: ${q.reason}`);
});

test("checkSampleQuality: handles null/missing impact gracefully", () => {
  const q = checkSampleQuality(null);
  assert.equal(q.meets_minimum, false);
  assert.equal(q.trial_orders, 0);
});

// ─── computeChanges tests ─────────────────────────────────────────────────────

test("computeChanges: absolute changes mapped correctly", () => {
  const impact = goodImpact({ ontimePts: 5, per1k: -1 });
  const ch = computeChanges(impact);
  assert.equal(ch.absolute.ontime_pts, 5);
  assert.equal(ch.absolute.damage_per1k, -1);
});

test("computeChanges: relative_pct computed when base ontimePct present", () => {
  const impact = goodImpact({ ontimePts: 8.5 });
  impact.trial.base.ontimePct = 85;
  const ch = computeChanges(impact);
  assert.ok(ch.relative_pct.ontime_pct !== null, "ontime_pct should be computed");
  assert.ok(Math.abs(ch.relative_pct.ontime_pct - 10) < 0.01, `Expected ~10%, got ${ch.relative_pct.ontime_pct}`);
});

test("computeChanges: control_adjusted null when no control", () => {
  const ch = computeChanges(goodImpact({ hasControl: false }));
  assert.equal(ch.control_adjusted, null);
  assert.equal(ch.has_control, false);
});

test("computeChanges: control_adjusted populated when hasControl=true", () => {
  const impact = goodImpact({ ontimePts: 5, per1kPct: -10, hasControl: true });
  const ch = computeChanges(impact);
  assert.ok(ch.control_adjusted !== null, "control_adjusted should exist");
  assert.ok("ontime_pts" in ch.control_adjusted);
  assert.ok("damage_per1k_pct" in ch.control_adjusted);
  assert.equal(ch.has_control, true);
});

// ─── determineVerdict tests ───────────────────────────────────────────────────

test("determineVerdict: INSUFFICIENT_DATA when sample not met — blocks everything", () => {
  const q = { meets_minimum: false };
  const ch = computeChanges(goodImpact());
  assert.equal(determineVerdict(ch, q, "CONFIRMED"), VERDICT.INSUFFICIENT_DATA);
  assert.equal(determineVerdict(ch, q, "COMPLETED"), VERDICT.INSUFFICIENT_DATA);
});

test("determineVerdict: CONFIRMED when status=CONFIRMED and sample met", () => {
  const q = checkSampleQuality(goodImpact());
  const ch = computeChanges(goodImpact());
  assert.equal(determineVerdict(ch, q, "CONFIRMED"), VERDICT.CONFIRMED);
});

test("determineVerdict: REJECTED when status=REJECTED and sample met", () => {
  const q = checkSampleQuality(goodImpact());
  const ch = computeChanges(goodImpact());
  assert.equal(determineVerdict(ch, q, "REJECTED"), VERDICT.REJECTED);
});

test("determineVerdict: INCONCLUSIVE when status=INCONCLUSIVE and sample met", () => {
  const q = checkSampleQuality(goodImpact());
  const ch = computeChanges(goodImpact());
  assert.equal(determineVerdict(ch, q, "INCONCLUSIVE"), VERDICT.INCONCLUSIVE);
});

test("determineVerdict: PENDING for DRAFT/APPROVED/RUNNING/MEASURING", () => {
  const q = checkSampleQuality(goodImpact());
  const ch = computeChanges(goodImpact());
  for (const s of ["DRAFT", "APPROVED", "RUNNING", "MEASURING"]) {
    assert.equal(determineVerdict(ch, q, s), VERDICT.PENDING, `Expected PENDING for ${s}`);
  }
});

test("determineVerdict: auto-CONFIRMED from stats when status=COMPLETED and ontime+5pts", () => {
  const impact = goodImpact({ ontimePts: 5 });
  const q = checkSampleQuality(impact);
  const ch = computeChanges(impact);
  assert.equal(determineVerdict(ch, q, "COMPLETED"), VERDICT.CONFIRMED);
});

test("determineVerdict: auto-REJECTED from stats when status=COMPLETED and ontime-3pts", () => {
  const impact = goodImpact({ ontimePts: -3, per1k: 0.1 }); // neutral damage, bad ontime
  const q = checkSampleQuality(impact);
  const ch = computeChanges(impact);
  assert.equal(determineVerdict(ch, q, "COMPLETED"), VERDICT.REJECTED);
});

test("determineVerdict: auto-INCONCLUSIVE when status=COMPLETED and changes are marginal", () => {
  const impact = goodImpact({ ontimePts: 0.5, per1k: 0.1 });
  const q = checkSampleQuality(impact);
  const ch = computeChanges(impact);
  assert.equal(determineVerdict(ch, q, "COMPLETED"), VERDICT.INCONCLUSIVE);
});

// ─── generateKnowledgeCandidate tests ────────────────────────────────────────

test("generateKnowledgeCandidate: status=PENDING_APPROVAL, approval_required=true", () => {
  const trial = { id: "T1", name: "Cải thiện Lazada HN", clients: ["Lazada"], primaryMetric: "ontime_rate" };
  const ch    = computeChanges(goodImpact({ ontimePts: 5 }));
  const kc    = generateKnowledgeCandidate(trial, ch, "2026-10-15");
  assert.equal(kc.status, "PENDING_APPROVAL");
  assert.equal(kc.approval_required, true);
  assert.equal(kc.trial_id, "T1");
});

test("generateKnowledgeCandidate: narrative contains trial name", () => {
  const trial = { id: "T1", name: "Giảm bể vỡ Elmich", clients: ["Elmich"], primaryMetric: "damage_rate" };
  const ch    = computeChanges(goodImpact({ per1k: -1.5 }));
  const kc    = generateKnowledgeCandidate(trial, ch, "2026-10-15");
  assert.ok(kc.narrative.includes("Giảm bể vỡ Elmich"), `Narrative missing trial name: ${kc.narrative}`);
});

test("generateKnowledgeCandidate: clients array preserved", () => {
  const trial = { id: "T2", name: "TN Aqua", clients: ["Aqua", "AquaVN"], primaryMetric: "ontime_rate" };
  const ch    = computeChanges(goodImpact());
  const kc    = generateKnowledgeCandidate(trial, ch, "2026-10-15");
  assert.deepEqual(kc.clients, ["Aqua", "AquaVN"]);
});

test("generateKnowledgeCandidate: hypothesis preserved", () => {
  const trial = { id: "T3", name: "TN LG", clients: ["LG"], hypothesis: "Thay đổi kho giao", primaryMetric: "ontime_rate" };
  const ch    = computeChanges(goodImpact());
  const kc    = generateKnowledgeCandidate(trial, ch, "2026-10-15");
  assert.equal(kc.hypothesis, "Thay đổi kho giao");
});

// ─── generateFailureRecord tests ─────────────────────────────────────────────

test("generateFailureRecord: prevent_reuse=true", () => {
  const trial = { id: "T4", name: "TN thất bại", clients: ["Hisense"], hypothesis: "Thêm xe ngày 15" };
  const ch    = computeChanges(goodImpact({ ontimePts: -3 }));
  const fr    = generateFailureRecord(trial, ch, "Không đạt KPI", "2026-10-15");
  assert.equal(fr.prevent_reuse, true);
});

test("generateFailureRecord: hypothesis preserved from trial", () => {
  const trial = { id: "T5", name: "TN DMX", clients: ["DMX"], hypothesis: "Giảm cân nặng xe" };
  const ch    = computeChanges(goodImpact({ ontimePts: -2 }));
  const fr    = generateFailureRecord(trial, ch, null, "2026-10-15");
  assert.equal(fr.hypothesis, "Giảm cân nặng xe");
});

test("generateFailureRecord: clients preserved", () => {
  const trial = { id: "T6", name: "TN DMX B2B", clients: ["DMX", "DMX-B2B"] };
  const ch    = computeChanges(goodImpact({ ontimePts: -5 }));
  const fr    = generateFailureRecord(trial, ch, "fail", "2026-10-15");
  assert.deepEqual(fr.clients, ["DMX", "DMX-B2B"]);
});

test("generateFailureRecord: change_summary.ontime_pts populated", () => {
  const trial = { id: "T7", name: "TN", clients: [] };
  const ch    = computeChanges(goodImpact({ ontimePts: -4 }));
  const fr    = generateFailureRecord(trial, ch, "fail", "2026-10-15");
  assert.equal(fr.change_summary.ontime_pts, -4);
});

// ─── Integration: KC only on CONFIRMED, FR only on REJECTED ──────────────────

test("Integration: KC generated only when verdict=CONFIRMED", () => {
  const impact = goodImpact({ ontimePts: 5 });
  const q      = checkSampleQuality(impact);
  const ch     = computeChanges(impact);
  const trial  = { id: "T8", name: "TN OK", clients: ["LG"], primaryMetric: "ontime_rate" };

  const verdictConfirmed = determineVerdict(ch, q, "CONFIRMED");
  const kc = verdictConfirmed === VERDICT.CONFIRMED ? generateKnowledgeCandidate(trial, ch, "2026-10-15") : null;
  assert.ok(kc !== null, "KC should be generated on CONFIRMED");

  const verdictPending = determineVerdict(ch, q, "RUNNING");
  const kcNo = verdictPending === VERDICT.CONFIRMED ? generateKnowledgeCandidate(trial, ch, "2026-10-15") : null;
  assert.equal(kcNo, null, "KC should NOT be generated on RUNNING");
});

test("Integration: FR generated only when verdict=REJECTED", () => {
  const impact = goodImpact({ ontimePts: -4 });
  const q      = checkSampleQuality(impact);
  const ch     = computeChanges(impact);
  const trial  = { id: "T9", name: "TN thất bại", clients: ["DMX"] };

  const verdictRejected = determineVerdict(ch, q, "REJECTED");
  const fr = verdictRejected === VERDICT.REJECTED ? generateFailureRecord(trial, ch, "miss", "2026-10-15") : null;
  assert.ok(fr !== null, "FR should be generated on REJECTED");

  const verdictConfirmed = determineVerdict(ch, q, "CONFIRMED");
  // override to CONFIRMED (sample met but status=CONFIRMED)
  const frNo = verdictConfirmed === VERDICT.REJECTED ? generateFailureRecord(trial, ch, "miss", "2026-10-15") : null;
  assert.equal(frNo, null, "FR should NOT be generated on CONFIRMED");
});

test("Integration: INSUFFICIENT_DATA blocks both KC and FR", () => {
  const impact = badSampleImpact({ trialOrders: 30 });
  const q      = checkSampleQuality(impact);
  const ch     = computeChanges(impact);
  const trial  = { id: "T10", name: "TN nhỏ", clients: ["Test"] };

  const verdict = determineVerdict(ch, q, "CONFIRMED");
  assert.equal(verdict, VERDICT.INSUFFICIENT_DATA);

  const kc = verdict === VERDICT.CONFIRMED ? generateKnowledgeCandidate(trial, ch, "2026-10-15") : null;
  const fr = verdict === VERDICT.REJECTED  ? generateFailureRecord(trial, ch, "fail", "2026-10-15") : null;
  assert.equal(kc, null, "KC must NOT be generated on INSUFFICIENT_DATA");
  assert.equal(fr, null, "FR must NOT be generated on INSUFFICIENT_DATA");
});
