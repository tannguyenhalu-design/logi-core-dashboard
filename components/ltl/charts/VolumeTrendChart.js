/**
 * components/ltl/charts/VolumeTrendChart.js — "Sản lượng & Chất lượng theo
 * tháng/tuần": dual-axis trend (user decision 2026-09-27) so volume growth
 * and service quality read side by side.
 *   bars  : số đơn (left axis) + tấn (lighter bars, 2nd left axis)
 *   lines : % on-time (right axis) + % hư hỏng (2nd right axis, own ~0–3%
 *           scale — on one axis with on-time it would sit flat at the bottom)
 * % hư hỏng = Rillnet cases by detection date / orders delivered by delivery
 * date, the company-report definition (damageTrend from /api/data).
 *
 * The running month/week is drawn lighter, marked "(đến dd/mm)" and compared
 * with the same days of the previous period (periodComparison), not with the
 * full period — the old chart once showed T9 "−28%" for a −5% period.
 */
import React, { useRef } from "react";
import { useChart, CHART_THEME, COLORS } from "./chartUtils";

const vnNow = () => new Date(Date.now() + 7 * 3600 * 1000);
const fmt = (v, d = 0) => v.toLocaleString("vi-VN", { maximumFractionDigits: d });

export default function VolumeTrendChart({ ordersByMonth = {}, weightByMonth = {}, ontimeByMonth = {}, damageTrend = {}, isWeekly, month = null, sameDayComparison = null, theme = "dark" }) {
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

  const orders = (k) => ordersByMonth[k] || 0;
  const tons = (k) => Math.round((weightByMonth[k] || 0) / 100) / 10;
  const ontime = (k) => {
    const o = ontimeByMonth[k] || { ontime: 0, late: 0 };
    const n = o.ontime + o.late;
    return n > 0 ? Math.round((o.ontime / n) * 1000) / 10 : null;
  };
  const damage = (k) => {
    const d = damageTrend[k];
    return d && d.gtc > 0 ? Math.round((d.cases / d.gtc) * 10000) / 100 : null;
  };

  const deltaFor = (i) => {
    const k = keys[i];
    if (running(k)) {
      if (isWeekly || !sameDayComparison) return null;
      const d = sameDayComparison.ordersDeltaPct;
      return d == null ? null : { d, label: "so cùng kỳ" };
    }
    if (i === 0) return null;
    const prev = orders(keys[i - 1]);
    if (!prev) return null;
    return { d: Math.round(((orders(k) - prev) / prev) * 100), label: isWeekly ? "so tuần trước" : "so tháng trước" };
  };

  const weekRange = (w) => {
    const days = new Date(Date.UTC(now.getUTCFullYear(), month, 0)).getUTCDate();
    const s = (w - 1) * 7 + 1, e = w < 4 ? w * 7 : days;
    return `${String(s).padStart(2, "0")}-${String(e).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  };
  const maxDamage = Math.max(0, ...keys.map((k) => damage(k) || 0));

  useChart(ref, () => ({
    type: "bar",
    data: {
      labels: keys.map((k, i) => {
        const name = isWeekly ? `Tuần ${k} (${weekRange(k)})` : `T${k}`;
        const head = running(k) ? `${name} · đến ${todayLabel}` : name;
        const dl = deltaFor(i);
        return [head, dl ? `${dl.d > 0 ? "+" : ""}${dl.d}% đơn ${dl.label}` : ""];
      }),
      datasets: [
        {
          label: "Số đơn",
          data: keys.map(orders),
          yAxisID: "y",
          backgroundColor: keys.map((k) => (running(k) ? `${ct.cyan}88` : ct.cyan)),
          borderColor: ct.cyan,
          borderWidth: keys.map((k) => (running(k) ? 1.5 : 0)),
          borderRadius: 6, maxBarThickness: 46, order: 3,
          datalabels: {
            display: true, anchor: "end", align: "top", offset: 2,
            color: ct.text, font: { weight: "bold", size: 11 }, formatter: (v) => fmt(v),
          },
        },
        {
          label: "Khối lượng (tấn)",
          data: keys.map(tons),
          yAxisID: "yT",
          backgroundColor: keys.map((k) => (running(k) ? `${ct.muted}33` : `${ct.muted}66`)),
          borderColor: ct.muted,
          borderWidth: keys.map((k) => (running(k) ? 1.5 : 0)),
          borderRadius: 6, maxBarThickness: 46, order: 4,
          datalabels: {
            display: true, anchor: "end", align: "top", offset: 2,
            color: ct.muted, font: { size: 10 }, formatter: (v) => `${fmt(v, 1)}t`,
          },
        },
        {
          label: "% On-time",
          type: "line",
          yAxisID: "y1",
          data: keys.map(ontime),
          borderColor: COLORS.green, backgroundColor: COLORS.green, borderWidth: 2,
          tension: 0.3, pointRadius: 4, order: 1,
          segment: { borderDash: (c) => (running(keys[c.p1DataIndex]) ? [5, 4] : undefined) },
          datalabels: {
            display: true, align: "top", offset: 4, color: COLORS.green,
            font: { weight: "bold", size: 10 }, formatter: (v) => (v == null ? "" : `${fmt(v, 1)}%`),
          },
        },
        {
          label: "% Hư hỏng (ca / đơn giao)",
          type: "line",
          yAxisID: "yD",
          data: keys.map(damage),
          borderColor: COLORS.red, backgroundColor: COLORS.red, borderWidth: 2,
          tension: 0.3, pointRadius: 4, pointStyle: "rectRot", order: 2,
          segment: { borderDash: (c) => (running(keys[c.p1DataIndex]) ? [5, 4] : undefined) },
          datalabels: {
            display: true, align: "bottom", offset: 4, color: COLORS.red,
            font: { weight: "bold", size: 10 }, formatter: (v) => (v == null ? "" : `${fmt(v, 2)}%`),
          },
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      interaction: { mode: "index", intersect: false },
      scales: {
        // Bars kept in the lower part so the lines (right axes) run above them.
        y: { position: "left", beginAtZero: true, suggestedMax: Math.max(...keys.map(orders), 1) * 1.6, grid: { color: ct.grid }, ticks: { color: ct.cyan }, title: { display: true, text: "Đơn", color: ct.cyan } },
        yT: { position: "left", beginAtZero: true, suggestedMax: Math.max(...keys.map(tons), 1) * 1.6, grid: { display: false }, ticks: { color: ct.muted }, title: { display: true, text: "Tấn", color: ct.muted } },
        y1: { position: "right", min: 0, max: 105, grid: { display: false }, ticks: { color: COLORS.green, callback: (v) => (v <= 100 ? `${v}%` : "") }, title: { display: true, text: "On-time", color: COLORS.green } },
        yD: { position: "right", min: 0, suggestedMax: Math.max(1, Math.ceil(maxDamage * 2.2 * 2) / 2), grid: { display: false }, ticks: { color: COLORS.red, callback: (v) => `${v}%` }, title: { display: true, text: "Hư hỏng", color: COLORS.red } },
        x: { grid: { display: false }, ticks: { color: ct.muted, maxRotation: 0, minRotation: 0 } },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: ct.muted, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const k = keys[item.dataIndex];
              if (item.dataset.yAxisID === "y") return ` Số đơn: ${fmt(orders(k))}`;
              if (item.dataset.yAxisID === "yT") return ` Khối lượng: ${fmt(tons(k), 1)} tấn`;
              if (item.dataset.yAxisID === "y1") {
                const o = ontimeByMonth[k] || { ontime: 0, late: 0 };
                return ` On-time: ${ontime(k) == null ? "—" : `${fmt(ontime(k), 1)}%`} (${fmt(o.late)} trễ / ${fmt(o.ontime + o.late)} đơn được tính)`;
              }
              const d = damageTrend[k] || { cases: 0, gtc: 0 };
              return ` Hư hỏng: ${damage(k) == null ? "—" : `${fmt(damage(k), 2)}%`} (${fmt(d.cases)} ca / ${fmt(d.gtc)} đơn giao)`;
            },
          },
        },
      },
    },
  }), [ordersByMonth, weightByMonth, ontimeByMonth, damageTrend, isWeekly, month, sameDayComparison], theme);

  return <canvas ref={ref} />;
}
