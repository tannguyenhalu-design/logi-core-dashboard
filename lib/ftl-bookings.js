/**
 * lib/ftl-bookings.js
 * FTL booking intake tracker, backed by an "FTLBookings" tab. Replaces the
 * old process of CS copy-pasting/VLOOKUPing booking info scattered across
 * many per-client Zalo links into one combined sheet — everyone (CS, GSVT,
 * OPS, SD) now reads/writes the same rows here instead of juggling several
 * separate links.
 *
 * Schema extended 2026-08-25 after reading AQUA's real "Booking MN"/
 * "Booking MB" sheets — DnNumbers/TotalCbm/TotalWeightKgEquiv/
 * MaxItemHeightMm/SuggestedVehicleType come from the deterministic import
 * path in pages/api/ftl-bookings-import.js (real CBM/volumetric-weight
 * math against FTLProductDimensions + FTLVehicleSpecs, not AI guessing).
 * Plate/DriverName/DriverPhone mirror AQUA's own dispatch-stage columns.
 * RespondedBy/RespondedAt mirror AQUA's own "Check box - Ops phản hồi" /
 * "Thời điểm phản hồi" — their existing fix for "GSVT quên check" — set
 * once, the first time a booking's status leaves "Mới", so response time
 * (RespondedAt - CreatedAt) stays accurate even if the booking is edited
 * again later.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

const SHEET_NAME = "FTLBookings";
const HEADERS = [
  "ID", "ClientName", "PickupDate", "PickupAddress", "DeliveryDate", "DeliveryAddress",
  "Quantity", "WeightKg", "CargoHeightCm", "VehicleTypeRequested", "SpecialNotes",
  "Status", "Assignee", "LinkedOrderCode", "SourceLink",
  "CreatedBy", "CreatedAt", "UpdatedBy", "UpdatedAt",
  "DnNumbers", "TotalCbm", "TotalWeightKgEquiv", "MaxItemHeightMm", "SuggestedVehicleType",
  "Plate", "DriverName", "DriverPhone", "RespondedBy", "RespondedAt",
];
const LAST_COL = "AC"; // keep in sync with HEADERS.length (29)
const STATUS_COL_IDX = HEADERS.indexOf("Status"); // 11
const RESPONDED_BY_IDX = HEADERS.indexOf("RespondedBy");
const RESPONDED_AT_IDX = HEADERS.indexOf("RespondedAt");

// "Mới" = CS vừa nhập (hoặc import), chưa ai xác nhận loại xe. "Đã xác
// nhận xe" = GSVT/OPS đã chốt xe phù hợp. "Đã lên đơn GHN" = đã có
// LinkedOrderCode thật trên portal.ghn.vn. "Hoàn tất"/"Huỷ" là 2 trạng
// thái kết thúc.
export const BOOKING_STATUSES = ["Mới", "Đã xác nhận xe", "Đã lên đơn GHN", "Hoàn tất", "Huỷ"];

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
      range: `'${SHEET_NAME}'!A1:${LAST_COL}1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
    return;
  }
  // Migrate an existing sheet whose header row predates the 2026-08-25
  // schema extension (same "rewrite whole header row" approach as
  // lib/tasks.js — a partial header-only patch can misalign values.append's
  // table-width auto-detection).
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A1:${LAST_COL}1`,
  });
  const currentHeaders = (headerResp.data.values && headerResp.data.values[0]) || [];
  const headersMatch = HEADERS.every((h, i) => currentHeaders[i] === h);
  if (!headersMatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:${LAST_COL}1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

function rowToBooking(row) {
  const obj = {};
  HEADERS.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ""; });
  return {
    id: obj.ID,
    clientName: obj.ClientName,
    pickupDate: obj.PickupDate,
    pickupAddress: obj.PickupAddress,
    deliveryDate: obj.DeliveryDate,
    deliveryAddress: obj.DeliveryAddress,
    quantity: obj.Quantity,
    weightKg: obj.WeightKg,
    cargoHeightCm: obj.CargoHeightCm,
    vehicleTypeRequested: obj.VehicleTypeRequested,
    specialNotes: obj.SpecialNotes,
    status: obj.Status || "Mới",
    assignee: obj.Assignee,
    linkedOrderCode: obj.LinkedOrderCode,
    sourceLink: obj.SourceLink,
    createdBy: obj.CreatedBy,
    createdAt: obj.CreatedAt,
    updatedBy: obj.UpdatedBy,
    updatedAt: obj.UpdatedAt,
    dnNumbers: obj.DnNumbers,
    totalCbm: obj.TotalCbm,
    totalWeightKgEquiv: obj.TotalWeightKgEquiv,
    maxItemHeightMm: obj.MaxItemHeightMm,
    suggestedVehicleType: obj.SuggestedVehicleType,
    plate: obj.Plate,
    driverName: obj.DriverName,
    driverPhone: obj.DriverPhone,
    respondedBy: obj.RespondedBy,
    respondedAt: obj.RespondedAt,
  };
}

async function getRows(sheets) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:${LAST_COL}20000`,
  });
  const rows = resp.data.values || [];
  return rows.length < 2 ? [] : rows.slice(1);
}

export async function getAllBookings() {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const rows = await getRows(sheets);
  return rows.filter((r) => r[0]).map(rowToBooking);
}

function genId() {
  return `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// input may include the extended fields (dnNumbers, totalCbm,
// totalWeightKgEquiv, maxItemHeightMm, suggestedVehicleType) when created
// from the deterministic import path — plain manual/AI-parse entries just
// leave them blank.
export async function createBooking(input, actor) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const now = new Date().toISOString();
  const id = genId();
  const values = [
    id, input.clientName || "", input.pickupDate || "", input.pickupAddress || "",
    input.deliveryDate || "", input.deliveryAddress || "", input.quantity ?? "",
    input.weightKg ?? "", input.cargoHeightCm ?? "", input.vehicleTypeRequested || "",
    input.specialNotes || "", "Mới", input.assignee || "", "", input.sourceLink || "",
    actor || "", now, actor || "", now,
    input.dnNumbers || "", input.totalCbm ?? "", input.totalWeightKgEquiv ?? "",
    input.maxItemHeightMm ?? "", input.suggestedVehicleType || "",
    "", "", "", "", "",
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A:${LAST_COL}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [values] },
  });
  return rowToBooking(values);
}

// records: array of `input` shapes above — one append call for the whole
// batch (bulk-import from Excel), instead of N separate append calls.
export async function createBookingsBulk(records, actor) {
  if (!records.length) return [];
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const now = new Date().toISOString();
  const allValues = records.map((input) => [
    genId(), input.clientName || "", input.pickupDate || "", input.pickupAddress || "",
    input.deliveryDate || "", input.deliveryAddress || "", input.quantity ?? "",
    input.weightKg ?? "", input.cargoHeightCm ?? "", input.vehicleTypeRequested || "",
    input.specialNotes || "", "Mới", input.assignee || "", "", input.sourceLink || "",
    actor || "", now, actor || "", now,
    input.dnNumbers || "", input.totalCbm ?? "", input.totalWeightKgEquiv ?? "",
    input.maxItemHeightMm ?? "", input.suggestedVehicleType || "",
    "", "", "", "", "",
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A:${LAST_COL}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: allValues },
  });
  return allValues.map(rowToBooking);
}

async function findRowIndexById(sheets, id) {
  const rows = await getRows(sheets);
  return rows.findIndex((r) => r[0] === id);
}

export async function updateBookingStatus(id, status, actor) {
  if (!BOOKING_STATUSES.includes(status)) throw new Error("Trạng thái không hợp lệ");
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const rows = await getRows(sheets);
  const idx = rows.findIndex((r) => r[0] === id);
  if (idx === -1) throw new Error("Không tìm thấy booking này");
  const rowNumber = idx + 2;
  const now = new Date().toISOString();
  const existingRow = rows[idx];
  const wasNew = (existingRow[STATUS_COL_IDX] || "Mới") === "Mới";
  const alreadyResponded = !!existingRow[RESPONDED_AT_IDX];
  const firstResponse = wasNew && status !== "Mới" && !alreadyResponded;

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!L${rowNumber}`, // Status column
    valueInputOption: "USER_ENTERED",
    resource: { values: [[status]] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!R${rowNumber}:S${rowNumber}`, // UpdatedBy, UpdatedAt
    valueInputOption: "USER_ENTERED",
    resource: { values: [[actor || "", now]] },
  });
  if (firstResponse) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!AB${rowNumber}:AC${rowNumber}`, // RespondedBy, RespondedAt
      valueInputOption: "USER_ENTERED",
      resource: { values: [[actor || "", now]] },
    });
  }

  const updatedRow = [...existingRow];
  updatedRow[STATUS_COL_IDX] = status;
  updatedRow[17] = actor || "";
  updatedRow[18] = now;
  if (firstResponse) {
    updatedRow[RESPONDED_BY_IDX] = actor || "";
    updatedRow[RESPONDED_AT_IDX] = now;
  }
  return rowToBooking(updatedRow);
}

// Partial update of the editable booking fields (not Status — see
// updateBookingStatus — and not ID/CreatedBy/CreatedAt).
const EDITABLE_FIELD_TO_COL = {
  clientName: "B", pickupDate: "C", pickupAddress: "D", deliveryDate: "E",
  deliveryAddress: "F", quantity: "G", weightKg: "H", cargoHeightCm: "I",
  vehicleTypeRequested: "J", specialNotes: "K", assignee: "M", linkedOrderCode: "N",
  sourceLink: "O", plate: "Y", driverName: "Z", driverPhone: "AA",
};

export async function updateBookingDetails(id, fields, actor) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const idx = await findRowIndexById(sheets, id);
  if (idx === -1) throw new Error("Không tìm thấy booking này");
  const rowNumber = idx + 2;
  const now = new Date().toISOString();

  const updates = [];
  Object.entries(fields || {}).forEach(([key, value]) => {
    const col = EDITABLE_FIELD_TO_COL[key];
    if (!col) return;
    updates.push(
      sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `'${SHEET_NAME}'!${col}${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[value ?? ""]] },
      })
    );
  });
  updates.push(
    sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!R${rowNumber}:S${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[actor || "", now]] },
    })
  );
  await Promise.all(updates);

  const rows = await getRows(sheets);
  return rowToBooking(rows[idx] || []);
}

export async function deleteBooking(id) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const idx = await findRowIndexById(sheets, id);
  if (idx === -1) throw new Error("Không tìm thấy booking này");
  const rowNumber = idx + 2;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME)?.properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    resource: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }],
    },
  });
}
