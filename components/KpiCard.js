/**
 * components/KpiCard.js — flat KPI card with an optional delta vs "kỳ trước".
 *
 * delta: { text, tone: "good" | "bad" | "flat" } | null
 * compare: short label of what the delta is measured against
 */
export default function KpiCard({ label, value, valueClass = "", sub, delta, compare, accent = false }) {
  return (
    <div className={`kpi-card${accent ? " accent" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass}`}>{value}</div>
      <div className="kpi-delta-row">
        {delta && <span className={`kpi-delta ${delta.tone}`}>{delta.text}</span>}
        {compare && <span className="kpi-compare" title={compare}>{compare}</span>}
      </div>
      {sub && <div className="kpi-sub" title={typeof sub === "string" ? sub : undefined}>{sub}</div>}
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
