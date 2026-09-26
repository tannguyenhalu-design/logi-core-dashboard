import React, { useRef } from "react";
import { useChart, CHART_THEME } from "../ltl/charts/chartUtils";

// Real GHN sizes get a fixed, ordered palette (small→large reads light→dark);
// "(chưa rõ)" (chưa gán xe) always renders last in flat grey so it never
// competes visually with a real, plannable size.
const TYPE_PALETTE = ["#38bdf8", "#14e0c4", "#10b981", "#f59e0b", "#f97316", "#f43f5e", "#a855f7", "#8b5cf6", "#ec4899"];
const UNKNOWN_COLOR = "#64748b";

// Stacked bar, 1 cột/ngày, 1 màu/loại xe — trả lời trực tiếp "ngày nào cần
// chuẩn bị bao nhiêu xe, loại gì" thay vì phải tự cộng từ bảng số.
export default function DailyVehicleTypeChart({ dailyBreakdown, vehicleTypes, theme = "dark" }) {
  const ref = useRef(null);
  const ct = CHART_THEME[theme] || CHART_THEME.dark;

  const days = [...(dailyBreakdown || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const colorFor = (type, idx) => (type === "(chưa rõ)" ? UNKNOWN_COLOR : TYPE_PALETTE[idx % TYPE_PALETTE.length]);

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: days.map((d) => `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`),
      datasets: (vehicleTypes || []).map((v, idx) => ({
        label: v,
        data: days.map((d) => d.byType?.[v] || 0),
        backgroundColor: colorFor(v, idx),
        stack: "s",
        maxBarThickness: 36,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { stacked: true, grid: { color: ct.grid }, ticks: { precision: 0 } },
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, minRotation: 0, autoSkip: true, maxTicksLimit: 20 } },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: ct.legend, boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder,
          titleColor: ct.tooltipTitle, bodyColor: ct.tooltipBody,
          callbacks: {
            afterBody: (items) => {
              const total = items.reduce((s, it) => s + (it.raw || 0), 0);
              return `Tổng: ${total} xe`;
            },
          },
        },
        datalabels: { display: false },
      },
    },
  }), [JSON.stringify(days), JSON.stringify(vehicleTypes)], theme);

  if (days.length === 0) return null;
  return <canvas ref={ref} />;
}
