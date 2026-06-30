/**
 * lib/transform-ltl.js
 * LTL data transformation logic — spec sections 3.1 → 3.4
 * 
 * RULES (hard-coded, do NOT change without user approval):
 * 3.1 - Số đơn: COUNT(order_code) grouped by month(pickup_time)
 * 3.2 - Ontime: filter status='delivered' FIRST, then use odr_success flag
 *       % Ontime = count(odr_success='ontime') / count(odr_success IN ['ontime','late'])
 * 3.3 - Hư hỏng: split by 3 types of "Tình trạng", sub-split by compensation status
 * 3.4 - Cảnh báo kho: group by warehouse_giao, score = late + hư hỏng, top 8
 */

/**
 * Parse a date string or Excel serial number into a JS Date.
 */
function parseDate(val) {
  if (!val) return null;
  // Excel serial number (numeric)
  if (typeof val === "number") {
    // Excel epoch is Jan 0, 1900; JS epoch is Jan 1, 1970
    const msPerDay = 86400000;
    const excelEpoch = new Date(1899, 11, 30).getTime();
    return new Date(excelEpoch + val * msPerDay);
  }
  // String date
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Get month (1-12) from a date value.
 */
function getMonth(val) {
  const d = parseDate(val);
  if (!d) return null;
  return d.getMonth() + 1; // JS months are 0-indexed
}

/**
 * Normalize odr_success value for comparison.
 */
function normalizeOdrSuccess(val) {
  if (!val) return "";
  return String(val).toLowerCase().trim();
}

/**
 * Normalize status value.
 */
function normalizeStatus(val) {
  if (!val) return "";
  return String(val).toLowerCase().trim();
}

/**
 * Determine hư hỏng compensation status per spec 3.3:
 * - "Đền bù": Số tiền > 0
 * - "Đã xử lý (không đền bù)": Số tiền <= 0 AND Hướng xử lý is not empty
 * - "Chưa xử lý": everything else
 */
function getCompensationStatus(row) {
  const soTien = parseFloat(row["Số tiền"]) || 0;
  const huongXuLy = String(row["Hướng xử lý"] || "").trim();
  if (soTien > 0) return "Đền bù";
  if (huongXuLy.length > 0) return "Đã xử lý (không đền bù)";
  return "Chưa xử lý";
}

/**
 * Main LTL transform function.
 * @param {object[]} rawRows - rows from "Raw" sheet
 * @param {object} filters - { months: number[], projects: string[] }
 * @returns {object} aggregated dashboard data
 */
export function transformLTL(rawRows, filters = {}) {
  const { months = null, projects = null } = filters;

  // Apply filters
  let rows = rawRows.filter((row) => {
    // Month filter: based on pickup_time per spec 3.1
    if (months && months.length > 0) {
      const m = getMonth(row["pickup_time"]);
      if (!months.includes(m)) return false;
    }
    // Project filter
    if (projects && projects.length > 0) {
      if (!projects.includes(row["client_name"])) return false;
    }
    return true;
  });

  // ── Spec 3.1: Total orders & weight ──
  const totalOrders = rows.length;
  const totalWeight = rows.reduce(
    (sum, r) => sum + (parseFloat(r["weight"]) || 0),
    0
  );

  // Orders by month (for MoM chart)
  const ordersByMonth = {};
  const weightByMonth = {};
  rows.forEach((r) => {
    const m = getMonth(r["pickup_time"]);
    if (!m) return;
    ordersByMonth[m] = (ordersByMonth[m] || 0) + 1;
    weightByMonth[m] = (weightByMonth[m] || 0) + (parseFloat(r["weight"]) || 0);
  });

  // Orders by project
  const ordersByProject = {};
  const weightByProject = {};
  rows.forEach((r) => {
    const proj = r["client_name"] || "Unknown";
    ordersByProject[proj] = (ordersByProject[proj] || 0) + 1;
    weightByProject[proj] =
      (weightByProject[proj] || 0) + (parseFloat(r["weight"]) || 0);
  });

  // ── Spec 3.2: Ontime / Late ──
  // Step 1: Filter to delivered only
  const deliveredRows = rows.filter(
    (r) => normalizeStatus(r["status"]) === "delivered"
  );
  // Step 2: Count ontime/late from odr_success
  const evalRows = deliveredRows.filter((r) => {
    const v = normalizeOdrSuccess(r["odr_success"]);
    return v === "ontime" || v === "late";
  });
  const ontimeCount = evalRows.filter(
    (r) => normalizeOdrSuccess(r["odr_success"]) === "ontime"
  ).length;
  const lateCount = evalRows.length - ontimeCount;
  const ontimePct =
    evalRows.length > 0 ? (ontimeCount / evalRows.length) * 100 : 0;

  // Ontime by project (for Ontime per project chart)
  const ontimeByProject = {};
  deliveredRows.forEach((r) => {
    const proj = r["client_name"] || "Unknown";
    const v = normalizeOdrSuccess(r["odr_success"]);
    if (v === "ontime" || v === "late") {
      if (!ontimeByProject[proj]) {
        ontimeByProject[proj] = { ontime: 0, late: 0 };
      }
      if (v === "ontime") ontimeByProject[proj].ontime++;
      else ontimeByProject[proj].late++;
    }
  });

  // Ontime by month (for trend chart — delivered only)
  const ontimeByMonth = {};
  deliveredRows.forEach((r) => {
    const m = getMonth(r["pickup_time"]);
    if (!m) return;
    const v = normalizeOdrSuccess(r["odr_success"]);
    if (v === "ontime" || v === "late") {
      if (!ontimeByMonth[m]) ontimeByMonth[m] = { ontime: 0, late: 0 };
      if (v === "ontime") ontimeByMonth[m].ontime++;
      else ontimeByMonth[m].late++;
    }
  });

  // ── Spec 3.3: Hư hỏng breakdown ──
  // 3 types: "Hư hỏng vỏ thùng", "Hư hỏng sản phẩm bên trong", "Mất sản phẩm bên trong"
  const brokenRows = rows.filter((r) => {
    const tt = String(r["Tình trạng"] || "").trim();
    return tt.length > 0;
  });

  // Group by type and compensation status
  const brokenByType = {};
  brokenRows.forEach((r) => {
    const type = String(r["Tình trạng"] || "").trim();
    const compStatus = getCompensationStatus(r);
    if (!brokenByType[type]) {
      brokenByType[type] = { "Đền bù": 0, "Đã xử lý (không đền bù)": 0, "Chưa xử lý": 0 };
    }
    brokenByType[type][compStatus]++;
  });

  const totalBroken = brokenRows.length;
  const brokenCompensated = brokenRows.filter(
    (r) => getCompensationStatus(r) === "Đền bù"
  ).length;
  const brokenResolved = brokenRows.filter(
    (r) => getCompensationStatus(r) === "Đã xử lý (không đền bù)"
  ).length;
  const brokenPending = brokenRows.filter(
    (r) => getCompensationStatus(r) === "Chưa xử lý"
  ).length;

  // Detailed broken records for table (include key fields)
  const brokenDetails = brokenRows.map((r) => ({
    order_code: r["order_code"] || "",
    client_name: r["client_name"] || "",
    warehouse_giao: r["warehouse_giao"] || "",
    tinh_trang: String(r["Tình trạng"] || "").trim(),
    huong_xu_ly: String(r["Hướng xử lý"] || "").trim(),
    so_tien: parseFloat(r["Số tiền"]) || 0,
    comp_status: getCompensationStatus(r),
    month: getMonth(r["pickup_time"]),
  }));

  // ── Spec 3.4: Cảnh báo kho ──
  // Score = late deliveries + hư hỏng cases per warehouse_giao
  const whScore = {};

  // Late orders (delivered, late)
  deliveredRows.forEach((r) => {
    if (normalizeOdrSuccess(r["odr_success"]) === "late") {
      const wh = String(r["warehouse_giao"] || "Unknown").trim();
      if (!whScore[wh]) whScore[wh] = { late: 0, broken: 0 };
      whScore[wh].late++;
    }
  });

  // Broken cases
  brokenRows.forEach((r) => {
    const wh = String(r["warehouse_giao"] || "Unknown").trim();
    if (!whScore[wh]) whScore[wh] = { late: 0, broken: 0 };
    whScore[wh].broken++;
  });

  // Sort by total score descending, take top 8
  const warehouseAlerts = Object.entries(whScore)
    .map(([wh, s]) => ({
      warehouse: wh,
      late: s.late,
      broken: s.broken,
      score: s.late + s.broken,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // ── List of unique projects ──
  const allProjects = [
    ...new Set(rawRows.map((r) => r["client_name"]).filter(Boolean)),
  ].sort();

  return {
    totalOrders,
    totalWeight: Math.round(totalWeight),
    ontimeCount,
    lateCount,
    ontimePct: Math.round(ontimePct * 10) / 10,
    evalCount: evalRows.length,
    deliveredCount: deliveredRows.length,
    totalBroken,
    brokenCompensated,
    brokenResolved,
    brokenPending,
    brokenByType,
    brokenDetails,
    ordersByMonth,
    weightByMonth,
    ordersByProject,
    weightByProject,
    ontimeByProject,
    ontimeByMonth,
    warehouseAlerts,
    allProjects,
  };
}
