/**
 * lib/kpi-sync.js
 * Receives scraped rows from the local CDP scraper (kpi_scraper.py) that
 * reads the B2B Intelligence portal (kpi-dashboard-portal.vercel.app) —
 * a separate internal sales-pipeline tool this app has no API access to.
 * Matches each row to a project by "Clinet ID" and updates its expected
 * revenue (Plan) + last month's actual (NSR) in one batched write.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID_PROJECTS || process.env.SHEET_ID_PROJECTS || process.env.GOOGLE_SHEET_ID || "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
const SHEET_NAME = "Data dự án";

export async function syncRevenueByClientId(records, actor) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:R200`,
  });
  const rows = resp.data.values || [];
  if (rows.length === 0) return { matched: 0, updated: [] };
  const headers = rows[0].map((h) => String(h || "").trim());

  const clientIdIdx = headers.indexOf("Clinet ID");
  const nameIdx = headers.indexOf("TÊN DỰ ÁN");
  const revIdx = headers.indexOf("Doanh Thu dự kiến");
  const lastMoIdx = headers.indexOf("Last Mo NSR");
  if (clientIdIdx === -1 || revIdx === -1) {
    throw new Error("Sheet missing Clinet ID / Doanh Thu dự kiến columns");
  }

  // RR/NSR (this month's actual/run-rate revenue) — self-heal the header
  // if this is the first sync run after adding this field.
  let rrIdx = headers.indexOf("RR/NSR");
  if (rrIdx === -1) {
    rrIdx = headers.length;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!${String.fromCharCode(65 + rrIdx)}1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [["RR/NSR"]] },
    });
  }

  // Index existing rows by Client ID for O(1) lookup.
  const byClientId = new Map();
  rows.forEach((row, i) => {
    if (i === 0) return;
    const id = String(row[clientIdIdx] || "").trim();
    if (id) byClientId.set(id, { rowNumber: i + 1, name: row[nameIdx] || "" });
  });

  const colLetter = (idx) => String.fromCharCode(65 + idx);
  const cellWrites = [];
  const updated = [];

  for (const r of records) {
    const clientId = String(r.clientId || "").trim();
    if (!clientId) continue;
    const match = byClientId.get(clientId);
    if (!match) continue;

    if (r.planRevenue !== undefined && r.planRevenue !== null) {
      cellWrites.push({ range: `'${SHEET_NAME}'!${colLetter(revIdx)}${match.rowNumber}`, values: [[r.planRevenue]] });
    }
    if (lastMoIdx !== -1 && r.lastMoNsr !== undefined && r.lastMoNsr !== null) {
      cellWrites.push({ range: `'${SHEET_NAME}'!${colLetter(lastMoIdx)}${match.rowNumber}`, values: [[r.lastMoNsr]] });
    }
    if (r.rrNsr !== undefined && r.rrNsr !== null) {
      cellWrites.push({ range: `'${SHEET_NAME}'!${colLetter(rrIdx)}${match.rowNumber}`, values: [[r.rrNsr]] });
    }
    updated.push({ clientId, name: match.name, planRevenue: r.planRevenue, lastMoNsr: r.lastMoNsr, rrNsr: r.rrNsr });
  }

  if (cellWrites.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: "USER_ENTERED", data: cellWrites },
    });
  }

  return { matched: updated.length, updated };
}
