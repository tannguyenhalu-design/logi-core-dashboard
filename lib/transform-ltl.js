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

function getWeekFromPickupTime(val) {
  const d = parseDate(val);
  if (!d) return null;
  const day = d.getDate();
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
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
  const { months = null, projects = null, filterMode = "pickup" } = filters;

  // Project filter helper
  const passProject = (row) =>
    !projects || projects.length === 0 || projects.includes(row["client_name"]);

  // ── Mode: lọc theo ngày giao (delivered_time) ──
  let rows;
  if (filterMode === "delivered") {
    rows = rawRows.filter((row) => {
      if (!passProject(row)) return false;
      if (String(row["status"] || "").toLowerCase().trim() !== "delivered") return false;
      if (months && months.length > 0) {
        const dm = getMonth(row["delivered_time"]);
        if (!months.includes(dm)) return false;
      }
      return true;
    });
  } else {
    // ── Mode: lọc theo ngày lấy hàng (pickup_time) — default ──
    rows = rawRows.filter((row) => {
      if (months && months.length > 0) {
        const m = getMonth(row["pickup_time"]);
        if (!months.includes(m)) return false;
      }
      if (!passProject(row)) return false;
      return true;
    });
  }

  // GTC theo delivered_time (always shows orders giao xong trong kỳ)
  const deliveredThisMonthCount = filterMode === "delivered"
    ? rows.length  // all rows in delivered mode are already GTC
    : (months && months.length > 0
        ? rawRows.filter(row => {
            if (!passProject(row)) return false;
            const dm = getMonth(row["delivered_time"]);
            return months.includes(dm) && String(row["status"]||"").toLowerCase().trim() === "delivered";
          }).length
        : rawRows.filter(row => {
            if (!passProject(row)) return false;
            return String(row["status"]||"").toLowerCase().trim() === "delivered";
          }).length);

  // ── Spec 3.1: Total orders & weight ──
  const totalOrders = rows.length;
  const totalWeight = rows.reduce(
    (sum, r) => sum + (parseFloat(r["weight"]) || 0),
    0
  );

  const isWeekly = months && months.length === 1;

  // Orders by month (group key depends on filterMode)
  const ordersByMonth = {};
  const weightByMonth = {};
  rows.forEach((r) => {
    let key;
    if (filterMode === "delivered") {
      key = isWeekly ? getWeekFromPickupTime(r["delivered_time"]) : getMonth(r["delivered_time"]);
    } else {
      key = isWeekly ? getWeekFromPickupTime(r["pickup_time"]) : getMonth(r["pickup_time"]);
    }
    if (!key) return;
    ordersByMonth[key] = (ordersByMonth[key] || 0) + 1;
    weightByMonth[key] = (weightByMonth[key] || 0) + (parseFloat(r["weight"]) || 0);
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

  // Ontime by month (or by week if isWeekly is true)
  const ontimeByMonth = {};
  deliveredRows.forEach((r) => {
    const key = isWeekly ? getWeekFromPickupTime(r["pickup_time"]) : getMonth(r["pickup_time"]);
    if (!key) return;
    const v = normalizeOdrSuccess(r["odr_success"]);
    if (v === "ontime" || v === "late") {
      if (!ontimeByMonth[key]) ontimeByMonth[key] = { ontime: 0, late: 0 };
      if (v === "ontime") ontimeByMonth[key].ontime++;
      else ontimeByMonth[key].late++;
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
  // Score = only broken cases (bể vỡ/hư hỏng) per warehouse_giao
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

  // Sort by broken cases descending, take top 8 (only include warehouses with > 0 broken cases)
  const warehouseAlerts = Object.entries(whScore)
    .map(([wh, s]) => ({
      warehouse: wh,
      late: s.late,
      broken: s.broken,
      score: s.broken, // score is only broken count
    }))
    .filter((w) => w.broken > 0)
    .sort((a, b) => b.broken - a.broken)
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
    deliveredThisMonthCount,
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
    isWeekly,
    filterMode,
  };
}
