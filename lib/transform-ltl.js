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
 * Groups rows by one location field (groupField) and computes the same
 * shape as the LTL map's province breakdown — orders/weight per group,
 * ontime%, damage count, top clients, and a sub-breakdown by the other
 * location field (otherField). Originally this was written inline just
 * for "group by destination province, sub-breakdown by pickup point" —
 * factored out so the same logic can build the mirror image (group by
 * pickup point instead) without copy-pasting the whole aggregation.
 */
function buildLocationBreakdown(rowsSubset, damageSubset, groupField, otherField) {
  const map = {};
  const detailsMap = {};

  rowsSubset.forEach((r) => {
    const key = String(r[groupField] || "").trim();
    if (!key) return;

    if (!map[key]) map[key] = { orders: 0, weight: 0, clients: {} };
    const w = (parseFloat(r["weight"]) || 0) / 1000; // convert raw Grams -> KG
    map[key].orders++;
    map[key].weight += w;
    const cl = r["client_name"] || "Unknown";
    if (!map[key].clients[cl]) map[key].clients[cl] = { orders: 0, weight: 0 };
    map[key].clients[cl].orders++;
    map[key].clients[cl].weight += w;

    if (!detailsMap[key]) {
      detailsMap[key] = {
        name: key,
        totalOrders: 0,
        totalWeight: 0,
        ontimeCount: 0,
        lateCount: 0,
        evalCount: 0,
        origins: {},      // otherField value -> count
        warehouses: {},   // kho_lay -> count
        clients: {},      // client_name -> { orders, ontime, late, origins: {} }
      };
    }

    const detail = detailsMap[key];
    detail.totalOrders++;
    detail.totalWeight += w;

    const otherVal = String(r[otherField] || "").trim();
    if (otherVal) detail.origins[otherVal] = (detail.origins[otherVal] || 0) + 1;

    const whLay = String(r["kho_lay"] || r["warehouse_lay"] || "").trim();
    if (whLay) detail.warehouses[whLay] = (detail.warehouses[whLay] || 0) + 1;

    if (!detail.clients[cl]) {
      detail.clients[cl] = {
        name: cl,
        orders: 0,
        weight: 0,
        ontime: 0,
        late: 0,
        evalCount: 0,
        origins: {},
      };
    }
    const cDetail = detail.clients[cl];
    cDetail.orders++;
    cDetail.weight += w;
    if (otherVal) cDetail.origins[otherVal] = (cDetail.origins[otherVal] || 0) + 1;

    const outcome = getOntimeOutcome(r);
    if (outcome === "ontime") {
      detail.ontimeCount++;
      detail.evalCount++;
      cDetail.ontime++;
      cDetail.evalCount++;
    } else if (outcome === "late") {
      detail.lateCount++;
      detail.evalCount++;
      cDetail.late++;
      cDetail.evalCount++;
    }
  });

  // Track damage cases per group and per client
  (damageSubset || []).forEach((r) => {
    const key = String(r[groupField] || "").trim();
    const cl = String(r["client_name"] || "Khác").trim();
    if (!key) return;

    if (!detailsMap[key]) {
      detailsMap[key] = {
        name: key,
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
    const detail = detailsMap[key];
    detail.damageCount = (detail.damageCount || 0) + 1;

    if (!detail.clients[cl]) {
      detail.clients[cl] = {
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
    detail.clients[cl].damageCount = (detail.clients[cl].damageCount || 0) + 1;
  });

  // Calculate percentages and top "other field" values for each group
  Object.values(detailsMap).forEach((d) => {
    d.ontimePct = d.evalCount > 0 ? Math.round((d.ontimeCount / d.evalCount) * 100) : 100;
    d.totalWeight = Math.round(d.totalWeight || 0);

    d.topOrigins = Object.entries(d.origins)
      .map(([name, count]) => ({
        name,
        count,
        pct: d.totalOrders > 0 ? Math.round((count / d.totalOrders) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    d.clientDetails = Object.values(d.clients)
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

  const stats = Object.entries(map)
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
        details: detailsMap[name] || null,
      };
    })
    .sort((a, b) => b.orders - a.orders);

  return { stats, detailsMap };
}

/**
 * Main LTL transform function.
 * @param {object[]} rawRows - rows from "Raw" sheet
 * @param {object} filters - { months: number[], projects: string[] }
 * @param {object[]} rawDamage - raw damage rows
 * @returns {object} aggregated dashboard data
 */
export function transformLTL(rawRows, filters = {}, rawDamage = []) {
  const { months = null, projects = null, filterMode = "pickup", periodWeeks = "mtd", origin = null } = filters;

  // Project filter helper
  const passProject = (row) =>
    !projects || projects.length === 0 || projects.includes(row["client_name"]);

  // Pickup-point filter — applied on top of the project/month filters so
  // every panel (trend chart, "so sánh cùng kỳ", damage breakdown, map,
  // warehouse alerts, everything) stays in sync when the user picks a
  // specific "Điểm Lấy Hàng", not just the map panel re-filtering itself
  // locally client-side (which was the earlier, narrower version of this).
  const passOrigin = (row) =>
    !origin || String(row["from_province_name"] || "").trim() === origin;

  // Project/Month filter helpers for damage tab
  const passProjectDmg = (clientName) =>
    !projects || projects.length === 0 || projects.includes(clientName);
  const passOriginDmg = (fromProvince) =>
    !origin || String(fromProvince || "").trim() === origin;

  const passMonthDmg = (dateStr) => {
    if (!months || months.length === 0) return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return months.includes(d.getMonth() + 1);
  };

  // Unfiltered-by-origin damage subset feeds the "Điểm Lấy Hàng Chính"
  // picker (which must keep listing every pickup point even while one is
  // selected) — filteredDamage (origin-applied) feeds everything else.
  const filteredDamageForPicker = (rawDamage || []).filter((r) => {
    return passProjectDmg(r["client_name"]) && passMonthDmg(r["pickup_time"] || r["case_date"]);
  });
  const filteredDamage = filteredDamageForPicker.filter((r) => passOriginDmg(r["from_province_name"]));

  // ── Mode: lọc theo ngày giao (delivered_time) ──
  let rowsForOriginPicker;
  if (filterMode === "delivered") {
    rowsForOriginPicker = rawRows.filter((row) => {
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
    rowsForOriginPicker = rawRows.filter((row) => {
      if (months && months.length > 0) {
        const m = getMonth(row["pickup_time"]);
        if (!months.includes(m)) return false;
      }
      if (!passProject(row)) return false;
      return true;
    });
  }

  // Everything below uses `rows` — origin-scoped when a pickup point is
  // selected. `rowsForOriginPicker` (no origin filter) only feeds the
  // origin picker list itself, further down, so it keeps showing every
  // pickup point regardless of which one is currently selected.
  const rows = rowsForOriginPicker.filter(passOrigin);

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
  const { stats: provinceStats, detailsMap: provinceDetailsMap } =
    buildLocationBreakdown(rows, filteredDamage, "to_province_name", "from_province_name");

  // ── Pickup-point (origin) picker list — every pickup point with its own
  // order count/ontime%, always built from the NOT-origin-filtered row set
  // so the full list keeps showing (and stays clickable) regardless of
  // which one is currently selected. The actual filtering that makes every
  // other panel (trend chart, "so sánh cùng kỳ", damage, map, warehouse
  // alerts) sync together happens once already, at the top via `rows`/
  // `filteredDamage` — no per-origin recomputation needed here anymore.
  const { stats: originStats, detailsMap: originDetailsMap } =
    buildLocationBreakdown(rowsForOriginPicker, filteredDamageForPicker, "from_province_name", "to_province_name");

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
  filteredDamage.forEach((r) => {
    const prov = String(r["to_province_name"] || "Không rõ").trim();
    if (prov) {
      damageByProvince[prov] = (damageByProvince[prov] || 0) + 1;
    }
  });

  // Kho-level ranking lives solely in warehouseAlerts (Top 10 Kho Rủi Ro Cao)
  // now — this used to also feed a "Top 5 Kho giao hàng" list showing the
  // exact same ranking a second time, so that list (and this computation)
  // was dropped rather than kept as dead duplication.
  const topDamageProvinces = Object.entries(damageByProvince)
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
    detailedDamageCases,
    provinceStats,
    provinceDetailsMap,
    originStats,
    originDetailsMap,
    projectSummaries,
    routeStats,
    filteredRows: rows,
    // Respects the project + pickup-point filters (so a single-project or
    // single-origin view compares that scope against itself) but ignores
    // the month filter — this is a calendar-week "what changed recently"
    // panel, not a filtered-by-month view.
    // The 5-order minimum sample size exists to hide noisy comparisons in
    // the all-projects view, but once the user has already drilled into one
    // project or pickup point, that same threshold was hiding almost every
    // warehouse — drop it to 1 (any real activity) since the scope itself
    // is already the user's chosen filter, not noise.
    periodComparison: computePeriodComparison(
      rawRows.filter((r) => passProject(r) && passOrigin(r)),
      periodWeeks,
      (projects && projects.length === 1) || origin ? 1 : PERIOD_MIN_SAMPLE
    ),
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

  // No buffer here (unlike the weekly-block mode below) — curEnd is exact
  // day D. This is safe because ontime% is computed from evalCount, which
  // only counts orders with a confirmed delivered outcome (getOntimeOutcome
  // !== null); an order picked up today but still in transit simply isn't
  // counted yet, rather than needing the whole day excluded to avoid it.
  // Order/weight totals correctly include today's pickups as-is, and
  // prevEnd below always mirrors curEnd's day-of-month, so both sides cover
  // the same number of elapsed days — no distortion from comparing a
  // partial current month against a full previous one.
  const curEnd = new Date(year, month, today0.getDate(), 23, 59, 59, 999);

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
export function computePeriodComparison(rawRows, periodMode = "mtd", minSample = PERIOD_MIN_SAMPLE) {
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

  const getClient = (r) => String(r["client_name"] || "").trim();
  const getWarehouse = (r) => String(r["kho_giao"] || r["warehouse_giao"] || "").trim();

  const curAll = { orders: 0, evalCount: 0, ontimeCount: 0, weight: 0 };
  const prevAll = { orders: 0, evalCount: 0, ontimeCount: 0, weight: 0 };
  const curByClient = {};
  const prevByClient = {};
  const curByWarehouse = {};
  const prevByWarehouse = {};

  const initStats = () => ({ orders: 0, evalCount: 0, ontimeCount: 0, weight: 0 });

  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (!d) return;
    
    let isCur = false;
    let isPrev = false;
    if (d >= curStart && d <= curEnd) isCur = true;
    else if (d >= prevStart && d <= prevEnd) isPrev = true;
    
    if (!isCur && !isPrev) return;

    const outcome = getOntimeOutcome(r);
    const weightVal = (parseFloat(r["weight"]) || 0) / 1000;
    const client = getClient(r);
    const warehouse = getWarehouse(r);

    if (client) {
      if (isCur && !curByClient[client]) curByClient[client] = initStats();
      if (isPrev && !prevByClient[client]) prevByClient[client] = initStats();
    }
    if (warehouse) {
      if (isCur && !curByWarehouse[warehouse]) curByWarehouse[warehouse] = initStats();
      if (isPrev && !prevByWarehouse[warehouse]) prevByWarehouse[warehouse] = initStats();
    }

    if (isCur) {
      curAll.orders++;
      curAll.weight += weightVal;
      if (outcome !== null) {
        curAll.evalCount++;
        if (outcome === "ontime") curAll.ontimeCount++;
      }
      if (client) {
        curByClient[client].orders++;
        curByClient[client].weight += weightVal;
        if (outcome !== null) {
          curByClient[client].evalCount++;
          if (outcome === "ontime") curByClient[client].ontimeCount++;
        }
      }
      if (warehouse) {
        curByWarehouse[warehouse].orders++;
        curByWarehouse[warehouse].weight += weightVal;
        if (outcome !== null) {
          curByWarehouse[warehouse].evalCount++;
          if (outcome === "ontime") curByWarehouse[warehouse].ontimeCount++;
        }
      }
    } else {
      prevAll.orders++;
      prevAll.weight += weightVal;
      if (outcome !== null) {
        prevAll.evalCount++;
        if (outcome === "ontime") prevAll.ontimeCount++;
      }
      if (client) {
        prevByClient[client].orders++;
        prevByClient[client].weight += weightVal;
        if (outcome !== null) {
          prevByClient[client].evalCount++;
          if (outcome === "ontime") prevByClient[client].ontimeCount++;
        }
      }
      if (warehouse) {
        prevByWarehouse[warehouse].orders++;
        prevByWarehouse[warehouse].weight += weightVal;
        if (outcome !== null) {
          prevByWarehouse[warehouse].evalCount++;
          if (outcome === "ontime") prevByWarehouse[warehouse].ontimeCount++;
        }
      }
    }
  });

  const finalizeStats = (st) => ({
    orders: st.orders,
    evalCount: st.evalCount,
    ontimeCount: st.ontimeCount,
    lateCount: st.evalCount - st.ontimeCount,
    ontimePct: st.evalCount > 0 ? Math.round((st.ontimeCount / st.evalCount) * 1000) / 10 : null,
    weight: Math.round(st.weight * 10) / 10,
  });

  const overallCur = finalizeStats(curAll);
  const overallPrev = finalizeStats(prevAll);

  function pctDelta(cur, prev) {
    return {
      deltaPct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null,
      isNew: prev === 0 && cur > 0,
    };
  }

  function breakdownByFast(curMap, prevMap) {
    const names = [...new Set([...Object.keys(curMap), ...Object.keys(prevMap)])].filter(Boolean);
    return names
      .map((name) => {
        const cur = finalizeStats(curMap[name] || initStats());
        const prev = finalizeStats(prevMap[name] || initStats());
        const ontimeDeltaPoints = cur.ontimePct != null && prev.ontimePct != null ? +(cur.ontimePct - prev.ontimePct).toFixed(1) : null;
        const { deltaPct: ordersDeltaPct, isNew: ordersIsNew } = pctDelta(cur.orders, prev.orders);
        const { deltaPct: weightDeltaPct, isNew: weightIsNew } = pctDelta(cur.weight, prev.weight);
        return { name, cur, prev, ontimeDeltaPoints, ordersDeltaPct, ordersIsNew, weightDeltaPct, weightIsNew };
      })
      .filter((c) => c.cur.orders >= minSample || c.prev.orders >= minSample)
      .map((c) => ({
        ...c,
        warning: (c.ontimeDeltaPoints != null && c.ontimeDeltaPoints <= -PERIOD_ONTIME_WARN_POINTS) ||
                 (c.ordersDeltaPct != null && c.ordersDeltaPct <= -PERIOD_ORDERS_WARN_PCT),
      }))
      .sort((a, b) => (a.ontimeDeltaPoints ?? 0) - (b.ontimeDeltaPoints ?? 0))
      .slice(0, 12);
  }

  const overallOrders = pctDelta(overallCur.orders, overallPrev.orders);
  const overallWeight = pctDelta(overallCur.weight, overallPrev.weight);

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
      ordersDeltaPct: overallOrders.deltaPct,
      ordersIsNew: overallOrders.isNew,
      weightDeltaPct: overallWeight.deltaPct,
      weightIsNew: overallWeight.isNew,
    },
    clients: breakdownByFast(curByClient, prevByClient).map((c) => ({ client: c.name, ...c })),
    warehouses: breakdownByFast(curByWarehouse, prevByWarehouse).map((c) => ({ warehouse: c.name, ...c })),
  };
}
