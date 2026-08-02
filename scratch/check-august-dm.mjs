import { getAuth } from "../lib/sheets.js";
import { google } from "googleapis";

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";

  console.log("Fetching D_OM_view sheet...");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'D_OM_view'!A1:Z5000",
  });

  const rows = res.data.values || [];
  console.log("Total rows in D_OM_view:", rows.length);
  if (rows.length > 0) {
    console.log("Headers in D_OM_view:", rows[0]);
    console.log("Last 5 rows in D_OM_view:", rows.slice(-5));
  }
}

main().catch(console.error);
