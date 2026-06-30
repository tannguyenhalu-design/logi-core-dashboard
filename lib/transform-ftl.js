/**
 * lib/transform-ftl.js
 * FTL data transformation logic — spec sections 3.5 → 3.8
 *
 * RULES (hard-coded, do NOT change without user approval):
 * 3.5 - Số chuyến: DISTINCT trip_code (excl. CANCELLED), date from PICKUP row
 * 3.6 - Khối lượng/Đơn: dedupe by order_number first, then SUM
 * 3.7 - Loại xe: normalize license_plate → join Master data xe → Trọng tải
 * 3.8 - Cảnh báo tỉnh: 7d vs 7d-prior, threshold >30% AND prior >= 2 trips
 */

/**
 * Parse date string to JS Date
 */
function parseDate(val) {
  if (!val) return null;
  if (typeof val === "number") {
    const excelEpoch = new Date(1899, 11, 30).getTime();
    return new Date(excelEpoch + val * 86400000);
  }
  // Handle common formats: "DD/MM/YYYY HH:mm", "YYYY-MM-DD HH:mm:ss", etc.
  const s = String(val).trim();
  // Try ISO first
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    d = new Date(`${dmyMatch[3]}-${dmyMatch[2].padStart(2,"0")}-${dmyMatch[1].padStart(2,"0")}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function getMonth(val) {
  const d = parseDate(val);
  return d ? d.getMonth() + 1 : null;
}

function getDateStr(val) {
  const d = parseDate(val);
  if (!d) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Normalize license plate: remove spaces, dashes, uppercase.
 * "51 A-12345" → "51A12345"
 */
function normalizePlate(plate) {
  if (!plate) return "";
  return String(plate).replace(/[\s\-\.]/g, "").toUpperCase().trim();
}

/**
 * Build Master data xe lookup: { normalizedPlate → { loai_xe, trong_tai } }
 */
function buildVehicleLookup(masterRows) {
  const lookup = {};
  masterRows.forEach((r) => {
    const plate = normalizePlate(r["Biển số"]);
    if (plate) {
      lookup[plate] = {
        loai_xe: String(r["Loại xe"] || "Không rõ").trim(),
        trong_tai: String(r["Trọng tải"] || "Không rõ").trim(),
      };
    }
  });
  return lookup;
}

/**
 * Spec 3.5: Build trip-level records from raw FTL rows.
 * - Exclude rows where trip_status = "CANCELLED"
 * - Deduplicate by trip_code
 * - Date = actual_departure_datetime from PICKUP row, fallback created_at
 * - Province = ship_to_province from DELIVERY rows of that trip
 * - Client = client_name from any row of the trip
 */
function buildTripRecords(rawFtlRows, vehicleLookup) {
  // Group rows by trip_code
  const byTrip = {};
  rawFtlRows.forEach((row) => {
    const tripStatus = String(row["trip_status"] || "").toUpperCase().trim();
    if (tripStatus === "CANCELLED") return;

    const tc = String(row["trip_code"] || "").trim();
    if (!tc) return;
    if (!byTrip[tc]) byTrip[tc] = [];
    byTrip[tc].push(row);
  });

  const trips = [];
  Object.entries(byTrip).forEach(([tripCode, rows]) => {
    // Find PICKUP row for date
    const pickupRows = rows.filter(
      (r) => String(r["stop_type"] || "").toUpperCase().trim() === "PICKUP"
    );
    const firstPickup = pickupRows[0] || rows[0];
    const dateVal =
      firstPickup["actual_departure_datetime"] || firstPickup["created_at"];
    const dateStr = getDateStr(dateVal);
    const month = getMonth(dateVal);

    // Find DELIVERY rows for province
    const deliveryRows = rows.filter(
      (r) => String(r["stop_type"] || "").toUpperCase().trim() === "DELIVERY"
    );
    const provinces = [
      ...new Set(
        deliveryRows
          .map((r) => String(r["ship_to_province"] || "").trim())
          .filter(Boolean)
      ),
    ];

    // Client
    const client = String(rows[0]["client_name"] || "Unknown").trim();

    // License plate → vehicle info
    const plate = normalizePlate(firstPickup["license_plate"]);
    const vehicleInfo = plate ? vehicleLookup[plate] || null : null;
    const loai_xe = vehicleInfo ? vehicleInfo.loai_xe : "Không rõ";
    const trong_tai = vehicleInfo ? vehicleInfo.trong_tai : "Không rõ";
    const plateReason = !plate
      ? "Thiếu license_plate ở dòng PICKUP"
      : !vehicleInfo
      ? "Xe không có trong Master data xe (có thể xe thuê ngoài)"
      : null;

    trips.push({
      trip_code: tripCode,
      client,
      date: dateStr,
      month,
      provinces,
      loai_xe,
      trong_tai,
      plate: plate || "Không có",
      plateReason,
      order_count: new Set(rows.map((r) => r["order_number"]).filter(Boolean)).size,
    });
  });

  return trips;
}

/**
 * Spec 3.6: Dedupe order_number for weight/volume SUM.
 * Only include non-CANCELLED trips' orders.
 */
function buildOrderSummary(rawFtlRows) {
  const cancelledTrips = new Set(
    rawFtlRows
      .filter(
        (r) => String(r["trip_status"] || "").toUpperCase().trim() === "CANCELLED"
      )
      .map((r) => r["trip_code"])
  );

  // Dedupe by order_number
  const orderSeen = new Map();
  rawFtlRows.forEach((row) => {
    const tc = String(row["trip_code"] || "").trim();
    if (cancelledTrips.has(tc)) return;
    const on = String(row["order_number"] || "").trim();
    if (!on || orderSeen.has(on)) return;
    orderSeen.set(on, {
      order_number: on,
      client: String(row["client_name"] || "Unknown").trim(),
      weight: parseFloat(row["total_weight_value"]) || 0,
      volume: parseFloat(row["total_volume_value"]) || 0,
      month: getMonth(row["created_at"]),
      province: String(row["ship_to_province"] || "").trim(),
    });
  });

  return Array.from(orderSeen.values());
}

/**
 * Spec 3.8: Province surge alert
 * Compare current 7 days vs prior 7 days per province.
 * Alert if: increase > 30% AND prior period has >= 2 trips.
 */
function buildProvinceAlerts(trips) {
  if (!trips.length) return [];

  // Find the most recent date in data
  const dates = trips.map((t) => t.date).filter(Boolean).sort();
  const maxDateStr = dates[dates.length - 1];
  if (!maxDateStr) return [];

  const maxDate = new Date(maxDateStr);
  const day6Ago = new Date(maxDate);
  day6Ago.setDate(maxDate.getDate() - 6);
  const day13Ago = new Date(maxDate);
  day13Ago.setDate(maxDate.getDate() - 13);
  const day7Ago = new Date(maxDate);
  day7Ago.setDate(maxDate.getDate() - 7);

  const inRange = (dateStr, from, to) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= from && d <= to;
  };

  // Count trips per province for each period
  const currentByProv = {};
  const priorByProv = {};
  const vehByProv = {};

  trips.forEach((t) => {
    const isCurrentPeriod = inRange(t.date, day6Ago, maxDate);
    const isPriorPeriod = inRange(t.date, day13Ago, day7Ago);

    t.provinces.forEach((prov) => {
      if (!prov) return;
      if (isCurrentPeriod) {
        currentByProv[prov] = (currentByProv[prov] || 0) + 1;
        if (!vehByProv[prov]) vehByProv[prov] = {};
        vehByProv[prov][t.trong_tai] =
          (vehByProv[prov][t.trong_tai] || 0) + 1;
      }
      if (isPriorPeriod) {
        priorByProv[prov] = (priorByProv[prov] || 0) + 1;
      }
    });
  });

  const alerts = [];
  Object.entries(currentByProv).forEach(([prov, curr]) => {
    const prior = priorByProv[prov] || 0;
    if (prior < 2) return; // avoid false alarm on small base
    const pct = ((curr - prior) / prior) * 100;
    if (pct <= 30) return;

    // Find dominant vehicle type
    const vehCounts = vehByProv[prov] || {};
    const dominantVeh = Object.entries(vehCounts).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] || "Không rõ";

    alerts.push({
      province: prov,
      currentTrips: curr,
      priorTrips: prior,
      growthPct: Math.round(pct),
      dominantVehicle: dominantVeh,
      message: `Tỉnh ${prov} tuần này tăng ${Math.round(pct)}% số chuyến, chủ yếu xe ${dominantVeh}`,
    });
  });

  return alerts.sort((a, b) => b.growthPct - a.growthPct);
}

/**
 * Main FTL transform function.
 * @param {object[]} rawFtlRows - rows from "Raw_FTL" sheet
 * @param {object[]} masterVehicleRows - rows from "Master data xe" sheet
 * @param {object} filters - { months: number[], projects: string[] }
 * @returns {object} aggregated FTL dashboard data
 */
export function transformFTL(rawFtlRows, masterVehicleRows, filters = {}) {
  const { months = null, projects = null } = filters;

  // Build vehicle lookup from Master data xe
  const vehicleLookup = buildVehicleLookup(masterVehicleRows);

  // Build trip-level records (spec 3.5)
  let trips = buildTripRecords(rawFtlRows, vehicleLookup);

  // Build order-level records (spec 3.6)
  let orders = buildOrderSummary(rawFtlRows);

  // Apply filters
  if (months && months.length > 0) {
    trips = trips.filter((t) => months.includes(t.month));
    orders = orders.filter((o) => months.includes(o.month));
  }
  if (projects && projects.length > 0) {
    trips = trips.filter((t) => projects.includes(t.client));
    orders = orders.filter((o) => projects.includes(o.client));
  }

  // ── KPI aggregation ──
  const totalTrips = trips.length;
  const totalOrders = orders.length;
  const totalWeight = orders.reduce((s, o) => s + o.weight, 0);
  const totalVolume = orders.reduce((s, o) => s + o.volume, 0);

  // Average trips per day
  const tripDates = new Set(trips.map((t) => t.date).filter(Boolean));
  const avgTripsPerDay =
    tripDates.size > 0 ? Math.round((totalTrips / tripDates.size) * 10) / 10 : 0;

  // Trips by month
  const tripsByMonth = {};
  trips.forEach((t) => {
    if (!t.month) return;
    tripsByMonth[t.month] = (tripsByMonth[t.month] || 0) + 1;
  });

  // Trips by day (for line chart)
  const tripsByDay = {};
  trips.forEach((t) => {
    if (!t.date) return;
    tripsByDay[t.date] = (tripsByDay[t.date] || 0) + 1;
  });

  // Trips by project
  const tripsByProject = {};
  trips.forEach((t) => {
    tripsByProject[t.client] = (tripsByProject[t.client] || 0) + 1;
  });

  // Weight by project
  const weightByProject = {};
  orders.forEach((o) => {
    weightByProject[o.client] = (weightByProject[o.client] || 0) + o.weight;
  });

  // Vehicle type distribution (spec 3.7)
  const vehicleTypeDist = {};
  trips.forEach((t) => {
    const key = t.trong_tai !== "Không rõ" ? t.trong_tai : "Không rõ";
    vehicleTypeDist[key] = (vehicleTypeDist[key] || 0) + 1;
  });

  // Province surge alerts (spec 3.8) — use ALL trips (unfiltered by month) for 7-day window
  const allTripsForAlert = buildTripRecords(rawFtlRows, vehicleLookup);
  const filteredForAlert = projects && projects.length > 0
    ? allTripsForAlert.filter((t) => projects.includes(t.client))
    : allTripsForAlert;
  const provinceAlerts = buildProvinceAlerts(filteredForAlert);

  // All unique projects from raw data
  const allProjects = [
    ...new Set(
      rawFtlRows
        .map((r) => String(r["client_name"] || "").trim())
        .filter(Boolean)
    ),
  ].sort();

  return {
    totalTrips,
    totalOrders,
    totalWeight: Math.round(totalWeight),
    totalVolume: Math.round(totalVolume * 100) / 100,
    avgTripsPerDay,
    tripsByMonth,
    tripsByDay,
    tripsByProject,
    weightByProject,
    vehicleTypeDist,
    provinceAlerts,
    allProjects,
  };
}
