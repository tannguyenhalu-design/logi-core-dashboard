import { useState } from "react";
import KpiCard from "../../components/KpiCard";
import TruckLoader from "../../components/TruckLoader";
import { downloadCSV } from "../../lib/csv-export";
import { PeriodComparisonSection, BreakageAlertSection } from "../../components/TabAIInsights";
import { useTheme } from "./charts/chartUtils";
import { fmt } from "./utils";

import VolumeTrendChart from "./charts/VolumeTrendChart";
import ProjectPerformanceTable from "./tables/ProjectPerformanceTable";

import ProvinceMapPanel from "./cards/ProvinceMapPanel";
import DetailedDamageTable from "./tables/DetailedDamageTable";
import RouteRiskMatrix from "./damage/RouteRiskMatrix";
import ExceptionsPanel from "./cards/ExceptionsPanel";

// Trend chart above only shows the COMBINED weekly total — "tuần 2 → tuần 3
// giảm" was visible but which client drove it wasn't, and the AI chat had
// no per-week-per-client data to answer that question either. Breaks the
// same isWeekly data down by client so both the user and the AI chat can
// self-serve "which client caused this week's move" for whichever month is
// filtered, instead of needing this dug up by hand each time.
function WeeklyByClientSection({ ordersByProjectAndWeek, ordersByMonth }) {
  const weeks = Object.keys(ordersByMonth || {}).map(Number).sort((a, b) => a - b);
  if (weeks.length < 2) return null;

  const clients = Object.entries(ordersByProjectAndWeek || {})
    .map(([name, byWeek]) => ({
      name,
      byWeek,
      total: weeks.reduce((s, w) => s + (byWeek[w] || 0), 0),
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // Biggest movers between the 2 most recent adjacent weeks — the pair
  // most likely to be what "why did it drop" is asking about.
  const wLast = weeks[weeks.length - 1];
  const wPrev = weeks[weeks.length - 2];
  const movers = clients
    .map((c) => ({ name: c.name, delta: (c.byWeek[wLast] || 0) - (c.byWeek[wPrev] || 0) }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => a.delta - b.delta);
  const drops = movers.filter((m) => m.delta < 0).slice(0, 3);
  const gains = movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);

  return (
    <div className="chart-panel" style={{ width: "100%" }}>
      <div className="chart-panel-title">
        So sánh theo tuần trong tháng — theo khách hàng
      </div>
      {(drops.length > 0 || gains.length > 0) && (
        <div style={{ padding: "0 20px 12px", fontSize: 12.5, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 4 }}>
          {drops.length > 0 && (
            <div>📉 Tuần {wPrev} → Tuần {wLast} giảm nhiều nhất: {drops.map((d) => `${d.name} (${d.delta} đơn)`).join(", ")}</div>
          )}
          {gains.length > 0 && (
            <div>📈 Tuần {wPrev} → Tuần {wLast} tăng nhiều nhất: {gains.map((d) => `${d.name} (+${d.delta} đơn)`).join(", ")}</div>
          )}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>
              <th style={{ padding: "8px 20px", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>Khách hàng</th>
              {weeks.map((w) => (
                <th key={w} style={{ padding: "8px 12px", textAlign: "center", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>Tuần {w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.slice(0, 15).map((c) => (
              <tr key={c.name} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "7px 20px", fontWeight: 600, whiteSpace: "nowrap" }}>{c.name}</td>
                {weeks.map((w, i) => {
                  const cur = c.byWeek[w] || 0;
                  const prevW = weeks[i - 1];
                  const delta = i > 0 ? cur - (c.byWeek[prevW] || 0) : null;
                  return (
                    <td key={w} style={{ padding: "7px 12px", textAlign: "center", whiteSpace: "nowrap" }}>
                      {cur}
                      {delta !== null && delta !== 0 && (
                        <span style={{ marginLeft: 5, fontSize: 11, fontWeight: 600, color: delta > 0 ? "var(--green)" : "var(--red)" }}>
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Shared order-list modal for the "Đơn chờ lấy" and "Đơn treo" drill-downs:
// rows are fetched on demand, columns are { label, render(o), style? }.
function OrderListModal({ title, subtitle, loading, rows, columns, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999
    }} onClick={onClose}>
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 12, padding: 24, width: "90%", maxWidth: 1000,
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>{title}</h2>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {loading ? "Đang tải..." : subtitle}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "var(--text-muted)", fontSize: 24, cursor: "pointer", lineHeight: 1
          }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, borderRadius: 8, border: "1px solid var(--border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--bg-panel)", zIndex: 1 }}>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {columns.map((c) => (
                  <th key={c.label} style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columns.length} style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={columns.length} style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Không có đơn nào</td></tr>
              ) : (
                rows.map((o, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                    {columns.map((c) => (
                      <td key={c.label} style={{ padding: "8px 12px", color: "var(--text-muted)", ...(c.style || {}) }}>{c.render(o)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const fmtKg = (w) => (w ? `${(parseFloat(w) / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} kg` : "-");
const fmtYmd = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "-");
const routeOf = (o) => `${o.from_province_name || "?"} → ${o.to_province_name || "?"}`;

const PENDING_COLUMNS = [
  { label: "Mã Đơn", render: (o) => o.order_code || "N/A", style: { fontWeight: 600, color: "var(--text-primary)" } },
  { label: "Dự Án", render: (o) => o.client_name },
  { label: "Trạng Thái", render: (o) => o.status, style: { color: "var(--amber)" } },
  { label: "Ngày Tạo", render: (o) => o.created_time || "-", style: { whiteSpace: "nowrap" } },
  { label: "Tuyến Đường", render: routeOf },
  { label: "Trọng Lượng", render: (o) => fmtKg(o.weight), style: { whiteSpace: "nowrap" } },
];

const DUE_COLUMNS = [
  { label: "Mã Đơn", render: (o) => o.order_code || "N/A", style: { fontWeight: 600, color: "var(--text-primary)" } },
  { label: "Dự Án", render: (o) => o.client_name },
  { label: "Trạng Thái", render: (o) => o.status, style: { color: "var(--amber)" } },
  { label: "Ngày Lấy", render: (o) => fmtYmd(o.pickup_time), style: { whiteSpace: "nowrap" } },
  { label: "Tuyến Đường", render: routeOf },
  { label: "Kho Giao", render: (o) => o.kho_giao || "-" },
];

// Quick filters (approved 2026-09-26): on-time < 90% needs >= 20 evaluated
// orders in the current view so one late order on a tiny project isn't flagged.
const LOW_ONTIME_PCT = 90;
const LOW_ONTIME_MIN_EVAL = 20;

const quickChip = (on, color) => ({
  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, padding: "6px 12px",
  borderRadius: 20, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  border: `1px solid ${on ? color : "var(--border)"}`, background: on ? "var(--bg-panel)" : "transparent",
  color: on ? color : "var(--text-secondary)", boxShadow: on ? `inset 0 0 0 1px ${color}` : "none",
});

const ANOMALY_COLUMNS = [
  { label: "Dự Án", render: (o) => o.name, style: { fontWeight: 600, color: "var(--text-primary)" } },
  { label: "Kỳ trước", render: (o) => `${o.prev}% (${fmt(o.prevN)} đơn)` },
  { label: "Kỳ này", render: (o) => `${o.cur}% (${fmt(o.curN)} đơn)` },
  { label: "Thay đổi", render: (o) => `▼ ${Math.abs(o.deltaPoints).toLocaleString("vi-VN")} điểm`, style: { fontWeight: 700, color: "var(--red)" } },
];

const STUCK_COLUMNS = [
  { label: "Mã Đơn", render: (o) => o.order_code || "N/A", style: { fontWeight: 600, color: "var(--text-primary)" } },
  { label: "Dự Án", render: (o) => o.client_name },
  { label: "Trạng Thái", render: (o) => o.status, style: { color: "var(--amber)" } },
  { label: "Ngày Lấy", render: (o) => fmtYmd(o.pickup_time), style: { whiteSpace: "nowrap" } },
  { label: "Hạn Giao", render: (o) => fmtYmd(o.deadline), style: { whiteSpace: "nowrap" } },
  { label: "Quá Hạn", render: (o) => `${o.overdueDays} ngày`, style: { whiteSpace: "nowrap", fontWeight: 600, color: "var(--red)" } },
  { label: "Tuyến Đường", render: routeOf },
  { label: "Kho Giao", render: (o) => o.kho_giao || "-" },
];

// view: "ltl" (Tổng quan) | "map" (Bản đồ tỉnh thành) | "damage" (Hư hỏng & Rủi ro)
// — all 3 read the same already-fetched /api/data payload, so switching tabs
// never refetches.
export default function LTLDashboard({ view = "ltl", data, rawData, aiInsights, selectedProjects = [], selectedMonths = [], userRole, periodWeeks = "mtd", onPeriodWeeksChange, selectedOrigin = null, onOriginChange, fetchProvinceOrders, pendingPickup, fetchPendingOrders, kpiDelta, stuck, fetchStuckOrders, anomalies, damageRisk, riskOnly: riskOnlyProp, onRiskOnlyChange, sparkline, dueToday, fetchDueTodayOrders, onQuickRiskRoutes, onQuickLowOntime, onOpenReport, onOpenCompanyReport, damageTrend, exceptions }) {
  const [damageFilter, setDamageFilter] = useState(null); // { type: 'type' | 'province' | 'warehouse', value: string }
  const [selectedProvinceOrders, setSelectedProvinceOrders] = useState(null);
  // Fetched on demand (see fetchProvinceOrders in pages/dashboard.js) instead
  // of filtering a client-side copy of all ~23k rows — that array is no
  // longer even sent to the browser (was the main cause of a 22MB/12s
  // dashboard load, fixed 2026-09-17).
  const [provOrdersList, setProvOrdersList] = useState([]);
  const [provOrdersLoading, setProvOrdersLoading] = useState(false);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [riskOnlyLocal, setRiskOnlyLocal] = useState(false);
  const riskOnly = riskOnlyProp ?? riskOnlyLocal;
  const setRiskOnly = onRiskOnlyChange || setRiskOnlyLocal;
  const [stuckModalOpen, setStuckModalOpen] = useState(false);
  const [stuckOrders, setStuckOrders] = useState([]);
  const [stuckLoading, setStuckLoading] = useState(false);
  const [dueModalOpen, setDueModalOpen] = useState(false);
  const [anomModalOpen, setAnomModalOpen] = useState(false);
  const [dueOrders, setDueOrders] = useState([]);
  const [dueLoading, setDueLoading] = useState(false);
  const theme = useTheme();

  if (!data) return <TruckLoader />;

  const isClient = userRole === "client";
  const singleProjectMode = selectedProjects.length === 1;

  const showOverview = view === "ltl";
  const showMap = view === "map";
  const showDamage = view === "damage";

  const exportSummaryCSV = () => {
    const projects = Object.values(data.projectSummaries || {}).sort((a, b) => b.totalOrders - a.totalOrders);
    downloadCSV(
      `SD3- Dashboard Điện Máy - ${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { label: "Dự án", value: "name" },
        { label: "Số đơn", value: "totalOrders" },
        { label: "Tổng tải trọng (kg)", value: (r) => Math.round(r.totalWeight) },
        { label: "Đơn ontime", value: "ontimeCount" },
        { label: "Đơn late", value: "lateCount" },
        { label: "% Ontime", value: (r) => (r.evalCount > 0 ? ((r.ontimeCount / r.evalCount) * 100).toFixed(1) : "") },
        { label: "Ca hư hỏng", value: (r) => r.damageCount || 0 },
      ],
      projects
    );
  };

  const closeProvModal = () => { setSelectedProvinceOrders(null); setProvOrdersList([]); };
  const openProvModal = async (prov) => {
    setSelectedProvinceOrders(prov);
    setProvOrdersList([]);
    if (!fetchProvinceOrders) return;
    setProvOrdersLoading(true);
    try {
      const orders = await fetchProvinceOrders(prov);
      setProvOrdersList(orders);
    } catch {
      setProvOrdersList([]);
    } finally {
      setProvOrdersLoading(false);
    }
  };

  const openPendingModal = async () => {
    setPendingModalOpen(true);
    setPendingOrders([]);
    if (!fetchPendingOrders) return;
    setPendingLoading(true);
    try {
      setPendingOrders(await fetchPendingOrders());
    } catch {
      setPendingOrders([]);
    } finally {
      setPendingLoading(false);
    }
  };

  const openStuckModal = async () => {
    setStuckModalOpen(true);
    setStuckOrders([]);
    if (!fetchStuckOrders) return;
    setStuckLoading(true);
    try {
      setStuckOrders(await fetchStuckOrders());
    } catch {
      setStuckOrders([]);
    } finally {
      setStuckLoading(false);
    }
  };

  const openDueModal = async () => {
    setDueModalOpen(true);
    setDueOrders([]);
    if (!fetchDueTodayOrders) return;
    setDueLoading(true);
    try {
      setDueOrders(await fetchDueTodayOrders());
    } catch {
      setDueOrders([]);
    } finally {
      setDueLoading(false);
    }
  };

  const lowOntimeProjects = Object.values(data.projectSummaries || {})
    .filter((p) => p.evalCount >= LOW_ONTIME_MIN_EVAL && (p.ontimeCount / p.evalCount) * 100 < LOW_ONTIME_PCT)
    .map((p) => p.name)
    .sort();
  const lowOntimeActive = selectedProjects.length > 0 && lowOntimeProjects.length > 0
    && [...selectedProjects].sort().join("|") === lowOntimeProjects.join("|");

  // 7-day sparklines (lib/ltl-dashboard.js computeSparkline)
  const sparkFor = (key, format) => {
    const days = sparkline?.days;
    if (!days?.length) return null;
    const incompleteFrom = key === "ontimePct" || key === "late" ? days.findIndex((d) => d.date >= sparkline.incompleteFrom) : null;
    return {
      points: days.map((d) => ({ label: d.date.slice(8, 10) + "/" + d.date.slice(5, 7), value: d[key] })),
      incompleteFrom: incompleteFrom >= 0 ? incompleteFrom : null,
      format,
    };
  };

  return (
    // key={view}: switching Tổng quan / Bản đồ / Hư hỏng replays the soft
    // enter transition (the sections differ per view anyway).
    <div key={view} className="view-enter" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Quick filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 2 }}>Lọc nhanh:</span>
        {!isClient && damageRisk && (
          <button style={quickChip(showDamage && riskOnly, "var(--red)")} onClick={() => onQuickRiskRoutes?.()}
            title={`Tuyến có tỷ lệ bể vỡ ≥ ${damageRisk.rule.multiplier}× trung bình và ≥ ${damageRisk.rule.minOrders} đơn`}>
            ⚠ Tuyến rủi ro cao <b style={{ color: "var(--red)" }}>{fmt(damageRisk.riskyRouteCount)}</b>
          </button>
        )}
        <button
          style={quickChip(lowOntimeActive, "var(--cyan)")}
          disabled={!lowOntimeProjects.length && !lowOntimeActive}
          onClick={() => onQuickLowOntime?.(lowOntimeActive ? [] : lowOntimeProjects)}
          title={lowOntimeProjects.length ? lowOntimeProjects.join(", ") : `Không có dự án nào dưới ${LOW_ONTIME_PCT}% (≥ ${LOW_ONTIME_MIN_EVAL} đơn đã đánh giá)`}
        >
          📉 Dự án On-time &lt; {LOW_ONTIME_PCT}% <b style={{ color: "var(--cyan)" }}>{fmt(lowOntimeProjects.length)}</b>{lowOntimeActive && " ✕"}
        </button>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {(userRole === "manager" || userRole === "sd3") && onOpenCompanyReport && (
            <button onClick={onOpenCompanyReport} title="Mở tab Báo cáo công ty" style={{
              display: "flex", alignItems: "center", gap: 6, background: "rgba(var(--brand-rgb),0.1)", border: "1px solid rgba(var(--brand-rgb),0.3)",
              color: "var(--cyan)", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>📊 Báo cáo công ty</button>
          )}
          {onOpenReport && (
            <button onClick={onOpenReport} style={{
              display: "flex", alignItems: "center", gap: 6, background: "rgba(var(--brand-rgb),0.1)", border: "1px solid rgba(var(--brand-rgb),0.3)",
              color: "var(--cyan)", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>📄 Tạo báo cáo tóm tắt</button>
          )}
      {showOverview && !isClient && (
          <button
            onClick={exportSummaryCSV}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "var(--panel-glow)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", padding: "6px 12px", borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Xuất báo cáo CSV
          </button>
      )}
        </span>
      </div>
      {showOverview && (() => {
        const kd = kpiDelta;
        const pct = (v) => `${Math.abs(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
        // higherIsBetter decides the colour; the arrow always shows direction.
        const mk = (v, unit, higherIsBetter) => {
          if (v == null) return null;
          if (v === 0) return { text: unit === "pt" ? "0 điểm" : "0%", tone: "flat" };
          const up = v > 0;
          const text = `${up ? "▲" : "▼"} ${unit === "pt" ? `${Math.abs(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} điểm` : pct(v)}`;
          return { text, tone: up === higherIsBetter ? "good" : "bad" };
        };
        const compare = (valText) => {
          if (!kd) return null;
          if (kd.incomplete) return "Kỳ trước nằm ngoài phạm vi dữ liệu (trước 07/2026)";
          if (kd.mode === "window") return `${kd.currentLabel}: ${valText} · so cùng kỳ ${kd.compareLabel}`;
          return `so ${kd.compareLabel}`;
        };
        const ok = kd && !kd.incomplete;
        const hasEval = data.evalCount > 0;
        const ontimeClass = !hasEval ? "" : data.ontimePct >= 90 ? "text-green" : data.ontimePct >= 80 ? "text-amber" : "text-red";
        const fmtPct1 = (v) => (v == null ? "—" : `${Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`);
        return (
          <div className="grid-5">
            <KpiCard
              accent
              label={data.filterMode === "delivered" ? "GTC (ngày giao)" : "Tổng đơn (lấy hàng)"}
              value={fmt(data.totalOrders)}
              delta={ok ? mk(kd.orders.deltaPct, "%", true) : null}
              compare={compare(ok ? `${fmt(kd.orders.cur)} đơn` : "")}
              sub={data.filterMode !== "delivered" ? `GTC trong kỳ: ${fmt(data.deliveredThisMonthCount)} (theo ngày giao)` : "Tính theo ngày giao thực tế"}
              spark={sparkFor("orders", (v) => `${fmt(v)} đơn`)}
            />
            <KpiCard
              label="Khối lượng (tấn)"
              value={fmt((data.totalWeight || 0) / 1000, 1)}
              delta={ok && kd.weight ? mk(kd.weight.deltaPct, "%", true) : null}
              compare={compare(ok && kd.weight ? `${fmt((kd.weight.cur || 0) / 1000, 1)} tấn` : "")}
              sub={data.totalOrders > 0 ? `Bình quân ${fmt((data.totalWeight || 0) / data.totalOrders)} kg/đơn` : ""}
              spark={sparkFor("weightKg", (v) => `${fmt(v / 1000, 1)} tấn`)}
            />
            <KpiCard
              label="Tỷ lệ On-time"
              value={hasEval ? fmtPct1(data.ontimePct) : "—"}
              valueClass={ontimeClass}
              delta={ok ? mk(kd.ontime.deltaPoints, "pt", true) : null}
              compare={compare(ok ? fmtPct1(kd.ontime.cur) : "")}
              sub={`${fmt(data.ontimeCount)} ontime / ${fmt(data.evalCount)} đơn đã đánh giá`}
              spark={sparkFor("ontimePct", (v) => `${v.toLocaleString("vi-VN")}%`)}
            />
            <KpiCard
              label="Đơn Late"
              value={fmt(data.lateCount)}
              valueClass="text-red"
              delta={ok ? mk(kd.late.deltaPct, "%", false) : null}
              compare={compare(ok ? `${fmt(kd.late.cur)} đơn` : "")}
              sub={`${hasEval ? (100 - data.ontimePct).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : 0}% tỷ lệ late`}
              spark={sparkFor("late", (v) => `${fmt(v)} đơn`)}
            />
            <KpiCard
              label="Ca hư hỏng (Rillnet)"
              value={fmt(data.totalBroken)}
              valueClass="text-amber"
              delta={ok ? mk(kd.damage.deltaPct, "%", false) : null}
              compare={compare(ok ? `${fmt(kd.damage.cur)} ca` : "")}
              sub={(() => {
                // Rillnet "Báo cáo bể vỡ" definitions (2026-09-27), same cases as the value.
                const cases = data.detailedDamageCases || [];
                const nComp = cases.filter((c) => c.compensated).length;
                const nTT = cases.filter((c) => c.truy_thu === "co").length;
                return `${fmt(nComp)} đã chốt đền bù · ${fmt(nTT)} có truy thu`;
              })()}
              spark={sparkFor("damaged", (v) => `${fmt(v)} ca`)}
            />
          </div>
        );
      })()}

      {showOverview && !isClient && <ExceptionsPanel exceptions={exceptions} onFilterProject={onQuickLowOntime} />}

      {showOverview && (() => {
        // "Cần chú ý" — one row of 4 clickable tiles (2026-09-26), replacing
        // three full-width strips and the duplicate "Đến hạn" quick chip.
        const tiles = [
          { key: "due", label: "Đến hạn giao hôm nay", value: dueToday?.count || 0, color: "var(--amber)", sub: "Chưa giao — mai thành đơn treo", onClick: openDueModal },
          { key: "stuck", label: "Đơn treo quá hạn", value: stuck?.count || 0, color: "var(--red)",
            sub: stuck?.count ? `> 7 ngày: ${fmt(stuck.byAge[">7"])} · nhiều nhất ${stuck.topClients?.[0]?.[0] || ""}` : "Không có", onClick: openStuckModal },
          { key: "pending", label: "Đơn chờ lấy (chưa chốt kỳ)", value: pendingPickup?.count || 0, color: "var(--amber)",
            sub: "Chưa có ngày lấy, không tính vào tổng đơn", onClick: openPendingModal },
          { key: "anom", label: "Dự án on-time giảm mạnh", value: anomalies?.items?.length || 0, color: "var(--red)",
            sub: anomalies?.items?.length ? anomalies.items.slice(0, 2).map((a) => a.name).join(", ") + (anomalies.items.length > 2 ? "…" : "") : `Không có (≥ 10 điểm so ${anomalies?.compareLabel || "kỳ trước"})`,
            onClick: anomalies?.items?.length ? () => setAnomModalOpen(true) : undefined },
        ];
        return (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Cần chú ý</div>
            <div className="grid-4">
              {tiles.map((t) => (
                <button key={t.key} onClick={t.onClick} disabled={!t.onClick} style={{
                  textAlign: "left", background: "var(--bg-panel)", border: "1px solid var(--border)", borderLeft: `3px solid ${t.value ? t.color : "var(--border)"}`,
                  borderRadius: 10, padding: "10px 14px", cursor: t.onClick ? "pointer" : "default", fontFamily: "inherit", color: "var(--text-primary)", minWidth: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: t.value ? t.color : "var(--text-muted)" }}>{fmt(t.value)}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={t.sub}>
                    {t.sub}{t.onClick ? " · xem →" : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {showMap && <ProvinceMapPanel
        provinceStats={data.provinceStats}
        routeStats={data.routeStats}
        provinceDetailsMap={data.provinceDetailsMap || {}}
        originStats={data.originStats || []}
        projectSummaries={data.projectSummaries || {}}
        overallData={{
          totalOrders: data.totalOrders,
          totalWeight: data.totalWeight,
          ontimePct: data.ontimePct,
          ontimeCount: data.ontimeCount,
          lateCount: data.lateCount,
          damageCount: data.totalBroken,
        }}
        singleProjectMode={singleProjectMode}
        projectName={singleProjectMode ? selectedProjects[0] : ""}
        selectedOrigin={selectedOrigin}
        onOriginChange={onOriginChange}
        onProvinceClick={openProvModal}
        hotspots={damageRisk?.hotspots || []}
        hotspotRule={isClient ? null : damageRisk?.hotspotRule}
      />}

      {showOverview && <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title" style={{ flexWrap: "wrap", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span>Sản lượng & Chất lượng theo {data.isWeekly ? "tuần" : "tháng"}</span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)", fontWeight: 400 }}>Cột: đơn · tấn — Đường: % on-time · % hư hỏng</span>
        </div>
        <div style={{ height: 340 }}>
          <VolumeTrendChart
            damageTrend={damageTrend || {}}
            ordersByMonth={data.ordersByMonth || {}}
            weightByMonth={data.weightByMonth || {}}
            ontimeByMonth={data.ontimeByMonth || {}}
            isWeekly={data.isWeekly}
            month={selectedMonths.length === 1 ? selectedMonths[0] : null}
            sameDayComparison={data.periodComparison?.periodMode === "mtd" ? data.periodComparison?.overall : null}
            theme={theme}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
          ⓘ Cột nhạt / nét đứt = kỳ đang chạy, được so với cùng số ngày của kỳ trước (không so với cả kỳ); % on-time kỳ đang chạy còn thay đổi vì nhiều đơn chưa giao. % hư hỏng = ca bể vỡ theo ngày phát hiện / đơn giao thành công theo ngày giao (cùng định nghĩa báo cáo công ty), có trục riêng bên phải.
        </div>
      </div>}

      {showOverview && !singleProjectMode && data.isWeekly && (
        <WeeklyByClientSection ordersByProjectAndWeek={data.ordersByProjectAndWeek} ordersByMonth={data.ordersByMonth} />
      )}

      {showOverview && <PeriodComparisonSection
        asTable
        comparison={data.periodComparison}
        declineAlerts={data.declineAlerts}
        compact={singleProjectMode}
        periodWeeks={periodWeeks}
        onPeriodWeeksChange={onPeriodWeeksChange}
      />}

      {showOverview && !singleProjectMode && (
        <ProjectPerformanceTable projectSummaries={data.projectSummaries || {}} />
      )}

      {showDamage && !isClient && (() => {
        const pc = data.periodComparison;
        const src = pc ? (singleProjectMode ? pc.clients?.find((c) => c.client === selectedProjects[0]) : pc.overall) : null;
        const damageTrend = pc && src ? {
          scope: singleProjectMode ? selectedProjects[0] : "toàn hệ thống",
          currentRangeLabel: pc.currentRangeLabel, previousRangeLabel: pc.previousRangeLabel,
          curDamageCount: src.cur?.damageCount ?? 0, prevDamageCount: src.prev?.damageCount ?? 0,
          damageDeltaPct: src.damageDeltaPct ?? null, damageIsNew: src.damageIsNew ?? false,
        } : null;
        const riskyProjects = (damageRisk?.byProject || []).filter((p) => p.orders >= damageRisk.rule.minOrders && p.per1000 >= damageRisk.avgRate * 10 * damageRisk.rule.multiplier).length;
        const tiles = [
          { label: "Ca hư hỏng (kỳ đang lọc)", value: fmt(data.totalBroken), sub: damageTrend ? `${damageTrend.currentRangeLabel}: ${fmt(damageTrend.curDamageCount)} ca · cùng kỳ: ${fmt(damageTrend.prevDamageCount)} ca` : "" },
          { label: "Tỷ lệ bể vỡ trung bình", value: damageRisk ? `${damageRisk.avgRate.toLocaleString("vi-VN")}%` : "—", sub: damageRisk ? `${fmt(damageRisk.totalDamaged)} đơn có ca / ${fmt(damageRisk.totalOrders)} đơn` : "" },
          { label: "Tuyến rủi ro cao", value: fmt(damageRisk?.riskyRouteCount || 0), sub: damageRisk ? `≥ ${damageRisk.rule.multiplier}× TB, ≥ ${damageRisk.rule.minOrders} đơn` : "" },
          { label: "Dự án rủi ro cao", value: fmt(riskyProjects), sub: "Ca / 1.000 đơn ≥ 2× trung bình" },
          ...(() => {
            // Same cases as "Ca hư hỏng (kỳ đang lọc)" — Rillnet definitions.
            const cases = data.detailedDamageCases || [];
            const comp = cases.filter((c) => c.compensated);
            const tt = cases.filter((c) => c.truy_thu === "co");
            const ttSum = tt.reduce((s, c) => s + (c.truy_thu_amount || 0), 0);
            const chotSum = comp.reduce((s, c) => s + (c.comp_amount || 0), 0);
            return [
              { label: "Đã chốt đền bù cho khách", value: fmt(comp.length), sub: `Ops chấp nhận đền bù hoặc đã chốt tiền${chotSum ? ` · đã chốt ${fmt(chotSum)}đ` : ""}` },
              { label: "Truy thu (đã duyệt)", value: `${fmt(tt.length)} ca`, sub: `${fmt(Math.round(ttSum / 1e5) / 10, 1)} triệu · ${fmt(cases.filter((c) => c.truy_thu === "khong").length)} không truy thu · ${fmt(cases.filter((c) => c.truy_thu === "cho").length)} chờ chốt` },
            ];
          })(),
        ];
        return (
          <div className="chart-panel" style={{ width: "100%" }}>
            <div className="chart-panel-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
              Tổng quan bể vỡ
            </div>
            <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="grid-3">
                {tiles.map((t) => (
                  <div key={t.label} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{t.value}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t.sub}</div>
                  </div>
                ))}
              </div>
              {aiInsights && (
                <BreakageAlertSection
                  hideRouteList
                  routes={aiInsights.breakageRoutes}
                  avgDmgRate={aiInsights.avgDmgRate}
                  totalOrders={aiInsights.totalOrders}
                  damageCauses={aiInsights.damageCauses}
                  damageTrend={damageTrend}
                  recentCases={
                    aiInsights.damageCauses?.totalCases > 0 && aiInsights.damageCauses.totalCases <= 8
                      ? (data.detailedDamageCases || []).slice(0, 8).map((c) => ({
                          orderCode: c.order_code, client: c.client_name,
                          warehouse: c.warehouse_giao, leg: c.damage_details, province: c.to_province,
                        }))
                      : []
                  }
                />
              )}
            </div>
          </div>
        );
      })()}

      {showDamage && !isClient && damageRisk && (
        <RouteRiskMatrix risk={damageRisk} riskOnly={riskOnly} onRiskOnlyChange={setRiskOnly} />
      )}

      {showDamage && <div className="chart-panel">
        <div className="chart-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Chi Tiết Ca Hư Hỏng {damageFilter ? `— Lọc theo ${damageFilter.type === "type" ? "Loại: " : damageFilter.type === "province" ? "Tỉnh: " : "Kho: "}${damageFilter.value}` : ""}
          </span>
          {damageFilter && (
            <button 
              onClick={() => setDamageFilter(null)}
              style={{ background: "rgba(244,63,94,0.15)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}
            >
              Hủy lọc x
            </button>
          )}
        </div>
        <DetailedDamageTable
          cases={data.detailedDamageCases || []}
          filter={damageFilter}
          showClaimsWorkflow={!isClient}
        />
      </div>}
      {pendingModalOpen && (
        <OrderListModal
          title="Đơn chờ lấy (chưa chốt kỳ)"
          subtitle={`${fmt(pendingOrders.length)} đơn chưa có ngày lấy hàng — theo dự án/điểm lấy đang lọc, không phụ thuộc bộ lọc tháng/ngày`}
          loading={pendingLoading}
          rows={[...pendingOrders].sort((a, b) => String(a.created_time || "").localeCompare(String(b.created_time || "")))}
          columns={PENDING_COLUMNS}
          onClose={() => setPendingModalOpen(false)}
        />
      )}
      {anomModalOpen && (
        <OrderListModal
          title="Dự án on-time giảm mạnh"
          subtitle={`Giảm ≥ 10 điểm so với ${anomalies?.compareLabel || "kỳ trước"}, mỗi kỳ ≥ 5 đơn đã đánh giá`}
          loading={false}
          rows={anomalies?.items || []}
          columns={ANOMALY_COLUMNS}
          onClose={() => setAnomModalOpen(false)}
        />
      )}
      {dueModalOpen && (
        <OrderListModal
          title="Đơn đến hạn giao hôm nay"
          subtitle={`${fmt(dueOrders.length)} đơn đã lấy, chưa giao, hạn giao là hôm nay — nếu chưa giao, mai sẽ thành đơn treo. Theo dự án/điểm lấy đang lọc.`}
          loading={dueLoading}
          rows={dueOrders}
          columns={DUE_COLUMNS}
          onClose={() => setDueModalOpen(false)}
        />
      )}
      {stuckModalOpen && (
        <OrderListModal
          title="Đơn treo / cần chú ý"
          subtitle={`${fmt(stuckOrders.length)} đơn đã lấy, chưa giao/hoàn và đã quá hạn giao (quá lâu nhất lên đầu) — theo dự án/điểm lấy đang lọc, không phụ thuộc bộ lọc tháng/ngày`}
          loading={stuckLoading}
          rows={stuckOrders}
          columns={STUCK_COLUMNS}
          onClose={() => setStuckModalOpen(false)}
        />
      )}
      {selectedProvinceOrders && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999
        }} onClick={closeProvModal}>
          <div style={{
            background: "var(--bg-panel)", border: "1px solid var(--border)",
            borderRadius: 12, padding: 24, width: "90%", maxWidth: 800,
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>
                  📍 Chi tiết đơn hàng: <span style={{ color: "var(--cyan)" }}>{selectedProvinceOrders}</span>
                </h2>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                  {provOrdersLoading ? "Đang tải..." : `Tổng cộng: ${provOrdersList.length} đơn hàng trong bộ lọc hiện tại`}
                </div>
              </div>
              <button onClick={closeProvModal} style={{
                background: "none", border: "none", color: "var(--text-muted)",
                fontSize: 24, cursor: "pointer", lineHeight: 1
              }}>✕</button>
            </div>
            
            <div style={{ overflowY: "auto", flex: 1, borderRadius: 8, border: "1px solid var(--border)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--bg-panel)", zIndex: 1 }}>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Mã Đơn</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Dự Án</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Tuyến Đường</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Trọng Lượng</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Trạng Thái</th>
                  </tr>
                </thead>
                <tbody>
                  {provOrdersLoading ? (
                    <tr><td colSpan="5" style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Đang tải...</td></tr>
                  ) : provOrdersList.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Không có đơn hàng nào</td></tr>
                  ) : (
                    provOrdersList.map((odr, idx) => {
                      // Same rule as the ontime KPI (V2, 28/09); older responses without `outcome` fall back to the flag.
                      const outcome = odr.outcome !== undefined ? odr.outcome : (String(odr.odr_success || "").toLowerCase().includes("late") ? "late" : "ontime");
                      const isLate = outcome === "late";
                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--border)", background: idx % 2 === 0 ? "transparent" : "var(--panel-glow)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--text-primary)" }}>{odr.order_code || "N/A"}</td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>{odr.client_name}</td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>
                            <span style={{ color: odr.from_province_name === selectedProvinceOrders ? "var(--cyan)" : "inherit" }}>{odr.from_province_name || "?"}</span>
                            {" → "}
                            <span style={{ color: odr.to_province_name === selectedProvinceOrders ? "var(--cyan)" : "inherit" }}>{odr.to_province_name || "?"}</span>
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>
                            {odr.weight ? `${(parseFloat(odr.weight) / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} kg` : "-"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {isLate ? (
                              <span style={{ background: "rgba(244,63,94,0.15)", color: "var(--red)", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Late</span>
                            ) : outcome == null ? (
                              <span style={{ background: "rgba(127,127,127,0.15)", color: "var(--text-muted)", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Đang giao</span>
                            ) : (
                              <span style={{ background: "rgba(16,185,129,0.15)", color: "var(--green)", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Ontime</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
