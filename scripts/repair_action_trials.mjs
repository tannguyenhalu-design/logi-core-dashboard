/**
 * scripts/repair_action_trials.mjs
 * Thêm 6 cột Phase 1 còn thiếu vào ActionTrials mà không xóa dữ liệu cũ.
 * Chạy: node scripts/repair_action_trials.mjs
 */
import { readFileSync } from "fs";
import { google } from "googleapis";

// Parse .env.local
const envRaw = readFileSync(".env.local", "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}

const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const key = JSON.parse(readFileSync(KEY_FILE, "utf8"));

const auth = new google.auth.GoogleAuth({
  credentials: key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const SHEET_NAME = "ActionTrials";
// 6 cột Phase 1 cần thêm (từ lib/trials.js HEADERS)
const PHASE1_COLS = ["hypothesis", "treatment_group", "control_group", "primary_metric", "duration_days", "experiment_status"];

async function run() {
  console.log("=== REPAIR ActionTrials headers ===");
  console.log("Sheet ID:", SHEET_ID);
  console.log("Service :", key.client_email);
  console.log();

  // Đọc header row hiện tại
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME}'!A1:Z1`,
  });
  const currentHeaders = (resp.data.values || [[]])[0] || [];
  console.log("Cột hiện có:", currentHeaders.join(", "));
  console.log("Tổng số cột:", currentHeaders.length);
  console.log();

  // Kiểm tra cột nào còn thiếu
  const missing = PHASE1_COLS.filter((h) => !currentHeaders.includes(h));
  if (missing.length === 0) {
    console.log("[OK] Tất cả cột Phase 1 đã có, không cần sửa.");
    return;
  }
  console.log("Cột còn thiếu:", missing.join(", "));

  // Append các cột thiếu vào cuối header row
  const newHeaders = [...currentHeaders, ...missing];
  // Convert 1-based column index to A1 notation (handles > 26 cols)
  function colLetter(n) {
    let s = "";
    while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  const lastCol = colLetter(newHeaders.length);
  console.log(`Sẽ ghi header mới vào A1:${lastCol}1 (${newHeaders.length} cột)...`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME}'!A1:${lastCol}1`,
    valueInputOption: "RAW",
    resource: { values: [newHeaders] },
  });

  console.log("[OK] Đã cập nhật header thành công!");
  console.log("Header mới:", newHeaders.join(", "));

  // Xác nhận lại
  const check = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME}'!A1:AD1`,
  });
  const checkRow = (check.data.values || [[]])[0] || [];
  const stillMissing = PHASE1_COLS.filter((h) => !checkRow.includes(h));
  if (stillMissing.length === 0) {
    console.log("[VERIFY OK] Tất cả 6 cột Phase 1 đã có trong header.");
  } else {
    console.log("[VERIFY FAIL] Còn thiếu:", stillMissing.join(", "));
  }
}

run().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
