/**
 * components/ltl/damage/RouteRiskMatrix.js — "Hư hỏng & Rủi ro":
 * Kho lấy × Miền giao matrix (damage rate per order), drill-down route list
 * (Kho lấy → Tỉnh giao) and per-project risk. Data: body.damageRisk
 * (lib/damage-risk.js), computed server-side from the snapshot.
 */
import { useState } from "react";
import { fmt } from "../utils";

const fmtPct = (v) => (v == null ? "—" : `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`);

// Heat relative to the system average: 0 = no damage, 1 = at/above 3× avg.
function heat(rate, avg) {
  if (!rate || !avg) return 0;
  return Math.min(1, rate / (avg * 3));
}

// "Kho phát hiện" view: case counts only (no denominator) — heat vs the
// largest cell, no risky outline.
function CountCell({ c, max }) {
  if (!c) return <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-muted)" }}>—</td>;
  const h = max > 0 ? c.damaged / max : 0;
  return (
    <td title={`${fmt(c.damaged)} ca`} style={{
      padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap", borderRadius: 4,
      background: `rgba(244,63,94,${0.06 + h * 0.4})`,
    }}>
      <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{fmt(c.damaged)}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>ca</div>
    </td>
  );
}

function Cell({ c, avg, active, onClick }) {
  if (!c) return <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-muted)" }}>—</td>;
  const h = heat(c.rate, avg);
  return (
    <td
      onClick={c.damaged > 0 ? onClick : undefined}
      title={`${fmt(c.damaged)} ca / ${fmt(c.orders)} đơn`}
      style={{
        padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap",
        cursor: c.damaged > 0 ? "pointer" : "default",
        background: c.damaged > 0 ? `rgba(244,63,94,${0.06 + h * 0.34})` : "transparent",
        outline: active ? "2px solid var(--cyan)" : c.risky ? "2px solid var(--red)" : "none",
        outlineOffset: -2, borderRadius: 4,
      }}
    >
      <div style={{ fontWeight: 700, color: c.damaged > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
        {c.damaged > 0 ? fmtPct(c.rate) : "0"}{c.risky && " ⚠"}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmt(c.damaged)}/{fmt(c.orders)}</div>
    </td>
  );
}

export default function RouteRiskMatrix({ risk, riskOnly = false, onRiskOnlyChange }) {
  const [sel, setSel] = useState(null); // { kho, region } | null — "Kho lấy" view only
  // "lay" = Kho lấy × Miền giao, "giao" = Kho giao × Miền lấy (both rates),
  // "detect" = Kho phát hiện (Rillnet) × Miền giao (case counts only)
  const [mode, setMode] = useState("lay");
  if (!risk || !risk.totalOrders) return null;
  const { avgRate, threshold, rule } = risk;
  const view = mode === "giao" && risk.matrixGiao ? risk.matrixGiao
    : mode === "detect" && risk.matrixDetect ? risk.matrixDetect
    : { regions: risk.regions, warehouses: risk.warehouses };
  const { regions, warehouses } = view;
  const countMode = mode === "detect";
  const maxCount = countMode ? Math.max(1, ...warehouses.flatMap((w) => regions.map((rg) => w.cells[rg]?.damaged || 0))) : 0;
  const modeTitle = { lay: "Kho lấy × Miền giao", giao: "Kho giao × Miền lấy", detect: "Kho phát hiện × Miền giao (số ca)" }[mode];

  const routes = risk.routes.filter((r) =>
    (!riskOnly || r.risky) && (!sel || (r.kho === sel.kho && (!sel.region || r.region === sel.region))));

  const toggle = (kho, region) => {
    if (mode !== "lay") return; // route list is Kho lấy → Tỉnh giao
    setSel((s) => (s && s.kho === kho && s.region === region ? null : { kho, region }));
  };

  const th = { padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", textAlign: "center", whiteSpace: "nowrap" };
  const chip = (on) => ({
    fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${on ? "var(--red)" : "var(--border)"}`, background: on ? "var(--red-glow)" : "transparent",
    color: on ? "var(--red)" : "var(--text-secondary)",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title" style={{ flexWrap: "wrap", gap: 8 }}>
          <span>🗺️ Ma trận bể vỡ: {modeTitle}</span>
          <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {[["lay", "Kho lấy"], ["giao", "Kho giao"], ["detect", "Kho phát hiện"]].map(([k, label]) => (
              <button key={k} onClick={() => { setMode(k); setSel(null); }} style={{
                fontSize: 12, fontWeight: 600, padding: "4px 10px", border: "none", cursor: "pointer", fontFamily: "inherit",
                background: mode === k ? "rgba(var(--brand-rgb),0.18)" : "transparent", color: mode === k ? "var(--cyan)" : "var(--text-muted)",
              }}>{label}</button>
            ))}
          </span>
          {countMode ? (
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
            Kho nơi Rillnet ghi nhận ca bể vỡ · chỉ đếm số ca, không có tỷ lệ (không biết tổng số đơn đi qua kho đó)
          </span>
          ) : (
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
            Trung bình {fmtPct(avgRate)} · tô đỏ ⚠ khi ≥ {rule.multiplier}× trung bình ({fmtPct(threshold)}), ≥ {rule.minOrders} đơn{rule.minCases > 1 ? ` và ≥ ${rule.minCases} ca` : ""}{mode === "lay" ? " · bấm ô để xem tuyến" : ""}
          </span>
          )}
        </div>
        <div style={{ overflowX: "auto", padding: "0 12px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 3, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>{{ lay: "Kho lấy", giao: "Kho giao", detect: "Kho phát hiện" }[mode]}</th>
                {regions.map((rg) => <th key={rg} style={th}>{rg}</th>)}
                <th style={th}>Tổng</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((w) => (
                <tr key={w.kho}>
                  <td style={{ padding: "8px 10px", fontWeight: 600, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={w.kho}>{w.kho}</td>
                  {countMode ? (
                    <>
                      {regions.map((rg) => <CountCell key={rg} c={w.cells[rg]} max={maxCount} />)}
                      <CountCell c={w.total} max={Math.max(maxCount, w.total.damaged)} />
                    </>
                  ) : (
                    <>
                      {regions.map((rg) => (
                        <Cell key={rg} c={w.cells[rg]} avg={avgRate} active={sel?.kho === w.kho && sel?.region === rg} onClick={() => toggle(w.kho, rg)} />
                      ))}
                      <Cell c={w.total} avg={avgRate} active={sel?.kho === w.kho && !sel?.region} onClick={() => toggle(w.kho, null)} />
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
            {countMode
              ? `Số ca bể vỡ theo kho phát hiện (Rillnet) × miền giao, của đơn trong kỳ đang lọc. Hiện ${warehouses.length} kho nhiều ca nhất.`
              : `Tỷ lệ = số đơn có ca bể vỡ (Rillnet) / số đơn lấy hàng trong kỳ đang lọc. Hiện ${warehouses.length} kho nhiều ca nhất.`}
            {mode === "giao" && " Cột = miền của điểm lấy hàng."}
          </div>
        </div>
      </div>

      <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title" style={{ flexWrap: "wrap", gap: 8 }}>
          <span>🚚 Tuyến Kho lấy → Tỉnh giao {sel ? `— ${sel.kho}${sel.region ? ` · ${sel.region}` : ""}` : ""}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button style={chip(riskOnly)} onClick={() => onRiskOnlyChange?.(!riskOnly)}>
              ⚠ Chỉ tuyến rủi ro cao ({fmt(risk.riskyRouteCount)})
            </button>
            {sel && <button style={chip(false)} onClick={() => setSel(null)}>Bỏ chọn kho ✕</button>}
          </span>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Kho lấy</th><th>Tỉnh giao</th><th>Miền</th>
                <th style={{ textAlign: "right" }}>Đơn</th><th style={{ textAlign: "right" }}>Ca bể vỡ</th>
                <th style={{ textAlign: "right" }}>Tỷ lệ</th><th>Chặng nghi vấn chính</th><th>Gợi ý</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={`${r.kho}|${r.province}`}>
                  <td style={{ fontSize: 12, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.kho}>{r.kho}</td>
                  <td style={{ fontSize: 12 }}>{r.province}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.region}</td>
                  <td style={{ textAlign: "right", fontSize: 12 }}>{fmt(r.orders)}</td>
                  <td style={{ textAlign: "right", fontSize: 12, fontWeight: 600 }}>{fmt(r.damaged)}</td>
                  <td style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: r.risky ? "var(--red)" : "var(--text-primary)" }}>
                    {fmtPct(r.rate)}{r.risky && " ⚠"}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.topLeg || "—"}</td>
                  <td style={{ fontSize: 12, fontWeight: 600, color: r.suggestion === "Cân nhắc FTL riêng" ? "var(--red)" : "var(--amber)" }}>{r.suggestion ? `→ ${r.suggestion}` : ""}</td>
                </tr>
              ))}
              {routes.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>
                  {riskOnly ? "Không có tuyến nào vượt ngưỡng rủi ro trong kỳ này." : "Không có tuyến nào có ca bể vỡ."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title" style={{ flexWrap: "wrap", gap: 8 }}>
          <span>🏷️ Rủi ro theo dự án</span>
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
            Số ca bể vỡ trên 1.000 đơn · trung bình {(avgRate * 10).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} ca/1.000 đơn
          </span>
        </div>
        {risk.totalAmount > 0 && (
          <div style={{ padding: "0 20px 10px", fontSize: 13 }}>
            💰 Truy thu đã duyệt: <b>{fmt(risk.totalAmount)} đ</b> ({fmt(risk.compensation?.truyThu || 0)} ca) · bình quân <b>{fmt(Math.round(risk.totalAmount / risk.totalOrders))} đ/đơn</b> · đã chốt đền bù cho khách: <b>{fmt(risk.compensation?.compensated || 0)} đơn</b>
          </div>
        )}
        <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Dự án</th><th style={{ textAlign: "right" }}>Đơn</th><th style={{ textAlign: "right" }}>Ca bể vỡ</th>
                <th style={{ textAlign: "right" }}>Ca / 1.000 đơn</th><th style={{ width: "30%" }}></th>
                <th style={{ textAlign: "right" }}>Đã chốt đền bù</th>
                <th style={{ textAlign: "right" }}>Truy thu (đã duyệt)</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const max = Math.max(...risk.byProject.map((p) => p.per1000 || 0), 1);
                return risk.byProject.filter((p) => p.damaged > 0).map((p) => {
                  const high = p.orders >= rule.minOrders && p.per1000 >= avgRate * 10 * rule.multiplier;
                  return (
                    <tr key={p.name}>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{fmt(p.orders)}</td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{fmt(p.damaged)}</td>
                      <td style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: high ? "var(--red)" : "var(--text-primary)" }}>
                        {p.per1000?.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}{high && " ⚠"}
                      </td>
                      <td>
                        <div style={{ height: 8, borderRadius: 4, background: "var(--border)" }}>
                          <div style={{ height: 8, borderRadius: 4, width: `${((p.per1000 || 0) / max) * 100}%`, background: high ? "var(--red)" : "var(--cyan)" }} />
                        </div>
                      </td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{p.compensated ? fmt(p.compensated) : "—"}</td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{p.amount > 0 ? `${fmt(p.amount)} đ (${fmt(p.truyThu)} ca)` : "—"}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
