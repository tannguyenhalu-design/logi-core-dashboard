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

// The tab only needs creating once — checking it on every call cost a full
// spreadsheets.get (~0.5–1s, 22 tabs) per read and per write (measured
// 28/09). Now: append / read directly and only create the tab when the
// Sheets API says the range doesn't exist.
const isMissingTab = (err) => /Unable to parse range/i.test(String(err?.message || ""));

// Reads of the whole log, cached briefly per instance; any write on this
// instance drops it so its own actions show up at once.
const READ_TTL_MS = 30 * 1000;
let readCache = null; // { at, rows }

async function readAllRows() {
  if (readCache && Date.now() - readCache.at < READ_TTL_MS) return readCache.rows;
  const sheets = await getSheetsClient();
  let rows;
  try {
    // Whole columns: the log is ~600 rows / 140 KB (28/09) — one read either
    // way; the old A1:E5000 would have dropped the newest rows past 5000.
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: getSpreadsheetId(), range: `'${SHEET_NAME}'!A:E` });
    rows = resp.data.values || [];
  } catch (err) {
    if (!isMissingTab(err)) throw err;
    rows = [];
  }
  readCache = { at: Date.now(), rows };
  return rows;
}

export async function logAction({ actor, action, target, details }) {
  try {
    const sheets = await getSheetsClient();
    const append = () => sheets.spreadsheets.values.append({
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
    try {
      await append();
    } catch (err) {
      if (!isMissingTab(err)) throw err;
      await ensureAuditLogSheet(sheets);
      await append();
    }
    readCache = null;
  } catch (err) {
    console.error("[audit-log] failed to record entry:", err.message);
  }
}

// Most recent timestamp for a given action (e.g. "kpi.sync") — used to
// surface "last synced X ago" / staleness warnings in the UI.
export async function getLastActionTime(action) {
  const rows = await readAllRows();
  let last = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] === action) last = rows[i][0];
  }
  return last;
}

export async function getAuditLog(limit = 300) {
  const rows = await readAllRows();
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
