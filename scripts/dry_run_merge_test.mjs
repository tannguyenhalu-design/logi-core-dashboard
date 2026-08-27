import { readFileSync } from "fs";
import { google } from "googleapis";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const ORDER_CODE_COL = 1;

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });

  console.log("Reading existing raw_ontime from sheet (read-only, no writes)...");
  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'raw_ontime'!A:AV",
  });
  const existingRows = existingRes.data.values || [];
  const existingDataRows = existingRows.slice(1);
  console.log(`Existing: ${existingDataRows.length} data rows.`);

  const csvContent = readFileSync("scripts/dump_0.csv", "utf8");
  const freshRows = csvContent.split("\n").filter(r => r.trim() !== "").map(r => r.split(","));
  const freshDataRows = freshRows.slice(1);
  console.log(`Fresh CSV: ${freshDataRows.length} data rows.`);

  const merged = new Map();
  for (const row of existingDataRows) {
    const code = row[ORDER_CODE_COL];
    if (code) merged.set(code, row);
  }
  let newCount = 0, updatedCount = 0;
  for (const row of freshDataRows) {
    const code = row[ORDER_CODE_COL];
    if (!code) continue;
    if (merged.has(code)) updatedCount++; else newCount++;
    merged.set(code, row);
  }
  const mergedRows = Array.from(merged.values());
  const preservedCount = mergedRows.length - newCount - updatedCount;
  console.log(`\nDRY RUN RESULT (nothing written):`);
  console.log(`  Total merged rows: ${mergedRows.length}`);
  console.log(`  New (not seen before): ${newCount}`);
  console.log(`  Refreshed (already existed): ${updatedCount}`);
  console.log(`  Preserved (existing rows not in fresh CSV, i.e. history that would've been LOST under old logic): ${preservedCount}`);

  // sanity: how many fresh-CSV order_codes are NOT in existing? and vice versa (fell out of source)
  const freshCodes = new Set(freshDataRows.map(r => r[ORDER_CODE_COL]).filter(Boolean));
  const existingCodes = new Set(existingDataRows.map(r => r[ORDER_CODE_COL]).filter(Boolean));
  let fellOutOfSource = 0;
  for (const c of existingCodes) if (!freshCodes.has(c)) fellOutOfSource++;
  console.log(`  Order codes in existing sheet but missing from today's fresh export (would be silently deleted under OLD clear+replace logic): ${fellOutOfSource}`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
