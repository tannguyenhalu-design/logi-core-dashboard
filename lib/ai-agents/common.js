/**
 * lib/ai-agents/common.js — helper dùng chung của Planner / 3 tác tử / Aggregator
 * (Kế hoạch F · phiên F2, 02/10/2026).
 *
 * Quy ước: tác tử là MODULE CODE (không phải AI). Mỗi tác tử trả
 *   { agent, data, sources: [Source], steps: [string], needs?: [...] }
 * Source do HỆ THỐNG dựng từ metadata của tác tử (`makeSource`) — AI không viết
 * và không sửa được thẻ nguồn.
 */

export const H = 3600 * 1000;
// Nguồn quá cũ → thẻ vàng. Cùng ngưỡng 24 giờ với trang "Trạng thái hệ thống".
export const STALE_HOURS = 24;

export const tan = (grams) => Math.round(grams / 1e5) / 10; // raw weight = gram
export const pctOf = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
export const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
export const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

export const vnTime = (iso) => (iso
  ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })
  : null);

export function removeAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Số kiểu Việt Nam: vn(2.58, 2) → "2,58"; vn(6123) → "6.123". null → "—". */
export const vn = (n, d = 0) => (n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }));
/** "2026-08-25" → "25/08" */
export const dm = (iso) => { const m = String(iso || "").match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[1]}` : String(iso || ""); };

export const monthOfRow = (row) => {
  const m = String(row.pickup_time || "").match(/^\d{4}-(\d{2})/);
  return m ? Number(m[1]) : null;
};

export const monthsLabel = (months) => (months?.length ? months.map((m) => `T${m}`).join(", ") : "toàn bộ từ 07/2026");

/** Largest ISO timestamp in a list (ISO strings sort lexicographically); ignores junk / far-future values. */
export function maxIso(values) {
  const limit = Date.now() + 24 * H;
  let best = null;
  for (const v of values) {
    const s = String(v || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) continue;
    const t = Date.parse(s);
    if (!Number.isFinite(t) || t > limit) continue;
    if (!best || s > best) best = s;
  }
  return best;
}

/**
 * Thẻ nguồn. `staleAfterHours` null = nguồn không có khái niệm "cũ" (Sổ tay,
 * danh sách kho, bộ nhớ đã duyệt). `asOf` = giờ dữ liệu (ISO) hoặc null.
 */
export function makeSource({ id, kind, label, scope = "", asOf = null, staleAfterHours = null, note = "" }) {
  const ageHours = asOf && Number.isFinite(Date.parse(asOf)) ? (Date.now() - Date.parse(asOf)) / H : null;
  return {
    id, kind, label, scope, asOf: asOf || null, asOfLabel: vnTime(asOf), note,
    ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
    stale: staleAfterHours != null && ageHours != null && ageHours > staleAfterHours,
  };
}

/** Snapshot LTL source — the same blob the dashboard reads. */
export function snapshotSource(base, scope) {
  return makeSource({
    id: "snapshot-ltl", kind: "snapshot", label: "Snapshot LTL Điện Máy",
    scope: scope || "raw_ontime GHN · đơn lấy từ 01/07/2026", asOf: base.builtAt, staleAfterHours: STALE_HOURS,
  });
}

/** Rillnet "Báo cáo bể vỡ" source — asOf = newest `synced_at` of the damage sheet / its summary row. */
export function rillnetSource(base, scope) {
  const asOf = maxIso([...(base.rawDamageCauses || []).map((d) => d.synced_at), ...(base.rawCompensationSummary || []).map((d) => d.synced_at)]);
  return makeSource({
    id: "rillnet-bao-cao-be-vo", kind: "rillnet", label: "Rillnet · Báo cáo bể vỡ",
    scope: scope || "ca hư hỏng đã đồng bộ từ Rillnet (từ 07/2026)", asOf, staleAfterHours: STALE_HOURS,
  });
}

/** Merge sources from every agent: same id → one card (widest scope list, oldest asOf is the honest one). */
export function mergeSources(lists) {
  const byId = new Map();
  for (const s of lists.flat()) {
    if (!s) continue;
    const prev = byId.get(s.id);
    if (!prev) { byId.set(s.id, { ...s }); continue; }
    if (s.scope && !prev.scope.includes(s.scope)) prev.scope = prev.scope ? `${prev.scope}; ${s.scope}` : s.scope;
    if (s.asOf && (!prev.asOf || s.asOf < prev.asOf)) { prev.asOf = s.asOf; prev.asOfLabel = s.asOfLabel; prev.ageHours = s.ageHours; }
    prev.stale = prev.stale || s.stale;
  }
  return [...byId.values()];
}

/** Role gate for the Solutions agent: only Manager + SD3 (user decision, Kế hoạch F). */
export const canSeeSolutions = (role) => role === "manager" || role === "sd3";
