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
const DM_KEYWORDS = ["nguyễn kim", "psd", "samsung", "aqua", "lg ltl", "lg pantos", "lx pantos", "casper", "bluestone", "elmich", "toshiba", "hisense", "cellphones"];

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
  if (!luong || luong === "#n/a") {
    return String(row["service_type"] || "").trim().toLowerCase() === "lastmile";
  }
  return false;
}

/**
 * Điện Máy clients as they appear on portal.ghn.vn's FTL "Quản lý đơn hàng"
 * export (full legal company names / storefront aliases — a completely
 * different naming convention than raw_ontime's DM_LIST/DM_KEYWORDS above,
 * confirmed manually against a real export on 2026-08-16). Exact-match only
 * — do NOT loosen to substring matching, since this list runs against a
 * portal that also carries GHN's non-Điện-Máy FTL clients (Seedcom Food,
 * DHL, Wilmar, coffee chains, etc.) and a fuzzy match risks pulling in
 * unrelated business lines.
 */
export const FTL_PORTAL_DM_CLIENTS = new Set([
  "SF | AQUA B2B",
  "CÔNG TY CỔ PHẦN THỢ ĐIỆN MÁY XANH",
  "CÔNG TY TNHH HỒNG ĐẠT",
  "CÔNG TY CỔ PHẦN THẾ GIỚI SỐ",
  "CÔNG TY CỔ PHẦN TẬP ĐOÀN KAROFI",
  "CÔNG TY TNHH KEX EXPRESS (VIỆT NAM ) | HISENSE",
  "CÔNG TY  TNHH LIVOTEC",
  "Công Ty Tnhh LX Pantos Việt Nam",
  // Found 2026-08-25 while sampling portal.ghn.vn's "Chi phí phát sinh" page
  // (a DIFFERENT sub-page than "Quản lý đơn hàng", which is what the
  // 2026-08-16 list above was validated against): plain "AQUA B2B" and
  // "Pantos | LG FTL" appear there as their own client-name strings for the
  // same two Điện Máy accounts already covered above under their other
  // labels ("SF | AQUA B2B" / "Công Ty Tnhh LX Pantos Việt Nam") — without
  // these, most of the real AQUA/LG Pantos cost rows would be silently
  // excluded (they made up the majority of the DM rows in a 313-row Aug
  // sample). Harmless to include on "Quản lý đơn hàng" too if it ever shows
  // these exact strings — this set is still exact-match only.
  "AQUA B2B",
  "Pantos | LG FTL",
]);

export function isFTLPortalDMClient(clientName) {
  return FTL_PORTAL_DM_CLIENTS.has(String(clientName || "").trim());
}

// Real bug found 2026-08-26: "SF | AQUA B2B" and "AQUA B2B" are the SAME
// real account, and "Công Ty Tnhh LX Pantos Việt Nam" / "Pantos | LG FTL"
// are also the same real account (LG shipped via the Pantos 3PL) — but
// portal.ghn.vn writes the client_name field inconsistently between the
// two labels depending on which internal flow created the order. Every
// grouping in lib/transform-ftl-live.js (client×vehicle matrix, daily
// vehicle stats, "Điểm giao theo khách" destination breakdown) groups by
// the raw client_name string, so without this it silently split ONE real
// client into 2 (or, combined with the Miền Bắc/Nam pickup-region split,
// up to 4) separate rows — confirmed live: user saw "SF AQUA B2B" / "AQUA
// MN" / "AQUA MB" and "LX Pantos" / "LG FTL" showing as unrelated entries.
// Canonicalize to ONE display name (the fuller/more common label in
// FTL_PORTAL_DM_CLIENTS) right where rows are filtered in transformFTLLive,
// so every downstream computation sees a single consistent client_name.
const FTL_PORTAL_CLIENT_ALIASES = {
  "aqua b2b": "SF | AQUA B2B",
  "pantos | lg ftl": "Công Ty Tnhh LX Pantos Việt Nam",
};

export function canonicalFTLPortalClientName(clientName) {
  const trimmed = String(clientName || "").trim();
  return FTL_PORTAL_CLIENT_ALIASES[trimmed.toLowerCase()] || trimmed;
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
