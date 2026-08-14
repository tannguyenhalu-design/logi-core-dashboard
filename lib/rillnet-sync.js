/**
 * lib/rillnet-sync.js
 * Writes damage/breakage records scraped from Rillnet (rillnet-app.vercel.app,
 * GHN's internal per-order ops system) into the "raw_damage_causes" tab —
 * this is the per-order root-cause detail (which leg/warehouse a case was
 * first flagged at) that raw_damage doesn't carry.
 */
import { google } from "googleapis";
import { getAuth, invalidateCache } from "./sheets";

const SHEET_NAME = "raw_damage_causes";
const HEADERS = ["type", "source", "order_code", "client_name", "detected_at_warehouse", "suspected_leg", "region", "severity", "status", "order_status", "case_date", "photo_count", "synced_at"];

async function ensureSheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:M1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

// records: [{type, source, orderCode, clientName, detectedAtWarehouse,
//   suspectedLeg, region, severity, status, orderStatus, caseDate, photoCount}, ...]
// Full replace each sync — Rillnet's own report is already deduplicated and
// date-filtered by whatever range the scraper requested, so append-only
// would accumulate duplicates across runs.
export async function syncDamageCauses(records) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSheet(sheets, spreadsheetId);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A2:M`,
  });

  const now = new Date().toISOString();
  const rows = records.map((r) => [
    r.type || "", r.source || "", r.orderCode || "", r.clientName || "",
    r.detectedAtWarehouse || "", r.suspectedLeg || "", r.region || "",
    r.severity || "", r.status || "", r.orderStatus || "", r.caseDate || "",
    r.photoCount ?? "", now,
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
  return { synced: rows.length };
}
