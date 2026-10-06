/**
 * pages/dashboard.js — Main dashboard page
 * Protected via getServerSideProps (session check).
 * Filter state managed here and passed down to all tabs for sync.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Head from "next/head";
import FilterBar from "../components/FilterBar";
import { KpiCardSkeleton } from "../components/KpiCard";
import ThemeToggle from "../components/ThemeToggle";
import dynamic from "next/dynamic";
import { getJSON, prefetchJSON, whenIdle } from "../lib/prefetch";

const LTLDashboard  = dynamic(() => import("../components/ltl/LTLDashboard"), { ssr: false });
const TabUsers      = dynamic(() => import("../components/TabUsers"),      { ssr: false });
const TabAuditLog   = dynamic(() => import("../components/TabAuditLog"),   { ssr: false });
const TabSystemHealth = dynamic(() => import("../components/TabSystemHealth"), { ssr: false });
const TabCompanyReport = dynamic(() => import("../components/TabCompanyReport"), { ssr: false });
const TabTrials = dynamic(() => import("../components/TabTrials"), { ssr: false });
const ExecutiveReport = dynamic(() => import("../components/ExecutiveReport"), { ssr: false });
const TabBrain      = dynamic(() => import("../components/TabBrain"),      { ssr: false });
const AIChatDrawer  = dynamic(() => import("../components/AIChatDrawer"),  { ssr: false });

// Kế hoạch A · P4: while the dashboard is idle, load the code of the tabs this
// role can open, plus each tab's first small requests (the tab module's own
// prefetch(), read back through lib/prefetch.js) — opening a tab is then
// instant instead of chunk + cold API call.
const TAB_MODULES = {
  report: () => import("../components/TabCompanyReport"),
  trials: () => import("../components/TabTrials"),
  users: () => import("../components/TabUsers"),
  auditlog: () => import("../components/TabAuditLog"),
  health: () => import("../components/TabSystemHealth"),
};
const tabsForRole = (role) => (role === "manager" ? ["report", "trials", "auditlog", "health", "users"] : role === "sd3" ? ["report", "trials"] : []);

// Kế hoạch A · P3: tabs that stay mounted (hidden) once opened, so coming
// back shows them at once with their data and state; each has a reload button.
const KEEP_ALIVE_TABS = ["report", "trials", "users", "auditlog", "health"];

const LEGACY_TABS = ["ltl", "operations", "tachtrip", "ftl"];
const LTL_VIEWS = [
  { id: "ltl", label: "Tổng quan LTL", icon: "M3 3h18v18H3zM21 9H3M9 21V9" },
  { id: "map", label: "Bản đồ tỉnh thành", icon: "M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7" },
  { id: "damage", label: "Hư hỏng & Rủi ro", icon: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" },
  { id: "events", label: "📅 Sự kiện", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" },
];

function DashboardSkeleton({ view }) {
  const block = (h) => (
    <div className="chart-panel">
      <div className="skeleton" style={{ height: 14, width: 220, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: h }} />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} aria-busy="true" aria-label="Đang tải dữ liệu">
      {view === "ltl" && (
        <div className="grid-4">
          <KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton />
        </div>
      )}
      {block(view === "map" ? 420 : 280)}
      {block(220)}
    </div>
  );
}

export default function DashboardPage({ user: initialUser }) {
  const user = initialUser || {};
  const isManager = user.role === "manager";
  const userTabs = user.tabs || [];
  // Per-tab access — manager always has everything; others use tabs array
  // (which normalizeTabs already expanded for legacy "ltl"-only accounts).
  const canSeeLTL    = isManager || userTabs.includes("ltl");
  const canSeeMap    = isManager || userTabs.includes("map");
  const canSeeDamage = isManager || userTabs.includes("damage");
  const canSeeEvents = isManager || userTabs.includes("events");
  const canSeeReport = isManager || userTabs.includes("report");
  const canSeeTrials = isManager || userTabs.includes("trials");
  const firstTab = canSeeLTL ? "ltl" : canSeeMap ? "map" : canSeeDamage ? "damage" : canSeeEvents ? "events" : canSeeReport ? "report" : canSeeTrials ? "trials" : "none";
  const [activeTab, setActiveTab] = useState(firstTab); // LTL_VIEWS id | 'report' | 'trials' | 'users' | 'auditlog' | 'health' | 'brain' | 'none'
  const isLTLView = LTL_VIEWS.some((v) => v.id === activeTab);
  const [selectedMonths, setSelectedMonths] = useState(() => {
    // Mặc định: 3 tháng gần nhất (VN time). User mở rộng qua FilterBar.
    const m = new Date(Date.now() + 7 * 3600 * 1000).getUTCMonth() + 1;
    return Array.from({ length: 3 }, (_, i) => m - 2 + i).filter((v) => v >= 1);
  });
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [riskOnly, setRiskOnly] = useState(false); // "Tuyến rủi ro cao" quick filter
  const [reportOpen, setReportOpen] = useState(false); // "Tạo báo cáo tóm tắt"
  const [filterMode, setFilterMode] = useState("pickup");
  const [periodWeeks, setPeriodWeeks] = useState("mtd");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // "Điểm Lấy Hàng" (pickup point) filter — only meaningful alongside a
  // single selected project, cleared whenever the project selection changes
  // so a stale origin from a previous client doesn't silently carry over.
  const [selectedOrigin, setSelectedOrigin] = useState(null);
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(canSeeLTL);
  const [error, setError] = useState(null);
  // Only the latest request may write state — quick filter clicks could
  // otherwise let a slower, older response overwrite a newer one.
  const reqIdRef = useRef(0);
  // Role-switcher for manager: { type: 'manager'|'pic'|'project', value: string|null }
  const [viewAs, setViewAs] = useState({ type: "manager", value: null });
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  // Phone shell (< 768px): the sidebar is a slide-out drawer behind ☰ and the
  // header's filter row folds behind a "Lọc" button. Both flags are ignored by
  // the desktop CSS, so the ≥ 768px layout is unchanged.
  const [navOpen, setNavOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = (selectedMonths.length ? 1 : 0) + (selectedProjects.length ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);
  const goTab = (id) => { setActiveTab(id); setNavOpen(false); };
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setNavOpen(false); };
    const mq = window.matchMedia("(min-width: 768px)");
    const onWide = () => { if (mq.matches) setNavOpen(false); };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => { document.removeEventListener("keydown", onKey); mq.removeEventListener("change", onWide); };
  }, [navOpen]);
  // Real registered SD/CS staff — not every name that ever appeared in the
  // picMapping sheet (that list gets noisy with stale/duplicate entries).
  const [staffPics, setStaffPics] = useState([]);
  // Tabs opened at least once (kept mounted, see KEEP_ALIVE_TABS).
  const [visited, setVisited] = useState(() => new Set());
  useEffect(() => {
    if (KEEP_ALIVE_TABS.includes(activeTab)) setVisited((v) => (v.has(activeTab) ? v : new Set(v).add(activeTab)));
  }, [activeTab]);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  // Map fields of /api/data (Kế hoạch A · P6): fetched with part=map for the
  // query string of the body on screen, only when the map is shown (or
  // prefetched while idle). { qs, fields } | { qs, error }.
  const lastQsRef = useRef(null);
  const [mapData, setMapData] = useState(null);
  const mapReqRef = useRef(null);

  useEffect(() => {
    if (!isManager) return;
    fetch("/api/admin-users")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        const names = [...new Set(
          json.users
            .filter((u) => (u.role === "sd3" || u.role === "cs") && u.pic)
            .map((u) => u.pic.trim())
        )].filter(Boolean).sort();
        setStaffPics(names);
      })
      .catch(() => {});
  }, [isManager]);

  // ── Fetch aggregated data from Backend API ──
  const fetchDashboardData = useCallback(async (months, projects, fMode, viewAsOverride, pWeeks, dFrom, dTo) => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const effectiveViewAs = viewAsOverride !== undefined ? viewAsOverride : viewAs;
      const params = new URLSearchParams();
      if (months && months.length > 0) params.append("months", months.join(","));
      if (projects && projects.length > 0) params.append("projects", projects.join(","));
      if (fMode) params.append("filterMode", fMode);
      if (effectiveViewAs.type) params.append("viewAsType", effectiveViewAs.type);
      if (effectiveViewAs.value) params.append("viewAsValue", effectiveViewAs.value);
      params.append("periodWeeks", pWeeks || periodWeeks);
      if (selectedOrigin) params.append("origin", selectedOrigin);
      if (dFrom) params.append("dateFrom", dFrom);
      if (dTo)   params.append("dateTo", dTo);

      // On the map view, one request brings the map fields too.
      const qs = params.toString();
      const withMap = activeTabRef.current === "map";
      const res = await fetch(`/api/data?${qs}${withMap ? "&withMap=1" : ""}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (reqId !== reqIdRef.current) return;
      // Map key = filters + data version, so a resync never shows the old map
      // (the extra asOf param is ignored by the API).
      lastQsRef.current = `${qs}&asOf=${encodeURIComponent(data.dataAsOf || "")}`;
      if (withMap && data.ltl?.provinceStats) {
        setMapData({ qs: lastQsRef.current, fields: { provinceStats: data.ltl.provinceStats, provinceDetailsMap: data.ltl.provinceDetailsMap, originStats: data.ltl.originStats, routeStats: data.ltl.routeStats, warehouseLayer: data.ltl.warehouseLayer ?? null } });
      }
      setDashData(data);
    } catch (e) {
      if (reqId === reqIdRef.current) setError(e.message);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [viewAs, periodWeeks, selectedOrigin]);

  // On-demand fetch for the "Chi tiết đơn hàng theo tỉnh" modal in
  // LTLDashboard — mirrors fetchDashboardData's own filter params exactly
  // (same months/projects/filterMode/viewAs/periodWeeks/origin/dateRange
  // currently active) so the modal's "trong bộ lọc hiện tại" claim is
  // actually true, plus `province`. /api/data returns just that province's
  // rows (a handful of fields each) instead of the ~23k-row/22MB array this
  // used to ship on every dashboard load just for this one click-through.
  const fetchProvinceOrders = useCallback(async (province) => {
    const params = new URLSearchParams();
    if (selectedMonths?.length > 0) params.append("months", selectedMonths.join(","));
    if (selectedProjects?.length > 0) params.append("projects", selectedProjects.join(","));
    if (filterMode) params.append("filterMode", filterMode);
    if (viewAs.type) params.append("viewAsType", viewAs.type);
    if (viewAs.value) params.append("viewAsValue", viewAs.value);
    params.append("periodWeeks", periodWeeks);
    if (selectedOrigin) params.append("origin", selectedOrigin);
    if (dateFrom) params.append("dateFrom", dateFrom);
    if (dateTo) params.append("dateTo", dateTo);
    params.append("province", province);

    const res = await fetch(`/api/data?${params.toString()}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const json = await res.json();
    return json.provinceOrders || [];
  }, [selectedMonths, selectedProjects, filterMode, viewAs, periodWeeks, selectedOrigin, dateFrom, dateTo]);

  // "Đơn chờ lấy (chưa chốt kỳ)" list — orders with no pickup date, scoped by
  // project/origin/viewAs but not by month/date (they have no date to filter on).
  const fetchPendingOrders = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedProjects?.length > 0) params.append("projects", selectedProjects.join(","));
    if (viewAs.type) params.append("viewAsType", viewAs.type);
    if (viewAs.value) params.append("viewAsValue", viewAs.value);
    if (selectedOrigin) params.append("origin", selectedOrigin);
    params.append("pendingPickup", "1");
    const res = await fetch(`/api/data?${params.toString()}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const json = await res.json();
    return json.pendingOrders || [];
  }, [selectedProjects, viewAs, selectedOrigin]);

  // "Đến hạn hôm nay" quick-filter list — same scoping as the pending list.
  const fetchDueTodayOrders = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedProjects?.length > 0) params.append("projects", selectedProjects.join(","));
    if (viewAs.type) params.append("viewAsType", viewAs.type);
    if (viewAs.value) params.append("viewAsValue", viewAs.value);
    if (selectedOrigin) params.append("origin", selectedOrigin);
    params.append("dueToday", "1");
    const res = await fetch(`/api/data?${params.toString()}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const json = await res.json();
    return json.dueTodayOrders || [];
  }, [selectedProjects, viewAs, selectedOrigin]);

  // "Đơn treo / cần chú ý" list — same scoping as the pending list.
  const fetchStuckOrders = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedProjects?.length > 0) params.append("projects", selectedProjects.join(","));
    if (viewAs.type) params.append("viewAsType", viewAs.type);
    if (viewAs.value) params.append("viewAsValue", viewAs.value);
    if (selectedOrigin) params.append("origin", selectedOrigin);
    params.append("stuck", "1");
    const res = await fetch(`/api/data?${params.toString()}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const json = await res.json();
    return json.stuckOrders || [];
  }, [selectedProjects, viewAs, selectedOrigin]);

  // A pickup-point selection only makes sense for whichever project it came
  // from — drop it the moment the project selection changes underneath it.
  useEffect(() => {
    setSelectedOrigin(null);
  }, [selectedProjects]);

  // Fetch data on mount and whenever filters change
  useEffect(() => {
    if (!canSeeLTL) return;
    fetchDashboardData(selectedMonths, selectedProjects, filterMode, viewAs, periodWeeks, dateFrom, dateTo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonths, selectedProjects, filterMode, viewAs, periodWeeks, selectedOrigin, dateFrom, dateTo, canSeeLTL]);

  const allProjects = dashData
    ? (dashData.overview?.allProjectsLTL || []).sort()
    : user.project ? [user.project] : [];

  // Map fields for the body on screen (P6): load when the map view needs them.
  const mapUrl = (qs) => `/api/data?${qs}&part=map`;
  useEffect(() => {
    const qs = lastQsRef.current;
    if (activeTab !== "map" || !dashData || loading || qs == null) return;
    if (mapData?.qs === qs || mapReqRef.current === qs) return;
    mapReqRef.current = qs;
    getJSON(mapUrl(qs))
      .then(({ ok, j }) => {
        if (!ok || !j.ok) throw new Error(j.error || `API error`);
        if (lastQsRef.current === qs) setMapData({ qs, fields: { provinceStats: j.provinceStats, provinceDetailsMap: j.provinceDetailsMap, originStats: j.originStats, routeStats: j.routeStats, warehouseLayer: j.warehouseLayer ?? null } });
      })
      .catch(() => { if (lastQsRef.current === qs) setMapData({ qs, error: true }); })
      .finally(() => { if (mapReqRef.current === qs) mapReqRef.current = null; });
  }, [activeTab, dashData, loading, mapData]);
  const mapFields = mapData && mapData.qs === lastQsRef.current && mapData.fields ? mapData.fields : null;
  const mapState = mapFields ? undefined : mapData && mapData.qs === lastQsRef.current && mapData.error ? "error" : "loading";
  const ltlData = useMemo(() => (dashData?.ltl && mapFields ? { ...dashData.ltl, ...mapFields } : dashData?.ltl), [dashData, mapFields]);

  // P4 idle prefetch: map fields for the body on screen, then (once) the
  // code + first requests of the other tabs this role can open.
  const prefetchedTabs = useRef(false);
  useEffect(() => {
    if (!dashData || loading) return;
    const qs = lastQsRef.current;
    const cancelMap = canSeeLTL && qs != null && !(mapData?.qs === qs) ? whenIdle(() => { prefetchJSON(mapUrl(qs)).catch(() => {}); }) : () => {};
    let cancelTabs = () => {};
    if (!prefetchedTabs.current) {
      prefetchedTabs.current = true;
      cancelTabs = whenIdle(() => {
        for (const id of tabsForRole(user.role)) {
          TAB_MODULES[id]().then((m) => { if (typeof m.prefetch === "function") m.prefetch(); }).catch(() => {});
        }
      }, 4000);
    }
    return () => { cancelMap(); cancelTabs(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashData, loading]);
  // Accounts without the LTL views have no dashboard data to wait for.
  useEffect(() => {
    if (canSeeLTL || prefetchedTabs.current) return;
    prefetchedTabs.current = true;
    return whenIdle(() => {
      for (const id of tabsForRole(user.role)) TAB_MODULES[id]().then((m) => m.prefetch?.()).catch(() => {});
    }, 4000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Head>
        <title>SD3- Dashboard Điện Máy</title>
        <meta name="description" content="Hệ thống theo dõi vận hành logistics điện máy" />
      </Head>

      {/*
        Watchdog: on a small but real fraction of loads (seen most on
        accounts whose default/only tab was the since-removed FTL tab, e.g.
        GSVT staff with role "cs" — reported 2026-08-18), the effect that
        kicks off the tab's data fetch (fetchDashboardData) never fires, even though the JS bundle and SSR'd
        markup both load fine — <main> is left permanently on its initial
        loading placeholder. Reproduced against a clean `next start`
        production build (not just dev-mode HMR noise), and it isn't
        specific to one tab or component, so it's not something safely
        fixable by reordering our own mount logic. This is a plain inline
        script (not a React effect) specifically so it still runs even
        when React's own effects are the thing that got stuck — it checks
        once, after a generous grace period, whether <main> ever grew
        past the loading placeholder, and if not, reloads exactly once
        (sessionStorage-guarded so a genuine slow backend/network issue
        doesn't loop forever).
      */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          if (sessionStorage.getItem('sd3_watchdog_reloaded')) return;
          setTimeout(function() {
            var main = document.querySelector('main');
            var len = main ? main.innerText.trim().length : 0;
            if (len < 50) {
              sessionStorage.setItem('sd3_watchdog_reloaded', '1');
              location.reload();
            } else {
              sessionStorage.removeItem('sd3_watchdog_reloaded');
            }
          }, 8000);
        })();
      ` }} />

      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* ── Sidebar ── */}
        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
        <aside id="app-sidebar" className={`app-sidebar${navOpen ? " open" : ""}`} style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          padding: "20px 12px",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 20px" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: "rgba(var(--brand-rgb),0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>SD3- Dashboard Điện Máy</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}></div>
            </div>
          </div>

          {/* Active Navigation */}
          <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {LTL_VIEWS.filter((v) =>
              v.id === "ltl" ? canSeeLTL :
              v.id === "map" ? canSeeMap :
              v.id === "damage" ? canSeeDamage :
              v.id === "events" ? canSeeEvents : false
            ).map((v) => (
              <div
                key={v.id}
                className={`nav-item ${activeTab === v.id ? "active" : ""}`}
                onClick={() => goTab(v.id)}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === v.id ? "#fff" : "var(--text-muted)",
                  background: activeTab === v.id ? "rgba(var(--brand-rgb),0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d={v.icon}/>
                </svg>
                {v.label}
              </div>
            ))}
            {canSeeReport && (
              <div
                className={`nav-item ${activeTab === "report" ? "active" : ""}`}
                onClick={() => goTab("report")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "report" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "report" ? "rgba(var(--brand-rgb),0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>
                </svg>
                Báo cáo công ty
              </div>
            )}
            {canSeeTrials && (
              <div
                className={`nav-item ${activeTab === "trials" ? "active" : ""}`}
                onClick={() => goTab("trials")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "trials" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "trials" ? "rgba(var(--brand-rgb),0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 14h9"/>
                </svg>
                Sổ tay cải tiến
              </div>
            )}
            {user.role === "manager" && (
              <div
                className={`nav-item ${activeTab === "users" ? "active" : ""}`}
                onClick={() => goTab("users")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "users" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "users" ? "rgba(var(--brand-rgb),0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Quản lý người dùng
              </div>
            )}
            {user.role === "manager" && (
              <div
                className={`nav-item ${activeTab === "auditlog" ? "active" : ""}`}
                onClick={() => goTab("auditlog")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "auditlog" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "auditlog" ? "rgba(var(--brand-rgb),0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
                </svg>
                Nhật Ký Hoạt Động
              </div>
            )}
            {user.role === "manager" && (
              <div
                className={`nav-item ${activeTab === "health" ? "active" : ""}`}
                onClick={() => goTab("health")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "health" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "health" ? "rgba(var(--brand-rgb),0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                Trạng thái hệ thống
              </div>
            )}
            {user.role === "manager" && (
              <div
                className={`nav-item ${activeTab === "brain" ? "active" : ""}`}
                onClick={() => goTab("brain")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "brain" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "brain" ? "rgba(var(--brand-rgb),0.15)" : "transparent"
                }}
              >
                <span style={{ fontSize: 16 }}>🧠</span>
                Bộ Não Tiểu Đệ
              </div>
            )}
          </nav>

          {/* ── Role Switcher (Manager only) ── */}
          {isManager && dashData && (
            <div style={{ position: "relative", marginTop: "auto" }}>
              {/* label */}
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "12px 8px 4px" }}>
                🎭 Đang xem theo vai trò
              </div>
              <button
                onClick={() => setShowRoleMenu(v => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 10px", borderRadius: 8, fontSize: 12, fontFamily: "inherit",
                  cursor: "pointer", transition: "all 0.2s",
                  background: "var(--panel-glow)", border: "1px solid var(--border)",
                  color: "var(--text-primary)", fontWeight: 600,
                }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                  {viewAs.type === "manager" ? "👑 Manager (Tổng)" : viewAs.type === "cs" ? `👤 Nhân sự: ${viewAs.value}` : `📦 KH: ${viewAs.value}`}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points={showRoleMenu ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/>
                </svg>
              </button>

              {showRoleMenu && (() => {
                const allClients = allProjects;
                const menuItems = [
                  { label: "👑 Manager (Tổng quan)", type: "manager", value: null },
                  ...staffPics.map(p => ({ label: `👤 Nhân sự: ${p}`, type: "cs", value: p })),
                  ...allClients.map(c => ({ label: `📦 KH: ${c}`, type: "project", value: c })),
                ];
                return (
                  <div style={{
                    position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4,
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    borderRadius: 10, boxShadow: "0 -8px 32px rgba(0,0,0,0.3)",
                    maxHeight: 260, overflowY: "auto", zIndex: 999,
                  }}>
                    {menuItems.map((item, i) => {
                      const isActive = viewAs.type === item.type && viewAs.value === item.value;
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            setViewAs({ type: item.type, value: item.value });
                            setShowRoleMenu(false);
                            setNavOpen(false);
                          }}
                          style={{
                            padding: "8px 12px", fontSize: 11.5, cursor: "pointer",
                            color: isActive ? "var(--cyan)" : "var(--text-secondary)",
                            background: isActive ? "var(--cyan-glow)" : "transparent",
                            fontWeight: isActive ? 700 : 400,
                            borderBottom: i < menuItems.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                            transition: "background 0.15s",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                          onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                          onMouseOut={(e)  => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                        >
                          {item.label}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* User info + Logout */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: isManager && dashData ? 8 : "auto" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
              👑 {user.role === "sd3" ? "Chuyên viên SD" : user.role === "cs" ? "CS" : "Manager"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.name || ""}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email || ""}
            </div>
            <ThemeToggle style={{ marginBottom: 6, border: "none", padding: "8px 8px" }} />
            <button
              onClick={() => { window.location.href = "/api/logout"; }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 13, color: "var(--text-muted)", background: "none",
                border: "none", cursor: "pointer", fontFamily: "inherit",
                padding: "8px 8px", borderRadius: 6, transition: "all 0.2s", width: "100%",
              }}
              onMouseOver={(e) => e.currentTarget.style.color = "var(--red)"}
              onMouseOut={(e)  => e.currentTarget.style.color = "var(--text-muted)"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Đăng xuất
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          {/* min-height / padding / gap live in .dashboard-header (globals.css) so the phone layout can override them */}
          <header className={`dashboard-header${filtersOpen ? " filters-open" : ""}`} style={{
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            position: "relative",
            zIndex: 100,
          }}>
            <div className="header-title-group" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className="nav-toggle"
                onClick={() => setNavOpen(true)}
                aria-label="Mở menu"
                aria-controls="app-sidebar"
                aria-expanded={navOpen}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <div className="header-title" style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
                {LTL_VIEWS.find((v) => v.id === activeTab)?.label
                  || (activeTab === "report" ? "Báo cáo công ty"
                  : activeTab === "trials" ? "Sổ tay Cải tiến & Đo lường Giải pháp"
                  : activeTab === "users" ? "Quản lý người dùng"
                  : activeTab === "auditlog" ? "Nhật Ký Hoạt Động"
                  : activeTab === "health" ? "Trạng thái hệ thống"
                  : activeTab === "brain" ? "Bộ Não Tiểu Đệ"
                  : "SD3- Dashboard Điện Máy")}
              </div>
              {isManager && viewAs.type !== "manager" && (
                <div className="viewas-chip" style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                  background: "var(--cyan-glow)", border: "1px solid rgba(var(--brand-rgb),0.45)",
                  color: "var(--cyan)",
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span className="viewas-text">{viewAs.type === "cs" ? `Xem góc nhìn Nhân sự: ${viewAs.value}` : `Xem góc nhìn KH: ${viewAs.value}`}</span>
                  <button
                    onClick={() => setViewAs({ type: "manager", value: null })}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--cyan)", lineHeight: 1, marginLeft: 2 }}>✕</button>
                </div>
              )}
            </div>

            {isLTLView ? (
              <div className="header-filters">
              <FilterBar
                selectedMonths={selectedMonths}
                onMonthsChange={setSelectedMonths}
                selectedProjects={selectedProjects}
                onProjectsChange={setSelectedProjects}
                availableProjects={allProjects}
                userRole={dashData?.user?.role}
                userProject={dashData?.user?.project}
                filterMode={filterMode}
                onFilterModeChange={setFilterMode}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
              />
              </div>
            ) : (
              <div className="header-spacer" style={{ flex: 1 }} />
            )}

            {/* Sync & Live indicator */}
            <div className="header-actions" style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {isLTLView && (
                <button
                  type="button"
                  className="filters-toggle"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  title={filtersOpen ? "Ẩn bộ lọc" : "Hiện bộ lọc"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                  Lọc
                  {activeFilterCount > 0 && <span className="filters-count">{activeFilterCount}</span>}
                </button>
              )}
              {/* display:contents on desktop (no layout change); hidden on phone — the drawer has its own toggle */}
              <span className="header-theme">
                <ThemeToggle style={{ width: "auto", border: "1px solid var(--border)", padding: "5px 10px", borderRadius: 6 }} />
              </span>

              <button
                onClick={async () => {
                  if (confirm("Đồng bộ lại dữ liệu từ Google Sheet ngay? (Mất khoảng 15-30 giây.)")) {
                    setLoading(true);
                    try {
                      // One rebuild of the Blob snapshot, then a normal fetch
                      // of the current filters (dates included).
                      await fetch(`/api/data?force=true&t=${Date.now()}`);
                      await fetchDashboardData(selectedMonths, selectedProjects, filterMode, viewAs, periodWeeks, dateFrom, dateTo);
                      alert("Đồng bộ thành công!");
                    } finally {
                      setLoading(false);
                    }
                  }
                }}
                disabled={loading}
                className="sync-btn"
                title="Đồng bộ Google Sheet"
                aria-label="Đồng bộ Google Sheet"
                style={{
                  background: "rgba(var(--brand-rgb),0.1)",
                  border: "1px solid rgba(var(--brand-rgb),0.2)",
                  color: "var(--cyan)",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "5px 10px",
                  borderRadius: 6,
                  cursor: loading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.2s"
                }}
              >
                <span>🔄<span className="sync-label"> Đồng bộ Google Sheet</span></span>
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--green)" }}>
                <div style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "var(--green)",
                }} />
                <span className="live-label">LIVE</span>
              </div>
            </div>
          </header>

          {/* Dashboard body */}
          <main className="dashboard-main" style={{ flex: 1, overflowY: "auto", position: "relative" }}>
            {activeTab === "none" ? (
              <div style={{
                background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 12, padding: 24, color: "var(--amber)", textAlign: "center",
              }}>
                Tài khoản của bạn chưa được cấp quyền xem mục nào. Vui lòng liên hệ quản lý.
              </div>
            ) : KEEP_ALIVE_TABS.includes(activeTab) ? null
            : activeTab === "brain" ? (
              <TabBrain role={user.role} />
            ) : reportOpen && dashData ? (
              <ExecutiveReport
                body={dashData}
                onClose={() => setReportOpen(false)}
                scopeLabel={[
                  dateFrom && dateTo
                    ? `${dateFrom.split("-").reverse().join("/")} – ${dateTo.split("-").reverse().join("/")}`
                    : selectedMonths.length ? selectedMonths.map((m) => `T${m}`).join(", ") : "Toàn bộ từ 07/2026",
                  selectedProjects.length ? selectedProjects.join(", ") : "tất cả dự án",
                  selectedOrigin ? `điểm lấy ${selectedOrigin}` : null,
                  filterMode === "delivered" ? "theo ngày giao" : "theo ngày lấy hàng",
                ].filter(Boolean).join(" · ")}
              />
            ) : (
              <>
                {/* Refetch: keep current content, show a thin progress bar */}
                {loading && dashData && (
                  <div className="top-progress main-progress" style={{ position: "sticky", top: 0 }} />
                )}

                {error && !loading && (
                  <div style={{
                    background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)",
                    borderRadius: 10, padding: 20, color: "var(--red)",
                  }}>
                    Lỗi tải dữ liệu: {error}. Vui lòng thử lại hoặc kiểm tra kết nối Google Sheets.
                  </div>
                )}

                {!dashData && loading && <DashboardSkeleton view={activeTab} />}

                {dashData && !(error && !loading) && <div className={loading ? "refreshing" : "fade-in"}><LTLDashboard view={activeTab} data={ltlData} mapState={activeTab === "map" ? mapState : undefined} rawData={dashData.raw} aiInsights={dashData.aiInsights} selectedProjects={selectedProjects} selectedMonths={selectedMonths} userRole={dashData.user?.role} periodWeeks={periodWeeks} onPeriodWeeksChange={setPeriodWeeks} selectedOrigin={selectedOrigin} onOriginChange={setSelectedOrigin} fetchProvinceOrders={fetchProvinceOrders} pendingPickup={dashData.pendingPickup} fetchPendingOrders={fetchPendingOrders} kpiDelta={dashData.kpiDelta} stuck={dashData.stuck} fetchStuckOrders={fetchStuckOrders} anomalies={dashData.anomalies} damageRisk={dashData.damageRisk} riskOnly={riskOnly} onRiskOnlyChange={setRiskOnly} sparkline={dashData.sparkline} dueToday={dashData.dueToday} fetchDueTodayOrders={fetchDueTodayOrders} onQuickRiskRoutes={() => { setRiskOnly(true); setActiveTab("damage"); }} onQuickLowOntime={setSelectedProjects} onOpenReport={() => setReportOpen(true)} onOpenCompanyReport={() => setActiveTab("report")} damageTrend={dashData.damageTrend} exceptions={dashData.exceptions} damageMoney={dashData.damageMoney} damageAnalysis={dashData.damageAnalysis} dailyOrders={dashData.dailyOrders} /></div>}
              </>
            )}
            {/* Opened tabs stay mounted, hidden while another tab is shown. */}
            {KEEP_ALIVE_TABS.filter((id) => visited.has(id) || activeTab === id).map((id) => (
              <div key={id} style={activeTab === id ? undefined : { display: "none" }}>
                {id === "report" ? <TabCompanyReport />
                  : id === "trials" ? <TabTrials />
                  : id === "users" ? <TabUsers />
                  : id === "auditlog" ? <TabAuditLog />
                  : <TabSystemHealth />}
              </div>
            ))}
          </main>
        </div>
      </div>
      {user.role !== "cs" && <AIChatDrawer role={user.role} />}
    </>
  );
}

export async function getServerSideProps({ req, res, query }) {
  // Keep-warm ping (lib/warm.js, Kế hoạch A · P5): load what a real visit
  // needs (Users sheet via googleapis) and answer 404 — no page, no session.
  const { isWarmPing } = await import("../lib/warm");
  if (isWarmPing({ query, headers: req.headers })) {
    const { getAllUsers } = await import("../lib/users");
    await getAllUsers().catch(() => {});
    return { notFound: true };
  }
  const { getSession } = await import("../lib/auth");
  const { findUserByEmployeeId } = await import("../lib/users");
  const session = await getSession(req, res);
  if (!session?.user) {
    return { redirect: { destination: "/login", permanent: false } };
  }

  // Live session re-validation: if manager approved the user's role on the Users sheet,
  // sync the new role/tabs into the active cookie session so they get in on reload.
  if (session.user.employeeId) {
    try {
      const dbUser = await findUserByEmployeeId(session.user.employeeId);
      if (dbUser && (dbUser.role !== session.user.role || JSON.stringify(dbUser.tabs) !== JSON.stringify(session.user.tabs))) {
        session.user.role = dbUser.role;
        session.user.pic = dbUser.pic || session.user.pic;
        session.user.tabs = dbUser.tabs || [];
        await session.save();
      }
    } catch (e) {
      // fallback to existing session if sheet read fails
    }
  }

  return { props: { user: session.user } };
}
