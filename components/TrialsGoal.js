/**
 * components/TrialsGoal.js — Kế hoạch G (05/10): mục tiêu + chỉ số đo của giải pháp (Sổ tay).
 *  - GoalFields: phần nhập trong form giải pháp (vấn đề, hành động, CHỈ SỐ CHÍNH + ngưỡng — bắt buộc,
 *    chỉ số phụ, chỉ số không được xấu đi, người phụ trách, cảnh báo Baseline từng khách).
 *  - GoalBox / GoalPrint / goalCopyLines: kết quả theo chỉ số chính ở màn hình / In / Copy.
 * Số liệu do lib/solution-metrics.js (evaluateGoal) tính; ở đây chỉ hiển thị.
 */
import { useState } from "react";
import DateField from "./DateField";
import { METRICS, METRIC_KEYS, MAX_SECONDARY, MAX_GUARDRAILS, formatMetric, targetText } from "../lib/solution-metrics";

const NL = String.fromCharCode(10);
const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const fmtS = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };
const label = { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4, display: "block" };
const input = { padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" };
const th = { padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap", fontSize: 11.5 };
const td = { padding: "7px 9px", textAlign: "right", fontSize: 12.5, borderBottom: "1px solid var(--panel-border-soft, var(--border))" };
const LEVEL = {
  worse_vs_control: ["⚖", "var(--amber)", "rgba(245,158,11,0.14)"],
  reached: ["🎯", "var(--green)", "rgba(34,197,94,0.14)"], reached_warn: ["🎯", "var(--amber)", "rgba(245,158,11,0.14)"], improved: ["📈", "var(--cyan)", "rgba(56,189,248,0.14)"],
  flat: ["➖", "var(--amber)", "rgba(245,158,11,0.12)"], worse: ["📉", "var(--red)", "rgba(239,68,68,0.14)"], insufficient: ["⏳", "var(--text-muted)", "rgba(148,163,184,0.14)"], external: ["📝", "var(--text-muted)", "rgba(148,163,184,0.14)"],
};
export function GoalChip({ level, text }) {
  const [icon, color, bg] = LEVEL[level] || LEVEL.insufficient;
  return <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 12, color, background: bg, border: `1px solid ${color}`, whiteSpace: "nowrap" }}>{icon} {text}</span>;
}
const nvn = (x, d) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const changeTxt = (g) => (g.fromZero ? "từ 0 lên" : g.change == null ? "—" : g.unit === "điểm" ? `${g.change > 0 ? "+" : g.change < 0 ? "−" : "±"}${nvn(Math.abs(g.change), 1)} điểm` : `${g.change > 0 ? "+" : g.change < 0 ? "−" : "±"}${nvn(Math.abs(g.change), 1)}%`);

// ── Form (P1) ─────────────────────────────────────────────────────────────
function PickChips({ value, onChange, disabledKeys, max }) {
  const keys = METRIC_KEYS.filter((k) => k !== "external");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {keys.map((k) => {
        const on = value.includes(k), off = !on && (disabledKeys.includes(k) || value.length >= max);
        return <button key={k} type="button" disabled={off} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 14, cursor: off ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: off ? 0.45 : 1, border: "1px solid var(--border)", background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", color: on ? "var(--cyan)" : "var(--text-secondary)", fontWeight: on ? 700 : 500 }}>{on ? "✓ " : ""}{METRICS[k].label}</button>;
      })}
    </div>
  );
}
export function GoalFields({ f, set, check, addedClients }) {
  const m = f.primaryMetric ? METRICS[f.primaryMetric] : null;
  return (
    <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, padding: 12, borderRadius: 8, border: "1px solid var(--border)", background: "rgba(var(--brand-rgb),0.04)" }}>
      <div style={{ gridColumn: "1 / -1", fontSize: 12.5, fontWeight: 700 }}>🎯 Mục tiêu & chỉ số đo — bắt buộc đủ mới lưu được</div>
      <div><span style={label}>Vấn đề / bối cảnh * <span style={{ ...small, fontWeight: 400 }}>(giải pháp nhằm giải quyết điều gì)</span></span>
        <textarea style={{ ...input, minHeight: 64, resize: "vertical" }} value={f.problem} onChange={(e) => set({ problem: e.target.value })} placeholder="VD: Mùa mưa lũ, hàng điện máy luân chuyển bị ướt đáy thùng" /></div>
      <div><span style={label}>Hành động * <span style={{ ...small, fontWeight: 400 }}>(giải pháp làm gì)</span></span>
        <textarea style={{ ...input, minHeight: 64, resize: "vertical" }} value={f.action} onChange={(e) => set({ action: e.target.value })} placeholder="VD: Lót pallet cho toàn bộ hàng PSD từ đầu lấy Đà Nẵng" /></div>
      <div>
        <span style={label}>Chỉ số chính — đo giải pháp bằng gì? *</span>
        <select style={input} value={f.primaryMetric} onChange={(e) => set({ primaryMetric: e.target.value, primaryTarget: e.target.value === "external" ? "" : f.primaryTarget, secondaryMetrics: f.secondaryMetrics.filter((k) => k !== e.target.value), guardrails: f.guardrails.filter((k) => k !== e.target.value) })}>
          <option value="">— Chọn chỉ số chính —</option>
          {METRIC_KEYS.map((k) => <option key={k} value={k}>{METRICS[k].label}</option>)}
        </select>
        {m && <div style={small}>{m.def}</div>}
      </div>
      {m && f.primaryMetric !== "external" && (
        <div><span style={label}>Ngưỡng đạt * <span style={{ ...small, fontWeight: 400 }}>({m.better === "up" ? "tăng tối thiểu, đơn vị điểm %" : "giảm tối thiểu, đơn vị % so Baseline"})</span></span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={small}>{m.better === "up" ? "tăng ≥" : "giảm ≥"}</span>
            <input style={{ ...input, width: 110 }} type="number" min="0" step="any" value={f.primaryTarget} onChange={(e) => set({ primaryTarget: e.target.value })} placeholder={m.better === "up" ? "VD 3" : "VD 30"} />
            <span style={small}>{m.targetUnit}</span>
          </div>
        </div>
      )}
      {f.primaryMetric === "external" && (
        <div><span style={label}>Cách đo (ngoài dashboard) *</span>
          <textarea style={{ ...input, minHeight: 64, resize: "vertical" }} value={f.metricNote} onChange={(e) => set({ metricNote: e.target.value })} placeholder="VD: Tỷ lệ đơn có ePOD lên app M1 trước 09h D+1 — lấy từ báo cáo Rillnet mỗi tuần" />
          <div style={{ ...small, color: "var(--amber)" }}>Dashboard chưa có số này nên báo cáo sẽ ghi "Chưa đo được trong dashboard", không tự nhận định và không dùng bể vỡ / on-time thay thế.</div></div>
      )}
      <div><span style={label}>Chỉ số phụ <span style={{ ...small, fontWeight: 400 }}>(tối đa {MAX_SECONDARY}, chỉ để theo dõi)</span></span>
        <PickChips value={f.secondaryMetrics} onChange={(v) => set({ secondaryMetrics: v })} disabledKeys={[f.primaryMetric, ...f.guardrails]} max={MAX_SECONDARY} /></div>
      <div><span style={label}>Chỉ số không được xấu đi <span style={{ ...small, fontWeight: 400 }}>(tối đa {MAX_GUARDRAILS}; xấu đi thì cảnh báo, không bao giờ kết luận "Đạt" trơn)</span></span>
        <PickChips value={f.guardrails} onChange={(v) => set({ guardrails: v })} disabledKeys={[f.primaryMetric, ...f.secondaryMetrics]} max={MAX_GUARDRAILS} /></div>
      <div><span style={label}>Người phụ trách *</span><input style={input} value={f.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Tên người chịu trách nhiệm kết quả" /></div>
      <div><span style={label}>Ngày xem lại kết quả</span>
        <DateField label="Ngày xem lại" placeholder="dd/mm/yyyy" value={f.reviewDate} onChange={(v) => set({ reviewDate: v })} inputStyle={{ ...input, padding: "7px 26px 7px 8px" }} wrapStyle={{ width: "100%" }} /></div>
      {addedClients && addedClients.length > 0 && (
        <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: "var(--amber)" }}>⚠ Bạn thêm khách vào giải pháp đã có: {addedClients.join(", ")}. Khách mới có thể không có đơn trong Baseline chung → so Trước/Sau không còn cùng một tập khách. Cân nhắc tạo giai đoạn / giải pháp riêng cho khách mới.</div>
      )}
      {check && check.warnings.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>{check.warnings.map((t, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--red)", fontWeight: 600 }}>{t}</div>)}</div>
      )}
      {check && check.siblings.length > 0 && (
        <div style={{ gridColumn: "1 / -1", ...small }}>Khách cùng nhóm chưa chọn (gợi ý theo tên): {check.siblings.map((x) => `${x.name} (${x.orders.toLocaleString("vi-VN")} đơn)`).join(", ")}.</div>
      )}
    </div>
  );
}

// ── Kết quả theo chỉ số chính (màn hình) ──────────────────────────────────
export function GoalBox({ report }) {
  const o = report.objective;
  if (!o) return null;
  const rows = report.phases.filter((x) => x.goal);
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(var(--brand-rgb),0.04)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>🎯 Mục tiêu & kết quả theo chỉ số chính</div>
      <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: "pre-wrap" }}><b>Vấn đề:</b> {o.problem}</div>
      <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}><b>Hành động:</b> {o.action}</div>
      <div style={{ fontSize: 12.5, marginTop: 4 }}><b>Đo bằng:</b> {o.metricLabel}{o.external ? "" : ` — mục tiêu ${targetText(o.primaryMetric, o.target)}`}
        {o.secondary.length > 0 && <> · <b>phụ:</b> {o.secondary.map((k) => METRICS[k].label).join(", ")}</>}
        {o.guardrails.length > 0 && <> · <b>không được xấu đi:</b> {o.guardrails.map((k) => METRICS[k].label).join(", ")}</>}
        {" "}· <b>phụ trách:</b> {o.owner}{o.reviewDate ? <> · <b>xem lại:</b> {fmtD(o.reviewDate)}</> : null}</div>
      <div style={small}>{o.definition}{o.external && o.metricNote ? ` Cách đo: ${o.metricNote}` : ""}</div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 640 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Giai đoạn</th><th style={th}>Trước → Sau</th><th style={th}>Thay đổi</th><th style={{ ...th, textAlign: "left" }}>Kết quả</th></tr></thead>
          <tbody>{rows.map((x) => {
            const g = x.goal;
            return (
              <tr key={x.phase.id}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{x.phase.label}</td>
                <td style={td}>{g.external ? "—" : <>{formatMetric(g.key, g.base)} → <b>{formatMetric(g.key, g.post)}</b></>}</td>
                <td style={{ ...td, fontWeight: 700 }}>{g.external ? "—" : changeTxt(g)}{g.basis === "net" && !g.external ? <div style={small}>ròng, đã trừ đối chứng</div> : null}</td>
                <td style={{ ...td, textAlign: "left" }}><GoalChip level={g.level} text={g.label} /></td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      {rows.map((x) => (
        <div key={x.phase.id} style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{x.phase.label}</div>
          {x.goal.reasons.map((t, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>• {t}</div>)}
          {x.goal.secondary.map((s) => <div key={s.key} style={small}>Chỉ số phụ — {s.text}.</div>)}
          {x.goal.guardrails.map((s) => <div key={s.key} style={{ ...small, color: s.worse ? "var(--red)" : undefined, fontWeight: s.worse ? 700 : 400 }}>{s.worse ? "⚠ " : ""}Không được xấu đi — {s.text}.</div>)}
        </div>
      ))}
      <div style={{ ...small, marginTop: 4 }}>Nhận định theo chỉ số chính do người phụ trách khai; nhận định cũ (% bể vỡ + on-time) vẫn hiện ở từng giai đoạn để tham khảo.</div>
    </div>
  );
}

// ── Bản In ────────────────────────────────────────────────────────────────
export function GoalPrint({ report, C, cell, hc }) {
  const o = report.objective;
  if (!o) return null;
  const rows = report.phases.filter((x) => x.goal);
  return (
    <div style={{ marginTop: 12, breakInside: "avoid" }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>🎯 Mục tiêu & kết quả theo chỉ số chính</div>
      <div style={{ fontSize: 11.5, marginTop: 3, whiteSpace: "pre-wrap" }}><b>Vấn đề:</b> {o.problem}</div>
      <div style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}><b>Hành động:</b> {o.action}</div>
      <div style={{ fontSize: 11.5, marginTop: 3 }}><b>Đo bằng:</b> {o.metricLabel}{o.external ? "" : ` — mục tiêu ${targetText(o.primaryMetric, o.target)}`}{o.secondary.length ? ` · phụ: ${o.secondary.map((k) => METRICS[k].label).join(", ")}` : ""}{o.guardrails.length ? ` · không được xấu đi: ${o.guardrails.map((k) => METRICS[k].label).join(", ")}` : ""} · phụ trách: {o.owner}{o.reviewDate ? ` · xem lại: ${fmtD(o.reviewDate)}` : ""}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead><tr>{["Giai đoạn", "Trước → Sau", "Thay đổi", "Kết quả"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i === 0 || i === 3 ? "left" : "right" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((x) => { const g = x.goal; return <tr key={x.phase.id}><td style={{ ...cell, textAlign: "left", fontWeight: 700 }}>{x.phase.label}</td><td style={cell}>{g.external ? "—" : `${formatMetric(g.key, g.base)} → ${formatMetric(g.key, g.post)}`}</td><td style={cell}>{g.external ? "—" : `${changeTxt(g)}${g.basis === "net" ? " (ròng)" : ""}`}</td><td style={{ ...cell, textAlign: "left", fontWeight: 700 }}>{g.label}</td></tr>; })}</tbody>
      </table>
      {rows.map((x) => <div key={x.phase.id}>{x.goal.reasons.map((t, i) => <div key={i} style={{ fontSize: 10.5, marginTop: 2 }}>{x.phase.label}: {t}</div>)}{[...x.goal.secondary.map((s) => `Chỉ số phụ — ${s.text}`), ...x.goal.guardrails.map((s) => `${s.worse ? "⚠ " : ""}Không được xấu đi — ${s.text}`)].map((t, i) => <div key={`s${i}`} style={{ fontSize: 10, color: C.muted }}>{x.phase.label}: {t}</div>)}</div>)}
    </div>
  );
}

// ── Copy tóm tắt ──────────────────────────────────────────────────────────
export function goalCopyLines(report) {
  const o = report.objective;
  if (!o) return "";
  const L = ["", "MỤC TIÊU & KẾT QUẢ THEO CHỈ SỐ CHÍNH:", `  Vấn đề: ${o.problem}`, `  Hành động: ${o.action}`,
    `  Đo bằng: ${o.metricLabel}${o.external ? "" : ` — mục tiêu ${targetText(o.primaryMetric, o.target)}`}${o.secondary.length ? ` · phụ: ${o.secondary.map((k) => METRICS[k].label).join(", ")}` : ""}${o.guardrails.length ? ` · không được xấu đi: ${o.guardrails.map((k) => METRICS[k].label).join(", ")}` : ""} · phụ trách: ${o.owner}${o.reviewDate ? ` · xem lại ${fmtD(o.reviewDate)}` : ""}`];
  for (const x of report.phases) {
    if (!x.goal) continue;
    L.push(`  ${x.phase.label}: ${x.goal.label}`);
    for (const t of x.goal.reasons) L.push(`    - ${t}`);
    for (const s of x.goal.guardrails) L.push(`    - ${s.worse ? "⚠ " : ""}Không được xấu đi — ${s.text}`);
  }
  return L.join(NL);
}

// ── 3 câu hỏi của báo cáo (Kế hoạch H): Kết luận · Tin được không? · Làm gì tiếp? ─────────────
const TRUST_SHOWN = 4;
export function ConclusionBox({ report }) {
  const [more, setMore] = useState(false);
  const h = report.headline, trust = report.trust || [], sg = report.suggestions;
  if (!h && !trust.length && !sg) return null;
  const shown = more ? trust : trust.slice(0, TRUST_SHOWN);
  const head = { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.3 };
  return (
    <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "rgba(var(--brand-rgb),0.05)" }}>
      {h && (
        <div>
          <div style={head}>Kết luận</div>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginTop: 3 }}>
            <GoalChip level={h.level} text={h.label} />
            <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.5 }}>{h.text}</span>
          </div>
        </div>
      )}
      {trust.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={head}>Tin được không?</div>
          {shown.map((t, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 2, color: t.level === "warn" ? "var(--amber)" : "var(--text-secondary)" }}>{t.level === "warn" ? "⚠" : "•"} {t.text}</div>)}
          {trust.length > TRUST_SHOWN && <button type="button" onClick={() => setMore((x) => !x)} style={{ marginTop: 4, fontSize: 12, background: "none", border: "none", color: "var(--cyan)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>{more ? "Thu gọn" : `Xem thêm ${trust.length - TRUST_SHOWN} lưu ý`}</button>}
        </div>
      )}
      {sg && (
        <div style={{ marginTop: 10 }}>
          <div style={head}>Làm gì tiếp?</div>
          <div style={{ fontSize: 12.5, marginTop: 2 }}>{sg.title}:</div>
          {sg.items.map((x, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55 }}>★ {x.text}</div>)}
          <div style={small}>{sg.note}</div>
        </div>
      )}
    </div>
  );
}
export function ConclusionPrint({ report, C }) {
  const h = report.headline, trust = report.trust || [], sg = report.suggestions;
  if (!h && !trust.length && !sg) return null;
  return (
    <div style={{ marginTop: 12, padding: "9px 12px", border: `1px solid ${C.line}`, borderRadius: 6, breakInside: "avoid" }}>
      {h && <div><div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Kết luận</div><div style={{ fontSize: 13, fontWeight: 700 }}>{h.label}</div><div style={{ fontSize: 11.5 }}>{h.text}</div></div>}
      {trust.length > 0 && <div style={{ marginTop: 7 }}><div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Tin được không?</div>{trust.map((t, i) => <div key={i} style={{ fontSize: 11, color: t.level === "warn" ? "#b45309" : C.text }}>{t.level === "warn" ? "⚠" : "•"} {t.text}</div>)}</div>}
      {sg && <div style={{ marginTop: 7 }}><div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Làm gì tiếp?</div><div style={{ fontSize: 11 }}>{sg.title}:</div>{sg.items.map((x, i) => <div key={i} style={{ fontSize: 11 }}>★ {x.text}</div>)}<div style={{ fontSize: 10, color: C.muted }}>{sg.note}</div></div>}
    </div>
  );
}
export function conclusionCopyLines(report) {
  const L = [];
  const h = report.headline, trust = report.trust || [], sg = report.suggestions;
  if (h) L.push("", "KẾT LUẬN:", `  ${h.label} — ${h.text}`);
  if (trust.length) L.push("", "TIN ĐƯỢC KHÔNG?", ...trust.map((t) => `  ${t.level === "warn" ? "⚠" : "-"} ${t.text}`));
  if (sg) L.push("", "LÀM GÌ TIẾP?", `  ${sg.title}:`, ...sg.items.map((x) => `  ★ ${x.text}`), `  (${sg.note})`);
  return L.join(NL);
}
