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
// Matrix cells are keyed by period (pre / base / mid / post / after / none); only the periods that exist are listed.
function MatrixTable({ r }) {
  if (!r.totalCases) return <div style={{ fontSize: 12.5, marginTop: 6 }}>Chưa có ca bể nào của đơn thuộc phạm vi này ở bất kỳ kỳ nào.</div>;
  return (
    <>
      <div style={{ ...title, marginTop: 10 }}>Ca của đơn lấy trong kỳ X được ghi nhận ở kỳ Y</div>
      <div style={{ overflowX: "auto", marginTop: 4 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 520 }}>
          <thead><tr><th style={{ ...thw, textAlign: "left" }}>Đơn lấy ↓ · Ghi nhận →</th>{r.matrix.cols.map((c) => <th key={c.key} style={thw}>{c.label}</th>)}<th style={thw}>Cohort (tổng hàng)</th></tr></thead>
          <tbody>
            {r.matrix.rows.map((x) => (
              <tr key={x.key}><td style={{ ...td, textAlign: "left", whiteSpace: "normal", fontWeight: 600 }}>{x.label}</td>
                {r.matrix.cols.map((c) => { const v = x.cells[c.key] || 0, off = v > 0 && x.key !== c.key; return <td key={c.key} style={{ ...td, fontWeight: off ? 800 : 400, color: off ? "var(--amber)" : undefined }}>{v}</td>; })}
                <td style={{ ...td, fontWeight: 700 }}>{x.total}</td></tr>
            ))}
            <tr style={{ color: "var(--text-muted)", fontStyle: "italic" }}><td style={{ ...td, textAlign: "left" }}>Real-time (tổng cột)</td>{r.matrix.cols.map((c) => <td key={c.key} style={td}>{c.total}</td>)}<td style={td} /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
export function ReconcileBox({ r }) {
  if (!r) return null;
  const ks = ["base", ...(r.cohort.mid ? ["mid"] : []), "post"];
  const colName = { base: `Baseline ${fmtS(r.periods.base.from)}–${fmtS(r.periods.base.to)}`, mid: r.periods.mid ? `Giữa ${fmtS(r.periods.mid.from)}–${fmtS(r.periods.mid.to)}` : "", post: `Sau ${fmtS(r.periods.post.from)}–${fmtS(r.periods.post.to)}` };
  const view = (name, sub, v, strong) => (
    <tr style={strong ? undefined : { color: "var(--text-secondary)" }}>
      <td style={{ ...td, textAlign: "left", whiteSpace: "normal", minWidth: 220 }}><b>{name}</b><div style={small}>{sub}</div></td>
      {ks.map((k) => (
        <td key={k} style={{ ...td, fontWeight: k === "post" ? 700 : 400, ...(k === "mid" ? { fontStyle: "italic" } : null) }}>{pc2(v[k].pct)} <span style={small}>{n0(v[k].cases)} ca / {n0(v[k].orders)} đơn</span></td>
      ))}
      <td style={{ ...td, fontWeight: 700, color: dirColor(v.dir) }}>{changeText(v)}</td>
    </tr>
  );
  return (
    <div style={box}>
      <div style={{ ...title, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>⚖ Đối soát 2 góc nhìn bể vỡ <span style={{ ...small, fontWeight: 400 }}>nhận định tự động giữ nguyên theo cohort</span></div>
      <div style={small}>Câu hỏi khối này trả lời: tỷ lệ bể vỡ giảm là thật, hay chỉ do ca được ghi nhận lệch sang kỳ khác?</div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: ks.length > 2 ? 760 : 620 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Góc nhìn</th>{ks.map((k) => <th key={k} style={th}>{colName[k]}{k === "mid" && <div style={{ ...small, fontWeight: 400, fontSize: 10.5 }}>chỉ để biết</div>}</th>)}<th style={th} title="% thay đổi tương đối của % bể vỡ, Baseline → Sau">Thay đổi</th></tr></thead>
          <tbody>
            {view("Cohort", "ca của đơn lấy trong kỳ (cách tính của nhận định tự động)", r.cohort, true)}
            {view("Real-time (tham khảo)", "ca có ngày ghi nhận Rillnet trong kỳ ÷ đơn lấy trong kỳ", r.realtime, false)}
          </tbody>
        </table>
      </div>
      {r.mid && (
        <div style={{ fontSize: 12.5, marginTop: 8, padding: "6px 10px", borderRadius: 6, border: "1px dashed var(--amber)" }}>
          <b>Kỳ giữa {fmtS(r.mid.from)}–{fmtS(r.mid.to)}</b> — {r.mid.text.replace(/^Kỳ giữa [^:]*: /, "")}
        </div>
      )}
      <MatrixTable r={r} />
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

// ── Phạm vi khách của giải pháp (input) ───────────────────────────────────
export function ClientScopeBox({ report }) {
  const cs = report.clientScope;
  if (!cs) return null;
  const chip = { none: ["chưa có đơn trong Baseline", "var(--red)"], partial: ["Baseline thiếu ngày", "var(--amber)"], ok: ["đủ Baseline", "var(--green)"] };
  return (
    <div style={box}>
      <div style={title}>👥 Phạm vi khách của giải pháp</div>
      <div style={small}>Mọi số trong báo cáo chỉ tính cho các khách dưới đây. "Cả nước" chỉ bỏ lọc kho/tỉnh, không thêm khách.</div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 560 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Khách</th><th style={th}>Đơn (từ 01/07)</th><th style={th}>Đơn đầu tiên</th><th style={th}>Đơn trong Baseline</th><th style={{ ...th, textAlign: "left" }}>Baseline</th></tr></thead>
          <tbody>{cs.clients.map((c) => (
            <tr key={c.name}><td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{c.name}</td><td style={td}>{n0(c.orders)}</td><td style={td}>{c.firstPickup ? `${c.firstPickup.slice(8, 10)}/${c.firstPickup.slice(5, 7)}` : "—"}</td><td style={td}>{n0(c.baselineOrders)} <span style={small}>({c.baselineDaysCovered}/{c.baselineDays} ngày)</span></td>
              <td style={{ ...td, textAlign: "left", fontWeight: 700, color: chip[c.baselineStatus][1] }}>{chip[c.baselineStatus][0]}</td></tr>))}</tbody>
        </table>
      </div>
      {cs.warnings.map((t, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 3 }}>{t}</div>)}
      {cs.siblings.length > 0 && (
        <div style={{ fontSize: 12.5, marginTop: 6 }}><b>Khách cùng nhóm chưa có trong giải pháp</b> <span style={small}>(gợi ý theo tên)</span>: {cs.siblings.map((x) => `${x.name} — ${n0(x.orders)} đơn, ${x.cases} ca bể`).join("; ")}.</div>
      )}
    </div>
  );
}

// ── Độ phủ (cả giải pháp) ─────────────────────────────────────────────────
const srcShort = (x) => (x.source?.all ? "mọi kho lấy" : (x.source?.names || []).map((n) => n.replace(/^Key Account Warehouse /, "KA WH ").replace(/^Kho Giao Hàng Nặng - /, "")).join(", ") + (x.source?.merged?.length ? ` (+${x.source.merged.length} kho cùng cụm)` : ""));
export function CoverageBox({ report }) {
  const cov = report.coverage;
  if (!cov) return null;
  const S = cov.solution;
  const full = cov.phases.filter((x) => x.fullClient && x.active !== false).map((x) => x.label);
  const row = (label, x, bold) => (
    <tr key={label} style={bold ? { background: "rgba(var(--brand-rgb),0.06)" } : undefined}>
      <td style={{ ...td, textAlign: "left", fontWeight: bold ? 800 : 600 }}>{label}{bold && <div style={small}>gộp các giai đoạn, mỗi giai đoạn từ ngày bắt đầu của nó; đơn trùng chỉ tính 1 lần</div>}</td>
      <td style={td}>{x.active === false ? "chưa áp dụng" : `${fmtS(x.from)}–${fmtS(x.to)}`}</td>
      <td style={{ ...td, fontWeight: 700 }}>{n0(x.orders)} <span style={small}>đơn</span> · {n1(x.tons)} <span style={small}>tấn</span></td>
      <td style={td}>{x.fullClient ? <b>toàn bộ khách</b> : <>{pc1(x.pctClientOrders)} <span style={small}>đơn</span> · {pc1(x.pctClientTons)} <span style={small}>tấn</span></>}</td>
      <td style={{ ...td, whiteSpace: "normal", textAlign: "left", maxWidth: 230 }}><span style={small}>{bold ? "kho nguồn của các giai đoạn (gộp)" : srcShort(x)}</span><div>{n0(x.allOrders)} đơn · {n1(x.allTons)} t</div></td>
      <td style={{ ...td, fontWeight: 700 }}>{pc1(x.pctOrders)} <span style={small}>đơn</span> · {pc1(x.pctTons)} <span style={small}>tấn</span></td>
    </tr>
  );
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>🧭 Độ phủ tách tuyến</div>
      <div style={small}>Câu hỏi khối này trả lời: giải pháp đang áp dụng cho bao nhiêu đơn — so với khách áp dụng, và so với tổng điện máy xuất từ cùng kho nguồn?</div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 820 }}>
          <thead><tr><th style={{ ...thw, textAlign: "left" }}>Giai đoạn</th><th style={thw}>Kỳ tính</th><th style={thw}>Thuộc phạm vi</th><th style={thw} title="Phạm vi ÷ đơn/tấn của các khách áp dụng, cùng kho nguồn, cùng kỳ">Trong khách áp dụng</th><th style={{ ...thw, textAlign: "left" }} title="Mẫu số: mọi đơn điện máy (mọi khách) xuất từ kho nguồn của giai đoạn trong kỳ tính">Mẫu số: kho nguồn · tổng điện máy</th><th style={thw} title="Phạm vi ÷ tổng điện máy xuất từ kho nguồn">Độ phủ (% tổng điện máy)</th></tr></thead>
          <tbody>
            {cov.phases.map((x) => row(x.label, x, false))}
            {cov.phases.length > 1 && row("Cả giải pháp", { ...S, active: S.phases > 0 }, true)}
          </tbody>
        </table>
      </div>
      {full.length > 0 && <div style={{ fontSize: 12.5, marginTop: 4 }}>{full.join(", ")} đã phủ toàn bộ đơn của khách áp dụng — phần chưa được phủ nằm ở các khách khác (xem "Khoảng trống").</div>}
      <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 2 }}>⚠ {cov.note}</div>
    </div>
  );
}

// ── Khoảng trống mở rộng ──────────────────────────────────────────────────
function GapTable({ title: t, dim, flag, siblings }) {
  if (!dim.total) return null;
  return (
    <details open={flag} style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>{t} <span style={{ ...small, fontWeight: 400 }}>— {dim.total} mục{flag ? `, ${dim.enoughCount} ứng viên đủ volume` : ""}{dim.total > dim.list.length ? ` (hiện ${dim.list.length} đầu)` : ""}</span></summary>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 700 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Tên</th><th style={th}>Đơn</th><th style={th}>Tấn</th><th style={th}>Đơn / tuần</th><th style={th}>Tấn / tuần</th><th style={thw} title="Ca bể của các đơn cùng luồng (từ kho nguồn → mục này) từ 01/07/2026 đến nay">Ca bể 01/07→nay</th>{flag && <th style={th}>Ứng viên</th>}</tr></thead>
          <tbody>{dim.list.map((x) => (
            <tr key={x.name} style={x.enough ? { background: "rgba(var(--brand-rgb),0.08)" } : undefined}>
              <td style={{ ...td, textAlign: "left", whiteSpace: "normal", fontWeight: 600 }}>{x.name}{siblings && siblings.has(x.name) && <span style={{ ...small, color: "var(--amber)", fontWeight: 700 }}> · cùng nhóm với khách áp dụng</span>}</td>
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
  const g = report.gaps;
  const [scope, setScope] = useState(null);
  if (!g) return null;
  // Own clients fully covered → nothing to show there: open on "Mọi khách" (the other clients that no solution touches yet).
  const cur = scope || (g.applied.gapOrders > 0 ? "applied" : "all");
  const sc = g[cur];
  const sibs = new Set((report.clientScope?.siblings || []).map((x) => x.name));
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>🧩 Khoảng trống mở rộng</span>
        <button style={seg(cur === "applied")} onClick={() => setScope("applied")}>Khách áp dụng</button>
        <button style={seg(cur === "all")} onClick={() => setScope("all")}>Mọi khách</button>
      </div>
      <div style={small}>Câu hỏi khối này trả lời: còn sản lượng nào xuất từ kho nguồn ({g.source}) mà chưa có giải pháp nào trong Sổ tay, và đáng làm tiếp ở đâu? Kỳ xét {fmtS(g.from)}→{fmtS(g.to)}.</div>
      <div style={{ fontSize: 12.5, marginTop: 4, fontWeight: 600 }}>{g.summary[cur === "applied" ? 0 : 1]}</div>
      {cur === "applied" && g.applied.gapOrders === 0 && <div style={{ fontSize: 12.5, marginTop: 2 }}>Các khách áp dụng đã nằm trọn trong giải pháp. Bấm "Mọi khách" để xem khách khác chưa được chạm.</div>}
      <div style={{ ...small, marginTop: 2 }}>{g.ruleText}</div>
      <GapTable title="Theo khách" dim={sc.byClient} flag={false} siblings={sibs} />
      <GapTable title="Theo tỉnh giao" dim={sc.byProvince} flag />
      <GapTable title="Theo kho giao" dim={sc.byWarehouse} flag />
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
export function ClientScopePrint({ report, C, cell, hc }) {
  const cs = report.clientScope;
  if (!cs) return null;
  const st = { none: "chưa có đơn trong Baseline", partial: "Baseline thiếu ngày", ok: "đủ Baseline" };
  return (
    <div style={{ marginTop: 14, breakInside: "avoid" }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>👥 Phạm vi khách của giải pháp</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead><tr>{["Khách", "Đơn từ 01/07", "Đơn đầu tiên", "Đơn trong Baseline", "Baseline"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i && i < 4 ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>{cs.clients.map((c) => <tr key={c.name}><td style={{ ...cell, textAlign: "left", fontWeight: 700 }}>{c.name}</td><td style={cell}>{n0(c.orders)}</td><td style={cell}>{c.firstPickup ? fmtS(c.firstPickup) : "—"}</td><td style={cell}>{n0(c.baselineOrders)} ({c.baselineDaysCovered}/{c.baselineDays} ngày)</td><td style={{ ...cell, textAlign: "left", color: c.baselineStatus === "ok" ? C.green : C.red, fontWeight: 700 }}>{st[c.baselineStatus]}</td></tr>)}</tbody>
      </table>
      {cs.warnings.map((t, i) => <div key={i} style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>{t}</div>)}
      {cs.siblings.length > 0 && <div style={{ fontSize: 11, marginTop: 3 }}><b>Khách cùng nhóm chưa có trong giải pháp</b>: {cs.siblings.map((x) => `${x.name} — ${n0(x.orders)} đơn, ${x.cases} ca bể`).join("; ")}.</div>}
    </div>
  );
}
export function ReconcilePrint({ r, C, cell, hc }) {
  if (!r) return null;
  const ks = ["base", ...(r.cohort.mid ? ["mid"] : []), "post"];
  const nm = { base: "Baseline", mid: "Giữa", post: "Sau" };
  const vr = (name, v) => [name, ...ks.map((k) => `${pc2(v[k].pct)} (${v[k].cases}/${n0(v[k].orders)})`), changeText(v)];
  return (
    <div style={{ marginTop: 8, breakInside: "avoid" }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>⚖ Đối soát 2 góc nhìn bể vỡ <span style={{ fontWeight: 400, color: C.muted }}>— nhận định tự động theo cohort</span></div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead><tr>{["Góc nhìn", ...ks.map((k) => nm[k]), "Thay đổi"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>{[vr("Cohort — ca của đơn lấy trong kỳ", r.cohort), vr("Real-time — ca ghi nhận trong kỳ (tham khảo)", r.realtime)].map((row) => <tr key={row[0]}>{row.map((c2, i) => <td key={i} style={{ ...cell, textAlign: i ? "right" : "left", whiteSpace: i ? "nowrap" : "normal" }}>{c2}</td>)}</tr>)}</tbody>
      </table>
      {r.mid && <div style={{ fontSize: 11, marginTop: 3 }}>• {r.mid.text}</div>}
      {r.totalCases > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
          <thead><tr><th style={{ ...hc, textAlign: "left" }}>Đơn lấy ↓ · Ghi nhận →</th>{r.matrix.cols.map((c) => <th key={c.key} style={{ ...hc, whiteSpace: "normal" }}>{c.label}</th>)}<th style={hc}>Cohort</th></tr></thead>
          <tbody>{r.matrix.rows.map((x) => <tr key={x.key}><td style={{ ...cell, textAlign: "left", whiteSpace: "normal" }}>{x.label}</td>{r.matrix.cols.map((c) => <td key={c.key} style={cell}>{x.cells[c.key] || 0}</td>)}<td style={{ ...cell, fontWeight: 700 }}>{x.total}</td></tr>)}
            <tr><td style={{ ...cell, textAlign: "left", color: C.muted }}>Real-time</td>{r.matrix.cols.map((c) => <td key={c.key} style={{ ...cell, color: C.muted }}>{c.total}</td>)}<td style={cell} /></tr></tbody>
        </table>
      ) : <div style={{ fontSize: 11, marginTop: 3 }}>Chưa có ca bể nào của đơn thuộc phạm vi này.</div>}
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
  const mk = (name, x) => [name, x.active === false ? "chưa áp dụng" : `${fmtS(x.from)}–${fmtS(x.to)}`, `${n0(x.orders)} đơn · ${n1(x.tons)} t`, x.fullClient ? "toàn bộ khách" : `${pc1(x.pctClientOrders)} · ${pc1(x.pctClientTons)}`, `${n0(x.allOrders)} đơn · ${n1(x.allTons)} t (${x.source ? srcShort(x) : "kho nguồn của các giai đoạn, gộp"})`, `${pc1(x.pctOrders)} · ${pc1(x.pctTons)}`];
  const rows = [...cov.phases.map((x) => mk(x.label, x)), ...(cov.phases.length > 1 ? [mk("Cả giải pháp (không đếm trùng)", { ...S, active: S.phases > 0 })] : [])];
  const gapTable = (t, dim, flag) => (!dim.total ? null : (
    <div key={t} style={{ marginTop: 5 }}>
      <div style={{ fontSize: 11, fontWeight: 700 }}>{t} <span style={{ fontWeight: 400, color: C.muted }}>({dim.total} mục{flag ? `, ${dim.enoughCount} đủ volume` : ""}; hiện {Math.min(8, dim.list.length)} đầu)</span></div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Tên", "Đơn", "Tấn", "Đơn/tuần", "Tấn/tuần", "Ca bể 01/07→nay", ...(flag ? ["Ứng viên"] : [])].map((h, i) => <th key={h} style={{ ...hc, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>{dim.list.slice(0, 8).map((x) => <tr key={x.name}><td style={{ ...cell, textAlign: "left", whiteSpace: "normal" }}>{x.name}</td><td style={cell}>{n0(x.orders)}</td><td style={cell}>{n1(x.tons)}</td><td style={cell}>{n1(x.perWeekOrders)}</td><td style={cell}>{n2(x.perWeekTons)}</td><td style={cell}>{n0(x.pastCases)} ({pc2(x.pastPct)})</td>{flag && <td style={{ ...cell, fontWeight: 700, color: C.green }}>{x.enough ? "★ đủ volume" : ""}</td>}</tr>)}</tbody>
      </table>
    </div>));
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 800 }}>🧭 Độ phủ tách tuyến</div>
      <div style={{ fontSize: 10, color: C.muted }}>Trả lời: giải pháp áp dụng cho bao nhiêu đơn — so với khách áp dụng và so với tổng điện máy xuất từ cùng kho nguồn.</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead><tr>{["Giai đoạn", "Kỳ tính", "Thuộc phạm vi", "Trong khách áp dụng", "Mẫu số: kho nguồn · tổng điện máy", "Độ phủ (đơn · tấn)"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i > 1 && i !== 4 ? "right" : "left", whiteSpace: "normal" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row[0]}>{row.map((c2, i) => <td key={i} style={{ ...cell, textAlign: i > 1 && i !== 4 ? "right" : "left", whiteSpace: i === 4 ? "normal" : "nowrap", fontWeight: i === 0 ? 700 : 400 }}>{c2}</td>)}</tr>)}</tbody>
      </table>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Mỗi giai đoạn tính từ ngày bắt đầu của nó; cả giải pháp gộp các giai đoạn, đơn trùng chỉ tính 1 lần. ⚠ {cov.note}</div>
      {g && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>🧩 Khoảng trống mở rộng</div>
          <div style={{ fontSize: 10, color: C.muted }}>Trả lời: còn sản lượng nào từ kho nguồn chưa có giải pháp nào trong Sổ tay, và đáng làm tiếp ở đâu. {g.ruleText}</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>{g.summary[0]}</div>
          {gapTable("Theo tỉnh giao (khách áp dụng)", g.applied.byProvince, true)}
          {gapTable("Theo kho giao (khách áp dụng)", g.applied.byWarehouse, true)}
          <div style={{ fontSize: 11, marginTop: 8 }}>{g.summary[1]}</div>
          {gapTable("Theo khách (mọi khách)", g.all.byClient, false)}
          {gapTable("Theo tỉnh giao (mọi khách)", g.all.byProvince, true)}
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
  if (report.clientScope) L.push("", "PHẠM VI KHÁCH:", ...report.clientScope.text.map((t) => `  - ${t}`));
  for (const x of report.phases) {
    const r = x.reconcile;
    if (!r || report.display?.reconcile === false) continue;
    L.push("", `ĐỐI SOÁT 2 GÓC NHÌN BỂ VỠ — ${x.phase.label}:`);
    L.push(`  Cohort (ca của đơn lấy trong kỳ): ${pc2(r.cohort.base.pct)} (${r.cohort.base.cases}/${n0(r.cohort.base.orders)} đơn) → ${pc2(r.cohort.post.pct)} (${r.cohort.post.cases}/${n0(r.cohort.post.orders)} đơn), ${changeText(r.cohort)}`);
    L.push(`  Real-time (ca ghi nhận trong kỳ, tham khảo): ${pc2(r.realtime.base.pct)} (${r.realtime.base.cases} ca) → ${pc2(r.realtime.post.pct)} (${r.realtime.post.cases} ca), ${changeText(r.realtime)}`);
    if (r.mid) L.push(`  - ${r.mid.text}`);
    for (const t of [...r.notes, ...r.concentration, r.delayText]) L.push(`  - ${t}`);
    if (r.immature) L.push(`  ⚠ ${r.immature.text}`);
    if (r.warn) L.push(`  ${r.warn}`);
  }
  const cov = report.coverage;
  if (cov) {
    L.push("", "ĐỘ PHỦ TÁCH TUYẾN (đơn/tấn thuộc phạm vi giải pháp ÷ điện máy xuất từ kho nguồn):");
    for (const x of cov.phases) L.push(`  ${x.label}: ${n0(x.orders)} đơn / ${n1(x.tons)} t trên ${n0(x.allOrders)} đơn / ${n1(x.allTons)} t = ${pc1(x.pctOrders)} đơn · ${pc1(x.pctTons)} tấn; ${x.fullClient ? "phủ toàn bộ khách áp dụng" : `trong khách áp dụng ${pc1(x.pctClientOrders)} đơn · ${pc1(x.pctClientTons)} tấn`}`);
    if (cov.phases.length > 1) { const S = cov.solution; L.push(`  Cả giải pháp (gộp, không đếm trùng): ${n0(S.orders)} đơn / ${n1(S.tons)} t trên ${n0(S.allOrders)} đơn / ${n1(S.allTons)} t = ${pc1(S.pctOrders)} đơn · ${pc1(S.pctTons)} tấn; trong khách áp dụng ${pc1(S.pctClientOrders)} đơn · ${pc1(S.pctClientTons)} tấn`); }
    L.push(`  ⚠ ${cov.note}`);
  }
  const g = report.gaps;
  if (g) {
    L.push("", "KHOẢNG TRỐNG MỞ RỘNG:", `  ${g.summary[0]}`, `  ${g.summary[1]}`);
    const top = (label, dim) => { const a = dim.list.slice(0, 5); if (a.length) L.push(`  ${label}: ${a.map((x) => `${x.name} ${n0(x.orders)} đơn/${n1(x.tons)} t${x.enough ? " ★" : ""}${x.pastCases ? ` (${x.pastCases} ca bể)` : ""}`).join("; ")}`); };
    top("Khách chưa được chạm", g.all.byClient); top("Tỉnh giao (khách áp dụng)", g.applied.byProvince); top("Kho giao (khách áp dụng)", g.applied.byWarehouse); top("Tỉnh giao (mọi khách)", g.all.byProvince);
    L.push(`  ${g.ruleText}`, `  Đã đối chiếu với ${g.checkedSolutions.length} giải pháp: ${g.checkedSolutions.map((s) => s.id).join(", ")}.`);
  }
  if (report.sources) L.push("", report.sources.text);
  return L.join(NL);
}
