require("dotenv").config({ path: ".env.local" });
const { fetchSheet } = require("../lib/sheets.js");

async function main() {
  const data = await fetchSheet("raw_ontime");
  console.log("Total rows:", data.length);
  
  // Find index of pickup_time
  const headers = data[0];
  const pickupIdx = headers.findIndex(h => h.toLowerCase() === "pickup_time" || h.toLowerCase() === "ngày lấy hàng");
  
  if (pickupIdx === -1) {
    console.log("Headers:", headers);
    console.log("Could not find pickup_time column");
    return;
  }
  
  console.log("Pickup index:", pickupIdx);
  
  let count11 = 0;
  let count12 = 0;
  let count13 = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const pt = row[pickupIdx] || "";
    if (pt.includes("11/08") || pt.includes("11/8/")) count11++;
    if (pt.includes("12/08") || pt.includes("12/8/")) count12++;
    if (pt.includes("13/08") || pt.includes("13/8/")) count13++;
  }
  
  console.log("Orders on 11/08:", count11);
  console.log("Orders on 12/08:", count12);
  console.log("Orders on 13/08:", count13);
}

main().catch(console.error);
