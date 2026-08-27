/**
 * lib/ftl-difficult-addresses.js
 * Institutional memory for delivery points that are hard to reach (cấm
 * tải, cần tăng bo, v.v.) — theo yêu cầu người dùng (2026-08-25): trước
 * đây ghi chú kiểu này chỉ nằm trong đầu 1-2 người quen việc, nên lần sau
 * có booking mới tới cùng địa chỉ đó lại lặp lại y hệt vấn đề cũ. Bất kỳ
 * booking nào cũng có thể "đánh dấu" 1 địa chỉ khó, và mọi booking mới
 * nhập vào tự động được so khớp với danh sách này để cảnh báo ngay lúc
 * nhập liệu, không cần nhớ.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

const SHEET_NAME = "FTLDifficultAddresses";
const HEADERS = ["AddressNormalized", "AddressDisplay", "Reason", "AddedBy", "AddedAt", "LastSeenAt", "TimesFlagged"];

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
      range: `'${SHEET_NAME}'!A1:G1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

// Same accent/case-insensitive normalization style as lib/vn-regions.js's
// removeAccents(), plus stripping punctuation/extra whitespace — addresses
// come in as free-text copy-pasted from Zalo, never twice byte-identical.
export function normalizeAddress(address) {
  return String(address || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getRows(sheets) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:G5000`,
  });
  const rows = resp.data.values || [];
  return rows.length < 2 ? [] : rows.slice(1);
}

function rowToEntry(r) {
  return {
    addressNormalized: r[0] || "",
    addressDisplay: r[1] || "",
    reason: r[2] || "",
    addedBy: r[3] || "",
    addedAt: r[4] || "",
    lastSeenAt: r[5] || "",
    timesFlagged: Number(r[6]) || 0,
  };
}

export async function getAllDifficultAddresses() {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const rows = await getRows(sheets);
  return rows.filter((r) => r[0]).map(rowToEntry);
}

// Two addresses "match" if they share a run of >= MIN_SHARED_WORDS
// consecutive words — plain full-string containment missed the common real
// case of two bookings to the same landmark (same KCN/toà nhà) with a
// different house number or ward wording before/after it, since neither
// full string contains the other. 3 consecutive words is specific enough to
// almost always mean "same real place" (a generic phrase like "Long An" is
// only 2 words) while still catching re-worded repeats — false positives
// here just mean an extra reminder shown, never a hidden one, which is the
// safer direction to err for this warning.
const MIN_SHARED_WORDS = 3;
function addressesLikelyMatch(normA, normB) {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const wordsA = normA.split(" ").filter(Boolean);
  const wordsB = normB.split(" ").filter(Boolean);
  if (wordsA.length < MIN_SHARED_WORDS || wordsB.length < MIN_SHARED_WORDS) {
    return normA.includes(normB) || normB.includes(normA);
  }
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, normB] : [wordsB, normA];
  for (let i = 0; i <= shorter.length - MIN_SHARED_WORDS; i++) {
    const gram = shorter.slice(i, i + MIN_SHARED_WORDS).join(" ");
    if (longer.includes(gram)) return true;
  }
  return false;
}

export function findMatches(addressText, allEntries) {
  const needle = normalizeAddress(addressText);
  if (!needle) return [];
  return allEntries.filter((e) => e.addressNormalized && addressesLikelyMatch(needle, e.addressNormalized));
}

export async function flagAddress({ address, reason, actor }) {
  const addressDisplay = String(address || "").trim();
  if (!addressDisplay) throw new Error("Thiếu địa chỉ");
  const addressNormalized = normalizeAddress(addressDisplay);
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const rows = await getRows(sheets);
  const idx = rows.findIndex((r) => r[0] === addressNormalized);
  const now = new Date().toISOString();

  if (idx !== -1) {
    const rowNumber = idx + 2;
    const timesFlagged = (Number(rows[idx][6]) || 0) + 1;
    const values = [addressNormalized, addressDisplay, reason || rows[idx][2] || "", rows[idx][3] || actor || "", rows[idx][4] || now, now, timesFlagged];
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!A${rowNumber}:G${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [values] },
    });
    return rowToEntry(values);
  }

  const values = [addressNormalized, addressDisplay, reason || "", actor || "", now, now, 1];
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A:G`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [values] },
  });
  return rowToEntry(values);
}

// Un-flag an address (e.g. flagged by mistake, or the delivery point issue
// got permanently fixed) — keyed by the same normalized form flagAddress()
// stores rows under.
export async function unflagAddress(addressNormalized) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const rows = await getRows(sheets);
  const idx = rows.findIndex((r) => r[0] === addressNormalized);
  if (idx === -1) throw new Error("Không tìm thấy địa chỉ này trong danh sách");
  const rowNumber = idx + 2;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME)?.properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    resource: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }],
    },
  });
}
