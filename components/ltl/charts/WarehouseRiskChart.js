import React, { useRef } from "react";
import { useChart, CHART_THEME, COLORS } from "./chartUtils";

export default function WarehouseRiskChart({ warehouseAlerts, selectedWarehouse, onSelectWarehouse, theme = "dark" }) {
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
          backgroundColor: warehouseAlerts.map((w) =>
            w.warehouse === selectedWarehouse ? COLORS.red : COLORS.amber
          ),
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
      onClick: (evt, elements) => {
        if (!onSelectWarehouse || elements.length === 0) return;
        const wh = warehouseAlerts[elements[0].index]?.warehouse;
        if (wh) onSelectWarehouse(wh === selectedWarehouse ? null : wh);
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length > 0 ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { grid: { color: ct.grid }, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  }), [warehouseAlerts, selectedWarehouse], theme);

  return <canvas ref={ref} />;
}
