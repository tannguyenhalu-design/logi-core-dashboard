/**
 * lib/transform-ai-insights.js
 * Input: rawLTL = array of row objects { weight, status, warehouse_lay, ... }
 * Tầng 1: Tuyến hay bể vỡ (Tình trạng != rỗng)
 * Tầng 2: Tuyến có hàng chưa xuất gần đầy xe 5T (70% = 3500kg)
 * Tầng 3: So sánh cùng kỳ tháng trước (ontime% + số đơn)
 */
import { computePeriodComparison } from "./transform-ltl";

const TRUCK_5T_KG     = 5000;
const SPLIT_THRESHOLD = 0.70; // 70% → cảnh báo

function parseDate(val) {
  if (!val) return null;
  if (typeof val === "number") {
    return new Date(new Date(1899, 11, 30).getTime() + val * 86400000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export function transformAIInsights(rawRows, rawDamage = []) {
  if (!rawRows || rawRows.length === 0) {
    return { breakageRoutes: [], capacityRoutes: [], avgDmgRate: 0, totalOrders: 0 };
  }

  // rawRows là array of objects — mỗi row là { weight, status, kho_lay, ... }
  const rows = Array.isArray(rawRows) ? rawRows : [];

  // Damage cases live on a separate sheet (raw_damage), not a "Tình trạng"
  // column on the orders sheet — that column never existed, so breakage
  // detection silently found nothing until this joined by order_code.
  const damagedOrderCodes = new Set(
    (Array.isArray(rawDamage) ? rawDamage : [])
      .map((d) => String(d["order_code"] || "").trim())
      .filter(Boolean)
  );

  // ── Accumulate per route ──
  const routeMap = {};

  rows.forEach(row => {
    if (!row || typeof row !== "object") return;

    const lay    = String(row["kho_lay"]  || row["warehouse_lay"]  || "").trim();
    const giao   = String(row["kho_giao"] || row["warehouse_giao"] || "").trim();
    if (!lay || !giao) return;

    const key      = `${lay} → ${giao}`;
    const status   = String(row["status"]         || "").toLowerCase().trim();
    const weight   = parseFloat(row["weight"])    || 0;
    const damage   = damagedOrderCodes.has(String(row["order_code"] || "").trim());
    const deadline = row["deadline_plus"] || row["deadline"] || null;

    if (!routeMap[key]) {
      routeMap[key] = {
        route: key, lay, giao,
        total: 0, damaged: 0,
        pendingWeight: 0, pendingOrders: 0,
        nearestDeadline: null,
      };
    }

    const r = routeMap[key];
    r.total++;

    // Bể vỡ — đơn này có case trong raw_damage
    if (damage) r.damaged++;

    // Hàng chưa xuất
    const PENDING = ["ready_to_pick", "storing", "picking"];
    if (PENDING.includes(status)) {
      r.pendingWeight += weight;
      r.pendingOrders++;
      if (deadline) {
        const d = parseDate(deadline);
        if (d && (!r.nearestDeadline || d < r.nearestDeadline)) {
          r.nearestDeadline = d;
        }
      }
    }
  });

  const routes = Object.values(routeMap);

  // Trung bình bể vỡ toàn hệ thống
  const totalOrders  = routes.reduce((s, r) => s + r.total, 0);
  const totalDamaged = routes.reduce((s, r) => s + r.damaged, 0);
  const avgDmgRate   = totalOrders > 0 ? totalDamaged / totalOrders : 0;

  // ── Tầng 1: Tuyến bể vỡ cao ──
  const breakageRoutes = routes
    .filter(r => r.damaged > 0 && r.total >= 5)
    .map(r => {
      const rate  = r.damaged / r.total;
      const vsAvg = avgDmgRate > 0 ? rate / avgDmgRate : 0;
      return {
        route:      r.route,
        total:      r.total,
        damaged:    r.damaged,
        rate:       +(rate * 100).toFixed(1),
        vsAvg:      +vsAvg.toFixed(1),
        suggestion: rate > 0.05 ? "Cân nhắc FTL riêng" : "Kiểm tra đóng gói",
      };
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);

  // ── Tầng 2: Tuyến pending gần đầy xe ──
  const capacityRoutes = routes
    .filter(r => r.pendingWeight > 0)
    .map(r => {
      const pct   = r.pendingWeight / TRUCK_5T_KG;
      const trips = Math.ceil(r.pendingWeight / TRUCK_5T_KG);
      let   level = "ok";
      if (pct >= 0.9) level = "critical";
      else if (pct >= SPLIT_THRESHOLD) level = "warning";

      let deadlineStr = null;
      if (r.nearestDeadline) {
        const d = r.nearestDeadline;
        deadlineStr = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
      }

      return {
        route:           r.route,
        pendingWeight:   Math.round(r.pendingWeight),
        pendingOrders:   r.pendingOrders,
        capacityPct:     +(pct * 100).toFixed(0),
        suggestedTrips:  trips,
        level,
        nearestDeadline: deadlineStr,
      };
    })
    .sort((a, b) => b.capacityPct - a.capacityPct)
    .slice(0, 8);

  const periodComparison = computePeriodComparison(rows);

  return {
    breakageRoutes,
    capacityRoutes,
    avgDmgRate:  +(avgDmgRate * 100).toFixed(2),
    totalOrders,
    periodComparison,
  };
}

