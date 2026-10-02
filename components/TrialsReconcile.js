/**
 * components/TrialsReconcile.js — Kế hoạch F · phiên F1 (02/10): các khối mới của báo cáo giải pháp
 * (Sổ tay cải tiến). Số liệu do lib/solution-reconcile.js tính (cùng object cho màn hình, In, Copy,
 * Word, Excel): đối soát 2 góc nhìn bể vỡ (cohort / real-time), độ phủ tách tuyến, khoảng trống
 * mở rộng, dòng "Nguồn dữ liệu". Chỉ hiển thị — không tính lại số nào ở đây.
 */
import { useState } from "react";

const NL = String.fromCharCode(10);
const n0 = (x) => (x == null ? "—" : Math.round(x).toLocaleString("vi-VN"));
const n1 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const n2 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pc2 = (x) => (x == null ? "—" : `${n2(x)}%`);
const pc1 = (x) => (x == null ? "—" : `${n1(x)}%`);
const sgn = (x, f) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${f(Math.abs(x))}`);
const fmtS = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };
const th = { padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap", fontSize: 11.5 };
const thw = { ...th, whiteSpace: "normal" };
const td = { padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5, borderBottom: "1px solid var(--panel-border-soft, var(--border))" };
const box = { marginTop: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(var(--brand-rgb),0.04)" };
const title = { fontSize: 12.5, fontWeight: 700 };
const seg = (on) => ({ fontSize: 12.5, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 500, background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", border: "1px solid var(--border)", color: on ? "var(--cyan)" : "var(--text-muted)" });
const dirColor = (d) => (d === "down" ? "var(--green)" : d === "up" ? "var(--red)" : "var(--text-secondary)");

export const changeText = (v) => (v.changePct == null ? "—" : `${sgn(v.changePct, n1)}%`);

// ── Đối soát 2 góc nhìn (trong từng giai đoạn) ───────────────────────────
export function ReconcileBox({ r }) {
  if (!r) return null;
  const mCols = r.matrix.cols.filter((c, i) => i < 2 || c.total > 0);
  const mRows = r.matrix.rows.filter((x, i) => i < 2 || x.total > 0);
  const view = (name, sub, v, strong) => (
    <tr style={strong ? undefined : { color: "var(--text-secondary)" }}>
      <td style={{ ...td, textAlign: "left", whiteSpace: "normal", minWidth: 220 }}><b>{name}</b><div style={small}>{sub}</div></td>
      <td style={td}>{pc2(v.base.pct)} <span style={small}>{n0(v.base.cases)} ca / {n0(v.base.orders)} đơn</span></td>
      <td style={td}><b>{pc2(v.post.pct)}</b> <span style={small}>{n0(v.post.cases)} ca / {n0(v.post.orders)} đơn</span></td>
      <td style={{ ...td, fontWeight: 700, color: dirColor(v.dir) }}>{changeText(v)}</td>
    </tr>
  );
  return (
    <div style={box}>
      <div style={{ ...title, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>⚖ Đối soát 2 góc nhìn bể vỡ <span style={{ ...small, fontWeight: 400 }}>nhận định tự động giữ nguyên theo cohort</span></div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 620 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Góc nhìn</th><th style={th}>Trước (Baseline {fmtS(r.periods.base.from)}–{fmtS(r.periods.base.to)})</th><th style={th}>Sau ({fmtS(r.periods.post.from)}–{fmtS(r.periods.post.to)})</th><th style={th} title="% thay đổi tương đối của % bể vỡ">Thay đổi</th></tr></thead>
          <tbody>
            {view("Cohort", "ca của đơn lấy trong kỳ (cách tính của nhận định tự động)", r.cohort, true)}
            {view("Real-time (tham khảo)", "ca có ngày ghi nhận Rillnet trong kỳ ÷ đơn lấy trong kỳ", r.realtime, false)}
          </tbody>
        </table>
      </div>
      <div style={{ ...title, marginTop: 10 }}>Ca của đơn lấy trong kỳ X được ghi nhận ở kỳ Y</div>
      <div style={{ overflowX: "auto", marginTop: 4 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 520 }}>
          <thead><tr><th style={{ ...thw, textAlign: "left" }}>Đơn lấy ↓ · Ghi nhận →</th>{mCols.map((c) => <th key={c.key} style={thw}>{c.label}</th>)}<th style={thw}>Cohort (tổng hàng)</th></tr></thead>
          <tbody>
            {mRows.map((x) => (
              <tr key={x.key}><td style={{ ...td, textAlign: "left", whiteSpace: "normal", fontWeight: 600 }}>{x.label}</td>
                {mCols.map((c) => { const v = x.cells[c.key], off = v > 0 && x.key !== c.key; return <td key={c.key} style={{ ...td, fontWeight: off ? 800 : 400, color: off ? "var(--amber)" : undefined }}>{v}</td>; })}
                <td style={{ ...td, fontWeight: 700 }}>{x.total}</td></tr>
            ))}
            <tr style={{ color: "var(--text-muted)", fontStyle: "italic" }}><td style={{ ...td, textAlign: "left" }}>Real-time (tổng cột)</td>{mCols.map((c) => <td key={c.key} style={td}>{c.total}</td>)}<td style={td} /></tr>
          </tbody>
        </table>
      </div>
      {r.notes.map((t, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: i ? 2 : 6 }}>• {t}</div>)}
      {r.concentration.map((t, i) => <div key={`c${i}`} style={{ fontSize: 12.5, lineHeight: 1.5 }}>• {t}</div>)}
      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>• {r.delayText}</div>
      {r.immature && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 2 }}>⚠ {r.immature.text}</div>}
      {r.warn && <div style={{ fontSize: 13, color: "var(--red)", fontWeight: 700, marginTop: 4 }}>{r.warn}</div>}
      {r.summary.filter((t) => t.startsWith("Chưa so hướng")).map((t, i) => <div key={`s${i}`} style={small}>{t}</div>)}
      <div style={{ ...small, marginTop: 4 }}>{r.realtimeNote}</div>
    </div>
  );
}

// ── Độ phủ (cả giải pháp) ─────────────────────────────────────────────────
export function CoverageBox({ report }) {
  const cov = report.coverage;
  if (!cov) return null;
  const S = cov.solution;
  const row = (label, x, bold, sub) => (
    <tr key={label} style={bold ? { background: "rgba(var(--brand-rgb),0.06)" } : undefined}>
      <td style={{ ...td, textAlign: "left", fontWeight: bold ? 800 : 600 }}>{label}{sub && <div style={small}>{sub}</div>}</td>
      <td style={td}>{x.active === false ? "chưa áp dụng" : `${fmtS(x.from)}–${fmtS(x.to)}`}</td>
      <td style={{ ...td, fontWeight: 700 }}>{n0(x.orders)} <span style={small}>đơn</span></td><td style={td}>{n1(x.tons)}</td>
      <td style={td}>{n0(x.allOrders)} đơn · {n1(x.allTons)} t</td>
      <td style={{ ...td, fontWeight: 700 }}>{pc1(x.pctOrders)} <span style={small}>đơn</span> · {pc1(x.pctTons)} <span style={small}>tấn</span></td>
      <td style={td}>{pc1(x.pctClientOrders)} <span style={small}>đơn</span> · {pc1(x.pctClientTons)} <span style={small}>tấn</span></td>
    </tr>
  );
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>🧭 Độ phủ tách tuyến <span style={{ ...small, fontWeight: 400 }}>(đơn / tấn thuộc phạm vi giải pháp ÷ điện máy xuất từ kho nguồn cùng kỳ)</span></div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 860 }}>
          <thead><tr><th style={{ ...thw, textAlign: "left" }}>Giai đoạn</th><th style={thw}>Kỳ tính</th><th style={thw}>Đơn thuộc phạm vi</th><th style={thw}>Tấn</th><th style={thw}>Tổng điện máy từ kho nguồn (mọi khách)</th><th style={thw} title="Đơn/tấn thuộc phạm vi ÷ tổng điện máy xuất từ kho nguồn">Độ phủ (% tổng điện máy)</th><th style={thw} title="Đơn/tấn thuộc phạm vi ÷ đơn/tấn của các khách áp dụng, cùng kho nguồn">Trong khách áp dụng</th></tr></thead>
          <tbody>
            {cov.phases.map((x) => row(x.label, x, false, null))}
            {cov.phases.length > 1 && row("Cả giải pháp", { ...S, active: S.phases > 0 }, true, "gộp phạm vi mọi giai đoạn, không đếm trùng")}
          </tbody>
        </table>
      </div>
      <div style={small}>Kho nguồn: {S.sourceText || "—"}.{cov.phases.length > 1 ? " Từng giai đoạn tính từ ngày bắt đầu của nó; cả giải pháp tính từ ngày bắt đầu giai đoạn đầu." : ""}</div>
      <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 2 }}>⚠ {cov.note}</div>
    </div>
  );
}

// ── Khoảng trống mở rộng ──────────────────────────────────────────────────
function GapTable({ title: t, dim, flag }) {
  return (
    <details open={dim.total > 0 && flag} style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>{t} <span style={{ ...small, fontWeight: 400 }}>— {dim.total} mục{flag ? `, ${dim.enoughCount} ứng viên đủ volume` : ""}{dim.total > dim.list.length ? ` (hiện ${dim.list.length} đầu)` : ""}</span></summary>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 700 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Tên</th><th style={th}>Đơn</th><th style={th}>Tấn</th><th style={th}>Đơn / tuần</th><th style={th}>Tấn / tuần</th><th style={thw} title="Ca bể của các đơn cùng luồng (từ kho nguồn → mục này) từ 01/07/2026 đến nay">Ca bể 01/07→nay</th>{flag && <th style={th}>Ứng viên</th>}</tr></thead>
          <tbody>{dim.list.map((x) => (
            <tr key={x.name} style={x.enough ? { background: "rgba(var(--brand-rgb),0.08)" } : undefined}>
              <td style={{ ...td, textAlign: "left", whiteSpace: "normal", fontWeight: 600 }}>{x.name}</td>
              <td style={td}>{n0(x.orders)}</td><td style={td}>{n1(x.tons)}</td><td style={td}>{n1(x.perWeekOrders)}</td><td style={td}>{n2(x.perWeekTons)}</td>
              <td style={td}>{n0(x.pastCases)} <span style={small}>({pc2(x.pastPct)} / {n0(x.pastOrders)} đơn)</span></td>
              {flag && <td style={{ ...td, fontWeight: 800, color: "var(--green)" }}>{x.enough ? "★ đủ volume" : ""}</td>}
            </tr>))}</tbody>
        </table>
      </div>
    </details>
  );
}
export function GapsBox({ report }) {
  const [scope, setScope] = useState("applied");
  const g = report.gaps;
  if (!g) return null;
  const sc = g[scope];
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>🧩 Khoảng trống mở rộng</span>
        <button style={seg(scope === "applied")} onClick={() => setScope("applied")}>Khách áp dụng</button>
        <button style={seg(scope === "all")} onClick={() => setScope("all")}>Mọi khách</button>
      </div>
      <div style={{ ...small, marginTop: 4 }}>Sản lượng từ kho nguồn ({g.source}) {fmtS(g.from)}→{fmtS(g.to)} chưa thuộc giải pháp nào trong Sổ tay.</div>
      <div style={{ fontSize: 12.5, marginTop: 4, fontWeight: 600 }}>{g.summary[scope === "applied" ? 0 : 1]}</div>
      <div style={{ ...small, marginTop: 2 }}>{g.ruleText}</div>
      <GapTable title="Theo tỉnh giao" dim={sc.byProvince} flag />
      <GapTable title="Theo kho giao" dim={sc.byWarehouse} flag />
      <GapTable title="Theo khách" dim={sc.byClient} flag={false} />
      <div style={{ ...small, marginTop: 4 }}>Đã đối chiếu với {g.checkedSolutions.length} giải pháp: {g.checkedSolutions.map((s) => s.id).join(", ")}. {g.note}</div>
      <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 2 }}>⚠ Dữ liệu không có cờ đơn đã thật sự đi qua tuyến tách; "khoảng trống" chỉ là phần sản lượng chưa nằm trong phạm vi giải pháp nào.</div>
    </div>
  );
}

// ── Nguồn dữ liệu ─────────────────────────────────────────────────────────
export function SourcesLine({ report }) {
  const s = report.sources;
  if (!s) return null;
  return (
    <div style={{ ...small, marginTop: 10, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
      <b>Nguồn dữ liệu:</b>{" "}
      {s.list.map((x, i) => (
        <span key={x.key} title={x.detail} style={x.stale ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{i ? " · " : ""}{x.label}{x.atText ? ` (${x.atText})` : ""}{x.stale ? " ⚠ quá 24 giờ" : ""}</span>
      ))}
    </div>
  );
}

// ── Bản In (trang A4 trắng) ───────────────────────────────────────────────
export function ReconcilePrint({ r, C, cell, hc }) {
  if (!r) return null;
  const mCols = r.matrix.cols.filter((c, i) => i < 2 || c.total > 0);
  const mRows = r.matrix.rows.filter((x, i) => i < 2 || x.total > 0);
  const vr = (name, v) => [name, `${pc2(v.base.pct)} (${v.base.cases}/${n0(v.base.orders)})`, `${pc2(v.post.pct)} (${v.post.cases}/${n0(v.post.orders)})`, changeText(v)];
  return (
    <div style={{ marginTop: 8, breakInside: "avoid" }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>⚖ Đối soát 2 góc nhìn bể vỡ <span style={{ fontWeight: 400, color: C.muted }}>— nhận định tự động theo cohort</span></div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead><tr>{["Góc nhìn", "Trước", "Sau", "Thay đổi"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>{[vr("Cohort — ca của đơn lấy trong kỳ", r.cohort), vr("Real-time — ca ghi nhận trong kỳ (tham khảo)", r.realtime)].map((row) => <tr key={row[0]}>{row.map((c2, i) => <td key={i} style={{ ...cell, textAlign: i ? "right" : "left", whiteSpace: i ? "nowrap" : "normal" }}>{c2}</td>)}</tr>)}</tbody>
      </table>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead><tr><th style={{ ...hc, textAlign: "left" }}>Đơn lấy ↓ · Ghi nhận →</th>{mCols.map((c) => <th key={c.key} style={{ ...hc, whiteSpace: "normal" }}>{c.label}</th>)}<th style={hc}>Cohort</th></tr></thead>
        <tbody>{mRows.map((x) => <tr key={x.key}><td style={{ ...cell, textAlign: "left", whiteSpace: "normal" }}>{x.label}</td>{mCols.map((c) => <td key={c.key} style={cell}>{x.cells[c.key]}</td>)}<td style={{ ...cell, fontWeight: 700 }}>{x.total}</td></tr>)}
          <tr><td style={{ ...cell, textAlign: "left", color: C.muted }}>Real-time</td>{mCols.map((c) => <td key={c.key} style={{ ...cell, color: C.muted }}>{c.total}</td>)}<td style={cell} /></tr></tbody>
      </table>
      {[...r.notes, ...r.concentration, r.delayText].map((t, i) => <div key={i} style={{ fontSize: 11, marginTop: 2 }}>• {t}</div>)}
      {r.immature && <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>⚠ {r.immature.text}</div>}
      {r.warn && <div style={{ fontSize: 11.5, color: C.red, fontWeight: 700, marginTop: 3 }}>{r.warn}</div>}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{r.realtimeNote}</div>
    </div>
  );
}
export function CoveragePrint({ report, C, cell, hc }) {
  const cov = report.coverage, g = report.gaps;
  if (!cov) return null;
  const S = cov.solution;
  const rows = [...cov.phases.map((x) => [x.label, x.active === false ? "chưa áp dụng" : `${fmtS(x.from)}–${fmtS(x.to)}`, `${n0(x.orders)} đơn · ${n1(x.tons)} t`, `${n0(x.allOrders)} đơn · ${n1(x.allTons)} t`, `${pc1(x.pctOrders)} · ${pc1(x.pctTons)}`, `${pc1(x.pctClientOrders)} · ${pc1(x.pctClientTons)}`]),
    ...(cov.phases.length > 1 ? [["Cả giải pháp", `${fmtS(S.from)}–${fmtS(S.to)}`, `${n0(S.orders)} đơn · ${n1(S.tons)} t`, `${n0(S.allOrders)} đơn · ${n1(S.allTons)} t`, `${pc1(S.pctOrders)} · ${pc1(S.pctTons)}`, `${pc1(S.pctClientOrders)} · ${pc1(S.pctClientTons)}`]] : [])];
  const gapTable = (t, dim, flag) => (
    <div key={t} style={{ marginTop: 5 }}>
      <div style={{ fontSize: 11, fontWeight: 700 }}>{t} <span style={{ fontWeight: 400, color: C.muted }}>({dim.total} mục{flag ? `, ${dim.enoughCount} đủ volume` : ""}; hiện {Math.min(8, dim.list.length)} đầu)</span></div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Tên", "Đơn", "Tấn", "Đơn/tuần", "Tấn/tuần", "Ca bể 01/07→nay", ...(flag ? ["Ứng viên"] : [])].map((h, i) => <th key={h} style={{ ...hc, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>{dim.list.slice(0, 8).map((x) => <tr key={x.name}><td style={{ ...cell, textAlign: "left", whiteSpace: "normal" }}>{x.name}</td><td style={cell}>{n0(x.orders)}</td><td style={cell}>{n1(x.tons)}</td><td style={cell}>{n1(x.perWeekOrders)}</td><td style={cell}>{n2(x.perWeekTons)}</td><td style={cell}>{n0(x.pastCases)} ({pc2(x.pastPct)})</td>{flag && <td style={{ ...cell, fontWeight: 700, color: C.green }}>{x.enough ? "★ đủ volume" : ""}</td>}</tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 800 }}>🧭 Độ phủ tách tuyến</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead><tr>{["Giai đoạn", "Kỳ tính", "Thuộc phạm vi", "Điện máy từ kho nguồn", "Độ phủ (đơn · tấn)", "Trong khách áp dụng"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i > 1 ? "right" : "left", whiteSpace: "normal" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row[0]}>{row.map((c2, i) => <td key={i} style={{ ...cell, textAlign: i > 1 ? "right" : "left", fontWeight: i === 0 ? 700 : 400 }}>{c2}</td>)}</tr>)}</tbody>
      </table>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Kho nguồn: {S.sourceText || "—"}. ⚠ {cov.note}</div>
      {g && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>🧩 Khoảng trống mở rộng</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>{g.summary[0]}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{g.ruleText}</div>
          {gapTable("Theo tỉnh giao (khách áp dụng)", g.applied.byProvince, true)}
          {gapTable("Theo kho giao (khách áp dụng)", g.applied.byWarehouse, true)}
          <div style={{ fontSize: 11, marginTop: 8 }}>{g.summary[1]}</div>
          {gapTable("Theo tỉnh giao (mọi khách)", g.all.byProvince, true)}
          {gapTable("Theo khách", g.all.byClient, false)}
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>Đã đối chiếu với {g.checkedSolutions.length} giải pháp: {g.checkedSolutions.map((s) => s.id).join(", ")}. {g.note}</div>
        </div>
      )}
    </div>
  );
}
export function SourcesPrint({ report, C }) {
  const s = report.sources;
  if (!s) return null;
  return <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}><b>Nguồn dữ liệu:</b> {s.list.map((x) => `${x.label}${x.atText ? ` (${x.atText})` : ""}${x.stale ? " — quá 24 giờ chưa đồng bộ" : ""}`).join(" · ")}.</div>;
}

// ── Copy tóm tắt ──────────────────────────────────────────────────────────
export function reconcileCopyLines(report) {
  const L = [];
  for (const x of report.phases) {
    const r = x.reconcile;
    if (!r) continue;
    L.push("", `ĐỐI SOÁT 2 GÓC NHÌN BỂ VỠ — ${x.phase.label}:`);
    L.push(`  Cohort (ca của đơn lấy trong kỳ): ${pc2(r.cohort.base.pct)} (${r.cohort.base.cases}/${n0(r.cohort.base.orders)} đơn) → ${pc2(r.cohort.post.pct)} (${r.cohort.post.cases}/${n0(r.cohort.post.orders)} đơn), ${changeText(r.cohort)}`);
    L.push(`  Real-time (ca ghi nhận trong kỳ, tham khảo): ${pc2(r.realtime.base.pct)} (${r.realtime.base.cases} ca) → ${pc2(r.realtime.post.pct)} (${r.realtime.post.cases} ca), ${changeText(r.realtime)}`);
    for (const t of [...r.notes, ...r.concentration, r.delayText]) L.push(`  - ${t}`);
    if (r.immature) L.push(`  ⚠ ${r.immature.text}`);
    if (r.warn) L.push(`  ${r.warn}`);
  }
  const cov = report.coverage;
  if (cov) {
    L.push("", "ĐỘ PHỦ TÁCH TUYẾN (đơn/tấn thuộc phạm vi giải pháp ÷ điện máy xuất từ kho nguồn):");
    for (const x of cov.phases) L.push(`  ${x.label}: ${n0(x.orders)} đơn / ${n1(x.tons)} t trên ${n0(x.allOrders)} đơn / ${n1(x.allTons)} t = ${pc1(x.pctOrders)} đơn · ${pc1(x.pctTons)} tấn; trong khách áp dụng ${pc1(x.pctClientOrders)} đơn · ${pc1(x.pctClientTons)} tấn`);
    if (cov.phases.length > 1) { const S = cov.solution; L.push(`  Cả giải pháp: ${n0(S.orders)} đơn / ${n1(S.tons)} t trên ${n0(S.allOrders)} đơn / ${n1(S.allTons)} t = ${pc1(S.pctOrders)} đơn · ${pc1(S.pctTons)} tấn; trong khách áp dụng ${pc1(S.pctClientOrders)} đơn · ${pc1(S.pctClientTons)} tấn`); }
    L.push(`  ⚠ ${cov.note}`);
  }
  const g = report.gaps;
  if (g) {
    L.push("", "KHOẢNG TRỐNG MỞ RỘNG:", `  ${g.summary[0]}`, `  ${g.summary[1]}`);
    const top = (label, dim) => { const a = dim.list.slice(0, 5); if (a.length) L.push(`  ${label}: ${a.map((x) => `${x.name} ${n0(x.orders)} đơn/${n1(x.tons)} t${x.enough ? " ★" : ""}${x.pastCases ? ` (${x.pastCases} ca bể)` : ""}`).join("; ")}`); };
    top("Tỉnh giao (khách áp dụng)", g.applied.byProvince); top("Kho giao (khách áp dụng)", g.applied.byWarehouse); top("Tỉnh giao (mọi khách)", g.all.byProvince);
    L.push(`  ${g.ruleText}`, `  Đã đối chiếu với ${g.checkedSolutions.length} giải pháp: ${g.checkedSolutions.map((s) => s.id).join(", ")}.`);
  }
  if (report.sources) L.push("", report.sources.text);
  return L.join(NL);
}
