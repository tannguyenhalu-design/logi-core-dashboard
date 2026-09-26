/**
 * components/ltl/tables/ClientChangeTable.js — "Biến động theo khách (cùng
 * kỳ)" (2026-09-26). Replaces the ~20-card grid inside "So sánh cùng kỳ" and
 * the separate "khách mới" banner with one table that answers "khách nào
 * giảm/tăng, khối lượng ra sao".
 *
 * items: periodComparison.clients (or .warehouses when 1 project is selected)
 * — each { name, cur, prev, ordersDeltaPct, weightDeltaPct, ontimeDeltaPoints,
 * ordersIsNew, damageDeltaPct } with weight in kg.
 */
import { useState } from "react";

// "Đơn giảm nhưng KL giữ" flag (approved 2026-09-26): orders −30% or worse
// while kg per order at least doubled, on a client with >= 50 orders before —
// usually consolidated orders rather than lost volume. A prompt to check.
// (A first "weight fell < 15%" rule missed PSD Miền Nam: −82% orders,
// −16% weight, 28 → 128 kg/đơn — so the user switched to kg/đơn.)
const CONSOLIDATE_ORDERS_PCT = -30;
const CONSOLIDATE_KG_PER_ORDER_X = 2;
const CONSOLIDATE_MIN_ORDERS = 50;
const PAGE = 10;

const n = (v) => (v == null ? "—" : Number(v).toLocaleString("vi-VN"));
const tan = (kg) => (Number(kg) || 0) / 1000;
const fmtTan = (kg) => tan(kg).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
const kgPerOrder = (s) => (s?.orders > 0 ? Math.round((s.weight || 0) / s.orders) : null);

function Delta({ v, unit = "%", invert = false }) {
  if (v == null) return null;
  const good = invert ? v < 0 : v > 0;
  const color = v === 0 ? "var(--text-muted)" : good ? "var(--green)" : "var(--red)";
  return <span style={{ color, fontWeight: 700, fontSize: 11.5, marginLeft: 6, whiteSpace: "nowrap" }}>{v > 0 ? "+" : ""}{v.toLocaleString("vi-VN")}{unit}</span>;
}

export function consolidationFlag(c) {
  const before = kgPerOrder(c.prev), after = kgPerOrder(c.cur);
  return !c.ordersIsNew && (c.prev?.orders || 0) >= CONSOLIDATE_MIN_ORDERS
    && c.ordersDeltaPct != null && c.ordersDeltaPct <= CONSOLIDATE_ORDERS_PCT
    && before > 0 && after != null && after >= before * CONSOLIDATE_KG_PER_ORDER_X;
}

export default function ClientChangeTable({ items = [], groupLabel = "khách hàng" }) {
  const [tab, setTab] = useState("down");
  const [showAll, setShowAll] = useState(false);

  const change = (c) => (c.cur?.orders || 0) - (c.prev?.orders || 0);
  const groups = {
    down: items.filter((c) => !c.ordersIsNew && change(c) < 0).sort((a, b) => change(a) - change(b)),
    up: items.filter((c) => !c.ordersIsNew && change(c) > 0).sort((a, b) => change(b) - change(a)),
    new: items.filter((c) => c.ordersIsNew && (c.cur?.orders || 0) > 0).sort((a, b) => b.cur.orders - a.cur.orders),
    all: [...items].sort((a, b) => Math.abs(change(b)) - Math.abs(change(a))),
  };
  const tabs = [
    ["down", "📉 Giảm", "var(--red)"],
    ["up", "📈 Tăng", "var(--green)"],
    ["new", "🆕 Mới / quay lại", "var(--cyan)"],
    ["all", "Tất cả", "var(--text-secondary)"],
  ];
  const rows = groups[tab];
  const shown = showAll ? rows : rows.slice(0, PAGE);

  const th = { padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
  const td = { padding: "8px 10px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {tabs.map(([k, label, color]) => (
          <button key={k} onClick={() => { setTab(k); setShowAll(false); }} style={{
            fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
            border: `1px solid ${tab === k ? color : "var(--border)"}`, background: tab === k ? "var(--bg-panel)" : "transparent",
            color: tab === k ? color : "var(--text-muted)",
          }}>
            {label} <b>{groups[k].length}</b>
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>{groupLabel === "khách hàng" ? "Dự án" : "Kho giao"}</th>
              <th style={th}>Số đơn (trước → nay)</th>
              <th style={th}>Khối lượng, tấn</th>
              <th style={th}>kg / đơn</th>
              <th style={th}>On-time</th>
              <th style={th}>Hư hỏng</th>
              <th style={{ ...th, textAlign: "left" }}>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const flag = consolidationFlag(c);
              return (
                <tr key={c.name}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 600, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={c.name}>{c.name}</td>
                  <td style={td}>{n(c.prev?.orders)} → <b>{n(c.cur?.orders)}</b>{!c.ordersIsNew && <Delta v={c.ordersDeltaPct} />}</td>
                  <td style={td}>{fmtTan(c.prev?.weight)} → <b>{fmtTan(c.cur?.weight)}</b>{!c.weightIsNew && <Delta v={c.weightDeltaPct} />}</td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>{n(kgPerOrder(c.prev))} → {n(kgPerOrder(c.cur))}</td>
                  <td style={td}>{c.cur?.ontimePct != null ? `${c.cur.ontimePct}%` : "—"}<Delta v={c.ontimeDeltaPoints} unit=" đ" /></td>
                  <td style={td}>{(c.prev?.damageCount || c.cur?.damageCount) ? <>{n(c.prev?.damageCount)} → {n(c.cur?.damageCount)}</> : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ ...td, textAlign: "left", fontSize: 12 }}>
                    {c.ordersIsNew ? <span style={{ color: "var(--cyan)", fontWeight: 600 }}>🆕 Mới / có đơn trở lại</span>
                      : flag ? <span style={{ color: "var(--amber)", fontWeight: 600 }} title="Số đơn giảm ≥ 30% nhưng kg/đơn tăng ≥ 2 lần (khách ≥ 50 đơn kỳ trước) — thường là gộp đơn, nên hỏi lại PIC">🔎 Đơn giảm nhưng KL giữ — kiểm tra gộp đơn</span>
                      : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: 20 }}>Không có {groupLabel} nào trong nhóm này.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE && (
        <button onClick={() => setShowAll((v) => !v)} style={{
          marginTop: 8, fontSize: 12.5, fontWeight: 600, background: "none", border: "none", color: "var(--cyan)", cursor: "pointer", fontFamily: "inherit",
        }}>
          {showAll ? "Thu gọn ▲" : `Xem tất cả ${rows.length} ${groupLabel} ▼`}
        </button>
      )}
    </div>
  );
}
