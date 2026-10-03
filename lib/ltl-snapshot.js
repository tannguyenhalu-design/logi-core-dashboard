/**
 * lib/ltl-snapshot.js
 * Persistent precomputed LTL data in a PRIVATE Vercel Blob store
 * (logicore-ltl-snapshot), so a cold serverless instance reads ~1-2MB of
 * gzip instead of pulling ~170k raw_ontime rows from Google Sheets (10-20s).
 *
 * Rebuilt after each scraper sync (cloud-scraper/run_scrapers.sh →
 * /api/cron/build-snapshot), by the Vercel cron fallback, and by the
 * dashboard's "Đồng bộ Google Sheet" button (force=true).
 *
 * Two blobs:
 *  - BASE: raw_ontime rows already base-filtered (Điện Máy + từ 07/2026 +
 *    chỉ LTL, same predicate /api/data always used), trimmed to the columns
 *    the LTL transforms read, plus mapping / damage / compensation sheets
 *    and the Warehouses / WarehouseAlias tabs (map "Kho" layer, 29/09).
 *  - DEFAULT: the fully computed default dashboard body (no filters), so
 *    the first screen most people open needs no transform at all.
 */
import { gzipSync, gunzipSync } from "zlib";
import { put, get } from "@vercel/blob";
// Sheets (googleapis, ~1s to load) is only needed to rebuild — imported
// lazily so reading the snapshot on a cold start doesn't pay for it.
import { clearAllCache } from "./mem-cache";
import { isDMRow, isLTLRow, isFromJuly2026 } from "./dm-clients";
import { computeDashboard } from "./ltl-dashboard";
import { buildScope, findUnclassified } from "./client-industry";

const BASE_PATH = "snapshots/ltl-base.json.gz";
const DEFAULT_PATH = "snapshots/ltl-default.json.gz";
const REVALIDATE_MS = 60 * 1000;
const SNAPSHOT_VERSION = 1;

// Every raw_ontime column read by transform-ltl.js, transform-ai-insights.js
// and lib/ltl-dashboard.js (audited 2026-09-26). Base-filter-only columns
// (luong_hang, service_type) are applied at build time and not stored.
// Adding a new field to a transform? Add it here too, or it reads undefined.
const LTL_COLUMNS = [
  "order_code", "client_name", "weight", "status", "odr_success",
  "pickup_time", "delivered_time", "created_time", "date",
  "from_province_name", "to_province_name",
  "kho_lay", "kho_giao", "warehouse_lay", "warehouse_giao",
  "deadline", "deadline_plus",
  // Biweekly company report (lib/biweekly-report.js): B2B/B2C grouping of
  // "Khác" and failed-delivery (return) counts.
  "is_B2C", "deliver_type",
];

const mem = {
  [BASE_PATH]: { value: null, etag: null, checkedAt: 0, bytes: null },
  [DEFAULT_PATH]: { value: null, etag: null, checkedAt: 0, bytes: null },
};

function encode(obj) {
  return gzipSync(Buffer.from(JSON.stringify(obj)));
}

async function readBlob(path) {
  const slot = mem[path];
  if (slot.value && Date.now() - slot.checkedAt < REVALIDATE_MS) return slot.value;

  let res;
  try {
    res = await get(path, { access: "private", useCache: false, ifNoneMatch: slot.etag || undefined });
  } catch (err) {
    // Blob unreachable: keep serving what this instance already has, or let
    // the caller fall back to building from Sheets — never take the
    // dashboard down because of the cache layer.
    console.error("[ltl-snapshot] blob read failed:", path, err.message);
    return slot.value;
  }
  if (!res) return null;
  if (res.statusCode === 304) {
    slot.checkedAt = Date.now();
    return slot.value;
  }
  const buf = Buffer.from(await new Response(res.stream).arrayBuffer());
  slot.value = JSON.parse(gunzipSync(buf).toString("utf8"));
  slot.bytes = buf.length;
  slot.etag = res.blob?.etag || res.headers?.get("etag") || null;
  slot.checkedAt = Date.now();
  return slot.value;
}

function hydrateBase(snap) {
  const cols = snap.ltl.cols;
  const ltlRows = snap.ltl.rows.map((arr) => {
    const o = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = arr[i];
    return o;
  });
  return {
    ltlRows,
    rawMapping: snap.rawMapping,
    rawDamageCauses: snap.rawDamageCauses,
    rawCompensationSummary: snap.rawCompensationSummary,
    // Absent in snapshots built before 29/09 → the map shows no Kho layer
    // until the next rebuild.
    rawWarehouses: snap.rawWarehouses || null,
    rawWarehouseAlias: snap.rawWarehouseAlias || null,
    rawKhoGiaoTongTai: snap.rawKhoGiaoTongTai || null,
    // Absent in snapshots built before 03/10 → null (the health page shows nothing).
    unclassifiedClients: snap.unclassifiedClients || null,
    builtAt: snap.builtAt,
    sourceRowCount: snap.sourceRowCount ?? null,
  };
}

let hydrated = { builtAt: null, base: null };

export async function buildLtlSnapshot() {
  // Always read fresh from Sheets — a stale 5-min fetchSheet cache would
  // defeat the point of rebuilding right after a scraper sync.
  clearAllCache();
  const { fetchSheet } = await import("./sheets");
  const ltlSheetId = process.env.SHEET_ID_LTL;
  const [rawLTL, rawMapping, rawDamageCauses, rawCompensationSummary, rawWarehouses, rawWarehouseAlias, rawClientIndustry, rawKhoGiaoTongTai] = await Promise.all([
    fetchSheet("raw_ontime", ltlSheetId),
    fetchSheet("mapping", ltlSheetId).catch(() => []),
    fetchSheet("raw_damage_causes").catch(() => []),
    fetchSheet("raw_compensation_summary").catch(() => []),
    // Map "Kho" layer (Kế hoạch D · 2a) — a missing tab only hides the layer.
    fetchSheet("Warehouses").catch(() => []),
    fetchSheet("WarehouseAlias").catch(() => []),
    // Client → industry (Rillnet tag + manual decisions); a missing tab = name list only.
    fetchSheet("client_industry").catch(() => []),
    fetchSheet("KhoGiaoTongTai").catch(() => []),
  ]);
  // Never overwrite a good snapshot with an empty read.
  if (!rawLTL || rawLTL.length === 0) throw new Error("No LTL data found in raw_ontime");

  const clientScope = buildScope(rawClientIndustry);
  const filtered = rawLTL.filter((r) => isDMRow(r, clientScope) && isFromJuly2026(r["pickup_time"]) && isLTLRow(r));
  // LTL clients with real volume that no source classifies (incident #37) →
  // "Trạng thái hệ thống" asks a person to decide instead of dropping them.
  const unclassifiedClients = findUnclassified(rawLTL, clientScope);
  const builtAt = new Date().toISOString();
  const snap = {
    version: SNAPSHOT_VERSION,
    builtAt,
    sourceRowCount: rawLTL.length,
    ltl: { cols: LTL_COLUMNS, rows: filtered.map((r) => LTL_COLUMNS.map((c) => (r[c] === undefined ? "" : r[c]))) },
    rawMapping,
    rawDamageCauses,
    rawCompensationSummary,
    rawWarehouses,
    rawWarehouseAlias,
    rawKhoGiaoTongTai,
    unclassifiedClients,
  };

  const base = hydrateBase(snap);
  const defaultBody = computeDashboard(base, {
    role: "manager", userPic: null,
    months: null, projects: null, filterMode: "pickup",
    viewAsType: "manager", viewAsValue: null,
    dateFrom: null, dateTo: null, origin: null, periodWeeks: "mtd",
    withWarehouses: true, // map "Kho" layer ready in the stored body
  });

  // Tag with the deployment that computed it: after a new deploy the stored
  // body may predate code changes to the response shape, so it is skipped
  // (computed live) until the next rebuild.
  defaultBody.__deployment = process.env.VERCEL_DEPLOYMENT_ID || null;

  const opts = { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/gzip" };
  const baseBuf = encode(snap);
  const defaultBuf = encode(defaultBody);
  let basePut = {};
  let defaultPut = {};
  let persisted = true;
  try {
    basePut = await put(BASE_PATH, baseBuf, opts);
    defaultPut = await put(DEFAULT_PATH, defaultBuf, opts);
  } catch (err) {
    // Still serve the freshly built data from this instance.
    persisted = false;
    console.error("[ltl-snapshot] blob write failed:", err.message);
  }

  // This instance is now current; others pick it up within REVALIDATE_MS.
  mem[BASE_PATH] = { value: snap, etag: basePut.etag || null, checkedAt: Date.now(), bytes: baseBuf.length };
  mem[DEFAULT_PATH] = { value: defaultBody, etag: defaultPut.etag || null, checkedAt: Date.now(), bytes: defaultBuf.length };
  hydrated = { builtAt, base };
  clearAllCache();

  return {
    builtAt,
    sourceRows: rawLTL.length,
    ltlRows: filtered.length,
    baseBytes: baseBuf.length,
    defaultBytes: defaultBuf.length,
    persisted,
  };
}

// Snapshot built before the warehouse tabs existed (29/09): read the small
// tabs straight from Sheets once per instance (retry after 5 min on
// failure) so the map "Kho" layer works right after a deploy, before the next
// rebuild stores them in the snapshot. Never blocks the data on a failure.
const WH_RETRY_MS = 5 * 60 * 1000;
let whFallback = { at: 0, value: null, pending: null };
async function warehouseTabsFallback() {
  if (whFallback.value) return whFallback.value;
  if (whFallback.pending) return whFallback.pending;
  if (Date.now() - whFallback.at < WH_RETRY_MS) return null;
  whFallback.at = Date.now();
  whFallback.pending = (async () => {
    try {
      const { fetchSheet } = await import("./sheets");
      const [rawWarehouses, rawWarehouseAlias, rawKhoGiaoTongTai] = await Promise.all([
        fetchSheet("Warehouses"), fetchSheet("WarehouseAlias"), fetchSheet("KhoGiaoTongTai").catch(() => []),
      ]);
      if (rawWarehouseAlias?.length) whFallback.value = { rawWarehouses: rawWarehouses || [], rawWarehouseAlias, rawKhoGiaoTongTai: rawKhoGiaoTongTai || [] };
    } catch (err) {
      console.error("[ltl-snapshot] warehouse tabs fallback failed:", err.message);
    }
    whFallback.pending = null;
    return whFallback.value;
  })();
  return whFallback.pending;
}

export async function loadLtlBase() {
  let snap = await readBlob(BASE_PATH);
  if (!snap || snap.version !== SNAPSHOT_VERSION) {
    await buildLtlSnapshot();
    return hydrated.base;
  }
  if (hydrated.builtAt !== snap.builtAt) hydrated = { builtAt: snap.builtAt, base: hydrateBase(snap) };
  // (also snapshots from before the KhoGiaoTongTai tab — rebuilt 29/09 evening)
  if (!hydrated.base.rawWarehouseAlias || !hydrated.base.rawKhoGiaoTongTai) {
    const tabs = await warehouseTabsFallback();
    if (tabs) Object.assign(hydrated.base, tabs);
  }
  return hydrated.base;
}

// Gzip size of the base blob as last read/written by this instance
// (for the "Trạng thái hệ thống" page — avoids an extra ~1s Blob head()).
export function getBaseBlobBytes() {
  return mem[BASE_PATH].bytes;
}

// Precomputed default body, or null when it shouldn't be used: missing, or
// built on an earlier calendar day (VN time) — period comparison / decline
// alerts are relative to "today" and would be off by a day.
export async function loadDefaultBody() {
  const body = await readBlob(DEFAULT_PATH);
  if (!body?.dataAsOf) return null;
  const vnDay = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  if (vnDay(body.dataAsOf) !== vnDay(Date.now())) return null;
  const dep = process.env.VERCEL_DEPLOYMENT_ID;
  if (dep && body.__deployment !== dep) return null;
  const { __deployment: _d, ...clean } = body;
  return clean;
}
