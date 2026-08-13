/**
 * lib/damage-claims.js
 * Internal claims-workflow tracking layer for damage/broken cases, backed
 * by a "DamageClaims" tab in the LTL spreadsheet. Keyed by order_code.
 *
 * This does NOT touch the raw_ontime sheet's own case_status/qlrr_reason
 * columns (those are fed by another system) — it's a separate tracking
 * layer the app owns, so assignment/workflow state can be updated here
 * without racing whatever else writes to raw_ontime.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

// The LTL raw-data spreadsheet is read-only for the service account (it can
// fetch raw_ontime/raw_damage but not create sheets there), so this tracking
// tab lives in the Projects spreadsheet instead, where write access is
// already confirmed (AuditLog lives there too).
function getSpreadsheetId() {
  return process.env.GOOGLE_SHEET_ID_PROJECTS || process.env.SHEET_ID_PROJECTS || process.env.GOOGLE_SHEET_ID || "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
}

const SHEET_NAME = "DamageClaims";
const HEADERS = ["OrderCode", "Status", "Assignee", "Notes", "UpdatedAt", "UpdatedBy"];

export const CLAIM_STATUSES = ["Mới", "Đang xử lý", "Chờ đền bù", "Hoàn tất"];

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
      range: `'${SHEET_NAME}'!A1:F1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

export async function getAllClaims() {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:F5000`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return {};
  const byOrderCode = {};
  rows.slice(1).forEach((r) => {
    const orderCode = r[0] || "";
    if (!orderCode) return;
    byOrderCode[orderCode] = {
      orderCode,
      status: r[1] || "Mới",
      assignee: r[2] || "",
      notes: r[3] || "",
      updatedAt: r[4] || "",
      updatedBy: r[5] || "",
    };
  });
  return byOrderCode;
}

export async function upsertClaim({ orderCode, status, assignee, notes, actor }) {
  if (!orderCode) throw new Error("Missing orderCode");
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);

  const spreadsheetId = getSpreadsheetId();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A1:F5000`,
  });
  const rows = resp.data.values || [];
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === orderCode);
  const now = new Date().toISOString();
  const values = [orderCode, status || "Mới", assignee || "", notes || "", now, actor || ""];

  if (rowIdx !== -1) {
    const rowNumber = rowIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A${rowNumber}:F${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [values] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A:F`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [values] },
    });
  }

  return { orderCode, status: status || "Mới", assignee: assignee || "", notes: notes || "", updatedAt: now, updatedBy: actor || "" };
}
