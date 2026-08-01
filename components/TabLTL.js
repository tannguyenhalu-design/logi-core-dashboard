/**
 * components/TabLTL.js — LTL Dashboard Tab
 * All charts re-render when `data` prop changes (driven by filter state).
 */
import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import KpiCard from "./KpiCard";

Chart.register(ChartDataLabels);

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
function OntimeMonthChart({ ontimeByMonth, isWeekly }) {
  const ref = useRef(null);
  const months = Object.keys(ontimeByMonth).sort((a, b) => a - b);

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: months.map((m, idx) => {
        const info = ontimeByMonth[m];
        const total = (info?.ontime || 0) + (info?.late || 0);
        const shortTotal = total >= 1000 ? (total / 1000).toFixed(1).replace(".0", "") + "K" : total;
        const labelPrefix = isWeekly ? `Tuần ${m}` : `T${m}`;
        if (idx === 0) {
          return [labelPrefix, `${shortTotal} đơn`];
        } else {
          const prevM = months[idx - 1];
          const prevInfo = ontimeByMonth[prevM];
          const prevTotal = (prevInfo?.ontime || 0) + (prevInfo?.late || 0);
          const diffPct = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;
          const sign = diffPct >= 0 ? "+" : "";
          return [labelPrefix, `${shortTotal} đơn (${sign}${diffPct}%)`];
        }
      }),
      datasets: [
        {
          label: "Ontime",
          data: months.map((m) => ontimeByMonth[m]?.ontime || 0),
          backgroundColor: COLORS.green, stack: "s",
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 400,
            color: "#fff",
            font: { weight: "bold", size: 10 },
            formatter: (v) => v.toLocaleString("vi-VN"),
          }
        },
        {
          label: "Late",
          data: months.map((m) => ontimeByMonth[m]?.late || 0),
          backgroundColor: COLORS.red, stack: "s",
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 400,
            color: "#fff",
            font: { weight: "bold", size: 10 },
            formatter: (v) => v.toLocaleString("vi-VN"),
          }
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
        datalabels: { display: false }, // defaults to false, overridden in datasets
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
      layout: { padding: { top: 8 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          color: (ctx) => ctx.dataset.data[ctx.dataIndex] > 50 ? "#fff" : "#fff",
          font: { weight: "bold", size: 10 },
          formatter: (v) => v + "%",
          anchor: "end",
          align: "start",   // inside top of bar (no overflow)
          offset: 4,
          clamp: true,
        },
      },
      scales: {
        y: { min: 0, max: 105, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { callback: (v) => v <= 100 ? v + "%" : "" } },
        x: { grid: { display: false } },
      },
    },
  }), [ontimeByProject]);

  return <canvas ref={ref} />;
}

// ── Chart: Orders by Project (donut, % in legend) ──
function OrdersProjChart({ ordersByProject }) {
  const ref = useRef(null);
  const projs = Object.keys(ordersByProject).sort((a, b) => ordersByProject[b] - ordersByProject[a]);
  const total = projs.reduce((s, p) => s + ordersByProject[p], 0);
  const palette = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#ec4899", "#06b6d4", "#84cc16"];

  useChart(ref, () => ({
    type: "doughnut",
    data: {
      labels: projs.map((p) => {
        const pct = total > 0 ? Math.round((ordersByProject[p] / total) * 100) : 0;
        return `${p} (${pct}%)`;
      }),
      datasets: [{
        data: projs.map((p) => ordersByProject[p]),
        backgroundColor: projs.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        legend: { position: "right", labels: { color: "#94a3b8", boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const val = item.raw;
              const sum = item.dataset.data.reduce((a, b) => a + b, 0);
              const pct = sum > 0 ? Math.round((val / sum) * 100) : 0;
              const projName = item.label.split(" (")[0];
              return ` ${projName}: ${val.toLocaleString("vi-VN")} đơn (${pct}%)`;
            }
          }
        },
        datalabels: {
          display: (ctx) => {
            const val = ctx.dataset.data[ctx.dataIndex];
            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return sum > 0 ? (val / sum) * 100 > 4 : false;
          },
          color: "#fff",
          font: { weight: "bold", size: 10 },
          formatter: (v, ctx) => {
            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return sum > 0 ? Math.round((v / sum) * 100) + "%" : "";
          }
        },
      },
    },
  }), [ordersByProject]);

  return <canvas ref={ref} />;
}

// ── Damage Regions component ──
function DamageRegions({ topDamageProvinces, topDamageWarehouses, selectedProvince, selectedWarehouse, onSelectProvince, onSelectWarehouse }) {
  return (
    <div className="grid-2" style={{ marginTop: 20, marginBottom: 20 }}>
      <div style={{ background: "rgba(255,255,255,0.02)", padding: 18, borderRadius: 12, border: "1px solid var(--border)", backdropFilter: "blur(8px)" }}>
        <h4 style={{ margin: "0 0 12px 0", fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
          📍 Top 5 Tỉnh/Thành nhận hàng (Click để lọc)
        </h4>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {topDamageProvinces.map((p, idx) => {
            const isSelected = selectedProvince === p.name;
            return (
              <li 
                key={p.name} 
                onClick={() => onSelectProvince(isSelected ? null : p.name)}
                style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  padding: "8px 12px", 
                  borderBottom: idx < 4 ? "1px solid rgba(255,255,255,0.05)" : "none", 
                  fontSize: 13,
                  cursor: "pointer",
                  background: isSelected ? "rgba(244, 63, 94, 0.15)" : "transparent",
                  borderRadius: 6,
                  transition: "all 0.2s",
                  fontWeight: isSelected ? 600 : 400
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>{idx + 1}. {p.name} {isSelected && "🎯"}</span>
                <span className="text-red" style={{ fontWeight: 600 }}>{p.count} ca</span>
              </li>
            );
          })}
          {topDamageProvinces.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Không có dữ liệu bể vỡ.</div>}
        </ul>
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", padding: 18, borderRadius: 12, border: "1px solid var(--border)", backdropFilter: "blur(8px)" }}>
        <h4 style={{ margin: "0 0 12px 0", fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
          🏢 Top 5 Kho giao hàng (Click để lọc)
        </h4>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {topDamageWarehouses.map((w, idx) => {
            const isSelected = selectedWarehouse === w.name;
            return (
              <li 
                key={w.name} 
                onClick={() => onSelectWarehouse(isSelected ? null : w.name)}
                style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  padding: "8px 12px", 
                  borderBottom: idx < 4 ? "1px solid rgba(255,255,255,0.05)" : "none", 
                  fontSize: 13,
                  cursor: "pointer",
                  background: isSelected ? "rgba(244, 63, 94, 0.15)" : "transparent",
                  borderRadius: 6,
                  transition: "all 0.2s",
                  fontWeight: isSelected ? 600 : 400
                }}
              >
                <span style={{ color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "75%" }} title={w.name}>{idx + 1}. {w.name} {isSelected && "🎯"}</span>
                <span className="text-red" style={{ fontWeight: 600 }}>{w.count} ca</span>
              </li>
            );
          })}
          {topDamageWarehouses.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Không có dữ liệu bể vỡ.</div>}
        </ul>
      </div>
    </div>
  );
}

// ── Detailed damage cases table component ──
function DetailedDamageTable({ cases, filter }) {
  const filteredCases = filter
    ? cases.filter(c => {
        if (filter.type === 'type') return c.damage_type === filter.value;
        if (filter.type === 'province') return c.to_province === filter.value;
        if (filter.type === 'warehouse') return c.warehouse_giao === filter.value;
        return true;
      })
    : cases;

  return (
    <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto", marginTop: 16 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>Dự án</th>
            <th>Tỉnh nhận</th>
            <th>Kho giao</th>
            <th>Loại lỗi</th>
            <th>Mô tả chi tiết hư hỏng</th>
            <th>Nơi phát hiện</th>
            <th style={{ textAlign: "right" }}>Số tiền</th>
            <th>Hướng xử lý</th>
          </tr>
        </thead>
        <tbody>
          {filteredCases.map((c, i) => (
            <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "var(--cyan)" }}>{c.order_code}</td>
              <td style={{ fontSize: 12 }}>{c.client_name}</td>
              <td style={{ fontSize: 12 }}>{c.to_province}</td>
              <td style={{ fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.warehouse_giao}>{c.warehouse_giao}</td>
              <td><span className="badge bg-red" style={{ fontSize: 10, padding: "2px 6px" }}>{c.damage_type}</span></td>
              <td style={{ fontSize: 12, maxWidth: 320, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4, padding: "8px 12px" }}>{c.damage_details || "—"}</td>
              <td style={{ fontSize: 12 }}>{c.offence_place || "—"}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace", color: "var(--amber)", fontSize: 12, fontWeight: 600 }}>
                {c.amount > 0 ? c.amount.toLocaleString("vi-VN") + " đ" : "—"}
              </td>
              <td>
                <span className={`badge ${c.handling === "Đền bù" ? "bg-amber" : c.handling === "Đã xử lý (không đền bù)" ? "bg-cyan" : "bg-muted"}`} style={{ fontSize: 10 }}>
                  {c.handling}
                </span>
              </td>
            </tr>
          ))}
          {filteredCases.length === 0 && (
            <tr>
              <td colSpan="9" style={{ textAlign: "center", color: "var(--text-muted)", padding: 30 }}>
                Không có dữ liệu ca hư hỏng chi tiết.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Chart: Warehouse risk bar ──
function WarehouseRiskChart({ warehouseAlerts }) {
  const ref = useRef(null);

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: warehouseAlerts.map((w) => w.warehouse),
      datasets: [
        {
          label: "Số ca bể vỡ / hư hỏng",
          data: warehouseAlerts.map((w) => w.broken),
          backgroundColor: COLORS.amber,
          borderRadius: 4,
          datalabels: {
            display: true,
            color: "#fff",
            anchor: "end",
            align: "right",
            font: { weight: "bold", size: 10 }
          }
        },
      ],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 30 } },
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  }), [warehouseAlerts]);

  return <canvas ref={ref} />;
}

// ── Broken breakdown table ──
function BrokenTable({ brokenByType, totalBroken, brokenCompensated, brokenResolved, brokenPending, selectedType, onSelectType }) {
  const types = Object.keys(brokenByType);
  return (
    <div style={{ overflowX: "auto" }}>
      {/* Summary badges */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <span 
          className={`badge bg-red`} 
          style={{ cursor: "pointer", opacity: !selectedType ? 1 : 0.6, border: !selectedType ? "1px solid #fff" : "none" }}
          onClick={() => onSelectType(null)}
        >
          Tất cả: {totalBroken}
        </span>
        <span className="badge bg-amber">Đền bù: {brokenCompensated}</span>
        <span className="badge bg-cyan">Đã xử lý: {brokenResolved}</span>
        <span className="badge" style={{ background: "rgba(100,116,139,0.15)", color: "var(--text-muted)" }}>Chưa xử lý: {brokenPending}</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Loại hư hỏng (Click dòng để lọc)</th>
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
            const isSelected = selectedType === t;
            return (
              <tr 
                key={t} 
                onClick={() => onSelectType(isSelected ? null : t)}
                style={{ 
                  cursor: "pointer", 
                  background: isSelected ? "rgba(59, 130, 246, 0.15)" : "transparent",
                  borderLeft: isSelected ? "3px solid var(--blue)" : "none"
                }}
              >
                <td style={{ fontWeight: isSelected ? 600 : 400 }}>{t} {isSelected && "🎯"}</td>
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
  const [damageFilter, setDamageFilter] = useState(null); // { type: 'type' | 'province' | 'warehouse', value: string }

  if (!data) return <div className="spinner" />;

  const selectedDamageType = damageFilter?.type === "type" ? damageFilter.value : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI Cards */}
      <div className="grid-4">
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>}
          label={data.filterMode === "delivered" ? "GTC (ngày giao)" : "Tổng Đơn (lấy hàng)"}
          value={fmt(data.totalOrders)}
          sub="Tính theo số lượng đơn"
          colorClass="text-cyan"
        />
        {data.filterMode !== "delivered" && (
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            label="GTC trong kỳ"
            value={fmt(data.deliveredThisMonthCount)}
            sub="Tính theo ngày giao thực tế"
            colorClass="text-green"
          />
        )}
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

      {/* Ontime trend + Orders donut */}
      <div className="grid-2-1">
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Xu hướng Ontime / Late theo {data.isWeekly ? "tuần" : "tháng"}
          </div>
          <div style={{ height: 280 }}>
            <OntimeMonthChart ontimeByMonth={data.ontimeByMonth} isWeekly={data.isWeekly} />
          </div>
        </div>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            Tỷ trọng Số đơn theo Dự Án
          </div>
          <div style={{ height: 280 }}>
            <OrdersProjChart ordersByProject={data.ordersByProject} />
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
            Top 10 Kho Rủi Ro Cao
          </div>
          <div style={{ height: 260 }}>
            <WarehouseRiskChart warehouseAlerts={data.warehouseAlerts} />
          </div>
        </div>
      </div>

      {/* Area damage & Broken breakdown table */}
      <div className="grid-2-1">
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Bảng Tổng Hợp Ca Hư Hỏng
          </div>
          <BrokenTable
            brokenByType={data.brokenByType || {}}
            totalBroken={data.totalBroken || 0}
            brokenCompensated={data.brokenCompensated || 0}
            brokenResolved={data.brokenResolved || 0}
            brokenPending={data.brokenPending || 0}
            selectedType={selectedDamageType}
            onSelectType={(type) => setDamageFilter(type ? { type: "type", value: type } : null)}
          />
        </div>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 0 0-10 10c0 5.25 10 12 10 12s10-6.75 10-12a10 10 0 0 0-10-10z"/></svg>
            Khu vực Báo Bể Vỡ
          </div>
          <DamageRegions
            topDamageProvinces={data.topDamageProvinces || []}
            topDamageWarehouses={data.topDamageWarehouses || []}
            selectedProvince={damageFilter?.type === "province" ? damageFilter.value : null}
            selectedWarehouse={damageFilter?.type === "warehouse" ? damageFilter.value : null}
            onSelectProvince={(prov) => setDamageFilter(prov ? { type: "province", value: prov } : null)}
            onSelectWarehouse={(wh) => setDamageFilter(wh ? { type: "warehouse", value: wh } : null)}
          />
        </div>
      </div>

      {/* Broken details */}
      <div className="chart-panel">
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
        />
      </div>
    </div>
  );
}
