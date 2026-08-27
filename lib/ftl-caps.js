/**
 * lib/ftl-caps.js
 * Manager-settable daily vehicle "cap" (target headcount) per (client,
 * pickup province, vehicle type), backed by an "ftl_vehicle_caps" tab in
 * the main spreadsheet. Some clients run a fixed daily fleet split by
 * pickup region — e.g. SF | AQUA B2B has a separate cap for its Đồng Nai
 * (miền Nam) pickups vs its Hưng Yên (miền Bắc) pickups — so PickupProvince
 * is part of the key, not just ClientName. An empty PickupProvince means
 * "applies regardless of province" (for single-region clients like Pantos).
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

const SHEET_NAME = "ftl_vehicle_caps";
const getSpreadsheetId = () => process.env.GOOGLE_SHEET_ID;
const HEADERS = ["ClientName", "PickupProvince", "VehicleType", "DailyCap", "UpdatedAt", "UpdatedBy"];

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!A1:F1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

function rowToCap(r) {
  return {
    clientName: r[0] || "",
    pickupProvince: r[1] || "",
    vehicleType: r[2] || "",
    dailyCap: Number(r[3]) || 0,
    updatedAt: r[4] || "",
    updatedBy: r[5] || "",
  };
}

export async function getAllCaps() {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:F1000`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).filter((r) => r[0] && r[2]).map(rowToCap);
}

// Upsert by (clientName, pickupProvince, vehicleType). dailyCap=0 (or
// falsy) deletes the row instead of storing a meaningless "cap 0".
export async function upsertCap({ clientName, pickupProvince, vehicleType, dailyCap }, actor) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:F1000`,
  });
  const rows = resp.data.values || [];
  const pickupProvinceNorm = (pickupProvince || "").trim();
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === clientName && (r[1] || "") === pickupProvinceNorm && r[2] === vehicleType);

  if (!dailyCap || Number(dailyCap) <= 0) {
    if (rowIdx === -1) return; // nothing to delete
    const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
    const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME).properties.sheetId;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      resource: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }] },
    });
    return;
  }

  const now = new Date().toISOString();
  const row = [clientName, pickupProvinceNorm, vehicleType, String(Number(dailyCap)), now, actor || ""];
  if (rowIdx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!A:F`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [row] },
    });
  } else {
    const rowNumber = rowIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!A${rowNumber}:F${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [row] },
    });
  }
}
