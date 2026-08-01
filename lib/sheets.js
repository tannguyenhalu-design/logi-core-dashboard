/**
 * lib/sheets.js
 * Google Sheets client using Service Account.
 * Caches results for 5 minutes to avoid hammering the Sheets API.
 */
import { google } from "googleapis";

// 5-minute in-memory cache
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

/**
 * Build authenticated Google Sheets API client.
 * Supports two modes:
 * 1. GOOGLE_SERVICE_ACCOUNT_KEY = JSON string (production/Vercel)
 * 2. GOOGLE_SERVICE_ACCOUNT_KEY_FILE = path to local .json file (dev)
 */
export function getAuth() {
  let key;

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (keyFile) {
    // Dev mode: read from file directly (avoids env escaping issues)
    const fs = require("fs");
    const content = fs.readFileSync(keyFile, "utf8");
    key = JSON.parse(content);
  } else {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY env var");
    key = JSON.parse(keyJson);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return auth;
}


/**
 * Fetch a sheet's data as an array of objects (using first row as headers).
 * @param {string} sheetName
 * @returns {Promise<object[]>}
 */
export async function fetchSheet(sheetName, customSpreadsheetId) {
  const spreadsheetId = customSpreadsheetId || process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID env var");

  const cacheKey = `sheet:${spreadsheetId}:${sheetName}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => String(h).trim());
  const data = rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i] : null;
    });
    return obj;
  });

  setCache(cacheKey, data);
  return data;
}
