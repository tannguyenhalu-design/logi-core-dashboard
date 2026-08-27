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

  // pickup_time is column L (index 11, 0-based) per header order
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'raw_ontime'!L2:L71221",
  });
  const vals = (res.data.values || []).map(r => r[0]).filter(Boolean);
  console.log("Total non-empty pickup_time values:", vals.length);

  const byMonth = {};
  for (const v of vals) {
    const m = String(v).match(/^(\d{4}-\d{2})/);
    if (m) byMonth[m[1]] = (byMonth[m[1]] || 0) + 1;
  }
  const months = Object.keys(byMonth).sort();
  console.log("Distribution by month (pickup_time):");
  for (const m of months) console.log(` ${m}: ${byMonth[m]}`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
