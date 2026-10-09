/**
 * components/ltl/TrendPanel.js
 * PHẦN 3: "Xu hướng 4 tuần & Truy vết sụt giảm" — three weekly line charts
 * (SLA ontime %, bể vỡ %, hàng hoàn %) + province Critical Decline table.
 * Fetches from /api/data/trend; respects the existing projects/origin filter.
 */
import { useEffect, useRef, useState } from "react";
import { useChart, useTheme, CHART_THEME, COLORS } from "./charts/chartUtils";
import { fmt } from "./utils";

const AMBER  = "#f59e0b";
const GREEN  = "#10b981";
const CORAL  = "#f43f5e";
const PURPLE = "#8b5cf6";

function buildLineConfig(labels, values, color, yLabel, incompleteIdx, t) {
  const borderDash = values.map((_, i) => (i >= incompleteIdx && incompleteIdx >= 0 ? [5, 4] : []));
  return {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: yLabel,
        data: values,
        borderColor: color,
        backgroundColor: color + "22",
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: values.map((v, i) => (i >= incompleteIdx && incompleteIdx >= 0 ? t.tooltipBg : color)),
        tension: 0.25,
        segment: {
          borderDash: (ctx) => (ctx.p1DataIndex >= incompleteIdx && incompleteIdx >= 0 ? [5, 4] : []),
        },
        fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end", align: "top",
          color: color, font: { size: 11, weight: "600" },
          formatter: (v) => v == null ? "" : `${v}%`,
          display: true,
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y == null ? "N/A" : ctx.parsed.y + "%"}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: t.muted, font: { size: 11 } },
          grid: { color: t.grid },
        },
        y: {
          beginAtZero: true, max: 100,
          ticks: { color: t.muted, font: { size: 11 }, callback: (v) => v + "%" },
          grid: { color: t.grid },
          title: { display: false },
        },
      },
    },
  };
}

function buildSmallLineConfig(labels, values, color, yLabel, incompleteIdx, t) {
  return {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: yLabel,
        data: values,
        borderColor: color,
        backgroundColor: color + "18",
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.25,
        fill: true,
        segment: {
          borderDash: (ctx) => (ctx.p1DataIndex >= incompleteIdx && incompleteIdx >= 0 ? [5, 4] : []),
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end", align: "top",
          color, font: { size: 11, weight: "600" },
          formatter: (v) => v == null ? "" : `${v}%`,
          display: true,
        },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.parsed.y == null ? "N/A" : ctx.parsed.y + "%"}` },
        },
      },
      scales: {
        x: { ticks: { color: t.muted, font: { size: 11 } }, grid: { color: t.grid } },
        y: {
          beginAtZero: true,
          ticks: { color: t.muted, font: { size: 10 }, callback: (v) => v + "%" },
          grid: { color: t.grid },
        },
      },
    },
  };
}

function SlaChart({ weeks, theme }) {
  const ref = useRef(null);
  const t = CHART_THEME[theme] || CHART_THEME.dark;
  const labels = weeks.map((w) => w.label + (w.mature ? "" : " ⏳"));
  const values = weeks.map((w) => w.ontimePct);
  const incompleteIdx = weeks.findIndex((w) => !w.mature);
  useChart(ref, () => buildLineConfig(labels, values, GREEN, "SLA %", incompleteIdx, t), [JSON.stringify(weeks)], theme);
  return <div style={{ position: "relative", height: 180, width: "100%" }}><canvas ref={ref} /></div>;
}

function DamageChart({ weeks, theme }) {
  const ref = useRef(null);
  const t = CHART_THEME[theme] || CHART_THEME.dark;
  const labels = weeks.map((w) => w.label + (w.mature ? "" : " ⏳"));
  const values = weeks.map((w) => w.damagePct);
  const incompleteIdx = weeks.findIndex((w) => !w.mature);
  useChart(ref, () => buildSmallLineConfig(labels, values, AMBER, "Bể vỡ %", incompleteIdx, t), [JSON.stringify(weeks)], theme);
  return <div style={{ position: "relative", height: 180, width: "100%" }}><canvas ref={ref} /></div>;
}

function FdChart({ weeks, theme }) {
  const ref = useRef(null);
  const t = CHART_THEME[theme] || CHART_THEME.dark;
  const labels = weeks.map((w) => w.label + (w.mature ? "" : " ⏳"));
  const values = weeks.map((w) => w.fdPct);
  const incompleteIdx = weeks.findIndex((w) => !w.mature);
  useChart(ref, () => buildSmallLineConfig(labels, values, CORAL, "Hoàn %", incompleteIdx, t), [JSON.stringify(weeks)], theme);
  return <div style={{ position: "relative", height: 180, width: "100%" }}><canvas ref={ref} /></div>;
}

function DeclineTable({ declines, curLabel, prevLabel }) {
  if (!declines?.length) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "16px 0" }}>
        Không có tỉnh nào sụt giảm SLA đáng kể — cần ít nhất 5 đơn đánh giá mỗi tuần.
      </div>
    );
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700, color: "var(--text-muted)", fontSize: 11 }}>TỈNH</th>
          <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, color: "var(--text-muted)", fontSize: 11 }}>{prevLabel || "Tuần trước"}</th>
          <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, color: "var(--text-muted)", fontSize: 11 }}>{curLabel || "Tuần này"}</th>
          <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, color: "var(--text-muted)", fontSize: 11 }}>Δ</th>
          <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, color: "var(--text-muted)", fontSize: 11 }}>MẪU</th>
        </tr>
      </thead>
      <tbody>
        {declines.map((d, i) => (
          <tr key={d.name} style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "var(--bg-panel)" : "transparent" }}>
            <td style={{ padding: "7px 8px", fontWeight: 600, color: "var(--text-primary)" }}>{d.name}</td>
            <td style={{ padding: "7px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{d.prevPct}%</td>
            <td style={{ padding: "7px 8px", textAlign: "right", color: "var(--red)", fontWeight: 600 }}>{d.curPct}%</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: "var(--red)" }}>▼ {Math.abs(d.delta)} đ</td>
            <td style={{ padding: "7px 8px", textAlign: "right", color: "var(--text-muted)" }}>{fmt(d.curN)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function TrendPanel({ selectedProjects = [], selectedOrigin = null }) {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("trend_panel_collapsed") === "1"; } catch { return false; }
  });

  const projectsKey = [...selectedProjects].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (selectedProjects.length) params.set("projects", selectedProjects.join(","));
    if (selectedOrigin) params.set("origin", selectedOrigin);
    fetch(`/api/data/trend?${params}`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) {
          if (body.ok) setData(body);
          else setError(body.error || "Lỗi tải dữ liệu xu hướng");
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) { setError("Lỗi kết nối"); setLoading(false); }
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsKey, selectedOrigin]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("trend_panel_collapsed", next ? "1" : "0"); } catch {}
  };

  const panelStyle = {
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "14px 18px",
    marginTop: 16,
  };

  const heading = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    cursor: "pointer", userSelect: "none",
  };

  const weeks = data?.weeks || [];
  // Labels for the decline tracker come from the first decline item (server sets them)
  // or fall back to the last two weeks in the list.
  const declineItems = data?.provinceDeclines || [];
  const declineCurLabel = declineItems[0]?.curLabel ?? weeks[weeks.length - 1]?.label;
  const declinePrevLabel = declineItems[0]?.prevLabel ?? weeks[weeks.length - 2]?.label;
  const declineCurMature = data?.declineCurMature ?? true;

  return (
    <div style={panelStyle}>
      <div style={heading} onClick={toggle} role="button" aria-expanded={!collapsed}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Xu hướng 4 tuần &amp; Truy vết sụt giảm
          </span>
          {weeks.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 10 }}>
              {weeks[0]?.label}–{weeks[weeks.length - 1]?.label}
              {weeks.some((w) => !w.mature) && " · ⏳ tuần hiện tại chưa đủ dữ liệu"}
            </span>
          )}
        </div>
        <span style={{ fontSize: 18, color: "var(--text-muted)", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.2s" }}>▾</span>
      </div>

      {!collapsed && (
        <>
          {loading && (
            <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
              {[1,2,3].map((k) => (
                <div key={k} className="skeleton" style={{ flex: 1, height: 210, borderRadius: 10 }} />
              ))}
            </div>
          )}
          {error && <div style={{ color: "var(--red)", marginTop: 12, fontSize: 13 }}>{error}</div>}
          {!loading && !error && weeks.length === 0 && (
            <div style={{ color: "var(--text-muted)", marginTop: 12, fontSize: 13 }}>Không có dữ liệu tuần.</div>
          )}
          {!loading && !error && weeks.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 16 }}>
                <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>SLA Ontime %</div>
                  <SlaChart weeks={weeks} theme={theme} />
                </div>
                <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>Tỷ lệ Bể Vỡ %</div>
                  <DamageChart weeks={weeks} theme={theme} />
                </div>
                <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>Tỷ lệ Hàng Hoàn %</div>
                  <FdChart weeks={weeks} theme={theme} />
                </div>
              </div>

              {data?.provinceDeclines !== undefined && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Top tỉnh SLA sụt giảm
                    </span>
                    {declinePrevLabel && declineCurLabel && (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        ({declinePrevLabel} → {declineCurLabel}
                        {!declineCurMature && " ⏳"})
                      </span>
                    )}
                    {!declineCurMature && (
                      <span style={{ fontSize: 11, color: "var(--amber)", marginLeft: 4 }}>tuần hiện tại chưa hoàn thành</span>
                    )}
                  </div>
                  <DeclineTable
                    declines={data.provinceDeclines}
                    curLabel={declineCurLabel}
                    prevLabel={declinePrevLabel}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
