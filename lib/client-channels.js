/**
 * lib/client-channels.js — "Cài đặt kênh khách hàng" for the company report
 * (user decision 2026-09-27). Replaces the hardcoded B2B/B2C row lists:
 * every Điện máy client has
 *   - channel: "B2B" (B2B LTL) | "B2C"
 *   - own_row_ontime / own_row_fd: its own row in the Ontime / Hàng hoàn
 *     table (off → it adds into "Khác" of its channel)
 *   - order: row order inside its channel
 * Stored in the `ClientChannels` tab of GOOGLE_SHEET_ID; Manager edits it in
 * the "Báo cáo công ty" tab, SD3 can only view. Locked reports are frozen and
 * never change when this does.
 *
 * Clients never saved fall back to DEFAULT_CHANNELS (= the report layout
 * before this existed), else to the MAJORITY of their orders' is_B2C flag —
 * not the first order's, which let clients with mixed flags (Cellphones,
 * CellphoneS North…) flip between "Khác B2B" and "Khác B2C".
 */
import { google } from "googleapis";
import { getAuth, fetchSheet, invalidateCache, getCached, setCached } from "./sheets";

export const SHEET_NAME = "ClientChannels";
export const HEADERS = ["client_name", "channel", "own_row_ontime", "own_row_fd", "order", "updated_by", "updated_at"];

// The layout of the user's original report (and of this code before 27/09).
export const DEFAULT_CHANNELS = {
  "LG LTL": { channel: "B2B", ownOntime: true, ownFd: true, order: 1 },
  "Samsung SDS DAN": { channel: "B2B", ownOntime: true, ownFd: true, order: 2 },
  "PSD Miền Nam": { channel: "B2B", ownOntime: true, ownFd: true, order: 3 },
  "Hồng Đạt MXT": { channel: "B2B", ownOntime: true, ownFd: true, order: 4 },
  "Hồng Đạt": { channel: "B2B", ownOntime: true, ownFd: true, order: 5 },
  "Aqua B2C": { channel: "B2C", ownOntime: true, ownFd: true, order: 1 },
  "Casper": { channel: "B2C", ownOntime: true, ownFd: true, order: 2 },
  "Nguyễn Kim Miền Bắc": { channel: "B2C", ownOntime: false, ownFd: true, order: 3 },
};

const flag = (v) => v === true || v === 1 || ["1", "true", "x", "có"].includes(String(v ?? "").trim().toLowerCase());
const CACHE_KEY = `sheet:${process.env.GOOGLE_SHEET_ID}:${SHEET_NAME}`;
// Other instances pick up a save within this TTL even without the tab's
// `cv` hint (e.g. a report opened from another browser).
const CONFIG_TTL_MS = 60 * 1000;

// Saved rows → { [client]: {channel, ownOntime, ownFd, order, updatedBy, updatedAt} }
function parse(rows) {
  const out = {};
  for (const r of rows || []) {
    const name = String(r.client_name || "").trim();
    if (!name) continue;
    out[name] = {
      channel: String(r.channel || "").trim().toUpperCase() === "B2C" ? "B2C" : "B2B",
      ownOntime: flag(r.own_row_ontime),
      ownFd: flag(r.own_row_fd),
      order: Number(r.order) || 999,
      updatedBy: r.updated_by || "",
      updatedAt: r.updated_at ? String(r.updated_at) : "",
    };
  }
  return out;
}
const versionOf = (map) => Object.values(map).reduce((a, c) => (c.updatedAt > a ? c.updatedAt : a), "");

// { config, version }. `minVersion` (the version a Manager just saved, sent
// back by the tab) forces a fresh read on an instance whose cache is older,
// so every serverless instance recomputes with the new config at once.
// Parsed config is cached here too: fetchSheet() does not cache an empty or
// missing tab, which cost every report request a Sheets call (~0.5s) while
// nothing had been saved yet.
const PARSED_KEY = "client-channels:parsed";
export async function readClientChannels({ minVersion = "" } = {}) {
  const cached = getCached(PARSED_KEY);
  if (cached && (!minVersion || cached.version >= minVersion)) return cached;
  invalidateCache(CACHE_KEY);
  const rows = await fetchSheet(SHEET_NAME).catch(() => []);
  const config = parse(rows);
  const result = { config, version: versionOf(config) };
  setCached(PARSED_KEY, result, CONFIG_TTL_MS);
  return result;
}

// Replace the whole config (list of {client, channel, ownOntime, ownFd, order}).
export async function saveClientChannels(list, actor) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const now = new Date().toISOString();
  const values = [HEADERS, ...list.map((c) => [
    String(c.client).trim(), c.channel === "B2C" ? "B2C" : "B2B", c.ownOntime ? "1" : "", c.ownFd ? "1" : "",
    Number(c.order) || 999, actor || "", now,
  ])];
  try {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAME}'!A:G` });
  } catch (err) {
    // First save: the tab does not exist yet.
    if (!/Unable to parse range|not found/i.test(err.message || "")) throw err;
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] } });
  }
  // RAW: stored exactly as written, never re-typed by the sheet (SYSTEM_SPEC §12).
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${SHEET_NAME}'!A1`, valueInputOption: "RAW", resource: { values } });
  invalidateCache(CACHE_KEY);
  invalidateCache(PARSED_KEY);
  return { version: now, count: list.length };
}

// Effective setting of every client: saved → default layout → data majority.
// stats = { [client]: { orders, b2c } } (b2c = orders flagged is_B2C = 1).
// skipDefaults: true for non-DM industries — prevents DEFAULT_CHANNELS (DM
// clients) from appearing as named rows with 0 orders in STTP/NHC/Ecom reports.
export function resolveChannels(config, stats, { skipDefaults = false } = {}) {
  const names = new Set([...Object.keys(stats), ...Object.keys(config), ...(skipDefaults ? [] : Object.keys(DEFAULT_CHANNELS))]);
  const out = {};
  for (const name of names) {
    const s = stats[name] || { orders: 0, b2c: 0 };
    const suggested = s.orders && s.b2c * 2 > s.orders ? "B2C" : "B2B";
    const mixed = s.orders > 0 && s.b2c > 0 && s.b2c < s.orders;
    const saved = config[name];
    const def = skipDefaults ? undefined : DEFAULT_CHANNELS[name];
    const base = saved || def || { channel: suggested, ownOntime: false, ownFd: false, order: 999 };
    out[name] = {
      channel: base.channel, ownOntime: !!base.ownOntime, ownFd: !!base.ownFd, order: base.order ?? 999,
      source: saved ? "saved" : def ? "default" : "auto", // auto = "chưa cấu hình"
      suggested, mixed, orders: s.orders, b2cShare: s.orders ? s.b2c / s.orders : null,
      updatedBy: saved ? saved.updatedBy : "", updatedAt: saved ? saved.updatedAt : "",
    };
  }
  return out;
}
