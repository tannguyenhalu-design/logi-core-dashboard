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
  "PSD Miền Bắc", "PSD Miền Nam",
  "Samsung", "Samsung SDS - Xdocs Hải Phòng", "Samsung SDS - Xdocs H",
  "Samsung SDS DAN", "Thợ ĐMX FTL", "Toshiba B2B", "Điện máy Tân Long",
];
// "frt digital" added 2026-09-26 (user decision) — "FRT Digital Miền Nam"/
// "FRT Digital Miền Bắc" were real LTL orders never matched by DM_LIST.
// "komex" added 2026-10-02 (user: "Komex là điện máy") — 330 real lastmile
// orders (310 in 09/2026) with nganh_hang "#N/A", so no label matched; Rillnet
// already tags its case (GYY4GMMK, 6.91 tr compensated) as Điện máy.
const DM_KEYWORDS = ["nguyễn kim", "psd", "samsung", "aqua", "lg ltl", "lg pantos", "lx pantos", "casper", "bluestone", "elmich", "toshiba", "hisense", "cellphones", "frt digital", "komex"];

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
// Row-level scope check (decided 2026-09-26): the source sheet tags every
// order with nganh_hang ("DM" = Điện Máy) — the primary signal, so new DM
// clients (Naduco, Smartlink, Toàn Phát appeared 09/2026) show up without a
// code change. The name list stays as a fallback because nganh_hang is a
// lookup formula that sometimes reads "#N/A" (225 real PSD Miền Nam orders).
export function isDMRow(row) {
  if (String(row["nganh_hang"] ?? "").trim().toUpperCase() === "DM") return true;
  return isDMClient(row["client_name"]);
}

export const FTL_ONLY_CLIENTS = new Set([
  "Aqua B2B", "LG Pantos", "Aqua B2B FTL", "LG Pantos FTL", "Hisense FTL", "Thợ ĐMX FTL",
]);

export function isLTLRow(row) {
  const clientName = String(row["client_name"] || "").trim();
  if (FTL_ONLY_CLIENTS.has(clientName)) return false;
  const luong = String(row["luong_hang"] || "").trim().toLowerCase();
  if (luong === "ltl") return true;
  if (luong === "ftl") return false;
  // luong_hang comes from a lookup formula in the source sheet and reads
  // back "#N/A" for any client not yet added to that lookup table — this
  // silently dropped ALL of "PSD Miền Nam"/"PSD Miền Trung" (2,619 real
  // orders, confirmed 100% "#N/A") from every LTL number on the dashboard,
  // even though the orders are genuine. Fall back to GHN's own
  // "service_type" field for this case — "lastmile" is GHN's parcel/LTL
  // delivery model (as opposed to FTL's full-truckload trips), populated
  // directly by the KPI portal itself, independent of the broken lookup.
  //
  // Same fallback for ANY other label (decided 2026-09-26): the source
  // started tagging Hồng Đạt orders "PO" from ~08/2026 — all 743 were
  // service_type "lastmile", yet the old "unknown label → drop" rule hid
  // every Hồng Đạt order from Aug on. Only an explicit "FTL" excludes now.
  return String(row["service_type"] || "").trim().toLowerCase() === "lastmile";
}

// Shared with pages/api/data.js and pages/api/ontime-by-project.js — both
// need the exact same "from July 2026 onwards" cutoff so their ontime%
// numbers for the same project stay consistent with each other.
function parseDDMMYYYY(str) {
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!m) return null;
  return { day: parseInt(m[1]), month: parseInt(m[2]), year: parseInt(m[3]) };
}

export function isFromJuly2026(dateStr) {
  if (!dateStr) return true;
  const trimStr = String(dateStr).trim();
  if (typeof dateStr === "number") {
    const d = new Date(new Date(1899, 11, 30).getTime() + dateStr * 86400000);
    return d.getFullYear() > 2026 || (d.getFullYear() === 2026 && d.getMonth() >= 6);
  }
  if (/^\d{4}-\d{2}/.test(trimStr)) {
    const year = parseInt(trimStr.slice(0, 4));
    const month = parseInt(trimStr.slice(5, 7));
    return year > 2026 || (year === 2026 && month >= 7);
  }
  const dmy = parseDDMMYYYY(trimStr);
  if (dmy) {
    return dmy.year > 2026 || (dmy.year === 2026 && dmy.month >= 7);
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() > 2026 || (d.getFullYear() === 2026 && d.getMonth() >= 6);
}
