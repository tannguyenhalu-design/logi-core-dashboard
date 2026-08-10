import React, { useRef } from "react";
import { useChart, CHART_THEME } from "./chartUtils";

export default function OrdersProjChart({ ordersByProject, theme = "dark" }) {
  const ref = useRef(null);
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

  const trunc = (s, max = 16) => s.length > max ? s.slice(0, max) + "…" : s;

  const sorted = Object.entries(ordersByProject).sort((a, b) => b[1] - a[1]);
  const TOP = 10;
  const top = sorted.slice(0, TOP);
  const rest = sorted.slice(TOP);
  const restTotal = rest.reduce((s, [, v]) => s + v, 0);
  const entries = restTotal > 0 ? [...top, [`Khác (${rest.length} dự án)`, restTotal]] : top;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const fullNames = entries.map(([p]) => p);

  const palette = [ct.cyan,"#8b5cf6","#10b981","#f59e0b","#f43f5e","#ec4899","#06b6d4","#84cc16","#a855f7","#0ea5e9","#64748b"];

  useChart(ref, () => ({
    type: "doughnut",
    data: {
      labels: entries.map(([p, v]) => {
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        return `${trunc(p)} ${v.toLocaleString("vi-VN")} đơn (${pct}%)`;
      }),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      plugins: {
        legend: {
          position: "right",
          align: "start",
          labels: {
            color: ct.legend,
            boxWidth: 9,
            boxHeight: 9,
            padding: 5,
            font: { size: 10.5, weight: "600" },
          },
        },
        tooltip: {
          backgroundColor: ct.tooltipBg,
          borderColor: ct.tooltipBorder,
          titleColor: ct.tooltipTitle,
          bodyColor: ct.tooltipBody,
          callbacks: {
            title: (items) => fullNames[items[0].dataIndex] || "",
            label: (item) => {
              const val = item.raw;
              const sum = item.dataset.data.reduce((a, b) => a + b, 0);
              const pct = sum > 0 ? Math.round((val / sum) * 100) : 0;
              return ` ${val.toLocaleString("vi-VN")} đơn (${pct}%)`;
            }
          }
        },
        datalabels: {
          display: (ctx) => {
            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return sum > 0 && ctx.dataset.data[ctx.dataIndex] / sum >= 0.04;
          },
          color: "#0f172a",
          font: { weight: "bold", size: 11 },
          formatter: (val, ctx) => {
            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = sum > 0 ? Math.round((val / sum) * 100) : 0;
            return `${pct}%`;
          },
        },
      },
    },
  }), [ordersByProject], theme);

  return <canvas ref={ref} />;
}
