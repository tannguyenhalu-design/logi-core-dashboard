import { getAuth } from "../lib/sheets.js";
import { google } from "googleapis";
import { transformLTL } from "../lib/transform-ltl.js";

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";

  console.log("Fetching raw_ontime...");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'raw_ontime'!A1:Z5000",
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return;
  const headers = rows[0].map(h => String(h || "").trim());

  const rawRows = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i] : null;
    });
    return obj;
  });

  console.log("Total raw rows parsed:", rawRows.length);

  // Check month distribution in pickup_time & delivered_time
  const pickupMonths = {};
  const deliveredMonths = {};

  rawRows.forEach(r => {
    const p = String(r.pickup_time || "");
    const d = String(r.delivered_time || "");

    const pMatch = p.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/) || p.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (pMatch) {
      const m = pMatch[1].length === 4 ? pMatch[2] : pMatch[2];
      const y = pMatch[1].length === 4 ? pMatch[1] : pMatch[3];
      const key = `${y}-${m.padStart(2, '0')}`;
      pickupMonths[key] = (pickupMonths[key] || 0) + 1;
    }

    const dMatch = d.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/) || d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dMatch) {
      const m = dMatch[1].length === 4 ? dMatch[2] : dMatch[2];
      const y = dMatch[1].length === 4 ? dMatch[1] : dMatch[3];
      const key = `${y}-${m.padStart(2, '0')}`;
      deliveredMonths[key] = (deliveredMonths[key] || 0) + 1;
    }
  });

  console.log("Pickup Months:", pickupMonths);
  console.log("Delivered Months:", deliveredMonths);

  const augustDelivered = rawRows.filter(r => String(r.delivered_time).startsWith("2026-08") || String(r.delivered_time).startsWith("01/08") || String(r.delivered_time).startsWith("02/08") || String(r.delivered_time).includes("/08/2026"));
  console.log("August delivered count:", augustDelivered.length);
  if (augustDelivered.length > 0) {
    console.log("Sample August delivered row:", augustDelivered[0]);
  }
}

main().catch(console.error);
