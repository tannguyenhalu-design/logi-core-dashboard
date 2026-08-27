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

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'raw_ontime'!A1:Z5",
  });
  console.log("Header + sample rows:");
  console.log(JSON.stringify(res.data.values, null, 1));

  // Get row count
  const meta = await sheets.spreadsheets.get({ spreadsheetId, ranges: ["'raw_ontime'!A:A"], fields: "sheets.properties,sheets.data.rowData" });
  const sheetProps = meta.data.sheets.find(s => s.properties.title === "raw_ontime");
  console.log("Sheet properties (grid size):", JSON.stringify(sheetProps?.properties?.gridProperties));
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
