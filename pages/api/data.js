/**
 * pages/api/data.js
 * GET /api/data?months=1,2,3&projects=GTC,ABC&filterMode=pickup&viewAsType=cs&viewAsValue=PIC_NAME
 *   &province=X      → { ok, provinceOrders }  (modal "Chi tiết đơn hàng")
 *   &pendingPickup=1 → { ok, pendingOrders }   (modal "Đơn chờ lấy")
 *   &stuck=1         → { ok, stuckOrders }     (modal "Đơn treo / cần chú ý")
 *   &dueToday=1      → { ok, dueTodayOrders }  (bộ lọc nhanh "Đến hạn hôm nay")
 *   &force=true      → rebuild the Blob snapshot from Google Sheets first
 *   &part=map        → { ok, provinceStats, provinceDetailsMap, originStats,
 *                      routeStats, warehouseLayer } only (tab "Bản đồ tỉnh thành")
 *   &withMap=1       → full body including those map fields
 *   ?warm=1 + secret → keep-warm ping (lib/warm.js)
 *
 * Kế hoạch A · P6 (28/09): the map fields are ~0.7 MB of the ~1.2 MB body
 * but only the map view reads them, so the normal body leaves them out (the
 * page asks for part=map when the map is opened, or prefetches it when idle);
 * aiInsights.periodComparison (~85 KB; equal to ltl.periodComparison on the
 * default view, and read by no component — the page shows ltl's) is dropped
 * from the response. The computed/cached body is
 * unchanged — only what is sent differs, so every number stays the same.
 *
 * Protected endpoint — requires valid session. Data comes from the LTL
 * snapshot in Vercel Blob (lib/ltl-snapshot.js); the computation itself
 * lives in lib/ltl-dashboard.js.
 */
import { getSession } from "../../lib/auth";
import { getCached, setCached } from "../../lib/mem-cache";
import { isWarmPing, answerWarm } from "../../lib/warm";
import { loadLtlBase, loadDefaultBody, buildLtlSnapshot } from "../../lib/ltl-snapshot";
import { computeDashboard, applyRoleToBody, isDefaultQuery, addWarehouseLayer } from "../../lib/ltl-dashboard";

export const config = { maxDuration: 60 };

// Read only by the "Bản đồ tỉnh thành" view (ProvinceMapPanel).
// originDetailsMap is computed but no component reads it — never sent.
// warehouseLayer = the "Kho" layer (Kế hoạch D · 2a, lib/warehouse-layer.js).
const MAP_KEYS = ["provinceStats", "provinceDetailsMap", "originStats", "routeStats", "warehouseLayer", "warehouseLayerAll", "warehouseLayerNhc", "warehouseLayerSttp"];
const OMIT_LTL_KEYS = new Set([...MAP_KEYS, "originDetailsMap"]);

// What goes over the wire for one computed body (after applyRoleToBody).
function shapeBody(body, part, withMap) {
  const ltl = body.ltl || {};
  if (part === "map") {
    const out = { ok: true, dataAsOf: body.dataAsOf || null };
    for (const k of MAP_KEYS) out[k] = ltl[k];
    return out;
  }
  const slim = {};
  for (const k of Object.keys(ltl)) if (!OMIT_LTL_KEYS.has(k) || (withMap && MAP_KEYS.includes(k))) slim[k] = ltl[k];
  const out = { ...body, ltl: slim };
  if (body.aiInsights) {
    const { periodComparison: _dup, ...ai } = body.aiInsights;
    out.aiInsights = ai;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // MUST stay private: this response is per-session. A shared-cache header
  // (s-maxage, added 2026-08-14) made Vercel's CDN serve cached payloads
  // before auth ran — confirmed 2026-09-26 that a request with NO cookie got
  // the full dataset (200) and a cs user got a manager's payload.
  res.setHeader("Cache-Control", "private, no-store");

  if (isWarmPing(req)) {
    return answerWarm(res, async () => { await loadDefaultBody(); await loadLtlBase(); });
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
  const filterMode = req.query.filterMode || "pickup";
  let viewAsType = req.query.viewAsType || "manager";
  const viewAsValue = req.query.viewAsValue || null;

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

  // ── Enforce client restrictions strictly at Backend ──
  if (role === "client" && userProject) {
    projects = [userProject];
    viewAsType = "client";
  }

  const params = {
    role, userPic, months, projects, filterMode, viewAsType, viewAsValue,
    dateFrom, dateTo, origin, periodWeeks,
    province: req.query.province ? String(req.query.province) : null,
    pendingList: req.query.pendingPickup === "1",
    stuckList: req.query.stuck === "1",
    dueTodayList: req.query.dueToday === "1",
  };
  const scope = { role, userProject, userPic };
  const force = req.query.force === "true";
  const part = req.query.part === "map" ? "map" : null;
  const withMap = req.query.withMap === "1";

  try {
    if (force) {
      await buildLtlSnapshot();
    } else if (isDefaultQuery(params)) {
      const defaultBody = await loadDefaultBody();
      // A stored body from before the Kho layer (29/09) lacks warehouseLayer:
      // the map part is computed live instead until the next rebuild.
      const staleMap = (part === "map" || withMap) && defaultBody?.ltl && !("warehouseLayer" in defaultBody.ltl);
      // Same for bodies stored before the damage money/analysis fields (Kế hoạch E).
      const staleDamage = defaultBody && !("damageMoney" in defaultBody);
      // Bodies before the dailyOrders field (📅 Sự kiện tab, 2026-10-04) lack it.
      // byProvinceAndDay added 2026-10-05, byKhoLayAndDay added 2026-10-05.
      const staleDaily = defaultBody && (
        !("dailyOrders" in defaultBody) ||
        !("byProvinceAndDay" in (defaultBody.dailyOrders || {})) ||
        !("byKhoLayAndDay" in (defaultBody.dailyOrders || {}))
      );
      if (defaultBody && !staleMap && !staleDamage && !staleDaily) {
        // Safe to cache: default view data only changes when snapshot rebuilds
        // (~3x/day). private = browser-only, CDN never involved.
        // (Contrast: s-maxage incident 2026-09-26 was shared/CDN cache.)
        res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
        if (part === "map" || withMap) {
          const baseForWh = await loadLtlBase();
          await addWarehouseLayer(baseForWh, defaultBody, filterMode);
        }
        return res.status(200).json(shapeBody(applyRoleToBody(defaultBody, scope), part, withMap));
      }
    }

    const base = await loadLtlBase();
    // Drill-down shapes are small and differ from the full body — never
    // served from / written to the full-response cache.
    if (params.province || params.pendingList || params.stuckList || params.dueTodayList) {
      return res.status(200).json(computeDashboard(base, params));
    }

    const fullKey = `data:full:${base.builtAt}:${role}:${userPic || ""}:${viewAsType}:${viewAsValue || ""}:${filterMode}:${periodWeeks}:${origin || ""}:${(months || []).join(",")}:${(projects || []).join(",")}:${dateFrom || ""}:${dateTo || ""}`;
    let body = getCached(fullKey);
    if (!body) {
      body = computeDashboard(base, params);
      setCached(fullKey, body);
    }
    // Kho layer only when the map asks for it (computed once per cached body).
    if (part === "map" || withMap) await addWarehouseLayer(base, body, filterMode);
    return res.status(200).json(shapeBody(applyRoleToBody(body, scope), part, withMap));
  } catch (err) {
    console.error("[/api/data] Error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
