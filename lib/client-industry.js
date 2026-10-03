/**
 * lib/client-industry.js — which clients are "Điện máy" (DM), without relying
 * on a hand-kept name list alone (SYSTEM_SPEC incident #37, 03/10).
 *
 * The source sheet's `nganh_hang` column is a lookup formula that reads "#N/A"
 * for ~70% of raw_ontime, so the DM scope had to be a hard-coded name list and
 * every new client (Naduco, Smartlink, Komex, Pico…) silently vanished from
 * every Điện máy number until someone noticed. Two extra sources now feed it,
 * both kept in the tab `client_industry` (GOOGLE_SHEET_ID):
 *   source = "rillnet" — the industry Rillnet tags on each client's tickets
 *                        (scraper, every run; DM / NHC / STTP / Ecom).
 *   source = "manual"  — a decision made on "Trạng thái hệ thống" (DM or OTHER);
 *                        wins over Rillnet, and is the only one that can take a
 *                        client OUT of the scope.
 * Order of evidence for a raw_ontime row (lib/dm-clients.js::isDMRow):
 *   manual OTHER → no · nganh_hang "DM" → yes · client_industry says DM → yes ·
 *   name list → yes · otherwise no.
 * Clients that are none of the above but ship ≥ 20 LTL orders in 14 days are
 * listed as "chưa phân ngành" so a person decides (findUnclassified).
 */
import { google } from "googleapis";
import { getAuth, invalidateCache, fetchSheet } from "./sheets";
import { isDMRow, isLTLRow } from "./dm-clients";

export const CLIENT_INDUSTRY_SHEET = "client_industry";
const HEADERS = ["client_name", "industry", "source", "updated_at", "updated_by"];
const LAST_COL = "E";
export const UNCLASSIFIED_DAYS = 14;
export const UNCLASSIFIED_MIN_ORDERS = 20;
// Real (non-lookup-error) industry labels of the source sheet other than DM.
// "LTL" / "FTL…" / "PO" in nganh_hang are shipping-mode values, not industries.
const OTHER_LABELS = new Set(["NHC", "STTP", "ECOM"]);

export const clientKey = (n) => String(n || "").trim().toLowerCase();
const isDmValue = (v) => String(v || "").trim().toUpperCase() === "DM";

// rows = client_industry sheet rows → the sets isDMRow() / findUnclassified() use.
export function buildScope(rows = []) {
  const manual = new Map(), rillnet = new Map();
  for (const r of rows) {
    const k = clientKey(r.client_name);
    if (!k) continue;
    (String(r.source).trim() === "manual" ? manual : rillnet).set(k, String(r.industry || "").trim());
  }
  const final = new Map([...rillnet, ...manual]);
  const dm = new Set(), known = new Set(), exclude = new Set();
  for (const [k, ind] of final) {
    known.add(k);
    if (isDmValue(ind)) dm.add(k);
  }
  for (const [k, ind] of manual) if (!isDmValue(ind)) exclude.add(k);
  return { dm, known, exclude };
}

export async function readClientIndustry() {
  return fetchSheet(CLIENT_INDUSTRY_SHEET).catch(() => []);
}

async function ensureSheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  if (meta.data.sheets.some((s) => s.properties.title === CLIENT_INDUSTRY_SHEET)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [{ addSheet: { properties: { title: CLIENT_INDUSTRY_SHEET } } }] },
  });
}

async function writeAll(rows) {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  await ensureSheet(sheets, spreadsheetId);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${CLIENT_INDUSTRY_SHEET}'!A1:${LAST_COL}` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${CLIENT_INDUSTRY_SHEET}'!A1`,
    valueInputOption: "RAW",
    resource: { values: [HEADERS, ...rows.map((r) => HEADERS.map((h) => r[h] ?? ""))] },
  });
  invalidateCache(`sheet:${spreadsheetId}:${CLIENT_INDUSTRY_SHEET}`);
}

// map = { "Komex": "DM", "Cocoon LTL": "NHC", … } read by the Rillnet scraper.
// Only "rillnet" rows are touched; manual decisions are kept as they are.
export async function syncRillnetIndustry(map = {}) {
  const entries = Object.entries(map).map(([name, ind]) => [String(name).trim(), String(ind || "").trim()]).filter(([n, i]) => n && i);
  if (!entries.length) return { synced: 0 };
  const existing = await readClientIndustry();
  const byKey = new Map(existing.map((r) => [clientKey(r.client_name), r]));
  const now = new Date().toISOString();
  let changed = 0;
  for (const [name, ind] of entries) {
    const k = clientKey(name);
    const prev = byKey.get(k);
    if (prev && String(prev.source).trim() === "manual") continue;
    if (!prev || String(prev.industry).trim() !== ind) changed++;
    byKey.set(k, { client_name: name, industry: ind, source: "rillnet", updated_at: !prev || String(prev.industry).trim() !== ind ? now : prev.updated_at || now, updated_by: "rillnet-scraper" });
  }
  if (changed > 0 || byKey.size !== existing.length) await writeAll([...byKey.values()]);
  return { synced: entries.length, changed };
}

// industry: "DM" (count it in Điện máy) or "OTHER" (leave it out).
export async function setManualIndustry(client, industry, by = "") {
  const name = String(client || "").trim();
  const ind = String(industry || "").trim().toUpperCase() === "DM" ? "DM" : "OTHER";
  if (!name) throw new Error("Thiếu tên khách");
  const existing = await readClientIndustry();
  const k = clientKey(name);
  const rows = existing.filter((r) => !(clientKey(r.client_name) === k && String(r.source).trim() === "manual"));
  rows.push({ client_name: name, industry: ind, source: "manual", updated_at: new Date().toISOString(), updated_by: by });
  await writeAll(rows);
  return { client: name, industry: ind };
}

const dayMs = (v) => {
  const t = Date.parse(String(v || "").slice(0, 10));
  return Number.isFinite(t) ? t : null;
};

// LTL clients outside the DM scope with real recent volume and no industry on
// record anywhere → a person decides. rows = raw_ontime (all rows).
export function findUnclassified(rows, scope, now = Date.now()) {
  const since = now - UNCLASSIFIED_DAYS * 86400000;
  const by = new Map();
  for (const r of rows) {
    const t = dayMs(r.pickup_time);
    if (t == null || t < since) continue;
    const k = clientKey(r.client_name);
    if (!k || scope.known.has(k) || isDMRow(r, scope) || !isLTLRow(r)) continue;
    if (OTHER_LABELS.has(String(r.nganh_hang || "").trim().toUpperCase())) continue;
    const o = by.get(k) || { client: String(r.client_name).trim(), orders: 0, lastPickup: 0, labels: {} };
    o.orders++;
    if (t > o.lastPickup) o.lastPickup = t;
    const lab = String(r.nganh_hang || "").trim() || "(trống)";
    o.labels[lab] = (o.labels[lab] || 0) + 1;
    by.set(k, o);
  }
  return [...by.values()]
    .filter((o) => o.orders >= UNCLASSIFIED_MIN_ORDERS)
    .sort((a, b) => b.orders - a.orders)
    .map((o) => ({ client: o.client, orders: o.orders, lastPickup: new Date(o.lastPickup).toISOString().slice(0, 10), label: Object.entries(o.labels).sort((a, b) => b[1] - a[1])[0][0] }));
}
