/**
 * components/TabFTL.js — FTL Dashboard Tab
 */
import { useRef, useEffect } from "react";
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

export default function TabFTL({ data }) {
  if (!data) return <div className="spinner" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI */}
      <div className="grid-4">
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>}
          label="Tổng Chuyến (FTL)"
          value={fmt(data.totalTrips)}
          sub={`TB ${data.avgTripsPerDay} chuyến/ngày`}
          colorClass="text-purple"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>}
          label="Tổng Đơn Hàng"
          value={fmt(data.totalOrders)}
          sub="Dedupe theo order_number"
          colorClass="text-cyan"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>}
          label="Khối Lượng"
          value={fmt(data.totalWeight)}
          sub="KG (dedupe order)"
          colorClass="text-green"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
          label="TB Chuyến / Ngày"
          value={data.avgTripsPerDay}
          sub={`Dựa trên ${Object.keys(data.tripsByDay || {}).length} ngày`}
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

      {/* Vehicle donut + province alerts */}
      <div className="grid-2">
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/></svg>
            Tỷ trọng Loại Xe Sử Dụng
          </div>
          <div style={{ height: 250 }}>
            <VehicleDonut vehicleTypeDist={data.vehicleTypeDist || {}} />
          </div>
        </div>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            Cảnh Báo Tỉnh Tăng Đột Biến (7 ngày)
          </div>
          <ProvinceAlerts provinceAlerts={data.provinceAlerts} />
        </div>
      </div>

      {/* Top 10 Delivery Locations */}
      <div className="chart-panel">
        <div className="chart-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Top 10 Điểm Giao Có Số Chuyến Nhiều Nhất
        </div>
        <div style={{ height: 350 }}>
          <TopLocationsChart top10Locations={data.top10Locations || []} />
        </div>
      </div>
    </div>
  );
}
