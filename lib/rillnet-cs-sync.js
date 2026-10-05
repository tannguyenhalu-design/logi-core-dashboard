/**
 * lib/rillnet-cs-sync.js
 * Writes CS-confirmed damage cases (CS tick 💰) to "raw_damage_cs_tick" sheet.
 * These are Điện Máy orders where CS explicitly confirmed compensation in Rillnet,
 * sourced from _LB.bevo.rows (nganh_hang='DM' && cs_denbu=1) via CDP.
 *
 * Strategy: FULL REPLACE each run — dataset is ~150 rows, always fetched in full
 * from Rillnet's page cache. A missing row = CS un-ticked or resolved, not lost data.
 */
import { google } from "googleapis";
import { getAuth, invalidateCache } from "./sheets";

const SHEET_NAME = "raw_damage_cs_tick";
const HEADERS = [
  "order_code", "client_name", "incident_date", "warehouse", "route",
  "om", "zone", "severity", "cs_by", "cs_at", "cs_amount",
  "is_settled", "source", "synced_at",
];

const SEV_LABELS = { nang: "Nặng", trung_binh: "Vừa", nhe: "Nhẹ", chua_gan: "Chưa gán" };
const colLetter = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const LAST_COL = colLetter(HEADERS.length);

async function ensureSheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
  }
  // Always rewrite header row so column order stays in sync with HEADERS.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A1:${LAST_COL}1`,
    valueInputOption: "RAW",
    resource: { values: [HEADERS] },
  });
}

/**
 * records: [{orderCode, clientName, incidentDate, warehouse, route, om, zone,
 *            severity, csBy, csAt, csAmount, isSettled, source}, ...]
 * Full replace: clear data rows A2:, then append fresh rows.
 */
export async function syncCsTickCases(records) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const now = new Date().toISOString();

  await ensureSheet(sheets, spreadsheetId);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A2:${LAST_COL}`,
  });

  const rows = records.map((r) => [
    r.orderCode || "",
    r.clientName || "",
    r.incidentDate || "",
    r.warehouse || "",
    r.route || "",
    r.om || "",
    r.zone || "",
    SEV_LABELS[r.severity] || r.severity || "",
    r.csBy || "",
    r.csAt ? String(r.csAt).slice(0, 10) : "",
    r.csAmount !== "" && r.csAmount != null ? r.csAmount : "",
    r.isSettled || "0",
    r.source || "",
    now,
  ]);

  if (rows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1`,
      valueInputOption: "RAW",
      resource: { values: rows },
    });
  }

  invalidateCache(`sheet:${spreadsheetId}:${SHEET_NAME}`);
  return { synced: records.length };
}
