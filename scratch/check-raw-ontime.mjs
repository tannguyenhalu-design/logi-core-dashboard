import { getAuth } from "../lib/sheets.js";
import { google } from "googleapis";

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'raw_ontime'!A1:Z100",
  });

  const rows = res.data.values || [];
  console.log("Sample row 1:", rows[1]);
  console.log("Sample row 2:", rows[2]);

  const createdIdx = rows[0].indexOf("created_time");
  const pickupIdx = rows[0].indexOf("pickup_time");
  const deliveredIdx = rows[0].indexOf("delivered_time");

  const dates = rows.slice(1).map(r => r[pickupIdx] || r[deliveredIdx] || r[createdIdx]).filter(Boolean);
  console.log("Sample date values:", dates.slice(0, 10));
}

main().catch(console.error);
