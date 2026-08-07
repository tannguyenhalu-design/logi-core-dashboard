/**
 * pages/api/data.js
 * GET /api/data?months=1,2,3&projects=GTC,ABC&filterMode=pickup&viewAsType=cs&viewAsValue=PIC_NAME
 * 
 * Protected endpoint — requires valid session.
 * Fetches Google Sheets, filters raw data securely on the backend, 
 * transforms data, and returns the aggregated JSON.
 */
import { getSession } from "../../lib/auth";
import { fetchSheet, getCached, setCached } from "../../lib/sheets";
import { isDMClient, isLTLRow, FTL_ONLY_CLIENTS } from "../../lib/dm-clients";
import { transformLTL } from "../../lib/transform-ltl";
import { transformFTL } from "../../lib/transform-ftl";
import { transformTachTrip } from "../../lib/transform-tach-trip";
import { transformAIInsights } from "../../lib/transform-ai-insights";

// Helper to filter dates from July 2026 onwards
const parseDDMMYYYY = (str) => {
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!m) return null;
  return { day: parseInt(m[1]), month: parseInt(m[2]), year: parseInt(m[3]) };
};

const isFromJuly2026 = (dateStr) => {
  if (!dateStr) return false;
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
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
  const fullKey = `data:full:${scopeKey}:${filterMode}:${periodWeeks}:${origin || ""}:${(months || []).join(",")}:${(projects || []).join(",")}`;

  const cachedFull = getCached(fullKey);
  if (cachedFull) {
    return res.status(200).json(cachedFull);
  }

  try {
    const ltlSheetId = process.env.SHEET_ID_LTL;
    // ── Fetch raw data from Google Sheets ──
    const [rawLTL, rawFTL, masterVehicle, rawDamage, rawMapping] = await Promise.all([
      fetchSheet("raw_ontime", ltlSheetId).catch(() => []),
      fetchSheet("Raw_FTL").catch(() => []),
      fetchSheet("Master data xe").catch(() => []),
      fetchSheet("raw_damage", ltlSheetId).catch(() => []),
      fetchSheet("mapping", ltlSheetId).catch(() => [])
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
    let filteredDamage = rawDamage.filter(r => isDMClient(r["client_name"]) && isFromJuly2026(r["pickup_time"] || r["case_date"]) && !FTL_ONLY_CLIENTS.has(String(r["client_name"] || "").trim()));

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
    if (role === "manager" && viewAsType === "cs" && viewAsValue) {
      filteredLTL = filteredLTL.filter(r => picMapping[r.client_name] === viewAsValue);
      filteredDamage = filteredDamage.filter(r => picMapping[r.client_name] === viewAsValue);
    } else if (role === "manager" && viewAsType === "project" && viewAsValue) {
      filteredLTL = filteredLTL.filter(r => r.client_name === viewAsValue);
      filteredDamage = filteredDamage.filter(r => r.client_name === viewAsValue);
    } else if (role === "cs" && userPic) {
      filteredLTL = filteredLTL.filter(r => picMapping[r.client_name] === userPic);
      filteredDamage = filteredDamage.filter(r => picMapping[r.client_name] === userPic);
    }

    // ── Transform (per-filter — genuinely depends on months/projects/origin) ──
    const ltlData       = transformLTL(filteredLTL, { months, projects, filterMode, periodWeeks, origin }, filteredDamage);
    const ftlData       = transformFTL(rawFTL, masterVehicle, { months, projects });

    // ── Overview / AI Insights / TachTrip — independent of months/projects/
    // origin, so cache per (role, pic, viewAs) scope instead of recomputing
    // on every filter click. Shares the sheets-fetch cache TTL (5 min).
    const tachTripKey = `data:tachTrip:${scopeKey}`;
    let tachTripData = getCached(tachTripKey);
    if (!tachTripData) {
      tachTripData = transformTachTrip(filteredLTL);
      setCached(tachTripKey, tachTripData);
    }

    const aiInsightsKey = `data:aiInsights:${scopeKey}:${periodWeeks}`;
    let aiInsights = getCached(aiInsightsKey);
    if (!aiInsights) {
      aiInsights = transformAIInsights(filteredLTL, filteredDamage, periodWeeks);
      setCached(aiInsightsKey, aiInsights);
    }

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
      const overviewFTL = transformFTL(rawFTL, masterVehicle, {});
      overview = {
        ltl: {
          totalOrders: overviewLTL.totalOrders,
          totalWeight: overviewLTL.totalWeight,
          ontimePct: overviewLTL.ontimePct,
          totalBroken: overviewLTL.totalBroken,
        },
        ftl: {
          totalTrips: overviewFTL.totalTrips,
          totalOrders: overviewFTL.totalOrders,
          totalWeight: overviewFTL.totalWeight,
        },
      };
      setCached(overviewKey, overview);
    }

    const responseBody = {
      ok: true,
      user: { role, project: userProject, pic: userPic },
      picMapping, // Pass picMapping so the frontend can populate the CS dropdown
      filters: { months, projects, filterMode },
      viewAs: { type: viewAsType, value: viewAsValue },
      ltl: ltlData,
      ftl: ftlData,
      tachTrip: tachTripData,
      aiInsights,
      overview: {
        ...overview,
        allProjectsLTL: ltlData.allProjects,
        allProjectsFTL: ftlData.allProjects,
      },
    };

    setCached(fullKey, responseBody);
    return res.status(200).json(responseBody);
  } catch (err) {
    console.error("[/api/data] Error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
