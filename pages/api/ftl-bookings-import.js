/**
 * pages/api/ftl-bookings-import.js
 * POST { fileBase64, fileName, clientNameHint } — parses an uploaded Excel
 * file into staging booking rows for review (nothing is written to
 * FTLBookings here — see /api/ftl-bookings's bulk-POST for the actual save
 * once the CS/OPS reviewer confirms).
 *
 * Several paths, detected from the file's own sheet names/header row —
 * "deterministic" (real CBM/kg math, no AI) is tried in this order, falling
 * through to the next when a matching tab is found but empty/wrong-shaped:
 * 1. A "Data tổng hợp - ĐS" tab (LG Pantos / Hisense / Thợ Điện Máy Xanh's
 *    own GHN-processed summary — confirmed 2026-08-27 to be the same shape
 *    across all 3 clients) — groups by Load ID, sums each line's own
 *    already-computed Total CBM / Total số KG / Height, no SKU
 *    dimension-master lookup needed.
 * 2. A "BOOKING" tab (same 3 clients' raw booking tab, used when the
 *    "Data tổng hợp" tab exists but is an unfilled template) — same
 *    per-line columns, keyed by Mã đơn/Mã DO/Mã chuyến (whichever is
 *    present). Real files mix in placeholder rows with no CBM computed yet
 *    — only rows with a usable Total CBM are grouped; the rest are reported
 *    as skipped, not silently dropped.
 * 3. AQUA's real SAP delivery-export shape (DN No. / Material No. /
 *    SHIP-TO ADDRESS columns) — groups by DN No., joins each line's
 *    Material No. against FTLProductDimensions for real L/W/H/CBM, sums CBM
 *    + the exact volumetric-weight formula AQUA's own sheets already use
 *    (L*W*H/6,000,000), confirmed against AQUA's real files 2026-08-25.
 * All 3 suggest a vehicle via FTLVehicleSpecs (lib/ftl-vehicle-specs.js's
 * suggestVehicle) — real arithmetic against real reference data, no AI.
 * - "ai-parse": any other file shape — falls back to
 *   lib/ai-providers.js's generateWithFallback to extract whatever fields
 *   it can into the same target schema (no CBM math attempted, since the
 *   AI has no dimension master to work from). Clients with no known shape
 *   yet land here until a real sample file confirms one of the above.
 */
import * as XLSX from "xlsx";
import { getSession } from "../../lib/auth";
import { getAllProductDimensions } from "../../lib/ftl-product-dimensions";
import { getAllVehicleSpecs, suggestVehicle } from "../../lib/ftl-vehicle-specs";
import { generateWithFallback } from "../../lib/ai-providers";

// maxDuration matches pages/api/ai-chat.js's own AI-call budget (the
// AI-parse fallback path here makes the same kind of generateWithFallback
// call). sizeLimit covers someone accidentally uploading a whole AQUA
// workbook tab (thousands of rows) instead of just the input file.
export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: "15mb" } } };

function hasFTLAccess(session) {
  return session.user.role === "manager" || (session.user.tabs || []).includes("ftl");
}

function normHeader(h) {
  return String(h || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findCol(headers, ...needles) {
  return headers.findIndex((h) => needles.some((n) => normHeader(h).includes(n)));
}

// Some GHN-processed exports have several columns whose normalized header
// all contain the same substring (e.g. "Số điểm giao" / "Thứ tự điểm giao" /
// "Điểm giao" all contain "điểm giao") — findCol's substring match would
// silently grab the wrong one (whichever comes first). Use this instead when
// the target column name itself is a substring of other real columns:
// exact match first, only falling back to substring if nothing matched
// exactly (keeps this forgiving for minor header variants elsewhere).
function findExactCol(headers, ...names) {
  const exact = headers.findIndex((h) => names.includes(h));
  return exact !== -1 ? exact : findCol(headers, ...names);
}

// Distinguishes "no usable number" (blank, "#N/A", "-") from a real 0 —
// needed to tell "this row has no CBM computed yet" apart from "this row
// really is 0 CBM", since real sample files (Hisense/Thợ ĐMX "BOOKING" tabs,
// 2026-08-27) mix fully-computed rows with placeholder rows in the same
// sheet.
function numOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s || s.toUpperCase() === "#N/A" || s === "-") return null;
  const n = Number(s.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Real sample data confirmed dates render as "8/21/26" / "8/23/26" (M/D/YY)
// via xlsx's raw:false — handles M/D/YY and M/D/YYYY, returns null (not a
// guess) for anything else, e.g. the mixed-in non-date values seen in
// "Request Delivery Date" ("Giao 25/8 - KO GIAO HĐ", "16h-17h").
function parseUsDate(str) {
  const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let [, mo, d, y] = m;
  if (y.length === 2) y = `20${y}`;
  const mm = String(mo).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function isAquaShape(headers) {
  return findCol(headers, "dn no") !== -1 && findCol(headers, "material no") !== -1 && findCol(headers, "ship-to address") !== -1;
}

// "Data tổng hợp - ĐS" tab (dd/mm/yyyy) — real data confirmed 2026-08-27 in
// GHN x LG-Pantos, GHN x SF-HISENSE, and FTL- Thợ Điện Máy Xanh's own
// workbooks: all 3 clients export this exact same GHN-processed summary tab
// (same column names/order), already carrying per-line CBM/kg/height — no
// SKU dimension-master lookup needed here, unlike AQUA's raw SAP export.
function parseVnDate(str) {
  const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function findDataTongHopSheetName(wb) {
  return wb.SheetNames.find((n) => normHeader(n).includes("data tong hop") || normHeader(n).includes("data tổng hợp"));
}

async function parseDataTongHopDeterministic(grid, clientName) {
  const headerRowIdx = grid.findIndex((row) => row.some((c) => normHeader(c).includes("load id")));
  if (headerRowIdx === -1) return { groups: [], unmatchedRowCount: 0 };
  const headers = grid[headerRowIdx].map(normHeader);

  const col = {
    loadId: findCol(headers, "load id"),
    ngayLay: findCol(headers, "ngày lấy", "ngay lay"),
    ngayGiao: findCol(headers, "ngày giao", "ngay giao"),
    loaiXe: findExactCol(headers, "loại xe", "loai xe"),
    // "điểm giao" is also a substring of "số điểm giao" / "thứ tự điểm giao"
    // (both earlier columns in this shape) — must match exactly.
    diemGiao: findExactCol(headers, "điểm giao", "diem giao"),
    diaChi: findCol(headers, "địa chỉ giao", "dia chi giao"),
    height: findCol(headers, "height"),
    totalCbm: findCol(headers, "total cbm"),
    totalKg: findCol(headers, "total số kg", "total so kg"),
    tinhGiao: findCol(headers, "tỉnh giao", "tinh giao"),
  };
  if (col.loadId === -1 || col.totalCbm === -1) return { groups: [], unmatchedRowCount: 0 };

  const vehicleSpecs = await getAllVehicleSpecs();
  const dataRows = grid.slice(headerRowIdx + 1).filter((row) => row[col.loadId]);
  // Real sample confirmed (2026-08-27): some clients' workbooks carry this
  // tab as an unfilled template (header row only, every data row blank) —
  // treat that the same as "tab not present" so the caller falls through to
  // the next detection path instead of returning a bogus empty result.
  if (dataRows.length === 0) return { groups: [], unmatchedRowCount: 0 };
  // See parseBookingSheetDeterministic's identical guard: a single line's
  // Total CBM can't sanely exceed ~2x the biggest known vehicle's capacity.
  const maxSaneLineCbm = (vehicleSpecs[vehicleSpecs.length - 1]?.cbmCapacity || 100) * 2;
  const byLoad = new Map();
  dataRows.forEach((row) => {
    const loadId = String(row[col.loadId]).trim();
    if (!byLoad.has(loadId)) byLoad.set(loadId, []);
    byLoad.get(loadId).push(row);
  });

  const groups = [];
  for (const [loadId, rows] of byLoad) {
    const first = rows[0];
    const shipToName = col.diemGiao !== -1 ? String(first[col.diemGiao] || "").trim() : "";
    const deliveryAddress = col.diaChi !== -1 ? String(first[col.diaChi] || "").trim() : "";
    const deliveryDate = (col.ngayGiao !== -1 ? parseVnDate(first[col.ngayGiao]) : null) || "";
    const pickupDate = (col.ngayLay !== -1 ? parseVnDate(first[col.ngayLay]) : null) || "";
    const vehicleTypeKh = col.loaiXe !== -1 ? String(first[col.loaiXe] || "").trim() : "";
    const tinhGiao = col.tinhGiao !== -1 ? String(first[col.tinhGiao] || "").trim() : "";

    let totalCbm = 0, totalWeightKg = 0, maxItemHeightMm = 0, discardedOutlierRows = 0;
    rows.forEach((r) => {
      const lineCbm = col.totalCbm !== -1 ? num(r[col.totalCbm]) : 0;
      if (lineCbm > maxSaneLineCbm) { discardedOutlierRows++; return; }
      totalCbm += lineCbm;
      totalWeightKg += col.totalKg !== -1 ? num(r[col.totalKg]) : 0;
      const heightMm = col.height !== -1 ? num(r[col.height]) * 10 : 0; // cm -> mm
      if (heightMm > maxItemHeightMm) maxItemHeightMm = heightMm;
    });

    const suggestion = suggestVehicle(vehicleSpecs, { totalCbm, maxItemHeightMm, totalWeightKg });
    const notesParts = [];
    if (vehicleTypeKh) notesParts.push(`Xe KH chỉ định: ${vehicleTypeKh}`);
    if (tinhGiao) notesParts.push(`Tỉnh giao: ${tinhGiao}`);
    if (pickupDate && !deliveryDate) notesParts.push(`Ngày lấy: ${pickupDate}`);
    if (discardedOutlierRows > 0) notesParts.push(`⚠️ ${discardedOutlierRows} dòng có Total CBM bất thường (lỗi nhập liệu ở file gốc) — đã loại khỏi tổng, cần kiểm tra lại`);

    groups.push({
      dnNo: loadId,
      clientName,
      shipToName,
      deliveryAddress,
      deliveryDate: deliveryDate || pickupDate,
      totalQty: rows.length,
      totalCbm: round2(totalCbm),
      totalWeightKgEquiv: round2(totalWeightKg),
      maxItemHeightMm,
      suggestedVehicleType: suggestion.vehicleTypeClass,
      suggestedVehicleFits: suggestion.fits,
      missingDimensionSkus: [],
      specialNotes: notesParts.join(" · "),
    });
  }

  return { groups, unmatchedRowCount: dataRows.length - [...byLoad.values()].reduce((s, r) => s + r.length, 0) };
}

// "BOOKING" tab (Hisense / Thợ Điện Máy Xanh's own workbooks, 2026-08-27
// real samples) — same per-line CBM/kg/floor-area columns as "Data tổng hợp
// - ĐS" but keyed by an order/trip code instead of Load ID, and mixed in
// with many placeholder/blank rows (real files confirmed: only a fraction
// of rows have Total CBM actually computed) — so this only groups rows that
// have BOTH a usable group key AND a usable Total CBM, and reports the rest
// as skipped rather than guessing.
function findBookingSheetName(wb) {
  return wb.SheetNames.find((n) => normHeader(n) === "booking" || normHeader(n).includes("booking"));
}

async function parseBookingSheetDeterministic(grid, clientName) {
  const headerRowIdx = grid.findIndex((row) => row.some((c) => normHeader(c).includes("tên điểm giao")));
  if (headerRowIdx === -1) return { groups: [], skippedRowCount: 0 };
  const headers = grid[headerRowIdx].map(normHeader);

  // "Loại xe" appears twice in this shape (loại KH yêu cầu, rồi loại GHN
  // thực cấp) — findCol's findIndex naturally keeps the first (KH-requested)
  // occurrence, which is what we want here.
  const col = {
    key: ["mã đơn", "mã do", "mã chuyến"].map((n) => findExactCol(headers, n)).find((i) => i !== -1),
    keyName: ["mã đơn", "mã do", "mã chuyến"].find((n) => findExactCol(headers, n) !== -1),
    ngayLay: findCol(headers, "ngày lấy hàng", "ngay lay hang"),
    ngayGiao: findCol(headers, "ngày giao hàng", "ngay giao hang"),
    loaiXe: findCol(headers, "loại xe", "loai xe"),
    diemGiao: findExactCol(headers, "tên điểm giao", "ten diem giao"),
    diaChi: findCol(headers, "địa chỉ giao", "dia chi giao"),
    height: findCol(headers, "height"),
    totalCbm: findCol(headers, "total cbm"),
    totalKg: findCol(headers, "total số kg", "total so kg"),
    floorArea: findCol(headers, "diện tích sàn", "dien tich san"),
    tinhGiao: findCol(headers, "tỉnh giao", "tinh giao"),
  };
  if (col.key === undefined || col.totalCbm === -1) return { groups: [], skippedRowCount: 0 };

  const vehicleSpecs = await getAllVehicleSpecs();
  // Real data confirmed (2026-08-27): at least 1 row in Thợ ĐMX's own file
  // has a nonsensical Total CBM (46,025 — no possible single line item, let
  // alone one truck, is that large; CBM was "#N/A" on the same row) — a
  // manual-entry typo in the source sheet, not a parsing bug. Any single
  // line above 2x the biggest known vehicle's CBM capacity is physically
  // impossible for 1 line, so exclude it from the sum and flag the load
  // instead of silently producing a "vượt tải" result from garbage input.
  const maxSaneLineCbm = (vehicleSpecs[vehicleSpecs.length - 1]?.cbmCapacity || 100) * 2;
  const allDataRows = grid.slice(headerRowIdx + 1).filter((row) => row.some((c) => String(c || "").trim()));
  const usableRows = allDataRows.filter((row) => String(row[col.key] || "").trim() && numOrNull(row[col.totalCbm]) !== null);

  const byKey = new Map();
  usableRows.forEach((row) => {
    const key = String(row[col.key]).trim();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  });

  const groups = [];
  for (const [key, rows] of byKey) {
    const first = rows[0];
    const shipToName = col.diemGiao !== -1 ? String(first[col.diemGiao] || "").trim() : "";
    const deliveryAddress = col.diaChi !== -1 ? String(first[col.diaChi] || "").trim() : "";
    const deliveryDate = (col.ngayGiao !== -1 ? parseVnDate(first[col.ngayGiao]) : null) || "";
    const pickupDate = (col.ngayLay !== -1 ? parseVnDate(first[col.ngayLay]) : null) || "";
    const vehicleTypeKh = col.loaiXe !== -1 ? String(first[col.loaiXe] || "").trim() : "";
    const tinhGiao = col.tinhGiao !== -1 ? String(first[col.tinhGiao] || "").trim() : "";

    let totalCbm = 0, totalWeightKg = 0, maxItemHeightMm = 0, totalFloorArea = 0, discardedOutlierRows = 0;
    rows.forEach((r) => {
      const lineCbm = numOrNull(r[col.totalCbm]) || 0;
      if (lineCbm > maxSaneLineCbm) { discardedOutlierRows++; return; }
      totalCbm += lineCbm;
      totalWeightKg += col.totalKg !== -1 ? (numOrNull(r[col.totalKg]) || 0) : 0;
      totalFloorArea += col.floorArea !== -1 ? (numOrNull(r[col.floorArea]) || 0) : 0;
      const heightMm = col.height !== -1 ? (numOrNull(r[col.height]) || 0) * 10 : 0; // cm -> mm
      if (heightMm > maxItemHeightMm) maxItemHeightMm = heightMm;
    });

    const suggestion = suggestVehicle(vehicleSpecs, { totalCbm, maxItemHeightMm, totalWeightKg, totalFloorAreaM2: totalFloorArea });
    const notesParts = [];
    if (vehicleTypeKh) notesParts.push(`Xe KH chỉ định: ${vehicleTypeKh}`);
    if (tinhGiao) notesParts.push(`Tỉnh giao: ${tinhGiao}`);
    if (totalFloorArea > 0) notesParts.push(`Diện tích sàn: ${round2(totalFloorArea)} m²`);
    if (pickupDate && !deliveryDate) notesParts.push(`Ngày lấy: ${pickupDate}`);
    if (discardedOutlierRows > 0) notesParts.push(`⚠️ ${discardedOutlierRows} dòng có Total CBM bất thường (lỗi nhập liệu ở file gốc) — đã loại khỏi tổng, cần kiểm tra lại`);

    groups.push({
      dnNo: key,
      clientName,
      shipToName,
      deliveryAddress,
      deliveryDate: deliveryDate || pickupDate,
      totalQty: rows.length,
      totalCbm: round2(totalCbm),
      totalWeightKgEquiv: round2(totalWeightKg),
      maxItemHeightMm,
      suggestedVehicleType: suggestion.vehicleTypeClass,
      suggestedVehicleFits: suggestion.fits,
      missingDimensionSkus: [],
      specialNotes: notesParts.join(" · "),
    });
  }

  return { groups, skippedRowCount: allDataRows.length - usableRows.length };
}

async function parseAquaDeterministic(grid, clientName) {
  const headerRowIdx = grid.findIndex((row) => row.some((c) => normHeader(c).includes("dn no")));
  const headers = grid[headerRowIdx].map(normHeader);

  const col = {
    dnNo: findCol(headers, "dn no"),
    materialNo: findCol(headers, "material no"),
    soQty: findCol(headers, "so quantity"),
    confirmedQty: findCol(headers, "confirmed qty"),
    shipToName: findCol(headers, "ship-to name"),
    shipToAddress: findCol(headers, "ship-to address"),
    requestDeliveryDate: findCol(headers, "request delivery date"),
    dnDate: findCol(headers, "dn date"),
    storageLocation: findCol(headers, "storage location"),
    soldToTop: findCol(headers, "sold-to(top) name", "sold-to (top) name"),
  };

  const dims = await getAllProductDimensions(clientName);
  const dimByMaterial = new Map(dims.map((d) => [d.materialNo.trim().toLowerCase(), d]));
  const vehicleSpecs = await getAllVehicleSpecs();

  const dataRows = grid.slice(headerRowIdx + 1).filter((row) => row[col.dnNo]);
  const byDn = new Map();
  dataRows.forEach((row) => {
    const dn = String(row[col.dnNo]).trim();
    if (!byDn.has(dn)) byDn.set(dn, []);
    byDn.get(dn).push(row);
  });

  const groups = [];
  for (const [dn, rows] of byDn) {
    const first = rows[0];
    const shipToName = col.shipToName !== -1 ? String(first[col.shipToName] || "").trim() : "";
    const shipToAddress = col.shipToAddress !== -1 ? String(first[col.shipToAddress] || "").trim() : "";
    const rawRequestDate = col.requestDeliveryDate !== -1 ? String(first[col.requestDeliveryDate] || "").trim() : "";
    const deliveryDate = parseUsDate(rawRequestDate) || (col.dnDate !== -1 ? parseUsDate(first[col.dnDate]) : null) || "";
    const soldToTop = col.soldToTop !== -1 ? String(first[col.soldToTop] || "").trim() : "";
    const storageLoc = col.storageLocation !== -1 ? String(first[col.storageLocation] || "").trim() : "";

    // Real data confirmed (2026-08-25): SHIP-TO NAME/ADDRESS aren't always
    // identical across every line under 1 DN No. — flag rather than
    // silently trust the first row when that happens.
    const mixedShipTo = rows.some((r) => col.shipToAddress !== -1 && String(r[col.shipToAddress] || "").trim() !== shipToAddress && String(r[col.shipToAddress] || "").trim());

    let totalQty = 0, totalCbm = 0, totalWeightKg = 0, maxItemHeightMm = 0;
    const missingSkus = new Set();
    rows.forEach((r) => {
      const materialNo = col.materialNo !== -1 ? String(r[col.materialNo] || "").trim() : "";
      const qty = (col.soQty !== -1 ? num(r[col.soQty]) : 0) || (col.confirmedQty !== -1 ? num(r[col.confirmedQty]) : 0);
      totalQty += qty;
      const dim = dimByMaterial.get(materialNo.toLowerCase());
      if (dim && qty) {
        totalCbm += dim.cbm * qty;
        totalWeightKg += (dim.lengthMm * dim.widthMm * dim.heightMm / 6_000_000) * qty;
        if (dim.heightMm > maxItemHeightMm) maxItemHeightMm = dim.heightMm;
      } else if (materialNo) {
        missingSkus.add(materialNo);
      }
    });

    const suggestion = suggestVehicle(vehicleSpecs, { totalCbm, maxItemHeightMm, totalWeightKg });
    const notesParts = [];
    if (soldToTop) notesParts.push(`Khách con: ${soldToTop}`);
    if (storageLoc) notesParts.push(`Kho xuất: ${storageLoc}`);
    if (rawRequestDate && !deliveryDate) notesParts.push(`Ngày giao (gốc, chưa đọc được): ${rawRequestDate}`);
    if (mixedShipTo) notesParts.push(`⚠️ Có dòng khác điểm giao trong cùng DN ${dn} — kiểm tra lại`);

    groups.push({
      dnNo: dn,
      clientName,
      shipToName,
      deliveryAddress: shipToAddress,
      deliveryDate,
      totalQty,
      totalCbm: round2(totalCbm),
      totalWeightKgEquiv: round2(totalWeightKg),
      maxItemHeightMm,
      suggestedVehicleType: suggestion.vehicleTypeClass,
      suggestedVehicleFits: suggestion.fits,
      missingDimensionSkus: [...missingSkus],
      specialNotes: notesParts.join(" · "),
    });
  }

  return { groups, unmatchedRowCount: dataRows.length - [...byDn.values()].reduce((s, r) => s + r.length, 0) };
}

async function parseWithAI(grid, fileName, clientNameHint) {
  const CAP_ROWS = 300;
  const truncated = grid.length > CAP_ROWS + 1;
  const sampleGrid = grid.slice(0, CAP_ROWS + 1);
  const textBlock = sampleGrid.map((row) => row.map((c) => String(c ?? "").slice(0, 80)).join("\t")).join("\n");

  const systemPrompt = `Bạn là công cụ trích xuất dữ liệu booking vận tải FTL từ file Excel thô, định dạng tuỳ ý theo từng khách hàng.
Với mỗi booking/chuyến hàng thật sự trong dữ liệu, trả về 1 object với các trường:
- clientName: tên khách hàng (dùng "${clientNameHint || ""}" nếu file không nêu rõ)
- pickupDate, deliveryDate: định dạng YYYY-MM-DD nếu xác định được, để trống nếu không chắc
- pickupAddress, deliveryAddress: địa chỉ đầy đủ
- quantity: số lượng (số)
- weightKg: khối lượng kg nếu có (số)
- vehicleTypeRequested: loại xe nếu file có nêu (VD: "8T", "5T", "1.9T"), để trống nếu không có
- specialNotes: ghi chú/lưu ý khác gộp lại thành 1 chuỗi ngắn
Bỏ qua các dòng tiêu đề, dòng trống, dòng tổng hợp — chỉ lấy dòng dữ liệu thật.
Trả về CHỈ 1 JSON array hợp lệ, không có text nào khác, không markdown.`;

  const userPrompt = `Tên file: ${fileName}\n\nDữ liệu thô (tab-separated):\n${textBlock}`;

  let result;
  try {
    result = await generateWithFallback({ systemPrompt, userPrompt, temperature: 0.1 });
  } catch (err) {
    throw new Error("AI đọc file thất bại: " + err.message);
  }

  const tryParse = (text) => {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  };

  let rows = tryParse(result.text);
  if (!rows) {
    // 1 retry with a stricter instruction — messy AI output (extra prose,
    // truncated array) happens occasionally, not worth failing outright.
    const retry = await generateWithFallback({
      systemPrompt: systemPrompt + "\nQUAN TRỌNG: CHỈ trả về JSON array, không giải thích, không markdown code block.",
      userPrompt,
      temperature: 0,
    });
    rows = tryParse(retry.text);
  }
  if (!rows) throw new Error("Không đọc được dữ liệu từ file này — thử nhập tay booking này thay vì tải file.");

  return { rows, rowsInFile: grid.length - 1, truncated, aiProvider: result.provider };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!hasFTLAccess(session)) {
    return res.status(403).json({ error: "Bạn không có quyền xem Booking FTL" });
  }

  try {
    const { fileBase64, fileName, clientNameHint } = req.body || {};
    if (!fileBase64) return res.status(400).json({ error: "Missing fileBase64" });

    const buffer = Buffer.from(fileBase64, "base64");
    const wb = XLSX.read(buffer, { type: "buffer" });

    // Multi-tab client workbooks (LG Pantos, Hisense, Thợ Điện Máy Xanh) carry
    // pre-computed booking-summary tabs alongside many other tabs (Item
    // Master, Daily Report...) — must target the right tab by name, not just
    // "first sheet with >1 row" (every tab has rows). Try "Data tổng hợp -
    // ĐS" first (richest, confirmed fully populated for LG Pantos), then
    // "BOOKING" (confirmed partially populated for Hisense/Thợ ĐMX — real
    // files mix in placeholder rows, so that parser filters to usable ones).
    const dataTongHopSheetName = findDataTongHopSheetName(wb);
    const bookingSheetName = findBookingSheetName(wb);
    if (dataTongHopSheetName) {
      const dthGrid = XLSX.utils.sheet_to_json(wb.Sheets[dataTongHopSheetName], { header: 1, defval: "", raw: false });
      const { groups, unmatchedRowCount } = await parseDataTongHopDeterministic(dthGrid, clientNameHint || "");
      if (groups.length > 0) {
        return res.status(200).json({ ok: true, mode: "deterministic", groups, unmatchedRowCount, sheetName: dataTongHopSheetName });
      }
    }
    if (bookingSheetName) {
      const bookingGrid = XLSX.utils.sheet_to_json(wb.Sheets[bookingSheetName], { header: 1, defval: "", raw: false });
      const { groups, skippedRowCount } = await parseBookingSheetDeterministic(bookingGrid, clientNameHint || "");
      if (groups.length > 0) {
        return res.status(200).json({ ok: true, mode: "deterministic", groups, unmatchedRowCount: skippedRowCount, sheetName: bookingSheetName });
      }
    }
    // Neither tab present, or present but with no usable data (e.g. an
    // unfilled template, or a same-named tab with an unrelated shape like
    // AQUA's own internal "Booking"/"Booking MB" tracking tabs) — fall
    // through to the AQUA-shape check / AI-parse below.

    const sheetName = wb.SheetNames.find((n) => {
      const ws = wb.Sheets[n];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, range: 0 });
      return grid.length > 1;
    }) || wb.SheetNames[0];
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
    if (grid.length === 0) return res.status(400).json({ error: "File rỗng hoặc không đọc được." });

    const headerRow = grid.find((row) => row.some((c) => String(c || "").trim())) || [];

    if (isAquaShape(headerRow)) {
      const clientName = clientNameHint || "AQUA B2B";
      const { groups, unmatchedRowCount } = await parseAquaDeterministic(grid, clientName);
      return res.status(200).json({ ok: true, mode: "deterministic", groups, unmatchedRowCount, sheetName });
    }

    const parsed = await parseWithAI(grid, fileName || "file.xlsx", clientNameHint);
    return res.status(200).json({ ok: true, mode: "ai-parse", ...parsed, sheetName });
  } catch (err) {
    console.error("[/api/ftl-bookings-import] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
