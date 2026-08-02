import { getAuth } from "../lib/sheets.js";
import { google } from "googleapis";

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";

  console.log("Fetching all raw_ontime rows...");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'raw_ontime'!A1:Z20000",
  });

  const rows = res.data.values || [];
  console.log("Total rows in raw_ontime:", rows.length);
  if (rows.length < 2) return;

  const headers = rows[0].map(h => String(h || "").trim());
  const createdIdx = headers.indexOf("created_time");
  const pickupIdx = headers.indexOf("pickup_time");
  const deliveredIdx = headers.indexOf("delivered_time");
  const statusIdx = headers.indexOf("status");
  const clientIdx = headers.indexOf("client_name");

  const augDelivered = [];
  const augPickup = [];

  rows.slice(1).forEach(r => {
    const cName = r[clientIdx];
    const status = String(r[statusIdx] || "").toLowerCase();
    const dTime = String(r[deliveredIdx] || "");
    const pTime = String(r[pickupIdx] || "");

    if (dTime.includes("2026-08") || dTime.includes("/08/2026") || dTime.startsWith("01/08") || dTime.startsWith("02/08")) {
      augDelivered.push(r);
    }
    if (pTime.includes("2026-08") || pTime.includes("/08/2026") || pTime.startsWith("01/08") || pTime.startsWith("02/08")) {
      augPickup.push(r);
    }
  });

  console.log("August pickup rows count:", augPickup.length);
  console.log("August delivered rows count:", augDelivered.length);

  // Group August delivered by client_name
  const augByClient = {};
  augDelivered.forEach(r => {
    const c = r[clientIdx] || "Unknown";
    augByClient[c] = (augByClient[c] || 0) + 1;
  });
  console.log("August delivered by client:", augByClient);
}

main().catch(console.error);
