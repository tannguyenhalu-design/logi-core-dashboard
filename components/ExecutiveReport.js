/**
 * components/ExecutiveReport.js — "Tạo báo cáo tóm tắt" (approved 2026-09-26).
 * A flat, white, print-ready one-pager built only from the already-loaded
 * /api/data body (no extra request), following the active filters.
 * "In / Lưu PDF" uses window.print() (print CSS in styles/globals.css shows
 * only .exec-report); "Copy nội dung" copies a bullet text for slides.
 */
import { useState } from "react";
import { SHOW_TRUY_THU } from "../lib/display-flags";

const n = (v) => (v == null ? "—" : Number(v).toLocaleString("vi-VN"));
const p1 = (v) => (v == null ? "—" : `${Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`);
const vnTime = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function deltaText(d, unit, higherIsBetter) {
  if (!d) return null;
  const v = unit === "pt" ? d.deltaPoints : d.deltaPct;
  if (v == null) return null;
  if (v === 0) return { text: unit === "pt" ? "không đổi" : "0%", good: null };
  const up = v > 0;
  const abs = Math.abs(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  return { text: `${up ? "▲" : "▼"} ${unit === "pt" ? `${abs} điểm` : `${abs}%`}`, good: up === higherIsBetter };
}

export function buildReport(body) {
  const l = body.ltl || {};
  const kd = body.kpiDelta && !body.kpiDelta.incomplete ? body.kpiDelta : null;
  const compareLabel = kd ? (kd.mode === "window" ? `${kd.currentLabel} so cùng kỳ ${kd.compareLabel}` : `so ${kd.compareLabel}`) : null;
  const kpis = [
    { label: "Tổng đơn (lấy hàng)", value: n(l.totalOrders), delta: deltaText(kd?.orders, "%", true) },
    { label: "Tỷ lệ On-time", value: l.evalCount > 0 ? p1(l.ontimePct) : "—", delta: deltaText(kd?.ontime, "pt", true) },
    { label: "Đơn Late", value: n(l.lateCount), delta: deltaText(kd?.late, "%", false) },
    { label: "Ca hư hỏng", value: n(l.totalBroken), delta: deltaText(kd?.damage, "%", false) },
  ];
  const months = Object.keys(l.ordersByMonth || {}).map((m) => {
    const o = l.ontimeByMonth?.[m] || { ontime: 0, late: 0 };
    return { label: l.isWeekly ? `Tuần ${m}` : `T${m}`, orders: l.ordersByMonth[m], ontime: o.ontime + o.late > 0 ? (o.ontime / (o.ontime + o.late)) * 100 : null, late: o.late };
  });
  const issues = [];
  for (const a of body.anomalies?.items || []) {
    issues.push(`On-time giảm mạnh: ${a.name} ${p1(a.prev)} → ${p1(a.cur)} (▼ ${Math.abs(a.deltaPoints).toLocaleString("vi-VN")} điểm, so ${body.anomalies.compareLabel})`);
  }
  if (body.stuck?.count) {
    issues.push(`Đơn treo quá hạn: ${n(body.stuck.count)} đơn (${n(body.stuck.byAge[">7"])} đơn quá hạn > 7 ngày) — nhiều nhất: ${body.stuck.topClients.slice(0, 3).map(([c, k]) => `${c} (${n(k)})`).join(", ")}`);
  }
  if (body.dueToday?.count) issues.push(`Đến hạn giao hôm nay chưa giao: ${n(body.dueToday.count)} đơn`);
  {
    const cases = l.detailedDamageCases || [];
    const comp = cases.filter((c) => c.compensated).length;
    const tt = cases.filter((c) => c.truy_thu === "co");
    if (cases.length) issues.push(`Hư hỏng (Rillnet): ${n(cases.length)} ca · ${n(comp)} đơn đã chốt đền bù cho khách${SHOW_TRUY_THU ? ` · truy thu đã duyệt ${n(tt.length)} ca (${n(tt.reduce((s, c) => s + (c.truy_thu_amount || 0), 0))}đ)` : ""}`);
  }
  if (body.pendingPickup?.count) issues.push(`Đơn chờ lấy (chưa có ngày lấy): ${n(body.pendingPickup.count)} đơn`);
  const risk = body.damageRisk;
  const riskyRoutes = (risk?.routes || []).filter((r) => r.risky).slice(0, 5);
  if (riskyRoutes.length) {
    issues.push(`Tuyến bể vỡ cao (≥ ${risk.rule.multiplier}× TB ${p1(risk.avgRate)}): ${riskyRoutes.map((r) => `${r.kho} → ${r.province} ${r.damaged}/${n(r.orders)} (${p1(r.rate)})`).join("; ")}`);
  }
  const topWh = (l.warehouseAlerts || []).slice(0, 3);
  if (topWh.length) issues.push(`Kho cần chú ý: ${topWh.map((w) => `${w.warehouse} (${n(w.late)} late, ${n(w.broken)} ca hỏng)`).join("; ")}`);

  const projects = Object.values(l.projectSummaries || {})
    .sort((a, b) => b.totalOrders - a.totalOrders).slice(0, 10)
    .map((p) => ({ name: p.name, orders: p.totalOrders, ontime: p.evalCount > 0 ? (p.ontimeCount / p.evalCount) * 100 : null, late: p.lateCount, damage: p.damageCount || 0 }));
  return { kpis, compareLabel, months, issues, projects };
}

function toText(r, scopeLabel, dataAsOf) {
  const lines = [
    `BÁO CÁO LTL ĐIỆN MÁY — SD3`,
    `Phạm vi: ${scopeLabel} · Dữ liệu cập nhật: ${vnTime(dataAsOf)}`,
    ``,
    `CHỈ SỐ CHÍNH${r.compareLabel ? ` (${r.compareLabel})` : ""}`,
    ...r.kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta.text})` : ""}`),
  ];
  if (r.months.length > 1) {
    lines.push("", "XU HƯỚNG", ...r.months.map((m) => `- ${m.label}: ${n(m.orders)} đơn · On-time ${p1(m.ontime)} · ${n(m.late)} late`));
  }
  lines.push("", "ĐIỂM CẦN CHÚ Ý", ...(r.issues.length ? r.issues.map((i) => `- ${i}`) : ["- Không có cảnh báo nổi bật"]));
  lines.push("", "TOP DỰ ÁN THEO SỐ ĐƠN", ...r.projects.map((p) => `- ${p.name}: ${n(p.orders)} đơn · On-time ${p1(p.ontime)} · ${n(p.late)} late · ${n(p.damage)} ca hỏng`));
  return lines.join("\n");
}

const C = { text: "#111827", muted: "#6b7280", line: "#e5e7eb", brand: "#c2410c", good: "#15803d", bad: "#dc2626" };

export default function ExecutiveReport({ body, scopeLabel, onClose }) {
  const [copied, setCopied] = useState(false);
  const r = buildReport(body);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toText(r, scopeLabel, body.dataAsOf));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const btn = { padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
  const th = { textAlign: "left", padding: "6px 8px", borderBottom: `2px solid ${C.line}`, color: C.muted, fontWeight: 600, fontSize: 12 };
  const td = { padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontSize: 12.5 };

  return (
    <div className="exec-report" style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#f3f4f6", overflowY: "auto" }}>
      <div className="no-print" style={{ position: "sticky", top: 0, display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 20px", background: "#f3f4f6", borderBottom: `1px solid ${C.line}` }}>
        <button onClick={copy} style={{ ...btn, background: "#fff", border: `1px solid ${C.line}`, color: C.text }}>{copied ? "✓ Đã copy" : "📋 Copy nội dung"}</button>
        <button onClick={() => window.print()} style={{ ...btn, background: C.brand, border: `1px solid ${C.brand}`, color: "#fff" }}>🖨 In / Lưu PDF</button>
        <button onClick={onClose} style={{ ...btn, background: "#fff", border: `1px solid ${C.line}`, color: C.text }}>Đóng ✕</button>
      </div>

      <div className="exec-page" style={{ maxWidth: 900, margin: "20px auto", background: "#fff", color: C.text, padding: "32px 36px", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", fontFamily: "inherit" }}>
        <div style={{ borderBottom: `3px solid ${C.brand}`, paddingBottom: 10, marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Báo cáo LTL Điện Máy — SD3</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Phạm vi: {scopeLabel} · Dữ liệu cập nhật: {vnTime(body.dataAsOf)}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {r.kpis.map((k) => (
            <div key={k.label} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ fontSize: 11.5, color: C.muted }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{k.value}</div>
              {k.delta && <div style={{ fontSize: 12, fontWeight: 600, color: k.delta.good == null ? C.muted : k.delta.good ? C.good : C.bad }}>{k.delta.text}</div>}
            </div>
          ))}
        </div>
        {r.compareLabel && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>Thay đổi {r.compareLabel}.</div>}

        {r.months.length > 1 && (
          <>
            <h3 style={{ fontSize: 15, margin: "22px 0 8px" }}>Xu hướng</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Kỳ</th><th style={{ ...th, textAlign: "right" }}>Số đơn</th><th style={{ ...th, textAlign: "right" }}>On-time</th><th style={{ ...th, textAlign: "right" }}>Late</th></tr></thead>
              <tbody>{r.months.map((m) => (
                <tr key={m.label}><td style={td}>{m.label}</td><td style={{ ...td, textAlign: "right" }}>{n(m.orders)}</td><td style={{ ...td, textAlign: "right" }}>{p1(m.ontime)}</td><td style={{ ...td, textAlign: "right" }}>{n(m.late)}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}

        <h3 style={{ fontSize: 15, margin: "22px 0 8px" }}>Điểm cần chú ý</h3>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
          {r.issues.length ? r.issues.map((i) => <li key={i}>{i}</li>) : <li>Không có cảnh báo nổi bật.</li>}
        </ul>

        <h3 style={{ fontSize: 15, margin: "22px 0 8px" }}>Top dự án theo số đơn</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Dự án</th><th style={{ ...th, textAlign: "right" }}>Số đơn</th><th style={{ ...th, textAlign: "right" }}>On-time</th><th style={{ ...th, textAlign: "right" }}>Late</th><th style={{ ...th, textAlign: "right" }}>Ca hỏng</th></tr></thead>
          <tbody>{r.projects.map((p) => (
            <tr key={p.name}>
              <td style={td}>{p.name}</td><td style={{ ...td, textAlign: "right" }}>{n(p.orders)}</td>
              <td style={{ ...td, textAlign: "right", color: p.ontime != null && p.ontime < 90 ? C.bad : C.text }}>{p1(p.ontime)}</td>
              <td style={{ ...td, textAlign: "right" }}>{n(p.late)}</td><td style={{ ...td, textAlign: "right" }}>{n(p.damage)}</td>
            </tr>
          ))}</tbody>
        </table>

        <div style={{ fontSize: 11, color: C.muted, marginTop: 20, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          Nguồn: SD3 Dashboard Điện Máy (logicore-app.vercel.app) — đơn LTL Điện Máy lấy hàng từ 07/2026, tính theo ngày lấy hàng.
        </div>
      </div>
    </div>
  );
}
