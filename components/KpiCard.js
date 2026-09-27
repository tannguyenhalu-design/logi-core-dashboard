/**
 * components/KpiCard.js — flat KPI card with an optional delta vs "kỳ trước"
 * and an optional 7-day sparkline.
 *
 * delta: { text, tone: "good" | "bad" | "flat" } | null
 * compare: short label of what the delta is measured against
 * spark: { points: [{ label, value }], incompleteFrom?: index, format?: fn } | null
 *        points from incompleteFrom on are drawn dashed (data not final yet)
 *
 * When `value` changes the number counts up/down to the new one (~600ms,
 * user decision 2026-09-27); skipped on first render and when the user asks
 * for reduced motion. The last frame is always the exact `value` string.
 */
import { useEffect, useRef, useState } from "react";

const COUNT_MS = 600;
// "12.345" · "91,4%" · "1.234,5" (vi-VN) → { pre, num, decimals, post }
function parseVi(v) {
  const m = typeof v === "string" ? v.match(/^([^\d-]*)(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?)(.*)$/) : null;
  if (!m) return null;
  const dec = m[2].includes(",") ? m[2].split(",")[1].length : 0;
  return { pre: m[1], num: Number(m[2].replace(/\./g, "").replace(",", ".")), decimals: dec, post: m[3] };
}
function useCountUp(value) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = parseVi(prev.current), to = parseVi(value);
    prev.current = value;
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!from || !to || from.num === to.num || reduce || from.post !== to.post) { setShown(value); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / COUNT_MS);
      const e = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { setShown(value); return; }
      const n = from.num + (to.num - from.num) * e;
      setShown(`${to.pre}${n.toLocaleString("vi-VN", { minimumFractionDigits: to.decimals, maximumFractionDigits: to.decimals })}${to.post}`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}
function Sparkline({ points, incompleteFrom, format = (v) => v }) {
  const vals = points.map((p) => p.value);
  const known = vals.filter((v) => v != null);
  if (known.length < 2) return null;
  const W = 120, H = 28, pad = 3;
  const min = Math.min(...known), max = Math.max(...known);
  const span = max - min || 1;
  const xy = vals.map((v, i) => (v == null ? null : [
    pad + (i * (W - 2 * pad)) / (vals.length - 1),
    H - pad - ((v - min) / span) * (H - 2 * pad),
  ]));
  const path = (from, to) => xy.slice(from, to + 1).filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const cut = incompleteFrom != null && incompleteFrom > 0 ? incompleteFrom : vals.length;
  const last = [...xy].reverse().find(Boolean);
  const title = points.map((p) => `${p.label}: ${p.value == null ? "—" : format(p.value)}`).join("\n");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block", marginTop: 6 }} aria-label="Xu hướng 7 ngày">
      <title>{`Xu hướng 7 ngày lấy hàng gần nhất\n${title}${cut < vals.length ? "\n(nét đứt: đơn chưa giao xong, số chưa chốt)" : ""}`}</title>
      <path d={path(0, cut - 1)} fill="none" stroke="var(--cyan)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      {cut < vals.length && (
        <path d={path(cut - 1, vals.length - 1)} fill="none" stroke="var(--cyan)" strokeWidth="1.8" strokeDasharray="3 3" opacity="0.7" vectorEffect="non-scaling-stroke" />
      )}
      {last && <circle cx={last[0]} cy={last[1]} r="2.2" fill="var(--cyan)" />}
    </svg>
  );
}

export default function KpiCard({ label, value, valueClass = "", sub, delta, compare, accent = false, spark = null }) {
  const shown = useCountUp(value);
  return (
    <div className={`kpi-card${accent ? " accent" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass}`}>{shown}</div>
      <div className="kpi-delta-row">
        {delta && <span className={`kpi-delta ${delta.tone}`}>{delta.text}</span>}
        {compare && <span className="kpi-compare" title={compare}>{compare}</span>}
      </div>
      {sub && <div className="kpi-sub" title={typeof sub === "string" ? sub : undefined}>{sub}</div>}
      {spark && <Sparkline {...spark} />}
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="kpi-card">
      <div className="skeleton" style={{ height: 12, width: "45%" }} />
      <div className="skeleton" style={{ height: 30, width: "60%", marginTop: 4 }} />
      <div className="skeleton" style={{ height: 14, width: "75%" }} />
    </div>
  );
}
