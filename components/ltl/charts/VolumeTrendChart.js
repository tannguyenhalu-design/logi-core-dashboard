/**
 * components/ltl/charts/VolumeTrendChart.js — "Sản lượng theo tháng/tuần"
 * (replaces the Ontime/Late stack, 2026-09-26). Bars = real order count
 * (or weight), line = % on-time.
 *
 * The old chart labelled each bar with ontime+late (evaluated orders, not all
 * orders) and compared the running month with a FULL previous month — which
 * showed T9 as "−28%" when same-period orders were −5% and weight +7%.
 * Here the running month/week is marked "(đến dd/mm)" and compared with the
 * same days of the previous period (periodComparison), not the full period.
 */
import React, { useRef } from "react";
import { useChart, CHART_THEME, COLORS } from "./chartUtils";

const vnNow = () => new Date(Date.now() + 7 * 3600 * 1000);

export default function VolumeTrendChart({ metric = "orders", ordersByMonth = {}, weightByMonth = {}, ontimeByMonth = {}, isWeekly, month = null, sameDayComparison = null, theme = "dark" }) {
  const ref = useRef(null);
  const ct = CHART_THEME[theme] || CHART_THEME.dark;
  const keys = Object.keys(ordersByMonth).map(Number).sort((a, b) => a - b);

  const now = vnNow();
  const curMonth = now.getUTCMonth() + 1;
  const today = now.getUTCDate();
  const todayLabel = `${String(today).padStart(2, "0")}/${String(curMonth).padStart(2, "0")}`;
  // Is bucket k still running?
  const running = (k) => (isWeekly
    ? month === curMonth && k === Math.min(4, Math.ceil(today / 7))
    : k === curMonth);

  const value = (k) => (metric === "weight" ? Math.round((weightByMonth[k] || 0) / 100) / 10 : ordersByMonth[k] || 0);
  const unit = metric === "weight" ? "tấn" : "đơn";
  const fmtV = (v) => `${v.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} ${unit}`;

  const deltaFor = (i) => {
    const k = keys[i];
    if (running(k)) {
      if (isWeekly || !sameDayComparison) return null;
      const d = metric === "weight" ? sameDayComparison.weightDeltaPct : sameDayComparison.ordersDeltaPct;
      return d == null ? null : { d, label: "so cùng kỳ" };
    }
    if (i === 0) return null;
    const prev = value(keys[i - 1]);
    if (!prev) return null;
    return { d: Math.round(((value(k) - prev) / prev) * 100), label: isWeekly ? "so tuần trước" : "so tháng trước" };
  };

  const weekRange = (w) => {
    const days = new Date(Date.UTC(now.getUTCFullYear(), month, 0)).getUTCDate();
    const s = (w - 1) * 7 + 1, e = w < 4 ? w * 7 : days;
    return `${String(s).padStart(2, "0")}-${String(e).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  };

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: keys.map((k, i) => {
        const name = isWeekly ? `Tuần ${k} (${weekRange(k)})` : `T${k}`;
        const head = running(k) ? `${name} · đến ${todayLabel}` : name;
        const dl = deltaFor(i);
        const line2 = `${fmtV(value(k))}${dl ? ` · ${dl.d > 0 ? "+" : ""}${dl.d}% ${dl.label}` : ""}`;
        return [head, line2];
      }),
      datasets: [
        {
          label: metric === "weight" ? "Khối lượng (tấn)" : "Số đơn",
          data: keys.map(value),
          backgroundColor: keys.map((k) => (running(k) ? `${ct.cyan}88` : ct.cyan)),
          borderColor: ct.cyan,
          borderWidth: keys.map((k) => (running(k) ? 1.5 : 0)),
          borderRadius: 6,
          maxBarThickness: 72,
          datalabels: {
            display: true, anchor: "end", align: "top", offset: 2,
            color: ct.text, font: { weight: "bold", size: 11 },
            formatter: (v) => v.toLocaleString("vi-VN", { maximumFractionDigits: 1 }),
          },
        },
        {
          label: "% On-time",
          type: "line",
          yAxisID: "y1",
          data: keys.map((k) => {
            const o = ontimeByMonth[k] || { ontime: 0, late: 0 };
            const n = o.ontime + o.late;
            return n > 0 ? Math.round((o.ontime / n) * 1000) / 10 : null;
          }),
          borderColor: COLORS.green, backgroundColor: COLORS.green, borderWidth: 2,
          tension: 0.3, pointRadius: 4,
          segment: { borderDash: (c) => (running(keys[c.p1DataIndex]) ? [5, 4] : undefined) },
          datalabels: {
            display: true, align: "top", offset: 4, color: COLORS.green,
            font: { weight: "bold", size: 10 }, formatter: (v) => (v == null ? "" : `${v}%`),
          },
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      scales: {
        // Headroom above the bars so the on-time line (right axis, ~90%)
        // runs above the bar value labels instead of through them.
        y: { beginAtZero: true, suggestedMax: Math.max(...keys.map(value), 1) * 1.45, grid: { color: ct.grid }, ticks: { color: ct.muted } },
        y1: { position: "right", min: 0, max: 105, grid: { display: false }, ticks: { color: ct.muted, callback: (v) => (v <= 100 ? `${v}%` : "") } },
        x: { grid: { display: false }, ticks: { color: ct.muted, maxRotation: 0, minRotation: 0 } },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: ct.muted, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const k = keys[items[0].dataIndex];
              const o = ontimeByMonth[k] || { ontime: 0, late: 0 };
              return [`Đã đánh giá: ${(o.ontime + o.late).toLocaleString("vi-VN")} · Late: ${o.late.toLocaleString("vi-VN")}`];
            },
          },
        },
      },
    },
  }), [metric, ordersByMonth, weightByMonth, ontimeByMonth, isWeekly, month, sameDayComparison], theme);

  return <canvas ref={ref} />;
}
