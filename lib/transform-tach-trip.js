/**
 * lib/transform-tach-trip.js
 * Tính toán dữ liệu cho tab Bản đồ & Tách chuyến từ sheet Raw (GSheet).
 *
 * Các cột dùng từ Raw:
 *   - to_province_name   : tỉnh giao
 *   - from_province_name : tỉnh lấy (xác định hub)
 *   - warehouse_lay      : kho xuất phát (hub)
 *   - warehouse_giao     : kho lastmile (Lens 2)
 *   - weight             : khối lượng (gram)
 *   - pickup_time        : ngày lấy hàng
 *   - client_name        : khách hàng
 *   - status             : chỉ tính delivered
 *
 * Loại trừ (đã chạy FTL riêng): Aqua B2B, LG Pantos
 */

const EXCLUDE_CLIENTS  = new Set(["Aqua B2B", "LG Pantos"]);
const THRESHOLD_FTL    = 1000000; // ≥1,000 kg/ngày (gram) → đủ tải FTL
const THRESHOLD_GOM    = 500000;  // ≥500 kg/ngày (gram) → nên gom
const MIN_ACTIVE_DAYS  = 20;      // ≥20/30 ngày active → Pilot FTL

const HUB_NAMES = {
  "Key Account Warehouse Ho Chi Minh": "Kho B2B Long An",
  "Key Account Warehouse Ha Noi":      "Kho B2B Hà Nội",
};
const DA_NANG_KW = ["Đà Nẵng", "Da Nang", "Liên Chiểu", "Lien Chieu", "DAN", "GXT Đà Nẵng"];

function parseDate(val) {
  if (!val) return null;
  if (typeof val === "number") {
    return new Date(new Date(1899, 11, 30).getTime() + val * 86400000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function getHub(warehouseLay) {
  if (!warehouseLay) return "Kho B2B Long An";
  const wl = String(warehouseLay).trim();
  if (HUB_NAMES[wl]) return HUB_NAMES[wl];
  for (const kw of DA_NANG_KW) if (wl.includes(kw)) return "Kho GXT Đà Nẵng (Liên Chiểu)";
  return "Kho B2B Long An";
}

/**
 * Tính thống kê lane live từ GSheet — thay thế lane-data.json tĩnh.
 * Mỗi lane = 1 cặp (kho lấy → kho giao), tính trong 30 ngày gần nhất.
 */
export function transformLaneData(rawRows, windowDays = 30) {
  const rows = rawRows.filter((r) => {
    const st = String(r["status"] || "").toLowerCase().trim();
    return st === "delivered" && !EXCLUDE_CLIENTS.has(r["client_name"]);
  });

  let maxDate = null;
  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (d && (!maxDate || d > maxDate)) maxDate = d;
  });
  if (!maxDate) return [];

  const cutoff = new Date(maxDate);
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));
  cutoff.setHours(0, 0, 0, 0);

  const laneMap = {};
  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (!d || d < cutoff) return;

    const pickWh  = String(r["warehouse_lay"]  || "").trim();
    const delivWh = String(r["warehouse_giao"] || "").trim();
    if (!pickWh || !delivWh) return;

    const key = `${pickWh}|||${delivWh}`;
    if (!laneMap[key]) {
      laneMap[key] = { pick_wh: pickWh, deliver_wh: delivWh, hub: getHub(pickWh),
                       totalW: 0, orders: 0, dayWeight: {}, clientWeight: {} };
    }
    const lane   = laneMap[key];
    const w      = parseFloat(r["weight"]) || 0;
    const dayKey = String(r["pickup_time"]).slice(0, 10);
    const client = String(r["client_name"] || "").trim();

    lane.totalW  += w;
    lane.orders  += 1;
    lane.dayWeight[dayKey]   = (lane.dayWeight[dayKey]   || 0) + w;
    lane.clientWeight[client] = (lane.clientWeight[client] || 0) + w;
  });

  const PRIO_ORDER = { "Pilot FTL thường xuyên": 0, "Lên lịch gom chuyến": 1, "Theo dõi ngày cao điểm": 2 };

  const lanes = Object.values(laneMap).map((lane) => {
    const dayWeights   = Object.values(lane.dayWeight);
    const days_active  = dayWeights.length;
    const kg30d        = Math.round(lane.totalW / 1000);          // gram → kg
    const avg_kg_day   = Math.round(kg30d / windowDays);
    const peak_kg_day  = Math.round(Math.max(...dayWeights, 0) / 1000);
    const days_ftl1000 = dayWeights.filter((w) => w >= THRESHOLD_FTL).length;
    const days_gom500  = dayWeights.filter((w) => w >= THRESHOLD_GOM && w < THRESHOLD_FTL).length;

    const topClients = Object.entries(lane.clientWeight)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([name, w]) => `${name} ${((w / lane.totalW) * 100).toFixed(0)}%`)
      .join("; ");

    let priority;
    if (avg_kg_day >= 1000 && days_active >= MIN_ACTIVE_DAYS) priority = "Pilot FTL thường xuyên";
    else if (avg_kg_day >= 500) priority = "Lên lịch gom chuyến";
    else priority = "Theo dõi ngày cao điểm";

    return { pick_wh: lane.pick_wh, deliver_wh: lane.deliver_wh, hub: lane.hub,
             kg30d, avg_kg_day, peak_kg_day, days_ftl1000, days_gom500, days_active,
             orders30d: lane.orders, top_clients: topClients, priority };
  });

  lanes.sort((a, b) => (PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]) || (b.kg30d - a.kg30d));
  return lanes;
}

/**
 * Main transform — dữ liệu bản đồ & 3 lenses.
 */
export function transformTachTrip(rawRows) {
  const laneData = transformLaneData(rawRows);

  const rows = rawRows.filter((r) => {
    const st = String(r["status"] || "").toLowerCase().trim();
    return st === "delivered" && !EXCLUDE_CLIENTS.has(r["client_name"]);
  });

  let maxDate = null, minDate = null;
  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (!d) return;
    if (!maxDate || d > maxDate) maxDate = d;
    if (!minDate || d < minDate) minDate = d;
  });
  if (!maxDate) return { ...buildEmptyResult(), laneData };

  const provinceSet  = new Set();
  const fpSet        = new Set();
  const clientSet    = new Set();
  const hubSet       = new Set();
  const warehouseSet = new Set();

  rows.forEach((r) => {
    provinceSet.add(String(r["to_province_name"]   || "").trim());
    fpSet.add(String(r["from_province_name"]        || "").trim());
    clientSet.add(String(r["client_name"]           || "").trim());
    hubSet.add(getHub(r["warehouse_lay"]));
    warehouseSet.add(String(r["warehouse_giao"]     || "").trim());
  });

  const provinces  = [...provinceSet].filter(Boolean);
  const fprovinces = [...fpSet].filter(Boolean);
  const clients    = [...clientSet].filter(Boolean);
  const hubs       = [...hubSet].filter(Boolean);
  const warehouses = [...warehouseSet].filter(Boolean);

  const pvIdx  = Object.fromEntries(provinces.map((p, i)  => [p, i]));
  const fpIdx  = Object.fromEntries(fprovinces.map((p, i) => [p, i]));
  const cIdx   = Object.fromEntries(clients.map((c, i)    => [c, i]));
  const hubIdx = Object.fromEntries(hubs.map((h, i)       => [h, i]));
  const whIdx  = Object.fromEntries(warehouses.map((w, i) => [w, i]));

  const dayArr = [], hubArr = [], pvArr = [], fpArr = [], cArr = [], whArr = [], wArr = [];

  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (!d) return;
    const pv  = String(r["to_province_name"]  || "").trim();
    const fp  = String(r["from_province_name"] || "").trim();
    const cl  = String(r["client_name"]        || "").trim();
    const hub = getHub(r["warehouse_lay"]);
    const wh  = String(r["warehouse_giao"]     || "").trim();
    const w   = parseFloat(r["weight"])        || 0;
    if (!pv || pvIdx[pv] === undefined) return;

    dayArr.push(Math.round((d - minDate) / 86400000));
    hubArr.push(hubIdx[hub] ?? 0);
    pvArr.push(pvIdx[pv]);
    fpArr.push(fpIdx[fp] ?? 0);
    cArr.push(cIdx[cl] ?? 0);
    whArr.push(whIdx[wh] ?? 0);
    wArr.push(w);
  });

  return {
    epoch: minDate.toISOString().split("T")[0],
    hubs, provinces, fprovinces, clients, warehouses,
    laneData, // Tầng 1 — live từ GSheet
    rows: { day: dayArr, hub: hubArr, pv: pvArr, fp: fpArr, c: cArr, wh: whArr, w: wArr },
  };
}

function buildEmptyResult() {
  return {
    epoch: new Date().toISOString().split("T")[0],
    hubs: [], provinces: [], fprovinces: [], clients: [], warehouses: [],
    laneData: [],
    rows: { day: [], hub: [], pv: [], fp: [], c: [], wh: [], w: [] },
  };
}
