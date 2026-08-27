/**
 * lib/ftl-cost-sync.js
 * Writes "Chi phí phát sinh" (incidental cost) rows scraped from
 * portal.ghn.vn/b2b/ftl-cost/incidental-costs into "raw_ftl_costs" —
 * cloud-scraper/ftl_cost_scraper.py reads this page (filtered to "Phí bốc
 * xếp") and posts here. Same merge-not-replace approach as
 * lib/rillnet-sync.js — the scraper only walks a bounded recent window
 * (see ftl_cost_scraper.py's LOOKBACK_DAYS), so a full-replace would erase
 * older rows still sitting outside that window on every run.
 *
 * No single "cost id" is exposed by the portal UI — one Mã chuyến (trip)
 * can carry several distinct cost rows (e.g. 2 different delivery stops,
 * each its own amount). Dedup key is trip_code+point_type+amount_recorded+
 * driver_id, which is what actually identifies one line item on the page;
 * re-scraping the same row (e.g. after it moves Chờ duyệt -> Đã duyệt)
 * naturally overwrites in place instead of duplicating.
 */
import { google } from "googleapis";
import { getAuth, invalidateCache, fetchSheet } from "./sheets";

const SHEET_NAME = "raw_ftl_costs";
const HEADERS = [
  "trip_code", "client_name", "point_type", "address", "status", "cost_type",
  "payer", "driver_id", "driver_name", "amount_recorded", "note",
  "amount_approved", "payer_approved", "reason", "warehouse", "synced_at",
];

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
      range: `'${SHEET_NAME}'!A1:P1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

function keyOf(r) {
  return [r.tripCode, r.pointType, r.amountRecorded, r.driverId].join("|||");
}

// records: [{tripCode, clientName, pointType, address, status, costType,
//   payer, driverId, driverName, amountRecorded, note, amountApproved,
//   payerApproved, reason, warehouse}, ...]
export async function syncFTLCosts(records) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSheet(sheets, spreadsheetId);

  const existing = await fetchSheet(SHEET_NAME, spreadsheetId).catch(() => []);
  const now = new Date().toISOString();

  const merged = new Map();
  existing.forEach((r) => {
    const key = keyOf({ tripCode: r["trip_code"], pointType: r["point_type"], amountRecorded: r["amount_recorded"], driverId: r["driver_id"] });
    if (r["trip_code"]) merged.set(key, r);
  });
  records.forEach((r) => {
    const tripCode = String(r.tripCode || "").trim();
    if (!tripCode) return;
    const key = keyOf(r);
    merged.set(key, {
      trip_code: tripCode, client_name: r.clientName || "", point_type: r.pointType || "",
      address: r.address || "", status: r.status || "", cost_type: r.costType || "",
      payer: r.payer || "", driver_id: r.driverId || "", driver_name: r.driverName || "",
      amount_recorded: r.amountRecorded ?? "", note: r.note || "",
      amount_approved: r.amountApproved ?? "", payer_approved: r.payerApproved || "",
      reason: r.reason || "", warehouse: r.warehouse || "", synced_at: now,
    });
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A2:P`,
  });

  const rows = [...merged.values()].map((r) => HEADERS.map((h) => r[h] ?? ""));

  if (rows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: rows },
    });
  }

  invalidateCache(`sheet:${spreadsheetId}:${SHEET_NAME}`);
  return { synced: records.length, totalAfterMerge: rows.length };
}
