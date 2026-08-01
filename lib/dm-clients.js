/**
 * lib/dm-clients.js
 * Shared client-name matching for the "Điện Máy" (DM) business scope —
 * used to filter the shared Raw LTL sheet down to just this app's clients.
 */
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

export function isDMClient(clientName) {
  if (!clientName) return false;
  const name = String(clientName).trim();
  if (DM_LIST.includes(name)) return true;
  const lowerName = name.toLowerCase();
  return DM_KEYWORDS.some((kw) => lowerName.includes(kw));
}
