/**
 * lib/backup-raw-ontime.js
 * Backup incremental hàng ngày của sheet raw_ontime sang 1 Google Sheet riêng biệt.
 *
 * Mỗi ngày cron chỉ append các đơn pickup_time = hôm qua (delta ~1-3k đơn).
 * Để backfill dữ liệu cũ: gọi backupRawOntimeDelta({ from, to }) hoặc
 * truyền query param ?from=YYYY-MM-DD&to=YYYY-MM-DD vào endpoint cron.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";

const SOURCE_SHEET_ID =
  process.env.SHEET_ID_LTL || process.env.GOOGLE_SHEET_ID;
const BACKUP_SHEET_ID =
  process.env.GOOGLE_SHEET_ID_RAWONTIME_BACKUP ||
  "1RZij5RoJ4SH-h2ONyKxlM0g7Z77WGab5lK3LlM7Abho";
const BACKUP_TAB = "raw_ontime_backup";

// Đọc raw_ontime dạng mảng thô (giữ nguyên tất cả cột)
async function readRawOntime(sheets) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SOURCE_SHEET_ID,
    range: "raw_ontime",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return resp.data.values || [];
}

// Đảm bảo tab backup tồn tại; nếu chưa có thì tạo mới
async function ensureBackupTab(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: BACKUP_SHEET_ID,
  });
  const exists = meta.data.sheets.some(
    (s) => s.properties.title === BACKUP_TAB
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BACKUP_SHEET_ID,
      resource: {
        requests: [{ addSheet: { properties: { title: BACKUP_TAB } } }],
      },
    });
  }
}

// Lấy row cuối cùng trong backup để biết đã backup đến ngày nào
async function getLastBackupDate(sheets, pickupCol) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: BACKUP_SHEET_ID,
    range: `'${BACKUP_TAB}'!A1:A1`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const hasHeader = (resp.data.values || []).length > 0;
  if (!hasHeader) return null; // sheet trống

  // Đọc cột pickup_time để tìm max date đã backup
  const colLetter = colToLetter(pickupCol + 1);
  const colResp = await sheets.spreadsheets.values.get({
    spreadsheetId: BACKUP_SHEET_ID,
    range: `'${BACKUP_TAB}'!${colLetter}2:${colLetter}300000`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const vals = (colResp.data.values || []).flat().filter(Boolean);
  if (!vals.length) return null;

  // pickup_time dạng "dd/MM/yyyy HH:mm:ss" hoặc "yyyy-MM-dd"
  let maxDate = "";
  for (const v of vals) {
    const d = parseDate(v);
    if (d && d > maxDate) maxDate = d;
  }
  return maxDate || null;
}

function colToLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Trả về "yyyy-MM-dd" từ giá trị pickup_time (dd/MM/yyyy HH:mm:ss hoặc yyyy-MM-dd...)
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // dd/MM/yyyy HH:mm:ss
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  // yyyy-MM-dd
  const m2 = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m2) return m2[1];
  return null;
}

function yesterday() {
  const d = new Date(Date.now() + 7 * 3600 * 1000); // VN time
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Backup các đơn trong khoảng [from, to] (yyyy-MM-dd).
 * Nếu from/to = null → dùng yesterday.
 * Nếu forceAll = true → copy toàn bộ (lần đầu khi sheet rỗng).
 */
export async function backupRawOntimeDelta({ from = null, to = null, forceAll = false } = {}) {
  if (!SOURCE_SHEET_ID) throw new Error("Missing SHEET_ID_LTL / GOOGLE_SHEET_ID env var");

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  await ensureBackupTab(sheets);

  const allRows = await readRawOntime(sheets);
  if (allRows.length < 2) return { appended: 0, note: "raw_ontime trống" };

  const header = allRows[0];
  const dataRows = allRows.slice(1);

  // Tìm chỉ số cột pickup_time
  const pickupCol = header.findIndex(
    (h) => String(h).toLowerCase().trim() === "pickup_time"
  );
  if (pickupCol < 0) throw new Error("Không tìm thấy cột pickup_time trong raw_ontime");

  // Xác định filter ngày
  let dateFrom, dateTo;
  if (forceAll) {
    dateFrom = "2000-01-01";
    dateTo = "2099-12-31";
  } else {
    const defaultDay = yesterday();
    dateFrom = from || defaultDay;
    dateTo = to || defaultDay;
  }

  // Kiểm tra sheet đã có header chưa
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: BACKUP_SHEET_ID,
    range: `'${BACKUP_TAB}'!A1:A1`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const hasHeader = (headerResp.data.values || []).length > 0;

  // Lấy tập các đơn đã backup (bằng order_code) để tránh trùng
  // → chỉ cần kiểm tra nếu không forceAll; với forceAll ta cũng skip trùng
  const orderCodeCol = header.findIndex(
    (h) => String(h).toLowerCase().trim() === "order_code"
  );
  let existingOrderCodes = new Set();
  if (!forceAll && hasHeader && orderCodeCol >= 0) {
    const ocLetter = colToLetter(orderCodeCol + 1);
    const ocResp = await sheets.spreadsheets.values.get({
      spreadsheetId: BACKUP_SHEET_ID,
      range: `'${BACKUP_TAB}'!${ocLetter}2:${ocLetter}400000`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    (ocResp.data.values || []).flat().forEach((v) => v && existingOrderCodes.add(String(v)));
  }

  // Lọc rows theo ngày và loại bỏ trùng
  const toAppend = dataRows.filter((row) => {
    const rawDate = parseDate(row[pickupCol]);
    if (!rawDate || rawDate < dateFrom || rawDate > dateTo) return false;
    if (orderCodeCol >= 0) {
      const oc = String(row[orderCodeCol] || "");
      if (existingOrderCodes.has(oc)) return false;
    }
    return true;
  });

  if (toAppend.length === 0) {
    return { appended: 0, dateFrom, dateTo, note: "Không có đơn mới" };
  }

  const rowsToWrite = hasHeader ? toAppend : [header, ...toAppend];

  // Ghi theo batch 20k rows để tránh vượt payload limit
  const BATCH = 20000;
  let written = 0;
  for (let i = 0; i < rowsToWrite.length; i += BATCH) {
    const chunk = rowsToWrite.slice(i, i + BATCH);
    await sheets.spreadsheets.values.append({
      spreadsheetId: BACKUP_SHEET_ID,
      range: `'${BACKUP_TAB}'!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values: chunk },
    });
    written += chunk.length;
  }

  return {
    appended: hasHeader ? toAppend.length : toAppend.length,
    headerWritten: !hasHeader,
    dateFrom,
    dateTo,
    totalSourceRows: dataRows.length,
  };
}
