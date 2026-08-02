/**
 * pages/dashboard.js — Main dashboard page
 * Protected via getServerSideProps (session check).
 * Filter state managed here and passed down to all tabs for sync.
 */
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import FilterBar from "../components/FilterBar";
import TruckLoader from "../components/TruckLoader";
import ThemeToggle from "../components/ThemeToggle";
import dynamic from "next/dynamic";
import { transformLTL } from "../lib/transform-ltl";

const TabLTL        = dynamic(() => import("../components/TabLTL"),        { ssr: false });
const TabOperations = dynamic(() => import("../components/TabOperations"), { ssr: false });
const TabTachTrip   = dynamic(() => import("../components/TabTachTrip"),   { ssr: false });
const TabUsers      = dynamic(() => import("../components/TabUsers"),      { ssr: false });
const TabAuditLog   = dynamic(() => import("../components/TabAuditLog"),   { ssr: false });

export default function DashboardPage({ user: initialUser }) {
  const user = initialUser || {};
  const isManager = user.role === "manager";
  const allowedTabs = isManager ? ["ltl", "operations", "tachtrip"] : (user.tabs || []);
  const canSeeLTL = allowedTabs.includes("ltl");
  const canSeeOperations = allowedTabs.includes("operations");
  const canSeeTachTrip = allowedTabs.includes("tachtrip");
  const [activeTab, setActiveTab] = useState(allowedTabs[0] || "none"); // 'ltl' | 'operations' | 'tachtrip' | 'users' | 'none'
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [filterMode, setFilterMode] = useState("pickup");
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(canSeeLTL);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState(null);
  const [rawCache, setRawCache] = useState(null);
  const [tcData, setTcData] = useState(null);
  const [tcLoading, setTcLoading] = useState(false);
  const [tcError, setTcError] = useState(null);
  // Role-switcher for manager: { type: 'manager'|'pic'|'project', value: string|null }
  const [viewAs, setViewAs] = useState({ type: "manager", value: null });
  const [showRoleMenu, setShowRoleMenu] = useState(false);

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
  const applyTransforms = useCallback((raw, months, projects, fMode, overrideViewAs) => {
    if (!raw) return;
    setFiltering(true);
    setTimeout(() => {
      try {
        const userSession = raw.user || {};
        const picMapping = raw.picMapping || {};

        let ltlSource = raw.ltl || [];
        let damageSource = raw.damage || [];

        // Role-switcher: manager can impersonate a PIC or a project view
        const effectiveViewAs = overrideViewAs !== undefined ? overrideViewAs : viewAs;
        if (userSession.role === "manager" && effectiveViewAs.type === "pic" && effectiveViewAs.value) {
          ltlSource = ltlSource.filter(r => picMapping[r.client_name] === effectiveViewAs.value);
          damageSource = damageSource.filter(r => picMapping[r.client_name] === effectiveViewAs.value);
        } else if (userSession.role === "manager" && effectiveViewAs.type === "project" && effectiveViewAs.value) {
          ltlSource = ltlSource.filter(r => r.client_name === effectiveViewAs.value);
          damageSource = damageSource.filter(r => r.client_name === effectiveViewAs.value);
        } else if (userSession.role === "pic" && userSession.pic) {
          // PIC Filtering check (for actual PIC users)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAs]);

  // Mount: fetch raw once (only if this user can see the LTL tab at all)
  useEffect(() => {
    if (!canSeeLTL) return;
    fetchRaw().then(raw => { if (raw) applyTransforms(raw, [], [], "pickup", { type: "manager", value: null }); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tách Chuyến: fetch lazily the first time the user opens that tab
  useEffect(() => {
    if (activeTab !== "tachtrip" || tcData || tcLoading) return;
    setTcLoading(true);
    setTcError(null);
    fetch(`/api/tachtrip?t=${Date.now()}`)
      .then(res => res.json())
      .then(json => {
        if (!json.ok) throw new Error(json.error || "Lỗi tải dữ liệu");
        setTcData(json.tcData);
      })
      .catch(e => setTcError(e.message))
      .finally(() => setTcLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Filter change: re-transform client-side
  useEffect(() => {
    if (rawCache) applyTransforms(rawCache, selectedMonths, selectedProjects, filterMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonths, selectedProjects, filterMode, viewAs]);

  const allProjects = dashData
    ? (dashData.overview?.allProjectsLTL || []).sort()
    : user.project ? [user.project] : [];

  return (
    <>
      <Head>
        <title>SD3-Điện Máy Dashboard</title>
        <meta name="description" content="Hệ thống theo dõi vận hành logistics điện máy" />
      </Head>

      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* ── Sidebar ── */}
        <aside style={{
          width: 220, background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          padding: "20px 12px",
          display: "flex", flexDirection: "column", gap: 4,
          backdropFilter: "blur(12px)",
        }}>
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 20px" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: "rgba(20, 224, 196,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14e0c4" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>SD3-Điện Máy</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dashboard</div>
            </div>
          </div>

          {/* Active Navigation */}
          <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {canSeeLTL && (
              <div
                className={`nav-item ${activeTab === "ltl" ? "active" : ""}`}
                onClick={() => setActiveTab("ltl")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "ltl" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "ltl" ? "rgba(20, 224, 196,0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3h18v18H3z"/><path d="M21 9H3M9 21V9"/>
                </svg>
                LTL Dashboard
              </div>
            )}
            {canSeeOperations && (
              <div
                className={`nav-item ${activeTab === "operations" ? "active" : ""}`}
                onClick={() => setActiveTab("operations")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "operations" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "operations" ? "rgba(20, 224, 196,0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Vận hành SD3
              </div>
            )}
            {canSeeTachTrip && (
              <div
                className={`nav-item ${activeTab === "tachtrip" ? "active" : ""}`}
                onClick={() => setActiveTab("tachtrip")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "tachtrip" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "tachtrip" ? "rgba(20, 224, 196,0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7"/>
                </svg>
                Tách Chuyến
              </div>
            )}
            {user.role === "manager" && (
              <div
                className={`nav-item ${activeTab === "users" ? "active" : ""}`}
                onClick={() => setActiveTab("users")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "users" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "users" ? "rgba(20, 224, 196,0.15)" : "transparent"
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
                onClick={() => setActiveTab("auditlog")}
                style={{
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, transition: "all 0.2s",
                  color: activeTab === "auditlog" ? "#fff" : "var(--text-muted)",
                  background: activeTab === "auditlog" ? "rgba(20, 224, 196,0.15)" : "transparent"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
                </svg>
                Nhật Ký Hoạt Động
              </div>
            )}
          </nav>

          {/* ── Role Switcher (Manager only) ── */}
          {isManager && rawCache && (
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
                  background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.4)",
                  color: "#a78bfa", fontWeight: 600,
                }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                  {viewAs.type === "manager" ? "👑 Manager (Tổng)" : viewAs.type === "pic" ? `👤 PIC: ${viewAs.value}` : `📦 KH: ${viewAs.value}`}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points={showRoleMenu ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/>
                </svg>
              </button>

              {showRoleMenu && (() => {
                const picMapping = rawCache.picMapping || {};
                const allPICs = [...new Set(Object.values(picMapping))].filter(Boolean).sort();
                const allClients = [...new Set((rawCache.ltl || []).map(r => r.client_name))].filter(Boolean).sort();
                const menuItems = [
                  { label: "👑 Manager (Tổng quan)", type: "manager", value: null },
                  ...allPICs.map(p => ({ label: `👤 PIC: ${p}`, type: "pic", value: p })),
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
                          }}
                          style={{
                            padding: "8px 12px", fontSize: 11.5, cursor: "pointer",
                            color: isActive ? "#a78bfa" : "var(--text-secondary)",
                            background: isActive ? "rgba(139,92,246,0.12)" : "transparent",
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
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: isManager && rawCache ? 8 : "auto" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
              👑 {user.role === "pic" ? "PIC Vận Hành" : user.role === "client" ? "Khách hàng" : "Manager"}
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
          <header style={{
            height: 60, background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            backdropFilter: "blur(12px)",
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px", gap: 16,
            position: "relative",
            zIndex: 100,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
                {activeTab === "ltl" ? "LTL Dashboard"
                  : activeTab === "users" ? "Quản lý người dùng"
                  : activeTab === "operations" ? "Vận hành SD3"
                  : activeTab === "tachtrip" ? "Tách Chuyến"
                  : activeTab === "auditlog" ? "Nhật Ký Hoạt Động"
                  : "SD3-Điện Máy"}
              </div>
              {isManager && viewAs.type !== "manager" && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                  background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.5)",
                  color: "#c4b5fd",
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  {viewAs.type === "pic" ? `Xem góc nhìn PIC: ${viewAs.value}` : `Xem góc nhìn KH: ${viewAs.value}`}
                  <button
                    onClick={() => setViewAs({ type: "manager", value: null })}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "#c4b5fd", lineHeight: 1, marginLeft: 2 }}>✕</button>
                </div>
              )}
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
              <ThemeToggle style={{ width: "auto", border: "1px solid var(--border)", padding: "5px 10px", borderRadius: 6 }} />

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
                  background: "rgba(20, 224, 196,0.1)",
                  border: "1px solid rgba(20, 224, 196,0.2)",
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
            {activeTab === "none" ? (
              <div style={{
                background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 12, padding: 24, color: "var(--amber)", textAlign: "center",
              }}>
                Tài khoản của bạn chưa được cấp quyền xem mục nào. Vui lòng liên hệ quản lý.
              </div>
            ) : activeTab === "users" ? (
              <TabUsers />
            ) : activeTab === "auditlog" ? (
              <TabAuditLog />
            ) : activeTab === "tachtrip" ? (
              tcLoading ? (
                <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
                  <TruckLoader size={88} label="Đang tải dữ liệu Tách Chuyến..." />
                </div>
              ) : tcError ? (
                <div style={{
                  background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)",
                  borderRadius: 10, padding: 20, color: "var(--red)",
                }}>
                  Lỗi tải dữ liệu: {tcError}.
                </div>
              ) : (
                <TabTachTrip tcData={tcData} />
              )
            ) : (
              <>
                {/* Full-page loader */}
                {loading && (
                  <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
                    <TruckLoader size={88} label="Đang tải dữ liệu..." />
                  </div>
                )}

                {filtering && !loading && (
                  <div style={{
                    position: "absolute", top: 12, right: 24, zIndex: 10,
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 11, color: "var(--blue)",
                    background: "rgba(20, 224, 196,0.1)", border: "1px solid rgba(20, 224, 196,0.2)",
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

                {activeTab === "operations" ? (
                  <TabOperations rawData={dashData?.raw} />
                ) : (
                  !loading && !error && dashData && <TabLTL data={dashData.ltl} selectedProjects={selectedProjects} userRole={dashData.user?.role} />
                )}
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
