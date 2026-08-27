import { readFileSync } from "fs";
import { google } from "googleapis";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

const DM_LIST = [
  "266", "AUX", "Aqua B2B", "Aqua B2C", "Bluestone", "Casper",
  "CellphoneS North (HTV)", "Cellphones", "DigiWorld", "Elmich B2B",
  "FRT B2B", "FRT B2C", "Hisense FTL", "Hisense LTL", "Hồng Đạt",
  "Hồng Đạt MXT", "LG LTL", "LG Pantos", "Nguyễn Kim",
  "Nguyễn Kim Miền Bắc", "Nguyễn Kim Miền Nam", "PSD", "PSD LTL",
  "Samsung", "Samsung SDS - Xdocs Hải Phòng", "Samsung SDS - Xdocs H",
  "Samsung SDS DAN", "Thợ ĐMX FTL", "Toshiba B2B", "Điện máy Tân Long",
];
const DM_KEYWORDS = ["nguyễn kim", "psd", "samsung", "aqua", "lg ltl", "lg pantos", "casper", "bluestone", "elmich", "toshiba", "hisense", "cellphones"];
function removeAccents(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D"); }
function isDMClient(name) {
  const trimmed = String(name || "").trim();
  if (DM_LIST.includes(trimmed)) return true;
  const lower = removeAccents(trimmed).toLowerCase();
  return DM_KEYWORDS.some(k => lower.includes(removeAccents(k)));
}
const FTL_ONLY_CLIENTS = new Set(["Aqua B2B", "LG Pantos", "Aqua B2B FTL", "LG Pantos FTL", "Hisense FTL", "Thợ ĐMX FTL"]);
function isLTLRow(row) {
  const clientName = String(row["client_name"] || "").trim();
  if (FTL_ONLY_CLIENTS.has(clientName)) return false;
  const luong = String(row["luong_hang"] || "").trim().toLowerCase();
  return luong === "ltl";
}

async function loadFromSheet() {
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: "'raw_ontime'!A1:AV",
    valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = res.data.values || [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : null; });
    return obj;
  });
}

function loadFromCSV(path) {
  const csvContent = readFileSync(path, "utf8");
  const rows = csvContent.split("\n").filter(r => r.trim() !== "").map(r => r.split(","));
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : null; });
    return obj;
  });
}

function analyze(data, label) {
  console.log(`\n=== ${label} (total rows: ${data.length}) ===`);
  const julyAll = data.filter(r => String(r["pickup_time"] || "").startsWith("2026-07"));
  console.log("July 2026, ALL clients (no DM filter, no LTL filter):", julyAll.length);

  const julyDM = julyAll.filter(r => isDMClient(r["client_name"]));
  console.log("July 2026, DM clients only (any luong_hang):", julyDM.length);

  const julyDMLTL = julyDM.filter(r => isLTLRow(r));
  console.log("July 2026, DM clients + LTL only:", julyDMLTL.length);

  const luongDist = {};
  julyDM.forEach(r => {
    const l = String(r["luong_hang"] || "(blank)").trim() || "(blank)";
    luongDist[l] = (luongDist[l] || 0) + 1;
  });
  console.log("  luong_hang breakdown among July DM clients:", JSON.stringify(luongDist));
}

async function main() {
  const sheetData = await loadFromSheet();
  analyze(sheetData, "CURRENT production sheet (today, post-fix)");

  try {
    const csvData = loadFromCSV("scripts/dump_0.csv");
    analyze(csvData, "Local dump_0.csv (yesterday Aug 15, pre-fix snapshot)");
  } catch (e) {
    console.log("Could not load local CSV:", e.message);
  }
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
