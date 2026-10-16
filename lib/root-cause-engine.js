/**
 * lib/root-cause-engine.js — Root Cause Intelligence Engine (Phase 3).
 *
 * Deterministic analysis that PRECEDES any AI reasoning.
 * NEVER claims "root cause = X" — only "candidate cause" with evidence level.
 *
 * Pipeline:
 *   anomaly + base
 *     → context retrieval (build time windows for the affected entity)
 *     → contribution analysis (which province/warehouse drove the delta?)
 *     → peer comparison (is this isolated or system-wide?)
 *     → candidate causes (with evidence levels)
 *     → structured output (used by /api/root-cause to feed the AI)
 *
 * Exports:
 *   analyzeRootCause(anomaly, base) → RootCauseResult
 *   buildContributionBreakdown(rows, entityId, entityType, windowFrom, windowTo, basFrom, basTo) → ContributionBreakdown
 */
import { getOntimeOutcome } from "./transform-ltl";
import { countedDamage, compAmount } from "./damage-rules";

const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// ─── Evidence levels ─────────────────────────────────────────────────────────
export const EVIDENCE = {
  STRONG:          "STRONG",          // large sample, quantified, consistent pattern
  MODERATE:        "MODERATE",        // correlation found, causation unproven
  WEAK:            "WEAK",            // possible link, small sample
  CIRCUMSTANTIAL:  "CIRCUMSTANTIAL",  // timing/coincidence only
};

function emptyBucket() {
  return { orders: 0, ontime: 0, late: 0, ret: 0, cancel: 0, cases: 0, comp: 0 };
}

function ontimeRate(b) {
  const e = b.ontime + b.late;
  return e > 0 ? (b.ontime / e) * 100 : null;
}

function damageRate(b) {
  return b.orders > 0 ? b.cases / b.orders : 0;
}

function evidenceLevel(sampleSize, deltaAbs) {
  if (sampleSize >= 200 && deltaAbs > 8) return EVIDENCE.STRONG;
  if (sampleSize >= 80  && deltaAbs > 4) return EVIDENCE.MODERATE;
  if (sampleSize >= 30  && deltaAbs > 2) return EVIDENCE.WEAK;
  return EVIDENCE.CIRCUMSTANTIAL;
}

// ─── Build time-bucketed data for a subset of rows ───────────────────────────
function bucketRows(rows, from, to) {
  const b = emptyBucket();
  for (const r of rows) {
    const day = String(r.pickup_time || "").slice(0, 10);
    if (!day || day < from || day > to) continue;
    b.orders++;
    const o = getOntimeOutcome(r);
    if (o === "ontime")      b.ontime++;
    else if (o === "late")   b.late++;
    else if (o === "return") b.ret++;
  }
  return b;
}

// ─── Contribution analysis ────────────────────────────────────────────────────
// Breaks down which dimension (province / warehouse) drove most of the delta.
export function buildContributionBreakdown(rows, entityId, entityType, curFrom, curTo, basFrom, basTo) {
  // Filter to affected entity's orders
  const entityRows = entityType === "client"
    ? rows.filter((r) => String(r.client_name || "").trim() === entityId)
    : entityType === "province"
    ? rows.filter((r) => String(r.to_province_name || "").trim() === entityId)
    : rows;

  // Group by secondary dimension
  const groupDim = entityType === "client" ? "to_province_name" : "client_name";
  const groups = {};
  for (const r of entityRows) {
    const key = String(r[groupDim] || "").trim() || "(không rõ)";
    if (!groups[key]) groups[key] = { curRows: [], basRows: [] };
    const day = String(r.pickup_time || "").slice(0, 10);
    if (day >= curFrom && day <= curTo) groups[key].curRows.push(r);
    if (day >= basFrom && day <= basTo) groups[key].basRows.push(r);
  }

  // Overall buckets for normalisation
  const totalCur = bucketRows(entityRows, curFrom, curTo);
  const totalBas = bucketRows(entityRows, basFrom, basTo);
  const totalCurOT = ontimeRate(totalCur);
  const totalBasOT = ontimeRate(totalBas);
  const totalDelta = totalBasOT !== null && totalCurOT !== null ? totalBasOT - totalCurOT : 0;

  const contributors = [];
  for (const [grp, { curRows, basRows }] of Object.entries(groups)) {
    const cbCur = { orders: 0, ontime: 0, late: 0, ret: 0, cancel: 0, cases: 0, comp: 0 };
    const cbBas = { orders: 0, ontime: 0, late: 0, ret: 0, cancel: 0, cases: 0, comp: 0 };
    for (const r of curRows) {
      cbCur.orders++;
      const o = getOntimeOutcome(r);
      if (o === "ontime") cbCur.ontime++; else if (o === "late") cbCur.late++;
    }
    for (const r of basRows) {
      cbBas.orders++;
      const o = getOntimeOutcome(r);
      if (o === "ontime") cbBas.ontime++; else if (o === "late") cbBas.late++;
    }

    const curOT = ontimeRate(cbCur);
    const basOT = ontimeRate(cbBas);
    if (curOT === null && basOT === null) continue;

    // contribution = (fraction of current orders) × (how much this group dropped)
    const eligible = cbCur.ontime + cbCur.late;
    const totalEligible = totalCur.ontime + totalCur.late;
    const groupDelta = basOT !== null && curOT !== null ? basOT - curOT : 0;
    const weightedContrib = totalEligible > 0 ? (eligible / totalEligible) * groupDelta : 0;
    const shareOfDelta = Math.abs(totalDelta) > 0.01 ? (weightedContrib / totalDelta) * 100 : 0;

    contributors.push({
      entity: grp,
      entity_type: groupDim === "to_province_name" ? "province" : "client",
      current_value: curOT !== null ? round1(curOT) : null,
      baseline_value: basOT !== null ? round1(basOT) : null,
      delta: curOT !== null && basOT !== null ? round1(curOT - basOT) : null,
      current_orders: eligible,
      share_of_delta_pct: round1(shareOfDelta),
      weighted_contribution: round1(weightedContrib),
    });
  }

  // Sort by absolute contribution descending
  contributors.sort((a, b) => Math.abs(b.share_of_delta_pct || 0) - Math.abs(a.share_of_delta_pct || 0));

  return {
    total_current_value: totalCurOT !== null ? round1(totalCurOT) : null,
    total_baseline_value: totalBasOT !== null ? round1(totalBasOT) : null,
    total_delta: round1(-totalDelta), // negative = drop
    top_contributors: contributors.slice(0, 5),
    breakdown_dimension: groupDim === "to_province_name" ? "province" : "client",
  };
}

// ─── Peer comparison ──────────────────────────────────────────────────────────
function buildPeerComparison(rows, entityId, curFrom, curTo) {
  const byClient = {};
  for (const r of rows) {
    const day = String(r.pickup_time || "").slice(0, 10);
    if (!day || day < curFrom || day > curTo) continue;
    const c = String(r.client_name || "").trim() || "(không rõ)";
    if (!byClient[c]) byClient[c] = emptyBucket();
    byClient[c].orders++;
    const o = getOntimeOutcome(r);
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
  const entityOT = entityPeer?.ot ?? null;
  const rank = entityPeer ? peers.findIndex((p) => p.client === entityId) + 1 : null;
  const percentile = rank !== null ? Math.round(((peers.length - rank) / peers.length) * 100) : null;
  const belowMedianClients = peers.filter((p) => p.ot < (peerMedian || 0) - 3).length;
  const systemWideDropCount = belowMedianClients;

  return {
    entity_value: entityOT !== null ? round1(entityOT) : null,
    peer_median: peerMedian !== null ? round1(peerMedian) : null,
    peer_count: peers.length,
    entity_rank: rank,
    entity_percentile: percentile,
    below_median_count: belowMedianClients,
    system_wide_drop: systemWideDropCount >= Math.ceil(peers.length * 0.5),
    peers_snapshot: peers.slice(0, 6).map((p) => ({ client: p.client, ot: round1(p.ot), orders: p.orders })),
  };
}

// ─── Damage spike check ───────────────────────────────────────────────────────
function checkDamageSpike(damageCauses, entityId, curFrom, curTo, basFrom, basTo, entityOrders) {
  const entityCases = (damageCauses || []).filter((c) => {
    const day = String(c.pickup_time || c.created_time || "").slice(0, 10);
    const client = String(c.client_name || "").trim();
    return client === entityId && day >= curFrom && day <= curTo;
  });
  const basCases = (damageCauses || []).filter((c) => {
    const day = String(c.pickup_time || c.created_time || "").slice(0, 10);
    const client = String(c.client_name || "").trim();
    return client === entityId && day >= basFrom && day <= basTo;
  });

  const curRate = entityOrders > 0 ? entityCases.length / entityOrders : 0;
  const basOrders = entityOrders; // approximate; use same denominator
  const basRate = basOrders > 0 ? basCases.length / basOrders : 0;
  const spike = basRate > 0 ? ((curRate - basRate) / basRate) * 100 : (curRate > 0 ? 100 : 0);

  return { cur_cases: entityCases.length, bas_cases: basCases.length, cur_rate: round1(curRate * 1000) / 10, spike_pct: round1(spike) };
}

// ─── Generate candidate causes ────────────────────────────────────────────────
function generateCandidateCauses(anomaly, contribution, peerComp, damageInfo) {
  const causes = [];
  const metric = anomaly.metric;
  const delta = Math.abs(anomaly.delta || 0);

  // Cause 1: Concentrated geographic drop
  if (contribution && contribution.top_contributors.length > 0) {
    const top = contribution.top_contributors[0];
    const topShare = Math.abs(top.share_of_delta_pct || 0);
    if (topShare >= 40 && top.entity !== "(không rõ)") {
      causes.push({
        cause_id: `geographic_concentration:${top.entity}`,
        title: `Tập trung sụt giảm tại ${contribution.breakdown_dimension === "province" ? "tỉnh" : "khu vực"} ${top.entity}`,
        description: `${top.entity} đóng góp ${round1(topShare)}% vào tổng sụt giảm (on-time hiện tại: ${top.current_value}% vs cơ sở: ${top.baseline_value}%). Đây là ứng viên nguyên nhân địa lý.`,
        evidence_level: evidenceLevel(top.current_orders || 0, Math.abs(top.delta || 0)),
        supporting_evidence: [
          `${top.entity}: ${top.current_value}% → ${top.delta > 0 ? "+" : ""}${top.delta}% so baseline`,
          `Chiếm ${round1(topShare)}% tổng delta`,
        ],
        contradicting_evidence: topShare < 60 ? [`Các tỉnh/khu vực còn lại chiếm ${round1(100 - topShare)}% delta — không hoàn toàn cô lập`] : [],
      });
    }
  }

  // Cause 2: System-wide drop (network-level issue)
  if (peerComp && peerComp.system_wide_drop) {
    causes.push({
      cause_id: "system_wide_issue",
      title: "Vấn đề hệ thống toàn mạng (không cô lập một khách hàng)",
      description: `${peerComp.below_median_count}/${peerComp.peer_count} khách hàng cùng sụt giảm dưới median nhóm. Có thể do yếu tố vận hành chung (thời tiết, sự cố kho, tắc nghẽn hệ thống).`,
      evidence_level: EVIDENCE.MODERATE,
      supporting_evidence: [
        `Median nhóm: ${peerComp.peer_median}% — ${peerComp.below_median_count} khách dưới ngưỡng`,
        `${anomaly.entity_id} xếp hạng ${peerComp.entity_rank}/${peerComp.peer_count} (percentile ${peerComp.entity_percentile}%)`,
      ],
      contradicting_evidence: [],
    });
  }

  // Cause 3: Client-specific issue (peers are fine)
  if (peerComp && !peerComp.system_wide_drop && peerComp.entity_percentile !== null && peerComp.entity_percentile < 30) {
    const gap = peerComp.peer_median !== null && peerComp.entity_value !== null
      ? round1(peerComp.peer_median - peerComp.entity_value) : null;
    causes.push({
      cause_id: "client_specific_issue",
      title: `Vấn đề đặc thù khách hàng ${anomaly.entity_id} (các peer ổn định)`,
      description: `${anomaly.entity_id} đang ở percentile ${peerComp.entity_percentile}% trong nhóm — nghĩa là đa số khách hàng tốt hơn. Khoảng cách vs median: ${gap !== null ? gap + " điểm" : "N/A"}. Cần kiểm tra quy trình đặc thù của khách này.`,
      evidence_level: gap !== null && gap > 5 ? EVIDENCE.MODERATE : EVIDENCE.WEAK,
      supporting_evidence: [
        `Median nhóm: ${peerComp.peer_median}%, ${anomaly.entity_id}: ${peerComp.entity_value}%`,
        `Chỉ ${peerComp.below_median_count}/${peerComp.peer_count} khách cùng sụt giảm`,
      ],
      contradicting_evidence: gap !== null && gap < 5 ? ["Khoảng cách vs median nhỏ (<5 điểm), có thể là biến động ngẫu nhiên"] : [],
    });
  }

  // Cause 4: Damage spike accompanies ontime drop
  if (metric === "ontime_rate" && damageInfo && damageInfo.spike_pct > 30 && damageInfo.cur_cases >= 2) {
    causes.push({
      cause_id: "damage_correlation",
      title: "Spike hư hỏng xảy ra đồng thời với sụt giảm on-time",
      description: `Ca hư hỏng tăng ${damageInfo.spike_pct}% (${damageInfo.bas_cases}→${damageInfo.cur_cases} ca). Có thể liên quan đến bốc xếp sai quy trình hoặc vấn đề kho giao làm trễ thêm.`,
      evidence_level: damageInfo.cur_cases >= 5 ? EVIDENCE.MODERATE : EVIDENCE.WEAK,
      supporting_evidence: [`Ca hư hỏng: ${damageInfo.cur_cases} ca (tăng ${damageInfo.spike_pct}% vs baseline)`],
      contradicting_evidence: damageInfo.cur_cases < 3 ? ["Số ca hư hỏng nhỏ — có thể là nhiễu thống kê"] : [],
    });
  }

  // Cause 5: Threshold breach only (no other context)
  if (causes.length === 0) {
    causes.push({
      cause_id: "unknown_decline",
      title: "Sụt giảm chưa xác định được nguyên nhân rõ ràng",
      description: `Không đủ dữ liệu để khoanh vùng nguyên nhân. ${metric === "ontime_rate" ? "On-time" : metric} sụt ${round1(delta)} điểm nhưng bằng chứng chưa đủ mạnh để kết luận.`,
      evidence_level: EVIDENCE.CIRCUMSTANTIAL,
      supporting_evidence: [`Delta: ${round1(delta)} điểm so baseline`],
      contradicting_evidence: ["Mẫu có thể chưa đủ lớn để phân biệt với biến động tự nhiên"],
    });
  }

  return causes;
}

// ─── Confidence score ─────────────────────────────────────────────────────────
function computeOverallConfidence(anomaly, contribution, peerComp, candidates) {
  let score = 40; // baseline

  // Evidence from anomaly detection
  if (anomaly.confidence)   score += Math.round((anomaly.confidence - 0.6) * 50);

  // Contribution analysis available
  if (contribution && contribution.top_contributors.length > 0) {
    const topShare = Math.abs(contribution.top_contributors[0]?.share_of_delta_pct || 0);
    if (topShare >= 60)      score += 20;
    else if (topShare >= 40) score += 10;
  }

  // Peer comparison available
  if (peerComp) score += 10;

  // Strong evidence candidates
  const strongCount = candidates.filter((c) => c.evidence_level === EVIDENCE.STRONG).length;
  const modCount    = candidates.filter((c) => c.evidence_level === EVIDENCE.MODERATE).length;
  score += strongCount * 10 + modCount * 5;

  return Math.min(95, Math.max(20, Math.round(score)));
}

// ─── Build investigation gaps ─────────────────────────────────────────────────
function buildMissingDataPoints(contribution, peerComp, damageInfo) {
  const missing = [];
  if (!peerComp)                      missing.push("Chưa đủ dữ liệu peer (< 2 khách hàng đủ mẫu trong kỳ hiện tại)");
  if (!contribution || contribution.top_contributors.length === 0)
                                      missing.push("Không phân tách được tỉnh/khu vực (thiếu to_province_name)");
  if (!damageInfo || damageInfo.cur_cases === 0)
                                      missing.push("Không có dữ liệu hư hỏng liên kết được với kỳ này");
  return missing;
}

function buildRecommendedInvestigations(anomaly, contribution, peerComp) {
  const steps = [];
  if (contribution && contribution.top_contributors[0]) {
    const top = contribution.top_contributors[0];
    steps.push(`Kiểm tra tuyến/kho tại ${top.entity} trong kỳ ${anomaly.evidence?.window_label || "hiện tại"}`);
  }
  if (peerComp && peerComp.system_wide_drop) {
    steps.push("Kiểm tra sự cố vận hành hệ thống (kho hub, xe tải, thời tiết) ảnh hưởng nhiều khách");
  } else if (peerComp && !peerComp.system_wide_drop) {
    steps.push(`So sánh quy trình xử lý đơn của ${anomaly.entity_id} với khách hàng top percentile`);
  }
  steps.push("Xác nhận lại dữ liệu raw_ontime: có lô đơn nào pickup nhưng chưa cập nhật trạng thái không?");
  return steps;
}

function buildRecommendedActions(anomaly, candidates) {
  const actions = [];
  const topCause = candidates[0];
  if (!topCause) return actions;

  if (topCause.cause_id.startsWith("geographic_concentration:")) {
    const entity = topCause.cause_id.replace("geographic_concentration:", "");
    actions.push(`Liên hệ kho/bưu cục tại ${entity} để xác nhận tình trạng xử lý đơn tuần này`);
    actions.push("Xem xét phân bổ lại tài nguyên hoặc ưu tiên xử lý tuyến bị ảnh hưởng");
  } else if (topCause.cause_id === "system_wide_issue") {
    actions.push("Escalate lên đội vận hành cấp khu vực để kiểm tra sự cố mạng diện rộng");
  } else if (topCause.cause_id === "client_specific_issue") {
    actions.push(`Gặp team phụ trách ${anomaly.entity_id} để review quy trình đặc thù`);
  } else if (topCause.cause_id === "damage_correlation") {
    actions.push("Kiểm tra quy trình bốc xếp tại kho giao, đặc biệt hàng có giá trị cao");
  }
  if (anomaly.severity === "CRITICAL") {
    actions.unshift(`⚠ ƯU TIÊN CAO: ${anomaly.entity_id} đang CRITICAL — cần xử lý trong 24h`);
  }
  return actions;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function analyzeRootCause(anomaly, base) {
  if (!anomaly || !base) {
    return { error: "Thiếu anomaly hoặc base data" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const curFrom = addDays(today, -7);
  const curTo   = addDays(today, -1);
  const basFrom = addDays(today, -35);
  const basTo   = addDays(today, -8);

  // Use anomaly's own windows if available
  const windowLabel = anomaly.evidence?.window_label || `${curFrom}→${curTo}`;
  const windowParts = windowLabel.split("→");
  const aCurFrom = windowParts[0] || curFrom;
  const aCurTo   = windowParts[1] || curTo;

  const entityId   = anomaly.entity_id || "";
  const entityType = anomaly.entity_type || "client";
  const metric     = anomaly.metric || "ontime_rate";

  // 1. Contribution analysis (which sub-group drove the delta?)
  const contribution = metric === "ontime_rate" && base.ltlRows?.length
    ? buildContributionBreakdown(base.ltlRows, entityId, entityType, aCurFrom, aCurTo, basFrom, basTo)
    : null;

  // 2. Peer comparison
  const peerComp = base.ltlRows?.length
    ? buildPeerComparison(base.ltlRows, entityId, aCurFrom, aCurTo)
    : null;

  // 3. Damage spike check
  const entityCurBucket = contribution
    ? { orders: base.ltlRows.filter((r) => String(r.client_name || "").trim() === entityId && String(r.pickup_time || "").slice(0, 10) >= aCurFrom && String(r.pickup_time || "").slice(0, 10) <= aCurTo).length }
    : { orders: anomaly.evidence?.sample_size || 0 };

  const damageInfo = base.rawDamageCauses?.length
    ? checkDamageSpike(base.rawDamageCauses, entityId, aCurFrom, aCurTo, basFrom, basTo, entityCurBucket.orders)
    : null;

  // 4. Generate candidate causes
  const candidateCauses = generateCandidateCauses(anomaly, contribution, peerComp, damageInfo);

  // 5. Overall confidence
  const confidenceScore = computeOverallConfidence(anomaly, contribution, peerComp, candidateCauses);

  // 6. Assemble output
  return {
    anomaly_id: anomaly.anomaly_id,
    analyzed_at: new Date().toISOString(),

    what: {
      summary: anomaly.title || `${metric} bất thường cho ${entityId}`,
      metric,
      entity_type: entityType,
      entity_id: entityId,
      current_value: anomaly.current_value,
      baseline_value: anomaly.baseline_value,
      delta: anomaly.delta,
      severity: anomaly.severity,
      detection_rule: anomaly.detection_rule,
      window_label: windowLabel,
    },

    contribution_analysis: contribution,
    peer_comparison: peerComp,
    damage_context: damageInfo,

    candidate_causes: candidateCauses,
    confidence_score: confidenceScore,

    missing_data_points: buildMissingDataPoints(contribution, peerComp, damageInfo),
    recommended_investigations: buildRecommendedInvestigations(anomaly, contribution, peerComp),
    recommended_actions: buildRecommendedActions(anomaly, candidateCauses),
  };
}
