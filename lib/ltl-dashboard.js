/**
 * lib/ltl-dashboard.js
 * Pure computation behind GET /api/data — moved verbatim out of the route so
 * the snapshot builder (lib/ltl-snapshot.js) can precompute the default view
 * with exactly the same code path. Input is the already base-filtered LTL
 * snapshot (Điện Máy + từ 07/2026 + chỉ LTL), not raw Sheets rows.
 */
import { getCached, setCached } from "./sheets";
import { transformLTL, parseDate } from "./transform-ltl";
import { transformAIInsights, computeDamageCauseBreakdown } from "./transform-ai-insights";

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

export function isDefaultQuery(params) {
  return !params.months && !params.projects && params.filterMode === "pickup"
    && params.viewAsType === "manager" && !params.viewAsValue
    && !params.dateFrom && !params.dateTo && !params.origin
    && params.periodWeeks === "mtd" && !params.province && !params.pendingList && !params.stuckList
    && params.role !== "client";
}

// Role-dependent tweaks applied on top of a computed body — kept separate so
// the precomputed default body (built without a session) gets exactly the
// same per-role treatment as a live-computed one.
export function applyRoleToBody(body, { role, userProject, userPic }) {
  const out = { ...body, user: { role, project: userProject, pic: userPic } };
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
  };
  const kpiFor = (over) => computeDashboard(base, { ...params, ...over, kpiOnly: true, province: null, pendingList: false, stuckList: false });
  const none = { kpiDelta: null, anomalies: null };
  const incomplete = (compareLabel) => ({ kpiDelta: { mode: "period", compareLabel, incomplete: true }, anomalies: null });
  const vsPeriod = (prev, meta) => ({
    kpiDelta: buildDelta(current, prev, meta),
    anomalies: { compareLabel: meta.compareLabel, items: projectDrops(ltlData.ontimeByProject, prev.ontimeByProject) },
  });

  if (!months && !dateFrom && !dateTo) {
    const pc = ltlData.periodComparison;
    if (filterMode !== "pickup" || !pc?.overall) return none;
    const c = pc.overall.cur, p = pc.overall.prev;
    const asKpi = (x) => ({ totalOrders: x.orders, ontimePct: x.ontimePct, lateCount: x.lateCount, totalBroken: x.damageCount });
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
  const rawDamageCauses = base.rawDamageCauses || [];
  const rawCompensationSummary = base.rawCompensationSummary || [];

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
      ontimeByProject: ltlData.ontimeByProject,
    };
  }

  const pendingScoped = transformLTL(pendingAll, { projects, filterMode: "pickup", origin }, []).filteredRows;
  const stuckScoped = transformLTL(stuckAll, { projects, filterMode: "pickup", origin }, []).filteredRows;

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
  const compensationSummary = rawCompensationSummary?.[0]
    ? {
        csTickCount: Number(rawCompensationSummary[0]["cs_tick_count"]) || 0,
        opsUnfinalizedCount: Number(rawCompensationSummary[0]["ops_unfinalized_count"]) || 0,
        opsApprovedCount: Number(rawCompensationSummary[0]["ops_approved_count"]) || 0,
        opsRejectedCount: Number(rawCompensationSummary[0]["ops_rejected_count"]) || 0,
        opsClawbackCount: Number(rawCompensationSummary[0]["ops_clawback_count"]) || 0,
        totalAmount: Number(rawCompensationSummary[0]["total_amount"]) || 0,
      }
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
  const { filteredRows: _omit, ...ltlForClient } = ltlData;

  const pendingByStatus = {};
  let pendingWeight = 0;
  pendingScoped.forEach((r) => {
    const st = String(r.status || "(trống)").trim() || "(trống)";
    pendingByStatus[st] = (pendingByStatus[st] || 0) + 1;
    pendingWeight += (parseFloat(r.weight) || 0) / 1000;
  });

  return {
    ok: true,
    picMapping,
    filters: { months, projects, filterMode, dateFrom, dateTo },
    viewAs: { type: viewAsType, value: viewAsValue },
    ltl: ltlForClient,
    pendingPickup: { count: pendingScoped.length, totalWeight: pendingWeight, byStatus: pendingByStatus },
    stuck: summarizeStuck(stuckScoped, today),
    ...computeComparisons(base, params, ltlData),
    aiInsights,
    overview: {
      ...overview,
      allProjectsLTL: ltlData.allProjects,
    },
    dataAsOf: base.builtAt || null,
  };
}
