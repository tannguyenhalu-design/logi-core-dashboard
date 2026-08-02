/**
 * components/TabLTL.js — LTL Dashboard Tab
 * All charts re-render when `data` prop changes (driven by filter state).
 */
import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import KpiCard from "./KpiCard";
import TruckLoader from "./TruckLoader";
import VietnamMap from "./VietnamMap";

Chart.register(ChartDataLabels);

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.tooltip.borderWidth = 1;

// Chart.js draws to <canvas>, so it can't read CSS variables — colors must
// be resolved in JS and re-applied whenever the theme toggles.
const CHART_THEME = {
  dark: {
    text: "#f1f5f9",
    muted: "#94a3b8",
    grid: "rgba(255,255,255,0.05)",
    tooltipBg: "rgba(15,23,42,0.95)",
    tooltipBorder: "rgba(20, 224, 196, 0.3)",
    tooltipTitle: "#ffffff",
    tooltipBody: "#f1f5f9",
    legend: "#ffffff",
  },
  light: {
    text: "#0f172a",
    muted: "#475569",
    grid: "rgba(15,23,42,0.08)",
    tooltipBg: "rgba(255,255,255,0.98)",
    tooltipBorder: "rgba(2, 132, 199, 0.35)",
    tooltipTitle: "#0f172a",
    tooltipBody: "#1e293b",
    legend: "#0f172a",
  },
};

function currentTheme() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function useTheme() {
  const [theme, setTheme] = useState(currentTheme());
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}


const COLORS = {
  cyan: "#14e0c4", green: "#10b981", red: "#f43f5e",
  amber: "#f59e0b", purple: "#8b5cf6",
};

function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("vi-VN", { maximumFractionDigits: decimals });
}

function useChart(canvasRef, config, deps, theme = "dark") {
  const chartRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const t = CHART_THEME[theme] || CHART_THEME.dark;
    Chart.defaults.color = t.muted;
    Chart.defaults.plugins.tooltip.backgroundColor = t.tooltipBg;
    Chart.defaults.plugins.tooltip.borderColor = t.tooltipBorder;
    Chart.defaults.plugins.tooltip.titleColor = t.tooltipTitle;
    Chart.defaults.plugins.tooltip.bodyColor = t.tooltipBody;
    Chart.defaults.plugins.legend.labels.color = t.legend;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, config());
    return () => { if (chartRef.current) chartRef.current.destroy(); };
    // eslint-disable-next-line
  }, [...deps, theme]);
}

// ── Chart: Ontime/Late by Month (stacked bar + line % ontime) ──
function OntimeMonthChart({ ontimeByMonth, isWeekly, theme = "dark" }) {
  const ref = useRef(null);
  const months = Object.keys(ontimeByMonth).sort((a, b) => a - b);
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

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
        y: { stacked: true, grid: { color: ct.grid } },
        y1: { position: "right", grid: { display: false }, min: 0, max: 100, ticks: { callback: (v) => v + "%" } },
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { maxRotation: 0, minRotation: 0 }
        },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: ct.muted, boxWidth: 12 } },
        datalabels: { display: false }, // defaults to false, overridden in datasets
      },
    },
  }), [ontimeByMonth], theme);

  return <canvas ref={ref} />;
}

// ── Chart: Ontime % by Project (bar, % on top) ──
function OntimeProjChart({ ontimeByProject, theme = "dark" }) {
  const ref = useRef(null);
  const projs = Object.keys(ontimeByProject).sort();
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

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
        y: { min: 0, max: 105, grid: { color: ct.grid }, ticks: { callback: (v) => v <= 100 ? v + "%" : "" } },
        x: { grid: { display: false } },
      },
    },
  }), [ontimeByProject], theme);

  return <canvas ref={ref} />;
}

// ── Chart: Orders by Project (donut, % in legend) ──
function OrdersProjChart({ ordersByProject, theme = "dark" }) {
  const ref = useRef(null);
  const projs = Object.keys(ordersByProject).sort((a, b) => ordersByProject[b] - ordersByProject[a]);
  const total = projs.reduce((s, p) => s + ordersByProject[p], 0);
  const palette = ["#14e0c4", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#ec4899", "#06b6d4", "#84cc16"];
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

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
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: ct.legend,
            boxWidth: 11,
            padding: 10,
            font: { size: 12, weight: "600" },
          },
        },
        tooltip: {
          backgroundColor: ct.tooltipBg,
          borderColor: ct.tooltipBorder,
          titleColor: ct.tooltipTitle,
          bodyColor: ct.tooltipBody,
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
        datalabels: { display: false },
      },
    },
  }), [ordersByProject], theme);

  return <canvas ref={ref} />;
}


// ── Chart: Weight (Kg/Tấn) by Project (donut, % in legend) ──
function WeightProjChart({ weightByProject = {}, theme = "dark" }) {
  const ref = useRef(null);
  const projs = Object.keys(weightByProject).sort((a, b) => (weightByProject[b] || 0) - (weightByProject[a] || 0));
  const total = projs.reduce((s, p) => s + (weightByProject[p] || 0), 0);
  const palette = ["#06b6d4", "#f59e0b", "#10b981", "#8b5cf6", "#f43f5e", "#14e0c4", "#ec4899", "#84cc16"];
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

  useChart(ref, () => ({
    type: "doughnut",
    data: {
      labels: projs.map((p) => {
        const w = weightByProject[p] || 0;
        const pct = total > 0 ? Math.round((w / total) * 100) : 0;
        const displayW = w >= 1000 ? `${(w / 1000).toFixed(1).replace(".0", "")} Tấn` : `${w} Kg`;
        return `${p}: ${displayW} (${pct}%)`;
      }),
      datasets: [{
        data: projs.map((p) => weightByProject[p] || 0),
        backgroundColor: projs.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: ct.legend,
            boxWidth: 11,
            padding: 10,
            font: { size: 12, weight: "600" },
          },
        },
        tooltip: {
          backgroundColor: ct.tooltipBg,
          borderColor: ct.tooltipBorder,
          titleColor: ct.tooltipTitle,
          bodyColor: ct.tooltipBody,
          callbacks: {
            label: (item) => {
              const val = item.raw;
              const sum = item.dataset.data.reduce((a, b) => a + b, 0);
              const pct = sum > 0 ? Math.round((val / sum) * 100) : 0;
              const displayVal = val >= 1000 ? `${(val / 1000).toFixed(1).replace(".0", "")} Tấn` : `${val} Kg`;
              const projName = item.label.split(":")[0];
              return ` ${projName}: ${displayVal} (${pct}%)`;
            }
          }
        },
        datalabels: { display: false },
      },
    },
  }), [weightByProject], theme);

  return <canvas ref={ref} />;
}

// ── Damage Regions component ──
function DamageRegions({ topDamageProvinces, topDamageWarehouses, selectedProvince, selectedWarehouse, onSelectProvince, onSelectWarehouse }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "rgba(255,255,255,0.02)", padding: 16, borderRadius: 12, border: "1px solid var(--border)", backdropFilter: "blur(8px)" }}>
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
      <div style={{ background: "rgba(255,255,255,0.02)", padding: 16, borderRadius: 12, border: "1px solid var(--border)", backdropFilter: "blur(8px)" }}>
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
                <span style={{ color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "80%" }} title={w.name}>{idx + 1}. {w.name} {isSelected && "🎯"}</span>
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
        if (filter.type === 'type') {
          return String(c.damage_type || "").trim().toLowerCase() === String(filter.value || "").trim().toLowerCase();
        }
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
function WarehouseRiskChart({ warehouseAlerts, theme = "dark" }) {
  const ref = useRef(null);
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

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
            color: ct.text,
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
        x: { grid: { color: ct.grid }, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  }), [warehouseAlerts], theme);

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
                  background: isSelected ? "rgba(20, 224, 196, 0.15)" : "transparent",
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

function fmtWeight(kg) {
  if (!kg || kg <= 0) return "0 kg";
  if (kg >= 1000) {
    const ton = (kg / 1000).toFixed(1).replace(".0", "");
    return `${kg.toLocaleString("vi-VN")} kg (${ton} tấn)`;
  }
  return `${kg.toLocaleString("vi-VN")} kg`;
}

function getOntimeColor(pct) {
  if (pct === null || pct === undefined) return "var(--green)";
  if (pct >= 90) return "var(--green)";
  if (pct >= 80) return "var(--amber)";
  return "var(--red)";
}

function getOntimeBadge(pct) {
  if (pct >= 90) return { label: "Tốt (≥90%)", color: "var(--green)", bg: "rgba(16,185,129,0.15)" };
  if (pct >= 80) return { label: "⚠️ Trung bình (80-90%)", color: "var(--amber)", bg: "rgba(245,158,11,0.15)" };
  return { label: "🚨 CẢNH BÁO LOW (<80%)", color: "var(--red)", bg: "rgba(244,63,94,0.18)" };
}

// ── Province delivery map + AI insight (Bản đồ phân bố + gợi ý theo tỉnh) ──
function ProvinceMapPanel({ provinceStats, routeStats, provinceDetailsMap = {}, projectSummaries = {}, overallData = {}, singleProjectMode, projectName }) {
  const [activeProv, setActiveProv] = useState(null);
  const [viewMode, setViewMode] = useState("orders"); // 'orders' | 'weight' | 'ontime' | 'damage'

  if (!provinceStats || provinceStats.length === 0) {
    return (
      <div className="chart-panel" style={{ width: "100%" }}>
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)" }}>
          Không có dữ liệu tỉnh giao trong khoảng lọc hiện tại.
        </div>
      </div>
    );
  }

  // Sort provinces based on active viewMode
  const sortedProvinces = [...provinceStats].sort((a, b) => {
    const aDet = provinceDetailsMap[a.name] || a.details;
    const bDet = provinceDetailsMap[b.name] || b.details;
    if (viewMode === "weight") return (bDet?.totalWeight || a.weight || 0) - (aDet?.totalWeight || b.weight || 0);
    if (viewMode === "ontime") return (aDet?.ontimePct ?? 100) - (bDet?.ontimePct ?? 100);
    if (viewMode === "damage") return (bDet?.damageCount || 0) - (aDet?.damageCount || 0);
    return b.orders - a.orders;
  });

  const maxOrders = Math.max(...provinceStats.map((p) => p.orders), 1);
  const maxWeight = Math.max(...provinceStats.map((p) => (provinceDetailsMap[p.name]?.totalWeight || p.weight || 1)), 1);

  const colorMap = {};
  provinceStats.forEach((p) => {
    const pDet = provinceDetailsMap[p.name];
    if (viewMode === "weight") {
      const w = pDet?.totalWeight || p.weight || 0;
      const intensity = Math.min(1, w / maxWeight);
      colorMap[p.name] = `rgba(13, 148, 136, ${(0.25 + intensity * 0.7).toFixed(2)})`;
    } else if (viewMode === "ontime") {
      const ontime = pDet ? pDet.ontimePct : 100;
      colorMap[p.name] = getOntimeColor(ontime);
    } else if (viewMode === "damage") {
      const dmg = pDet ? pDet.damageCount : 0;
      colorMap[p.name] = dmg > 0 ? "var(--amber)" : "var(--map-unhighlighted)";
    } else {
      const intensity = Math.min(1, p.orders / maxOrders);
      colorMap[p.name] = `rgba(20, 224, 196, ${(0.2 + intensity * 0.75).toFixed(2)})`;
    }
  });

  const topProvinces = sortedProvinces.slice(0, 8);
  const highlightProvinces = sortedProvinces.slice(0, 5).map((p) => p.name);

  const routeLines = singleProjectMode
    ? routeStats.slice(0, 15).map((r) => ({ from: r.from, to: r.to, weight: r.orders, color: "#33D6C0" }))
    : [];

  const inspectData = activeProv ? (provinceDetailsMap[activeProv] || provinceStats.find(p => p.name === activeProv)?.details) : null;
  const projectOverview = singleProjectMode ? projectSummaries[projectName] : null;

  return (
    <div className="chart-panel" style={{ width: "100%" }}>
      {/* Title & View Mode Selector Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          Bản đồ phân bố giao hàng theo tỉnh{singleProjectMode ? ` — Dự án ${projectName}` : ""}
        </div>

        {/* View Mode Toggle Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--input-bg)", padding: 3, borderRadius: 8, border: "1px solid var(--border)" }}>
          <button
            onClick={() => setViewMode("orders")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "orders" ? "var(--cyan)" : "transparent",
              color: viewMode === "orders" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            📦 Theo Số Đơn
          </button>
          <button
            onClick={() => setViewMode("weight")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "weight" ? "var(--cyan)" : "transparent",
              color: viewMode === "weight" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            ⚖️ Theo Tải Trọng (Tấn)
          </button>
          <button
            onClick={() => setViewMode("ontime")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "ontime" ? "var(--cyan)" : "transparent",
              color: viewMode === "ontime" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            ⏱️ Tỷ Lệ Ontime
          </button>
          <button
            onClick={() => setViewMode("damage")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "damage" ? "var(--amber)" : "transparent",
              color: viewMode === "damage" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            💥 Ca Hư Hỏng
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 20, alignItems: "start" }}>
        {/* Left Column: Compact Map (Sticky on Scroll) */}
        <div style={{ position: "sticky", top: 80, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <VietnamMap
            colorMap={colorMap}
            highlightProvinces={singleProjectMode ? [] : highlightProvinces}
            routeLines={routeLines}
            provinceDetailsMap={provinceDetailsMap}
            viewMode={viewMode}
            onProvinceHover={(prov) => setActiveProv(prov)}
            onProvinceClick={(prov) => setActiveProv(prov)}
          />
          {singleProjectMode && (
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, textAlign: "center" }}>
              Nét càng dày = số lượng đơn giao càng lớn.
            </p>
          )}
        </div>

        {/* Right Column: Dynamic Card (Overview on Default, Detail on Province Hover) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          
          {/* CASE A: User is HOVERING a specific province */}
          {inspectData ? (
            <div style={{
              background: "var(--panel-bg-strong)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "16px 20px",
              backdropFilter: "blur(8px)",
              minHeight: 310,
              transition: "all 0.2s ease-out",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                  📍 Chi tiết khu vực: {inspectData.name}
                  {(() => {
                    const badge = getOntimeBadge(inspectData.ontimePct);
                    return (
                      <span style={{ fontSize: 11, background: badge.bg, color: badge.color, border: `1px solid ${badge.color}`, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </span>
                <span className="badge bg-cyan" style={{ fontSize: 12 }}>
                  {fmt(inspectData.totalOrders)} đơn · {fmtWeight(inspectData.totalWeight)}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tỷ lệ Ontime</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: getOntimeColor(inspectData.ontimePct) }}>
                    {inspectData.ontimePct}%
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Điểm lấy hàng chính</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {inspectData.topOrigins && inspectData.topOrigins.length > 0
                      ? `${inspectData.topOrigins[0].name} (${inspectData.topOrigins[0].pct}%)`
                      : "—"}
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đơn Ontime / Late</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    <span style={{ color: "var(--green)" }}>{inspectData.ontimeCount}</span> / <span style={{ color: "var(--red)" }}>{inspectData.lateCount}</span>
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Ca Hư Hỏng</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: inspectData.damageCount > 0 ? "var(--amber)" : "var(--text-secondary)" }}>
                    {inspectData.damageCount || 0} ca {inspectData.damageCount > 0 && "💥"}
                  </div>
                </div>
              </div>

              {/* Client Breakdown for this Province */}
              {inspectData.clientDetails && inspectData.clientDetails.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    🏢 Khách Hàng & Tuyến Lấy Hàng Giao Khu Vực {inspectData.name}:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
                    {inspectData.clientDetails.map((c) => {
                      const badge = getOntimeBadge(c.ontimePct);
                      const hasDamage = c.damageCount > 0;
                      return (
                        <div
                          key={c.name}
                          style={{
                            background: "var(--panel-bg)",
                            border: `1px solid ${c.ontimePct < 80 ? "var(--red)" : c.ontimePct < 90 ? "var(--amber)" : "var(--border)"}`,
                            padding: "8px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "var(--text-primary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>KH {c.name}</span>
                            <span style={{ color: "var(--cyan)", fontWeight: 700 }}>{fmt(c.orders)} đơn</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                            • Lấy tại: <b style={{ color: "var(--text-secondary)" }}>{c.mainOrigin}</b>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                            • Tải trọng: <b style={{ color: "var(--text-secondary)" }}>{fmtWeight(c.weight)}</b>
                          </div>
                          <div style={{ fontSize: 11, color: badge.color, marginTop: 2, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                            <span>• Tỷ lệ Ontime: <b>{c.ontimePct}%</b></span>
                            {c.ontimePct < 90 && (
                              <span style={{ fontSize: 10, background: badge.bg, padding: "1px 4px", borderRadius: 3, color: badge.color }}>
                                {c.ontimePct < 80 ? "🚨 Low" : "⚠️ Mid"}
                              </span>
                            )}
                          </div>
                          {hasDamage && (
                            <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 2, fontWeight: 600 }}>
                              • Hư hỏng: <b>{c.damageCount} ca 💥</b>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* CASE B: DEFAULT STATE (No province hovered) — Show CLIENT OVERVIEW CARD! */
            <div style={{
              background: "var(--panel-bg-strong)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "16px 20px",
              backdropFilter: "blur(8px)",
              minHeight: 310,
              transition: "all 0.2s ease-out",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cyan)", display: "flex", alignItems: "center", gap: 8 }}>
                  🏢 {singleProjectMode ? `Góc Nhìn Tổng Quan Khách Hàng: ${projectName}` : "Góc Nhìn Tổng Quan Toàn Bộ Dự Án LTL"}
                  {(() => {
                    const pct = singleProjectMode ? (projectOverview?.ontimePct ?? 100) : (overallData?.ontimePct ?? 100);
                    const badge = getOntimeBadge(pct);
                    return (
                      <span style={{ fontSize: 11, background: badge.bg, color: badge.color, border: `1px solid ${badge.color}`, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </span>
                <span className="badge bg-cyan" style={{ fontSize: 12 }}>
                  {singleProjectMode
                    ? `${fmt(projectOverview?.totalOrders || 0)} đơn · ${fmtWeight(projectOverview?.totalWeight || 0)}`
                    : `${fmt(overallData?.totalOrders || 0)} đơn · ${fmtWeight(overallData?.totalWeight || 0)}`}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tỷ Lệ Ontime Tổng</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: getOntimeColor(singleProjectMode ? projectOverview?.ontimePct : overallData?.ontimePct) }}>
                    {singleProjectMode ? projectOverview?.ontimePct : overallData?.ontimePct}%
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tổng Tải Trọng</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {fmtWeight(singleProjectMode ? projectOverview?.totalWeight : overallData?.totalWeight)}
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đơn Ontime / Late</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    <span style={{ color: "var(--green)" }}>{singleProjectMode ? projectOverview?.ontimeCount : overallData?.ontimeCount}</span> / <span style={{ color: "var(--red)" }}>{singleProjectMode ? projectOverview?.lateCount : overallData?.lateCount}</span>
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Số Ca Bể Vỡ / Hư Hỏng</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: (singleProjectMode ? projectOverview?.damageCount : overallData?.damageCount) > 0 ? "var(--amber)" : "var(--text-secondary)" }}>
                    {(singleProjectMode ? projectOverview?.damageCount : overallData?.damageCount) || 0} ca {(singleProjectMode ? projectOverview?.damageCount : overallData?.damageCount) > 0 && "💥"}
                  </div>
                </div>
              </div>

              {/* Sub-section: Top Origins & Key Destination Provinces */}
              {singleProjectMode && projectOverview && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "var(--panel-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase" }}>
                      🏬 Điểm Lấy Hàng Chính Của {projectName}:
                    </div>
                    {projectOverview.topOrigins && projectOverview.topOrigins.length > 0 ? (
                      projectOverview.topOrigins.slice(0, 3).map((o) => (
                        <div key={o.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                          <span style={{ color: "var(--text-primary)" }}>• {o.name}</span>
                          <b style={{ color: "var(--cyan)" }}>{o.count} đơn ({o.pct}%)</b>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Chưa ghi nhận điểm lấy</div>
                    )}
                  </div>

                  <div style={{ background: "var(--panel-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase" }}>
                      🚚 Top Tỉnh Giao Hàng Lớn Nhất:
                    </div>
                    {projectOverview.topProvinces && projectOverview.topProvinces.length > 0 ? (
                      projectOverview.topProvinces.slice(0, 3).map((p) => (
                        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                          <span style={{ color: "var(--text-primary)" }}>• {p.name}</span>
                          <b style={{ color: "var(--cyan)" }}>{p.count} đơn ({p.pct}%)</b>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Chưa ghi nhận tỉnh giao</div>
                    )}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, fontStyle: "italic" }}>
                💡 Rà chuột vào 1 tỉnh bất kỳ trên bản đồ để soi chi tiết từng tuyến lấy/giao & khách hàng tại tỉnh đó.
              </div>
            </div>
          )}

          {/* List of top provinces */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              💡 Top 8 Tỉnh ({viewMode === "weight" ? "Xếp theo Tải trọng Tấn" : viewMode === "ontime" ? "Cảnh báo Ontime thấp trước" : viewMode === "damage" ? "Xếp theo Ca Bể Vỡ" : "Xếp theo Số đơn"})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {topProvinces.map((p) => {
                const isSelected = activeProv === p.name;
                const pDet = provinceDetailsMap[p.name] || p.details;
                const pOntime = pDet ? pDet.ontimePct : 100;
                const pColor = getOntimeColor(pOntime);
                const pWeight = pDet?.totalWeight || p.weight || 0;

                return (
                  <div
                    key={p.name}
                    onMouseEnter={() => setActiveProv(p.name)}
                    onMouseLeave={() => setActiveProv(null)}
                    onClick={() => setActiveProv(p.name)}
                    style={{
                      background: isSelected ? "rgba(20, 224, 196, 0.12)" : "var(--panel-bg)",
                      border: isSelected ? "1px solid var(--cyan)" : `1px solid ${pOntime < 80 ? "var(--red)" : pOntime < 90 ? "var(--amber)" : "var(--border)"}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5, color: pColor, display: "flex", alignItems: "center", gap: 4 }}>
                        {p.name}
                        {pOntime < 80 ? <span style={{ fontSize: 10 }}>🚨</span> : pOntime < 90 ? <span style={{ fontSize: 10 }}>⚠️</span> : null}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--cyan)", fontWeight: 700 }}>
                        {fmt(p.orders)} đơn ({pWeight >= 1000 ? (pWeight/1000).toFixed(1).replace(".0","") + " tấn" : pWeight + " kg"})
                      </span>
                    </div>
                    {p.topClient && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Top: {p.topClient.name} ({p.topClient.pct}%)
                        {pDet && ` · Ontime: ${pDet.ontimePct}%`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TabLTL({ data, selectedProjects = [] }) {
  const [damageFilter, setDamageFilter] = useState(null); // { type: 'type' | 'province' | 'warehouse', value: string }
  const theme = useTheme();

  if (!data) return <TruckLoader />;

  const singleProjectMode = selectedProjects.length === 1;

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

      <ProvinceMapPanel
        provinceStats={data.provinceStats}
        routeStats={data.routeStats}
        provinceDetailsMap={data.provinceDetailsMap || {}}
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
      />

      {/* 1. Xu hướng Ontime / Late theo tháng (FULL WIDTH 100%) */}
      <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Xu hướng Ontime / Late theo {data.isWeekly ? "tuần" : "tháng"}
        </div>
        <div style={{ height: 340 }}>
          <OntimeMonthChart ontimeByMonth={data.ontimeByMonth} isWeekly={data.isWeekly} theme={theme} />
        </div>
      </div>

      {/* 2. Tỷ trọng Số Đơn & Tải Trọng Tấn theo Dự Án (NẰM CHUNG HÀNG 2 CỘT 50/50) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            📦 Tỷ trọng Số Đơn theo Dự Án
          </div>
          <div style={{ height: 380 }}>
            <OrdersProjChart ordersByProject={data.ordersByProject} theme={theme} />
          </div>
        </div>

        <div className="chart-panel">
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"/></svg>
            ⚖️ Tỷ trọng Tải Trọng (Tấn/Kg) theo Dự Án
          </div>
          <div style={{ height: 380 }}>
            <WeightProjChart weightByProject={data.weightByProject || {}} theme={theme} />
          </div>
        </div>
      </div>

      {/* Ontime by project (full width for clear label spacing) */}
      <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          % Ontime theo Dự Án
        </div>
        <div style={{ height: 350 }}>
          <OntimeProjChart ontimeByProject={data.ontimeByProject} theme={theme} />
        </div>
      </div>

      {/* Warehouse risk (full width) */}
      <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          Top 10 Kho Rủi Ro Cao
        </div>
        <div style={{ height: 300 }}>
          <WarehouseRiskChart warehouseAlerts={data.warehouseAlerts} theme={theme} />
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
