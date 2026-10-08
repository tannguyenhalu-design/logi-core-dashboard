/**
 * lib/ltl-dashboard.js
 * Pure computation behind GET /api/data — moved verbatim out of the route so
 * the snapshot builder (lib/ltl-snapshot.js) can precompute the default view
 * with exactly the same code path. Input is the already base-filtered LTL
 * snapshot (Điện Máy + từ 07/2026 + chỉ LTL), not raw Sheets rows.
 */
import { getCached, setCached } from "./mem-cache";
import { transformLTL, parseDate, getOntimeOutcome } from "./transform-ltl";
import { transformAIInsights, computeDamageCauseBreakdown } from "./transform-ai-insights";
import { computeDamageRisk } from "./damage-risk";
import { countedDamage } from "./damage-rules";
import { computeDamageMoney, computeDamageAnalysis, reconcileRillnet, caseView, caseIso } from "./damage-money";
import { computeExceptions } from "./exceptions";
import { buildWarehouseIndex, computeWarehouseLayer } from "./warehouse-layer";

// Warehouse name → map point index, rebuilt once per snapshot.
let whIndexCache = { builtAt: undefined, index: null };
function warehouseIndexFor(base) {
  if (!base.rawWarehouseAlias?.length) return null;
  if (whIndexCache.builtAt !== base.builtAt || !whIndexCache.index) {
    whIndexCache = { builtAt: base.builtAt, index: buildWarehouseIndex(base.rawWarehouses || [], base.rawWarehouseAlias, base.rawKhoGiaoTongTai || []) };
  }
  return whIndexCache.index;
}

// "Đơn chờ lấy (chưa chốt kỳ)": created but never picked up, so no
// pickup_time. isFromJuly2026("") lets them through the base filter, which
// made "Tất cả" count them while every per-month view (getMonth(null))
// dropped them — "Tất cả" ≠ sum of months (1.072 orders, found 2026-09-22).
export function isPendingPickup(row) {
  return !String(row["pickup_time"] ?? "").trim();
}

// "Đơn treo / cần chú ý" (user decision 2026-09-26): picked up, not in a
// final state, and already past its SLA. deadline_plus is a date
// ("2026-08-18 0:00:00") — delivering ON that date counts as ontime
// (checked: 31,450/31,450 delivered orders agree with GHN's odr_success),
// so an open order is overdue from the day after. Same rule as the "late"
// flag GHN puts on undelivered orders, but evaluated today, not at export.
// lost/damage are closed outcomes (handled via claims), not orders to chase
// — excluded by user decision 2026-09-26.
const FINAL_STATUSES = new Set(["delivered", "returned", "cancel", "lost", "damage"]);
export const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
export function stuckOverdueDays(row, today) {
  if (isPendingPickup(row)) return null;
  if (FINAL_STATUSES.has(String(row["status"] || "").trim().toLowerCase())) return null;
  const dl = String(row["deadline_plus"] || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dl) || dl >= today) return null;
  return Math.round((Date.parse(today) - Date.parse(dl)) / 86400000);
}

// "Đến hạn hôm nay" quick filter: open order whose SLA date is today —
// tomorrow it becomes a stuck order if still not delivered.
export function isDueToday(row, today) {
  if (isPendingPickup(row)) return false;
  if (FINAL_STATUSES.has(String(row["status"] || "").trim().toLowerCase())) return false;
  return String(row["deadline_plus"] || "").slice(0, 10) === today;
}

// KPI sparklines: the 7 most recent pickup days in the data (not the month
// filter — "where is it heading now"), scoped by project/origin/viewAs.
// On-time for the newest days is incomplete (orders still in transit).
function computeSparkline(rows, damageRows, { projects, origin }) {
  let end = "";
  for (const r of rows) { const d = String(r.pickup_time || "").slice(0, 10); if (d > end) end = d; }
  if (!end) return null;
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(new Date(Date.parse(end) - i * 86400000).toISOString().slice(0, 10));
  const idx = new Map(days.map((d, i) => [d, i]));
  const acc = days.map((date) => ({ date, orders: 0, grams: 0, ontime: 0, late: 0, damaged: 0 }));
  const inScope = (r) => (!projects?.length || projects.includes(r.client_name))
    && (!origin || String(r.from_province_name || "").trim() === origin);
  const scopedCodes = new Set();
  for (const r of rows) {
    if (!inScope(r)) continue;
    scopedCodes.add(String(r.order_code || "").trim());
    const i = idx.get(String(r.pickup_time || "").slice(0, 10));
    if (i === undefined) continue;
    const a = acc[i];
    a.orders++;
    a.grams += parseFloat(r.weight) || 0;
    const o = getOntimeOutcome(r);
    if (o === "ontime") a.ontime++; else if (o === "late") a.late++;
  }
  // Damage is reported days after pickup, so it is dated by the Rillnet case
  // date (same basis as the "Ca hư hỏng" KPI), not by the order's pickup day.
  for (const d of damageRows) {
    if (!scopedCodes.has(String(d.order_code || "").trim())) continue;
    const m = String(d.case_date || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})|^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) continue;
    const key = m[1] ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : `${m[4]}-${m[5]}-${m[6]}`;
    const i = idx.get(key);
    if (i !== undefined) acc[i].damaged++;
  }
  return {
    days: acc.map((a) => ({
      date: a.date, orders: a.orders, late: a.late, damaged: a.damaged, weightKg: Math.round(a.grams / 1000),
      ontimePct: a.ontime + a.late > 0 ? Math.round((a.ontime / (a.ontime + a.late)) * 1000) / 10 : null,
    })),
    // Orders picked up in the last 2 days mostly have no delivery result yet.
    incompleteFrom: days[5],
  };
}

// % hư hỏng for the overview trend chart (user decision 2026-09-27): cases by
// Rillnet detection date / orders picked up (LTC) by pickup date — the company
// report definition (denominator changed from delivered on 28/09) — bucketed like the chart: calendar month, or week of
// the month (1–7, 8–14, 15–21, 22–end) when one month is selected. Covers
// every order in scope, not only those picked up in the bucket, so a case
// found in September on an August pickup still counts in September.
function computeDamageTrend(rows, damageRows, { months, dateFrom, dateTo }) {
  const weekly = Array.isArray(months) && months.length === 1;
  const day = (v) => {
    const s = String(v || "");
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})|^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    return m[1] ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : `${m[4]}-${m[5]}-${m[6]}`;
  };
  const keyOf = (d) => {
    if (!d || d < DATA_START) return null;
    if (dateFrom && d < dateFrom) return null;
    if (dateTo && d > dateTo) return null;
    const mo = Number(d.slice(5, 7)), dd = Number(d.slice(8, 10));
    if (weekly) return mo === months[0] ? (dd <= 7 ? 1 : dd <= 14 ? 2 : dd <= 21 ? 3 : 4) : null;
    if (Array.isArray(months) && months.length && !months.includes(mo)) return null;
    return mo;
  };
  const out = {};
  // Denominator = orders picked up (# đơn LTC, by pickup date) — company report
  // definition since 28/09 (was orders delivered by delivery date). Field name
  // `gtc` kept for the chart component.
  const cell = (k) => (out[k] = out[k] || { cases: 0, gtc: 0 });
  const codes = new Set();
  for (const r of rows) {
    codes.add(String(r.order_code || "").trim());
    const k = keyOf(day(r.pickup_time));
    if (k != null) cell(k).gtc++;
  }
  for (const c of damageRows) {
    if (!codes.has(String(c.order_code || "").trim())) continue;
    const k = keyOf(day(c.case_date));
    if (k != null) cell(k).cases++;
  }
  return out;
}

export function isDefaultQuery(params) {
  return !params.months && !params.projects && params.filterMode === "pickup"
    && params.viewAsType === "manager" && !params.viewAsValue
    && !params.dateFrom && !params.dateTo && !params.origin
    && params.periodWeeks === "mtd" && !params.province && !params.pendingList && !params.stuckList && !params.dueTodayList
    && params.role !== "client";
}

// Role-dependent tweaks applied on top of a computed body — kept separate so
// the precomputed default body (built without a session) gets exactly the
// same per-role treatment as a live-computed one.
export function applyRoleToBody(body, { role, userProject, userPic }) {
  const out = { ...body, user: { role, project: userProject, pic: userPic } };
  // Money / case analysis of the damage tab: internal only (Kế hoạch E).
  if (role === "client") { delete out.damageMoney; delete out.damageAnalysis; }
  const canSeeRevenue = role === "manager" || role === "sd3";
  if (!canSeeRevenue) {
    const ltl = { ...out.ltl, totalRevenue: 0, totalPlan: 0 };
    if (ltl.projects) {
      ltl.projects = ltl.projects.map((p) => ({ ...p, revenue: 0, plan: 0, lastMoNsr: 0, revenueAchievement: 0 }));
    }
    if (ltl.volumeByMonth) {
      ltl.volumeByMonth = ltl.volumeByMonth.map((m) => ({ ...m, revenue: 0 }));
    }
    out.ltl = ltl;
  }
  return out;
}

// ── KPI delta vs "kỳ trước", following the active filter (chosen 2026-09-26):
//  - no month/date filter → the existing "So sánh cùng kỳ" window (MTD or
//    1-3 week block, periodComparison) so the page has one definition;
//  - contiguous month(s) → the same number of months just before; if the
//    selection includes the current month, the previous period is cut to the
//    same day-of-month (the current one only has data up to today);
//  - date range → the same-length range just before.
// Previous periods starting before the data window (07/2026) are flagged
// incomplete instead of shown as a misleading jump.
const DATA_START = "2026-07-01";
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fmtDM = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function pctChange(cur, prev) {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
}

function buildDelta(cur, prev, meta) {
  return {
    ...meta,
    orders: { cur: cur.totalOrders, prev: prev.totalOrders, deltaPct: pctChange(cur.totalOrders, prev.totalOrders) },
    ontime: {
      cur: cur.ontimePct, prev: prev.ontimePct,
      deltaPoints: cur.ontimePct != null && prev.ontimePct != null ? Math.round((cur.ontimePct - prev.ontimePct) * 10) / 10 : null,
    },
    late: { cur: cur.lateCount, prev: prev.lateCount, deltaPct: pctChange(cur.lateCount, prev.lateCount) },
    damage: { cur: cur.totalBroken, prev: prev.totalBroken, deltaPct: pctChange(cur.totalBroken, prev.totalBroken) },
    weight: { cur: cur.totalWeight, prev: prev.totalWeight, deltaPct: pctChange(cur.totalWeight, prev.totalWeight) },
  };
}

// On-time anomaly badge (user decision 2026-09-26): a project whose on-time
// rate fell >= 10 points vs the same "kỳ trước" as the KPI delta, with at
// least 5 evaluated orders on both sides (fewer is noise, not a signal).
const ANOMALY_DROP_POINTS = 10;
const ANOMALY_MIN_SAMPLE = 5;

function projectDrops(curByProject, prevByProject) {
  const pct = (o, n) => Math.round((o / n) * 1000) / 10;
  const out = [];
  for (const [name, c] of Object.entries(curByProject || {})) {
    const p = prevByProject?.[name];
    if (!p) continue;
    const curN = c.ontime + c.late, prevN = p.ontime + p.late;
    if (curN < ANOMALY_MIN_SAMPLE || prevN < ANOMALY_MIN_SAMPLE) continue;
    const cur = pct(c.ontime, curN), prev = pct(p.ontime, prevN);
    const deltaPoints = Math.round((cur - prev) * 10) / 10;
    if (deltaPoints <= -ANOMALY_DROP_POINTS) out.push({ name, cur, prev, curN, prevN, deltaPoints });
  }
  return out.sort((a, b) => a.deltaPoints - b.deltaPoints);
}

// KPI delta + on-time anomalies share one "kỳ trước" (computed once).
function computeComparisons(base, params, ltlData) {
  const { months, dateFrom, dateTo, filterMode } = params;
  const current = {
    totalOrders: ltlData.totalOrders,
    ontimePct: ltlData.evalCount > 0 ? ltlData.ontimePct : null,
    lateCount: ltlData.lateCount,
    totalBroken: ltlData.totalBroken,
    totalWeight: ltlData.totalWeight,
  };
  const kpiFor = (over) => computeDashboard(base, { ...params, ...over, kpiOnly: true, province: null, pendingList: false, stuckList: false, dueTodayList: false });
  const none = { kpiDelta: null, anomalies: null };
  const incomplete = (compareLabel) => {
    const out = { kpiDelta: { mode: "period", compareLabel, incomplete: true }, anomalies: null };
    Object.defineProperty(out, "moneyPrev", { value: { compareLabel, incomplete: true }, enumerable: false });
    return out;
  };
  const vsPeriod = (prev, meta) => {
    const out = {
      kpiDelta: buildDelta(current, prev, meta),
      anomalies: { compareLabel: meta.compareLabel, items: projectDrops(ltlData.ontimeByProject, prev.ontimeByProject) },
    };
    // Prev-period cases for the damage-money comparison (Kế hoạch E) — kept
    // off the spread into the body.
    Object.defineProperty(out, "moneyPrev", { value: { compareLabel: meta.compareLabel, cases: prev.damageCases || [] }, enumerable: false });
    return out;
  };

  if (!months && !dateFrom && !dateTo) {
    const pc = ltlData.periodComparison;
    if (filterMode !== "pickup" || !pc?.overall) return none;
    const c = pc.overall.cur, p = pc.overall.prev;
    const asKpi = (x) => ({ totalOrders: x.orders, ontimePct: x.ontimePct, lateCount: x.lateCount, totalBroken: x.damageCount, totalWeight: x.weight });
    const asCounts = (x) => ({ ontime: x.ontimeCount, late: x.evalCount - x.ontimeCount });
    const curBy = {}, prevBy = {};
    for (const cl of pc.clients || []) { curBy[cl.name] = asCounts(cl.cur); prevBy[cl.name] = asCounts(cl.prev); }
    return {
      kpiDelta: buildDelta(asKpi(c), asKpi(p), { mode: "window", currentLabel: pc.currentRangeLabel, compareLabel: pc.previousRangeLabel }),
      anomalies: { compareLabel: pc.previousRangeLabel, items: projectDrops(curBy, prevBy) },
    };
  }

  if (dateFrom && dateTo && !months) {
    const from = new Date(dateFrom + "T00:00:00Z"), to = new Date(dateTo + "T00:00:00Z");
    const len = Math.round((to - from) / 86400000) + 1;
    if (!(len > 0)) return none;
    const prevTo = new Date(from.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (len - 1) * 86400000);
    const pf = prevFrom.toISOString().slice(0, 10), pt = prevTo.toISOString().slice(0, 10);
    const compareLabel = `${fmtDM(pf)} – ${fmtDM(pt)}`;
    if (pf < DATA_START) return incomplete(compareLabel);
    return vsPeriod(kpiFor({ dateFrom: pf, dateTo: pt }), { mode: "period", compareLabel });
  }

  if (months && !dateFrom && !dateTo) {
    const sorted = [...months].sort((a, b) => a - b);
    const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
    if (!contiguous) return none;
    const n = sorted.length;
    const prevMonths = sorted.map((m) => m - n);
    const vn = new Date(Date.now() + 7 * 3600 * 1000);
    const year = vn.getUTCFullYear(), curMonth = vn.getUTCMonth() + 1, today = vn.getUTCDate();
    const label = prevMonths.length === 1 ? `T${prevMonths[0]}` : `T${prevMonths[0]}–T${prevMonths[n - 1]}`;
    if (prevMonths[0] < 1 || ymd(year, prevMonths[0], 1) < DATA_START) return incomplete(label);
    if (sorted[n - 1] === curMonth) {
      const lastPrev = prevMonths[n - 1];
      const endDay = Math.min(today, daysInMonth(year, lastPrev));
      const pf = ymd(year, prevMonths[0], 1), pt = ymd(year, lastPrev, endDay);
      return vsPeriod(kpiFor({ months: prevMonths, dateFrom: pf, dateTo: pt }), {
        mode: "period", compareLabel: `${label} (${fmtDM(pf)} – ${fmtDM(pt)})`,
      });
    }
    return vsPeriod(kpiFor({ months: prevMonths }), { mode: "period", compareLabel: label });
  }
  return none;
}

function summarizeStuck(rows, today) {
  const byAge = { "1-3": 0, "4-7": 0, ">7": 0 };
  const byClient = {};
  let totalWeight = 0;
  for (const r of rows) {
    const d = stuckOverdueDays(r, today);
    byAge[d <= 3 ? "1-3" : d <= 7 ? "4-7" : ">7"]++;
    byClient[r.client_name] = (byClient[r.client_name] || 0) + 1;
    totalWeight += (parseFloat(r.weight) || 0) / 1000;
  }
  const topClients = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { count: rows.length, totalWeight, byAge, topClients };
}

/**
 * @param base   { ltlRows, rawMapping, rawDamageCauses, rawCompensationSummary, builtAt }
 * @param params parsed query + session scope (see pages/api/data.js)
 * @returns body without `user` (see applyRoleToBody), or
 *          { ok, provinceOrders } / { ok, pendingOrders } for drill-downs
 */
export function computeDashboard(base, params) {
  const { role, userPic, projects, filterMode, periodWeeks, origin, months, dateFrom, dateTo } = params;
  let { viewAsType, viewAsValue } = params;
  const v = base.builtAt || "live";
  const scopeKey = `${v}:${role}:${userPic || ""}:${viewAsType}:${viewAsValue || ""}`;

  let filteredLTL = base.ltlRows;
  const rawMapping = base.rawMapping || [];
  // Only cases in Rillnet's "Báo cáo bể vỡ" list count (lib/damage-rules.js).
  const rawDamageCauses = countedDamage(base.rawDamageCauses || []);
  const rawCompensationSummary = base.rawCompensationSummary || [];
  const rawDamageCsTick = base.rawDamageCsTick || [];

  // ── Damage source: Rillnet (raw_damage_causes), not raw_damage ──
  // Rillnet tracks breakage/hư hỏng across ALL of GHN's ops (Điện Máy,
  // Mondelez, Supra, other food/retail clients), not just this app's
  // scope — matching purely on client_name would both miss real Điện Máy
  // cases (name variants) and let non-Điện-Máy ones through. Joining on
  // order_code against filteredLTL (already scoped to Điện Máy + LTL +
  // from July 2026) is the reliable filter: if the order isn't a real
  // Điện Máy LTL order, its damage case doesn't belong on this dashboard,
  // no matter what raw_damage_causes' own client_name says.
  const dmOrderCodes = new Set(filteredLTL.map(r => String(r["order_code"] || "").trim()).filter(Boolean));
  // Rillnet's own client_name for a case can be the client's bare/legacy
  // name ("PSD") while the real order in raw_ontime uses a region-split
  // name ("PSD Miền Nam"/"PSD Miền Trung") — confirmed live: 6 real PSD
  // cases all recorded under bare "PSD", which doesn't match any real
  // client_name, so they formed their own disconnected 0-order "PSD"
  // bucket in every per-client damage breakdown instead of counting
  // against the real client. Prefer the order's own client_name (same
  // 1:1 order_code join already used to scope dmOrderCodes above).
  const clientNameByOrderCode = new Map();
  filteredLTL.forEach(r => {
    const code = String(r["order_code"] || "").trim();
    if (code && !clientNameByOrderCode.has(code)) clientNameByOrderCode.set(code, r["client_name"] || "");
  });
  let filteredDamage = rawDamageCauses
    .filter(r => dmOrderCodes.has(String(r["order_code"] || "").trim()))
    .map(r => ({
      ...r,
      client_name: clientNameByOrderCode.get(String(r["order_code"] || "").trim()) || r["client_name"],
      damage_type: r["type"] || r["damage_type"],
      // Rillnet calls this "detected_at_warehouse" — alias to the field
      // name raw_damage used, since warehouse-risk scoring and the
      // detail table both read "warehouse_giao" specifically.
      warehouse_giao: r["warehouse_giao"] || r["detected_at_warehouse"] || "",
      // raw_damage had a free-text "damage_details" field Rillnet doesn't
      // — "suspected_leg" ("Trung chuyển → Kho giao" etc.) is Rillnet's
      // own per-case root-cause field, more useful here than blank.
      damage_details: r["damage_details"] || r["suspected_leg"] || "",
    }));

  // Rillnet's damage_causes rows are project-agnostic by default — filter
  // by selected project the same case-insensitive way transformLTL's own
  // passProjectDmg does (raw_damage_causes' client_name casing/splits
  // don't always match the project list either), so the headline "Ca Hư
  // Hỏng" total stays consistent with whatever project filter is active.
  let filteredDamageCauses = filteredDamage;
  if (projects && projects.length > 0) {
    filteredDamageCauses = filteredDamageCauses.filter(r => {
      const dmgName = String(r["client_name"] || "").trim().toLowerCase();
      if (!dmgName) return false;
      return projects.some((p) => {
        const proj = String(p || "").trim().toLowerCase();
        return proj === dmgName || proj.includes(dmgName) || dmgName.includes(proj);
      });
    });
  }

  // Build the PIC mapping object
  const picMapping = {};
  rawMapping.forEach(row => {
    if (row.client_name && row.PIC) {
      picMapping[row.client_name] = row.PIC;
    }
  });

  // ── Apply Security / ViewAs Filtering ──
  // "cs" used to be scoped to only its own PIC's clients here (matching
  // picMapping from a "mapping" sheet under SHEET_ID_LTL) — that env var
  // was never actually configured in production, so picMapping was
  // silently empty and every cs-role user saw a completely blank
  // dashboard (confirmed live, 2026-08-17). Rather than stand up the
  // missing data source, cs is now intentionally unscoped — sees every
  // project the same as sd3, restricted instead at the UI/component
  // level (no revenue figures, no AI chat).
  if (role === "manager" && viewAsType === "cs" && viewAsValue) {
    filteredLTL = filteredLTL.filter(r => picMapping[r.client_name] === viewAsValue);
    filteredDamage = filteredDamage.filter(r => picMapping[r.client_name] === viewAsValue);
  } else if (role === "manager" && viewAsType === "project" && viewAsValue) {
    filteredLTL = filteredLTL.filter(r => r.client_name === viewAsValue);
    filteredDamage = filteredDamage.filter(r => r.client_name === viewAsValue);
  }

  // Pending-pickup orders have no date, so the month/date filters can never
  // place them — scoped only by viewAs (above) and project/origin (below).
  const pendingAll = filteredLTL.filter(isPendingPickup);
  // Stuck orders are a "right now" list like pending — an order picked up
  // in August and still undelivered matters whatever month is selected.
  const today = vnToday();
  const stuckAll = params.kpiOnly ? [] : filteredLTL.filter((r) => stuckOverdueDays(r, today) != null);
  const dueAll = params.kpiOnly ? [] : filteredLTL.filter((r) => isDueToday(r, today));
  const sparkRows = filteredLTL;
  const sparkDamage = filteredDamage;

  // ── Date range filter (dateFrom / dateTo) ──
  if (dateFrom || dateTo) {
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toMs   = dateTo   ? new Date(dateTo + "T23:59:59").getTime() : Infinity;

    const inRange = (dateStr) => {
      const d = parseDate(dateStr);
      if (!d) return false;
      const ms = d.getTime();
      return !isNaN(ms) && ms >= fromMs && ms <= toMs;
    };

    filteredLTL    = filteredLTL.filter(r    => inRange(r["pickup_time"] || r["date"]));
    filteredDamage = filteredDamage.filter(r  => inRange(r["pickup_time"] || r["case_date"]));
  }

  const transformOpts = { months, projects, filterMode, periodWeeks, origin };
  // Unchanged input for AI insights: its breakage-rate denominators and
  // pending-capacity (ready_to_pick/storing/picking) logic were built on
  // this exact row set, so it keeps receiving it.
  const ltlFull = transformLTL(filteredLTL, transformOpts, filteredDamage);
  // Everything displayed (KPI, map, charts, drill-downs) excludes pending
  // orders so "Tất cả" = sum of months. Only re-run when pending rows
  // actually made it into this view (only with no month/date filter).
  const ltlData = ltlFull.filteredRows.some(isPendingPickup)
    ? transformLTL(filteredLTL.filter(r => !isPendingPickup(r)), transformOpts, filteredDamage)
    : ltlFull;

  if (params.kpiOnly) {
    return {
      totalOrders: ltlData.totalOrders,
      ontimePct: ltlData.evalCount > 0 ? ltlData.ontimePct : null,
      lateCount: ltlData.lateCount,
      totalBroken: ltlData.totalBroken,
      totalWeight: ltlData.totalWeight,
      ontimeByProject: ltlData.ontimeByProject,
      // Server-only (never serialized): prev-period cases for damageMoney.
      damageCases: ltlData.detailedDamageCases,
    };
  }

  const pendingScoped = transformLTL(pendingAll, { projects, filterMode: "pickup", origin }, []).filteredRows;
  const stuckScoped = transformLTL(stuckAll, { projects, filterMode: "pickup", origin }, []).filteredRows;
  const dueScoped = transformLTL(dueAll, { projects, filterMode: "pickup", origin }, []).filteredRows;

  if (params.dueTodayList) {
    const dueTodayOrders = dueScoped.map((r) => ({
      order_code: r.order_code,
      client_name: r.client_name,
      status: r.status,
      pickup_time: r.pickup_time,
      deadline: String(r.deadline_plus || "").slice(0, 10),
      from_province_name: r.from_province_name,
      to_province_name: r.to_province_name,
      kho_giao: r.kho_giao,
      weight: r.weight,
    })).sort((a, b) => String(a.pickup_time).localeCompare(String(b.pickup_time)));
    return { ok: true, dueTodayOrders };
  }

  if (params.stuckList) {
    const stuckOrders = stuckScoped.map((r) => ({
      order_code: r.order_code,
      client_name: r.client_name,
      status: r.status,
      pickup_time: r.pickup_time,
      deadline: String(r.deadline_plus || "").slice(0, 10),
      overdueDays: stuckOverdueDays(r, today),
      from_province_name: r.from_province_name,
      to_province_name: r.to_province_name,
      kho_giao: r.kho_giao,
      weight: r.weight,
    })).sort((a, b) => b.overdueDays - a.overdueDays);
    return { ok: true, stuckOrders };
  }

  if (params.pendingList) {
    const pendingOrders = pendingScoped.map((r) => ({
      order_code: r.order_code,
      client_name: r.client_name,
      status: r.status,
      created_time: r.created_time,
      from_province_name: r.from_province_name,
      to_province_name: r.to_province_name,
      weight: r.weight,
    }));
    return { ok: true, pendingOrders };
  }

  // ── Province drill-down (modal "Chi tiết đơn hàng") — a tiny, on-demand
  // slice of the SAME already-filtered rows, requested only when the user
  // actually clicks a province. Returns early, skipping the (unneeded for
  // this) aiInsights/overview work below, so the NORMAL response never has
  // to carry the full ~23k-row filteredRows array.
  if (params.province) {
    const province = String(params.province).trim();
    const provinceOrders = (ltlData.filteredRows || [])
      .filter((r) =>
        String(r.from_province_name || "").trim() === province ||
        String(r.to_province_name || "").trim() === province
      )
      .map((r) => ({
        order_code: r.order_code,
        client_name: r.client_name,
        from_province_name: r.from_province_name,
        to_province_name: r.to_province_name,
        weight: r.weight,
        odr_success: r.odr_success,
        status: r.status,
        outcome: getOntimeOutcome(r), // "ontime" | "late" | null (return/cancel, or no result yet) — company-report rule 28/09
      }));
    return { ok: true, provinceOrders };
  }

  // breakageRoutes/avgDmgRate depend on the project filter — previously
  // always computed system-wide regardless of the selected project, which
  // meant filtering to e.g. "Casper" still showed every other client's
  // routes underneath a narrative that WAS correctly Casper-specific
  // (damageCauses, below). Reuse transformLTL's own already project-
  // filtered `filteredRows`, and the project-filtered damage set, so both
  // panels agree on what's actually in scope.
  // Key must include every filter that changes ltlFull.filteredRows — it
  // used to omit months/dates/filterMode/origin, so whichever filter was
  // requested first after an instance started got served for all of them
  // (the breakage panel ignored the month picker; fixed 2026-09-26).
  const aiInsightsKey = `data:aiInsights:${scopeKey}:${periodWeeks}:${filterMode}:${(months || []).join(",")}:${dateFrom || ""}:${dateTo || ""}:${origin || ""}:${(projects || []).join(",")}`;
  let aiInsights = getCached(aiInsightsKey);
  if (!aiInsights) {
    aiInsights = transformAIInsights(ltlFull.filteredRows, filteredDamageCauses, periodWeeks);
    setCached(aiInsightsKey, aiInsights);
  }
  // damageCauses depends on the project filter (unlike the rest of
  // aiInsights) — cached separately, keyed on projects too.
  const damageCausesKey = `data:damageCauses:${scopeKey}:${(projects || []).join(",")}`;
  let damageCauses = getCached(damageCausesKey);
  if (!damageCauses) {
    damageCauses = computeDamageCauseBreakdown(filteredDamageCauses);
    setCached(damageCausesKey, damageCauses);
  }
  // Compensation summary (Rillnet's "Đền bù / Truy thu" > "Tổng hợp") is a
  // single company-wide aggregate row, not broken down per project/client
  // in the source page itself — shown as-is regardless of project filter.
  // csTickCases: per-case CS tick data synced directly from Rillnet _LB (Cách A, 04/10/2026).
  // csTickCount falls back to the summary row (from truythu page) when the new sheet is empty.
  const csTickCases = rawDamageCsTick;
  const compensationSummary = rawCompensationSummary?.[0]
    ? {
        csTickCount: csTickCases.length || Number(rawCompensationSummary[0]["cs_tick_count"]) || 0,
        csTickCaseCount: csTickCases.length,
        opsUnfinalizedCount: Number(rawCompensationSummary[0]["ops_unfinalized_count"]) || 0,
        opsApprovedCount: Number(rawCompensationSummary[0]["ops_approved_count"]) || 0,
        opsRejectedCount: Number(rawCompensationSummary[0]["ops_rejected_count"]) || 0,
        opsClawbackCount: Number(rawCompensationSummary[0]["ops_clawback_count"]) || 0,
        totalAmount: Number(rawCompensationSummary[0]["total_amount"]) || 0,
      }
    : csTickCases.length
      ? { csTickCount: csTickCases.length, csTickCaseCount: csTickCases.length }
      : null;
  aiInsights = { ...aiInsights, damageCauses, compensationSummary };

  // ── Overview: all-time totals (no project/month filter, but applies
  // security filter) — same cache-by-scope treatment as above.
  const overviewKey = `data:overview:${scopeKey}:${filterMode}`;
  let overview = getCached(overviewKey);
  if (!overview) {
    const overviewLTL = transformLTL(filteredLTL, { filterMode }, filteredDamage);
    overview = {
      ltl: {
        totalOrders: overviewLTL.totalOrders,
        totalWeight: overviewLTL.totalWeight,
        ontimePct: overviewLTL.ontimePct,
        totalBroken: overviewLTL.totalBroken,
      },
    };
    setCached(overviewKey, overview);
  }

  // Only ever needed server-side — never send ~23k raw rows to the browser
  // (was ~22MB of a ~25MB response before 2026-09-17).
  // Per-project table counts CASES exactly like "Hiệu suất dự án" (user 28/09).
  const projectCases = {};
  for (const ps of Object.values(ltlData.projectSummaries || {})) projectCases[String(ps.name || "").trim()] = ps.damageCount || 0;
  const damageRisk = computeDamageRisk(ltlData.filteredRows || [], filteredDamageCauses, { projectCases });
  const { filteredRows: _omit, ...ltlForClient } = ltlData;
  // "Kho" layer of the map (Kế hoạch D · 2a) — only the map reads it, so it
  // is computed here just for the stored default body (withWarehouses); any
  // other view computes it on the first map request (addWarehouseLayer),
  // keeping the normal /api/data as fast as before.
  if (params.withWarehouses) ltlForClient.warehouseLayer = warehouseLayerOf(base, ltlData.filteredRows, filterMode);

  const pendingByStatus = {};
  let pendingWeight = 0;
  pendingScoped.forEach((r) => {
    const st = String(r.status || "(trống)").trim() || "(trống)";
    pendingByStatus[st] = (pendingByStatus[st] || 0) + 1;
    pendingWeight += (parseFloat(r.weight) || 0) / 1000;
  });

  const comparisons = computeComparisons(base, params, ltlData);
  // "Cần can thiệp ngay hôm nay" — same scope as the Cần chú ý row
  // (project / origin / viewAs, not the month filter).
  const inScope = (r) => (!projects?.length || projects.includes(r.client_name))
    && (!origin || String(r.from_province_name || "").trim() === origin);
  const damageTrend = computeDamageTrend(sparkRows.filter(inScope), sparkDamage, { months, dateFrom, dateTo });
  const exceptions = computeExceptions({
    stuck: stuckScoped, due: dueScoped, rows: sparkRows.filter(inScope), damage: sparkDamage,
    drops: comparisons.anomalies?.items, dropsLabel: comparisons.anomalies?.compareLabel, today, overdueDays: stuckOverdueDays,
  });

  // ── Tiền đền cho khách + phân tích ca (Kế hoạch E · phiên 2) — chỉ thêm
  // trường mới, không đổi số ca / % bể vỡ / on-time.
  const { damageMoney, damageAnalysis } = computeDamageExtras(base, {
    params, ltlData, comparisons, sparkDamage, rawDamageCauses, dmOrderCodes, today,
  });

  // Daily pickup volume for campaign/event forecast (project/PIC/origin filtered, NOT month-filtered)
  const _dailyByDay = {};
  const _dailyWeightByDay = {};
  const _dailyByClient = {};
  const _dailyByProvince = {};       // { date: { province: count } }
  const _dailyWeightByProvince = {}; // { date: { province: kg } }
  const _dailyByKhoLay = {};         // { date: { kho_lay: count } }
  sparkRows.forEach((r) => {
    const d = String(r.pickup_time || "").slice(0, 10);
    if (!d || d.length < 10) return;
    const kg = (parseFloat(r["weight"]) || 0) / 1000; // grams → kg
    _dailyByDay[d] = (_dailyByDay[d] || 0) + 1;
    _dailyWeightByDay[d] = (_dailyWeightByDay[d] || 0) + kg;
    const proj = r.client_name || "Unknown";
    if (!_dailyByClient[d]) _dailyByClient[d] = {};
    _dailyByClient[d][proj] = (_dailyByClient[d][proj] || 0) + 1;
    const prov = String(r.to_province_name || "Khác").trim();
    if (!_dailyByProvince[d]) _dailyByProvince[d] = {};
    _dailyByProvince[d][prov] = (_dailyByProvince[d][prov] || 0) + 1;
    if (!_dailyWeightByProvince[d]) _dailyWeightByProvince[d] = {};
    _dailyWeightByProvince[d][prov] = (_dailyWeightByProvince[d][prov] || 0) + kg;
    const kho = String(r.kho_lay || r.warehouse_lay || "Khác").trim() || "Khác";
    if (!_dailyByKhoLay[d]) _dailyByKhoLay[d] = {};
    _dailyByKhoLay[d][kho] = (_dailyByKhoLay[d][kho] || 0) + 1;
  });

  const body = {
    ok: true,
    picMapping,
    filters: { months, projects, filterMode, dateFrom, dateTo },
    viewAs: { type: viewAsType, value: viewAsValue },
    ltl: ltlForClient,
    pendingPickup: { count: pendingScoped.length, totalWeight: pendingWeight, byStatus: pendingByStatus },
    stuck: summarizeStuck(stuckScoped, today),
    damageRisk,
    dueToday: { count: dueScoped.length },
    sparkline: computeSparkline(sparkRows, sparkDamage, { projects, origin }),
    ...comparisons,
    exceptions,
    damageTrend,
    aiInsights,
    damageMoney,
    damageAnalysis,
    dailyOrders: { byDay: _dailyByDay, weightByDay: _dailyWeightByDay, byClientAndDay: _dailyByClient, byProvinceAndDay: _dailyByProvince, weightByProvinceAndDay: _dailyWeightByProvince, byKhoLayAndDay: _dailyByKhoLay },
    overview: {
      ...overview,
      allProjectsLTL: ltlData.allProjects,
    },
    dataAsOf: base.builtAt || null,
  };
  // Same rows, kept off the JSON (non-enumerable) for addWarehouseLayer.
  if (!params.withWarehouses) Object.defineProperty(body, "__rows", { value: ltlData.filteredRows || [], enumerable: false });
  return body;
}

// order_code → order row of the snapshot (kho giao of the ORDER, not the
// Rillnet detection warehouse), built once per snapshot.
let orderIdx = { builtAt: undefined, map: null };
function orderIndexFor(base) {
  if (orderIdx.map && orderIdx.builtAt === base.builtAt && orderIdx.rows === base.ltlRows) return orderIdx.map;
  const map = new Map();
  for (const r of base.ltlRows || []) {
    const code = String(r.order_code || "").trim();
    if (code && !map.has(code)) map.set(code, r);
  }
  orderIdx = { builtAt: base.builtAt, rows: base.ltlRows, map };
  return map;
}

const projectMatch = (projects, name) => {
  if (!projects || projects.length === 0) return true;
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  return projects.some((p) => { const q = String(p || "").trim().toLowerCase(); return q === n || q.includes(n) || n.includes(q); });
};

function computeDamageExtras(base, { params, ltlData, comparisons, sparkDamage, rawDamageCauses, dmOrderCodes, today }) {
  const { projects, origin, months, dateFrom, dateTo } = params;
  const idx = orderIndexFor(base);
  const kgOf = (code) => { const o = idx.get(String(code || "").trim()); return o ? String(o.kho_giao || o.warehouse_giao || "").trim() : ""; };
  const cases = ltlData.detailedDamageCases || [];

  // "So cùng kỳ" of the money, following the same rule as the damage KPI:
  // no month/date filter → the "So sánh cùng kỳ" window (by case date, like
  // the tile "Ca hư hỏng (kỳ đang lọc)"); otherwise the KPI's previous period.
  let compare = null;
  if (!months && !dateFrom && !dateTo) {
    const pc = ltlData.periodComparison;
    const rg = pc?.range;
    if (rg) {
      const inWin = (from, to) => (c) => { const d = caseIso(c); return d >= from && d <= to; };
      compare = {
        mode: "window", currentLabel: pc.currentRangeLabel, compareLabel: pc.previousRangeLabel,
        curCases: cases.filter(inWin(rg.curFrom, rg.curTo)), prevCases: cases.filter(inWin(rg.prevFrom, rg.prevTo)),
      };
    }
  } else if (comparisons.moneyPrev) {
    const mp = comparisons.moneyPrev;
    compare = mp.incomplete ? { incomplete: true, compareLabel: mp.compareLabel }
      : { mode: "period", currentLabel: "kỳ đang lọc", compareLabel: mp.compareLabel, curCases: cases, prevCases: mp.cases };
  }
  const damageMoney = computeDamageMoney({ cases, compare, kgOf, rawRows: rawDamageCauses });
  damageMoney.reconcile = reconcileRillnet({ summary: (base.rawCompensationSummary || [])[0], rawCases: rawDamageCauses, dmCodes: dmOrderCodes, csTickDashboard: (base.rawDamageCsTick || []).length || null });

  // Open cases / recurrence ignore the month/date filter (a "right now"
  // backlog, like Đơn treo) but follow project / pickup point / viewAs.
  const allCases = (sparkDamage || [])
    .map((r) => caseView(r, idx.get(String(r.order_code || "").trim())))
    .filter((c) => projectMatch(projects, c.client_name) && (!origin || String(c.from_province || "").trim() === origin));
  const damageAnalysis = computeDamageAnalysis({ allCases, cases, kgOf, today });
  return { damageMoney, damageAnalysis };
}

function warehouseLayerOf(base, rows, filterMode) {
  const whIndex = warehouseIndexFor(base);
  return whIndex
    ? computeWarehouseLayer(rows || [], whIndex, { dateField: filterMode === "delivered" ? "delivered_time" : "pickup_time" })
    : null;
}

// Lightweight province stats for NHC/STTP — only what Top 8 Tỉnh + Smart Hotspots need.
// Returns [{ name, orders, details: { name, ontimePct, evalCount, ontimeCount, lateCount, damageCount } }]
function buildSimpleProvinceStats(rows, damageRows = []) {
  if (!rows?.length) return [];
  const byProv = new Map();
  for (const r of rows) {
    const prov = String(r.to_province_name || "").trim();
    if (!prov) continue;
    if (!byProv.has(prov)) byProv.set(prov, { name: prov, orders: 0, ontimeCount: 0, lateCount: 0, weight: 0, clients: {} });
    const p = byProv.get(prov);
    p.orders++;
    p.weight += (parseFloat(r.weight || 0)) / 1000; // grams → kg (same as transform-ltl.js)
    const s = String(r.odr_success || "").toLowerCase();
    if (s === "ontime") p.ontimeCount++;
    else if (s === "late") p.lateCount++;
    // Per-client breakdown
    const cl = String(r.client_name || "Khác").trim();
    const orig = String(r.from_province_name || "").trim();
    if (!p.clients[cl]) p.clients[cl] = { name: cl, orders: 0, weight: 0, ontime: 0, late: 0, origins: {} };
    const c = p.clients[cl];
    c.orders++;
    c.weight += (parseFloat(r.weight || 0)) / 1000; // grams → kg
    if (s === "ontime") c.ontime++;
    else if (s === "late") c.late++;
    if (orig) c.origins[orig] = (c.origins[orig] || 0) + 1;
  }
  // Count Rillnet damage per province (rows already have to_province_name)
  const dmgByProv = new Map();
  for (const r of damageRows) {
    const prov = String(r.to_province_name || "").trim();
    if (prov) dmgByProv.set(prov, (dmgByProv.get(prov) || 0) + 1);
  }
  return [...byProv.values()]
    .map((p) => {
      const evalCount = p.ontimeCount + p.lateCount;
      const clientDetails = Object.values(p.clients)
        .map((c) => {
          const cEval = c.ontime + c.late;
          const topOrig = Object.entries(c.origins).sort((a, b) => b[1] - a[1])[0];
          return {
            name: c.name,
            orders: c.orders,
            weight: Math.round(c.weight || 0),
            ontimePct: cEval > 0 ? Math.round((c.ontime / cEval) * 100) : 100,
            mainOrigin: topOrig ? topOrig[0] : "N/A",
          };
        })
        .sort((a, b) => b.orders - a.orders);
      return {
        name: p.name,
        orders: p.orders,
        details: {
          name: p.name,
          totalOrders: p.orders,
          totalWeight: Math.round(p.weight || 0),
          ontimePct: evalCount > 0 ? Math.round((p.ontimeCount / evalCount) * 100) : 100,
          evalCount,
          ontimeCount: p.ontimeCount,
          lateCount: p.lateCount,
          damageCount: dmgByProv.get(p.name) || 0,
          clientDetails,
        },
      };
    })
    .sort((a, b) => b.orders - a.orders);
}

// Map request for a body computed without the Kho layer: compute it once
// from the body's own rows and keep it on the (cached) body.
// warehouseLayerAll/Nhc/Sttp + provinceStatsNhc/Sttp = same period, from ltl-all.json.gz.
export async function addWarehouseLayer(base, body, filterMode) {
  if (!body?.ltl) return body;
  const dateField = filterMode === "delivered" ? "delivered_time" : "pickup_time";
  if (!("warehouseLayer" in body.ltl)) {
    body.ltl.warehouseLayer = body.__rows ? warehouseLayerOf(base, body.__rows, filterMode) : null;
  }
  const needAll      = !("warehouseLayerAll"  in body.ltl);
  const needNhc      = !("warehouseLayerNhc"  in body.ltl);
  const needSttp     = !("warehouseLayerSttp" in body.ltl);
  const needNhcProv  = !("provinceStatsNhc"   in body.ltl);
  const needSttpProv = !("provinceStatsSttp"  in body.ltl);
  if (needAll || needNhc || needSttp || needNhcProv || needSttpProv) {
    try {
      const whIndex = warehouseIndexFor(base);
      const dmRows = body.__rows || [];
      let minDate = "", maxDate = "";
      for (const r of dmRows) {
        const d = String(r[dateField] || "").slice(0, 10);
        if (!d) continue;
        if (!minDate || d < minDate) minDate = d;
        if (d > maxDate) maxDate = d;
      }
      // Fallback: defaultBody has warehouseLayer pre-built (withWarehouses=true)
      // but __rows is not stored → derive range from warehouseLayer.period instead.
      if (!minDate && body.ltl.warehouseLayer?.period) {
        minDate = body.ltl.warehouseLayer.period.from || "";
        maxDate = body.ltl.warehouseLayer.period.to || "";
      }
      if (minDate) {
        // Dynamic import breaks the circular dependency ltl-dashboard ↔ ltl-snapshot.
        const { loadAllBase } = await import("./ltl-snapshot");
        const allBase = await loadAllBase();
        if (allBase?.ltlRows?.length) {
          const ciMap = allBase.clientIndustryMap; // Map: clientKey → "DM"|"NHC"|"STTP"|"ECOM"
          const allRows = allBase.ltlRows.filter((r) => {
            const d = String(r[dateField] || "").slice(0, 10);
            return d >= minDate && d <= maxDate;
          });
          const nhcRows  = (needNhc || needNhcProv)  ? allRows.filter((r) => ciMap.get(String(r.client_name || "").trim().toLowerCase()) === "NHC")  : null;
          const sttpRows = (needSttp || needSttpProv) ? allRows.filter((r) => ciMap.get(String(r.client_name || "").trim().toLowerCase()) === "STTP") : null;
          if (needAll && whIndex)      body.ltl.warehouseLayerAll  = computeWarehouseLayer(allRows,    whIndex, { dateField });
          if (needNhc && whIndex)      body.ltl.warehouseLayerNhc  = computeWarehouseLayer(nhcRows,    whIndex, { dateField });
          if (needSttp && whIndex)     body.ltl.warehouseLayerSttp = computeWarehouseLayer(sttpRows,   whIndex, { dateField });
          if (needNhcProv) {
            const nhcCodes  = new Set(nhcRows.map(r => String(r.order_code || "").trim()).filter(Boolean));
            const nhcDamage = (allBase.rawDamageCauses || []).filter(r => nhcCodes.has(String(r.order_code || "").trim()));
            body.ltl.provinceStatsNhc  = buildSimpleProvinceStats(nhcRows, nhcDamage);
          }
          if (needSttpProv) {
            const sttpCodes  = new Set(sttpRows.map(r => String(r.order_code || "").trim()).filter(Boolean));
            const sttpDamage = (allBase.rawDamageCauses || []).filter(r => sttpCodes.has(String(r.order_code || "").trim()));
            body.ltl.provinceStatsSttp = buildSimpleProvinceStats(sttpRows, sttpDamage);
          }
        }
      }
    } catch (e) {
      console.error("[addWarehouseLayer] all-industry layers failed:", e.message);
    }
    if (!("warehouseLayerAll"  in body.ltl)) body.ltl.warehouseLayerAll  = null;
    if (!("warehouseLayerNhc"  in body.ltl)) body.ltl.warehouseLayerNhc  = null;
    if (!("warehouseLayerSttp" in body.ltl)) body.ltl.warehouseLayerSttp = null;
    if (!("provinceStatsNhc"   in body.ltl)) body.ltl.provinceStatsNhc   = null;
    if (!("provinceStatsSttp"  in body.ltl)) body.ltl.provinceStatsSttp  = null;
  }
  return body;
}
