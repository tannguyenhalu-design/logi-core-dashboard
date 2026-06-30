/**
 * components/KpiCard.js — Reusable KPI card
 */
export default function KpiCard({ icon, label, value, sub, colorClass = "text-cyan" }) {
  return (
    <div className="kpi-card">
      <div className={`kpi-icon ${colorClass.replace("text-", "bg-")}`}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div className="kpi-label">{label}</div>
        <div className={`kpi-value ${colorClass}`}>{value}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}
