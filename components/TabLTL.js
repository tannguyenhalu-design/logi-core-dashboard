/**
 * components/TabLTL.js — LTL Dashboard Tab
 * All charts re-render when `data` prop changes (driven by filter state).
 */
import { useEffect, useRef } from "react";
import {
  Chart, BarElement, LineElement, PointElement, ArcElement,
  CategoryScale, LinearScale, Tooltip, Legend,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import KpiCard from "./KpiCard";

Chart.register(
  BarElement, LineElement, PointElement, ArcElement,
  CategoryScale, LinearScale, Tooltip, Legend, ChartDataLabels
);

Chart.defaults.color = "#94a3b8";
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.tooltip.backgroundColor = "rgba(15,23,42,0.95)";
Chart.defaults.plugins.tooltip.borderColor = "rgba(59,130,246,0.3)";
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.titleColor = "#fff";

const COLORS = {
  cyan: "#3b82f6", green: "#10b981", red: "#f43f5e",
  amber: "#f59e0b", purple: "#8b5cf6",
};

function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("vi-VN", { maximumFractionDigits: decimals });
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

// ── Chart: Ontime/Late by Month (stacked bar + line % ontime) ──
function OntimeMonthChart({ ontimeByMonth }) {
  const ref = useRef(null);
  const months = Object.keys(ontimeByMonth).sort((a, b) => a - b);

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: months.map((m) => `T${m}`),
      datasets: [
        {
          label: "Ontime",
          data: months.map((m) => ontimeByMonth[m]?.ontime || 0),
          backgroundColor: COLORS.green, stack: "s",
        },
        {
          label: "Late",
          data: months.map((m) => ontimeByMonth[m]?.late || 0),
          backgroundColor: COLORS.red, stack: "s",
        },
        {
          label: "% Ontime",
          type: "line",
          data: months.map((m) => {
            const o = ontimeByMonth[m]?.ontime || 0;
            const total = (ontimeByMonth[m]?.ontime || 0) + (ontimeByMonth[m]?.late || 0);
            return total > 0 ? Math.round((o / total) * 1000) / 10 : 0;
          }),
          borderColor: COLORS.amber, borderWidth: 2,
          yAxisID: "y1", tension: 0.3, pointRadius: 4,
          pointBackgroundColor: COLORS.amber,
          datalabels: {
            display: true, color: COLORS.amber,
            font: { weight: "bold", size: 10 },
            formatter: (v) => v + "%",
            align: "top", offset: 4,
          },
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { stacked: true, grid: { color: "rgba(255,255,255,0.05)" } },
        y1: { position: "right", grid: { display: false }, min: 0, max: 100, ticks: { callback: (v) => v + "%" } },
        x: { stacked: true, grid: { display: false } },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: "#94a3b8", boxWidth: 12 } },
        datalabels: { display: false },
      },
    },
  }), [ontimeByMonth]);

  return <canvas ref={ref} />;
}

// ── Chart: Ontime % by Project (bar, % on top) ──
function OntimeProjChart({ ontimeByProject }) {
  const ref = useRef(null);
  const projs = Object.keys(ontimeByProject).sort();

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: projs,
      datasets: [{
        label: "% Ontime",
        data: projs.map((p) => {
          const o = ontimeByProject[p]?.ontime || 0;
          const t = (ontimeByProject[p]?.ontime || 0) + (ontimeByProject[p]?.late || 0);
          return t > 0 ? Math.round((o / t) * 1000) / 10 : 0;
        }),
        backgroundColor: projs.map((_, i) =>
          [COLORS.cyan, COLORS.green, COLORS.purple, COLORS.amber, COLORS.red][i % 5]
        ),
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true, color: "#fff",
          font: { weight: "bold", size: 11 },
          formatter: (v) => v + "%",
          anchor: "end", align: "top",
        },
      },
      scales: {
        y: { min: 0, max: 100, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { callback: (v) => v + "%" } },
        x: { grid: { display: false } },
      },
    },
  }), [ontimeByProject]);

  return <canvas ref={ref} />;
}

// ── Chart: Weight by Project (donut, % in legend) ──
function WeightProjChart({ weightByProject }) {
  const ref = useRef(null);
  const projs = Object.keys(weightByProject).sort((a, b) => weightByProject[b] - weightByProject[a]);
  const total = projs.reduce((s, p) => s + weightByProject[p], 0);
  const palette = [COLORS.cyan, COLORS.purple, COLORS.green, COLORS.amber, COLORS.red, "#ec4899", "#06b6d4", "#84cc16"];

  useChart(ref, () => ({
    type: "doughnut",
    data: {
      labels: projs.map((p) => {
        const pct = total > 0 ? Math.round((weightByProject[p] / total) * 100) : 0;
        return `${p} (${pct}%)`;
      }),
      datasets: [{
        data: projs.map((p) => weightByProject[p]),
        backgroundColor: projs.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        legend: { position: "right", labels: { color: "#94a3b8", boxWidth: 12, font: { size: 12 } } },
        datalabels: { display: false },
      },
    },
  }), [weightByProject]);

  return <canvas ref={ref} />;
}

// ── Chart: Warehouse risk bar ──
function WarehouseRiskChart({ warehouseAlerts }) {
  const ref = useRef(null);

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: warehouseAlerts.map((w) => w.warehouse),
      datasets: [
        { label: "Late", data: warehouseAlerts.map((w) => w.late), backgroundColor: COLORS.red, stack: "s" },
        { label: "Hư hỏng", data: warehouseAlerts.map((w) => w.broken), backgroundColor: COLORS.amber, stack: "s" },
      ],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: "#94a3b8", boxWidth: 12 } },
        datalabels: { display: false },
      },
      scales: {
        x: { stacked: true, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { stacked: true, grid: { display: false } },
      },
    },
  }), [warehouseAlerts]);

  return <canvas ref={ref} />;
}

// ── Broken breakdown table ──
function BrokenTable({ brokenByType, totalBroken, brokenCompensated, brokenResolved, brokenPending }) {
  const types = Object.keys(brokenByType);
  return (
    <div style={{ overflowX: "auto" }}>
      {/* Summary badges */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <span className="badge bg-red">Tổng: {totalBroken}</span>
        <span className="badge bg-amber">Đền bù: {brokenCompensated}</span>
        <span className="badge bg-cyan">Đã xử lý: {brokenResolved}</span>
        <span className="badge" style={{ background: "rgba(100,116,139,0.15)", color: "var(--text-muted)" }}>Chưa xử lý: {brokenPending}</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Loại hư hỏng</th>
            <th style={{ textAlign: "right" }}>Đền bù</th>
            <th style={{ textAlign: "right" }}>Đã xử lý</th>
            <th style={{ textAlign: "right" }}>Chưa xử lý</th>
            <th style={{ textAlign: "right" }}>Tổng</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => {
            const row = brokenByType[t];
            const total = (row["Đền bù"] || 0) + (row["Đã xử lý (không đền bù)"] || 0) + (row["Chưa xử lý"] || 0);
            return (
              <tr key={t}>
                <td>{t}</td>
                <td style={{ textAlign: "right", color: "var(--amber)" }}>{row["Đền bù"] || 0}</td>
                <td style={{ textAlign: "right", color: "var(--cyan)" }}>{row["Đã xử lý (không đền bù)"] || 0}</td>
                <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{row["Chưa xử lý"] || 0}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TabLTL({ data }) {
  if (!data) return <div className="spinner" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI Cards */}
      <div className="grid-4">
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>}
          label="Tổng Đơn Hàng"
          value={fmt(data.totalOrders)}
          sub={`${fmt(data.deliveredCount)} đã giao | ${fmt(data.totalWeight)} KG`}
          colorClass="text-cyan"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>}
          label="Tỷ lệ Ontime"
          value={data.ontimePct + "%"}
          sub={`${fmt(data.ontimeCount)} ontime / ${fmt(data.evalCount)} đánh giá`}
          colorClass="text-green"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
          label="Đơn Late"
          value={fmt(data.lateCount)}
          sub={`${data.evalCount > 0 ? (100 - data.ontimePct).toFixed(1) : 0}% tỷ lệ late`}
          colorClass="text-red"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
          label="Ca Hư Hỏng"
          value={fmt(data.totalBroken)}
          sub={`${data.brokenCompensated} đền bù · ${data.brokenPending} chưa xử lý`}
          colorClass="text-amber"
        />
      </div>

      {/* Ontime trend + Weight donut */}
      <div className="grid-2-1">
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Xu hướng Ontime / Late theo tháng
          </div>
          <div style={{ height: 280 }}>
            <OntimeMonthChart ontimeByMonth={data.ontimeByMonth} />
          </div>
        </div>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            Tỷ trọng Khối Lượng theo Dự Án
          </div>
          <div style={{ height: 280 }}>
            <WeightProjChart weightByProject={data.weightByProject} />
          </div>
        </div>
      </div>

      {/* Ontime by project + Warehouse risk */}
      <div className="grid-2">
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
            % Ontime theo Dự Án
          </div>
          <div style={{ height: 260 }}>
            <OntimeProjChart ontimeByProject={data.ontimeByProject} />
          </div>
        </div>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            Top 8 Kho Rủi Ro Cao
          </div>
          <div style={{ height: 260 }}>
            <WarehouseRiskChart warehouseAlerts={data.warehouseAlerts} />
          </div>
        </div>
      </div>

      {/* Broken details */}
      <div className="chart-panel">
        <div className="chart-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Chi Tiết Case Hư Hỏng
        </div>
        <BrokenTable
          brokenByType={data.brokenByType}
          totalBroken={data.totalBroken}
          brokenCompensated={data.brokenCompensated}
          brokenResolved={data.brokenResolved}
          brokenPending={data.brokenPending}
        />
      </div>
    </div>
  );
}
