/**
 * lib/ftl-vehicle-specs.js
 * GHN's own FTL fleet spec — shared across ALL clients (not per-client),
 * backed by "FTLVehicleSpecs". Real numbers (interior L/W/H, payload, safe
 * CBM at 85% fill) confirmed against AQUA's internal "Kích thước xe" sheet
 * (2026-08-25) — this is what makes real vehicle-fit suggestion possible
 * instead of a vague "hàng cao — cần xác nhận" flag with no real math.
 * Kept refreshable (not hardcoded into app code) since GHN's fleet can
 * change — see pages/api/ftl-vehicle-specs.js's upload action.
 */
import { google } from "googleapis";
import { getAuth, invalidateCache, fetchSheet } from "./sheets";

const SHEET_NAME = "FTLVehicleSpecs";
const HEADERS = [
  "VehicleModel", "VehicleTypeClass", "InteriorLengthMm", "InteriorWidthMm", "InteriorHeightMm",
  "PayloadKg", "CbmCapacity", "SafeCbm85", "FloorAreaM2", "SafeFloorArea85", "UpdatedAt", "UpdatedBy",
];

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureSheet(sheets) {
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:L1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

export async function getAllVehicleSpecs() {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const rows = await fetchSheet(SHEET_NAME, getSpreadsheetId()).catch(() => []);
  return rows
    .filter((r) => r["VehicleModel"])
    .map((r) => ({
      vehicleModel: r["VehicleModel"] || "",
      vehicleTypeClass: r["VehicleTypeClass"] || "",
      interiorLengthMm: num(r["InteriorLengthMm"]),
      interiorWidthMm: num(r["InteriorWidthMm"]),
      interiorHeightMm: num(r["InteriorHeightMm"]),
      payloadKg: num(r["PayloadKg"]),
      cbmCapacity: num(r["CbmCapacity"]),
      safeCbm85: num(r["SafeCbm85"]),
      floorAreaM2: num(r["FloorAreaM2"]),
      safeFloorArea85: num(r["SafeFloorArea85"]),
    }))
    // Ascending by safe CBM — the vehicle-fit scan in
    // pages/api/ftl-bookings-import.js wants "smallest that still fits" first.
    .sort((a, b) => a.safeCbm85 - b.safeCbm85);
}

// records: [{vehicleModel, vehicleTypeClass, interiorLengthMm, interiorWidthMm,
//   interiorHeightMm, payloadKg, cbmCapacity, safeCbm85, floorAreaM2, safeFloorArea85}, ...]
// Full replace, not merge — this is a small (<20 row), hand-curated
// reference table re-uploaded whole each time GHN's fleet spec changes, not
// an accumulating log like FTLBookings.
export async function replaceVehicleSpecs(records, actor) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const spreadsheetId = getSpreadsheetId();
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAME}'!A2:L` });

  const rows = records.map((r) => [
    r.vehicleModel || "", r.vehicleTypeClass || "", r.interiorLengthMm ?? "", r.interiorWidthMm ?? "",
    r.interiorHeightMm ?? "", r.payloadKg ?? "", r.cbmCapacity ?? "", r.safeCbm85 ?? "",
    r.floorAreaM2 ?? "", r.safeFloorArea85 ?? "", now, actor || "",
  ]);
  if (rows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: rows },
    });
  }
  invalidateCache(`sheet:${spreadsheetId}:${SHEET_NAME}`);
  return { count: rows.length };
}

// Picks the smallest vehicle spec whose safe CBM/height/payload (and floor
// area, when the caller has it) all cover the given totals — the same
// real-number comparison AQUA's own ops team does by hand against their
// "Kích thước xe" sheet, just automated. A spec with no SafeFloorArea85 on
// file (0/blank) is treated as "no floor constraint recorded" rather than an
// automatic fail.
//
// totalFloorAreaM2 is always the worst-case, no-stacking footprint (L×W×qty
// summed flat) — confirmed against AQUA's real customer-facing output
// (2026-08-29): its own "Diện tích sàn" column never divides by "Số tầng"
// either. "Số tầng" is a reference note for GSVT to decide by hand whether
// stacking is safe when actually loading — it does NOT reduce the number
// this auto vượt-tải check compares against truck capacity (an earlier
// version of this function divided by a computed stack count; that was
// wrong and has been reverted).
export function suggestVehicle(specs, { totalCbm, maxItemHeightMm, totalWeightKg, totalFloorAreaM2 }) {
  // specs=[] means "FTLVehicleSpecs chưa được nạp dữ liệu" (a config gap),
  // not "booking này không xe nào chở nổi" — the two used to collapse into
  // the same fits:false, so an empty spec table silently painted every
  // booking red as if it were over capacity. Keep them distinguishable:
  // fits:null = "chưa xác định được" (no spec data to check against).
  if (specs.length === 0) return { vehicleModel: "", vehicleTypeClass: "", fits: null, floorAreaM2: totalFloorAreaM2 || 0 };
  const fits = specs.find((s) =>
    totalCbm <= s.safeCbm85 &&
    (maxItemHeightMm || 0) <= s.interiorHeightMm &&
    totalWeightKg <= s.payloadKg &&
    (!totalFloorAreaM2 || !s.safeFloorArea85 || totalFloorAreaM2 <= s.safeFloorArea85)
  );
  if (fits) return { vehicleModel: fits.vehicleModel, vehicleTypeClass: fits.vehicleTypeClass, fits: true, floorAreaM2: totalFloorAreaM2 || 0 };
  const largest = specs[specs.length - 1];
  return { vehicleModel: largest.vehicleModel, vehicleTypeClass: largest.vehicleTypeClass, fits: false, floorAreaM2: totalFloorAreaM2 || 0 };
}
