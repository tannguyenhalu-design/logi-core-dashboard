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
 *    the LTL transforms read, plus mapping / damage / compensation sheets.
 *  - DEFAULT: the fully computed default dashboard body (no filters), so
 *    the first screen most people open needs no transform at all.
 */
import { gzipSync, gunzipSync } from "zlib";
import { put, get } from "@vercel/blob";
import { fetchSheet, clearAllCache } from "./sheets";
import { isDMClient, isLTLRow, isFromJuly2026 } from "./dm-clients";
import { computeDashboard } from "./ltl-dashboard";

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
];

const mem = {
  [BASE_PATH]: { value: null, etag: null, checkedAt: 0 },
  [DEFAULT_PATH]: { value: null, etag: null, checkedAt: 0 },
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
    builtAt: snap.builtAt,
  };
}

let hydrated = { builtAt: null, base: null };

export async function buildLtlSnapshot() {
  // Always read fresh from Sheets — a stale 5-min fetchSheet cache would
  // defeat the point of rebuilding right after a scraper sync.
  clearAllCache();
  const ltlSheetId = process.env.SHEET_ID_LTL;
  const [rawLTL, rawMapping, rawDamageCauses, rawCompensationSummary] = await Promise.all([
    fetchSheet("raw_ontime", ltlSheetId),
    fetchSheet("mapping", ltlSheetId).catch(() => []),
    fetchSheet("raw_damage_causes").catch(() => []),
    fetchSheet("raw_compensation_summary").catch(() => []),
  ]);
  // Never overwrite a good snapshot with an empty read.
  if (!rawLTL || rawLTL.length === 0) throw new Error("No LTL data found in raw_ontime");

  const filtered = rawLTL.filter((r) => isDMClient(r["client_name"]) && isFromJuly2026(r["pickup_time"]) && isLTLRow(r));
  const builtAt = new Date().toISOString();
  const snap = {
    version: SNAPSHOT_VERSION,
    builtAt,
    sourceRowCount: rawLTL.length,
    ltl: { cols: LTL_COLUMNS, rows: filtered.map((r) => LTL_COLUMNS.map((c) => (r[c] === undefined ? "" : r[c]))) },
    rawMapping,
    rawDamageCauses,
    rawCompensationSummary,
  };

  const base = hydrateBase(snap);
  const defaultBody = computeDashboard(base, {
    role: "manager", userPic: null,
    months: null, projects: null, filterMode: "pickup",
    viewAsType: "manager", viewAsValue: null,
    dateFrom: null, dateTo: null, origin: null, periodWeeks: "mtd",
  });

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
  mem[BASE_PATH] = { value: snap, etag: basePut.etag || null, checkedAt: Date.now() };
  mem[DEFAULT_PATH] = { value: defaultBody, etag: defaultPut.etag || null, checkedAt: Date.now() };
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

export async function loadLtlBase() {
  let snap = await readBlob(BASE_PATH);
  if (!snap || snap.version !== SNAPSHOT_VERSION) {
    await buildLtlSnapshot();
    return hydrated.base;
  }
  if (hydrated.builtAt !== snap.builtAt) hydrated = { builtAt: snap.builtAt, base: hydrateBase(snap) };
  return hydrated.base;
}

// Precomputed default body, or null when it shouldn't be used: missing, or
// built on an earlier calendar day (VN time) — period comparison / decline
// alerts are relative to "today" and would be off by a day.
export async function loadDefaultBody() {
  const body = await readBlob(DEFAULT_PATH);
  if (!body?.dataAsOf) return null;
  const vnDay = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  if (vnDay(body.dataAsOf) !== vnDay(Date.now())) return null;
  return body;
}
