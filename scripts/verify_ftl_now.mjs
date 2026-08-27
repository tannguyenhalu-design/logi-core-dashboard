import { readFileSync } from "fs";
import { google } from "googleapis";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });

  // exactly mirror fetchSheet()'s call shape
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "raw_ftl_orders",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = res.data.values || [];
  console.log("Total rows (incl header):", rows.length);
  console.log("Header:", JSON.stringify(rows[0]));
  console.log("Sample data row:", JSON.stringify(rows[1]));
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
