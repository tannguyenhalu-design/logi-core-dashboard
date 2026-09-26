/**
 * pages/api/data.js
 * GET /api/data?months=1,2,3&projects=GTC,ABC&filterMode=pickup&viewAsType=cs&viewAsValue=PIC_NAME
 *   &province=X      → { ok, provinceOrders }  (modal "Chi tiết đơn hàng")
 *   &pendingPickup=1 → { ok, pendingOrders }   (modal "Đơn chờ lấy")
 *   &stuck=1         → { ok, stuckOrders }     (modal "Đơn treo / cần chú ý")
 *   &force=true      → rebuild the Blob snapshot from Google Sheets first
 *
 * Protected endpoint — requires valid session. Data comes from the LTL
 * snapshot in Vercel Blob (lib/ltl-snapshot.js); the computation itself
 * lives in lib/ltl-dashboard.js.
 */
import { getSession } from "../../lib/auth";
import { getCached, setCached } from "../../lib/sheets";
import { loadLtlBase, loadDefaultBody, buildLtlSnapshot } from "../../lib/ltl-snapshot";
import { computeDashboard, applyRoleToBody, isDefaultQuery } from "../../lib/ltl-dashboard";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // MUST stay private: this response is per-session. A shared-cache header
  // (s-maxage, added 2026-08-14) made Vercel's CDN serve cached payloads
  // before auth ran — confirmed 2026-09-26 that a request with NO cookie got
  // the full dataset (200) and a cs user got a manager's payload.
  res.setHeader("Cache-Control", "private, no-store");

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
  };
  const scope = { role, userProject, userPic };
  const force = req.query.force === "true";

  try {
    if (force) {
      await buildLtlSnapshot();
    } else if (isDefaultQuery(params)) {
      const defaultBody = await loadDefaultBody();
      if (defaultBody) return res.status(200).json(applyRoleToBody(defaultBody, scope));
    }

    const base = await loadLtlBase();
    // Drill-down shapes are small and differ from the full body — never
    // served from / written to the full-response cache.
    if (params.province || params.pendingList || params.stuckList) {
      return res.status(200).json(computeDashboard(base, params));
    }

    const fullKey = `data:full:${base.builtAt}:${role}:${userPic || ""}:${viewAsType}:${viewAsValue || ""}:${filterMode}:${periodWeeks}:${origin || ""}:${(months || []).join(",")}:${(projects || []).join(",")}:${dateFrom || ""}:${dateTo || ""}`;
    let body = getCached(fullKey);
    if (!body) {
      body = computeDashboard(base, params);
      setCached(fullKey, body);
    }
    return res.status(200).json(applyRoleToBody(body, scope));
  } catch (err) {
    console.error("[/api/data] Error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
