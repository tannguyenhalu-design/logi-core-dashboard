/**
 * components/ltl/tables/ProjectPerformanceTable.js — "Hiệu suất dự án"
 * (2026-09-26). One sortable table replacing the two share donuts and the
 * rainbow "% Ontime theo Dự Án" bar chart. Default sort: most orders first
 * (user decision). Data: ltl.projectSummaries (weight in kg).
 */
import { useState } from "react";

const ONTIME_TARGET = 90;
const PAGE = 15;
const n = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d }));
const ontimeColor = (p) => (p == null ? "var(--text-muted)" : p >= 90 ? "var(--green)" : p >= 80 ? "var(--amber)" : "var(--red)");

function Bar({ pct, color, marker }) {
  return (
    <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--border)", minWidth: 80 }}>
      <div style={{ height: 8, borderRadius: 4, width: `${Math.max(0, Math.min(100, pct || 0))}%`, background: color }} />
      {marker != null && <div title={`Mục tiêu ${marker}%`} style={{ position: "absolute", left: `${marker}%`, top: -3, width: 2, height: 14, background: "var(--text-secondary)" }} />}
    </div>
  );
}

const FILTERS = [
  { key: "all",    label: "Tất cả" },
  { key: "low",    label: "⚠ On-time < 90%" },
  { key: "damage", label: "📦 Có ca bể vỡ" },
];

export default function ProjectPerformanceTable({ projectSummaries = {} }) {
  const [sort, setSort] = useState({ key: "orders", dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("all");

  const list = Object.values(projectSummaries);
  const totalOrders = list.reduce((s, p) => s + (p.totalOrders || 0), 0) || 1;
  const totalWeight = list.reduce((s, p) => s + (p.totalWeight || 0), 0) || 1;
  const rows = list.map((p) => ({
    name: p.name,
    orders: p.totalOrders || 0,
    orderShare: ((p.totalOrders || 0) / totalOrders) * 100,
    weight: (p.totalWeight || 0) / 1000,
    weightShare: ((p.totalWeight || 0) / totalWeight) * 100,
    ontime: p.evalCount > 0 ? (p.ontimeCount / p.evalCount) * 100 : null,
    evalCount: p.evalCount || 0,
    late: p.lateCount || 0,
    damage: p.damageCount || 0,
    per1000: p.totalOrders > 0 ? ((p.damageCount || 0) / p.totalOrders) * 1000 : null,
  }));

  const filtered = rows.filter((r) => {
    if (filter === "low") return r.ontime != null && r.ontime < ONTIME_TARGET;
    if (filter === "damage") return r.damage > 0;
    return true;
  });
  filtered.sort((a, b) => {
    const va = a[sort.key] ?? -1, vb = b[sort.key] ?? -1;
    return typeof va === "string" ? va.localeCompare(vb) * sort.dir : (va - vb) * sort.dir;
  });
  const shown = showAll ? filtered : filtered.slice(0, PAGE);

  const chip = (f) => ({
    fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${filter === f.key ? "var(--cyan)" : "var(--border)"}`,
    background: filter === f.key ? "rgba(var(--brand-rgb),0.14)" : "transparent",
    color: filter === f.key ? "var(--cyan)" : "var(--text-muted)",
    fontWeight: filter === f.key ? 700 : 400,
  });

  const head = (key, label, align = "right") => {
    const active = sort.key === key;
    return (
      <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === "name" ? 1 : -1 }))} style={{
        padding: "8px 10px", fontSize: 11.5, fontWeight: 700,
        color: active ? "var(--cyan)" : "var(--text-secondary)",
        textAlign: align, whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
        borderBottom: "1px solid var(--border)",
      }}>
        {label} {active ? (sort.dir < 0 ? "▼" : "▲") : <span style={{ opacity: 0.35 }}>↕</span>}
      </th>
    );
  };
  const td = { padding: "7px 10px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };

  return (
    <div className="chart-panel" style={{ width: "100%" }}>
      <div className="chart-panel-title" style={{ flexWrap: "wrap", gap: 8 }}>
        <span>🏷️ Hiệu suất dự án</span>
        <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
          Bấm tiêu đề cột để sắp xếp · vạch đứng = mục tiêu on-time {ONTIME_TARGET}% · ≥ 90% xanh, 80–90% vàng, &lt; 80% đỏ
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "0 8px 10px", flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button key={f.key} style={chip(f)} onClick={() => { setFilter(f.key); setShowAll(false); }}>{f.label}</button>
        ))}
        {filter !== "all" && (
          <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center", marginLeft: 4 }}>
            {filtered.length} / {rows.length} dự án
          </span>
        )}
      </div>
      <div style={{ overflowX: "auto", padding: "0 8px 8px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {head("name", "Dự án", "left")}
              {head("orders", "Số đơn")}
              {head("orderShare", "Tỷ trọng đơn")}
              {head("weight", "Khối lượng (tấn)")}
              {head("weightShare", "Tỷ trọng KL")}
              {head("ontime", "On-time")}
              {head("late", "Late")}
              {head("damage", "Ca hỏng")}
              {head("per1000", "% Bể vỡ")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.name}>
                <td style={{ ...td, textAlign: "left", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</td>
                <td style={td}>{n(r.orders)}</td>
                <td style={{ ...td, minWidth: 130 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Bar pct={r.orderShare} color="var(--cyan)" /><span style={{ width: 42 }}>{n(r.orderShare, 1)}%</span></div>
                </td>
                <td style={td}>{n(r.weight, 1)}</td>
                <td style={{ ...td, minWidth: 130 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Bar pct={r.weightShare} color="var(--purple)" /><span style={{ width: 42 }}>{n(r.weightShare, 1)}%</span></div>
                </td>
                <td style={{ ...td, minWidth: 150 }} title={`${n(r.evalCount)} đơn đã đánh giá`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Bar pct={r.ontime} color={ontimeColor(r.ontime)} marker={ONTIME_TARGET} />
                    <span style={{ width: 46, fontWeight: 700, color: ontimeColor(r.ontime) }}>{r.ontime == null ? "—" : `${n(r.ontime, 1)}%`}</span>
                  </div>
                </td>
                <td style={td}>{n(r.late)}</td>
                <td style={td}>{r.damage ? n(r.damage) : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                <td style={td} title="% bể vỡ = ca bể vỡ ÷ đơn lấy (như báo cáo công ty)">{r.damage ? `${(r.per1000 / 10).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: "16px 10px" }}>Không có dự án nào phù hợp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > PAGE && (
          <button onClick={() => setShowAll((v) => !v)} style={{
            marginTop: 8, fontSize: 12.5, fontWeight: 600, background: "none", border: "none", color: "var(--cyan)", cursor: "pointer", fontFamily: "inherit",
          }}>
            {showAll ? "Thu gọn ▲" : `Xem tất cả ${filtered.length} dự án ▼`}
          </button>
        )}
      </div>
    </div>
  );
}
