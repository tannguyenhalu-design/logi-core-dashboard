const { google } = require("googleapis");
const fs = require("fs");

async function main() {
  const keyFile = "C:\\Users\\TanNguyen\\Downloads\\sd3-dienmay-app-key.json";
  const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  
  const spreadsheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "raw_ontime",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  const rows = res.data.values;
  const headers = rows[0];
  const data = rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  const isDMClient = (name) => {
    const n = String(name).trim();
    return ['266', 'AUX', 'Aqua B2B', 'Aqua B2C', 'Bluestone', 'Casper', 'CellphoneS North (HTV)', 'Cellphones', 'DigiWorld', 'Elmich B2B', 'FRT B2B', 'FRT B2C', 'Hisense FTL', 'Hisense LTL', 'Hồng Đạt', 'Hồng Đạt MXT', 'LG LTL', 'LG Pantos', 'Nguyễn Kim', 'Nguyễn Kim Miền Bắc', 'Nguyễn Kim Miền Nam', 'PSD', 'PSD LTL', 'Samsung', 'Samsung SDS - Xdocs Hải Phòng', 'Samsung SDS - Xdocs H', 'Samsung SDS DAN', 'Thợ ĐMX FTL', 'Toshiba B2B', 'Điện máy Tân Long'].includes(n);
  };

  const aug = data.filter(r => {
    const pt = String(r.pickup_time || "");
    return isDMClient(r.client_name) && (pt.includes("08/2026") || pt.includes("/8/2026") || pt.includes("08/26"));
  });

  const delivered = aug.filter(r => String(r.status || "").toLowerCase().trim() === "delivered");
  const inProgress = aug.filter(r => String(r.status || "").toLowerCase().trim() === "in_progress");

  const lateDelivered = delivered.filter(r => String(r.odr_success || "").toLowerCase().trim() === "late");
  const lateInProgress = inProgress.filter(r => String(r.odr_success || "").toLowerCase().trim() === "late");
  const ontimeDelivered = delivered.filter(r => String(r.odr_success || "").toLowerCase().trim() === "ontime");

  console.log("Total DM August:", aug.length);
  console.log("Total Delivered:", delivered.length);
  console.log(" - Late:", lateDelivered.length);
  console.log(" - Ontime:", ontimeDelivered.length);
  console.log("Total In Progress:", inProgress.length);
  console.log(" - Marked as Late in sheet:", lateInProgress.length);
  
  if (lateDelivered.length > 0) {
     console.log("Late delivered codes:", lateDelivered.map(r => r.order_code).join(", "));
  }
}

main().catch(console.error);
