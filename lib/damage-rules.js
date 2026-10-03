/**
 * lib/damage-rules.js — which Rillnet rows count as a "ca hư hỏng", and
 * their compensation state (user decision 2026-09-27: follow Rillnet's own
 * "Báo cáo bể vỡ" definitions).
 *
 *  - counted: the case is in the report's list (CS tick 💰 · đơn cũ bù tay ·
 *    đã chốt tiền) — Rillnet's "Bể vỡ / Hư hỏng" card. Warehouse tickets
 *    captured from the older layout that never became a case stay in the
 *    sheet but are not counted.
 *  - compensated: "Đơn đã chốt đền bù cho khách" (Ops accepted compensation,
 *    or the amount was booked via Chốt tiền).
 *  - truy_thu: clawback decision — "co" (with truy_thu_amount), "khong",
 *    "cho" (not decided yet).
 */
const flag = (v) => v === true || v === 1 || String(v ?? "").trim() === "1";

// Rows synced before the "counted" column existed have no value at all; if
// NO row carries the flag yet, count everything (pre-27/09 behaviour) rather
// than showing zero damage.
export function countedDamage(rows = []) {
  const hasFlag = rows.some((r) => String(r.counted ?? "").trim() !== "");
  return hasFlag ? rows.filter((r) => flag(r.counted)) : rows;
}

export const isCompensated = (r) => flag(r.compensated);
export const truyThuOf = (r) => String(r.truy_thu || "").trim() || "cho";
export const truyThuAmount = (r) => (truyThuOf(r) === "co" ? Number(r.truy_thu_amount) || 0 : 0);
// Tiền đền cho khách (Kế hoạch E, user chốt 29/09) = số CS nhập theo mã đơn khi
// đánh dấu "có đền bù" — số dự kiến, CS nhập lại sau khi khách QC → luôn dùng
// số MỚI NHẤT. Scraper (Kế hoạch E · phiên 1) ghi số mới nhất vào comp_amount
// (đã chốt > dự kiến sửa sau QC > số CS nhập khi tick; trước phiên 1 chỉ có số
// đã chốt). comp_amount_latest được đọc trước nếu sau này có cột riêng.
// Truy thu KHÔNG phải tiền đền, không trừ vào thiệt hại.
export const COMP_AMOUNT_FIELDS = ["comp_amount_latest", "comp_amount"];
// "1.920.000" / "1,920,000" (formatted cell) → 1920000; plain numbers as is; "" → null.
const parseAmount = (v) => {
  if (v === "" || v == null) return null;
  const t = String(v).trim();
  const n = typeof v === "number" ? v : /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, "")) : Number(t);
  return Number.isFinite(n) ? n : null;
};
export function compAmount(r) {
  for (const f of COMP_AMOUNT_FIELDS) {
    const n = parseAmount(r?.[f]);
    if (n != null) return n;
  }
  return 0;
}
// "Đã chỉnh sửa" (user 03/10: show the latest number AND say it was edited).
// Rillnet keeps no history of the amount, so two signals: the amount we saw
// change between scrapes (comp_amount_edits, tracked from 03/10), or a final
// amount that differs from the one CS typed when ticking (comp_amount_cs).
// `from` = the earlier amount, when known.
export function compMeta(r) {
  const latest = compAmount(r);
  const cs = parseAmount(r?.comp_amount_cs) || 0, first = parseAmount(r?.comp_amount_first) || 0;
  const edits = Number(r?.comp_amount_edits) || 0;
  const viaScrape = edits > 0 && first > 0 && first !== latest;
  const viaCs = cs > 0 && latest > 0 && cs !== latest;
  return { edited: viaScrape || viaCs || edits > 0, from: viaScrape ? first : viaCs ? cs : null, source: String(r?.comp_amount_source || "") };
}
// Amount CS entered on a case Ops has NOT (yet) accepted for compensation —
// "dự kiến, chưa chốt": not damage yet, shown on its own line (user 03/10).
export const compPending = (r) => (isCompensated(r) ? 0 : parseAmount(r?.comp_amount_du_kien) || 0);
// Which column the amount came from (for the "nguồn số tiền" note), or null.
export function compAmountField(rows = []) {
  for (const f of COMP_AMOUNT_FIELDS) if (rows.some((r) => r?.[f] !== "" && r?.[f] != null)) return f;
  return null;
}
