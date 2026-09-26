/**
 * lib/damage-risk.js — "Hư hỏng & Rủi ro" route matrix + per-project risk
 * (approved 2026-09-26). A rate needs a denominator, so damage is counted
 * per ORDER: a Rillnet case counts on the route of the order it belongs to
 * (joined by order_code), among the orders shown for the active filter.
 * That is why these totals can differ slightly from the "Ca hư hỏng" KPI,
 * which filters cases by their own case date.
 */
import { regionOf, REGIONS } from "./vn-regions";

// Flag a route as "rủi ro cao" only with enough volume to mean something.
export const RISK_MIN_ORDERS = 20;
export const RISK_RATE_MULTIPLIER = 2;
const MATRIX_MAX_WAREHOUSES = 15;
const ROUTES_MAX = 80;

const pct2 = (num, den) => (den > 0 ? Math.round((num / den) * 10000) / 100 : null);

export function computeDamageRisk(ltlRows, damageRows) {
  const damageByCode = new Map();
  for (const d of damageRows) {
    const code = String(d.order_code || "").trim();
    if (code && !damageByCode.has(code)) damageByCode.set(code, d);
  }

  const regionCache = new Map();
  const regionFor = (p) => {
    if (!regionCache.has(p)) regionCache.set(p, regionOf(p));
    return regionCache.get(p);
  };

  const cells = {};   // kho → region → {orders, damaged}
  const khoTotals = {};
  const routes = {};  // kho|province
  const projects = {};
  let totalOrders = 0, totalDamaged = 0, totalAmount = 0;

  for (const r of ltlRows) {
    const kho = String(r.kho_lay || r.warehouse_lay || "").trim() || "(không rõ kho lấy)";
    const prov = String(r.to_province_name || "").trim() || "(không rõ)";
    const region = regionFor(prov);
    const dmg = damageByCode.get(String(r.order_code || "").trim());
    const hit = dmg ? 1 : 0;
    totalOrders++;
    totalDamaged += hit;
    if (dmg) totalAmount += parseFloat(dmg.so_tien_ket_luan) || 0;

    const row = (cells[kho] = cells[kho] || {});
    const cell = (row[region] = row[region] || { orders: 0, damaged: 0 });
    cell.orders++; cell.damaged += hit;
    const kt = (khoTotals[kho] = khoTotals[kho] || { orders: 0, damaged: 0 });
    kt.orders++; kt.damaged += hit;

    const rk = `${kho}|${prov}`;
    const rt = (routes[rk] = routes[rk] || { kho, province: prov, region, orders: 0, damaged: 0, legs: {} });
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
  const isRisky = (s) => s.orders >= RISK_MIN_ORDERS && s.damaged > 0 && pct2(s.damaged, s.orders) >= threshold;
  const cellOut = (s) => (s ? { orders: s.orders, damaged: s.damaged, rate: pct2(s.damaged, s.orders), risky: isRisky(s) } : null);

  const regions = [...REGIONS];
  if (Object.values(cells).some((row) => row["Khác"])) regions.push("Khác");

  // Warehouses with any damage first (most cases on top), then the busiest.
  const warehouses = Object.entries(khoTotals)
    .sort((a, b) => b[1].damaged - a[1].damaged || b[1].orders - a[1].orders)
    .slice(0, MATRIX_MAX_WAREHOUSES)
    .map(([kho, t]) => ({
      kho,
      total: cellOut(t),
      cells: Object.fromEntries(regions.map((rg) => [rg, cellOut(cells[kho][rg])])),
    }));

  const routeList = Object.values(routes)
    .filter((rt) => rt.damaged > 0)
    .map((rt) => ({
      kho: rt.kho, province: rt.province, region: rt.region,
      orders: rt.orders, damaged: rt.damaged, rate: pct2(rt.damaged, rt.orders), risky: isRisky(rt),
      topLeg: Object.entries(rt.legs).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    }))
    .sort((a, b) => (b.risky - a.risky) || (b.rate - a.rate) || (b.damaged - a.damaged))
    .slice(0, ROUTES_MAX);

  const byProject = Object.values(projects)
    .map((p) => ({ name: p.name, orders: p.orders, damaged: p.damaged, per1000: p.orders > 0 ? Math.round((p.damaged / p.orders) * 10000) / 10 : null, amount: p.amount }))
    .sort((a, b) => (b.per1000 ?? 0) - (a.per1000 ?? 0) || b.orders - a.orders);

  return {
    rule: { minOrders: RISK_MIN_ORDERS, multiplier: RISK_RATE_MULTIPLIER },
    totalOrders, totalDamaged, avgRate, threshold: Math.round(threshold * 100) / 100,
    regions, warehouses, routes: routeList,
    riskyRouteCount: routeList.filter((r) => r.risky).length,
    byProject,
    // Hidden in the UI while no case carries an amount (all 0 as of 26/09).
    totalAmount,
  };
}
