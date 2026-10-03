/**
 * lib/damage-money.js — Kế hoạch E · phiên 2 (user duyệt 29/09): tiền đền cho
 * khách + phân tích đơn hư hỏng cho tab "Hư hỏng & Rủi ro".
 *
 * Tiền thiệt hại = TIỀN ĐỀN CHO KHÁCH (số CS nhập theo mã đơn, số dự kiến, CS
 * cập nhật lại sau khi khách QC → luôn lấy số mới nhất: compAmount() trong
 * lib/damage-rules.js). Truy thu (thu lại từ nhân viên GHN làm sai) KHÔNG giảm
 * thiệt hại → luôn hiện riêng, không trừ.
 *
 * Mọi hàm ở đây chỉ ĐỌC các ca đã có — không đổi số ca, % bể vỡ, on-time.
 *  - computeDamageMoney: tiền theo kỳ đang lọc + so kỳ trước, theo dự án / tuyến.
 *  - computeDamageAnalysis: (1) ca còn mở, (2) tuyến / khách còn tái phát,
 *    (3) chặng nghi vấn theo tuyến.
 *  - reconcileRillnet: đối chiếu với các ô của trang Rillnet (raw_compensation_summary).
 */
import { parseDate } from "./transform-ltl";
import { compAmount, compAmountField, compMeta, compPending, isCompensated, truyThuOf, truyThuAmount } from "./damage-rules";
import { SHOW_TRUY_THU } from "./display-flags";

export const MONEY_NOTE = "Số CS nhập theo mã đơn — có thể còn cập nhật sau khi khách QC";
const DATA_START = "2026-07-01";
const DAY = 86400000;
const ROUTES_MAX = 40;
const LEG_ROUTES_MAX = 30;
export const RECUR_WEEKS = [2, 3, 4];

const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (d) => (d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : "");
// Case date (Rillnet detection, dd/mm/yyyy) — same field order as the
// "so sánh cùng kỳ" damage count (case_date, then the order's pickup).
export const caseIso = (c) => isoOf(parseDate(c.case_date || c.pickup_time));
const daysFrom = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const routeOf = (c) => `${c.kho_lay || "(không rõ kho lấy)"} → ${c.kho_giao || "(không rõ kho giao)"}`;

// A raw Rillnet row + its order, in the ltl.detailedDamageCases shape (so the
// case drawer of the "Chi tiết ca" table can open it) + the order's kho giao.
export function caseView(r, o = {}) {
  return {
    order_code: String(r.order_code || "").trim(),
    client_name: r.client_name || o.client_name || "",
    to_province: o.to_province_name || "",
    warehouse_giao: r.warehouse_giao || r.detected_at_warehouse || "",
    damage_type: r.type || r.damage_type || "",
    damage_details: r.suspected_leg || r.damage_details || "",
    from_province: o.from_province_name || "",
    kho_lay: o.kho_lay || o.warehouse_lay || "",
    kho_giao: o.kho_giao || o.warehouse_giao || "",
    pickup_time: o.pickup_time || "",
    ltl_status: o.status || "",
    case_date: r.case_date || "",
    source: String(r.source || "").replace(/\s*\n\s*/g, " · "),
    rillnet_status: r.status || "",
    compensated: isCompensated(r),
    comp_amount: compAmount(r),
    comp_edited: compMeta(r).edited,
    comp_from: compMeta(r).from,
    comp_pending: compPending(r),
    truy_thu: truyThuOf(r),
    truy_thu_amount: Number(r.truy_thu_amount) || 0,
    truy_thu_status: r.truy_thu_status || "",
  };
}

// ── Money ──────────────────────────────────────────────────────────────
// `cases` = detailedDamageCases shape (compensated bool, comp_amount,
// truy_thu "co"/"khong"/"cho", truy_thu_amount).
export function moneySummary(cases = []) {
  const s = { cases: 0, compensated: 0, withAmount: 0, amount: 0, amountOutside: 0, edited: 0, pendingCases: 0, pendingAmount: 0, truyThuCases: 0, truyThuAmount: 0 };
  for (const c of cases) {
    s.cases++;
    const a = Number(c.comp_amount) || 0;
    if (c.compensated && a > 0 && c.comp_edited) s.edited++;
    if (!c.compensated && Number(c.comp_pending) > 0) { s.pendingCases++; s.pendingAmount += Number(c.comp_pending); }
    if (c.compensated) { s.compensated++; if (a > 0) s.withAmount++; }
    else if (a > 0) s.amountOutside++; // amount typed before the "đã chốt" flag
    s.amount += a;
    if (c.truy_thu === "co") { s.truyThuCases++; s.truyThuAmount += Number(c.truy_thu_amount) || 0; }
  }
  return s;
}

function groupBy(cases, keyOf) {
  const m = new Map();
  for (const c of cases) {
    const k = keyOf(c);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return m;
}

// Rows of a grouping with the comparison window attached (▲▼ per row).
function moneyRows(cases, keyOf, cmp, extra = () => ({})) {
  const cur = groupBy(cases, keyOf);
  const cCur = cmp ? groupBy(cmp.curCases, keyOf) : null;
  const cPrev = cmp ? groupBy(cmp.prevCases, keyOf) : null;
  const keys = new Set([...cur.keys(), ...(cCur ? cCur.keys() : []), ...(cPrev ? cPrev.keys() : [])]);
  const rows = [];
  for (const k of keys) {
    const list = cur.get(k) || [];
    const s = moneySummary(list);
    const row = { name: k, ...s, ...extra(list[0] || (cCur?.get(k) || cPrev?.get(k) || [])[0]) };
    if (cmp) {
      const a = moneySummary(cCur.get(k) || []), b = moneySummary(cPrev.get(k) || []);
      row.cmp = { amount: a.amount, cases: a.cases, prevAmount: b.amount, prevCases: b.cases };
    }
    if (row.cases || (row.cmp && (row.cmp.cases || row.cmp.prevCases))) rows.push(row);
  }
  return rows.sort((a, b) => b.amount - a.amount || b.cases - a.cases || String(a.name).localeCompare(String(b.name)));
}

/**
 * @param cases   ca của kỳ đang lọc (ltl.detailedDamageCases — cùng tập với ô "Ca hư hỏng")
 * @param compare null | { incomplete, compareLabel } |
 *                { mode: "window"|"period", currentLabel, compareLabel, curCases, prevCases }
 * @param kgOf    order_code → kho giao của ĐƠN (không phải kho phát hiện)
 * @param rawRows ca gốc (để biết cột tiền nào đang có số)
 */
export function computeDamageMoney({ cases = [], compare = null, kgOf = () => "", rawRows = [] }) {
  const withKg = (list) => list.map((c) => ({ ...c, kho_giao: kgOf(c.order_code) }));
  const all = withKg(cases);
  const cmp = compare && !compare.incomplete
    ? { ...compare, curCases: withKg(compare.curCases || []), prevCases: withKg(compare.prevCases || []) }
    : null;
  const total = moneySummary(all);
  let comparison = null;
  if (compare?.incomplete) comparison = { incomplete: true, compareLabel: compare.compareLabel };
  else if (cmp) {
    const a = moneySummary(cmp.curCases), b = moneySummary(cmp.prevCases);
    comparison = {
      mode: cmp.mode, currentLabel: cmp.currentLabel, compareLabel: cmp.compareLabel, cur: a, prev: b,
      amountDeltaPct: b.amount > 0 ? Math.round(((a.amount - b.amount) / b.amount) * 1000) / 10 : null,
    };
  }
  return {
    note: MONEY_NOTE,
    amountField: compAmountField(rawRows) || "comp_amount",
    total,
    compare: comparison,
    byProject: moneyRows(all, (c) => c.client_name || "Khác", cmp),
    byRoute: moneyRows(all, routeOf, cmp, (c) => ({ kho_lay: c?.kho_lay || "", kho_giao: c?.kho_giao || "" })).slice(0, ROUTES_MAX),
    routeCount: new Set(all.map(routeOf)).size,
  };
}

// ── Analysis ───────────────────────────────────────────────────────────
// Rillnet statuses that end a case (user 29/09): everything else is "còn mở".
const norm = (s) => String(s || "").toLowerCase().replace(/[—–-]+/g, "-").replace(/\s+/g, " ").trim();
const CLOSED = new Set([norm("Đã chốt — không truy thu"), norm("Hoàn tất kết luận QLRR")]);
export const isClosedStatus = (s) => CLOSED.has(norm(s));
// Which desk holds an open case (from the Rillnet status wording).
export function stageOf(status) {
  const s = norm(status);
  if (!s || s.includes("chưa tiếp nhận")) return "Chưa tiếp nhận";
  if (s.includes("ktc") || s.includes("kct")) return "KTC / KCT";
  if (s.includes("chờ om") || /\bom\b/.test(s)) return "OM";
  if (s.includes("cs")) return "CS";
  if (s.includes("miễn truy thu") || s.includes("duyệt")) return "Chờ duyệt";
  if (s.includes("đang mở")) return "Đang mở";
  return "Khác";
}
export const STAGE_ORDER = ["Chưa tiếp nhận", "Đang mở", "CS", "KTC / KCT", "OM", "Chờ duyệt", "Khác"];

/**
 * @param allCases  mọi ca (không theo bộ lọc tháng/ngày; đã theo dự án / điểm lấy / viewAs)
 *                  dạng detailedDamageCases + kho_giao của đơn
 * @param cases     ca của kỳ đang lọc (cho chặng nghi vấn theo tuyến)
 * @param today     yyyy-mm-dd (giờ VN)
 */
export function computeDamageAnalysis({ allCases = [], cases = [], kgOf = () => "", today }) {
  const withKg = (list) => list.map((c) => ({ ...c, kho_giao: c.kho_giao || kgOf(c.order_code), iso: caseIso(c) }));
  const everything = withKg(allCases);

  // (1) Ca còn mở
  const openList = everything
    .filter((c) => !isClosedStatus(c.rillnet_status))
    .map((c) => ({ ...c, days: c.iso ? Math.max(0, daysFrom(c.iso, today)) : null, stage: stageOf(c.rillnet_status) }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || String(a.order_code).localeCompare(String(b.order_code)));
  const byStage = {};
  const byStatus = {};
  for (const c of openList) {
    byStage[c.stage] = (byStage[c.stage] || 0) + 1;
    const st = c.rillnet_status || "(trống)";
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  const open = {
    total: openList.length,
    all: everything.length,
    closed: everything.length - openList.length,
    oldest: openList.find((c) => c.iso)?.iso || null,
    over30: openList.filter((c) => c.days != null && c.days > 30).length,
    byStage: STAGE_ORDER.filter((s) => byStage[s]).map((s) => ({ stage: s, count: byStage[s] })),
    byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count, stage: stageOf(status) })).sort((a, b) => b.count - a.count),
    money: moneySummary(openList),
    cases: openList.map(({ iso, truy_thu_status: _s, ...c }) => ({ ...c, case_iso: iso })),
  };

  // (2) Tuyến / khách còn tái phát — N tuần gần nhất (theo ngày ghi nhận ca)
  // so với toàn bộ giai đoạn trước đó (01/07 → trước N tuần).
  const recurrence = {};
  for (const n of RECUR_WEEKS) {
    const from = addDays(today, -(7 * n - 1));
    const beforeDays = Math.max(1, daysFrom(DATA_START, from));
    const r2 = (x) => Math.round(x * 100) / 100;
    const mk = (keyOf, isRoute) => {
      const m = new Map();
      for (const c of everything) {
        if (!c.iso || c.iso > today) continue;
        const k = keyOf(c);
        const g = m.get(k) || (isRoute ? { name: k, recent: 0, before: 0, last: "", codes: [], kho_lay: c.kho_lay || "", kho_giao: c.kho_giao || "" } : { name: k, recent: 0, before: 0, last: "", codes: [] });
        if (c.iso >= from) { g.recent++; g.codes.push(c.order_code); } else g.before++;
        if (c.iso > g.last) g.last = c.iso;
        m.set(k, g);
      }
      const list = [...m.values()].map((g) => ({
        ...g,
        recentPerWeek: r2(g.recent / n), beforePerWeek: r2((g.before / beforeDays) * 7),
        status: g.recent > 0 ? (g.before > 0 ? "recurring" : "new") : "stopped",
      }));
      return {
        active: list.filter((g) => g.recent > 0).sort((a, b) => b.recent - a.recent || b.before - a.before),
        stopped: list.filter((g) => g.status === "stopped" && g.before >= 2).sort((a, b) => b.before - a.before).slice(0, 8),
      };
    };
    const routes = mk(routeOf, true), clients = mk((c) => c.client_name || "Khác", false);
    recurrence[n] = {
      weeks: n, from, to: today, beforeFrom: DATA_START, beforeTo: addDays(from, -1), beforeWeeks: beforeDays / 7,
      recentCases: everything.filter((c) => c.iso && c.iso >= from && c.iso <= today).length,
      routes: { ...routes, active: routes.active.slice(0, ROUTES_MAX), activeCount: routes.active.length, recurringCount: routes.active.filter((g) => g.status === "recurring").length },
      clients: { ...clients, activeCount: clients.active.length, recurringCount: clients.active.filter((g) => g.status === "recurring").length },
    };
  }

  // (3) Chặng nghi vấn theo tuyến (kỳ đang lọc)
  const scoped = withKg(cases);
  const legTotals = {};
  const byRoute = new Map();
  for (const c of scoped) {
    const leg = c.damage_details || "(chưa rõ chặng)";
    legTotals[leg] = (legTotals[leg] || 0) + 1;
    const k = routeOf(c);
    const g = byRoute.get(k) || { name: k, kho_lay: c.kho_lay || "", kho_giao: c.kho_giao || "", cases: 0, legs: {} };
    g.cases++; g.legs[leg] = (g.legs[leg] || 0) + 1;
    byRoute.set(k, g);
  }
  const legs = Object.entries(legTotals).sort((a, b) => b[1] - a[1]).map(([leg, count]) => ({ leg, count, share: scoped.length ? Math.round((count / scoped.length) * 1000) / 1000 : 0 }));
  const legRoutes = [...byRoute.values()]
    .map((g) => {
      const top = Object.entries(g.legs).sort((a, b) => b[1] - a[1])[0] || [null, 0];
      return { ...g, topLeg: top[0], topShare: g.cases ? Math.round((top[1] / g.cases) * 1000) / 1000 : 0 };
    })
    .sort((a, b) => b.cases - a.cases || String(a.name).localeCompare(String(b.name)))
    .slice(0, LEG_ROUTES_MAX);

  return { today, open, recurrence, legs: { total: scoped.length, legs, routes: legRoutes, routeCount: byRoute.size } };
}

// ── B5 · Đối chiếu với trang Rillnet ───────────────────────────────────
// raw_compensation_summary (1 dòng) = các ô của Rillnet do scraper đọc:
//  - thẻ trang "📦 Báo cáo bể vỡ" trong khoảng ngày scraper quét (mọi khách):
//    case_count, compensated_count, truy_thu_count, truy_thu_amount,
//    range_from, range_to, scope ("all" | "dm");
//  - ô "📊 Tổng hợp" trang Đền bù / Truy thu (mọi khách, MỌI THỜI GIAN, các đơn
//    CS tick 💰): cs_tick_count, total_amount (tổng đền dự kiến),
//    total_chot_amount (tổng đền đã chốt), ops_* .
// Trước Kế hoạch E · phiên 1 các ô này đọc ra 0 / trống → "chưa đối chiếu được".
const num = (v) => {
  if (v === "" || v == null) return null;
  const t = String(v).trim();
  const n = typeof v === "number" ? v : /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, "")) : Number(t);
  return Number.isFinite(n) ? n : null;
};
const sumField = (list, f) => list.reduce((a, c) => a + (num(c[f]) || 0), 0);
export function reconcileRillnet({ summary, rawCases = [], dmCodes = new Set() }) {
  const row = summary || null;
  const from = row?.range_from ? isoOf(parseDate(row.range_from)) : "";
  const to = row?.range_to ? isoOf(parseDate(row.range_to)) : "";
  const inRange = (c) => { const d = caseIso(c); return (!from || d >= from) && (!to || d <= to); };
  const scopeDm = String(row?.scope || "").toLowerCase() === "dm";
  const side = (list) => {
    let compensated = 0, withAmount = 0, amount = 0, tt = 0, ttAmount = 0;
    for (const c of list) {
      const a = compAmount(c);
      if (isCompensated(c)) { compensated++; if (a > 0) withAmount++; }
      amount += a;
      if (truyThuOf(c) === "co") { tt++; ttAmount += truyThuAmount(c); }
    }
    return { cases: list.length, compensated, withAmount, amount, truyThu: tt, truyThuAmount: ttAmount };
  };
  const dmOf = (list) => list.filter((c) => dmCodes.has(String(c.order_code || "").trim()));
  const ranged = rawCases.filter(inRange);
  const all = side(ranged), dm = side(dmOf(ranged));
  const base = scopeDm ? dm : all;
  // Tổng hợp tiền: mọi thời gian, mọi khách (đúng phạm vi ô Rillnet).
  // Rillnet's Tổng hợp cards total only the orders CS ticked 💰 (sheet column
  // cs_tick, since 03/10) — compare like with like; the 3 "Chốt tiền"-only
  // orders no CS ticked made a false 34,5 tr mismatch on 03/10. Before the
  // column existed: all cases.
  const hasTick = rawCases.some((c) => String(c.cs_tick) === "1");
  const tickSet = hasTick ? rawCases.filter((c) => String(c.cs_tick) === "1") : rawCases;
  const hasDk = rawCases.some((c) => c.comp_amount_du_kien !== "" && c.comp_amount_du_kien != null);
  const hasChot = rawCases.some((c) => c.comp_amount_chot !== "" && c.comp_amount_chot != null);
  const dkAll = hasDk ? sumField(tickSet, "comp_amount_du_kien") : tickSet.reduce((a, c) => a + compAmount(c), 0);
  const chotAll = hasChot ? sumField(tickSet, "comp_amount_chot") : null;
  const r = row ? {
    syncedAt: row.synced_at || null,
    cases: num(row.case_count), compensated: num(row.compensated_count),
    truyThuCount: num(row.truy_thu_count) ?? num(row.ops_clawback_count), truyThuAmount: num(row.truy_thu_amount),
    csTick: num(row.cs_tick_count), totalAmount: num(row.total_amount), totalChot: num(row.total_chot_amount),
    unfinalized: num(row.ops_unfinalized_count), approved: num(row.ops_approved_count), rejected: num(row.ops_rejected_count),
    damageRate: row.damage_rate || null,
  } : null;
  const readable = !!r && ["cases", "compensated", "truyThuCount", "truyThuAmount", "csTick", "totalAmount", "totalChot"].some((k) => r[k]);
  const metric = (key, label, rv, dv, { money = false, period = "range" } = {}) => ({ key, label, rillnet: rv, dashboard: dv, diff: rv == null || !readable ? null : dv - rv, money, period });
  const rows = [
    metric("cases", "Ca bể vỡ", r?.cases ?? null, base.cases),
    metric("compensated", "Đơn đã chốt đền bù cho khách", r?.compensated ?? null, base.compensated),
    ...(SHOW_TRUY_THU ? [
      metric("truyThu", "Truy thu — số đơn đã chốt", r?.truyThuCount ?? null, base.truyThu),
      metric("truyThuAmount", "Truy thu — tiền dự tính", r?.truyThuAmount ?? null, base.truyThuAmount, { money: true }),
    ] : []),
    metric("totalAmount", hasDk ? "Tổng đền dự kiến (mọi thời gian)" : "Tổng tiền đền (mọi thời gian)", r?.totalAmount ?? null, dkAll, { money: true, period: "all" }),
    ...(r?.totalChot != null || chotAll != null ? [metric("totalChot", "Tổng đền đã chốt (mọi thời gian)", r?.totalChot ?? null, chotAll ?? 0, { money: true, period: "all" })] : []),
  ];
  return {
    readable,
    scope: scopeDm ? "dm" : "all",
    range: { from: from || null, to: to || null },
    rillnet: r,
    dashboardAll: all,
    dashboardDm: dm,
    // Cases behind the "đã chốt" total, to hunt a mismatch case by case.
    chotCases: rawCases.filter((c) => (num(c.comp_amount_chot) || 0) > 0)
      .map((c) => ({ order_code: String(c.order_code || "").trim(), client_name: c.client_name || "", amount: num(c.comp_amount_chot), at: c.comp_amount_at || "" })),
    rows,
    mismatches: rows.filter((x) => x.diff != null && Math.abs(x.diff) > (x.money ? 0.5 : 0)),
  };
}
