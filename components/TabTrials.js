/**
 * components/TabTrials.js — "Sổ tay Cải tiến & Đo lường Giải pháp" with
 * PHASES (KẾ HOẠCH B, user decisions 2026-09-28).
 *
 * Outer table: one row per GIẢI PHÁP with its phases as chips (Trial 1 ✅ ·
 * Trial 2 ⏳), monitoring alerts, and [Sửa] [➕ Giai đoạn tiếp] [Xoá].
 * Detail (large modal): shared baseline, phase comparison, weekly chart,
 * "Theo dõi sau thành công" (month / week vs the period before), each
 * phase's before/after + verdict + photos; export Word / Excel / In-PDF.
 * Phases run in parallel; "➕ Giai đoạn tiếp" pre-fills the next name and
 * copies the previous phase's scope. Math: lib/trials.js + lib/solutions.js.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ReconcileBox, CoverageBox, GapsBox, SourcesLine, ReconcilePrint, CoveragePrint, SourcesPrint, reconcileCopyLines } from "./TrialsReconcile";
import { getJSON, prefetchJSON, dropPrefetched } from "../lib/prefetch";
import DateField from "./DateField";
import { SHOW_TRUY_THU } from "../lib/display-flags";
import { useChart, useTheme } from "./ltl/charts/chartUtils";

const DAY = 86400000;
const NL = String.fromCharCode(10);
const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const fmtS = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const n0 = (x) => (x == null ? "—" : Math.round(x).toLocaleString("vi-VN"));
const n1 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const n2 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sgn = (x, f) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${f(Math.abs(x))}`);
// % bể vỡ = ca ÷ đơn lấy × 100 (per1k ÷ 10) — user 28/09: thay "Ca/1.000 đơn" cho dễ hiểu, giống báo cáo công ty.
const bv = (per1k) => (per1k == null ? "—" : `${n2(per1k / 10)}%`);
const bvd = (d) => (d == null ? "—" : `${sgn(d / 10, n2)} điểm`);
const pctTxt = (x) => (x == null ? "—" : `${n1(x)}%`);
// Tiền (Kế hoạch E): triệu đồng, 1 số lẻ.
const tr = (x) => (x == null ? "—" : !x ? "0" : `${n1(x / 1e6)} tr`);
const trd = (x) => (x == null ? "—" : `${sgn(x / 1e6, n1)} tr`);
const MONEY_NOTE = SHOW_TRUY_THU
  ? "Tiền đền = số CS nhập theo mã đơn, có thể còn cập nhật sau QC. Truy thu = thu lại từ nhân viên GHN làm sai, không giảm thiệt hại → chỉ tham khảo, không trừ."
  : "Tiền đền = số dự kiến CS nhập theo mã đơn, có thể còn cập nhật sau khi khách QC.";
const coverageOf = (T) => `${n0(T.base.compWithAmount + T.post.compWithAmount)}/${n0(T.base.compensated + T.post.compensated)} ca đã chốt đền bù có số tiền`;
const vnStamp = (iso) => { if (!iso || Number.isNaN(Date.parse(iso))) return ""; const v = new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString(); return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}`; };
const shortWh = (s) => String(s || "").replace(/^Kho Giao Hàng Nặng - /, "").replace(/^Key Account Warehouse /, "KA WH ").trim();

const STATUS_STYLE = {
  "Đang trial": { color: "var(--cyan)", bg: "rgba(var(--brand-rgb),0.12)", icon: "⏳" },
  "Thành công": { color: "var(--green)", bg: "var(--green-glow, rgba(45,212,191,0.14))", icon: "✅" },
  "Đã thành solution chung": { color: "var(--green)", bg: "var(--green-glow, rgba(45,212,191,0.14))", icon: "🏁" },
  "Dừng": { color: "var(--text-muted)", bg: "rgba(127,127,127,0.14)", icon: "⏹" },
  "Đã hủy": { color: "var(--text-muted)", bg: "rgba(127,127,127,0.14)", icon: "⏹" },
};
const VERDICT_STYLE = {
  excellent: { color: "var(--green)", bg: "var(--green-glow)", icon: "🏆" },
  improved: { color: "var(--blue)", bg: "var(--blue-glow)", icon: "✅" },
  watch: { color: "var(--amber)", bg: "var(--amber-glow)", icon: "⏳" },
  ineffective: { color: "var(--red)", bg: "var(--red-glow)", icon: "⚠" },
};
const PHASE_COLORS = ["#f97316", "#2dd4bf", "#60a5fa", "#fbbf24", "#a78bfa", "#fb7185"];

const btnBase = { fontSize: 12.5, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 };
const primary = { ...btnBase, background: "rgba(var(--brand-rgb),0.12)", border: "1px solid rgba(var(--brand-rgb),0.35)", color: "var(--cyan)" };
const ghost = { ...btnBase, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" };
const danger = { ...ghost, color: "var(--red)" };
const mini = (b) => ({ ...b, padding: "3px 8px", fontSize: 11.5 });
const seg = (on) => ({ ...btnBase, fontWeight: 500, padding: "4px 10px", background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", border: "1px solid var(--border)", color: on ? "var(--cyan)" : "var(--text-muted)" });
const input = { padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" };
const dateInput = { ...input, width: "100%", padding: "7px 26px 7px 8px", fontSize: 13, border: "1px solid var(--border)", background: "var(--input-bg)" };
const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };
const label = { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4, display: "block" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 };

// Long client lists (VD 30 khách) collapse to the first few + "+N khách"; click to expand (user 29/09).
function ClientsCompact({ clients, max = 2 }) {
  const [open, setOpen] = useState(false);
  const list = clients || [];
  if (list.length <= max) return <span>{list.join(", ")}</span>;
  const linkStyle = { background: "none", border: "none", padding: 0, marginLeft: 4, cursor: "pointer", color: "var(--cyan)", fontSize: "inherit", fontFamily: "inherit", fontWeight: 600 };
  const toggle = (e) => { e.stopPropagation(); setOpen((v) => !v); };
  return open
    ? <span>{list.join(", ")} <button type="button" style={linkStyle} onClick={toggle}>Thu gọn</button></span>
    : <span title={list.join(", ")}>{list.slice(0, max).join(", ")}<button type="button" style={linkStyle} onClick={toggle}>+{list.length - max} khách</button></span>;
}

function StatusBadge({ s }) {
  const st = STATUS_STYLE[s] || STATUS_STYLE["Đang trial"];
  return <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 10, color: st.color, background: st.bg, whiteSpace: "nowrap" }}>{s}</span>;
}
function VerdictChip({ level, text }) {
  const st = VERDICT_STYLE[level] || VERDICT_STYLE.watch;
  return <span style={{ fontSize: 11, fontWeight: 700, color: st.color, whiteSpace: "nowrap" }}>{st.icon} {text}</span>;
}

// Searchable multi-select with order counts. Empty selection = "tất cả".
function MultiPick({ options, selected, onChange, placeholder, emptyText, disabled, render = (v) => v }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const sel = new Set(selected);
  const shown = options.filter((o) => !q || o.value.toLowerCase().includes(q.toLowerCase()));
  const orphans = selected.filter((v) => !options.some((o) => o.value === v));
  const toggle = (v) => onChange(sel.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = !selected.length ? placeholder : selected.length <= 2 ? selected.map(render).join(", ") : `${selected.length} mục đã chọn`;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}
        style={{ ...input, textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", color: selected.length ? "var(--text-primary)" : "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {summary} <span style={{ float: "right", opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0, minWidth: 260, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", padding: 8 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm…" style={{ ...input, marginBottom: 6 }} />
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {[...orphans.map((v) => ({ value: v, count: 0, orphan: true })), ...shown].map((o) => (
              <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px", fontSize: 12.5, cursor: "pointer", borderRadius: 4 }}>
                <input type="checkbox" checked={sel.has(o.value)} onChange={() => toggle(o.value)} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.value}>{render(o.value)}</span>
                <span style={{ color: o.orphan ? "var(--amber)" : "var(--text-muted)", fontSize: 11.5 }}>{o.orphan ? "không còn trong phạm vi" : n0(o.count)}</span>
              </label>
            ))}
            {!shown.length && !orphans.length && <div style={small}>{emptyText || "Không có mục khớp."}</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <button type="button" style={mini(ghost)} onClick={() => onChange([])}>Bỏ chọn hết</button>
            <button type="button" style={mini(primary)} onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  );
}

const unionOpts = (options, clients, field) => {
  const m = {};
  for (const c of clients || []) for (const [k, n] of Object.entries(options?.[c]?.[field] || {})) m[k] = (m[k] || 0) + n;
  return Object.entries(m).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
};
const scopeLine = (p) => [
  p.khoLay?.length ? `Lấy: ${p.khoLay.length === 1 ? shortWh(p.khoLay[0]) : `${p.khoLay.length} kho`}` : "",
  p.khoGiao?.length ? `Giao: ${p.khoGiao.length === 1 ? shortWh(p.khoGiao[0]) : `${p.khoGiao.length} kho`}` : "",
  p.provinces?.length ? `Tỉnh: ${p.provinces.length <= 2 ? p.provinces.join(", ") : `${p.provinces.length} tỉnh`}` : "",
].filter(Boolean).join(" · ") || "Toàn bộ đơn của khách";

// Scope pickers of a phase (options = clients of the solution).
function ScopeFields({ f, set, options, clients }) {
  return (
    <>
      <div><span style={label}>Kho lấy (xuất)</span><MultiPick options={unionOpts(options, clients, "khoLay")} selected={f.khoLay} onChange={(v) => set({ khoLay: v })} placeholder="Tất cả kho lấy" emptyText="Chọn khách trước" render={shortWh} /></div>
      <div><span style={label}>Kho giao</span><MultiPick options={unionOpts(options, clients, "khoGiao")} selected={f.khoGiao} onChange={(v) => set({ khoGiao: v })} placeholder="Tất cả kho giao" emptyText="Chọn khách trước" render={shortWh} /></div>
      <div><span style={label}>Tỉnh giao</span><MultiPick options={unionOpts(options, clients, "provinces")} selected={f.provinces} onChange={(v) => set({ provinces: v })} placeholder="Tất cả tỉnh giao" emptyText="Chọn khách trước" /></div>
    </>
  );
}
function PhaseDates({ f, set, statuses }) {
  return (
    <>
      <div><span style={label}>Ngày bắt đầu giai đoạn *</span><DateField label="Ngày bắt đầu" placeholder="dd/mm/yyyy" value={f.startDate} onChange={(v) => set({ startDate: v })} inputStyle={dateInput} wrapStyle={{ width: "100%" }} /></div>
      <div>
        <span style={label}>Ngày kết thúc</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {f.ongoing ? <div style={{ ...input, color: "var(--text-muted)" }}>Đang chạy (Ongoing)</div>
            : <DateField label="Ngày kết thúc" placeholder="dd/mm/yyyy" value={f.endDate} onChange={(v) => set({ endDate: v })} inputStyle={dateInput} wrapStyle={{ width: "100%" }} />}
          <label style={{ fontSize: 12.5, whiteSpace: "nowrap", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={f.ongoing} onChange={(e) => set({ ongoing: e.target.checked })} /> Ongoing
          </label>
        </div>
      </div>
      <div><span style={label}>Trạng thái giai đoạn</span>
        <select style={input} value={f.status} onChange={(e) => set({ status: e.target.value })}>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </div>
    </>
  );
}
async function post(body) {
  const r = await fetch("/api/trials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || "Không lưu được");
  return j;
}

// New solution (+ Trial 1) / edit solution / turn a legacy trial into a solution.
function SolutionForm({ initial, isNew, legacyPhase, options, statuses, onCancel, onSaved }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setErr(null); };
  const clientOpts = useMemo(() => Object.entries(options || {}).map(([value, o]) => ({ value, count: o.orders })).sort((a, b) => b.count - a.count), [options]);
  const firstStart = isNew ? f.phase.startDate : (f.firstPhaseStart || "");
  const sug = firstStart ? (() => { const today = vnToday(); const len = Math.max(7, daysBetween(firstStart, today > firstStart ? today : addDays(firstStart, 13))); const be = addDays(firstStart, -1); return { baseStart: addDays(be, -(len - 1)), baseEnd: be }; })() : null;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { action: "saveSolution", solution: { id: f.id, name: f.name, clients: f.clients, baseStart: f.baseStart, baseEnd: f.baseEnd, status: f.status, description: f.description } };
      if (isNew) body.firstPhase = { ...f.phase, endDate: f.phase.ongoing ? "" : f.phase.endDate };
      if (legacyPhase) { body.adoptPhaseIds = [legacyPhase.id]; body.adoptLabels = ["Trial 1"]; }
      const j = await post(body);
      onSaved(j);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const setPhase = (patch) => set({ phase: { ...f.phase, ...patch } });
  return (
    <div className="glass fade-in" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{isNew ? "Thêm giải pháp mới" : legacyPhase ? "Lưu thành giải pháp có giai đoạn" : "Sửa giải pháp"}</div>
      {legacyPhase && <div style={{ ...small, marginBottom: 8, color: "var(--amber)" }}>Giải pháp cũ (chưa có giai đoạn): lưu xong nó thành giải pháp gồm <b>Trial 1</b> = phạm vi và thời gian hiện tại. Sau đó dùng "➕ Giai đoạn tiếp".</div>}
      <div style={grid}>
        <div style={{ gridColumn: "1 / -1" }}><span style={label}>Tên giải pháp *</span><input style={input} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="VD: Sử dụng CCDC thùng nhựa 220L — PSD Miền Nam" /></div>
        <div><span style={label}>Khách hàng áp dụng *</span><MultiPick options={clientOpts} selected={f.clients} onChange={(v) => set({ clients: v })} placeholder={options ? "Chọn khách…" : "Đang tải…"} disabled={!options} /></div>
        <div><span style={label}>Trạng thái giải pháp</span><select style={input} value={f.status} onChange={(e) => set({ status: e.target.value })}>{statuses.solution.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "end", padding: 12, borderRadius: 8, border: "1px dashed var(--border)" }}>
          <div style={{ gridColumn: "1 / -1", fontSize: 12.5, fontWeight: 700 }}>Baseline CHUNG — trước giai đoạn đầu tiên (mọi giai đoạn so với khoảng này) *</div>
          <div><span style={label}>Từ ngày</span><DateField label="Baseline từ" placeholder="dd/mm/yyyy" value={f.baseStart} onChange={(v) => set({ baseStart: v })} inputStyle={dateInput} wrapStyle={{ width: "100%" }} /></div>
          <div><span style={label}>Đến ngày</span><DateField label="Baseline đến" placeholder="dd/mm/yyyy" value={f.baseEnd} onChange={(v) => set({ baseEnd: v })} inputStyle={dateInput} wrapStyle={{ width: "100%" }} /></div>
          <div><button type="button" style={{ ...ghost, width: "100%" }} disabled={!sug} onClick={() => sug && set(sug)}>↺ Gợi ý: cùng số ngày, ngay trước</button></div>
          <div style={{ gridColumn: "1 / -1", ...small }}>{sug ? `Gợi ý ${fmt(sug.baseStart)} – ${fmt(sug.baseEnd)} (ngay trước ngày bắt đầu giai đoạn đầu). ` : ""}Nên tránh khoảng có sự kiện bất thường. Dữ liệu có từ 01/07/2026.</div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}><span style={label}>Mô tả chung</span><textarea style={{ ...input, minHeight: 70, resize: "vertical" }} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Giải pháp là gì, sản phẩm áp dụng, CCDC, người phụ trách…" /></div>
        {isNew && (
          <div style={{ gridColumn: "1 / -1", ...grid, padding: 12, borderRadius: 8, background: "rgba(var(--brand-rgb),0.05)", border: "1px solid var(--border)" }}>
            <div style={{ gridColumn: "1 / -1", fontSize: 12.5, fontWeight: 700 }}>Giai đoạn đầu tiên</div>
            <div><span style={label}>Tên giai đoạn *</span><input style={input} value={f.phase.label} onChange={(e) => setPhase({ label: e.target.value })} /></div>
            <ScopeFields f={f.phase} set={setPhase} options={options} clients={f.clients} />
            <PhaseDates f={f.phase} set={setPhase} statuses={statuses.phase} />
            <div style={{ gridColumn: "1 / -1" }}><span style={label}>Mô tả giai đoạn</span><textarea style={{ ...input, minHeight: 50, resize: "vertical" }} value={f.phase.description} onChange={(e) => setPhase({ description: e.target.value })} placeholder="Tuyến áp dụng, thay đổi so với trước…" /></div>
          </div>
        )}
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 10 }}>⚠ {err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button style={primary} disabled={busy} onClick={submit}>{busy ? "Đang lưu…" : "💾 Lưu giải pháp"}</button>
        <button style={ghost} disabled={busy} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}

// New phase ("➕ Giai đoạn tiếp") or edit a phase.
function PhaseForm({ solution, initial, options, statuses, onCancel, onSaved }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setErr(null); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onSaved(await post({ action: "savePhase", solutionId: solution.id, phase: { ...f, endDate: f.ongoing ? "" : f.endDate } })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const allOrders = () => set({ khoLay: [], khoGiao: [], provinces: [] });
  return (
    <div className="glass fade-in" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{f.id ? `Sửa ${f.label}` : "➕ Giai đoạn tiếp theo"} <span style={{ ...small, fontWeight: 400 }}>· {solution.name}</span></div>
      <div style={{ ...small, marginBottom: 10 }}>Baseline chung {fmt(solution.baseStart)} – {fmt(solution.baseEnd)} · khách <ClientsCompact clients={solution.clients} max={3} />. {f.id ? "" : "Phạm vi đã chép từ giai đoạn trước — sửa lại cho giai đoạn này. Giai đoạn cũ vẫn chạy song song."}</div>
      <div style={grid}>
        <div><span style={label}>Tên giai đoạn *</span><input style={input} value={f.label} onChange={(e) => set({ label: e.target.value })} list="phase-names" />
          <datalist id="phase-names">{["Trial 1", "Trial 2", "Trial 3", "Trial 4", "Nhân rộng cả nước"].map((n) => <option key={n} value={n} />)}</datalist></div>
        <ScopeFields f={f} set={set} options={options} clients={solution.clients} />
        <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={{ ...ghost, width: "100%" }} onClick={allOrders} title="Bỏ chọn kho / tỉnh = toàn bộ đơn của khách">🌏 Cả nước (toàn bộ đơn)</button></div>
        <PhaseDates f={f} set={set} statuses={statuses.phase} />
        <div style={{ gridColumn: "1 / -1" }}><span style={label}>Mô tả giai đoạn</span><textarea style={{ ...input, minHeight: 60, resize: "vertical" }} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Tuyến áp dụng, thay đổi so với giai đoạn trước…" /></div>
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 10 }}>⚠ {err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button style={primary} disabled={busy} onClick={submit}>{busy ? "Đang lưu…" : "💾 Lưu giai đoạn"}</button>
        <button style={ghost} disabled={busy} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}
const nextLabel = (sol) => {
  const nums = sol.phases.map((p) => (String(p.label).match(/^Trial\s*(\d+)/i) || [])[1]).filter(Boolean).map(Number);
  return `Trial ${(nums.length ? Math.max(...nums) : sol.phases.length) + 1}`;
};
const nextPhasePreset = (sol) => {
  const last = sol.phases[sol.phases.length - 1] || {};
  return { id: "", label: nextLabel(sol), khoLay: last.khoLay || [], khoGiao: last.khoGiao || [], provinces: last.provinces || [], startDate: vnToday(), endDate: "", ongoing: true, status: "Đang trial", description: "" };
};

// ── Report pieces ──────────────────────────────────────────────────────
function toneOf(x, good) { if (x == null || !good || Math.abs(x) < 1e-9) return "var(--text-secondary)"; return x * good > 0 ? "var(--green)" : "var(--red)"; }
function metricRows(imp) {
  const t = imp.trial, c = imp.control;
  const pct = (x) => (x == null ? "—" : `${sgn(x, n1)}%`);
  return [
    { key: "orders", name: "Tổng đơn", b: n0(t.base.orders), p: n0(t.post.orders), d: sgn(t.delta.orders, n0), dp: pct(t.delta.ordersPct), dRaw: t.delta.orders, good: 0, cb: n0(c.base.orders), cp: n0(c.post.orders), net: "—" },
    { key: "tons", name: "Tổng tấn", b: n1(t.base.tons), p: n1(t.post.tons), d: sgn(t.delta.tons, n1), dp: pct(t.delta.tonsPct), dRaw: t.delta.tons, good: 0, cb: n1(c.base.tons), cp: n1(c.post.tons), net: "—" },
    { key: "ontime", name: "% On-time", b: pctTxt(t.base.ontimePct), p: pctTxt(t.post.ontimePct), d: t.delta.ontimePts == null ? "—" : `${sgn(t.delta.ontimePts, n1)} điểm`, dp: "", dRaw: t.delta.ontimePts, good: 1, cb: pctTxt(c.base.ontimePct), cp: pctTxt(c.post.ontimePct), net: imp.net.ontimePts == null ? "—" : `${sgn(imp.net.ontimePts, n1)} điểm`, netRaw: imp.net.ontimePts },
    { key: "cases", name: "Ca bể vỡ", b: n0(t.base.cases), p: n0(t.post.cases), d: sgn(t.delta.cases, n0), dp: pct(t.delta.casesPct), dRaw: t.delta.cases, good: -1, cb: n0(c.base.cases), cp: n0(c.post.cases), net: "—" },
    { key: "per1k", name: "% Bể vỡ", b: bv(t.base.per1k), p: bv(t.post.per1k), d: bvd(t.delta.per1k), dp: pct(t.delta.per1kPct), dRaw: t.delta.per1k, good: -1, cb: bv(c.base.per1k), cp: bv(c.post.per1k), net: imp.net.per1kPct == null ? "—" : pct(imp.net.per1kPct), netRaw: imp.net.per1kPct },
    ...(t.base.comp == null ? [] : [
      { key: "comp", name: "Tiền đền cho khách", money: true, b: tr(t.base.comp), p: tr(t.post.comp), d: trd(t.delta.comp), dp: pct(t.delta.compPct), dRaw: t.delta.comp, good: -1, cb: tr(c.base.comp), cp: tr(c.post.comp), net: "—" },
      ...(!SHOW_TRUY_THU ? [] : [{ key: "truyThu", name: "Truy thu (tham khảo)", money: true, ref: true, b: tr(t.base.truyThu), p: tr(t.post.truyThu), d: trd(t.delta.truyThu), dp: "", dRaw: null, good: 0, cb: tr(c.base.truyThu), cp: tr(c.post.truyThu), net: "—" }]),
    ]),
  ];
}
const th = { padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap", fontSize: 11.5 };
const thw = { ...th, whiteSpace: "normal" };
const td = { padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5, borderBottom: "1px solid var(--panel-border-soft, var(--border))" };

// "Ước tính tiết kiệm" (Kế hoạch E) — tiền là thông tin thêm, nhận định giữ nguyên.
function SavingsBox({ imp }) {
  const sv = imp.savings;
  const color = !sv.ok ? "var(--text-muted)" : sv.value >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, border: "1px dashed var(--border)", background: "rgba(var(--brand-rgb),0.04)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>💰 Tiền đền cho khách · ước tính</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color }}>{sv.text}</span>
      </div>
      <div style={small}>{coverageOf(imp.trial)} · {MONEY_NOTE}</div>
      {sv.notes.filter((x) => !x.startsWith("Tiền đền = ")).map((x, i) => <div key={i} style={small}>Lưu ý: {x}</div>)}
    </div>
  );
}

function PhaseImpact({ impact }) {
  const [showCases, setShowCases] = useState(false);
  const imp = impact, pr = imp.periods, v = imp.verdict, st = VERDICT_STYLE[v.level];
  const rows = metricRows(imp);
  const cases = imp.trial.base.caseCodes.concat(imp.trial.post.caseCodes);
  return (
    <div>
      <div style={{ padding: "10px 12px", borderRadius: 8, background: st.bg, border: `1px solid ${st.color}`, borderLeftWidth: 4, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Nhận định</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: st.color }}>{st.icon} {v.label}</span>
          <span style={small}>{v.basis === "net" ? "theo hiệu quả ròng (đã trừ nhóm đối chứng)" : "theo thay đổi của phạm vi"}</span>
        </div>
        {v.reasons.map((s, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>• {s}</div>)}
        {v.notes.map((s, i) => <div key={`n${i}`} style={{ ...small }}>Lưu ý: {s}</div>)}
      </div>
      {imp.warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: "var(--amber)" }}>⚠ {w.text}</div>)}
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: imp.hasControl ? 760 : 480 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>Chỉ số</th>
            <th style={th}>Trước<div style={{ ...small, fontWeight: 400, fontSize: 10.5 }}>{fmtS(pr.base.from)}–{fmtS(pr.base.to)}</div></th>
            <th style={th}>Sau<div style={{ ...small, fontWeight: 400, fontSize: 10.5 }}>{fmtS(pr.post.from)}–{fmtS(pr.post.to)}{pr.post.ongoing ? "*" : ""}</div></th>
            <th style={th}>Chênh lệch</th><th style={th}>%</th>
            {imp.hasControl && <><th style={th}>Đối chứng trước → sau</th><th style={th} title="Thay đổi của phạm vi trừ thay đổi của đối chứng">Hiệu quả ròng</th></>}
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} style={r.ref ? { color: "var(--text-muted)", fontStyle: "italic" } : r.money ? { background: "rgba(var(--brand-rgb),0.04)" } : undefined}>
              <td style={{ ...td, textAlign: "left", fontWeight: 600 }} title={r.money ? MONEY_NOTE : undefined}>{r.name}</td>
              <td style={td}>{r.b}</td><td style={{ ...td, fontWeight: 700 }}>{r.p}</td>
              <td style={{ ...td, fontWeight: 700, color: toneOf(r.dRaw, r.good) }}>{r.d}</td><td style={{ ...td, color: toneOf(r.dRaw, r.good) }}>{r.dp}</td>
              {imp.hasControl && <><td style={{ ...td, color: "var(--text-muted)" }}>{r.cb} → {r.cp}</td><td style={{ ...td, fontWeight: 700, color: toneOf(r.netRaw, r.good) }}>{r.net}</td></>}
            </tr>))}</tbody>
        </table>
      </div>
      {imp.savings && <SavingsBox imp={imp} />}
      {cases.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button style={mini(ghost)} onClick={() => setShowCases((x) => !x)}>{showCases ? "Ẩn ca bể vỡ" : `Xem ${cases.length} ca bể vỡ`}</button>
          {showCases && (
            <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
              <table className="data-table" style={{ fontSize: 11.5 }}><thead><tr><th>Giai đoạn</th><th>Mã đơn</th><th>Ngày phát hiện</th><th>Chặng</th><th>Kho phát hiện</th><th style={{ textAlign: "right" }}>Tiền đền</th>{SHOW_TRUY_THU && <th style={{ textAlign: "right" }}>Truy thu (tham khảo)</th>}</tr></thead>
                <tbody>{cases.map((c) => <tr key={c.order_code}><td>{c.period === "base" ? "Trước" : "Sau"}</td><td style={{ fontWeight: 700 }}>{c.order_code}</td><td>{c.case_date}</td><td>{c.leg}</td><td>{shortWh(c.warehouse)}</td><td style={{ textAlign: "right" }}>{c.comp_amount ? `${c.comp_amount.toLocaleString("vi-VN")}đ` : c.compensated ? <span style={small}>đã chốt, chưa có số</span> : "—"}</td>{SHOW_TRUY_THU && <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{c.truy_thu_amount ? `${c.truy_thu_amount.toLocaleString("vi-VN")}đ` : "—"}</td>}</tr>)}</tbody></table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Photos: compress to ≤ 1.600px JPEG in the browser, upload, caption, delete (Manager).
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Không đọc được ảnh")); };
    img.src = url;
  });
}
function ImageGallery({ phase, canEdit, canDelete, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [images, setImages] = useState(phase.images || []);
  const [big, setBig] = useState(null);
  useEffect(() => { setImages(phase.images || []); }, [phase.id, phase.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (files) => {
    setBusy(true); setMsg(null);
    try {
      let last = null;
      for (const file of files) {
        if (images.length >= 10) throw new Error("Mỗi giai đoạn tối đa 10 ảnh");
        const dataUrl = await compressImage(file);
        last = await post({ action: "uploadImage", phaseId: phase.id, dataUrl, caption: file.name.replace(/\.[^.]+$/, "") });
        setImages(last.images);
      }
      if (last) onChanged(last.version);
    } catch (e) { setMsg(`⚠ ${e.message}`); } finally { setBusy(false); }
  };
  const caption = async (path, text) => { try { const j = await post({ action: "captionImage", phaseId: phase.id, path, caption: text }); setImages(j.images); onChanged(j.version); } catch (e) { setMsg(`⚠ ${e.message}`); } };
  const remove = async (path) => { if (!confirm("Xoá ảnh này?")) return; try { const j = await post({ action: "deleteImage", phaseId: phase.id, path }); setImages(j.images); onChanged(j.version); } catch (e) { setMsg(`⚠ ${e.message}`); } };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>Ảnh minh hoạ ({images.length}/10)</span>
        {canEdit && images.length < 10 && (
          <label style={{ ...mini(primary), display: "inline-flex", alignItems: "center", gap: 4 }}>
            {busy ? "Đang tải lên…" : "📷 Thêm ảnh"}
            <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => { const fl = [...e.target.files]; e.target.value = ""; if (fl.length) upload(fl); }} />
          </label>
        )}
        {msg && <span style={{ fontSize: 12, color: "var(--red)" }}>{msg}</span>}
      </div>
      {images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginTop: 8 }}>
          {images.map((im) => (
            <div key={im.path} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-panel)" }}>
              <img src={`/api/trials?image=${encodeURIComponent(im.path)}`} alt={im.caption || "ảnh"} loading="lazy" onClick={() => setBig(im)} style={{ width: "100%", height: 110, objectFit: "cover", cursor: "zoom-in", display: "block" }} />
              <div style={{ padding: 6 }}>
                {canEdit ? <input defaultValue={im.caption} placeholder="Chú thích…" onBlur={(e) => { if (e.target.value !== (im.caption || "")) caption(im.path, e.target.value); }} style={{ ...input, fontSize: 11.5, padding: "4px 6px" }} />
                  : <div style={{ fontSize: 11.5 }}>{im.caption}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  <span style={{ ...small, fontSize: 10.5 }}>{im.by} · {vnStamp(im.at)}</span>
                  {canDelete && <button style={{ ...mini(danger), padding: "1px 6px" }} onClick={() => remove(im.path)}>Xoá</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {big && createPortal(
        <div onClick={() => setBig(null)} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", cursor: "zoom-out", padding: 20 }}>
          <img src={`/api/trials?image=${encodeURIComponent(big.path)}`} alt={big.caption || "ảnh"} style={{ maxWidth: "95vw", maxHeight: "85vh", borderRadius: 6 }} />
          {big.caption && <div style={{ color: "#fff", marginTop: 10, fontSize: 14 }}>{big.caption}</div>}
        </div>, document.body)}
    </div>
  );
}

// Dashed vertical line + label where the baseline ends and each phase starts.
// Static plugin reading options.plugins.phaseMarkers (useChart updates options in place).
const PHASE_MARKERS = {
  id: "phaseMarkers",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    if (!opts || !opts.marks) return;
    ctx.save();
    opts.marks.forEach((m, j) => {
      const idx = opts.keys.indexOf(m.key);
      if (idx < 0) return;
      const xp = scales.x.getPixelForValue(idx);
      ctx.strokeStyle = m.color; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xp, chartArea.top); ctx.lineTo(xp, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = m.color; ctx.font = "10px sans-serif"; ctx.fillText(m.text, xp + 3, chartArea.top + 10 + (j % 3) * 11);
    });
    ctx.restore();
  },
};

// Weekly series per phase (% bể vỡ or On-time), with a marker where each phase starts.
function WeeklyChart({ report }) {
  const [metric, setMetric] = useState("per1k");
  const theme = useTheme();
  const canvas = useRef(null);
  const labels = report.phases[0] ? report.phases[0].series.map((w) => w.label) : [];
  const keys = report.phases[0] ? report.phases[0].series.map((w) => w.key) : [];
  // week holding the first day after the baseline
  const afterBase = report.baseline.to ? addDays(report.baseline.to, 1) : null;
  const baseEndKey = afterBase ? keys.filter((k) => k <= afterBase).pop() || null : null;
  useChart(canvas, () => ({
    type: "line",
    data: {
      labels,
      datasets: report.phases.map((x, i) => ({
        label: x.phase.label, borderColor: PHASE_COLORS[i % PHASE_COLORS.length], backgroundColor: PHASE_COLORS[i % PHASE_COLORS.length],
        data: x.series.map((w) => (metric === "per1k" ? (w.orders ? +(w.per1k / 10).toFixed(2) : null) : (w.ontimePct == null ? null : +w.ontimePct.toFixed(1)))),
        spanGaps: true, tension: 0.25, pointRadius: 2.5, borderWidth: 2,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { datalabels: { display: false }, legend: { position: "bottom" },
        phaseMarkers: { keys, marks: [...(baseEndKey && !report.phases.some((x) => x.startWeek === baseEndKey) ? [{ key: baseEndKey, text: "hết baseline", color: "#94a3b8" }] : []), ...report.phases.map((x, i) => ({ key: x.startWeek, text: x.phase.label, color: PHASE_COLORS[i % PHASE_COLORS.length] }))] },
        tooltip: { callbacks: { afterLabel: (ctx) => { const w = report.phases[ctx.datasetIndex].series[ctx.dataIndex]; return `${w.orders} đơn · ${w.cases} ca bể · bể vỡ ${bv(w.orders ? w.per1k : null)} · on-time ${w.ontimePct == null ? "—" : w.ontimePct.toFixed(1) + "%"}`; } } } },
      scales: { y: { beginAtZero: metric === "per1k", title: { display: true, text: metric === "per1k" ? "% Bể vỡ" : "% On-time" } } },
    },
    plugins: [PHASE_MARKERS],
  }), [report, metric], theme);
  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, marginRight: 6 }}>Theo tuần</span>
        <button style={seg(metric === "per1k")} onClick={() => setMetric("per1k")}>% Bể vỡ</button>
        <button style={seg(metric === "ontime")} onClick={() => setMetric("ontime")}>% On-time</button>
        <span style={small}>mỗi đường = phạm vi của 1 giai đoạn (tính cả trước khi áp dụng); vạch đứt = bắt đầu giai đoạn</span>
      </div>
      <div style={{ height: 260 }}><canvas ref={canvas} /></div>
    </div>
  );
}

function MonitorView({ x, baseline }) {
  const [kind, setKind] = useState("month");
  const m = x.monitor[kind];
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>📈 Theo dõi sau thành công — {x.phase.label}</span>
        <button style={seg(kind === "month")} onClick={() => setKind("month")}>Theo tháng</button>
        <button style={seg(kind === "week")} onClick={() => setKind("week")}>Theo tuần</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 880 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Kỳ</th><th style={th}>Đơn</th><th style={th}>Tấn</th><th style={th}>% On-time</th><th style={th}>Ca bể</th><th style={th}>% Bể vỡ</th><th style={th} title={MONEY_NOTE}>Tiền đền</th><th style={th}>On-time so kỳ trước</th><th style={th}>Bể vỡ so kỳ trước</th><th style={{ ...th, textAlign: "left" }}>Cảnh báo</th></tr></thead>
          <tbody>
            <tr style={{ color: "var(--text-muted)", fontStyle: "italic" }}><td style={{ ...td, textAlign: "left" }}>Baseline <span style={small}>{fmtS(baseline.from)}–{fmtS(baseline.to)}</span></td><td style={td}>{n0(m.baseline.orders)}</td><td style={td}>{n1(m.baseline.tons)}</td><td style={td}>{pctTxt(m.baseline.ontimePct)}</td><td style={td}>{n0(m.baseline.cases)}</td><td style={td}>{bv(m.baseline.per1k)}</td><td style={td}>{tr(m.baseline.comp)}</td><td style={td} /><td style={td} /><td style={td} /></tr>
            {m.rows.map((r) => (
              <tr key={r.key}>
                <td style={{ ...td, textAlign: "left", fontWeight: 600 }} title={`${fmt(r.from)} – ${fmt(r.to)}${r.sameDays ? " · so cùng số ngày kỳ trước" : ""}`}>{r.label}{r.running ? "*" : ""} <span style={small}>{fmtS(r.from)}–{fmtS(r.to)}</span></td>
                <td style={td}>{n0(r.stats.orders)}</td><td style={td}>{n1(r.stats.tons)}</td><td style={td}>{pctTxt(r.stats.ontimePct)}</td><td style={td}>{n0(r.stats.cases)}</td><td style={td}>{bv(r.stats.per1k)}</td><td style={td}>{tr(r.stats.comp)}</td>
                <td style={{ ...td, color: toneOf(r.vs && r.vs.ontimePts, 1) }}>{r.vs && r.vs.ontimePts != null ? `${sgn(r.vs.ontimePts, n1)} điểm` : "—"}</td>
                <td style={{ ...td, color: toneOf(r.vs && r.vs.damageOk ? r.vs.per1kPct : null, -1) }}>{r.vs && r.vs.damageOk && r.vs.per1kPct != null ? `${sgn(r.vs.per1kPct, n1)}%` : r.vs && !r.vs.damageOk ? <span style={small}>&lt; 5 ca</span> : "—"}</td>
                <td style={{ ...td, textAlign: "left", color: "var(--red)", fontWeight: 700 }}>{r.alerts.length ? `⚠ ${r.alerts.join(", ")}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ ...small, marginTop: 4 }}>* kỳ đang chạy — so với cùng số ngày của kỳ trước. Tháng = các tuần có thứ 2 thuộc tháng (như báo cáo công ty). Cảnh báo: % bể vỡ tăng ≥ 10% (tương đối) hoặc on-time giảm ≥ 1 điểm so kỳ trước (&lt; 5 ca ở 2 kỳ → bỏ trục bể vỡ; tuần &lt; 100 đơn không cảnh báo). Tiền đền chỉ là thông tin thêm, không vào cảnh báo — {MONEY_NOTE}</div>
    </div>
  );
}

async function download(url, name, setMsg) {
  try {
    const r = await fetch(url);
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Không xuất được file"); }
    const cd = r.headers.get("content-disposition") || "";
    const fname = (cd.match(/filename="([^"]+)"/) || [])[1] || name;
    const u = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = u; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  } catch (e) { setMsg(`⚠ ${e.message}`); }
}

function summaryText(sol, report) {
  const L = [`GIẢI PHÁP: ${sol.name}`, `Khách: ${sol.clients.join(", ")} · Trạng thái: ${sol.status} · Baseline chung ${fmt(sol.baseStart)} – ${fmt(sol.baseEnd)}`, ""];
  for (const c of report.comparison) {
    L.push(`${c.label} (${fmt(c.startDate)} → ${c.endDate ? fmt(c.endDate) : "nay"}, ${c.status}): ${c.verdict} — ${n0(c.post.orders)} đơn, on-time ${pctTxt(c.post.ontimePct)} (${c.delta.ontimePts == null ? "—" : sgn(c.delta.ontimePts, n1) + " điểm"} so baseline), bể vỡ ${bv(c.post.per1k)} (${c.delta.per1kPct == null ? "—" : sgn(c.delta.per1kPct, n1) + "%"})`);
    if (c.base.comp != null) {
      L.push(`   Tiền đền cho khách: ${tr(c.base.comp)} → ${tr(c.post.comp)} (${coverageOf(c)})${SHOW_TRUY_THU ? ` · truy thu tham khảo ${tr(c.base.truyThu)} → ${tr(c.post.truyThu)}` : ""}`);
      if (c.savings) L.push(`   ${c.savings.text}`);
    }
  }
  L.push(`(${MONEY_NOTE})`);
  report.alerts.forEach((a) => L.push(`⚠ ${a.text}`));
  const f1 = reconcileCopyLines(report); // Kế hoạch F1: đối soát 2 góc nhìn, độ phủ, khoảng trống, nguồn dữ liệu
  if (f1) L.push(f1);
  L.push(`(SD3 Dashboard Điện Máy, số liệu cập nhật ${vnStamp(report.dataAsOf)})`);
  return L.join(NL);
}

// White A4 page for "In / Lưu PDF" (reuses the .exec-report print CSS).
function SolutionPrintView({ sol, report, onClose }) {
  const C = { text: "#111827", muted: "#6b7280", line: "#e5e7eb", head: "#0f7c7b", green: "#15803d", red: "#dc2626" };
  const PV = { excellent: ["#065f46", "#d1fae5"], improved: ["#075985", "#e0f2fe"], watch: ["#92400e", "#fef3c7"], ineffective: ["#991b1b", "#fee2e2"] };
  const cell = { padding: "5px 7px", borderBottom: `1px solid ${C.line}`, textAlign: "right", whiteSpace: "nowrap", fontSize: 11 };
  const hc = { ...cell, background: C.head, color: "#fff", fontWeight: 700, borderBottom: "none" };
  const btn = { fontSize: 13, padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${C.line}`, background: "#fff", color: C.text };
  return (
    <div className="exec-report" style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#e5e7eb", overflowY: "auto", color: C.text }}>
      <div className="no-print" style={{ position: "sticky", top: 0, display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 20px", background: "#f3f4f6", borderBottom: `1px solid ${C.line}` }}>
        <span style={{ marginRight: "auto", fontSize: 13, color: C.muted, alignSelf: "center" }}>Xem trước bản in — chọn &quot;Lưu dưới dạng PDF&quot; để lưu file.</span>
        <button style={{ ...btn, background: "#c2410c", borderColor: "#c2410c", color: "#fff" }} onClick={() => window.print()}>🖨 In / Lưu PDF</button>
        <button style={btn} onClick={onClose}>Đóng</button>
      </div>
      <div className="exec-page" style={{ maxWidth: 820, margin: "20px auto", background: "#fff", padding: "30px 34px", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.head, textTransform: "uppercase" }}>SD3 Dashboard Điện Máy · Báo cáo đánh giá giải pháp</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{sol.name}</div>
        <div style={{ fontSize: 12, color: C.muted }}>Khách {sol.clients.join(", ")} · {sol.status} · Baseline chung {fmt(sol.baseStart)} – {fmt(sol.baseEnd)} · số liệu {vnStamp(report.dataAsOf)}</div>
        {sol.description && <div style={{ fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{sol.description}</div>}
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 14 }}>So sánh các giai đoạn</div>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <thead><tr>{["Giai đoạn", "Thời gian", "Đơn", "% On-time", "% Bể vỡ", "On-time so BL", "Bể vỡ so BL", "Tiền đền", "Tiết kiệm (ước tính)", "Nhận định"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i < 2 ? "left" : "right", whiteSpace: "normal" }}>{h}</th>)}</tr></thead>
          <tbody>{report.comparison.map((c) => (
            <tr key={c.phaseId}><td style={{ ...cell, textAlign: "left", fontWeight: 700 }}>{c.label}</td><td style={{ ...cell, textAlign: "left" }}>{fmtS(c.postFrom)}–{fmtS(c.postTo)}</td><td style={cell}>{n0(c.post.orders)}</td><td style={cell}>{pctTxt(c.post.ontimePct)}</td><td style={cell}>{bv(c.post.per1k)}</td>
              <td style={cell}>{c.delta.ontimePts == null ? "—" : `${sgn(c.delta.ontimePts, n1)} đ`}</td><td style={cell}>{c.delta.per1kPct == null ? "—" : `${sgn(c.delta.per1kPct, n1)}%`}</td><td style={cell}>{tr(c.post.comp) || "—"}</td><td style={cell}>{c.savings && c.savings.ok ? `${c.savings.value >= 0 ? "~" : "+"}${tr(Math.abs(c.savings.value))}` : "chưa có số"}</td><td style={{ ...cell, color: PV[c.verdictLevel][0], fontWeight: 700 }}>{c.verdict}</td></tr>))}</tbody>
        </table></div>
        {report.alerts.map((a, i) => <div key={i} style={{ fontSize: 11.5, color: C.red, marginTop: 4 }}>⚠ {a.text}</div>)}
        {report.phases.map((x) => {
          const v = x.impact.verdict, T = x.impact.trial, [fc, bc] = PV[v.level];
          return (
            <div key={x.phase.id} style={{ marginTop: 18, breakInside: "avoid" }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{x.phase.label} <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>· {fmt(x.phase.startDate)} → {x.phase.endDate ? fmt(x.phase.endDate) : "nay"} · {x.phase.status} · {scopeLine(x.phase)}</span></div>
              <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 6, background: bc, color: fc }}><b>{v.label}</b>{v.reasons.map((s, i) => <div key={i} style={{ fontSize: 11.5, color: C.text }}>• {s}</div>)}</div>
              {x.impact.savings && <div style={{ fontSize: 11.5, marginTop: 4 }}>💰 {x.impact.savings.text} <span style={{ color: C.muted }}>({coverageOf(T)})</span></div>}
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}><thead><tr>{["Chỉ số", "Trước", "Sau", "Chênh lệch"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>{[["Đơn", n0(T.base.orders), n0(T.post.orders), sgn(T.delta.orders, n0)], ["% On-time", pctTxt(T.base.ontimePct), pctTxt(T.post.ontimePct), T.delta.ontimePts == null ? "—" : `${sgn(T.delta.ontimePts, n1)} điểm`], ["Ca bể", n0(T.base.cases), n0(T.post.cases), sgn(T.delta.cases, n0)], ["% Bể vỡ", bv(T.base.per1k), bv(T.post.per1k), T.delta.per1kPct == null ? "—" : `${sgn(T.delta.per1kPct, n1)}%`], ["Tiền đền cho khách", tr(T.base.comp), tr(T.post.comp), trd(T.delta.comp)],...(SHOW_TRUY_THU ? [["Truy thu (tham khảo)", tr(T.base.truyThu), tr(T.post.truyThu), trd(T.delta.truyThu)]] : [])].map((r) => <tr key={r[0]}>{r.map((c2, i) => <td key={i} style={{ ...cell, textAlign: i ? "right" : "left" }}>{c2}</td>)}</tr>)}</tbody></table>
              <ReconcilePrint r={x.reconcile} C={C} cell={cell} hc={hc} />
              {(x.phase.images || []).length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  {x.phase.images.map((im) => <figure key={im.path} style={{ margin: 0 }}><img src={`/api/trials?image=${encodeURIComponent(im.path)}`} alt={im.caption || ""} style={{ width: "100%", borderRadius: 4 }} /><figcaption style={{ fontSize: 10.5, color: C.muted, textAlign: "center" }}>{im.caption}</figcaption></figure>)}
                </div>
              )}
              {x.monitor && (
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}><thead><tr>{["Theo dõi (tháng)", "Đơn", "% On-time", "% Bể vỡ", "Tiền đền", "On-time so kỳ trước", "Bể vỡ so kỳ trước"].map((h, i) => <th key={h} style={{ ...hc, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
                  <tbody>{x.monitor.month.rows.map((r) => <tr key={r.key}><td style={{ ...cell, textAlign: "left" }}>{r.label}{r.running ? "*" : ""}</td><td style={cell}>{n0(r.stats.orders)}</td><td style={cell}>{pctTxt(r.stats.ontimePct)}</td><td style={cell}>{bv(r.stats.per1k)}</td><td style={cell}>{tr(r.stats.comp)}</td><td style={cell}>{r.vs && r.vs.ontimePts != null ? `${sgn(r.vs.ontimePts, n1)} đ` : "—"}</td><td style={cell}>{r.vs && r.vs.damageOk && r.vs.per1kPct != null ? `${sgn(r.vs.per1kPct, n1)}%` : "—"}</td></tr>)}</tbody></table>
              )}
            </div>
          );
        })}
        <CoveragePrint report={report} C={C} cell={cell} hc={hc} />
        <SourcesPrint report={report} C={C} />
        <div style={{ fontSize: 10, color: C.muted, marginTop: 16, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>Mỗi giai đoạn so với cùng baseline chung trên phạm vi của chính nó. On-time = cờ GHN ontime / (ontime + late), loại đơn hoàn/huỷ. % Bể vỡ = ca bể (gắn theo đơn) ÷ đơn lấy × 100. Tiền đền cho khách gắn theo đơn; tiết kiệm = (tiền / 1.000 đơn trước − sau) × đơn giai đoạn sau, trừ xu hướng đối chứng — ước tính. {MONEY_NOTE} In lúc {vnStamp(new Date().toISOString())}.</div>
      </div>
    </div>
  );
}

function SolutionDetail({ sol, version, canEdit, canDelete, onClose, onEditSolution, onNextPhase, onEditPhase, onDeletePhase, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState({});
  const [printing, setPrinting] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setData(null); setErr(null);
    fetch(`/api/trials?solution=${encodeURIComponent(sol.id)}${version ? `&v=${encodeURIComponent(version)}` : ""}`).then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error || "Không tính được"); setData(j); setOpen(Object.fromEntries(j.report.phases.map((x, i) => [x.phase.id, i === j.report.phases.length - 1]))); })
      .catch((e) => setErr(e.message));
  }, [sol.id, version]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") (printing ? setPrinting(false) : onClose()); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [printing, onClose]);
  const report = data?.report, s = data?.solution || sol;
  return (
    <div role="dialog" aria-modal="true" aria-label={sol.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 12px", overflowY: "auto" }}>
      <div className="fade-in" style={{ width: "100%", maxWidth: 1160, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.45)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Giải pháp · {s.phases.length} giai đoạn</div>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.35, marginTop: 2 }}>{s.name} <StatusBadge s={s.status} /></div>
            <div style={small}>Khách <ClientsCompact clients={s.clients} max={3} /> · Baseline chung <b>{fmt(s.baseStart)} – {fmt(s.baseEnd)}</b></div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {canEdit && <button style={ghost} onClick={onEditSolution}>✎ Sửa giải pháp</button>}
            {canEdit && !s.legacy && <button style={primary} onClick={onNextPhase}>➕ Giai đoạn tiếp</button>}
            <button style={ghost} disabled={!report} onClick={() => download(`/api/trials?solution=${encodeURIComponent(s.id)}&format=docx`, "bao-cao.docx", setMsg)}>📄 Xuất Word</button>
            <button style={ghost} disabled={!report} onClick={() => download(`/api/trials?solution=${encodeURIComponent(s.id)}&format=xlsx`, "bao-cao.xlsx", setMsg)}>📥 Excel</button>
            <button style={ghost} disabled={!report} onClick={() => setPrinting(true)}>🖨 In / PDF</button>
            <button style={ghost} disabled={!report} onClick={() => { try { navigator.clipboard.writeText(summaryText(s, report)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } }}>{copied ? "✓ Đã copy" : "📋 Copy tóm tắt"}</button>
            <button style={{ ...ghost, padding: "6px 10px" }} onClick={onClose} aria-label="Đóng" title="Đóng (Esc)">✕</button>
          </div>
        </div>
        {msg && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 6 }}>{msg}</div>}
        {s.description && <div style={{ marginTop: 10, fontSize: 13, whiteSpace: "pre-wrap", padding: "8px 10px", borderRadius: 8, background: "rgba(var(--brand-rgb),0.05)", border: "1px solid var(--border)" }}>{s.description}</div>}
        {s.legacy && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--amber)" }}>Giải pháp cũ (trước khi có giai đoạn). Bấm "✎ Sửa giải pháp" để lưu thành giải pháp có giai đoạn, rồi mới thêm giai đoạn tiếp.</div>}
        {err ? <div style={{ color: "var(--red)", marginTop: 12 }}>⚠ {err}</div> : !report ? <div style={{ ...small, marginTop: 12 }}>Đang tính…</div> : (
          <>
            {report.alerts.length > 0 && <div style={{ marginTop: 10 }}>{report.alerts.map((a, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--red)", fontWeight: 700 }}>⚠ {a.text}</div>)}</div>}
            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 14 }}>So sánh các giai đoạn <span style={{ ...small, fontWeight: 400 }}>(cùng baseline chung, mỗi giai đoạn trên phạm vi của nó)</span></div>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="data-table" style={{ fontSize: 12, minWidth: 940 }}>
                <thead><tr><th style={{ ...thw, textAlign: "left" }}>Giai đoạn</th><th style={{ ...thw, textAlign: "left" }}>Phạm vi</th><th style={thw}>Giai đoạn sau</th><th style={thw}>Đơn</th><th style={thw}>Tấn</th><th style={thw}>% On-time</th><th style={thw}>% Bể vỡ</th><th style={thw}>On-time so baseline</th><th style={thw}>Bể vỡ so baseline</th><th style={thw} title="Số của giai đoạn này trừ giai đoạn liền trước">So GĐ trước</th><th style={thw} title={MONEY_NOTE + " Tiết kiệm ước tính = chênh lệch tỷ lệ (tiền/đơn) × đơn giai đoạn sau, trừ nhóm đối chứng."}>Tiền đền<div style={{ ...small, fontWeight: 400, fontSize: 10.5 }}>baseline → sau · tiết kiệm ước tính</div></th><th style={{ ...thw, textAlign: "left" }}>Nhận định</th></tr></thead>
                <tbody>{report.comparison.map((c) => (
                  <tr key={c.phaseId}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{c.label} <StatusBadge s={c.status} /></td>
                    <td style={{ ...td, textAlign: "left", whiteSpace: "normal", minWidth: 150, maxWidth: 190, color: "var(--text-secondary)" }}>{scopeLine(c.scope)}</td>
                    <td style={td}>{fmtS(c.postFrom)}–{fmtS(c.postTo)} <span style={small}>{c.postDays}n</span></td>
                    <td style={td}>{n0(c.post.orders)}</td><td style={td}>{n1(c.post.tons)}</td><td style={{ ...td, fontWeight: 700 }}>{pctTxt(c.post.ontimePct)}</td><td style={{ ...td, fontWeight: 700 }}>{bv(c.post.per1k)}</td>
                    <td style={{ ...td, color: toneOf(c.delta.ontimePts, 1) }}>{c.delta.ontimePts == null ? "—" : `${sgn(c.delta.ontimePts, n1)} đ`}</td>
                    <td style={{ ...td, color: toneOf(c.delta.per1kPct, -1) }}>{c.delta.per1kPct == null ? "—" : `${sgn(c.delta.per1kPct, n1)}%`}</td>
                    <td style={td}>{c.vsPrev ? <span title="on-time (điểm) · bể vỡ (% thay đổi)"><span style={{ color: toneOf(c.vsPrev.ontimePts, 1) }}>{c.vsPrev.ontimePts == null ? "—" : `${sgn(c.vsPrev.ontimePts, n1)} đ`}</span> · <span style={{ color: toneOf(c.vsPrev.per1kPct, -1) }}>{c.vsPrev.per1kPct == null ? "—" : `${sgn(c.vsPrev.per1kPct, n1)}%`}</span></span> : "—"}</td>
                    <td style={td} title={`${coverageOf(c)}${c.savings ? " · " + c.savings.text : ""}`}>{tr(c.base.comp)} → <b>{tr(c.post.comp)}</b>
                      <div style={{ fontWeight: 700, fontSize: 11.5, color: c.savings && c.savings.ok ? (c.savings.value >= 0 ? "var(--green)" : "var(--red)") : "var(--text-muted)" }}>{c.savings && c.savings.ok ? `tiết kiệm ~${tr(Math.abs(c.savings.value))}${c.savings.value < 0 ? " (tăng thêm)" : ""}` : "chưa có số"}</div></td>
                    <td style={{ ...td, textAlign: "left" }}><VerdictChip level={c.verdictLevel} text={c.verdict} /></td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div style={{ marginTop: 14 }}><WeeklyChart report={report} /></div>
            <CoverageBox report={report} />
            <GapsBox report={report} />
            {report.phases.map((x) => {
              const isOpen = open[x.phase.id];
              return (
                <div key={x.phase.id} style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", background: "rgba(var(--brand-rgb),0.06)", cursor: "pointer" }} onClick={() => setOpen((o) => ({ ...o, [x.phase.id]: !o[x.phase.id] }))}>
                    <span style={{ fontWeight: 800 }}>{isOpen ? "▾" : "▸"} {x.phase.label}</span>
                    <StatusBadge s={x.phase.status} />
                    <span style={small}>{fmt(x.phase.startDate)} → {x.phase.endDate ? fmt(x.phase.endDate) : "Ongoing"} · {scopeLine(x.phase)}</span>
                    <VerdictChip level={x.impact.verdict.level} text={x.impact.verdict.label} />
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      {canEdit && !s.legacy && <button style={mini(ghost)} onClick={() => onEditPhase(x.phase)}>Sửa GĐ</button>}
                      {canDelete && !s.legacy && s.phases.length > 1 && <button style={mini(danger)} onClick={() => onDeletePhase(x.phase)}>Xoá GĐ</button>}
                    </span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: 12 }}>
                      {x.phase.description && <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", marginBottom: 8 }}>{x.phase.description}</div>}
                      {(x.phase.khoGiao.length > 1 || x.phase.provinces.length > 2 || x.phase.khoLay.length > 1) && (
                        <details style={{ ...small, marginBottom: 6 }}>
                          <summary style={{ cursor: "pointer" }}>Xem phạm vi chi tiết</summary>
                          {x.phase.khoLay.length > 0 && <div><b>Kho lấy ({x.phase.khoLay.length}):</b> {x.phase.khoLay.map(shortWh).join(", ")}</div>}
                          {x.phase.khoGiao.length > 0 && <div><b>Kho giao ({x.phase.khoGiao.length}):</b> {x.phase.khoGiao.map(shortWh).join(", ")}</div>}
                          {x.phase.provinces.length > 0 && <div><b>Tỉnh giao ({x.phase.provinces.length}):</b> {x.phase.provinces.join(", ")}</div>}
                        </details>
                      )}
                      <PhaseImpact impact={x.impact} />
                      <ReconcileBox r={x.reconcile} />
                      {x.monitor && <MonitorView x={x} baseline={report.baseline} />}
                      {!s.legacy && <ImageGallery phase={x.phase} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged} />}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ ...small, marginTop: 12 }}>Cách tính: đơn theo ngày lấy hàng · On-time = cờ GHN ontime / (ontime + late), loại đơn hoàn/huỷ · Ca bể vỡ gắn theo đơn · % Bể vỡ = ca ÷ đơn lấy × 100 (như báo cáo công ty) · Đối chứng = đơn cùng khách ngoài phạm vi giai đoạn · Nhận định theo luật cố định (chỉ % bể vỡ + on-time). Tiền đền cho khách gắn theo đơn như ca bể; ước tính tiết kiệm = (tiền / 1.000 đơn trước − sau) × đơn giai đoạn sau, trừ xu hướng nhóm đối chứng (% thay đổi) — luôn là ước tính. {MONEY_NOTE} Số liệu cập nhật {vnStamp(report.dataAsOf)}.</div>
            <SourcesLine report={report} />
          </>
        )}
      </div>
      {printing && report && createPortal(<SolutionPrintView sol={s} report={report} onClose={() => setPrinting(false)} />, document.body)}
    </div>
  );
}

const EMPTY_PHASE = { id: "", label: "Trial 1", khoLay: [], khoGiao: [], provinces: [], startDate: "", endDate: "", ongoing: true, status: "Đang trial", description: "" };

// Idle prefetch from the dashboard (Kế hoạch A · P4): the solution list.
export function prefetch() {
  prefetchJSON("/api/trials").catch(() => {});
}

export default function TabTrials() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [version, setVersion] = useState("");
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(null); // { kind: "solution"|"phase", ... }
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);

  // First load may use the idle-prefetched list; later loads (after a save,
  // "↻ Làm mới") always ask the server.
  const load = (v = version, first = false) => (first ? getJSON("/api/trials") : fetch(`/api/trials${v ? `?v=${encodeURIComponent(v)}` : ""}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))))
    .then(({ j }) => { if (!j.ok) throw new Error(j.error || "Không tải được danh sách"); setData(j); setErr(null); return j; })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(version, true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [reloading, setReloading] = useState(false);
  const reload = () => { dropPrefetched("/api/trials"); setReloading(true); load().finally(() => setReloading(false)); };
  useEffect(() => {
    if (!form || options) return;
    fetch("/api/trials?options=1").then((r) => r.json()).then((j) => { if (j.ok) setOptions(j.options); else setMsg(`⚠ ${j.error}`); }).catch((e) => setMsg(`⚠ ${e.message}`));
  }, [form, options]);

  const statuses = data?.statuses || { solution: ["Đang trial", "Đã thành solution chung", "Đã hủy"], phase: ["Đang trial", "Thành công", "Dừng"] };
  const sols = data?.solutions || [];
  const sel = sols.find((s) => s.id === selected) || null;
  const counts = useMemo(() => Object.fromEntries(statuses.solution.map((s) => [s, sols.filter((x) => x.status === s).length])), [sols, statuses]);
  const shown = sols.filter((s) => (filter === "all" || s.status === filter)
    && (!q || `${s.name} ${s.clients.join(" ")} ${s.phases.map((p) => `${p.label} ${p.khoLay.join(" ")} ${p.khoGiao.join(" ")} ${p.provinces.join(" ")}`).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const closeDetail = useCallback(() => setSelected(null), []);
  const top = () => { if (typeof window !== "undefined") window.scrollTo?.({ top: 0, behavior: "smooth" }); };

  const newSolution = () => { setMsg(null); setForm({ kind: "solution", isNew: true, initial: { id: "", name: "", clients: [], baseStart: "", baseEnd: "", status: "Đang trial", description: "", phase: { ...EMPTY_PHASE, startDate: vnToday() } } }); top(); };
  const editSolution = (s) => {
    setMsg(null); setSelected(null);
    const legacyPhase = s.legacy ? s.phases[0] : null;
    setForm({ kind: "solution", isNew: false, legacyPhase, initial: { id: s.legacy ? "" : s.id, name: s.name, clients: s.clients, baseStart: s.baseStart, baseEnd: s.baseEnd, status: s.status, description: s.description, firstPhaseStart: s.phases[0]?.startDate || "" } });
    top();
  };
  const nextPhase = (s) => { setMsg(null); setSelected(null); if (s.legacy) { editSolution(s); return; } setForm({ kind: "phase", solution: s, initial: nextPhasePreset(s) }); top(); };
  const editPhase = (s, p) => { setMsg(null); setSelected(null); setForm({ kind: "phase", solution: s, initial: { ...p, ongoing: !p.endDate } }); top(); };
  const afterSave = async (j, text, openId) => { setVersion(j.version); setForm(null); setMsg(`✓ ${text}`); await load(j.version); if (openId) setSelected(openId); };
  const removeSolution = async (s) => {
    if (!confirm(`Xoá giải pháp "${s.name}" (${s.phases.length} giai đoạn)?\nDòng vẫn giữ trong Google Sheet (đánh dấu đã xoá).`)) return;
    try { const j = await post({ action: "deleteSolution", id: s.id }); setVersion(j.version); if (selected === s.id) setSelected(null); setMsg(`✓ Đã xoá "${s.name}"`); await load(j.version); } catch (e) { setMsg(`⚠ ${e.message}`); }
  };
  const removePhase = async (s, p) => {
    if (!confirm(`Xoá ${p.label} của "${s.name}"?`)) return;
    try { const j = await post({ action: "deletePhase", id: p.id }); setVersion(j.version); setMsg(`✓ Đã xoá ${p.label}`); await load(j.version); } catch (e) { setMsg(`⚠ ${e.message}`); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="glass" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Sổ tay Cải tiến & Đo lường Giải pháp</div>
            <div style={small}>Mỗi giải pháp đi qua các giai đoạn Trial 1 → Trial 2 → … → Nhân rộng cả nước, cùng 1 baseline; đo hiệu quả thật từ LTL + Rillnet và theo dõi tiếp sau khi thành công.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={ghost} onClick={reload} disabled={reloading} title="Tải lại danh sách giải pháp và số đo mới nhất">{reloading ? "Đang tải…" : "↻ Làm mới"}</button>
            {!form && <button style={primary} onClick={newSolution}>＋ Thêm giải pháp</button>}
          </div>
        </div>
        {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
      </div>

      {form?.kind === "solution" && (
        <SolutionForm key={form.initial.id || form.legacyPhase?.id || "new"} initial={form.initial} isNew={form.isNew} legacyPhase={form.legacyPhase} options={options} statuses={statuses}
          onCancel={() => setForm(null)} onSaved={(j) => afterSave(j, j.created ? `Đã thêm giải pháp "${j.solution.name}"` : `Đã lưu "${j.solution.name}"`, j.solution.id)} />
      )}
      {form?.kind === "phase" && (
        <PhaseForm key={form.initial.id || "next"} solution={form.solution} initial={form.initial} options={options} statuses={statuses}
          onCancel={() => setForm(null)} onSaved={(j) => afterSave(j, j.created ? `Đã thêm ${j.phase.label}` : `Đã lưu ${j.phase.label}`, form.solution.id)} />
      )}

      <div className="glass" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, khách, kho…" style={{ ...input, width: 220, maxWidth: "100%" }} />
          <button style={seg(filter === "all")} onClick={() => setFilter("all")}>Tất cả ({sols.length})</button>
          {statuses.solution.map((s) => <button key={s} style={seg(filter === s)} onClick={() => setFilter(s)}>{s} ({counts[s] || 0})</button>)}
        </div>
        {err ? <div style={{ color: "var(--red)", fontSize: 13 }}>⚠ {err}</div> : !data ? <div style={small}>Đang tải…</div> : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ fontSize: 12.5, minWidth: 900 }}>
              <thead><tr><th>Giải pháp</th><th>Khách</th><th>Giai đoạn</th><th>Thời gian</th><th>Trạng thái</th><th>Cập nhật</th><th /></tr></thead>
              <tbody>
                {shown.map((s) => {
                  const first = s.phases.reduce((a, p) => (!a || p.startDate < a ? p.startDate : a), "");
                  const upd = [s, ...s.phases].reduce((a, x) => (x.updatedAt > a.updatedAt ? x : a), s);
                  return (
                    <tr key={s.id} onClick={() => setSelected(s.id)} style={{ cursor: "pointer", background: s.id === selected ? "rgba(var(--brand-rgb),0.10)" : undefined }}>
                      <td style={{ fontWeight: 600, maxWidth: 300, whiteSpace: "normal" }}>▸ {s.name}
                        {s.alerts?.length > 0 && <div style={{ fontSize: 11.5, color: "var(--red)", fontWeight: 700, marginTop: 2 }} title={s.alerts.map((a) => a.text).join(NL)}>⚠ {s.alerts[0].text}{s.alerts.length > 1 ? ` (+${s.alerts.length - 1})` : ""}</div>}
                        {s.legacy && <div style={{ ...small, color: "var(--amber)" }}>giải pháp cũ — bấm Sửa để chuyển sang giai đoạn</div>}
                      </td>
                      <td style={{ whiteSpace: "normal", maxWidth: 170 }} onClick={(e) => { if (e.target.tagName === "BUTTON") e.stopPropagation(); }}><ClientsCompact clients={s.clients} /></td>
                      <td style={{ whiteSpace: "normal", maxWidth: 300 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {s.phases.map((p) => (
                            <span key={p.id} title={`${p.label} · ${p.status} · ${fmt(p.startDate)} → ${p.endDate ? fmt(p.endDate) : "Ongoing"} · ${scopeLine(p)} · ${p.verdict || ""}`}
                              style={{ fontSize: 11.5, padding: "2px 7px", borderRadius: 10, border: "1px solid var(--border)", whiteSpace: "nowrap", background: (STATUS_STYLE[p.status] || {}).bg }}>
                              {(STATUS_STYLE[p.status] || {}).icon} {p.label}{p.monitored ? " 📈" : ""}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtS(first)} → nay</td>
                      <td><StatusBadge s={s.status} /></td>
                      <td style={{ ...small, whiteSpace: "nowrap" }}>{upd.updatedBy}<br />{vnStamp(upd.updatedAt)}</td>
                      <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <button style={mini(ghost)} onClick={() => editSolution(s)}>Sửa</button>
                        <button style={{ ...mini(primary), marginLeft: 4 }} onClick={() => nextPhase(s)} title="Bắt đầu giai đoạn tiếp theo (chép phạm vi giai đoạn trước)">➕ Giai đoạn tiếp</button>
                        {data.canDelete && <button style={{ ...mini(danger), marginLeft: 4 }} onClick={() => removeSolution(s)}>Xoá</button>}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={7} style={{ color: "var(--text-muted)", padding: 16 }}>{sols.length ? "Không có giải pháp khớp bộ lọc." : "Chưa có giải pháp nào — bấm \"＋ Thêm giải pháp\"."}</td></tr>}
              </tbody>
            </table>
            <div style={{ ...small, marginTop: 6 }}>✅ thành công · ⏳ đang trial · ⏹ dừng · 📈 đang theo dõi sau thành công · ⚠ kỳ mới xấu hơn kỳ trước.</div>
          </div>
        )}
      </div>

      {sel && (
        <SolutionDetail sol={sel} version={version} canEdit canDelete={!!data?.canDelete} onClose={closeDetail}
          onEditSolution={() => editSolution(sel)} onNextPhase={() => nextPhase(sel)}
          onEditPhase={(p) => editPhase(sel, p)} onDeletePhase={(p) => removePhase(sel, p)}
          onChanged={(v) => { setVersion(v); load(v); }} />
      )}
    </div>
  );
}
