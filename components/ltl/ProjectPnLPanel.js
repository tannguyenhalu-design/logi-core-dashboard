/**
 * components/ltl/ProjectPnLPanel.js
 * Bảng P&L Baseline per dự án B2B — chỉ Manager xem được.
 * CP Đền bù tính từ detailedDamageCases (Rillnet).
 * Doanh thu + CP Vận tải + CP CCDC chờ anh Tân cung cấp cấu trúc PnL —
 * tạm thời nhập thủ công qua inline inputs, lưu localStorage.
 */
import React, { useState, useEffect } from "react";

const vnd = (v) => v != null && v !== "" ? Number(v).toLocaleString("vi-VN") + " đ" : "—";
const pct = (v) => v != null ? Number(v).toFixed(1) + "%" : "—";
const STORAGE_KEY = "sd3_pnl_inputs_v1";

function loadInputs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveInputs(d) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {}
}

const inputStyle = {
  width: 120, textAlign: "right",
  background: "var(--input-bg)", border: "1px solid var(--border)",
  color: "var(--text-primary)", borderRadius: 4,
  padding: "3px 6px", fontFamily: "monospace", fontSize: 12,
};
const th = { fontSize: 12, padding: "8px 10px", whiteSpace: "nowrap" };
const td = { fontSize: 12, padding: "7px 10px" };
const num = { ...td, textAlign: "right", fontFamily: "monospace" };

export default function ProjectPnLPanel({ cases = [], ordersByProject = {} }) {
  const [canView, setCanView] = useState(null);
  const [inputs, setInputs] = useState({});

  useEffect(() => {
    setInputs(loadInputs());
    fetch("/api/project-pnl")
      .then((r) => r.json())
      .then((j) => setCanView(!!j.canView))
      .catch(() => setCanView(false));
  }, []);

  const setField = (proj, field, value) => {
    setInputs((prev) => {
      const next = { ...prev, [proj]: { ...(prev[proj] || {}), [field]: value } };
      saveInputs(next);
      return next;
    });
  };

  if (canView === null) {
    return <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>Đang kiểm tra quyền truy cập…</div>;
  }

  if (!canView) {
    return (
      <div style={{
        padding: 28, textAlign: "center", borderRadius: 10, fontSize: 14, fontWeight: 600,
        border: "1px solid var(--red)", color: "var(--red)", background: "rgba(244,63,94,0.06)",
      }}>
        🔒 Khu vực bảo mật · Chỉ Manager mới được xem P&amp;L Dự án
      </div>
    );
  }

  // Gom CP đền bù theo dự án từ Rillnet cases
  const compByProj = {};
  for (const c of cases) {
    const proj = c.client_name || "Khác";
    if (!compByProj[proj]) compByProj[proj] = { count: 0, amount: 0 };
    compByProj[proj].count++;
    compByProj[proj].amount += Number(c.comp_amount) || 0;
  }

  const projects = Object.keys(ordersByProject)
    .sort((a, b) => (ordersByProject[b] || 0) - (ordersByProject[a] || 0));

  // Tổng hợp toàn bộ
  let totalOrders = 0, totalComp = 0, totalRevenue = 0, totalCost = 0, revenueComplete = true;
  const rows = projects.map((proj) => {
    const orders = ordersByProject[proj] || 0;
    const comp = compByProj[proj] || { count: 0, amount: 0 };
    const inp = inputs[proj] || {};
    const pricePerOrder = Number(inp.pricePerOrder) || 0;
    const transportCost = Number(inp.transportCost) || 0;
    const cccdCost = Number(inp.cccdCost) || 0;

    const revenue = pricePerOrder > 0 ? orders * pricePerOrder : null;
    const totalCostRow = comp.amount + transportCost + cccdCost;
    const grossMargin = revenue != null ? revenue - totalCostRow : null;
    const gmPct = revenue != null && revenue > 0 ? (grossMargin / revenue) * 100 : null;
    const isNegative = grossMargin != null && grossMargin < 0;

    totalOrders += orders;
    totalComp += comp.amount;
    if (revenue == null) revenueComplete = false;
    else totalRevenue += revenue;
    totalCost += totalCostRow;

    return { proj, orders, comp, inp, pricePerOrder, transportCost, cccdCost, revenue, totalCostRow, grossMargin, gmPct, isNegative };
  });

  const totalGM = revenueComplete ? totalRevenue - totalCost : null;
  const totalGMPct = totalGM != null && totalRevenue > 0 ? (totalGM / totalRevenue) * 100 : null;

  return (
    <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>💼 P&amp;L Baseline Dự án</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            🔒 Manager only · CP Đền bù từ Rillnet · Nhập đơn giá HĐ/CP để tính Gross Margin
          </div>
        </div>
        <span style={{ fontSize: 11, background: "rgba(244,63,94,0.12)", color: "var(--red)", padding: "3px 8px", borderRadius: 8, fontWeight: 600, whiteSpace: "nowrap" }}>
          CONFIDENTIAL
        </span>
      </div>

      {/* Banner chờ PnL */}
      <div style={{
        background: "rgba(251,191,36,0.08)", border: "1px solid var(--amber)", borderRadius: 8,
        padding: "9px 14px", fontSize: 12, color: "var(--amber)", marginBottom: 14,
      }}>
        ⚠ Cấu trúc PnL đầy đủ chờ anh Tân cung cấp. Hiện tại: nhập <strong>Đơn giá HĐ</strong>, <strong>CP Vận tải</strong>, <strong>CP CCDC</strong> (cột ✎) để tính tạm — tự động lưu trên máy.
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th}>Dự án</th>
              <th style={{ ...th, textAlign: "right" }}>Đơn KT</th>
              <th style={{ ...th, textAlign: "right" }}>Ca hỏng</th>
              <th style={{ ...th, textAlign: "right" }}>CP Đền bù Rillnet</th>
              <th style={{ ...th, textAlign: "right" }}>Đơn giá HĐ ✎</th>
              <th style={{ ...th, textAlign: "right" }}>Doanh thu TT</th>
              <th style={{ ...th, textAlign: "right" }}>CP Vận tải ✎</th>
              <th style={{ ...th, textAlign: "right" }}>CP CCDC ✎</th>
              <th style={{ ...th, textAlign: "right" }}>Gross Margin</th>
              <th style={{ ...th, textAlign: "right" }}>GM %</th>
              <th style={th}>Cảnh báo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ proj, orders, comp, inp, revenue, grossMargin, gmPct, isNegative }) => (
              <tr key={proj} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ ...td, fontWeight: 600 }}>{proj}</td>
                <td style={{ ...num }}>{orders.toLocaleString("vi-VN")}</td>
                <td style={{ ...num, color: comp.count > 0 ? "var(--red)" : "var(--text-muted)" }}>
                  {comp.count || "—"}
                </td>
                <td style={{ ...num, color: comp.amount > 0 ? "var(--amber)" : "var(--text-muted)", fontWeight: comp.amount > 0 ? 700 : 400 }}>
                  {comp.amount > 0 ? vnd(comp.amount) : "—"}
                </td>

                {/* Đơn giá HĐ */}
                <td style={{ ...td, textAlign: "right" }}>
                  <input
                    type="number" min="0" step="1000"
                    value={inp.pricePerOrder || ""}
                    onChange={(e) => setField(proj, "pricePerOrder", e.target.value)}
                    placeholder="Nhập giá/đơn"
                    style={inputStyle}
                  />
                </td>

                <td style={{ ...num, color: revenue != null ? "var(--cyan)" : "var(--text-muted)", fontWeight: revenue != null ? 600 : 400 }}>
                  {vnd(revenue)}
                </td>

                {/* CP Vận tải */}
                <td style={{ ...td, textAlign: "right" }}>
                  <input
                    type="number" min="0" step="1000"
                    value={inp.transportCost || ""}
                    onChange={(e) => setField(proj, "transportCost", e.target.value)}
                    placeholder="Tổng CP vận tải"
                    style={inputStyle}
                  />
                </td>

                {/* CP CCDC */}
                <td style={{ ...td, textAlign: "right" }}>
                  <input
                    type="number" min="0" step="1000"
                    value={inp.cccdCost || ""}
                    onChange={(e) => setField(proj, "cccdCost", e.target.value)}
                    placeholder="Tổng CP CCDC"
                    style={inputStyle}
                  />
                </td>

                <td style={{
                  ...num,
                  color: isNegative ? "var(--red)" : grossMargin != null ? "var(--green)" : "var(--text-muted)",
                  fontWeight: grossMargin != null ? 700 : 400,
                }}>
                  {vnd(grossMargin)}
                </td>

                <td style={{
                  ...num,
                  color: isNegative ? "var(--red)" : gmPct != null ? "var(--green)" : "var(--text-muted)",
                  fontWeight: gmPct != null ? 700 : 400,
                }}>
                  {pct(gmPct)}
                </td>

                <td style={td}>
                  {isNegative ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", background: "rgba(244,63,94,0.15)", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap" }}>
                      ⚠ ÂM LỢI NHUẬN
                    </span>
                  ) : revenue == null ? (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Chờ nhập giá</span>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--green)" }}>✓ Có lãi</span>
                  )}
                </td>
              </tr>
            ))}

            {/* Dòng tổng */}
            {projects.length > 0 && (
              <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700, background: "rgba(255,255,255,0.03)" }}>
                <td style={{ ...td, fontWeight: 700 }}>TỔNG</td>
                <td style={{ ...num, fontWeight: 700 }}>{totalOrders.toLocaleString("vi-VN")}</td>
                <td style={{ ...num, color: "var(--red)", fontWeight: 700 }}>
                  {Object.values(compByProj).reduce((s, v) => s + v.count, 0) || "—"}
                </td>
                <td style={{ ...num, color: "var(--amber)", fontWeight: 700 }}>{vnd(totalComp)}</td>
                <td style={td} />
                <td style={{ ...num, color: "var(--cyan)", fontWeight: 700 }}>{revenueComplete ? vnd(totalRevenue) : "—"}</td>
                <td style={td} />
                <td style={td} />
                <td style={{ ...num, color: totalGM != null && totalGM < 0 ? "var(--red)" : totalGM != null ? "var(--green)" : "var(--text-muted)", fontWeight: 700 }}>
                  {vnd(totalGM)}
                </td>
                <td style={{ ...num, color: totalGMPct != null && totalGMPct < 0 ? "var(--red)" : totalGMPct != null ? "var(--green)" : "var(--text-muted)", fontWeight: 700 }}>
                  {pct(totalGMPct)}
                </td>
                <td style={td} />
              </tr>
            )}

            {projects.length === 0 && (
              <tr><td colSpan={11} style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: 30 }}>
                Không có dữ liệu dự án trong kỳ đang lọc.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
        Doanh thu TT = Đơn KT × Đơn giá HĐ · Gross Margin = Doanh thu − (CP Đền bù + CP Vận tải + CP CCDC) · Inputs lưu cục bộ trên trình duyệt.
      </div>
    </div>
  );
}
