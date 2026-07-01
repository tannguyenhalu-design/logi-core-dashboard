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
 * Các khách hàng loại trừ (đã chạy FTL riêng):
 *   - Aqua B2B, LG Pantos
 */

const EXCLUDE_CLIENTS = new Set(["Aqua B2B", "LG Pantos"]);

// Map kho lấy → hub category
const HUB_NAMES = {
  "Key Account Warehouse Ho Chi Minh": "Kho B2B Long An",
  "Key Account Warehouse Ha Noi": "Kho B2B Hà Nội",
};
// Các kho Đà Nẵng nhận dạng theo substring
const DA_NANG_KEYWORDS = ["Đà Nẵng", "Da Nang", "Liên Chiểu", "Lien Chieu", "DAN", "GXT Đà Nẵng"];

function parseDate(val) {
  if (!val) return null;
  if (typeof val === "number") {
    const excelEpoch = new Date(1899, 11, 30).getTime();
    return new Date(excelEpoch + val * 86400000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function getHubFromWarehouse(warehouseLay) {
  if (!warehouseLay) return "Kho B2B Long An"; // default
  const wl = String(warehouseLay).trim();
  if (HUB_NAMES[wl]) return HUB_NAMES[wl];
  for (const kw of DA_NANG_KEYWORDS) {
    if (wl.includes(kw)) return "Kho GXT Đà Nẵng (Liên Chiểu)";
  }
  return "Kho B2B Long An"; // default cho miền Nam
}

/**
 * Main transform function.
 * @param {object[]} rawRows - tất cả rows từ sheet Raw
 * @returns {object} tcData — cấu trúc tương thích với TabTachTrip component
 */
export function transformTachTrip(rawRows) {
  // 1. Lọc: chỉ delivered, loại FTL clients
  const rows = rawRows.filter((r) => {
    const status = String(r["status"] || "").toLowerCase().trim();
    if (status !== "delivered") return false;
    if (EXCLUDE_CLIENTS.has(r["client_name"])) return false;
    return true;
  });

  // 2. Tìm ngày mới nhất trong data
  let maxDate = null;
  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (d && (!maxDate || d > maxDate)) maxDate = d;
  });

  if (!maxDate) return buildEmptyResult();

  // Epoch: ngày đầu tiên trong data
  let minDate = maxDate;
  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (d && d < minDate) minDate = d;
  });

  // 3. Build lookup arrays (để dùng index thay vì string — tiết kiệm memory)
  const provinceSet = new Set();
  const fpSet = new Set();
  const clientSet = new Set();
  const hubSet = new Set();
  const warehouseSet = new Set();

  rows.forEach((r) => {
    provinceSet.add(String(r["to_province_name"] || "").trim());
    fpSet.add(String(r["from_province_name"] || "").trim());
    clientSet.add(String(r["client_name"] || "").trim());
    hubSet.add(getHubFromWarehouse(r["warehouse_lay"]));
    warehouseSet.add(String(r["warehouse_giao"] || "").trim());
  });

  const provinces = [...provinceSet].filter(Boolean);
  const fprovinces = [...fpSet].filter(Boolean);
  const clients = [...clientSet].filter(Boolean);
  const hubs = [...hubSet].filter(Boolean);
  const warehouses = [...warehouseSet].filter(Boolean);

  const pvIdx = Object.fromEntries(provinces.map((p, i) => [p, i]));
  const fpIdx = Object.fromEntries(fprovinces.map((p, i) => [p, i]));
  const cIdx = Object.fromEntries(clients.map((c, i) => [c, i]));
  const hubIdx = Object.fromEntries(hubs.map((h, i) => [h, i]));
  const whIdx = Object.fromEntries(warehouses.map((w, i) => [w, i]));

  // Epoch = minDate formatted as YYYY-MM-DD
  const epochStr = minDate.toISOString().split("T")[0];

  // 4. Build columnar row arrays
  const dayArr = [], hubArr = [], pvArr = [], fpArr = [], cArr = [], whArr = [], wArr = [];

  rows.forEach((r) => {
    const d = parseDate(r["pickup_time"]);
    if (!d) return;

    const dayOffset = Math.round((d - minDate) / 86400000);
    const pv = String(r["to_province_name"] || "").trim();
    const fp = String(r["from_province_name"] || "").trim();
    const cl = String(r["client_name"] || "").trim();
    const hub = getHubFromWarehouse(r["warehouse_lay"]);
    const wh = String(r["warehouse_giao"] || "").trim();
    const w = parseFloat(r["weight"]) || 0;

    if (!pv || pvIdx[pv] === undefined) return;

    dayArr.push(dayOffset);
    hubArr.push(hubIdx[hub] ?? 0);
    pvArr.push(pvIdx[pv]);
    fpArr.push(fpIdx[fp] ?? 0);
    cArr.push(cIdx[cl] ?? 0);
    whArr.push(whIdx[wh] ?? 0);
    wArr.push(w);
  });

  return {
    epoch: epochStr,
    hubs,
    provinces,
    fprovinces,
    clients,
    warehouses,
    rows: {
      day: dayArr,
      hub: hubArr,
      pv: pvArr,
      fp: fpArr,
      c: cArr,
      wh: whArr,
      w: wArr,
    },
  };
}

function buildEmptyResult() {
  return {
    epoch: new Date().toISOString().split("T")[0],
    hubs: [],
    provinces: [],
    fprovinces: [],
    clients: [],
    warehouses: [],
    rows: { day: [], hub: [], pv: [], fp: [], c: [], wh: [], w: [] },
  };
}
