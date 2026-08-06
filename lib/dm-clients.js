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

/**
 * Some DM clients ship exclusively (or almost exclusively) via FTL, not
 * LTL — confirmed against real luong_hang values: "Aqua B2B" and
 * "LG Pantos" are 100% FTL rows despite being in DM_LIST, and the four
 * "* FTL"-suffixed client names are FTL by construction. The damage
 * sheet (raw_damage) has no luong_hang column of its own to check, so
 * this list is what filters FTL out of damage stats; order-level
 * filtering should prefer the real luong_hang field (see isLTLRow)
 * since it's self-maintaining for clients not in this list.
 */
export const FTL_ONLY_CLIENTS = new Set([
  "Aqua B2B", "LG Pantos", "Aqua B2B FTL", "LG Pantos FTL", "Hisense FTL", "Thợ ĐMX FTL",
]);

export function isLTLRow(row) {
  const clientName = String(row["client_name"] || "").trim();
  if (FTL_ONLY_CLIENTS.has(clientName)) return false;
  const luong = String(row["luong_hang"] || "").trim().toLowerCase();
  return luong === "ltl";
}
