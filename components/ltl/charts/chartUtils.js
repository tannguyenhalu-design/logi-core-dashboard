import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";

export const CHART_THEME = {
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

export const COLORS = {
  cyan: "#14e0c4", green: "#10b981", red: "#f43f5e",
  amber: "#f59e0b", purple: "#8b5cf6",
};

export function currentTheme() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") || "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme());
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function useChart(canvasRef, config, deps, theme = "dark") {
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
