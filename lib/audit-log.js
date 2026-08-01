/**
 * lib/audit-log.js
 * Append-only change history, backed by an "AuditLog" tab in the same
 * Google Sheet — who changed what, when. Never lets a logging failure
 * break the action being logged.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

const SPREADSHEET_ID = "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
const SHEET_NAME = "AuditLog";
const HEADERS = ["Timestamp", "Actor", "Action", "Target", "Details"];

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureAuditLogSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1:E1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

export async function logAction({ actor, action, target, details }) {
  try {
    const sheets = await getSheetsClient();
    await ensureAuditLogSheet(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A:E`,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[
          new Date().toISOString(),
          actor || "",
          action || "",
          target || "",
          details ? JSON.stringify(details) : "",
        ]],
      },
    });
  } catch (err) {
    console.error("[audit-log] failed to record entry:", err.message);
  }
}

export async function getAuditLog(limit = 300) {
  const sheets = await getSheetsClient();
  await ensureAuditLogSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:E5000`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  return rows
    .slice(1)
    .map((r) => ({
      timestamp: r[0] || "",
      actor: r[1] || "",
      action: r[2] || "",
      target: r[3] || "",
      details: r[4] || "",
    }))
    .reverse()
    .slice(0, limit);
}
