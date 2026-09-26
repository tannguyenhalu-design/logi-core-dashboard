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
export const compAmount = (r) => Number(r.comp_amount) || 0;
