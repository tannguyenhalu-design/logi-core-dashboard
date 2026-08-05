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
    const msPerDay = 86400000;
    const excelEpoch = new Date(1899, 11, 30).getTime();
    return new Date(excelEpoch + val * msPerDay);
  }
  const str = String(val).trim();
  // Check DD/MM/YYYY or DD-MM-YYYY format (e.g. "01/08/2026" or "1/8/2026")
  const ddmm = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmm) {
    const day = parseInt(ddmm[1], 10);
    const month = parseInt(ddmm[2], 10) - 1;
    const year = parseInt(ddmm[3], 10);
    return new Date(year, month, day);
  }
  // String date fallback
  const d = new Date(str);
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
  if (soTien > 0 || huongXuLy === "Đền bù") return "Đền bù";
  if (huongXuLy === "Đã xử lý (không đền bù)") return "Đã xử lý (không đền bù)";
  return "Chưa xử lý";
}

/**
 * Main LTL transform function.
 * @param {object[]} rawRows - rows from "Raw" sheet
 * @param {object} filters - { months: number[], projects: string[] }
 * @param {object[]} rawDamage - raw damage rows
 * @returns {object} aggregated dashboard data
 */
export function transformLTL(rawRows, filters = {}, rawDamage = []) {
  const { months = null, projects = null, filterMode = "pickup" } = filters;

  // Project filter helper
  const passProject = (row) =>
    !projects || projects.length === 0 || projects.includes(row["client_name"]);

  // Project/Month filter helpers for damage tab
  const passProjectDmg = (clientName) =>
    !projects || projects.length === 0 || projects.includes(clientName);

  const passMonthDmg = (dateStr) => {
    if (!months || months.length === 0) return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return months.includes(d.getMonth() + 1);
  };

  const filteredDamage = (rawDamage || []).filter((r) => {
    return passProjectDmg(r["client_name"]) && passMonthDmg(r["pickup_time"] || r["case_date"]);
  });

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

  // ── Spec 3.1: Total orders & weight (converted from raw Grams to KG) ──
  const totalOrders = rows.length;
  const totalWeight = rows.reduce(
    (sum, r) => sum + ((parseFloat(r["weight"]) || 0) / 1000),
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
    weightByMonth[key] = (weightByMonth[key] || 0) + ((parseFloat(r["weight"]) || 0) / 1000);
  });

  // Orders by project
  const ordersByProject = {};
  const weightByProject = {};
  rows.forEach((r) => {
    const proj = r["client_name"] || "Unknown";
    ordersByProject[proj] = (ordersByProject[proj] || 0) + 1;
    weightByProject[proj] = (weightByProject[proj] || 0) + ((parseFloat(r["weight"]) || 0) / 1000);
  });

  // ── Spec 3.2: Ontime / Late ──
  // Evaluate both delivered AND in-progress orders that are already marked late
  const evalRows = rows.filter((r) => {
    const v = normalizeOdrSuccess(r["odr_success"]);
    const s = normalizeStatus(r["status"]);
    if (s === "delivered") {
      return v === "ontime" || v === "late";
    } else {
      return v === "late"; // Count in-progress orders that are already late!
    }
  });

  const ontimeCount = evalRows.filter(
    (r) => normalizeOdrSuccess(r["odr_success"]) === "ontime"
  ).length;
  const lateCount = evalRows.length - ontimeCount;
  const ontimePct =
    evalRows.length > 0 ? (ontimeCount / evalRows.length) * 100 : 0;

  // Ontime by project (for Ontime per project chart)
  const ontimeByProject = {};
  evalRows.forEach((r) => {
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
  evalRows.forEach((r) => {
    const dateField = filterMode === "delivered" ? r["delivered_time"] : r["pickup_time"];
    const key = isWeekly ? getWeekFromPickupTime(dateField) : getMonth(dateField);
    if (!key) return;
    const v = normalizeOdrSuccess(r["odr_success"]);
    if (v === "ontime" || v === "late") {
      if (!ontimeByMonth[key]) ontimeByMonth[key] = { ontime: 0, late: 0 };
      if (v === "ontime") ontimeByMonth[key].ontime++;
      else ontimeByMonth[key].late++;
    }
  });

  // ── Spec 3.3: Hư hỏng breakdown ──
  const brokenRows = filteredDamage;

  const getCompensationStatusDmg = (row) => {
    const statusStr = String(row["case_status"] || "").trim();
    const cleaned = statusStr.replace(/[.,]/g, "");
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return "Đền bù";
    if (statusStr.toLowerCase().includes("đền bù")) return "Đền bù";
    const reason = String(row["qlrr_reason"] || "").trim();
    if (reason.length > 0) return "Đã xử lý (không đền bù)";
    return "Chưa xử lý";
  };

  // Group by type and compensation status
  const brokenByType = {};
  brokenRows.forEach((r) => {
    const typeRaw = String(r["damage_type"] || "Hư hỏng").trim();
    const type = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
    const compStatus = getCompensationStatusDmg(r);
    if (!brokenByType[type]) {
      brokenByType[type] = { "Đền bù": 0, "Đã xử lý (không đền bù)": 0, "Chưa xử lý": 0 };
    }
    brokenByType[type][compStatus]++;
  });

  const totalBroken = brokenRows.length;
  const brokenCompensated = brokenRows.filter(
    (r) => getCompensationStatusDmg(r) === "Đền bù"
  ).length;
  const brokenResolved = brokenRows.filter(
    (r) => getCompensationStatusDmg(r) === "Đã xử lý (không đền bù)"
  ).length;
  const brokenPending = brokenRows.filter(
    (r) => getCompensationStatusDmg(r) === "Chưa xử lý"
  ).length;

  // Detailed broken records for table (include key fields)
  const brokenDetails = brokenRows.map((r) => {
    const statusStr = String(r["case_status"] || "").trim();
    const cleaned = statusStr.replace(/[.,]/g, "");
    const num = parseFloat(cleaned);
    const amt = !isNaN(num) && num > 0 ? num : 0;
    
    return {
      order_code: r["order_code"] || "",
      client_name: r["client_name"] || "",
      warehouse_giao: r["warehouse_giao"] || "",
      tinh_trang: String(r["damage_type"] || "Hư hỏng").trim(),
      huong_xu_ly: getCompensationStatusDmg(r),
      so_tien: amt,
      comp_status: getCompensationStatusDmg(r),
      month: months && months.length > 0 ? months[0] : 7,
    };
  });

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
    .slice(0, 10);

  // ── Province distribution (for the LTL map + AI insight panel + rich hover tooltips) ──
  // Uses `rows` (already filtered by month/project/filterMode above)
  const provinceMap = {};
  const provinceDetailsMap = {};

  rows.forEach((r) => {
    const prov = String(r["to_province_name"] || "").trim();
    if (!prov) return;

    if (!provinceMap[prov]) provinceMap[prov] = { orders: 0, weight: 0, clients: {} };
    const w = (parseFloat(r["weight"]) || 0) / 1000; // convert raw Grams -> KG
    provinceMap[prov].orders++;
    provinceMap[prov].weight += w;
    const cl = r["client_name"] || "Unknown";
    if (!provinceMap[prov].clients[cl]) provinceMap[prov].clients[cl] = { orders: 0, weight: 0 };
    provinceMap[prov].clients[cl].orders++;
    provinceMap[prov].clients[cl].weight += w;

    // Detailed province analysis
    if (!provinceDetailsMap[prov]) {
      provinceDetailsMap[prov] = {
        name: prov,
        totalOrders: 0,
        totalWeight: 0,
        ontimeCount: 0,
        lateCount: 0,
        evalCount: 0,
        origins: {},      // from_province -> count
        warehouses: {},   // warehouse_lay -> count
        clients: {},      // client_name -> { orders, ontime, late, origins: {} }
      };
    }

    const pDetail = provinceDetailsMap[prov];
    pDetail.totalOrders++;
    pDetail.totalWeight += w;

    const fromProv = String(r["from_province_name"] || "").trim();
    if (fromProv) {
      pDetail.origins[fromProv] = (pDetail.origins[fromProv] || 0) + 1;
    }

    const whLay = String(r["warehouse_lay"] || "").trim();
    if (whLay) {
      pDetail.warehouses[whLay] = (pDetail.warehouses[whLay] || 0) + 1;
    }

    if (!pDetail.clients[cl]) {
      pDetail.clients[cl] = {
        name: cl,
        orders: 0,
        weight: 0,
        ontime: 0,
        late: 0,
        evalCount: 0,
        origins: {},
      };
    }
    const cDetail = pDetail.clients[cl];
    cDetail.orders++;
    cDetail.weight += w;
    if (fromProv) {
      cDetail.origins[fromProv] = (cDetail.origins[fromProv] || 0) + 1;
    }

    if (normalizeStatus(r["status"]) === "delivered") {
      const v = normalizeOdrSuccess(r["odr_success"]);
      if (v === "ontime") {
        pDetail.ontimeCount++;
        pDetail.evalCount++;
        cDetail.ontime++;
        cDetail.evalCount++;
      } else if (v === "late") {
        pDetail.lateCount++;
        pDetail.evalCount++;
        cDetail.late++;
        cDetail.evalCount++;
      }
    }
  });

  // Track damage cases per province and per client
  filteredDamage.forEach((r) => {
    const prov = String(r["to_province_name"] || "").trim();
    const cl = String(r["client_name"] || "Khác").trim();
    if (!prov) return;

    if (!provinceDetailsMap[prov]) {
      provinceDetailsMap[prov] = {
        name: prov,
        totalOrders: 0,
        totalWeight: 0,
        ontimeCount: 0,
        lateCount: 0,
        evalCount: 0,
        damageCount: 0,
        origins: {},
        warehouses: {},
        clients: {},
      };
    }
    const pDetail = provinceDetailsMap[prov];
    pDetail.damageCount = (pDetail.damageCount || 0) + 1;

    if (!pDetail.clients[cl]) {
      pDetail.clients[cl] = {
        name: cl,
        orders: 0,
        weight: 0,
        ontime: 0,
        late: 0,
        evalCount: 0,
        damageCount: 0,
        origins: {},
      };
    }
    const cDetail = pDetail.clients[cl];
    cDetail.damageCount = (cDetail.damageCount || 0) + 1;
  });

  // Calculate percentages and top origins for provinceDetailsMap
  Object.values(provinceDetailsMap).forEach((p) => {
    p.ontimePct = p.evalCount > 0 ? Math.round((p.ontimeCount / p.evalCount) * 100) : 100;
    p.totalWeight = Math.round(p.totalWeight || 0);

    // Top origins sorted
    p.topOrigins = Object.entries(p.origins)
      .map(([name, count]) => ({
        name,
        count,
        pct: p.totalOrders > 0 ? Math.round((count / p.totalOrders) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Client list sorted by orders with ontime % and main origin
    p.clientDetails = Object.values(p.clients)
      .map((c) => {
        const topOrig = Object.entries(c.origins).sort((a, b) => b[1] - a[1])[0];
        return {
          name: c.name,
          orders: c.orders,
          weight: Math.round(c.weight || 0),
          ontimePct: c.evalCount > 0 ? Math.round((c.ontime / c.evalCount) * 100) : 100,
          damageCount: c.damageCount || 0,
          mainOrigin: topOrig ? topOrig[0] : "N/A",
        };
      })
      .sort((a, b) => b.orders - a.orders);
  });

  const provinceStats = Object.entries(provinceMap)
    .map(([name, s]) => {
      const topClients = Object.entries(s.clients)
        .sort((a, b) => b[1].orders - a[1].orders)
        .map(([clientName, c]) => ({
          name: clientName,
          orders: c.orders,
          weight: Math.round(c.weight),
          pct: s.orders ? +((c.orders / s.orders) * 100).toFixed(0) : 0,
        }));
      return {
        name,
        orders: s.orders,
        weight: Math.round(s.weight),
        topClient: topClients[0] || null,
        topClients: topClients.slice(0, 3),
        details: provinceDetailsMap[name] || null,
      };
    })
    .sort((a, b) => b.orders - a.orders);

  // ── From→To route pairs (for drawing lines when a single project is selected) ──
  const routeMap = {};
  rows.forEach((r) => {
    const from = String(r["from_province_name"] || "").trim();
    const to = String(r["to_province_name"] || "").trim();
    if (!from || !to || from === to) return;
    const key = `${from}→${to}`;
    if (!routeMap[key]) routeMap[key] = { from, to, orders: 0, weight: 0 };
    routeMap[key].orders++;
    routeMap[key].weight += parseFloat(r["weight"]) || 0;
  });
  const routeStats = Object.values(routeMap)
    .map((r) => ({ ...r, weight: Math.round(r.weight) }))
    .sort((a, b) => b.orders - a.orders);

  // ── List of unique projects ──
  const allProjects = [
    ...new Set(rawRows.map((r) => r["client_name"]).filter(Boolean)),
  ].sort();

  const damageByProvince = {};
  const damageByWarehouse = {};
  filteredDamage.forEach((r) => {
    const prov = String(r["to_province_name"] || "Không rõ").trim();
    if (prov) {
      damageByProvince[prov] = (damageByProvince[prov] || 0) + 1;
    }
    const wh = String(r["warehouse_giao"] || "Không rõ").trim();
    if (wh) {
      damageByWarehouse[wh] = (damageByWarehouse[wh] || 0) + 1;
    }
  });

  const topDamageProvinces = Object.entries(damageByProvince)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topDamageWarehouses = Object.entries(damageByWarehouse)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const detailedDamageCases = filteredDamage.map((r) => {
    const statusStr = String(r["case_status"] || "").trim();
    const cleaned = statusStr.replace(/[.,]/g, "");
    const num = parseFloat(cleaned);

    let handling = "Chưa xử lý";
    let amount = 0;
    if (!isNaN(num) && num > 0) {
      amount = num;
      handling = "Đền bù";
    } else if (statusStr.includes("Đền bù") || statusStr.includes("đền bù")) {
      handling = "Đền bù";
    } else {
      const reason = String(r["qlrr_reason"] || "").trim();
      if (reason.length > 0) {
        handling = "Đã xử lý (không đền bù)";
      }
    }

    return {
      order_code:      r["order_code"] || "",
      client_name:     r["client_name"] || "",
      to_province:     r["to_province_name"] || "",
      warehouse_giao:  r["warehouse_giao"] || "",
      damage_type:     r["damage_type"] || "Hư hỏng",
      damage_details:  r["damage_details"] || "",
      offence_place:   r["offence_place"] || "",
      handling,
      amount,
    };
  });

  // ── Project / Client Overall Summaries (for default overview card when no province is hovered) ──
  const projectSummaries = {};
  rows.forEach((r) => {
    const proj = String(r["client_name"] || "Khác").trim();
    if (!projectSummaries[proj]) {
      projectSummaries[proj] = {
        name: proj,
        totalOrders: 0,
        totalWeight: 0,
        ontimeCount: 0,
        lateCount: 0,
        evalCount: 0,
        damageCount: 0,
        origins: {},
        provinces: {},
      };
    }
    const ps = projectSummaries[proj];
    const w = (parseFloat(r["weight"]) || 0) / 1000;
    ps.totalOrders++;
    ps.totalWeight += w;

    const fromProv = String(r["from_province_name"] || "").trim();
    if (fromProv) ps.origins[fromProv] = (ps.origins[fromProv] || 0) + 1;

    const toProv = String(r["to_province_name"] || "").trim();
    if (toProv) ps.provinces[toProv] = (ps.provinces[toProv] || 0) + 1;

    if (normalizeStatus(r["status"]) === "delivered") {
      const v = normalizeOdrSuccess(r["odr_success"]);
      if (v === "ontime") {
        ps.ontimeCount++;
        ps.evalCount++;
      } else if (v === "late") {
        ps.lateCount++;
        ps.evalCount++;
      }
    }
  });

  // Track damage cases per project
  filteredDamage.forEach((r) => {
    const proj = String(r["client_name"] || "Khác").trim();
    if (!projectSummaries[proj]) {
      projectSummaries[proj] = {
        name: proj,
        totalOrders: 0,
        totalWeight: 0,
        ontimeCount: 0,
        lateCount: 0,
        evalCount: 0,
        damageCount: 0,
        origins: {},
        provinces: {},
      };
    }
    projectSummaries[proj].damageCount = (projectSummaries[proj].damageCount || 0) + 1;
  });

  // Calculate percentages and top origins/destinations for each project summary
  Object.values(projectSummaries).forEach((ps) => {
    ps.ontimePct = ps.evalCount > 0 ? Math.round((ps.ontimeCount / ps.evalCount) * 100) : 100;
    ps.totalWeight = Math.round(ps.totalWeight || 0);

    ps.topOrigins = Object.entries(ps.origins)
      .map(([name, count]) => ({
        name,
        count,
        pct: ps.totalOrders > 0 ? Math.round((count / ps.totalOrders) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    ps.topProvinces = Object.entries(ps.provinces)
      .map(([name, count]) => ({
        name,
        count,
        pct: ps.totalOrders > 0 ? Math.round((count / ps.totalOrders) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  });

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
    topDamageProvinces,
    topDamageWarehouses,
    detailedDamageCases,
    provinceStats,
    provinceDetailsMap,
    projectSummaries,
    routeStats,
    filteredRows: rows,
  };
}
