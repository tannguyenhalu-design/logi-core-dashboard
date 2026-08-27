/**
 * lib/rillnet-sync.js
 * Writes damage/breakage records scraped from Rillnet (rillnet-app.vercel.app,
 * GHN's internal per-order ops system) into the "raw_damage_causes" tab —
 * this is the per-order root-cause detail (which leg/warehouse a case was
 * first flagged at) that raw_damage doesn't carry.
 */
import { google } from "googleapis";
import { getAuth, invalidateCache, fetchSheet } from "./sheets";

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
// Merge-by-order_code, NOT full replace. This used to clear + rewrite the
// whole sheet every sync on the assumption that Rillnet's report page
// always shows the complete, all-time case list — but rillnet_scraper.py
// never actually sets an explicit date/filter range, it just reads
// whatever the page happens to be showing (default filters, any filter
// state left over from a previous manual session, pagination limits...).
// Confirmed live 2026-08-22: total case count here (86) was suspiciously
// small and several known Rillnet cases for PSD/Aqua B2C/LG LTL were
// missing — a full-replace sync silently DELETES every case not present
// in whatever narrower set that particular run captured, with no way to
// recover them. This is the same class of incident that already happened
// once with raw_ontime (see isFromJuly2026's comment in dm-clients.js) —
// merging instead means a narrow/incomplete scrape run can no longer
// erase previously-captured cases, only add to or refresh them.
export async function syncDamageCauses(records) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSheet(sheets, spreadsheetId);

  const existing = await fetchSheet(SHEET_NAME, spreadsheetId).catch(() => []);
  const now = new Date().toISOString();

  const merged = new Map();
  existing.forEach((r) => {
    const code = String(r["order_code"] || "").trim();
    if (code) merged.set(code, r);
  });
  records.forEach((r) => {
    const code = String(r.orderCode || "").trim();
    if (!code) return;
    merged.set(code, {
      type: r.type || "", source: r.source || "", order_code: code, client_name: r.clientName || "",
      detected_at_warehouse: r.detectedAtWarehouse || "", suspected_leg: r.suspectedLeg || "", region: r.region || "",
      severity: r.severity || "", status: r.status || "", order_status: r.orderStatus || "", case_date: r.caseDate || "",
      photo_count: r.photoCount ?? "", synced_at: now,
    });
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A2:M`,
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

// ── Compensation summary (from Rillnet's "Đền bù / Truy thu" > "Tổng hợp"
// page — a different report than the breakage table above, this is the
// actual đền bù/truy thu tracking. Single-row, overwritten each sync (it's
// already a point-in-time aggregate, not a per-order log). ──
const SUMMARY_SHEET_NAME = "raw_compensation_summary";
const SUMMARY_HEADERS = [
  "cs_tick_count", "ops_unfinalized_count", "ops_approved_count",
  "ops_rejected_count", "ops_clawback_count", "total_amount", "synced_at",
];

async function ensureSummarySheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SUMMARY_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: SUMMARY_SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SUMMARY_SHEET_NAME}'!A1:G1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [SUMMARY_HEADERS] },
    });
  }
}

// summary: {csTickCount, opsUnfinalizedCount, opsApprovedCount, opsRejectedCount, opsClawbackCount, totalAmount}
export async function syncCompensationSummary(summary) {
  if (!summary) return { synced: false };
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSummarySheet(sheets, spreadsheetId);
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SUMMARY_SHEET_NAME}'!A2:G`,
  });

  const now = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SUMMARY_SHEET_NAME}'!A1`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[
        summary.csTickCount ?? "", summary.opsUnfinalizedCount ?? "",
        summary.opsApprovedCount ?? "", summary.opsRejectedCount ?? "",
        summary.opsClawbackCount ?? "", summary.totalAmount ?? "", now,
      ]],
    },
  });

  invalidateCache(`sheet:${spreadsheetId}:${SUMMARY_SHEET_NAME}`);
  return { synced: true };
}
