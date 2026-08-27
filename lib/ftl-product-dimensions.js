/**
 * lib/ftl-product-dimensions.js
 * Per-client SKU dimension master (Material No. -> L/W/H/CBM), backed by
 * "FTLProductDimensions". Confirmed against AQUA's real "SP" sheet
 * (2026-08-25, ~1,962 rows, actively maintained by them) — this is what
 * lets pages/api/ftl-bookings-import.js compute real CBM/volumetric-weight
 * per booking instead of asking AI to guess dimensions it can't know.
 * Other clients don't have a known master yet — they fall back to the
 * AI-parse import path until their own file/master shows up.
 */
import { google } from "googleapis";
import { getAuth, invalidateCache, fetchSheet } from "./sheets";

const SHEET_NAME = "FTLProductDimensions";
const HEADERS = ["ClientName", "MaterialNo", "MaterialDesc", "LengthMm", "WidthMm", "HeightMm", "CBM", "Floors", "UpdatedAt", "UpdatedBy"];
const CHUNK_SIZE = 2000; // mirrors cloud-scraper/sync_ftl_to_db.js's chunking for the same reason — one big append() on ~2000 rows risks a payload/timeout abort

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureSheet(sheets) {
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:J1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function key(clientName, materialNo) {
  return `${String(clientName || "").trim().toLowerCase()}|||${String(materialNo || "").trim().toLowerCase()}`;
}

let _cache = null; // {ts, byKey: Map}
async function loadIndexed() {
  if (_cache && Date.now() - _cache.ts < 3 * 60 * 1000) return _cache.byKey;
  const rows = await fetchSheet(SHEET_NAME, getSpreadsheetId()).catch(() => []);
  const byKey = new Map();
  rows.forEach((r) => {
    if (!r["MaterialNo"]) return;
    byKey.set(key(r["ClientName"], r["MaterialNo"]), {
      clientName: r["ClientName"] || "",
      materialNo: r["MaterialNo"] || "",
      materialDesc: r["MaterialDesc"] || "",
      lengthMm: num(r["LengthMm"]),
      widthMm: num(r["WidthMm"]),
      heightMm: num(r["HeightMm"]),
      cbm: num(r["CBM"]),
      floors: num(r["Floors"]),
    });
  });
  _cache = { ts: Date.now(), byKey };
  return byKey;
}

export async function getAllProductDimensions(clientName) {
  const byKey = await loadIndexed();
  const all = [...byKey.values()];
  return clientName ? all.filter((r) => r.clientName.toLowerCase() === clientName.toLowerCase()) : all;
}

export async function lookupDimension(clientName, materialNo) {
  const byKey = await loadIndexed();
  return byKey.get(key(clientName, materialNo)) || null;
}

// records: [{clientName, materialNo, materialDesc, lengthMm, widthMm, heightMm, cbm, floors}, ...]
// Merge-by-(clientName, materialNo), not replace — same reasoning as
// lib/rillnet-sync.js: a fresh upload from CS might only cover part of the
// catalog (e.g. just new SKUs), so a full-replace risks silently deleting
// dimension data for SKUs not present in that particular file.
export async function mergeProductDimensions(clientName, records, actor) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const spreadsheetId = getSpreadsheetId();
  const now = new Date().toISOString();

  const existing = await fetchSheet(SHEET_NAME, spreadsheetId).catch(() => []);
  const merged = new Map();
  existing.forEach((r) => {
    if (r["MaterialNo"]) merged.set(key(r["ClientName"], r["MaterialNo"]), r);
  });
  let newCount = 0, updatedCount = 0;
  records.forEach((r) => {
    const materialNo = String(r.materialNo || "").trim();
    if (!materialNo) return;
    const k = key(clientName, materialNo);
    if (merged.has(k)) updatedCount++; else newCount++;
    merged.set(k, {
      ClientName: clientName, MaterialNo: materialNo, MaterialDesc: r.materialDesc || "",
      LengthMm: r.lengthMm ?? "", WidthMm: r.widthMm ?? "", HeightMm: r.heightMm ?? "",
      CBM: r.cbm ?? "", Floors: r.floors ?? "", UpdatedAt: now, UpdatedBy: actor || "",
    });
  });

  const rows = [...merged.values()].map((r) => HEADERS.map((h) => r[h] ?? ""));
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAME}'!A2:J` });
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: chunk },
    });
  }

  invalidateCache(`sheet:${spreadsheetId}:${SHEET_NAME}`);
  _cache = null;
  return { total: rows.length, newCount, updatedCount };
}
