import React, { useRef } from "react";
import { useChart, CHART_THEME, COLORS } from "./chartUtils";

export default function OntimeProjChart({ ontimeByProject, theme = "dark" }) {
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
          [ct.cyan, COLORS.green, COLORS.purple, COLORS.amber, COLORS.red][i % 5]
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
          align: "start",
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
