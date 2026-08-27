/**
 * lib/vn-regions.js
 * Maps a Vietnamese province/city name (as it appears in pickup_province on
 * raw_ftl_orders — pre-2025-merger names, matching what GHN's ops data
 * actually uses) to its region — Miền Bắc / Miền Trung / Miền Nam — for
 * vehicle-prep-by-region planning on the FTL tab.
 */
function removeAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

const MIEN_BAC = [
  "Hà Nội", "Hải Phòng", "Quảng Ninh", "Bắc Giang", "Bắc Ninh", "Vĩnh Phúc",
  "Hải Dương", "Hưng Yên", "Thái Bình", "Hà Nam", "Nam Định", "Ninh Bình",
  "Hòa Bình", "Sơn La", "Điện Biên", "Lai Châu", "Lào Cai", "Yên Bái",
  "Phú Thọ", "Tuyên Quang", "Hà Giang", "Cao Bằng", "Bắc Kạn", "Lạng Sơn",
  "Thái Nguyên",
];

const MIEN_TRUNG = [
  "Thanh Hóa", "Nghệ An", "Hà Tĩnh", "Quảng Bình", "Quảng Trị",
  "Thừa Thiên Huế", "Huế", "Đà Nẵng", "Quảng Nam", "Quảng Ngãi",
  "Bình Định", "Phú Yên", "Khánh Hòa", "Ninh Thuận", "Bình Thuận",
  "Kon Tum", "Gia Lai", "Đắk Lắk", "Đắk Nông", "Lâm Đồng",
];

const MIEN_NAM = [
  "Hồ Chí Minh", "TP Hồ Chí Minh", "TP.HCM", "Sài Gòn",
  "Bà Rịa - Vũng Tàu", "Bà Rịa Vũng Tàu", "Vũng Tàu",
  "Bình Dương", "Bình Phước", "Tây Ninh", "Đồng Nai",
  "Long An", "Tiền Giang", "Bến Tre", "Trà Vinh", "Vĩnh Long",
  "Đồng Tháp", "An Giang", "Kiên Giang", "Cần Thơ", "Hậu Giang",
  "Sóc Trăng", "Bạc Liêu", "Cà Mau",
];

function buildLookup(list, region) {
  const map = {};
  list.forEach((name) => { map[removeAccents(name)] = region; });
  return map;
}

const REGION_LOOKUP = {
  ...buildLookup(MIEN_BAC, "Miền Bắc"),
  ...buildLookup(MIEN_TRUNG, "Miền Trung"),
  ...buildLookup(MIEN_NAM, "Miền Nam"),
};

export const REGIONS = ["Miền Bắc", "Miền Trung", "Miền Nam"];

/**
 * Resolve a raw pickup_province string to its region. Strips common
 * "Tỉnh"/"Thành phố"/"TP." prefixes GHN's data sometimes carries before
 * matching, accent-insensitively. Returns "Khác" (not classified) instead
 * of guessing when the name isn't recognized, so an unmapped/misspelled
 * province shows up as its own visible bucket rather than silently
 * vanishing into the wrong region.
 */
export function regionOf(provinceName) {
  const raw = String(provinceName || "").trim();
  if (!raw) return "Khác";
  const cleaned = raw.replace(/^(tỉnh|thành phố|tp\.?)\s+/i, "").trim();
  const key = removeAccents(cleaned);
  return REGION_LOOKUP[key] || "Khác";
}
