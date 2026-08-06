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
export function parseDate(val) {
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
 * Ontime/late outcome for a single row, per spec 3.2 — delivered orders
 * use their odr_success flag directly; in-progress orders only count
 * once they've already blown their SLA (still-on-track in-progress
 * orders aren't resolved yet, so they're excluded either way). Used
 * everywhere ontime% is computed so the overall metric and every
 * per-client/per-province breakdown agree with each other.
 */
export function getOntimeOutcome(r) {
  const v = normalizeOdrSuccess(r["odr_success"]);
  if (normalizeStatus(r["status"]) === "delivered") {
    return v === "ontime" || v === "late" ? v : null;
  }
  return v === "late" ? "late" : null;
}

/**
 * Main LTL transform function.
 * @param {object[]} rawRows - rows from "Raw" sheet
 * @param {object} filters - { months: number[], projects: string[] }
 * @param {object[]} rawDamage - raw damage rows
 * @returns {object} aggregated dashboard data
 */
export function transformLTL(rawRows, filters = {}, rawDamage = []) {
  const { months = null, projects = null, filterMode = "pickup", periodWeeks = "mtd" } = filters;

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
  const evalRows = rows.filter((r) => getOntimeOutcome(r) !== null);

  const ontimeCount = evalRows.filter(
    (r) => getOntimeOutcome(r) === "ontime"
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

  // "damage_type" trên sheet gõ không nhất quán hoa/thường ("hư hỏng" /
  // "Hư hỏng" / "Hư Hỏng" đều là 1 loại) — charAt(0).toUpperCase() cũ chỉ
  // viết hoa ký tự đầu nên "Hư Hỏng" (H hoa cả 2 chữ) vẫn tách thành dòng
  // riêng. Chuẩn hoá về chữ thường trước rồi map qua nhãn cố định.
  const DAMAGE_TYPE_LABELS = {
    "c4": "C4",
    "c2": "C2",
    "c5": "C5",
    "hư hỏng": "Hư hỏng",
    "thiếu": "Thiếu",
    "mất/thiếu/tráo": "Mất/Thiếu/Tráo",
    "sai sop": "Sai SOP",
  };
  const normalizeDamageType = (raw) => {
    const key = String(raw || "").trim().toLowerCase();
    if (!key) return "Hư hỏng";
    if (DAMAGE_TYPE_LABELS[key]) return DAMAGE_TYPE_LABELS[key];
    return key.charAt(0).toUpperCase() + key.slice(1);
  };

  // case_status là nhãn trạng thái thật ("Đền bù", "Từ chối", "Đang Xử Lý"…),
  // không phải số tiền — code cũ parseFloat() lên nó (bắt nhầm giá trị rác
  // như "7" thành "đền bù 7 đồng") và đọc qlrr_reason cho "đã xử lý không
  // đền bù", nhưng field đó luôn rỗng trong dữ liệu thật nên nhánh đó không
  // bao giờ chạy — mọi case (kể cả "Từ chối" đã xử lý xong) đều rơi vào
  // "Chưa xử lý". Map thẳng theo case_status thật.
  const getCompensationStatusDmg = (row) => {
    const soTien = parseFloat(row["so_tien_ket_luan"]) || 0;
    if (soTien > 0) return "Đền bù";
    const statusStr = String(row["case_status"] || "").trim().toLowerCase();
    if (statusStr === "đền bù" || statusStr === "đã đi tiền") return "Đền bù";
    if (statusStr === "từ chối") return "Đã xử lý (không đền bù)";
    return "Chưa xử lý";
  };

  // Group by type and compensation status
  const brokenByType = {};
  brokenRows.forEach((r) => {
    const type = normalizeDamageType(r["damage_type"]);
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
    const amt = parseFloat(r["so_tien_ket_luan"]) || 0;

    return {
      order_code: r["order_code"] || "",
      client_name: r["client_name"] || "",
      warehouse_giao: r["warehouse_giao"] || "",
      tinh_trang: normalizeDamageType(r["damage_type"]),
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
  const deliveredRows = rows.filter(
    (r) => normalizeStatus(r["status"]) === "delivered"
  );
  deliveredRows.forEach((r) => {
    if (normalizeOdrSuccess(r["odr_success"]) === "late") {
      // The orders sheet's real column is "kho_giao" (Vietnamese), not
      // "warehouse_giao" like the damage sheet uses — this silently
      // returned "Unknown" for every row until caught while building the
      // period-comparison warehouse breakdown.
      const wh = String(r["kho_giao"] || r["warehouse_giao"] || "Unknown").trim();
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

    const whLay = String(r["kho_lay"] || r["warehouse_lay"] || "").trim();
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

    const outcome = getOntimeOutcome(r);
    if (outcome === "ontime") {
      pDetail.ontimeCount++;
      pDetail.evalCount++;
      cDetail.ontime++;
      cDetail.evalCount++;
    } else if (outcome === "late") {
      pDetail.lateCount++;
      pDetail.evalCount++;
      cDetail.late++;
      cDetail.evalCount++;
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

  const detailedDamageCases = filteredDamage.map((r) => ({
    order_code:      r["order_code"] || "",
    client_name:     r["client_name"] || "",
    to_province:     r["to_province_name"] || "",
    warehouse_giao:  r["warehouse_giao"] || "",
    damage_type:     normalizeDamageType(r["damage_type"]),
    damage_details:  r["damage_details"] || "",
    offence_place:   r["offence_place"] || "",
    handling:        getCompensationStatusDmg(r),
    amount:          parseFloat(r["so_tien_ket_luan"]) || 0,
  }));

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

    const psOutcome = getOntimeOutcome(r);
    if (psOutcome === "ontime") {
      ps.ontimeCount++;
      ps.evalCount++;
    } else if (psOutcome === "late") {
      ps.lateCount++;
      ps.evalCount++;
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
    // Respects the project filter (so a single-project view compares that
    // project against itself) but ignores the month filter — this is a
    // calendar-week "what changed recently" panel, not a filtered-by-month view.
    periodComparison: computePeriodComparison(rawRows.filter(passProject), periodWeeks),
  };
}

const PERIOD_BUFFER_DAYS = 2; // bỏ qua 2 ngày gần nhất — đơn quá mới chưa kịp có kết quả
const PERIOD_MIN_SAMPLE = 5;  // bỏ qua khách quá ít đơn, số liệu không đáng tin
const PERIOD_ONTIME_WARN_POINTS = 5;  // giảm >= 5 điểm ontime → cảnh báo
const PERIOD_ORDERS_WARN_PCT = 20;    // giảm >= 20% số đơn → cảnh báo

const daysInMonth = (year, monthIdx) => new Date(year, monthIdx + 1, 0).getDate();

// Chia tháng thành các khối liên tiếp `windowWeeks` tuần, neo theo ngày-trong-tháng
// (1-7, 8-14, 15-21, 22-cuối tháng với windowWeeks=1) — khối cuối cùng của tháng
// có thể ngắn hơn vì tháng không chia hết cho 7. Trả về khối chứa `refDate`.
function calendarBlockFor(refDate, windowWeeks) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const dim = daysInMonth(year, month);
  const blockSize = windowWeeks * 7;
  const dayOfMonth = refDate.getDate();
  const blockIndex = Math.floor((dayOfMonth - 1) / blockSize);
  const startDay = blockIndex * blockSize + 1;
  const endDay = Math.min(startDay + blockSize - 1, dim);
  return {
    year, month, blockIndex, startDay, endDay,
    start: new Date(year, month, startDay, 0, 0, 0, 0),
    end: new Date(year, month, endDay, 23, 59, 59, 999),
  };
}

// Cùng block (theo ngày-trong-tháng) nhưng lùi lại `delta` tháng — dùng để lấy
// "cùng kỳ tháng trước". Ngày cuối được kẹp lại nếu tháng đó ngắn hơn.
function shiftBlockMonths(block, delta) {
  let y = block.year;
  let m = block.month + delta;
  while (m < 0) { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  const dim = daysInMonth(y, m);
  const startDay = Math.min(block.startDay, dim);
  const endDay = Math.min(block.endDay, dim);
  return {
    year: y, month: m, blockIndex: block.blockIndex, startDay, endDay,
    start: new Date(y, m, startDay, 0, 0, 0, 0),
    end: new Date(y, m, endDay, 23, 59, 59, 999),
  };
}

// "Từ đầu tháng đến hôm nay (trừ buffer) vs cùng khoảng đó tháng trước" —
// chế độ mặc định khi không chọn khối tuần cụ thể. Trừ buffer NGÀY CUỐI ở cả
// 2 khoảng (không chỉ khoảng hiện tại) để tránh 1-2 ngày mới lấy hàng, chưa
// tới hạn giao, kéo % ontime tháng này lên ảo so với tháng trước đã "chín".
function computeMTDRange(today0) {
  const year = today0.getFullYear();
  const month = today0.getMonth();
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);

  const bufferCutoff = new Date(today0);
  bufferCutoff.setDate(bufferCutoff.getDate() - PERIOD_BUFFER_DAYS);
  bufferCutoff.setHours(23, 59, 59, 999);
  // Đầu tháng (ngày 1-2): buffer lùi qua tháng trước — kẹp lại về ngày 1,
  // coi như "chưa đủ dữ liệu MTD tháng này" thay vì cho ra khoảng âm.
  const curEnd = bufferCutoff < monthStart
    ? new Date(year, month, 1, 23, 59, 59, 999)
    : bufferCutoff;

  let py = year, pm = month - 1;
  if (pm < 0) { pm = 11; py -= 1; }
  const prevMonthStart = new Date(py, pm, 1, 0, 0, 0, 0);
  const prevEndDay = Math.min(curEnd.getDate(), daysInMonth(py, pm));
  const prevEnd = new Date(py, pm, prevEndDay, 23, 59, 59, 999);

  return { curStart: monthStart, curEnd, prevStart: prevMonthStart, prevEnd };
}

/**
 * So sánh cùng kỳ. Hai chế độ:
 *  - "mtd" (mặc định, không chọn khối tuần): đầu tháng này → hôm nay (trừ
 *    buffer) vs đầu tháng trước → cùng ngày đó tháng trước.
 *  - 1/2/3: khối ngày-trong-tháng (VD tuần 1 = 1-7 với windowWeeks=1) của
 *    tháng này vs cùng khối đó tháng trước.
 * Cả 2 chế độ đều tránh lỗi so cả tháng kiểu cũ: so cả tháng nghe hợp lý
 * nhưng lệch, vì tháng đang chạy chỉ có vài ngày dữ liệu (đa số đơn chưa
 * kịp bị đánh dấu trễ) trong khi tháng trước đã có cả tháng để "chín" — so
 * kiểu đó luôn ra tháng này "đẹp" hơn giả tạo. Chế độ khối-tuần còn tự lùi
 * về khối liền trước nếu khối chứa hôm nay chưa khép, để không bao giờ so
 * khối đang chạy dở với khối đã xong.
 */
export function computePeriodComparison(rawRows, periodMode = "mtd") {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const isBlockMode = [1, 2, 3].includes(periodMode);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let curStart, curEnd, prevStart, prevEnd, fmtRange;

  if (isBlockMode) {
    const weeks = periodMode;
    const bufferCutoff = new Date(today0);
    bufferCutoff.setDate(bufferCutoff.getDate() - PERIOD_BUFFER_DAYS);
    bufferCutoff.setHours(23, 59, 59, 999);

    let curBlock = calendarBlockFor(today0, weeks);
    // Khối chứa hôm nay chưa khép (end date còn sau buffer) → lùi về khối trước đó.
    while (curBlock.end > bufferCutoff) {
      const dayBefore = new Date(curBlock.start);
      dayBefore.setDate(dayBefore.getDate() - 1);
      curBlock = calendarBlockFor(dayBefore, weeks);
    }
    const prevBlock = shiftBlockMonths(curBlock, -1);
    curStart = curBlock.start; curEnd = curBlock.end;
    prevStart = prevBlock.start; prevEnd = prevBlock.end;
    fmtRange = (b) =>
      `Tuần ${b.blockIndex * weeks + 1}${weeks > 1 ? `-${b.blockIndex * weeks + weeks}` : ""} — ${String(b.startDay).padStart(2, "0")}-${String(b.endDay).padStart(2, "0")}/${String(b.month + 1).padStart(2, "0")}`;
    var curLabel = fmtRange(curBlock);
    var prevLabel = fmtRange(prevBlock);
  } else {
    const mtd = computeMTDRange(today0);
    curStart = mtd.curStart; curEnd = mtd.curEnd;
    prevStart = mtd.prevStart; prevEnd = mtd.prevEnd;
    const fmtDate = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    var curLabel = `${fmtDate(curStart)} - ${fmtDate(curEnd)}`;
    var prevLabel = `${fmtDate(prevStart)} - ${fmtDate(prevEnd)}`;
  }

  function statsFor(start, end, getValue, value) {
    const inRange = rows.filter((r) => {
      if (getValue && getValue(r) !== value) return false;
      const d = parseDate(r["pickup_time"]);
      return d && d >= start && d <= end;
    });
    const evalRows = inRange.filter((r) => getOntimeOutcome(r) !== null);
    const ontimeCount = evalRows.filter((r) => getOntimeOutcome(r) === "ontime").length;
    return {
      orders: inRange.length,
      evalCount: evalRows.length,
      ontimeCount,
      lateCount: evalRows.length - ontimeCount,
      ontimePct: evalRows.length > 0 ? Math.round((ontimeCount / evalRows.length) * 1000) / 10 : null,
    };
  }

  const getClient = (r) => String(r["client_name"] || "").trim();
  // The orders sheet's real warehouse column is "kho_giao" (Vietnamese) —
  // "warehouse_giao" is a separate, unrelated column that only exists on
  // the damage sheet. Fallback kept in case older rows use the other name.
  const getWarehouse = (r) => String(r["kho_giao"] || r["warehouse_giao"] || "").trim();

  // Breaks rows down by a dimension (client or warehouse) and flags
  // whoever swung the most — this is what actually answers "why did it
  // move", not just "it moved", so it stays useful even filtered to one
  // project (client breakdown collapses to 1 row then, but warehouse still
  // shows which warehouse is driving that project's change).
  function breakdownBy(getValue) {
    const names = [...new Set(rows.map(getValue).filter(Boolean))];
    return names
      .map((name) => {
        const cur = statsFor(curStart, curEnd, getValue, name);
        const prev = statsFor(prevStart, prevEnd, getValue, name);
        const ontimeDeltaPoints =
          cur.ontimePct != null && prev.ontimePct != null ? +(cur.ontimePct - prev.ontimePct).toFixed(1) : null;
        // prev.orders === 0 makes the % ratio undefined (chia cho 0), but
        // that's a real, well-defined signal — "mới phát sinh" — not a
        // "chưa có dữ liệu" case. Flag it separately so the UI can show
        // "🆕 Mới" instead of misleadingly rendering "—" (no comparison).
        const ordersIsNew = prev.orders === 0 && cur.orders > 0;
        const ordersDeltaPct = prev.orders > 0 ? Math.round(((cur.orders - prev.orders) / prev.orders) * 100) : null;
        return { name, cur, prev, ontimeDeltaPoints, ordersDeltaPct, ordersIsNew };
      })
      .filter((c) => c.cur.orders >= PERIOD_MIN_SAMPLE || c.prev.orders >= PERIOD_MIN_SAMPLE)
      .map((c) => ({
        ...c,
        warning:
          (c.ontimeDeltaPoints != null && c.ontimeDeltaPoints <= -PERIOD_ONTIME_WARN_POINTS) ||
          (c.ordersDeltaPct != null && c.ordersDeltaPct <= -PERIOD_ORDERS_WARN_PCT),
      }))
      .sort((a, b) => (a.ontimeDeltaPoints ?? 0) - (b.ontimeDeltaPoints ?? 0))
      .slice(0, 8);
  }

  const overallCur = statsFor(curStart, curEnd);
  const overallPrev = statsFor(prevStart, prevEnd);

  return {
    periodMode: isBlockMode ? periodMode : "mtd",
    currentRangeLabel: curLabel,
    previousRangeLabel: prevLabel,
    overall: {
      cur: overallCur,
      prev: overallPrev,
      ontimeDeltaPoints:
        overallCur.ontimePct != null && overallPrev.ontimePct != null
          ? +(overallCur.ontimePct - overallPrev.ontimePct).toFixed(1)
          : null,
      ordersDeltaPct:
        overallPrev.orders > 0 ? Math.round(((overallCur.orders - overallPrev.orders) / overallPrev.orders) * 100) : null,
      ordersIsNew: overallPrev.orders === 0 && overallCur.orders > 0,
    },
    clients: breakdownBy(getClient).map((c) => ({ client: c.name, ...c })),
    warehouses: breakdownBy(getWarehouse).map((c) => ({ warehouse: c.name, ...c })),
  };
}
