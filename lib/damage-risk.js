/**
 * lib/damage-risk.js — "Hư hỏng & Rủi ro" route matrix + per-project risk
 * (approved 2026-09-26). A rate needs a denominator, so damage is counted
 * per ORDER: a Rillnet case counts on the route of the order it belongs to
 * (joined by order_code), among the orders shown for the active filter.
 * That is why these totals can differ slightly from the "Ca hư hỏng" KPI,
 * which filters cases by their own case date.
 *
 * Two matrix views of the same orders:
 *  - "lay":  Kho lấy × Miền giao  (where the order left from)
 *  - "giao": Kho giao × Miền lấy  (where it was delivered — replaces the old
 *            "Top 10 kho rủi ro" chart, which mixed late orders into a
 *            damage view and had no denominator)
 */
import { regionOf, REGIONS } from "./vn-regions";
import { getOntimeOutcome } from "./transform-ltl";

// Flag a route as "rủi ro cao" only with enough volume to mean something.
export const RISK_MIN_ORDERS = 20;
export const RISK_RATE_MULTIPLIER = 2;
export const RISK_MIN_CASES = 2; // user decision 2026-09-26: one case alone is an incident, not a pattern
// Same wording/threshold the old per-route breakage alert used.
const FTL_SUGGEST_RATE = 5;
const MATRIX_MAX_WAREHOUSES = 15;
// Map "Top 5 điểm nóng" (approved 2026-09-27): a province is hot when late
// is high (on-time < 85% with >= 50 evaluated orders) OR damage is high
// (rate >= 2x average with >= 2 cases); ranked by late orders + damage cases.
const HOT_ONTIME_PCT = 85;
const HOT_MIN_EVAL = 50;
const HOTSPOTS_MAX = 5;
const ROUTES_MAX = 80;

const pct2 = (num, den) => (den > 0 ? Math.round((num / den) * 10000) / 100 : null);

function buildMatrix(ltlRows, damageByCode, rowKeyOf, colKeyOf, cellOut) {
  const cells = {};
  const totals = {};
  const cols = new Set();
  for (const r of ltlRows) {
    const rk = rowKeyOf(r);
    const ck = colKeyOf(r);
    cols.add(ck);
    const hit = damageByCode.has(String(r.order_code || "").trim()) ? 1 : 0;
    const row = (cells[rk] = cells[rk] || {});
    const cell = (row[ck] = row[ck] || { orders: 0, damaged: 0 });
    cell.orders++; cell.damaged += hit;
    const t = (totals[rk] = totals[rk] || { orders: 0, damaged: 0 });
    t.orders++; t.damaged += hit;
  }
  const regions = [...REGIONS];
  if (cols.has("Khác")) regions.push("Khác");
  const rows = Object.entries(totals)
    .sort((a, b) => b[1].damaged - a[1].damaged || b[1].orders - a[1].orders)
    .slice(0, MATRIX_MAX_WAREHOUSES)
    .map(([kho, t]) => ({
      kho,
      total: cellOut(t),
      cells: Object.fromEntries(regions.map((rg) => [rg, cellOut(cells[kho][rg])])),
    }));
  return { regions, warehouses: rows };
}

export function computeDamageRisk(ltlRows, damageRows) {
  const damageByCode = new Map();
  for (const d of damageRows) {
    const code = String(d.order_code || "").trim();
    if (code && !damageByCode.has(code)) damageByCode.set(code, d);
  }

  const regionCache = new Map();
  const regionFor = (p) => {
    const key = String(p || "").trim();
    if (!regionCache.has(key)) regionCache.set(key, regionOf(key));
    return regionCache.get(key);
  };
  const khoLay = (r) => String(r.kho_lay || r.warehouse_lay || "").trim() || "(không rõ kho lấy)";
  const khoGiao = (r) => String(r.kho_giao || r.warehouse_giao || "").trim() || "(không rõ kho giao)";

  const routes = {};  // kho lấy | tỉnh giao
  const detect = {};  // kho phát hiện (Rillnet) → miền giao → cases
  const detectTotals = {};
  const provinces = {}; // tỉnh giao → orders / ontime / late / damaged
  const projects = {};
  let totalOrders = 0, totalDamaged = 0, totalAmount = 0;

  for (const r of ltlRows) {
    const kho = khoLay(r);
    const prov = String(r.to_province_name || "").trim() || "(không rõ)";
    const dmg = damageByCode.get(String(r.order_code || "").trim());
    const hit = dmg ? 1 : 0;
    totalOrders++;
    totalDamaged += hit;
    if (dmg) totalAmount += parseFloat(dmg.so_tien_ket_luan) || 0;

    const pv = (provinces[prov] = provinces[prov] || { name: prov, orders: 0, ontime: 0, late: 0, damaged: 0 });
    pv.orders++; pv.damaged += hit;
    const outcome = getOntimeOutcome(r);
    if (outcome === "ontime") pv.ontime++; else if (outcome === "late") pv.late++;
    if (dmg) {
      const dk = String(dmg.detected_at_warehouse || "").trim() || "(không rõ kho phát hiện)";
      const rg = regionFor(prov);
      const row = (detect[dk] = detect[dk] || {});
      row[rg] = (row[rg] || 0) + 1;
      detectTotals[dk] = (detectTotals[dk] || 0) + 1;
    }

    const rk = `${kho}|${prov}`;
    const rt = (routes[rk] = routes[rk] || { kho, province: prov, region: regionFor(prov), orders: 0, damaged: 0, legs: {} });
    rt.orders++; rt.damaged += hit;
    if (dmg) {
      const leg = dmg.suspected_leg || "(chưa rõ chặng)";
      rt.legs[leg] = (rt.legs[leg] || 0) + 1;
    }

    const proj = r.client_name || "Khác";
    const pj = (projects[proj] = projects[proj] || { name: proj, orders: 0, damaged: 0, amount: 0 });
    pj.orders++; pj.damaged += hit;
    if (dmg) pj.amount += parseFloat(dmg.so_tien_ket_luan) || 0;
  }

  const avgRate = pct2(totalDamaged, totalOrders) || 0;
  const threshold = avgRate * RISK_RATE_MULTIPLIER;
  const isRisky = (s) => s.orders >= RISK_MIN_ORDERS && s.damaged >= RISK_MIN_CASES && s.damaged > 0
    && pct2(s.damaged, s.orders) >= threshold;
  const cellOut = (s) => (s ? { orders: s.orders, damaged: s.damaged, rate: pct2(s.damaged, s.orders), risky: isRisky(s) } : null);

  const matrixLay = buildMatrix(ltlRows, damageByCode, khoLay, (r) => regionFor(r.to_province_name), cellOut);
  const matrixGiao = buildMatrix(ltlRows, damageByCode, khoGiao, (r) => regionFor(r.from_province_name), cellOut);

  const routeList = Object.values(routes)
    .filter((rt) => rt.damaged > 0)
    .map((rt) => {
      const rate = pct2(rt.damaged, rt.orders);
      const risky = isRisky(rt);
      return {
        kho: rt.kho, province: rt.province, region: rt.region,
        orders: rt.orders, damaged: rt.damaged, rate, risky,
        topLeg: Object.entries(rt.legs).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        suggestion: risky ? (rate > FTL_SUGGEST_RATE ? "Cân nhắc FTL riêng" : "Kiểm tra đóng gói") : null,
      };
    })
    .sort((a, b) => (b.risky - a.risky) || (b.rate - a.rate) || (b.damaged - a.damaged))
    .slice(0, ROUTES_MAX);

  // Detection warehouse only exists on damaged orders, so this view has no
  // denominator: case COUNTS, never a rate.
  const detectRegions = [...REGIONS];
  if (Object.values(detect).some((row) => row["Khác"])) detectRegions.push("Khác");
  const matrixDetect = {
    regions: detectRegions,
    warehouses: Object.entries(detectTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MATRIX_MAX_WAREHOUSES)
      .map(([kho, total]) => ({
        kho,
        total: { damaged: total },
        cells: Object.fromEntries(detectRegions.map((rg) => [rg, detect[kho][rg] ? { damaged: detect[kho][rg] } : null])),
      })),
  };

  const hotspots = Object.values(provinces)
    .map((p) => {
      const evalCount = p.ontime + p.late;
      const ontimePct = evalCount > 0 ? Math.round((p.ontime / evalCount) * 1000) / 10 : null;
      const damageRate = pct2(p.damaged, p.orders);
      const lateHot = evalCount >= HOT_MIN_EVAL && ontimePct < HOT_ONTIME_PCT;
      const damageHot = p.damaged >= RISK_MIN_CASES && damageRate >= threshold;
      return { name: p.name, orders: p.orders, evalCount, ontimePct, late: p.late, damaged: p.damaged, damageRate, lateHot, damageHot, score: p.late + p.damaged };
    })
    .filter((p) => p.lateHot || p.damageHot)
    .sort((a, b) => b.score - a.score)
    .slice(0, HOTSPOTS_MAX);

  const byProject = Object.values(projects)
    .map((p) => ({ name: p.name, orders: p.orders, damaged: p.damaged, per1000: p.orders > 0 ? Math.round((p.damaged / p.orders) * 10000) / 10 : null, amount: p.amount }))
    .sort((a, b) => (b.per1000 ?? 0) - (a.per1000 ?? 0) || b.orders - a.orders);

  return {
    rule: { minOrders: RISK_MIN_ORDERS, multiplier: RISK_RATE_MULTIPLIER, minCases: RISK_MIN_CASES },
    totalOrders, totalDamaged, avgRate, threshold: Math.round(threshold * 100) / 100,
    // Back-compat: top-level regions/warehouses = the "Kho lấy" view.
    regions: matrixLay.regions, warehouses: matrixLay.warehouses,
    matrixGiao,
    matrixDetect,
    hotspots,
    hotspotRule: { ontimePct: HOT_ONTIME_PCT, minEval: HOT_MIN_EVAL },
    routes: routeList,
    riskyRouteCount: routeList.filter((r) => r.risky).length,
    byProject,
    // Hidden in the UI while no case carries an amount (all 0 as of 26/09).
    totalAmount,
  };
}
