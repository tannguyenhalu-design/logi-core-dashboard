/**
 * components/TabFTL.js — FTL Dashboard Tab
 */
import { useRef, useEffect, useState, useMemo } from "react";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import KpiCard from "./KpiCard";

Chart.register(ChartDataLabels);

const COLORS = {
  cyan: "#3b82f6", green: "#10b981", red: "#f43f5e",
  amber: "#f59e0b", purple: "#8b5cf6",
};

function fmt(n, d = 0) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("vi-VN", { maximumFractionDigits: d });
}

function useChart(canvasRef, config, deps) {
  const chartRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, config());
    return () => { if (chartRef.current) chartRef.current.destroy(); };
    // eslint-disable-next-line
  }, deps);
}

// ── Trips by day (line chart) ──
function TripsByDayChart({ tripsByDay }) {
  const ref = useRef(null);
  const dates = Object.keys(tripsByDay).sort();

  useChart(ref, () => ({
    type: "line",
    data: {
      labels: dates.map((d) => {
        const [y, m, day] = d.split("-");
        return `${day}/${m}`;
      }),
      datasets: [{
        label: "Số chuyến",
        data: dates.map((d) => tripsByDay[d]),
        borderColor: COLORS.cyan, backgroundColor: "rgba(59,130,246,0.1)",
        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 3,
        pointBackgroundColor: COLORS.cyan,
        datalabels: { display: false },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(255,255,255,0.05)" } },
      },
    },
  }), [tripsByDay]);

  return <canvas ref={ref} />;
}

// ── Trips by month/week with MoM % ──
function TripsByMonthChart({ tripsByMonth, isWeekly }) {
  const ref = useRef(null);
  const months = Object.keys(tripsByMonth).sort((a, b) => a - b);
  const values = months.map((m) => tripsByMonth[m] || 0);

  // Compute MoM %
  const momPct = values.map((v, i) => {
    if (i === 0 || values[i - 1] === 0) return null;
    return Math.round(((v - values[i - 1]) / values[i - 1]) * 100);
  });

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: months.map((m) => isWeekly ? `Tuần ${m}` : `T${m}`),
      datasets: [{
        label: "Số chuyến",
        data: values,
        backgroundColor: COLORS.purple, borderRadius: 6,
        datalabels: { display: false },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: (ctx) => momPct[ctx.dataIndex] !== null,
          formatter: (v, ctx) => {
            const pct = momPct[ctx.dataIndex];
            return pct === null ? "" : (pct >= 0 ? "+" : "") + pct + "%";
          },
          color: (ctx) => {
            const pct = momPct[ctx.dataIndex];
            return pct >= 0 ? COLORS.green : COLORS.red;
          },
          font: { weight: "bold", size: 11 }, anchor: "end", align: "top",
        },
      },
      scales: {
        y: { grid: { color: "rgba(255,255,255,0.05)" } },
        x: { grid: { display: false } },
      },
    },
  }), [tripsByMonth]);

  return <canvas ref={ref} />;
}

// ── Vehicle type donut ──
function VehicleDonut({ vehicleTypeDist }) {
  const ref = useRef(null);
  const types = Object.keys(vehicleTypeDist).sort((a, b) => vehicleTypeDist[b] - vehicleTypeDist[a]);
  const total = types.reduce((s, t) => s + vehicleTypeDist[t], 0);
  const palette = [COLORS.cyan, COLORS.purple, COLORS.green, COLORS.amber, COLORS.red];

  useChart(ref, () => ({
    type: "doughnut",
    data: {
      labels: types.map((t) => {
        const pct = total > 0 ? Math.round((vehicleTypeDist[t] / total) * 100) : 0;
        return `${t} (${pct}%)`;
      }),
      datasets: [{
        data: types.map((t) => vehicleTypeDist[t]),
        backgroundColor: types.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      plugins: {
        legend: { position: "right", labels: { color: "#94a3b8", boxWidth: 12, font: { size: 12 } } },
        datalabels: {
          display: true, color: "#fff",
          font: { weight: "bold", size: 11 },
          formatter: (v, ctx) => {
            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return sum > 0 ? Math.round((v / sum) * 100) + "%" : "";
          },
        },
      },
    },
  }), [vehicleTypeDist]);

  return <canvas ref={ref} />;
}

// ── Top 10 Delivery Locations (horizontal bar chart) ──
function TopLocationsChart({ top10Locations }) {
  const ref = useRef(null);

  const labels = top10Locations.map((item) => {
    const loc = item.location;
    return loc.length > 25 ? loc.slice(0, 25) + "..." : loc;
  });
  const counts = top10Locations.map((item) => item.count);

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Số chuyến",
        data: counts,
        backgroundColor: COLORS.cyan,
        borderRadius: 4,
        datalabels: {
          display: true,
          color: "#fff",
          anchor: "end",
          align: "right",
          font: { weight: "bold", size: 10 }
        }
      }],
    },
    options: {
      indexAxis: "y", // horizontal bar
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              return top10Locations[idx].location;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  }), [top10Locations]);

  return <canvas ref={ref} />;
}

// ── Province surge alerts ──
function ProvinceAlerts({ provinceAlerts }) {
  if (!provinceAlerts?.length) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Không có tỉnh nào tăng đột biến trong 7 ngày gần nhất.
      </p>
    );
  }
  return (
    <div>
      {provinceAlerts.map((a, i) => (
        <div className="alert-box alert-surge" key={i}>
          <svg width="16" height="16" style={{ marginTop: 2, flexShrink: 0, color: "var(--amber)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          </svg>
          <div>
            <p style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{a.message}</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
              Kỳ này: {a.currentTrips} chuyến / Kỳ trước: {a.priorTrips} chuyến
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Project Comparison Chart (trips side-by-side) ──
function ProjectCompareChart({ projectStats }) {
  const ref = useRef(null);
  const projs = Object.keys(projectStats || {}).sort((a, b) => (projectStats[b]?.trips || 0) - (projectStats[a]?.trips || 0));
  const palette = [
    COLORS.cyan, COLORS.purple, COLORS.green, COLORS.amber, COLORS.red,
    "#ec4899", "#06b6d4", "#84cc16", "#f97316",
  ];

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: projs,
      datasets: [
        {
          label: "Số chuyến",
          data: projs.map(p => projectStats[p]?.trips || 0),
          backgroundColor: projs.map((_, i) => palette[i % palette.length]),
          borderRadius: 5,
          yAxisID: "y",
          datalabels: {
            display: true, color: "#fff",
            font: { weight: "bold", size: 11 },
            anchor: "end", align: "start", offset: 4,
            formatter: v => v + " ch.",
          },
        },
        {
          label: "TB điểm giao/chuyến",
          data: projs.map(p => projectStats[p]?.avgLocationsPerTrip || 0),
          backgroundColor: "transparent",
          borderColor: COLORS.amber,
          borderWidth: 2,
          type: "line",
          yAxisID: "y2",
          pointBackgroundColor: COLORS.amber,
          pointRadius: 5,
          tension: 0.3,
          datalabels: {
            display: true, color: COLORS.amber,
            font: { weight: "bold", size: 10 },
            anchor: "end", align: "top",
            formatter: v => v.toFixed(1),
          },
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { position: "bottom", labels: { color: "#94a3b8", boxWidth: 12 } },
        y2: { position: "right", grid: { display: false }, min: 0, title: { display: true, text: "TB điểm/chuyến", color: COLORS.amber, font: { size: 10 } }, ticks: { color: COLORS.amber } },
        x:  { grid: { display: false } },
      },
    },
  }), [projectStats]);

  return <canvas ref={ref} />;
}

export default function TabFTL({ data }) {
  const [selVehicles, setSelVehicles] = useState([]);
  if (!data) return <div className="spinner" />;

  // ── Vehicle filter: derived from xe_ghn_cap on trips ──
  const allVehicleTypes = data.allVehicleTypes || [];

  const filteredTrips = useMemo(() => {
    if (!selVehicles.length) return data.trips || [];
    return (data.trips || []).filter(t => selVehicles.includes(t.xe_ghn_cap));
  }, [data.trips, selVehicles]);

  // Recompute stats from filteredTrips
  const fTotalTrips = filteredTrips.length;
  const fTotalLocations = filteredTrips.reduce((s, t) => s + (t.locations?.length || 0), 0);
  const fAvgLoc = fTotalTrips > 0 ? Math.round((fTotalLocations / fTotalTrips) * 10) / 10 : 0;
  const fProjectStats = useMemo(() => {
    const ps = {};
    filteredTrips.forEach(t => {
      if (!ps[t.client]) ps[t.client] = { trips: 0, totalLocations: 0 };
      ps[t.client].trips++;
      ps[t.client].totalLocations += (t.locations?.length || 0);
    });
    Object.keys(ps).forEach(p => {
      const s = ps[p];
      s.avgLocationsPerTrip = s.trips > 0 ? Math.round((s.totalLocations / s.trips) * 10) / 10 : 0;
    });
    return ps;
  }, [filteredTrips]);

  const toggleVehicle = (v) =>
    setSelVehicles(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const vehicleColor = { "1T9":"#06b6d4", "2.5T":"#a78bfa", "3.5T":"#f59e0b", "5T":"#3b82f6", "7T":"#10b981", "8T":"#8b5cf6", "10T":"#f43f5e", "15T":"#ec4899" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Vehicle type filter strip ── */}
      {allVehicleTypes.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
        }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>
            Loại xe:
          </span>
          <button
            onClick={() => setSelVehicles([])}
            style={{
              padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              border: "1px solid var(--border)", fontFamily: "inherit",
              background: selVehicles.length === 0 ? "rgba(59,130,246,0.2)" : "transparent",
              color: selVehicles.length === 0 ? "var(--blue)" : "var(--text-muted)",
              fontWeight: selVehicles.length === 0 ? 600 : 400,
              transition: "all 0.15s",
            }}
          >
            Tất cả ({fmt(data.totalTrips)} chuyến)
          </button>
          {allVehicleTypes.map(v => {
            const count = (data.trips || []).filter(t => t.xe_ghn_cap === v).length;
            const active = selVehicles.includes(v);
            const col = vehicleColor[v] || "#94a3b8";
            return (
              <button key={v} onClick={() => toggleVehicle(v)} style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                fontFamily: "inherit", fontWeight: active ? 600 : 400,
                border: `1px solid ${active ? col : "var(--border)"}`,
                background: active ? `${col}22` : "transparent",
                color: active ? col : "var(--text-muted)",
                transition: "all 0.15s",
              }}>
                🚛 {v} <span style={{ opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
          {selVehicles.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
              → Lọc: {fmt(fTotalTrips)} chuyến
            </span>
          )}
        </div>
      )}

      {/* KPI */}
      <div className="grid-4">
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>}
          label={selVehicles.length ? `Chuyến ${selVehicles.join(" / ")}` : "Tổng Chuyến (FTL)"}
          value={fmt(fTotalTrips)}
          sub={`/ ${fmt(data.totalTrips)} tổng chuyến`}
          colorClass="text-purple"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>}
          label="Tổng Đơn Hàng"
          value={fmt(filteredTrips.reduce((s,t) => s + (t.order_count || 0), 0))}
          sub="Dedupe theo order_number"
          colorClass="text-cyan"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>}
          label="Khối Lượng"
          value={fmt(filteredTrips.reduce((s,t) => s + (t.weight || 0), 0))}
          sub="KG (dedupe order)"
          colorClass="text-green"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
          label="TB Điểm Giao / Chuyến"
          value={fAvgLoc}
          sub={`Trên tổng ${fmt(fTotalLocations)} điểm`}
          colorClass="text-amber"
        />
      </div>

      {/* Trips by day + trips by month MoM */}
      <div className="grid-2">
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Số Chuyến Hoạt Động Theo Ngày
          </div>
          <div style={{ height: 250 }}>
            <TripsByDayChart tripsByDay={data.tripsByDay || {}} />
          </div>
        </div>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            Tăng Trưởng Số Chuyến theo {data.isWeekly ? "Tuần" : "Tháng"} (MoM)
          </div>
          <div style={{ height: 250 }}>
            <TripsByMonthChart tripsByMonth={data.tripsByMonth || {}} isWeekly={data.isWeekly} />
          </div>
        </div>
      </div>

      {/* Project comparison + vehicle */}
      <div className="grid-2">
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
            So Sánh Số Chuyến theo Dự Án + TB Điểm Giao
          </div>
          <div style={{ height: 280 }}>
            <ProjectCompareChart projectStats={fProjectStats} />
          </div>
        </div>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/></svg>
            Tỷ Trọng Loại Xe Sử Dụng
          </div>
          <div style={{ height: 280 }}>
            <VehicleDonut vehicleTypeDist={data.vehicleTypeDist || {}} />
          </div>
        </div>
      </div>

      {/* Trip detail table */}
      <div className="chart-panel">
        <div className="chart-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          Chi Tiết Từng Chuyến — {fmt(fTotalTrips)} chuyến / {fmt(fTotalLocations)} điểm giao
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)", textAlign: "left" }}>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Mã chuyến</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Dự án</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Ngày xuất</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Xe GHN</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Biển số</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "center" }}>Đơn hàng</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "center" }}>Điểm giao</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Tỉnh/Thành</th>
              </tr>
            </thead>
            <tbody>
              {[...filteredTrips].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((t, i) => (
                <tr key={i} style={{
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                }}>
                  <td style={{ padding: "8px 10px", color: "var(--blue)", fontWeight: 600, fontFamily: "monospace" }}>
                    {t.trip_code}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-primary)" }}>
                    <span style={{
                      fontSize: 11, padding: "2px 7px", borderRadius: 10,
                      background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)",
                    }}>{t.client || "—"}</span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-secondary)" }}>
                    {t.date ? t.date.split("-").reverse().join("/") : "—"}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600,
                      background: `${vehicleColor[t.xe_ghn_cap] || "#94a3b8"}22`,
                      color: vehicleColor[t.xe_ghn_cap] || "#94a3b8",
                      border: `1px solid ${vehicleColor[t.xe_ghn_cap] || "#94a3b8"}44`,
                    }}>{t.xe_ghn_cap || "—"}</span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontFamily: "monospace", fontSize: 11 }}>
                    {t.plate}
                    {t.plateReason && (
                      <span title={t.plateReason} style={{ marginLeft: 4, color: "var(--amber)", cursor: "help" }}>⚠️</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-secondary)" }}>
                    {t.order_count}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <span style={{
                      fontWeight: 700, fontSize: 13,
                      color: (t.locations?.length || 0) > 2 ? "var(--amber)" : "var(--text-secondary)",
                    }}>
                      {t.locations?.length || 0}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 11 }}>
                    {(t.provinces || []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!data.trips || data.trips.length === 0) && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
              Không có chuyến nào trong kỳ này
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
