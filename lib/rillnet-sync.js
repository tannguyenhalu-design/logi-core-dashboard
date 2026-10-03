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
// comp_amount_cs..suspected_route added 30/09 (Kế hoạch E · phiên 1), read
// from Rillnet "Đền bù / Truy thu" (truy_thu.phieu_ref) + the report row:
//   comp_amount         = LATEST customer compensation, compensated cases only
//                         (đã chốt > đền dự kiến sửa lại > số CS gõ lúc tick)
//   comp_amount_cs      = amount CS typed when ticking 💰 (cs_denbu_sotien)
//   comp_amount_du_kien = Rillnet's "đền dự kiến" (denDk: revised estimate,
//                         else the CS amount, else the paid amount) — every case
//   comp_amount_chot    = paid amount loaded via "💵 Chốt tiền" (den_chot)
//   comp_amount_source  = chot | du_kien | cs_tick (where comp_amount came from)
//   comp_amount_at      = when that number was entered/revised (ISO)
//   damage_level / damage_position = phieu_ref.hu_hong (bevo_taxonomy labels)
//   comp_reason         = why Ops (did not) compensate (phieu_ref.cndb)
//   truy_thu_reason     = why each warehouse pays truy thu (phan_bo_kho)
//   suspected_route     = Rillnet's warehouse route of the suspected leg
// comp_amount_first / comp_amount_edits / cs_tick added 03/10:
//   comp_amount_first   = first latest-amount this system ever saw for the case
//   comp_amount_edits   = how many times that amount changed between scrapes
//                         (Rillnet keeps no history of the number — tracked from here on)
//   cs_tick             = "1" when CS ticked 💰 (the set Rillnet's Tổng hợp cards total)
const HEADERS = ["type", "source", "order_code", "client_name", "detected_at_warehouse", "suspected_leg", "region", "severity", "status", "order_status", "case_date", "photo_count", "synced_at",
  "counted", "compensated", "comp_amount", "truy_thu", "truy_thu_amount", "truy_thu_status",
  "comp_amount_cs", "comp_amount_du_kien", "comp_amount_chot", "comp_amount_source", "comp_amount_at",
  "damage_level", "damage_position", "comp_reason", "truy_thu_reason", "suspected_route",
  "comp_amount_first", "comp_amount_edits", "cs_tick"];
const MONEY_FIELDS = {
  comp_amount: "compAmount", comp_amount_cs: "compAmountCs", comp_amount_du_kien: "compAmountDuKien",
  comp_amount_chot: "compAmountChot", comp_amount_source: "compAmountSource", comp_amount_at: "compAmountAt",
  damage_level: "damageLevel", damage_position: "damagePosition", comp_reason: "compReason", truy_thu_reason: "truyThuReason",
};
// 1-based column number → A1 letters (32 columns now, past "Z").
const colLetter = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const LAST_COL = colLetter(HEADERS.length); // "AF"

// Grid must be wide enough before writing past its last column.
async function ensureColumns(sheets, spreadsheetId, meta, title, n) {
  const s = meta.data.sheets.find((x) => x.properties.title === title);
  const have = s?.properties?.gridProperties?.columnCount || 0;
  if (s && have < n) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ appendDimension: { sheetId: s.properties.sheetId, dimension: "COLUMNS", length: n - have } }] },
    });
  }
}

async function ensureSheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (exists) await ensureColumns(sheets, spreadsheetId, meta, SHEET_NAME, HEADERS.length);
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
// opts.moneyRead: the "Đền bù / Truy thu" page was read too (MONEY_FIELDS);
// otherwise keep the previous amounts rather than wiping them.
export async function syncDamageCauses(records, opts = {}) {
  const { fullScan = false, flagsRead = false, moneyRead = false } = opts;
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
          truy_thu: r.truyThu || "",
          truy_thu_amount: r.truyThuAmount === "" || r.truyThuAmount == null ? "" : r.truyThuAmount,
          truy_thu_status: r.truyThuStatus || "",
        }
      : { compensated: prev.compensated ?? "", truy_thu: prev.truy_thu ?? "", truy_thu_amount: prev.truy_thu_amount ?? "", truy_thu_status: prev.truy_thu_status ?? "" };
    const money = {};
    for (const [col, key] of Object.entries(MONEY_FIELDS)) {
      money[col] = moneyRead ? (r[key] == null ? "" : r[key]) : (prev[col] ?? "");
    }
    // Extra details from the report row (since 30/09) — "" means not read this
    // run, keep what the sheet had.
    const keep = (v, col) => (v === "" || v == null ? (prev[col] ?? "") : v);
    // Amount edit tracking: Rillnet overwrites the number in place, so count the
    // changes we see between scrapes (comp_amount_first = first value seen).
    let first = prev.comp_amount_first ?? "", edits = Number(prev.comp_amount_edits) || 0;
    const nowAmt = money.comp_amount, oldAmt = prev.comp_amount;
    const has = (v) => v !== "" && v != null;
    if (moneyRead && has(nowAmt)) {
      if (!has(first)) first = has(oldAmt) ? oldAmt : nowAmt;
      if (has(oldAmt) && Number(oldAmt) !== Number(nowAmt)) edits++;
    }
    merged.set(code, {
      type: r.type || "", source: r.source || "", order_code: code, client_name: r.clientName || "",
      detected_at_warehouse: r.detectedAtWarehouse || "", suspected_leg: r.suspectedLeg || "", region: keep(r.region, "region"),
      severity: keep(r.severity, "severity"), status: r.status || "", order_status: r.orderStatus || "", case_date: r.caseDate || "",
      photo_count: keep(r.photoCount, "photo_count"), synced_at: now,
      counted: r.counted ? "1" : (prev.counted ?? ""),
      ...flags,
      ...money,
      suspected_route: keep(r.suspectedRoute, "suspected_route"),
      comp_amount_first: first, comp_amount_edits: edits || "",
      cs_tick: flagsRead ? (r.csTick ? "1" : "") : (prev.cs_tick ?? ""),
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
// Columns A–G kept in place; H.. added 30/09 (Kế hoạch E · phiên 1).
// A–F, H–J = cards of "Đền bù / Truy thu → 📊 Tổng hợp": every client, ALL
//   time, over the orders CS ticked 💰 (total_amount = "TỔNG ĐỀN DỰ KIẾN",
//   total_chot_amount = "TỔNG ĐỀN ĐÃ CHỐT"). Not limited to range_from..to.
// K–O = cards of "📦 Báo cáo bể vỡ" for range_from..range_to, every client
//   (scope "all"): Bể vỡ / Hư hỏng, Đơn đã chốt đền bù, "Truy thu dự tính theo
//   OM" (đơn đã chốt · tiền dự tính), Tỷ lệ bể vỡ.
const SUMMARY_FIELDS = [
  ["cs_tick_count", "csTickCount"], ["ops_unfinalized_count", "opsUnfinalizedCount"], ["ops_approved_count", "opsApprovedCount"],
  ["ops_rejected_count", "opsRejectedCount"], ["ops_clawback_count", "opsClawbackCount"], ["total_amount", "totalAmount"], ["synced_at", null],
  ["total_chot_amount", "totalChotAmount"], ["chot_count", "chotCount"], ["dk_from_chot_count", "dkFromChotCount"],
  ["case_count", "caseCount"], ["compensated_count", "compensatedCount"], ["truy_thu_count", "truyThuCount"],
  ["truy_thu_amount", "truyThuAmount"], ["damage_rate", "damageRate"],
  ["range_from", "rangeFrom"], ["range_to", "rangeTo"], ["scope", "scope"],
];
const SUMMARY_HEADERS = SUMMARY_FIELDS.map(([h]) => h);
const SUMMARY_LAST = colLetter(SUMMARY_HEADERS.length);

async function ensureSummarySheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SUMMARY_SHEET_NAME);
  if (exists) await ensureColumns(sheets, spreadsheetId, meta, SUMMARY_SHEET_NAME, SUMMARY_HEADERS.length);
  else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: SUMMARY_SHEET_NAME } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SUMMARY_SHEET_NAME}'!A1:${SUMMARY_LAST}1`,
    valueInputOption: "RAW",
    resource: { values: [SUMMARY_HEADERS] },
  });
}

// summary: {csTickCount, ..., totalAmount, totalChotAmount, ..., caseCount, ..., rangeFrom, rangeTo, scope}
// A field the scraper could not read (null) keeps the previous value.
export async function syncCompensationSummary(summary) {
  if (!summary) return { synced: false };
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSummarySheet(sheets, spreadsheetId);
  const prev = (await fetchSheet(SUMMARY_SHEET_NAME, spreadsheetId).catch(() => []))[0] || {};
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SUMMARY_SHEET_NAME}'!A2:${SUMMARY_LAST}`,
  });

  const now = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SUMMARY_SHEET_NAME}'!A1`,
    valueInputOption: "RAW",
    resource: {
      values: [SUMMARY_FIELDS.map(([h, k]) => (k === null ? now : summary[k] ?? prev[h] ?? ""))],
    },
  });

  invalidateCache(`sheet:${spreadsheetId}:${SUMMARY_SHEET_NAME}`);
  return { synced: true };
}
