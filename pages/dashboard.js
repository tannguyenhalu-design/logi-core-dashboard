/**
 * pages/dashboard.js — Main dashboard page
 * Protected via getServerSideProps (session check).
 * Filter state managed here and passed down to all tabs for sync.
 */
import { useState, useEffect, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import Head from "next/head";
import FilterBar from "../components/FilterBar";
import dynamic from "next/dynamic";
import { transformLTL } from "../lib/transform-ltl";
import { transformFTL } from "../lib/transform-ftl";
import { transformTachTrip } from "../lib/transform-tach-trip";
import { transformAIInsights } from "../lib/transform-ai-insights";

const TabOverview   = dynamic(() => import("../components/TabOverview"),   { ssr: false });
const TabLTL        = dynamic(() => import("../components/TabLTL"),        { ssr: false });
const TabFTL        = dynamic(() => import("../components/TabFTL"),        { ssr: false });
const TabTachTrip   = dynamic(() => import("../components/TabTachTrip"),   { ssr: false });
const TabAIInsights = dynamic(() => import("../components/TabAIInsights"), { ssr: false });

const TABS = [
  {
    id: "overview",
    label: "Tổng quan",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    id: "ltl",
    label: "LTL",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
      </svg>
    ),
  },
  {
    id: "ftl",
    label: "FTL",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="1" y="3" width="15" height="13"/>
        <path d="M16 8h4l3 3v5h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/>
        <circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
  },
  {
    id: "tachtrip",
    label: "Tách Chuyến LTL",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
        <line x1="15" y1="3" x2="15" y2="21"/>
      </svg>
    ),
  },
  {
    id: "ai",
    label: "AI Insights",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V12h-4V9.5C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
        <path d="M8 12H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-3"/>
        <circle cx="12" cy="17" r="1"/>
      </svg>
    ),
  },
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const user = session?.user || {};
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState(null);
  const [rawCache, setRawCache] = useState(null);

  // ── Fetch raw data ONCE on mount (or manual refresh) ──
  const fetchRaw = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rawdata");
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const raw = await res.json();
      setRawCache(raw);
      return raw;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Apply all transforms client-side (instant, no API call) ──
  const applyTransforms = useCallback((raw, months, projects) => {
    if (!raw) return;
    setFiltering(true);
    setTimeout(() => {
      try {
        const mFilter  = months.length > 0 ? months : null;
        const pFilter  = user.role === "client" && user.project
          ? [user.project]
          : projects.length > 0 ? projects : null;
        const filters  = { months: mFilter, projects: pFilter };

        const ltlData      = transformLTL(raw.ltl, filters);
        const ftlData      = transformFTL(raw.ftl, raw.masterVehicle, filters);
        const tachTripData = transformTachTrip(raw.ltl);
        const aiInsights   = transformAIInsights(raw.ltl);
        const overviewLTL  = transformLTL(raw.ltl, {});
        const overviewFTL  = transformFTL(raw.ftl, raw.masterVehicle, {});

        setDashData({
          ok: true,
          user:    { role: user.role || "manager", project: user.project || null },
          filters,
          ltl:     ltlData,
          ftl:     ftlData,
          tachTrip:   tachTripData,
          aiInsights,
          overview: {
            ltl: { totalOrders: overviewLTL.totalOrders, totalWeight: overviewLTL.totalWeight, ontimePct: overviewLTL.ontimePct, totalBroken: overviewLTL.totalBroken },
            ftl: { totalTrips:  overviewFTL.totalTrips,  totalOrders: overviewFTL.totalOrders,  totalWeight: overviewFTL.totalWeight },
            allProjectsLTL: ltlData.allProjects || [],
            allProjectsFTL: ftlData.allProjects || [],
          },
        });
      } catch(e) { setError(e.message); }
      finally    { setFiltering(false); }
    }, 0);
  }, [user]);

  // Mount: fetch raw once
  useEffect(() => {
    fetchRaw().then(raw => { if (raw) applyTransforms(raw, [], []); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter change: re-transform client-side (no API call, instant)
  useEffect(() => {
    if (rawCache) applyTransforms(rawCache, selectedMonths, selectedProjects);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonths, selectedProjects]);

  const allProjects = dashData
    ? [...new Set([
        ...(dashData.overview?.allProjectsLTL || []),
        ...(dashData.overview?.allProjectsFTL || []),
      ])].sort()
    : user.project ? [user.project] : [];

  return (
    <>
      <Head>
        <title>LogiCore Dashboard</title>
        <meta name="description" content="Hệ thống theo dõi vận hành logistics điện máy" />
      </Head>

      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* ── Sidebar ── */}
        <aside style={{
          width: 220, background: "rgba(30,41,59,0.5)",
          borderRight: "1px solid var(--border)",
          padding: "20px 12px",
          display: "flex", flexDirection: "column", gap: 4,
          backdropFilter: "blur(12px)",
        }}>
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 20px" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: "rgba(59,130,246,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>LogiCore</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dashboard</div>
            </div>
          </div>

          {/* Tabs */}
          <nav className="sidebar-nav">
            {TABS.map((tab) => (
              <div
                key={tab.id}
                className={`nav-item${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </div>
            ))}
          </nav>

          {/* User info + Logout */}
          <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
              👑 Quản lý
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2 }}>
              {user.name || ""}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, opacity: 0.7 }}>
              {user.email || ""}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
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
          <header style={{
            height: 60, background: "rgba(30,41,59,0.7)",
            borderBottom: "1px solid var(--border)",
            backdropFilter: "blur(12px)",
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px", gap: 16,
            position: "relative",
            zIndex: 100,
          }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
              {TABS.find((t) => t.id === activeTab)?.label}
            </div>

            <FilterBar
              selectedMonths={selectedMonths}
              onMonthsChange={setSelectedMonths}
              selectedProjects={selectedProjects}
              onProjectsChange={setSelectedProjects}
              availableProjects={allProjects}
              userRole={user.role}
              userProject={user.project}
            />

            {/* Live indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--green)" }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: "var(--green)", boxShadow: "0 0 8px var(--green)",
                animation: "spin 2s linear infinite",
              }} />
              LIVE
            </div>
          </header>

          {/* Dashboard body */}
          <main style={{ flex: 1, overflowY: "auto", padding: 24, position: "relative" }}>
            {/* Full-page spinner: first load only */}
            {loading && (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
                <div className="spinner" />
              </div>
            )}

            {/* Lightweight filter indicator (data still visible) */}
            {filtering && !loading && (
              <div style={{
                position: "absolute", top: 12, right: 24, zIndex: 10,
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, color: "var(--blue)",
                background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 20, padding: "4px 10px",
              }}>
                <div className="spinner" style={{ width: 10, height: 10 }} />
                Đang lọc...
              </div>
            )}

            {error && !loading && (
              <div style={{
                background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)",
                borderRadius: 10, padding: 20, color: "var(--red)",
              }}>
                Lỗi tải dữ liệu: {error}. Vui lòng thử lại hoặc kiểm tra kết nối Google Sheets.
              </div>
            )}

            {!loading && !error && dashData && (

              <>
                {activeTab === "overview"  && <TabOverview    overview={dashData.overview} ltlFiltered={dashData.ltl} />}
                {activeTab === "ltl"       && <TabLTL         data={dashData.ltl} />}
                {activeTab === "ftl"       && <TabFTL         data={dashData.ftl} />}
                {activeTab === "tachtrip"  && <TabTachTrip    tcData={dashData.tachTrip} />}
                {activeTab === "ai"        && <TabAIInsights  data={dashData} />}
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps(context) {
  const { getServerSession } = await import("next-auth");
  const { authOptions } = await import("../lib/auth-options");
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  return { props: {} };
}
