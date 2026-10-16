/**
 * lib/anomaly-detector.js — Proactive anomaly detection engine (Phase 2).
 *
 * Deterministic/statistical only. NEVER uses LLM to decide if a KPI is anomalous.
 * AI is called AFTER anomalies are detected, only for explanation.
 *
 * Exports:
 *   scanAnomalies(base, opts)       → anomaly[] (all 7 rule types)
 *   detectDailyAnomalies(base, today) → top-3 for backward compat (legacy API)
 *
 * Each anomaly object:
 *   { anomaly_id, detected_at, metric, entity_type, entity_id,
 *     current_value, baseline_value, delta, severity, confidence,
 *     evidence, detection_rule, status,
 *     title, impactScore, recommendedAction }   ← legacy fields kept
 */
import { getOntimeOutcome } from "./transform-ltl";
import { countedDamage, compAmount } from "./damage-rules";

const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

// ─── Severity thresholds (hard) ─────────────────────────────────────────────
const THRESHOLD = {
  ontime_rate:   { CRITICAL: 80,   HIGH: 85   },  // < value (pts)
  damage_rate:   { CRITICAL: 0.03, HIGH: 0.015 }, // cases/order
  comp_per_order: { CRITICAL: 500_000, HIGH: 200_000 }, // VND/order
};

const COOLDOWN_H = 4;

// ─── Minimum sample sizes ───────────────────────────────────────────────────
const MIN_CUR  = 20;  // orders in current window for statistical rules
const MIN_BASE = 50;  // orders in baseline window
const MIN_DAY  = 10;  // orders in a single day for sudden-change
const MIN_WEEK = 15;  // orders in a week for persistent-deterioration

// ─── Change thresholds by rule ───────────────────────────────────────────────
const WOW_ONTIME_DROP   = 4;   // pts
const WOW_DAMAGE_SPIKE  = 40;  // %
const WOW_COMP_SPIKE    = 50;  // %
const ROLLING_OT_DROP   = 3;   // pts vs 4-week avg
const ROLLING_DMG_SPIKE = 30;  // % vs 4-week avg
const SUDDEN_OT_DROP    = 6;   // pts day-over-day
const SUDDEN_DMG_SPIKE  = 80;  // % day-over-day
const PERSIST_OT_DROP   = 2;   // pts per period for 3 consecutive periods
const PEER_OT_GAP       = 8;   // pts below peer-group median

// ─── Helpers ────────────────────────────────────────────────────────────────
function emptyBucket() {
  return { orders: 0, ontime: 0, late: 0, ret: 0, cancel: 0, cases: 0, comp: 0 };
}

function ontimeRate(b) {
  const eligible = b.ontime + b.late;
  return eligible > 0 ? (b.ontime / eligible) * 100 : null;
}

function damageRate(b) {
  return b.orders > 0 ? b.cases / b.orders : 0;
}

function compPerOrder(b) {
  return b.orders > 0 ? b.comp / b.orders : 0;
}

function confidence(sampleSize) {
  if (sampleSize >= 300) return 0.95;
  if (sampleSize >= 150) return 0.9;
  if (sampleSize >= 80)  return 0.8;
  if (sampleSize >= 40)  return 0.7;
  return 0.6;
}

function severity(rule, metric, magnitude) {
  if (rule === "threshold") {
    if (metric === "ontime_rate") {
      return magnitude <= THRESHOLD.ontime_rate.CRITICAL ? "CRITICAL" : "HIGH";
    }
    if (metric === "damage_rate") {
      return magnitude >= THRESHOLD.damage_rate.CRITICAL ? "CRITICAL" : "HIGH";
    }
    if (metric === "comp_per_order") {
      return magnitude >= THRESHOLD.comp_per_order.CRITICAL ? "CRITICAL" : "HIGH";
    }
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
  const slug = `${rule}:${metric}:${String(entityId).slice(0, 40)}:${windowLabel}`;
  return slug.replace(/[^a-z0-9:.\-_]/gi, "-").toLowerCase();
}

function makeAnomaly({ rule, metric, entityType, entityId, curVal, basVal, delta, magnitude, sampleSize, windowLabel, title, recommended, evidence }) {
  const sev = severity(rule, metric, magnitude);
  const conf = confidence(sampleSize);
  const impactScore = Math.min(100, Math.round(magnitude * (metric === "ontime_rate" ? 5 : 0.4) + sampleSize * 0.05));
  return {
    anomaly_id: anomalyId(rule, metric, entityId, windowLabel),
    detected_at: new Date().toISOString(),
    metric,
    entity_type: entityType,
    entity_id: entityId,
    current_value: curVal,
    baseline_value: basVal,
    delta,
    severity: sev,
    confidence: conf,
    evidence: { ...evidence, window_label: windowLabel, sample_size: sampleSize },
    detection_rule: rule,
    status: "DETECTED",
    // Legacy fields
    title,
    location: entityId,
    impactScore,
    rootCauseProbability: conf > 0.85 ? "high" : conf > 0.7 ? "medium" : "low",
    recommendedAction: recommended,
    sampleOrders: sampleSize,
    periodLabel: windowLabel,
  };
}

// ─── Aggregate data into time buckets ────────────────────────────────────────
function buildBuckets(ltlRows, damageCauses, today) {
  const t      = today;
  const curFrom = addDays(t, -7);
  const curTo   = addDays(t, -1);
  const basFrom = addDays(t, -35);
  const basTo   = addDays(t, -8);
  const w2From  = addDays(t, -14);
  const w2To    = addDays(t, -8);
  const w3From  = addDays(t, -21);
  const w3To    = addDays(t, -15);
  const ydayStr = addDays(t, -1);
  const ddayStr = addDays(t, -2);

  // byClient / byProv: { cur, bas, w2, w3, yday, dday }
  const byClient = {};
  const byProv   = {};
  const orderMap = new Map(); // order_code → { client, prov, period }

  for (const r of ltlRows) {
    const day = String(r.pickup_time || "").slice(0, 10);
    if (!day) continue;

    const inCur  = day >= curFrom && day <= curTo;
    const inBas  = day >= basFrom && day <= basTo;
    const inW2   = day >= w2From  && day <= w2To;
    const inW3   = day >= w3From  && day <= w3To;
    const inYday = day === ydayStr;
    const inDday = day === ddayStr;
    if (!inCur && !inBas && !inYday && !inDday) continue;

    const client = String(r.client_name || "").trim() || "(không rõ)";
    const prov   = String(r.to_province_name || "").trim() || "(không rõ)";
    const code   = String(r.order_code || "").trim();

    if (!byClient[client]) byClient[client] = { cur: emptyBucket(), bas: emptyBucket(), w2: emptyBucket(), w3: emptyBucket(), yday: emptyBucket(), dday: emptyBucket() };
    if (!byProv[prov])     byProv[prov]     = { cur: emptyBucket(), bas: emptyBucket(), w2: emptyBucket(), w3: emptyBucket(), yday: emptyBucket(), dday: emptyBucket() };

    const slots = [];
    if (inCur)  slots.push("cur");
    if (inBas)  slots.push("bas");
    if (inW2)   slots.push("w2");
    if (inW3)   slots.push("w3");
    if (inYday) slots.push("yday");
    if (inDday) slots.push("dday");

    for (const slot of slots) {
      byClient[client][slot].orders++;
      byProv[prov][slot].orders++;
    }

    const o = getOntimeOutcome(r);
    for (const slot of slots) {
      if (o === "ontime")      { byClient[client][slot].ontime++; byProv[prov][slot].ontime++; }
      else if (o === "late")   { byClient[client][slot].late++;   byProv[prov][slot].late++;   }
      else if (o === "return") { byClient[client][slot].ret++;    byProv[prov][slot].ret++;    }
    }

    if (code && inCur) {
      const period = inBas ? "both" : "cur";
      orderMap.set(code, { client, prov, period: inW2 ? "w2" : inW3 ? "w3" : "cur" });
    }
  }

  // Attach damage
  for (const c of countedDamage(damageCauses || [])) {
    const code = String(c.order_code || "").trim();
    const info = orderMap.get(code);
    if (!info) continue;
    const comp = compAmount(c) || 0;
    const slot = info.period || "cur";
    if (byClient[info.client]) { byClient[info.client][slot].cases++; byClient[info.client][slot].comp += comp; }
    if (byProv[info.prov])     { byProv[info.prov][slot].cases++; }
  }

  return { byClient, byProv, windows: { curFrom, curTo, basFrom, basTo, w2From, w2To, w3From, w3To, ydayStr, ddayStr } };
}

// ─── Rule 1: Threshold (hard cutoffs) ───────────────────────────────────────
function ruleThreshold(byClient, windows, result) {
  for (const [client, d] of Object.entries(byClient)) {
    const b = d.cur;
    if (b.orders < MIN_CUR) continue;

    const ot = ontimeRate(b);
    if (ot !== null && ot < THRESHOLD.ontime_rate.HIGH) {
      result.push(makeAnomaly({
        rule: "threshold", metric: "ontime_rate", entityType: "client", entityId: client,
        curVal: Math.round(ot * 10) / 10, basVal: THRESHOLD.ontime_rate.HIGH, delta: ot - THRESHOLD.ontime_rate.HIGH,
        magnitude: ot, sampleSize: b.ontime + b.late,
        windowLabel: `${windows.curFrom}→${windows.curTo}`,
        title: `Ngưỡng On-time vi phạm: ${client} (${Math.round(ot)}%)`,
        recommended: `${client} đang dưới ngưỡng cảnh báo ${THRESHOLD.ontime_rate.HIGH}% — kiểm tra tuyến và kho`,
        evidence: { threshold: THRESHOLD.ontime_rate.HIGH },
      }));
    }

    const dmg = damageRate(b);
    if (dmg >= THRESHOLD.damage_rate.HIGH) {
      result.push(makeAnomaly({
        rule: "threshold", metric: "damage_rate", entityType: "client", entityId: client,
        curVal: Math.round(dmg * 1000) / 10, basVal: THRESHOLD.damage_rate.HIGH * 100,
        delta: dmg - THRESHOLD.damage_rate.HIGH, magnitude: dmg,
        sampleSize: b.orders,
        windowLabel: `${windows.curFrom}→${windows.curTo}`,
        title: `Tỷ lệ hư hỏng vượt ngưỡng: ${client} (${(dmg * 100).toFixed(2)}%)`,
        recommended: `Tỷ lệ hư hỏng ${client} vượt ngưỡng ${THRESHOLD.damage_rate.HIGH * 100}% — rà soát đóng gói`,
        evidence: { threshold: THRESHOLD.damage_rate.HIGH },
      }));
    }
  }
}

// ─── Rule 2: Week-over-week ───────────────────────────────────────────────────
function ruleWoW(byClient, byProv, windows, result) {
  // WoW client ontime
  for (const [client, d] of Object.entries(byClient)) {
    const cur = d.cur, w2 = d.w2;
    const curEval = cur.ontime + cur.late, w2Eval = w2.ontime + w2.late;
    if (curEval < MIN_CUR || w2Eval < MIN_CUR) continue;
    const curOT = (cur.ontime / curEval) * 100;
    const w2OT  = (w2.ontime / w2Eval) * 100;
    const drop  = w2OT - curOT;
    if (drop < WOW_ONTIME_DROP) continue;
    result.push(makeAnomaly({
      rule: "wow", metric: "ontime_rate", entityType: "client", entityId: client,
      curVal: Math.round(curOT * 10) / 10, basVal: Math.round(w2OT * 10) / 10,
      delta: -Math.round(drop * 10) / 10, magnitude: drop,
      sampleSize: Math.min(curEval, w2Eval),
      windowLabel: `WoW: ${windows.curFrom}→${windows.curTo} vs ${windows.w2From}→${windows.w2To}`,
      title: `WoW On-time giảm: ${client} (−${drop.toFixed(1)}pts)`,
      recommended: `${client} tuần này giảm ${drop.toFixed(1)} pts so với tuần trước — kiểm tra thay đổi tuyến`,
      evidence: { cur_week: `${windows.curFrom}→${windows.curTo}`, prev_week: `${windows.w2From}→${windows.w2To}` },
    }));
  }

  // WoW province damage
  for (const [prov, d] of Object.entries(byProv)) {
    if (d.cur.orders < MIN_CUR || d.w2.orders < MIN_CUR) continue;
    const curDmg = d.cur.cases, w2Dmg = d.w2.cases;
    if (w2Dmg === 0 || curDmg === 0) continue;
    const curRate = (curDmg / d.cur.orders) * 1000;
    const w2Rate  = (w2Dmg / d.w2.orders) * 1000;
    const pctChg  = ((curRate - w2Rate) / w2Rate) * 100;
    if (pctChg < WOW_DAMAGE_SPIKE) continue;
    result.push(makeAnomaly({
      rule: "wow", metric: "damage_rate", entityType: "province", entityId: prov,
      curVal: Math.round(curRate * 10) / 10, basVal: Math.round(w2Rate * 10) / 10,
      delta: Math.round((curRate - w2Rate) * 10) / 10, magnitude: pctChg,
      sampleSize: d.cur.orders,
      windowLabel: `WoW tỉnh ${prov}`,
      title: `WoW hư hỏng tăng tại ${prov} (+${Math.round(pctChg)}%)`,
      recommended: `Tỷ lệ hư hỏng tại ${prov} tăng ${Math.round(pctChg)}% so tuần trước`,
      evidence: { cur_cases: curDmg, prev_cases: w2Dmg },
    }));
  }
}

// ─── Rule 3: Rolling baseline (4-week avg) ───────────────────────────────────
function ruleRolling(byClient, byProv, windows, result) {
  for (const [client, d] of Object.entries(byClient)) {
    const cur = d.cur, bas = d.bas;
    const curEval = cur.ontime + cur.late, basEval = bas.ontime + bas.late;
    if (curEval < MIN_CUR || basEval < MIN_BASE) continue;
    const curOT = (cur.ontime / curEval) * 100;
    const basOT = (bas.ontime / basEval) * 100;
    const drop  = basOT - curOT;
    if (drop < ROLLING_OT_DROP) continue;
    result.push(makeAnomaly({
      rule: "rolling_baseline", metric: "ontime_rate", entityType: "client", entityId: client,
      curVal: Math.round(curOT * 10) / 10, basVal: Math.round(basOT * 10) / 10,
      delta: -Math.round(drop * 10) / 10, magnitude: drop,
      sampleSize: Math.min(curEval, basEval),
      windowLabel: "7 ngày vs 4 tuần trước",
      title: `On-time sụt so trung bình: ${client}`,
      recommended: `Rà soát tuyến và kho ${client} — on-time giảm ${drop.toFixed(1)} pts vs trung bình 4 tuần`,
      evidence: { cur_period: `${windows.curFrom}→${windows.curTo}`, base_period: `${windows.basFrom}→${windows.basTo}` },
    }));
  }

  // Province damage rolling
  for (const [prov, d] of Object.entries(byProv)) {
    if (d.cur.orders < MIN_CUR || d.bas.orders < MIN_BASE) continue;
    if (d.cur.cases === 0) continue;
    const curRate = (d.cur.cases / d.cur.orders) * 1000;
    const basRate = d.bas.cases > 0 ? (d.bas.cases / d.bas.orders) * 1000 : 0;
    if (basRate === 0) continue;
    const pctChg = ((curRate - basRate) / basRate) * 100;
    if (pctChg < ROLLING_DMG_SPIKE) continue;
    result.push(makeAnomaly({
      rule: "rolling_baseline", metric: "damage_rate", entityType: "province", entityId: prov,
      curVal: Math.round(curRate * 10) / 10, basVal: Math.round(basRate * 10) / 10,
      delta: Math.round((curRate - basRate) * 10) / 10, magnitude: pctChg,
      sampleSize: d.cur.orders,
      windowLabel: "7 ngày vs 4 tuần trước",
      title: `Hư hỏng đột biến tại ${prov}`,
      recommended: `Kiểm tra tuyến giao tại ${prov}, review chất lượng đóng gói và quy trình xử lý`,
      evidence: { cur_cases: d.cur.cases, base_cases: d.bas.cases },
    }));
  }

  // Client comp rolling
  for (const [client, d] of Object.entries(byClient)) {
    if (d.cur.orders < MIN_CUR || d.bas.orders < MIN_BASE) continue;
    if (d.cur.comp === 0 || d.bas.comp === 0) continue;
    const curCPO = d.cur.comp / d.cur.orders;
    const basCPO = d.bas.comp / d.bas.orders;
    const pctChg = ((curCPO - basCPO) / basCPO) * 100;
    if (pctChg < WOW_COMP_SPIKE) continue;
    result.push(makeAnomaly({
      rule: "rolling_baseline", metric: "comp_rate", entityType: "client", entityId: client,
      curVal: Math.round(curCPO), basVal: Math.round(basCPO),
      delta: Math.round(curCPO - basCPO), magnitude: pctChg,
      sampleSize: d.cur.orders,
      windowLabel: "7 ngày vs 4 tuần trước",
      title: `Chi phí đền bù tăng đột biến: ${client}`,
      recommended: `Xem xét ca hư hỏng của ${client} trong 7 ngày qua, review kết quả phân tích nguyên nhân tại Rillnet`,
      evidence: { cur_comp: d.cur.comp, base_comp: d.bas.comp },
    }));
  }
}

// ─── Rule 4: Sudden change (day-over-day) ────────────────────────────────────
function ruleSuddenChange(byClient, byProv, windows, result) {
  for (const [client, d] of Object.entries(byClient)) {
    const yday = d.yday, dday = d.dday;
    const ydayEval = yday.ontime + yday.late, ddayEval = dday.ontime + dday.late;
    if (ydayEval < MIN_DAY || ddayEval < MIN_DAY) continue;
    const ydayOT = (yday.ontime / ydayEval) * 100;
    const ddayOT = (dday.ontime / ddayEval) * 100;
    const drop = ddayOT - ydayOT;
    if (drop < SUDDEN_OT_DROP) continue;
    result.push(makeAnomaly({
      rule: "sudden_change", metric: "ontime_rate", entityType: "client", entityId: client,
      curVal: Math.round(ydayOT * 10) / 10, basVal: Math.round(ddayOT * 10) / 10,
      delta: -Math.round(drop * 10) / 10, magnitude: drop,
      sampleSize: Math.min(ydayEval, ddayEval),
      windowLabel: `Hôm qua vs hôm kia: ${windows.ydayStr} vs ${windows.ddayStr}`,
      title: `Biến động đột ngột On-time: ${client} hôm qua (−${drop.toFixed(1)}pts)`,
      recommended: `Kiểm tra ngay tuyến giao của ${client} — on-time giảm ${drop.toFixed(1)} pts trong 1 ngày`,
      evidence: { yesterday: windows.ydayStr, day_before: windows.ddayStr },
    }));
  }

  for (const [prov, d] of Object.entries(byProv)) {
    if (d.yday.orders < MIN_DAY || d.dday.orders < MIN_DAY) continue;
    if (d.yday.cases === 0) continue;
    const ydayDmg = (d.yday.cases / d.yday.orders) * 1000;
    const ddayDmg = d.dday.cases > 0 ? (d.dday.cases / d.dday.orders) * 1000 : 0;
    if (ddayDmg === 0) continue;
    const pctChg = ((ydayDmg - ddayDmg) / ddayDmg) * 100;
    if (pctChg < SUDDEN_DMG_SPIKE) continue;
    result.push(makeAnomaly({
      rule: "sudden_change", metric: "damage_rate", entityType: "province", entityId: prov,
      curVal: Math.round(ydayDmg * 10) / 10, basVal: Math.round(ddayDmg * 10) / 10,
      delta: Math.round((ydayDmg - ddayDmg) * 10) / 10, magnitude: pctChg,
      sampleSize: d.yday.orders,
      windowLabel: `Ngày ${windows.ydayStr} vs ${windows.ddayStr}`,
      title: `Hư hỏng đột biến 1 ngày tại ${prov}`,
      recommended: `Kiểm tra ngay tình trạng giao hàng tại ${prov}`,
      evidence: { yesterday: windows.ydayStr, day_before: windows.ddayStr },
    }));
  }
}

// ─── Rule 5: Persistent deterioration (3 consecutive periods) ───────────────
function rulePersistentDeterioration(byClient, windows, result) {
  for (const [client, d] of Object.entries(byClient)) {
    const w1Eval = d.cur.ontime + d.cur.late;
    const w2Eval = d.w2.ontime  + d.w2.late;
    const w3Eval = d.w3.ontime  + d.w3.late;
    if (w1Eval < MIN_WEEK || w2Eval < MIN_WEEK || w3Eval < MIN_WEEK) continue;
    const w1OT = (d.cur.ontime / w1Eval) * 100;
    const w2OT = (d.w2.ontime  / w2Eval) * 100;
    const w3OT = (d.w3.ontime  / w3Eval) * 100;
    if (!(w3OT > w2OT && w2OT > w1OT)) continue;
    const totalDrop = w3OT - w1OT;
    if (totalDrop < PERSIST_OT_DROP * 3) continue;
    result.push(makeAnomaly({
      rule: "persistent_deterioration", metric: "ontime_rate", entityType: "client", entityId: client,
      curVal: Math.round(w1OT * 10) / 10, basVal: Math.round(w3OT * 10) / 10,
      delta: -Math.round(totalDrop * 10) / 10, magnitude: totalDrop,
      sampleSize: Math.min(w1Eval, w2Eval, w3Eval),
      windowLabel: "Sụt giảm liên tục 3 tuần",
      title: `Sụt giảm liên tục 3 tuần: ${client}`,
      recommended: `${client} on-time giảm liên tục 3 tuần (${w3OT.toFixed(1)}%→${w2OT.toFixed(1)}%→${w1OT.toFixed(1)}%) — cần can thiệp`,
      evidence: { w3: Math.round(w3OT * 10) / 10, w2: Math.round(w2OT * 10) / 10, w1: Math.round(w1OT * 10) / 10 },
    }));
  }
}

// ─── Rule 6: Peer-group anomaly ───────────────────────────────────────────────
function rulePeerGroup(byClient, windows, result) {
  // Assign volume tiers based on weekly order count (current window)
  const tiers = {};
  for (const [client, d] of Object.entries(byClient)) {
    const orders = d.cur.orders;
    const tier = orders >= 200 ? "L" : orders >= 50 ? "M" : orders >= 20 ? "S" : null;
    if (!tier) continue;
    if (!tiers[tier]) tiers[tier] = [];
    const eval_ = d.cur.ontime + d.cur.late;
    if (eval_ < MIN_CUR) continue;
    tiers[tier].push({ client, ot: (d.cur.ontime / eval_) * 100, orders, eval: eval_ });
  }

  for (const [, peers] of Object.entries(tiers)) {
    if (peers.length < 3) continue; // need at least 3 peers to compare
    const rates = peers.map((p) => p.ot).sort((a, b) => a - b);
    const median = rates[Math.floor(rates.length / 2)];
    for (const peer of peers) {
      const gap = median - peer.ot;
      if (gap < PEER_OT_GAP) continue;
      result.push(makeAnomaly({
        rule: "peer_group", metric: "ontime_rate", entityType: "client", entityId: peer.client,
        curVal: Math.round(peer.ot * 10) / 10, basVal: Math.round(median * 10) / 10,
        delta: -Math.round(gap * 10) / 10, magnitude: gap,
        sampleSize: peer.eval,
        windowLabel: `${windows.curFrom}→${windows.curTo} vs peer group median`,
        title: `Ngoại lệ nhóm tương đương: ${peer.client} (−${gap.toFixed(1)} pts vs peers)`,
        recommended: `${peer.client} on-time thấp hơn ${gap.toFixed(1)} pts so với nhóm cùng quy mô — cần điều tra đặc thù`,
        evidence: { peer_count: peers.length, peer_median: Math.round(median * 10) / 10 },
      }));
    }
  }
}

// ─── Rule 7: Data anomaly ─────────────────────────────────────────────────────
function ruleDataAnomaly(base, result) {
  if (!base?.ltlRows) {
    result.push({
      anomaly_id: "data_anomaly:no_snapshot",
      detected_at: new Date().toISOString(),
      metric: "snapshot_availability",
      entity_type: "system",
      entity_id: "raw_ontime",
      current_value: 0,
      baseline_value: 1,
      delta: -1,
      severity: "CRITICAL",
      confidence: 1.0,
      evidence: { reason: "No snapshot loaded" },
      detection_rule: "data_anomaly",
      status: "DETECTED",
      title: "Không có snapshot LTL",
      impactScore: 100,
      recommendedAction: "Kiểm tra cron build-snapshot và Vercel Blob",
    });
    return;
  }

  const total = base.ltlRows.length;
  const ageMs = base.builtAt ? Date.now() - new Date(base.builtAt).getTime() : Infinity;
  const ageHrs = ageMs / 3_600_000;

  if (ageHrs > 24) {
    result.push({
      anomaly_id: `data_anomaly:stale_snapshot:${base.builtAt?.slice(0, 10) || "unknown"}`,
      detected_at: new Date().toISOString(),
      metric: "snapshot_freshness_hours",
      entity_type: "system",
      entity_id: "raw_ontime",
      current_value: Math.round(ageHrs),
      baseline_value: 6,
      delta: Math.round(ageHrs - 6),
      severity: ageHrs > 48 ? "CRITICAL" : "HIGH",
      confidence: 1.0,
      evidence: { built_at: base.builtAt, age_hours: Math.round(ageHrs) },
      detection_rule: "data_anomaly",
      status: "DETECTED",
      title: `Snapshot cũ hơn ${Math.round(ageHrs)}h — dữ liệu có thể lỗi thời`,
      impactScore: Math.min(100, Math.round(ageHrs * 2)),
      recommendedAction: "Trigger rebuild snapshot hoặc kiểm tra cron + scraper Railway",
    });
  }

  if (total < 100) {
    result.push({
      anomaly_id: `data_anomaly:low_volume:${total}`,
      detected_at: new Date().toISOString(),
      metric: "snapshot_row_count",
      entity_type: "system",
      entity_id: "raw_ontime",
      current_value: total,
      baseline_value: 500,
      delta: total - 500,
      severity: total === 0 ? "CRITICAL" : "HIGH",
      confidence: 1.0,
      evidence: { row_count: total },
      detection_rule: "data_anomaly",
      status: "DETECTED",
      title: `Sản lượng bất thường thấp: ${total} dòng (bình thường >100)`,
      impactScore: total === 0 ? 100 : 70,
      recommendedAction: "Kiểm tra sheet raw_ontime và quá trình sync",
    });
  }
}

// ─── Main scanner ─────────────────────────────────────────────────────────────
/**
 * Scan all 7 anomaly rule types and return all detected anomalies.
 * @param {{ ltlRows, rawDamageCauses, builtAt }} base
 * @param {{ today?, minSeverity?, maxResults? }} opts
 */
export function scanAnomalies(base, opts = {}) {
  const today = opts.today || new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const result = [];

  // Rule 7 first (data quality gate)
  ruleDataAnomaly(base, result);

  if (base?.ltlRows?.length >= 20) {
    const { byClient, byProv, windows } = buildBuckets(
      base.ltlRows,
      base.rawDamageCauses || [],
      today
    );

    ruleThreshold(byClient, windows, result);
    ruleWoW(byClient, byProv, windows, result);
    ruleRolling(byClient, byProv, windows, result);
    ruleSuddenChange(byClient, byProv, windows, result);
    rulePersistentDeterioration(byClient, windows, result);
    rulePeerGroup(byClient, windows, result);
  }

  // Dedup by anomaly_id (keep highest impactScore)
  const deduped = new Map();
  for (const a of result) {
    const existing = deduped.get(a.anomaly_id);
    if (!existing || a.impactScore > existing.impactScore) deduped.set(a.anomaly_id, a);
  }

  let anomalies = [...deduped.values()].sort((a, b) => {
    const ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    return (ORDER[a.severity] ?? 5) - (ORDER[b.severity] ?? 5) || b.impactScore - a.impactScore;
  });

  if (opts.minSeverity) {
    const ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    const minIdx = ORDER[opts.minSeverity] ?? 4;
    anomalies = anomalies.filter((a) => (ORDER[a.severity] ?? 5) <= minIdx);
  }

  if (opts.maxResults) anomalies = anomalies.slice(0, opts.maxResults);

  return anomalies;
}

/**
 * detectDailyAnomalies — backward-compatible wrapper.
 * Returns top-3 anomalies in the legacy format (all legacy fields present).
 */
export function detectDailyAnomalies(base, today) {
  return scanAnomalies(base, { today, maxResults: 3 });
}
