/**
 * components/ltl/cards/ExceptionsPanel.js — "Cần can thiệp ngay hôm nay"
 * (user decision 2026-09-27): at most 3 issues from lib/exceptions.js, ranked
 * by affected orders, each with the numbers behind it and the orders to
 * chase — so the manager sees who to call without hunting for risks.
 */
import React, { useState } from "react";

const KIND = {
  route: { icon: "🚚", label: "Tuyến trễ SLA", color: "var(--red)" },
  damage: { icon: "📦", label: "Bể vỡ tăng đột biến", color: "var(--amber)" },
  ontime: { icon: "📉", label: "On-time giảm mạnh", color: "var(--red)" },
};
const NL = String.fromCharCode(10);
const shortWh = (s) => String(s || "")
  .replace(/^Kho Giao Hàng Nặng - /, "")
  .replace(/^Key Account Warehouse /, "KA WH ")
  .replace(/^Kho B2B - /, "B2B ")
  .trim()
  .replace(/^KA WH Ho Chi Minh$/i, "KA-HCM")
  .replace(/^KA WH H[aà] N[oộ]i?$/i, "KA-HN")
  .replace(/^KA WH [ĐD][aà] N[aẵ]ng?$/i, "KA-ĐN");

export default function ExceptionsPanel({ exceptions, onFilterProject }) {
  const [open, setOpen] = useState(null);
  const [copied, setCopied] = useState(null);
  if (!exceptions) return null;
  const items = exceptions.items || [];
  const btn = { fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)" };
  const copy = (i, orders) => {
    try { navigator.clipboard.writeText(orders.map((o) => o.order_code).join(NL)); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* no clipboard */ }
  };
  const rulesText = exceptions.rules ? `Luật: tuyến ${exceptions.rules.route} · bể vỡ ${exceptions.rules.damage} · ${exceptions.rules.ontime}.` : "";

  return (
    <div className="exceptions-panel">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Cần can thiệp ngay hôm nay</span>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }} title={rulesText}>
          {items.length ? `${items.length} việc nóng nhất${exceptions.candidates > items.length ? ` / ${exceptions.candidates} việc phát hiện` : ""} · xếp theo số đơn bị ảnh hưởng` : ""} ⓘ
        </span>
      </div>
      {!items.length ? (
        <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderLeft: "3px solid var(--green)", borderRadius: 10, padding: "12px 14px", fontSize: 13 }}>
          <b style={{ color: "var(--green)" }}>✓ Hôm nay chưa có việc cần can thiệp.</b>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{rulesText}</div>
        </div>
      ) : (
        <div className="grid-3" style={{ alignItems: "start" }}>
          {items.map((it, i) => {
            const k = KIND[it.type] || KIND.route;
            const isOpen = open === i;
            return (
              <div key={i} className="exception-card" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderLeft: `3px solid ${k.color}`, borderRadius: 10, padding: "12px 14px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: k.color, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  <span aria-hidden>{k.icon}</span>{k.label}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "none" }}>#{i + 1}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.35 }}>{it.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>{it.why}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>→ {it.action}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                  {it.orders && it.orders.length > 0 && (
                    <button style={btn} onClick={() => setOpen(isOpen ? null : i)}>{isOpen ? "Ẩn danh sách" : `Xem ${it.orders.length < it.affected ? `${it.orders.length}/${it.affected}` : it.orders.length} ${it.type === "damage" ? "ca" : "đơn"}${it.orders.length < it.affected ? " (lâu nhất)" : ""}`}</button>
                  )}
                  {it.orders && it.orders.length > 0 && <button style={btn} onClick={() => copy(i, it.orders)}>{copied === i ? "✓ Đã copy" : "📋 Copy mã"}</button>}
                  {it.type === "ontime" && onFilterProject && <button style={btn} onClick={() => onFilterProject([it.project])}>Lọc dự án này</button>}
                </div>
                {isOpen && (
                  <div style={{ maxHeight: 220, overflow: "auto", marginTop: 4, borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
                    <table className="data-table" style={{ fontSize: 11.5 }}>
                      <thead>
                        {it.type === "damage"
                          ? <tr><th>Mã đơn</th><th>Phát hiện</th><th>Kho lấy → tỉnh giao</th><th>Chặng</th></tr>
                          : <tr><th>Mã đơn</th><th>Khách</th><th>Hạn</th><th>Quá hạn</th><th>Kho giao</th></tr>}
                      </thead>
                      <tbody>
                        {it.orders.map((o) => (it.type === "damage"
                          ? <tr key={o.order_code}><td style={{ fontWeight: 700 }}>{o.order_code}</td><td>{o.case_date}</td><td>{shortWh(o.kho_lay)} → {o.to_province}</td><td>{o.leg}</td></tr>
                          : <tr key={o.order_code}><td style={{ fontWeight: 700 }}>{o.order_code}</td><td>{o.client}</td><td>{String(o.deadline).split("-").reverse().join("/")}</td>
                            <td style={o.overdue_days >= 3 ? { color: "var(--red)", fontWeight: 700 } : undefined}>{o.overdue_days ? `${o.overdue_days} ngày` : "hôm nay"}</td><td>{shortWh(o.kho_giao)}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
