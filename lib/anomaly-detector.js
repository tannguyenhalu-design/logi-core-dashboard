/**
 * lib/anomaly-detector.js — Pure CPU anomaly detection from LTL snapshot.
 * No external calls. Runs on every /api/data?part=decision request.
 *
 * detectDailyAnomalies(base, today) returns top-3 anomalies across 3 types:
 *   risk  — tỷ lệ hư hỏng tăng đột biến theo tỉnh giao
 *   sla   — on-time sụt giảm nghiêm trọng theo khách hàng
 *   cost  — chi phí đền bù tăng đột biến theo khách hàng
 *
 * Baseline windows (avoids immature data):
 *   current  = today − 7 → today − 1 (last completed week)
 *   baseline = today − 35 → today − 8 (prior 4 weeks)
 */
import { getOntimeOutcome } from "./transform-ltl";
import { countedDamage, compAmount } from "./damage-rules";

const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

// ─── Risk thresholds ─────────────────────────────────────────────────────────
const RISK_MIN_CURRENT_ORDERS = 20;
const RISK_MIN_BASE_ORDERS = 50;
const RISK_SPIKE_PCT = 30; // % relative increase in per1k damage rate

// ─── SLA thresholds ──────────────────────────────────────────────────────────
const SLA_MIN_CURRENT_EVAL = 30;
const SLA_MIN_BASE_EVAL = 80;
const SLA_DROP_PTS = 3; // percentage-point drop threshold

// ─── Cost thresholds ─────────────────────────────────────────────────────────
const COST_MIN_CURRENT_ORDERS = 20;
const COST_MIN_BASE_ORDERS = 50;
const COST_SPIKE_PCT = 50; // % relative increase in comp/order

function emptyAcc() {
  return { orders: 0, ontime: 0, late: 0, cases: 0, comp: 0 };
}

/**
 * detectDailyAnomalies — scans snapshot and returns the top 3 anomalies.
 *
 * @param {Object} base   loadLtlBase() result
 * @param {string} today  yyyy-mm-dd (VN time)
 * @returns {Array}       anomaly objects sorted by impactScore desc (max 3)
 */
export function detectDailyAnomalies(base, today) {
  if (!base) return [];

  const t = today || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const curFrom = addDays(t, -7);
  const curTo   = addDays(t, -1);
  const basFrom = addDays(t, -35);
  const basTo   = addDays(t, -8);

  // Build order → pickup period map for damage joining
  const orderPeriod = new Map(); // order_code → "cur" | "base" | null

  // Accumulators: byProvince (risk + SLA), byClient (SLA + cost)
  const byProv   = {}; // province → { cur, base }
  const byClient = {}; // client   → { cur, base }

  for (const r of base.ltlRows || []) {
    const day = String(r.pickup_time || "").slice(0, 10);
    if (!day) continue;
    const inCur = day >= curFrom && day <= curTo;
    const inBas = day >= basFrom && day <= basTo;
    if (!inCur && !inBas) continue;
    const period = inCur ? "cur" : "bas";

    const code = String(r.order_code || "").trim();
    if (code) orderPeriod.set(code, period);

    const prov   = String(r.to_province_name || "").trim() || "(không rõ)";
    const client = String(r.client_name || "").trim() || "(không rõ)";

    if (!byProv[prov])   byProv[prov]   = { cur: emptyAcc(), bas: emptyAcc() };
    if (!byClient[client]) byClient[client] = { cur: emptyAcc(), bas: emptyAcc() };

    byProv[prov][period].orders++;
    byClient[client][period].orders++;

    const o = getOntimeOutcome(r);
    if (o === "ontime") { byProv[prov][period].ontime++; byClient[client][period].ontime++; }
    else if (o === "late") { byProv[prov][period].late++; byClient[client][period].late++; }
  }

  // Attach damage to accumulators
  for (const c of countedDamage(base.rawDamageCauses || [])) {
    const period = orderPeriod.get(String(c.order_code || "").trim());
    if (!period) continue;
    // Find the order row to get province + client
    const order = (base.ltlRows || []).find((r) => String(r.order_code || "").trim() === String(c.order_code || "").trim());
    if (!order) continue;
    const prov   = String(order.to_province_name || "").trim() || "(không rõ)";
    const client = String(order.client_name || "").trim() || "(không rõ)";
    if (byProv[prov])   { byProv[prov][period].cases++; }
    if (byClient[client]) {
      byClient[client][period].cases++;
      byClient[client][period].comp += compAmount(c) || 0;
    }
  }

  const anomalies = [];

  // ─── Type: risk (damage spike by province) ────────────────────────────────
  for (const [prov, d] of Object.entries(byProv)) {
    if (d.cur.orders < RISK_MIN_CURRENT_ORDERS || d.bas.orders < RISK_MIN_BASE_ORDERS) continue;
    const curRate = (d.cur.cases / d.cur.orders) * 1000;
    const basRate = d.bas.cases > 0 ? (d.bas.cases / d.bas.orders) * 1000 : 0;
    if (curRate === 0) continue;
    const relChange = basRate > 0 ? ((curRate - basRate) / basRate) * 100 : 100;
    if (relChange < RISK_SPIKE_PCT) continue;
    const impactScore = Math.min(100, Math.round(relChange * 0.4 + d.cur.cases * 6));
    anomalies.push({
      type: "risk",
      title: `Tỷ lệ hư hỏng tăng đột biến tại ${prov}`,
      location: prov,
      metric: "damage_rate",
      curValue: Math.round(curRate * 10) / 10,
      baseValue: Math.round(basRate * 10) / 10,
      changePercent: Math.round(relChange),
      impactScore,
      rootCauseProbability: relChange > 70 ? "high" : "medium",
      recommendedAction: `Kiểm tra tuyến giao tại ${prov}, review chất lượng đóng gói và quy trình xử lý`,
      sampleOrders: d.cur.orders,
      periodLabel: "7 ngày vs 4 tuần trước",
    });
  }

  // ─── Type: sla (on-time drop by client) ───────────────────────────────────
  for (const [client, d] of Object.entries(byClient)) {
    const curEval = d.cur.ontime + d.cur.late;
    const basEval = d.bas.ontime + d.bas.late;
    if (curEval < SLA_MIN_CURRENT_EVAL || basEval < SLA_MIN_BASE_EVAL) continue;
    const curOT = (d.cur.ontime / curEval) * 100;
    const basOT = (d.bas.ontime / basEval) * 100;
    const drop = basOT - curOT;
    if (drop < SLA_DROP_PTS) continue;
    const impactScore = Math.min(100, Math.round(drop * 8 + curEval * 0.08));
    anomalies.push({
      type: "sla",
      title: `On-time sụt giảm: ${client}`,
      location: client,
      metric: "ontime_rate",
      curValue: Math.round(curOT * 10) / 10,
      baseValue: Math.round(basOT * 10) / 10,
      changePts: Math.round(-drop * 10) / 10,
      impactScore,
      rootCauseProbability: drop > 6 ? "high" : drop > 4 ? "medium" : "low",
      recommendedAction: `Rà soát tuyến, kho của ${client} — kiểm tra tắc nghẽn hoặc thay đổi lộ trình`,
      sampleOrders: curEval,
      periodLabel: "7 ngày vs 4 tuần trước",
    });
  }

  // ─── Type: cost (comp spike by client) ────────────────────────────────────
  for (const [client, d] of Object.entries(byClient)) {
    if (d.cur.orders < COST_MIN_CURRENT_ORDERS || d.bas.orders < COST_MIN_BASE_ORDERS) continue;
    if (d.cur.comp === 0 && d.bas.comp === 0) continue;
    const curRate = d.cur.comp / d.cur.orders;
    const basRate = d.bas.comp / d.bas.orders;
    if (curRate === 0) continue;
    const relChange = basRate > 0 ? ((curRate - basRate) / basRate) * 100 : 100;
    if (relChange < COST_SPIKE_PCT) continue;
    const impactScore = Math.min(100, Math.round(relChange * 0.35 + Math.min(50, d.cur.comp / 1e6)));
    anomalies.push({
      type: "cost",
      title: `Chi phí đền bù tăng đột biến: ${client}`,
      location: client,
      metric: "comp_rate",
      curValue: Math.round(curRate),
      baseValue: Math.round(basRate),
      changePercent: Math.round(relChange),
      impactScore,
      rootCauseProbability: relChange > 80 ? "high" : "medium",
      recommendedAction: `Xem xét ca hư hỏng của ${client} trong 7 ngày qua, review kết quả phân tích nguyên nhân tại Rillnet`,
      sampleOrders: d.cur.orders,
      periodLabel: "7 ngày vs 4 tuần trước",
    });
  }

  // Sort by impactScore desc; take top 3 with type diversity (max 2 per type)
  anomalies.sort((a, b) => b.impactScore - a.impactScore);
  const top = [];
  const typeCount = {};
  for (const a of anomalies) {
    if (top.length >= 3) break;
    typeCount[a.type] = (typeCount[a.type] || 0) + 1;
    if (typeCount[a.type] <= 2) top.push(a);
  }
  return top;
}
