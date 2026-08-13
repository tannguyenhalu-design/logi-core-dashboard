/**
 * lib/audit-log.js
 * Append-only change history, backed by an "AuditLog" tab in the same
 * Google Sheet — who changed what, when. Never lets a logging failure
 * break the action being logged.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEET_ID_PROJECTS || process.env.SHEET_ID_PROJECTS || process.env.GOOGLE_SHEET_ID || "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
}

const SHEET_NAME = "AuditLog";
const HEADERS = ["Timestamp", "Actor", "Action", "Target", "Details"];

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureAuditLogSheet(sheets) {
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
      spreadsheetId: getSpreadsheetId(),
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

// Most recent timestamp for a given action (e.g. "kpi.sync") — used to
// surface "last synced X ago" / staleness warnings in the UI.
export async function getLastActionTime(action) {
  const sheets = await getSheetsClient();
  await ensureAuditLogSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:E5000`,
  });
  const rows = resp.data.values || [];
  let last = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] === action) last = rows[i][0];
  }
  return last;
}

export async function getAuditLog(limit = 300) {
  const sheets = await getSheetsClient();
  await ensureAuditLogSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
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
