/**
 * lib/backup.js
 * Daily snapshot of the critical sheets (Data dự án, Users, Tasks) as a
 * JSON blob appended to a "Backups" tab in the same spreadsheet.
 *
 * This was originally going to be a full Drive-level file copy
 * (files.copy), which would also survive the whole spreadsheet being
 * deleted — but a bare service account (no Google Workspace) has
 * effectively zero personal Drive storage quota and can't own a copied
 * file. That's a real gap this doesn't close: a from-scratch loss of the
 * spreadsheet itself is NOT covered. What it does cover is the actually-
 * observed failure mode on this project — a bad script or edit silently
 * overwriting a row (the PSD incident) — by keeping restorable
 * point-in-time snapshots of the row data itself.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID_PROJECTS || process.env.SHEET_ID_PROJECTS || process.env.GOOGLE_SHEET_ID || "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
const BACKUP_SHEET_NAME = "Backups";
const HEADERS = ["Timestamp", "SourceSheet", "RowCount", "Data"];
const SOURCE_SHEETS = ["Data dự án", "Users", "Tasks"];
const RETENTION_DAYS = 30;

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureBackupSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === BACKUP_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: BACKUP_SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${BACKUP_SHEET_NAME}'!A1:D1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

export async function backupProjectsSheet() {
  const sheets = await getSheetsClient();
  await ensureBackupSheet(sheets);

  const now = new Date().toISOString();
  const rows = [];
  for (const sourceName of SOURCE_SHEETS) {
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${sourceName}'!A1:Z5000`,
      });
      const values = resp.data.values || [];
      rows.push([now, sourceName, String(Math.max(values.length - 1, 0)), JSON.stringify(values)]);
    } catch (e) {
      console.error(`[backup] failed to read source sheet "${sourceName}":`, e.message);
    }
  }

  if (rows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${BACKUP_SHEET_NAME}'!A:D`,
      valueInputOption: "USER_ENTERED",
      resource: { values: rows },
    });
  }

  const deleted = await pruneOldBackups(sheets);
  return { snapshotted: rows.map((r) => r[1]), timestamp: now, deletedOldRows: deleted };
}

async function pruneOldBackups(sheets) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${BACKUP_SHEET_NAME}'!A1:A5000`,
  });
  const rows = resp.data.values || [];
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const staleRowIndexes = [];
  for (let i = 1; i < rows.length; i++) {
    const ts = Date.parse(rows[i][0] || "");
    if (!isNaN(ts) && ts < cutoff) staleRowIndexes.push(i);
  }
  if (staleRowIndexes.length === 0) return 0;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === BACKUP_SHEET_NAME).properties.sheetId;

  // Delete from bottom to top so earlier indexes stay valid as we go.
  const requests = staleRowIndexes
    .sort((a, b) => b - a)
    .map((idx) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 } } }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests },
  });
  return staleRowIndexes.length;
}
