/**
 * lib/experiment-measurer.js — Phase 5: Statistical Measurement Engine.
 *
 * Wraps computeTrialImpact (lib/trials.js) with:
 *   - 3-way comparison output: absolute / relative / control-adjusted change
 *   - Sample quality GATE: TUYỆT ĐỐI KHÔNG tuyên bố "Thành công" nếu sample size
 *     hoặc data quality không đạt.
 *   - Experiment lifecycle verdict: CONFIRMED / REJECTED / INCONCLUSIVE /
 *     INSUFFICIENT_DATA / PENDING — mapped from the 8-state experiment_status.
 *   - Knowledge Candidate generation (when CONFIRMED): human approval required.
 *   - Failure Record generation (when REJECTED): stored for AI retrieval so the
 *     AI never re-proposes the same solution under the same conditions.
 */
import { computeTrialImpact, MIN_POST_ORDERS, MIN_POST_DAYS } from "./trials.js";

export const MIN_TRIAL_ORDERS    = MIN_POST_ORDERS; // 100
export const MIN_BASELINE_ORDERS = MIN_POST_ORDERS; // 100

export const VERDICT = Object.freeze({
  CONFIRMED:        "CONFIRMED",
  REJECTED:         "REJECTED",
  INCONCLUSIVE:     "INCONCLUSIVE",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  PENDING:          "PENDING",
});

const PENDING_STATES = new Set(["DRAFT", "APPROVED", "RUNNING", "MEASURING"]);

function newId(prefix) {
  const vn = new Date(Date.now() + 7 * 3600_000).toISOString();
  return `${prefix}-${vn.slice(2, 4)}${vn.slice(5, 7)}${vn.slice(8, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * Assesses whether sample size and run duration meet the minimums required to
 * draw any conclusion. Returns a structured quality object with a boolean gate.
 */
export function checkSampleQuality(impact) {
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

/**
 * Formats the 3-way comparison from a computeTrialImpact result into clearly
 * labelled change objects (absolute / relative / control-adjusted).
 */
export function computeChanges(impact) {
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
      ontime_pts:   net.ontimePts         ?? null,
      damage_per1k_pct: net.per1kPct      ?? null,
    } : null,
    has_control: hasControl,
  };
}

/**
 * Determines the experiment verdict from:
 *   1. The sample quality gate (always checked first — blocks CONFIRMED).
 *   2. The explicit experiment_status lifecycle state.
 *   3. Auto-verdict from statistical evidence when status is "COMPLETED".
 */
export function determineVerdict(changes, sampleQuality, experimentStatus) {
  // Safety gate: insufficient data overrides everything
  if (!sampleQuality.meets_minimum) return VERDICT.INSUFFICIENT_DATA;

  // Explicit lifecycle state
  if (experimentStatus === "CONFIRMED")    return VERDICT.CONFIRMED;
  if (experimentStatus === "REJECTED")     return VERDICT.REJECTED;
  if (experimentStatus === "INCONCLUSIVE") return VERDICT.INCONCLUSIVE;

  // Pending states — experiment still in progress
  if (!experimentStatus || PENDING_STATES.has(experimentStatus)) return VERDICT.PENDING;

  // "COMPLETED" or legacy states → auto-verdict from statistical evidence
  const { absolute } = changes;
  const ontimeImproved = absolute.ontime_pts    != null && absolute.ontime_pts    >=  2;
  const damageImproved = absolute.damage_per1k  != null && absolute.damage_per1k  <= -0.5;
  const ontimeWorse    = absolute.ontime_pts    != null && absolute.ontime_pts    <= -2;
  const damageWorse    = absolute.damage_per1k  != null && absolute.damage_per1k  >=  0.5;

  if (ontimeImproved || damageImproved) return VERDICT.CONFIRMED;
  if (ontimeWorse    || damageWorse)    return VERDICT.REJECTED;
  return VERDICT.INCONCLUSIVE;
}

/**
 * Generates a Knowledge Candidate for human approval when a trial is CONFIRMED.
 * Narrative = human-readable summary ready to seed into AI Brain / SOP.
 * status = "PENDING_APPROVAL" until a manager confirms it.
 */
export function generateKnowledgeCandidate(trial, changes, today) {
  const metric   = trial.primaryMetric || "ontime_rate";
  const isOntime = metric.includes("ontime") || metric.includes("rate");
  const change   = isOntime ? changes.absolute.ontime_pts : changes.absolute.damage_per1k;
  const changeStr = change != null
    ? `${change > 0 ? "+" : ""}${Math.round(change * 10) / 10}${isOntime ? " điểm %" : " ca/1.000 đơn"}`
    : "chưa rõ";

  const scope = [
    trial.clients?.join(", ") || "không xác định khách hàng",
    trial.khoLay?.length  ? `kho lấy: ${trial.khoLay.join(", ")}`  : null,
    trial.khoGiao?.length ? `kho giao: ${trial.khoGiao.join(", ")}` : null,
  ].filter(Boolean).join("; ");

  return {
    id:               newId("KC"),
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

/**
 * Generates a Failure Record when a trial is REJECTED.
 * prevent_reuse = true signals the AI Aggregator to avoid re-proposing this
 * solution under matching conditions (same clients + scope + hypothesis).
 */
export function generateFailureRecord(trial, changes, failureReason, today) {
  return {
    id:             newId("FR"),
    trial_id:       trial.id,
    trial_name:     trial.name,
    clients:        trial.clients || [],
    metric:         trial.primaryMetric || "ontime_rate",
    hypothesis:     trial.hypothesis || trial.description || "",
    failure_reason: failureReason || trial.description || "Không đạt mục tiêu cải tiến",
    conditions:     [
      trial.clients?.join(", "),
      trial.khoLay?.length  ? `kho lấy: ${trial.khoLay.join(", ")}`  : null,
      trial.khoGiao?.length ? `kho giao: ${trial.khoGiao.join(", ")}` : null,
    ].filter(Boolean).join("; "),
    change_summary: {
      ontime_pts:   changes.absolute.ontime_pts,
      damage_per1k: changes.absolute.damage_per1k,
    },
    failed_at:      today,
    prevent_reuse:  true,
  };
}

/**
 * Full measurement pipeline for one trial.
 * Calls computeTrialImpact, applies the quality gate, computes structured
 * changes, determines verdict, and generates knowledge/failure artefacts.
 */
export function measureExperiment(trial, base, today) {
  const impact        = computeTrialImpact(base, trial, today);
  const sampleQuality = checkSampleQuality(impact);
  const changes       = computeChanges(impact);
  const verdict       = determineVerdict(changes, sampleQuality, trial.experimentStatus);

  const knowledgeCandidate = verdict === VERDICT.CONFIRMED
    ? generateKnowledgeCandidate(trial, changes, today) : null;

  const failureRecord = verdict === VERDICT.REJECTED
    ? generateFailureRecord(trial, changes, trial.failureReason, today) : null;

  return {
    trial_id:          trial.id,
    trial_name:        trial.name,
    experiment_status: trial.experimentStatus || "",
    verdict,
    sample_quality:    sampleQuality,
    changes,
    impact,
    knowledge_candidate: knowledgeCandidate,
    failure_record:      failureRecord,
    measured_at:         today,
  };
}
