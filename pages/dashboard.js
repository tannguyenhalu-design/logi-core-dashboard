/**
 * pages/dashboard.js — Main dashboard page
 * Protected via getServerSideProps (session check).
 * Filter state managed here and passed down to all tabs for sync.
 */
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import FilterBar from "../components/FilterBar";
import TabOverview from "../components/TabOverview";
import TabLTL from "../components/TabLTL";
import TabFTL from "../components/TabFTL";

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
];

export default function DashboardPage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState(
    user.project ? [user.project] : []
  );
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedMonths.length > 0) params.set("months", selectedMonths.join(","));
      if (selectedProjects.length > 0) params.set("projects", selectedProjects.join(","));
      const res = await fetch(`/api/data?${params.toString()}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setDashData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedMonths, selectedProjects]);

  // Re-fetch whenever filters change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const allProjects = dashData
    ? [...new Set([
        ...(dashData.ltl?.allProjects || []),
        ...(dashData.ftl?.allProjects || []),
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
              {user.role === "manager" ? "👑 Quản lý" : "👤 Khách hàng"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              {user.username}
            </div>
            <a
              href="/api/logout"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 13, color: "var(--text-muted)", textDecoration: "none",
                padding: "8px 8px", borderRadius: 6, transition: "all 0.2s",
              }}
              onMouseOver={(e) => e.currentTarget.style.color = "var(--red)"}
              onMouseOut={(e) => e.currentTarget.style.color = "var(--text-muted)"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Đăng xuất
            </a>
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
          <main style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            {loading && (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
                <div className="spinner" />
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
                {activeTab === "overview" && <TabOverview overview={dashData.overview} />}
                {activeTab === "ltl" && <TabLTL data={dashData.ltl} />}
                {activeTab === "ftl" && <TabFTL data={dashData.ftl} />}
              </>
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
