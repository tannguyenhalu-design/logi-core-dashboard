/**
 * lib/transform-ai-insights.js
 * Tính toán AI Insights từ Raw data:
 *   Tầng 1: Tuyến hay bể vỡ (Tình trạng != rỗng)
 *   Tầng 2: Tuyến có hàng chưa xuất gần đầy xe 5T (70% = 3500kg)
 */

const TRUCK_5T_KG    = 5000;
const SPLIT_THRESHOLD = 0.70; // 70% → cảnh báo

export function transformAIInsights(rawRows) {
  if (!rawRows || rawRows.length < 2) return { breakageRoutes: [], capacityRoutes: [] };

  const headers = rawRows[0].map(h => String(h).toLowerCase().trim());
  const rows    = rawRows.slice(1);

  // ── Column indexes ──
  const iWeight    = headers.indexOf("weight");
  const iStatus    = headers.indexOf("status");
  const iLay       = headers.indexOf("warehouse_lay");
  const iGiao      = headers.indexOf("warehouse_giao");
  const iTinhTrang = headers.findIndex(h => h.includes("tình trạng") || h === "tinh_trang");
  const iDeadline  = headers.indexOf("deadline");

  // ── Accumulate per route ──
  const routeMap = {};

  rows.forEach(row => {
    const lay    = String(row[iLay]  || "").trim();
    const giao   = String(row[iGiao] || "").trim();
    if (!lay || !giao) return;

    const key    = `${lay} → ${giao}`;
    const status = String(row[iStatus] || "").toLowerCase().trim();
    const weight = parseFloat(row[iWeight]) || 0;
    const damage = iTinhTrang >= 0 ? String(row[iTinhTrang] || "").trim() : "";
    const deadline = iDeadline >= 0 ? row[iDeadline] : null;

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

    // Bể vỡ
    if (damage) r.damaged++;

    // Hàng chưa xuất
    const PENDING = ["ready_to_pick", "storing", "picking"];
    if (PENDING.includes(status)) {
      r.pendingWeight += weight;
      r.pendingOrders++;
      // Deadline gần nhất
      if (deadline) {
        let d = deadline instanceof Date ? deadline : new Date(deadline);
        if (!isNaN(d.getTime())) {
          if (!r.nearestDeadline || d < r.nearestDeadline) {
            r.nearestDeadline = d;
          }
        }
      }
    }
  });

  const routes = Object.values(routeMap);

  // ── Trung bình bể vỡ toàn hệ thống ──
  const totalOrders  = routes.reduce((s, r) => s + r.total, 0);
  const totalDamaged = routes.reduce((s, r) => s + r.damaged, 0);
  const avgDmgRate   = totalOrders > 0 ? totalDamaged / totalOrders : 0;

  // ── Tầng 1: Top routes bể vỡ ──
  const breakageRoutes = routes
    .filter(r => r.damaged > 0 && r.total >= 5) // ít nhất 5 đơn để có ý nghĩa
    .map(r => {
      const rate   = r.damaged / r.total;
      const vsAvg  = avgDmgRate > 0 ? rate / avgDmgRate : 0;
      return {
        route:      r.route,
        total:      r.total,
        damaged:    r.damaged,
        rate:       +(rate * 100).toFixed(1),
        vsAvg:      +vsAvg.toFixed(1), // bao nhiêu lần so với TB
        suggestion: rate > 0.05 ? "Cân nhắc FTL riêng" : "Kiểm tra đóng gói",
      };
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);

  // ── Tầng 2: Top routes pending gần đầy xe ──
  const capacityRoutes = routes
    .filter(r => r.pendingWeight > 0)
    .map(r => {
      const pct      = r.pendingWeight / TRUCK_5T_KG;
      const trips    = Math.ceil(r.pendingWeight / TRUCK_5T_KG);
      let   level    = "ok";       // < 50%
      if (pct >= 0.9) level = "critical";  // >= 90%
      else if (pct >= SPLIT_THRESHOLD) level = "warning"; // >= 70%

      // Ngày deadline gần nhất dạng string
      let deadlineStr = null;
      if (r.nearestDeadline) {
        const d = r.nearestDeadline;
        deadlineStr = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
      }

      return {
        route:         r.route,
        pendingWeight: Math.round(r.pendingWeight),
        pendingOrders: r.pendingOrders,
        capacityPct:   +(pct * 100).toFixed(0),
        suggestedTrips: trips,
        level,
        nearestDeadline: deadlineStr,
      };
    })
    .sort((a, b) => b.capacityPct - a.capacityPct)
    .slice(0, 8);

  return {
    breakageRoutes,
    capacityRoutes,
    avgDmgRate: +(avgDmgRate * 100).toFixed(2),
    totalOrders,
  };
}
