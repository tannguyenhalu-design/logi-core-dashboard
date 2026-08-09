import React, { useRef } from "react";
import { useChart, CHART_THEME, COLORS } from "./chartUtils";

export default function OntimeMonthChart({ ontimeByMonth, isWeekly, theme = "dark" }) {
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
