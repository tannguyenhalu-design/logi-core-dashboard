/**
 * pages/dashboard.js — Main dashboard page
 * Protected via getServerSideProps (session check).
 * Filter state managed here and passed down to all tabs for sync.
 */
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import FilterBar from "../components/FilterBar";
import dynamic from "next/dynamic";
import { transformLTL } from "../lib/transform-ltl";

const TabLTL        = dynamic(() => import("../components/TabLTL"),        { ssr: false });
const TabOperations = dynamic(() => import("../components/TabOperations"), { ssr: false });

export default function DashboardPage({ user: initialUser }) {
  const user = initialUser || {};
  const [activeTab, setActiveTab] = useState("ltl"); // 'ltl' | 'operations'
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [filterMode, setFilterMode] = useState("pickup");
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState(null);
  const [rawCache, setRawCache] = useState(null);

  // ── Fetch raw data ONCE on mount ──
  const fetchRaw = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = forceRefresh 
        ? `/api/rawdata?refresh=true&t=${Date.now()}` 
        : `/api/rawdata?t=${Date.now()}`;
      const res = await fetch(url);
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

  // ── Apply all transforms client-side ──
  const applyTransforms = useCallback((raw, months, projects, fMode) => {
    if (!raw) return;
    setFiltering(true);
    setTimeout(() => {
      try {
        const userSession = raw.user || {};
        const picMapping = raw.picMapping || {};

        let ltlSource = raw.ltl || [];
        let damageSource = raw.damage || [];

        // PIC Filtering check
        if (userSession.role === "pic" && userSession.pic) {
          ltlSource = (raw.ltl || []).filter(r => picMapping[r.client_name] === userSession.pic);
          damageSource = (raw.damage || []).filter(r => picMapping[r.client_name] === userSession.pic);
        }

        const mFilter  = months.length > 0 ? months : null;
        const pFilter  = userSession.role === "client" && userSession.project
          ? [userSession.project]
          : projects.length > 0 ? projects : null;
        const filters  = { months: mFilter, projects: pFilter, filterMode: fMode || "pickup" };

        const ltlData      = transformLTL(ltlSource, filters, damageSource);

        setDashData({
          ok: true,
          user:    userSession,
          picMapping,
          filters,
          ltl:     ltlData,
          overview: {
            allProjectsLTL: ltlData.allProjects || [],
          },
          raw: {
            ltl: ltlSource,
            damage: damageSource,
            user: userSession,
            picMapping,
          }
        });
      } catch(e) { setError(e.message); }
      finally    { setFiltering(false); }
    }, 0);
  }, []);

  // Mount: fetch raw once
  useEffect(() => {
    fetchRaw().then(raw => { if (raw) applyTransforms(raw, [], []); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter change: re-transform client-side
  useEffect(() => {
    if (rawCache) applyTransforms(rawCache, selectedMonths, selectedProjects, filterMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonths, selectedProjects, filterMode]);

  const allProjects = dashData
    ? (dashData.overview?.allProjectsLTL || []).sort()
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

          {/* Active Navigation */}
          <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div 
              className={`nav-item ${activeTab === "ltl" ? "active" : ""}`}
              onClick={() => setActiveTab("ltl")}
              style={{
                cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                color: activeTab === "ltl" ? "#fff" : "var(--text-muted)",
                background: activeTab === "ltl" ? "rgba(59,130,246,0.15)" : "transparent"
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3h18v18H3z"/><path d="M21 9H3M9 21V9"/>
              </svg>
              LTL Dashboard
            </div>
            <div 
              className={`nav-item ${activeTab === "operations" ? "active" : ""}`}
              onClick={() => setActiveTab("operations")}
              style={{
                cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                color: activeTab === "operations" ? "#fff" : "var(--text-muted)",
                background: activeTab === "operations" ? "rgba(59,130,246,0.15)" : "transparent"
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Team Vận Hành
            </div>
          </nav>

          {/* User info + Logout */}
          <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
              👑 {dashData?.user?.role === "pic" ? "PIC Vận Hành" : "Manager"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.name || ""}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email || ""}
            </div>
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
              {activeTab === "ltl" ? "LTL Dashboard" : "Team Vận Hành"}
            </div>

            {activeTab === "ltl" ? (
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
              />
            ) : (
              <div style={{ flex: 1 }} />
            )}

            {/* Sync & Live indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={async () => {
                  if (confirm("Đồng bộ dữ liệu trực tiếp từ Google Sheet? (Quá trình này có thể mất 15-20s do tải >50.000 dòng từ Sheet).")) {
                    const raw = await fetchRaw(true);
                    if (raw) {
                      applyTransforms(raw, selectedMonths, selectedProjects, filterMode);
                      alert("Đồng bộ thành công!");
                    } else {
                      alert("Đồng bộ thất bại, vui lòng kiểm tra lại mạng!");
                    }
                  }
                }}
                disabled={loading}
                style={{
                  background: "rgba(59,130,246,0.1)",
                  border: "1px solid rgba(59,130,246,0.2)",
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
                🔄 Đồng bộ Google Sheet
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--green)" }}>
                <div style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "var(--green)", boxShadow: "0 0 8px var(--green)",
                  animation: "spin 2s linear infinite",
                }} />
                LIVE
              </div>
            </div>
          </header>

          {/* Dashboard body */}
          <main style={{ flex: 1, overflowY: "auto", padding: 24, position: "relative" }}>
            {/* Full-page spinner */}
            {loading && (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
                <div className="spinner" />
              </div>
            )}

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
              activeTab === "ltl" ? (
                <TabLTL data={dashData.ltl} />
              ) : (
                <TabOperations rawData={dashData.raw} />
              )
            )}
          </main>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps({ req, res }) {
  const { getSession } = await import("../lib/auth");
  const session = await getSession(req, res);
  if (!session?.user) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  return { props: { user: session.user } };
}
