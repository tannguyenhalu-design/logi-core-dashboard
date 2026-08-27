import React, { useRef } from "react";
import { useChart, CHART_THEME, COLORS } from "./chartUtils";

export default function OntimeMonthChart({ ontimeByMonth, isWeekly, month = null, theme = "dark" }) {
  const ref = useRef(null);
  const months = Object.keys(ontimeByMonth).sort((a, b) => a - b);
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

  // Week buckets are fixed day-of-month ranges (1-7/8-14/15-21/22-end), not
  // Mon-Sun calendar weeks — "Tuần 4" starts on the 22nd, so it can already
  // have (small, partial) data from day 1 of the month's last stretch. That
  // wasn't obvious from just the label "Tuần 4", which read as "hasn't
  // started yet" to someone expecting calendar weeks. Showing the actual
  // date range removes the ambiguity without needing a footnote to explain it.
  const daysInSelectedMonth = month ? new Date(new Date().getFullYear(), month, 0).getDate() : 31;
  const weekRangeLabel = (weekNum) => {
    if (!isWeekly || !month) return null;
    const start = (weekNum - 1) * 7 + 1;
    const end = weekNum < 4 ? weekNum * 7 : daysInSelectedMonth;
    return `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  };

  const totals = months.map((m) => (ontimeByMonth[m]?.ontime || 0) + (ontimeByMonth[m]?.late || 0));
  // null for the first bar (nothing to compare against) or when the prior
  // period had zero orders (a %, not a "new" flag, would be misleading).
  const deltaPctFor = (idx) => {
    if (idx === 0 || totals[idx - 1] <= 0) return null;
    return Math.round(((totals[idx] - totals[idx - 1]) / totals[idx - 1]) * 100);
  };

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: months.map((m, idx) => {
        const total = totals[idx];
        const shortTotal = total >= 1000 ? (total / 1000).toFixed(1).replace(".0", "") + "K" : total;
        const labelPrefix = isWeekly ? `Tuần ${m}` : `T${m}`;
        const rangeLabel = weekRangeLabel(Number(m));
        const deltaPct = deltaPctFor(idx);
        const totalLine = deltaPct === null
          ? `${shortTotal} đơn`
          : `${shortTotal} đơn (${deltaPct >= 0 ? "+" : ""}${deltaPct}%)`;
        return rangeLabel ? [labelPrefix, rangeLabel, totalLine] : [labelPrefix, totalLine];
      }),
      datasets: [
        {
          label: "Ontime",
          data: months.map((m) => ontimeByMonth[m]?.ontime || 0),
          backgroundColor: COLORS.green, stack: "s",
          maxBarThickness: 64,
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
          maxBarThickness: 64,
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 400,
            color: "#fff",
            font: { weight: "bold", size: 10 },
            formatter: (v) => v.toLocaleString("vi-VN"),
          }
        },
        {
          // Invisible dataset stacked on top, purely to anchor a
          // week/month-over-week order-count delta% badge right above each
          // bar — the most direct answer to "how much did volume change".
          label: "Δ đơn",
          data: months.map(() => 0),
          backgroundColor: "transparent",
          stack: "s",
          datalabels: {
            display: (ctx) => deltaPctFor(ctx.dataIndex) !== null,
            anchor: "end", align: "top", offset: 6,
            color: (ctx) => {
              const d = deltaPctFor(ctx.dataIndex);
              return d >= 0 ? COLORS.green : COLORS.red;
            },
            backgroundColor: ct.tooltipBg,
            borderColor: (ctx) => {
              const d = deltaPctFor(ctx.dataIndex);
              return d >= 0 ? COLORS.green : COLORS.red;
            },
            borderWidth: 1,
            borderRadius: 4,
            padding: { top: 2, bottom: 2, left: 5, right: 5 },
            font: { weight: "bold", size: 10 },
            formatter: (v, ctx) => {
              const d = deltaPctFor(ctx.dataIndex);
              return `${d >= 0 ? "▲+" : "▼"}${d}%`;
            },
          },
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
        legend: { position: "bottom", labels: { color: ct.muted, boxWidth: 12, filter: (item) => item.text !== "Δ đơn" } },
        tooltip: { filter: (item) => item.dataset.label !== "Δ đơn" },
        datalabels: { display: false }, // defaults to false, overridden in datasets
      },
    },
  }), [ontimeByMonth], theme);

  return <canvas ref={ref} />;
}
