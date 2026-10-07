/**
 * scripts/diagnose_sheets.mjs
 * Chạy: node scripts/diagnose_sheets.mjs
 * Kiểm tra: quyền truy cập, danh sách tab, header của Users / ActionTrials / AuditLog
 */
import { readFileSync } from "fs";
import { google } from "googleapis";

// Parse .env.local manually (avoid dotenv dependency)
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

const TABS_NEEDED = {
  Users: ["Email", "PasswordHash", "Salt", "Role", "PIC Name", "Project", "CreatedAt", "UpdatedAt", "UpdatedBy", "Tabs", "Name", "EmployeeId"],
  ActionTrials: ["id", "name", "clients", "kho_lay", "kho_giao", "to_province", "base_start", "base_end", "start_date", "end_date", "status", "description", "created_by", "created_at", "updated_by", "updated_at", "deleted_at", "deleted_by", "hypothesis", "treatment_group", "control_group", "primary_metric", "duration_days", "experiment_status"],
  AuditLog: ["Timestamp", "Actor", "Action", "Target", "Details"],
  ActionSolutions: null, // không bắt buộc header cụ thể
};

async function run() {
  console.log("=== GOOGLE SHEETS DIAGNOSIS ===");
  console.log("Sheet ID :", SHEET_ID);
  console.log("Service  :", key.client_email);
  console.log();

  // 1. List all existing tabs
  console.log("── 1. Danh sách tab hiện có ──");
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existingTabs = meta.data.sheets.map((s) => s.properties.title);
  console.log("Tabs:", existingTabs.join(", ") || "(trống)");
  console.log();

  // 2. Check each required tab
  console.log("── 2. Kiểm tra tab bắt buộc ──");
  for (const [tab, expectedHeaders] of Object.entries(TABS_NEEDED)) {
    const exists = existingTabs.includes(tab);
    if (!exists) {
      console.log(`[MISSING] ${tab} — tab chưa tồn tại`);
      continue;
    }
    if (!expectedHeaders) {
      console.log(`[OK]      ${tab} — tồn tại (không kiểm tra header)`);
      continue;
    }
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${tab}'!A1:Z1`,
      });
      const row = (resp.data.values || [[]])[0] || [];
      const missing = expectedHeaders.filter((h) => !row.includes(h));
      const extra = row.filter((h) => h && !expectedHeaders.includes(h));
      if (missing.length) {
        console.log(`[PARTIAL] ${tab} — thiếu cột: ${missing.join(", ")}`);
        if (extra.length) console.log(`           extra: ${extra.join(", ")}`);
      } else {
        console.log(`[OK]      ${tab} — header đầy đủ (${row.length} cột)`);
      }
    } catch (err) {
      console.log(`[ERROR]   ${tab} — đọc lỗi: ${err.message}`);
    }
  }
  console.log();

  // 3. Test WRITE permission (append a test row to a temp cell, then delete)
  console.log("── 3. Kiểm tra quyền GHI ──");
  // Use a scratch cell in ActionTrials (or AuditLog) to test write
  const testTab = existingTabs.includes("AuditLog") ? "AuditLog"
    : existingTabs.includes("ActionTrials") ? "ActionTrials"
    : existingTabs[0];

  if (!testTab) {
    console.log("[SKIP] Không có tab để test ghi.");
  } else {
    try {
      // Append a test row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `'${testTab}'!A:E`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        resource: { values: [["__TEST_WRITE__", new Date().toISOString(), "diagnose_script", "ok", ""]] },
      });
      console.log(`[WRITE OK] Ghi được vào tab "${testTab}"`);

      // Find and delete the test row
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${testTab}'!A:A` });
      const rows = resp.data.values || [];
      const testRowIdx = rows.findIndex((r) => r[0] === "__TEST_WRITE__");
      if (testRowIdx >= 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          resource: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId: meta.data.sheets.find((s) => s.properties.title === testTab)?.properties.sheetId,
                  dimension: "ROWS",
                  startIndex: testRowIdx,
                  endIndex: testRowIdx + 1,
                },
              },
            }],
          },
        });
        console.log(`[CLEAN]    Đã xóa test row khỏi "${testTab}"`);
      }
    } catch (err) {
      console.log(`[WRITE FAIL] Không ghi được: ${err.message}`);
    }
  }
  console.log();

  // 4. Summary
  console.log("── 4. TÓM TẮT ──");
  console.log("Sheet URL: https://docs.google.com/spreadsheets/d/" + SHEET_ID);
  console.log("Cần cấp quyền Editor cho:", key.client_email);
  console.log("(Google Sheets → Share → Add email → Editor)");
}

run().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
