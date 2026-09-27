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
// counted..truy_thu_status added 27/09: "counted" = the case is in Rillnet's
// "Báo cáo bể vỡ" list (CS tick 💰 · đơn cũ bù tay · đã chốt tiền) — the
// definition behind its "Bể vỡ / Hư hỏng" card; older rows captured from the
// previous layout include warehouse tickets that never became a case.
// compensated = the page's "Đơn đã chốt đền bù cho khách" rule.
const HEADERS = ["type", "source", "order_code", "client_name", "detected_at_warehouse", "suspected_leg", "region", "severity", "status", "order_status", "case_date", "photo_count", "synced_at",
  "counted", "compensated", "comp_amount", "truy_thu", "truy_thu_amount", "truy_thu_status"];
const LAST_COL = String.fromCharCode(64 + HEADERS.length); // "S"

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
      range: `'${SHEET_NAME}'!A1:${LAST_COL}1`,
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
// Rillnet's layout change (~16/09/2026, found 27/09) glued badges onto the
// order code ("GYYYFF7K16092026", "GYYYFF634nhlyhng") and, from ~22/09, the
// scraper read shifted columns as garbage rows (order_code = a warehouse
// name, the real code sitting in "source"). The scraper is fixed; this
// repairs rows already in the sheet on every sync, so they join their
// orders again (10 Điện Máy cases in 09/2026 were invisible because of it).
export function normalizeOrderCode(raw) {
  const code = String(raw || "").trim();
  const glued = code.match(/^([A-Z0-9-]{6,}?)(\d{2}(?:0[1-9]|1[0-2])20\d{2})(?:[0-9A-Za-z]*)$/);
  if (glued) return glued[1];
  if (/^GY[A-Z0-9]{6}.+/.test(code) && /[a-z]/.test(code)) return code.slice(0, 8);
  return code;
}

export function isGarbageDamageRow(r) {
  const type = String(r.type || "");
  const code = String(r.order_code || "");
  return /^▸\s*\n/.test(type) || /[💰📅]/u.test(String(r.source || "")) || /[a-z]/.test(code) || /→|^Tại kho/.test(String(r.client_name || ""));
}

// opts.fullScan: the scrape covered the whole data window, so a case missing
// from it is no longer in the report → counted = "". opts.flagsRead: the
// compensation/truy thu flags were read (otherwise keep the previous ones).
export async function syncDamageCauses(records, opts = {}) {
  const { fullScan = false, flagsRead = false } = opts;
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSheet(sheets, spreadsheetId);

  const existing = await fetchSheet(SHEET_NAME, spreadsheetId).catch(() => []);
  const now = new Date().toISOString();

  const merged = new Map();
  let repaired = 0, dropped = 0;
  existing.forEach((r) => {
    const raw = String(r["order_code"] || "").trim();
    const code = normalizeOrderCode(raw);
    if (code !== raw) { r = { ...r, order_code: code }; repaired++; }
    if (isGarbageDamageRow(r)) { dropped++; return; }
    if (fullScan) r = { ...r, counted: "" };
    if (code) merged.set(code, r);
  });
  records.forEach((r) => {
    const code = normalizeOrderCode(r.orderCode);
    if (!code) return;
    const prev = merged.get(code) || {};
    const flags = flagsRead
      ? {
          compensated: r.compensated ? "1" : "",
          comp_amount: r.compAmount === "" || r.compAmount == null ? "" : r.compAmount,
          truy_thu: r.truyThu || "",
          truy_thu_amount: r.truyThuAmount === "" || r.truyThuAmount == null ? "" : r.truyThuAmount,
          truy_thu_status: r.truyThuStatus || "",
        }
      : { compensated: prev.compensated ?? "", comp_amount: prev.comp_amount ?? "", truy_thu: prev.truy_thu ?? "", truy_thu_amount: prev.truy_thu_amount ?? "", truy_thu_status: prev.truy_thu_status ?? "" };
    merged.set(code, {
      type: r.type || "", source: r.source || "", order_code: code, client_name: r.clientName || "",
      detected_at_warehouse: r.detectedAtWarehouse || "", suspected_leg: r.suspectedLeg || "", region: r.region || "",
      severity: r.severity || "", status: r.status || "", order_status: r.orderStatus || "", case_date: r.caseDate || "",
      photo_count: r.photoCount ?? "", synced_at: now,
      counted: r.counted ? "1" : (prev.counted ?? ""),
      ...flags,
    });
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A1:${LAST_COL}1`,
    valueInputOption: "RAW",
    resource: { values: [HEADERS] },
  });
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A2:${LAST_COL}`,
  });

  const rows = [...merged.values()].map((r) => HEADERS.map((h) => r[h] ?? ""));

  if (rows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1`,
      // RAW, never USER_ENTERED: the sheet's US locale turned day<=12 dates
      // like "09/08/2026" (9 Aug) into 8 Sep — 14 cases swapped twice (27/09).
      valueInputOption: "RAW",
      resource: { values: rows },
    });
  }

  invalidateCache(`sheet:${spreadsheetId}:${SHEET_NAME}`);
  return { synced: records.length, totalAfterMerge: rows.length, repaired, dropped };
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
