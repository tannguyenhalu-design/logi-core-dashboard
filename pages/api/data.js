/**
 * pages/api/data.js
 * GET /api/data?months=1,2,3&projects=GTC,ABC&filterMode=pickup&viewAsType=cs&viewAsValue=PIC_NAME
 * 
 * Protected endpoint — requires valid session.
 * Fetches Google Sheets, filters raw data securely on the backend, 
 * transforms data, and returns the aggregated JSON.
 */
import { getSession } from "../../lib/auth";
import { fetchSheet, getCached, setCached, clearAllCache } from "../../lib/sheets";
import { isDMClient, isLTLRow, isFromJuly2026 } from "../../lib/dm-clients";
import { transformLTL, parseDate } from "../../lib/transform-ltl";
import { transformTachTrip } from "../../lib/transform-tach-trip";
import { transformAIInsights, computeDamageCauseBreakdown } from "../../lib/transform-ai-insights";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Set Vercel Edge Cache (3 minutes caching, serve stale while revalidating for fast loads)
  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=59");

  // ── Auth check ──
  const session = await getSession(req, res);
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const role = session.user.role || "manager";
  const userProject = session.user.project || null;
  const userPic = session.user.pic || null;

  // ── Parse query filters ──
  let months = null;
  let projects = null;
  let filterMode = req.query.filterMode || "pickup";
  let viewAsType = req.query.viewAsType || "manager";
  let viewAsValue = req.query.viewAsValue || null;

  // Date range filter (dateFrom / dateTo in format YYYY-MM-DD)
  const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : null;
  const dateTo   = req.query.dateTo   ? String(req.query.dateTo).trim()   : null;

  if (req.query.months) {
    months = req.query.months
      .split(",")
      .map(Number)
      .filter((n) => !isNaN(n) && n >= 1 && n <= 12);
    if (months.length === 0) months = null;
  }

  if (req.query.projects) {
    projects = req.query.projects.split(",").filter(Boolean);
    if (projects.length === 0) projects = null;
  }

  // Pickup-point filter ("Điểm Lấy Hàng") — a real top-level filter like
  // months/projects so every panel that reads from transformLTL's `rows`
  // stays in sync when one is selected, not just the map panel.
  const origin = req.query.origin ? String(req.query.origin).trim() : null;

  // Granularity of the "so sánh cùng kỳ" panel — "mtd" (default: đầu tháng
  // → hôm nay vs cùng khoảng đó tháng trước) or calendar-day-of-month
  // blocks of 1/2/3 weeks compared against the same block last month.
  let periodWeeks = req.query.periodWeeks;
  if (periodWeeks !== "mtd") {
    periodWeeks = parseInt(periodWeeks, 10);
    if (![1, 2, 3].includes(periodWeeks)) periodWeeks = "mtd";
  }

  // ── Enforce client/cs restrictions strictly at Backend ──
  if (role === "client" && userProject) {
    projects = [userProject];
    viewAsType = "client";
  }

  // Scope key for everything that depends only on WHO is asking (role/pic/
  // viewAs), not on which months/projects/origin they're currently filtering
  // by — used to cache the expensive overview/aiInsights/tachTrip transforms
  // that were previously recomputed from scratch on every single filter click.
  const scopeKey = `${role}:${userPic || ""}:${viewAsType}:${viewAsValue || ""}`;
  const fullKey = `data:full:${scopeKey}:${filterMode}:${periodWeeks}:${origin || ""}:${(months || []).join(",")}:${(projects || []).join(",")}:${dateFrom || ""}:${dateTo || ""}`;

  const cachedFull = getCached(fullKey);
  if (cachedFull && req.query.force !== "true") {
    return res.status(200).json(cachedFull);
  }

  if (req.query.force === "true") {
    clearAllCache();
  }

  try {
    const ltlSheetId = process.env.SHEET_ID_LTL;
    // ── Fetch raw data from Google Sheets ──
    const [rawLTL, rawMapping, rawDamageCauses, rawCompensationSummary] = await Promise.all([
      fetchSheet("raw_ontime", ltlSheetId).catch(() => []),
      fetchSheet("mapping", ltlSheetId).catch(() => []),
      fetchSheet("raw_damage_causes").catch(() => []),
      fetchSheet("raw_compensation_summary").catch(() => []),
    ]);

    if (!rawLTL || rawLTL.length === 0) {
      throw new Error("No LTL data found");
    }

    // ── 1. Base Filtering (DM Clients + Date >= July 2026 + LTL only) ──
    // "LTL Dashboard" was including genuine FTL orders — some DM clients
    // (Aqua B2B, LG Pantos, and the "* FTL"-suffixed names) ship
    // exclusively via FTL despite matching the DM client list; luong_hang
    // is the real signal for everyone else. See lib/dm-clients.js.
    let filteredLTL = rawLTL.filter(r => isDMClient(r["client_name"]) && isFromJuly2026(r["pickup_time"]) && isLTLRow(r));

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
    if (rawMapping) {
      rawMapping.forEach(row => {
        if (row.client_name && row.PIC) {
          picMapping[row.client_name] = row.PIC;
        }
      });
    }

    // ── 2. Apply Security / ViewAs Filtering ──
    // "cs" used to be scoped to only its own PIC's clients here (matching
    // picMapping from a "mapping" sheet under SHEET_ID_LTL) — that env var
    // was never actually configured in production, so picMapping was
    // silently empty and every cs-role user saw a completely blank
    // dashboard (confirmed live, 2026-08-17). Rather than stand up the
    // missing data source, cs is now intentionally unscoped — sees every
    // project the same as sd3, restricted instead at the UI/component
    // level (no revenue figures, no AI chat — see canSeeRevenue in
    // OperationsDashboard.js and the tabs check in dashboard.js).
    if (role === "manager" && viewAsType === "cs" && viewAsValue) {
      filteredLTL = filteredLTL.filter(r => picMapping[r.client_name] === viewAsValue);
      filteredDamage = filteredDamage.filter(r => picMapping[r.client_name] === viewAsValue);
    } else if (role === "manager" && viewAsType === "project" && viewAsValue) {
      filteredLTL = filteredLTL.filter(r => r.client_name === viewAsValue);
      filteredDamage = filteredDamage.filter(r => r.client_name === viewAsValue);
    }

    // ── 2b. Date range filter (dateFrom / dateTo) ────────────────────────────
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

    // ── Transform (per-filter — genuinely depends on months/projects/origin) ──
    const ltlData       = transformLTL(filteredLTL, { months, projects, filterMode, periodWeeks, origin }, filteredDamage);

    // ── Overview / AI Insights / TachTrip — independent of months/projects/
    // origin, so cache per (role, pic, viewAs) scope instead of recomputing
    // on every filter click. Shares the sheets-fetch cache TTL (5 min).
    const tachTripKey = `data:tachTrip:${scopeKey}`;
    let tachTripData = getCached(tachTripKey);
    if (!tachTripData) {
      tachTripData = transformTachTrip(filteredLTL);
      setCached(tachTripKey, tachTripData);
    }

    // breakageRoutes/avgDmgRate depend on the project filter — previously
    // always computed system-wide regardless of the selected project, which
    // meant filtering to e.g. "Casper" still showed every other client's
    // routes underneath a narrative that WAS correctly Casper-specific
    // (damageCauses, below). Reuse transformLTL's own already project-
    // filtered `filteredRows`, and the project-filtered damage set, so both
    // panels agree on what's actually in scope.
    const aiInsightsKey = `data:aiInsights:${scopeKey}:${periodWeeks}:${(projects || []).join(",")}`;
    let aiInsights = getCached(aiInsightsKey);
    if (!aiInsights) {
      aiInsights = transformAIInsights(ltlData.filteredRows, filteredDamageCauses, periodWeeks);
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

    // Filter revenue metrics for unauthorized roles
    const canSeeRevenue = role === "manager" || role === "sd3";
    if (!canSeeRevenue) {
      ltlData.totalRevenue = 0;
      ltlData.totalPlan = 0;
      if (ltlData.projects) {
        ltlData.projects.forEach(p => {
          p.revenue = 0;
          p.plan = 0;
          p.lastMoNsr = 0;
          p.revenueAchievement = 0;
        });
      }
      if (ltlData.volumeByMonth) {
        ltlData.volumeByMonth.forEach(m => {
          m.revenue = 0;
        });
      }
    }

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

    const responseBody = {
      ok: true,
      user: { role, project: userProject, pic: userPic },
      picMapping,
      filters: { months, projects, filterMode, dateFrom, dateTo },
      viewAs: { type: viewAsType, value: viewAsValue },
      ltl: ltlData,
      tachTrip: tachTripData,
      aiInsights,
      overview: {
        ...overview,
        allProjectsLTL: ltlData.allProjects,
      },
    };

    setCached(fullKey, responseBody);
    return res.status(200).json(responseBody);
  } catch (err) {
    console.error("[/api/data] Error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
