/**
 * components/TabTrials.js — "Sổ tay Cải tiến & Đo lường Giải pháp" (28/09).
 * List of improvement trials (Manager + SD3 create / edit, Manager deletes)
 * and, for the selected one, the measured Baseline vs Post-Trial effect with
 * a control group (same clients outside the scope) — numbers ready to copy
 * into Excel / chat or screenshot, no manual Excel work. Math: lib/trials.js.
 * Clicking a trial (or saving one) opens the evaluation report in a large
 * modal: general info, automated verdict, Before vs After table, cases;
 * "Xuất báo cáo đánh giá" = Excel (lib/trial-xlsx.js, same impact object as
 * the screen) · "In / Lưu PDF" = white A4 page · copy summary / table.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DAY = 86400000;
const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const fmtS = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const n0 = (x) => (x == null ? "—" : Math.round(x).toLocaleString("vi-VN"));
const n1 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const n2 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sgn = (x, f) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${f(Math.abs(x))}`);
// ISO timestamp → "hh:mm dd/mm" (Vietnam time)
const vnStamp = (iso) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const v = new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString();
  return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}`;
};
const shortWh = (s) => String(s || "").replace(/^Kho Giao Hàng Nặng - /, "").replace(/^Key Account Warehouse /, "KA WH ").trim();

const STATUS_STYLE = {
  "Đang trial": { color: "var(--cyan)", bg: "rgba(var(--brand-rgb),0.12)" },
  "Thành công (Đã nhân rộng)": { color: "var(--green)", bg: "var(--green-glow, rgba(45,212,191,0.14))" },
  "Đã hủy": { color: "var(--text-muted)", bg: "rgba(127,127,127,0.14)" },
};
const EMPTY = { id: "", name: "", clients: [], khoLay: [], khoGiao: [], provinces: [], baseStart: "", baseEnd: "", startDate: "", endDate: "", ongoing: true, status: "Đang trial", description: "" };

const btnBase = { fontSize: 12.5, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 };
const primary = { ...btnBase, background: "rgba(var(--brand-rgb),0.12)", border: "1px solid rgba(var(--brand-rgb),0.35)", color: "var(--cyan)" };
const ghost = { ...btnBase, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" };
const danger = { ...ghost, color: "var(--red)" };
const seg = (on) => ({ ...btnBase, fontWeight: 500, padding: "4px 10px", background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", border: "1px solid var(--border)", color: on ? "var(--cyan)" : "var(--text-muted)" });
const input = { padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" };
const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };
const label = { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4, display: "block" };

function StatusBadge({ s }) {
  const st = STATUS_STYLE[s] || STATUS_STYLE["Đang trial"];
  return <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 10, color: st.color, background: st.bg, whiteSpace: "nowrap" }}>{s}</span>;
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
  // Selected values no longer offered (e.g. client removed) stay visible to un-tick.
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
            <button type="button" style={{ ...ghost, padding: "3px 8px", fontSize: 11.5 }} onClick={() => onChange([])}>Bỏ chọn hết</button>
            <button type="button" style={{ ...primary, padding: "3px 8px", fontSize: 11.5 }} onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Baseline suggestion: same length as the post period, right before start.
function suggestBaseline(startDate, endDate) {
  if (!startDate) return null;
  const today = vnToday();
  const postTo = endDate || (today > startDate ? today : addDays(startDate, 13));
  const len = Math.max(7, daysBetween(startDate, postTo));
  const baseEnd = addDays(startDate, -1);
  return { baseStart: addDays(baseEnd, -(len - 1)), baseEnd };
}

function TrialForm({ initial, options, statuses, onCancel, onSaved }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setErr(null); };

  const clientOpts = useMemo(() => Object.entries(options || {}).map(([value, o]) => ({ value, count: o.orders })).sort((a, b) => b.count - a.count), [options]);
  // Kho / tỉnh offered = union over the chosen clients.
  const pick = (field) => {
    const m = {};
    for (const c of f.clients) for (const [k, n] of Object.entries(options?.[c]?.[field] || {})) m[k] = (m[k] || 0) + n;
    return Object.entries(m).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  };
  const sug = suggestBaseline(f.startDate, f.ongoing ? "" : f.endDate);
  const baseLen = f.baseStart && f.baseEnd && f.baseEnd >= f.baseStart ? daysBetween(f.baseStart, f.baseEnd) : null;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/trials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", trial: { ...f, endDate: f.ongoing ? "" : f.endDate } }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Không lưu được");
      onSaved(j);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass fade-in" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{f.id ? "Sửa giải pháp" : "Thêm giải pháp mới"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={label}>Tên giải pháp / chiến dịch *</span>
          <input style={input} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="VD: [LG-T01] Tách tuyến đi thẳng kho B2B → GXT Tân Bình" />
        </div>
        <div>
          <span style={label}>Khách hàng áp dụng *</span>
          <MultiPick options={clientOpts} selected={f.clients} onChange={(v) => set({ clients: v })} placeholder={options ? "Chọn khách…" : "Đang tải danh sách…"} disabled={!options} />
        </div>
        <div>
          <span style={label}>Kho lấy (xuất)</span>
          <MultiPick options={pick("khoLay")} selected={f.khoLay} onChange={(v) => set({ khoLay: v })} placeholder="Tất cả kho lấy" emptyText="Chọn khách trước" render={shortWh} />
        </div>
        <div>
          <span style={label}>Kho giao</span>
          <MultiPick options={pick("khoGiao")} selected={f.khoGiao} onChange={(v) => set({ khoGiao: v })} placeholder="Tất cả kho giao" emptyText="Chọn khách trước" render={shortWh} />
        </div>
        <div>
          <span style={label}>Tỉnh giao</span>
          <MultiPick options={pick("provinces")} selected={f.provinces} onChange={(v) => set({ provinces: v })} placeholder="Tất cả tỉnh giao" emptyText="Chọn khách trước" />
        </div>
        <div>
          <span style={label}>Ngày bắt đầu áp dụng *</span>
          <input type="date" style={input} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </div>
        <div>
          <span style={label}>Ngày kết thúc</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" style={{ ...input, opacity: f.ongoing ? 0.45 : 1 }} disabled={f.ongoing} value={f.ongoing ? "" : f.endDate} onChange={(e) => set({ endDate: e.target.value })} />
            <label style={{ fontSize: 12.5, whiteSpace: "nowrap", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={f.ongoing} onChange={(e) => set({ ongoing: e.target.checked })} /> Ongoing
            </label>
          </div>
        </div>
        <div>
          <span style={label}>Trạng thái</span>
          <select style={input} value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, alignItems: "end", padding: 12, borderRadius: 8, border: "1px dashed var(--border)" }}>
          <div style={{ gridColumn: "1 / -1", fontSize: 12.5, fontWeight: 700 }}>Baseline — giai đoạn TRƯỚC khi áp dụng (để so sánh) *</div>
          <div><span style={label}>Từ ngày</span><input type="date" style={input} value={f.baseStart} onChange={(e) => set({ baseStart: e.target.value })} /></div>
          <div><span style={label}>Đến ngày</span><input type="date" style={input} value={f.baseEnd} onChange={(e) => set({ baseEnd: e.target.value })} /></div>
          <div>
            <button type="button" style={{ ...ghost, width: "100%" }} disabled={!sug} onClick={() => sug && set(sug)}>
              ↺ Gợi ý: cùng số ngày, ngay trước
            </button>
          </div>
          <div style={{ gridColumn: "1 / -1", ...small }}>
            {baseLen ? `Baseline ${baseLen} ngày. ` : ""}
            {sug ? `Gợi ý ${fmt(sug.baseStart)} – ${fmt(sug.baseEnd)} (${daysBetween(sug.baseStart, sug.baseEnd)} ngày, bằng độ dài giai đoạn sau${f.ongoing ? " tính đến hôm nay" : ""}). ` : "Nhập ngày bắt đầu để có gợi ý. "}
            Nên tránh khoảng có sự kiện bất thường (Tết, sale lớn). Dữ liệu có từ 01/07/2026.
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={label}>Mô tả chi tiết giải pháp</span>
          <textarea style={{ ...input, minHeight: 80, resize: "vertical" }} value={f.description} onChange={(e) => set({ description: e.target.value })}
            placeholder="Làm gì, vì sao, ai phụ trách, kỳ vọng chỉ số nào cải thiện…" />
        </div>
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 10 }}>⚠ {err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button style={primary} disabled={busy} onClick={submit}>{busy ? "Đang lưu…" : "💾 Lưu giải pháp"}</button>
        <button style={ghost} disabled={busy} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}

// good = the direction that means "better" for this metric (1 up, -1 down, 0 neutral)
function toneOf(x, good) {
  if (x == null || !good || Math.abs(x) < 1e-9) return "var(--text-secondary)";
  return x * good > 0 ? "var(--green)" : "var(--red)";
}

function metricRows(imp) {
  const t = imp.trial, c = imp.control;
  const pct = (x) => (x == null ? "—" : `${sgn(x, n1)}%`);
  return [
    { key: "orders", name: "Tổng sản lượng (đơn)", b: n0(t.base.orders), p: n0(t.post.orders), d: sgn(t.delta.orders, n0), dp: pct(t.delta.ordersPct), dRaw: t.delta.orders, good: 0,
      cb: n0(c.base.orders), cp: n0(c.post.orders), cd: pct(c.delta.ordersPct), cdRaw: c.delta.ordersPct, net: "—" },
    { key: "tons", name: "Tổng tấn", b: n1(t.base.tons), p: n1(t.post.tons), d: sgn(t.delta.tons, n1), dp: pct(t.delta.tonsPct), dRaw: t.delta.tons, good: 0,
      cb: n1(c.base.tons), cp: n1(c.post.tons), cd: pct(c.delta.tonsPct), cdRaw: c.delta.tonsPct, net: "—" },
    { key: "ontime", name: "Tỷ lệ On-time (%)", b: t.base.ontimePct == null ? "—" : `${n1(t.base.ontimePct)}%`, p: t.post.ontimePct == null ? "—" : `${n1(t.post.ontimePct)}%`,
      sub: [`${n0(t.base.late)} trễ / ${n0(t.base.evaluated)}`, `${n0(t.post.late)} trễ / ${n0(t.post.evaluated)}`],
      d: t.delta.ontimePts == null ? "—" : `${sgn(t.delta.ontimePts, n1)} điểm`, dp: "", dRaw: t.delta.ontimePts, good: 1,
      cb: c.base.ontimePct == null ? "—" : `${n1(c.base.ontimePct)}%`, cp: c.post.ontimePct == null ? "—" : `${n1(c.post.ontimePct)}%`,
      cd: c.delta.ontimePts == null ? "—" : `${sgn(c.delta.ontimePts, n1)} điểm`, cdRaw: c.delta.ontimePts,
      net: imp.net.ontimePts == null ? "—" : `${sgn(imp.net.ontimePts, n1)} điểm`, netRaw: imp.net.ontimePts },
    { key: "cases", name: "Tổng số ca bể vỡ (ca)", b: n0(t.base.cases), p: n0(t.post.cases), d: sgn(t.delta.cases, n0), dp: pct(t.delta.casesPct), dRaw: t.delta.cases, good: -1,
      cb: n0(c.base.cases), cp: n0(c.post.cases), cd: sgn(c.delta.cases, n0), cdRaw: c.delta.cases, net: "—" },
    { key: "per1k", name: "Ca bể vỡ / 1.000 đơn", b: n2(t.base.per1k), p: n2(t.post.per1k), d: sgn(t.delta.per1k, n2), dp: pct(t.delta.per1kPct), dRaw: t.delta.per1k, good: -1,
      // Control change and net effect in % (user decision 28/09: net = % change of scope − % change of control)
      cb: n2(c.base.per1k), cp: n2(c.post.per1k), cd: pct(c.delta.per1kPct), cdRaw: c.delta.per1kPct,
      net: imp.net.per1kPct == null ? "—" : pct(imp.net.per1kPct), netRaw: imp.net.per1kPct },
  ];
}

const VERDICT_STYLE = {
  excellent: { color: "var(--green)", bg: "var(--green-glow)", icon: "🏆" },
  improved: { color: "var(--blue)", bg: "var(--blue-glow)", icon: "✅" },
  watch: { color: "var(--amber)", bg: "var(--amber-glow)", icon: "⏳" },
  ineffective: { color: "var(--red)", bg: "var(--red-glow)", icon: "⚠" },
};
// Light colours for the white print page.
const PRINT_VERDICT = {
  excellent: { color: "#065f46", bg: "#d1fae5" },
  improved: { color: "#075985", bg: "#e0f2fe" },
  watch: { color: "#92400e", bg: "#fef3c7" },
  ineffective: { color: "#991b1b", bg: "#fee2e2" },
};

const scopeParts = (t) => [
  ["Khách hàng", t.clients.join(", ")],
  ["Kho lấy", t.khoLay.length ? t.khoLay.map(shortWh).join(", ") : "Tất cả"],
  ["Kho giao", t.khoGiao.length ? t.khoGiao.map(shortWh).join(", ") : "Tất cả"],
  ["Tỉnh giao", t.provinces.length ? t.provinces.join(", ") : "Tất cả"],
];
const periodLabels = (imp) => {
  const pr = imp.periods;
  return {
    base: `Trước (${fmtS(pr.base.from)}–${fmtS(pr.base.to)} · ${imp.baseDays} ngày)`,
    post: `Sau (${fmtS(pr.post.from)}–${fmtS(pr.post.to)} · ${imp.postDays} ngày${pr.post.ongoing ? ", đến hôm nay" : ""})`,
  };
};

// Text for "Copy tóm tắt" — the same lines as the screen and the files.
function summaryText(trial, imp) {
  const L = periodLabels(imp);
  const v = imp.verdict;
  return [
    `BÁO CÁO ĐÁNH GIÁ GIẢI PHÁP: ${trial.name}`,
    `Trạng thái: ${trial.status} · Áp dụng ${fmt(trial.startDate)} → ${trial.endDate ? fmt(trial.endDate) : "Ongoing"}`,
    `Phạm vi: ${scopeParts(trial).map(([k, x]) => `${k}: ${x}`).join(" · ")}`,
    `So sánh: ${L.base} vs ${L.post}`,
    "",
    `KẾT LUẬN: ${v.label.toUpperCase()}${v.basis === "net" ? " (theo hiệu quả ròng, đã trừ nhóm đối chứng)" : ""}`,
    ...v.reasons.map((s) => `• ${s}`),
    ...v.notes.map((s) => `Lưu ý: ${s}`),
    "",
    "Số liệu:",
    ...imp.summary.map((s) => `• ${s}`),
    ...imp.warnings.map((w) => `⚠ ${w.text}`),
    `(SD3 Dashboard Điện Máy, số liệu cập nhật ${vnStamp(imp.dataAsOf)})`,
  ].join(NL);
}

function VerdictBox({ v }) {
  const st = VERDICT_STYLE[v.level];
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: st.bg, border: `1px solid ${st.color}`, borderLeftWidth: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Nhận định tự động</span>
        <span style={{ fontSize: 17, fontWeight: 800, color: st.color }}>{st.icon} {v.label}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{v.basis === "net" ? "theo hiệu quả ròng (đã trừ nhóm đối chứng)" : "theo thay đổi của phạm vi"}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        {v.reasons.map((s, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>• {s}</div>)}
        {v.notes.map((s, i) => <div key={`n${i}`} style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Lưu ý: {s}</div>)}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer" }}>Luật nhận định</summary>
        <div style={{ ...small, marginTop: 4 }}>
          <b>Cải thiện xuất sắc</b>: ca/1.000 đơn giảm ≥ {-v.rules.damageStrong}% hoặc on-time +≥ {v.rules.ontimeStrong} điểm, chỉ số còn lại không xấu đi ·{" "}
          <b>Có cải thiện</b>: giảm ≥ {-v.rules.damageGood}% hoặc +≥ {v.rules.ontimeGood} điểm, không chỉ số nào xấu đi ·{" "}
          <b>Không hiệu quả</b>: ca/1.000 đơn tăng ≥ {v.rules.damageBad}% hoặc on-time −≥ {-v.rules.ontimeBad} điểm, không có chỉ số bù lại · còn lại: <b>Cần theo dõi thêm</b>.
          Dùng hiệu quả ròng khi đối chứng có ≥ {v.rules.minControlOrders} đơn mỗi giai đoạn (bể vỡ: % thay đổi của phạm vi − % thay đổi của đối chứng; on-time: điểm). Chưa đủ dữ liệu (giai đoạn sau &lt; 14 ngày hoặc &lt; 100 đơn) → Cần theo dõi thêm; tổng ca bể vỡ 2 giai đoạn &lt; {v.rules.minCases} → không xét bể vỡ.
        </div>
      </details>
    </div>
  );
}

function TrialDetail({ trial, impact, loading, error, onClose, onEdit }) {
  const [copied, setCopied] = useState(null);
  const [showCases, setShowCases] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { setShowCases(false); setMsg(null); }, [trial?.id]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") (printing ? setPrinting(false) : onClose()); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [printing, onClose]);

  const imp = impact;
  const rows = imp ? metricRows(imp) : [];
  const L = imp ? periodLabels(imp) : null;
  const pr = imp?.periods;

  const copy = (kind) => {
    let text;
    if (kind === "table") {
      const head = ["Chỉ số", L.base, L.post, "Chênh lệch", "% thay đổi", ...(imp.hasControl ? ["Đối chứng trước", "Đối chứng sau", "Đối chứng thay đổi", "Hiệu quả ròng"] : [])];
      // Plain "-" and no "±" so Excel reads the pasted cells as numbers.
      const cell = (v) => String(v).replace(/−/g, "-").replace(/^±/, "");
      text = [head, ...rows.map((r) => [r.name, r.b, r.p, r.d, r.dp || "", ...(imp.hasControl ? [r.cb, r.cp, r.cd, r.net] : [])].map(cell))].map((r) => r.join(TAB)).join(NL);
    } else text = summaryText(trial, imp);
    try { navigator.clipboard.writeText(text); setCopied(kind); setTimeout(() => setCopied(null), 1500); } catch { /* no clipboard */ }
  };
  const downloadXlsx = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/trials?impact=${encodeURIComponent(trial.id)}&format=xlsx`);
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Không xuất được file"); }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `Danh-gia-giai-phap-${trial.id}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setMsg(`⚠ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const th = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12 };
  const td = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontSize: 13, borderBottom: "1px solid var(--panel-border-soft, var(--border))" };
  const ctd = { ...td, color: "var(--text-muted)", fontSize: 12.5 };
  const cases = imp ? imp.trial.base.caseCodes.concat(imp.trial.post.caseCodes) : [];
  const infoCell = { background: "rgba(var(--brand-rgb),0.05)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", minWidth: 0 };

  return (
    <div role="dialog" aria-modal="true" aria-label={trial.name}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 12px", overflowY: "auto" }}>
      <div className="fade-in" style={{ width: "100%", maxWidth: 1120, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.45)", boxSizing: "border-box" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Báo cáo đánh giá giải pháp · {trial.id}</div>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.35, marginTop: 2 }}>{trial.name} <StatusBadge s={trial.status} /></div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {onEdit && <button style={ghost} onClick={onEdit}>✎ Sửa</button>}
            <button style={primary} disabled={!imp || busy} onClick={downloadXlsx}>{busy ? "Đang xuất…" : "📥 Xuất báo cáo đánh giá (Excel)"}</button>
            <button style={ghost} disabled={!imp} onClick={() => setPrinting(true)}>🖨 In / Lưu PDF</button>
            <button style={ghost} disabled={!imp} onClick={() => copy("text")}>{copied === "text" ? "✓ Đã copy" : "📋 Copy tóm tắt"}</button>
            <button style={ghost} disabled={!imp} onClick={() => copy("table")}>{copied === "table" ? "✓ Đã copy" : "📋 Copy bảng"}</button>
            <button style={{ ...ghost, padding: "6px 10px" }} onClick={onClose} aria-label="Đóng" title="Đóng (Esc)">✕</button>
          </div>
        </div>
        {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: "var(--red)" }}>{msg}</div>}

        {/* General info */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginTop: 14 }}>
          {scopeParts(trial).map(([k, x]) => (
            <div key={k} style={infoCell}><div style={small}>{k}</div><div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{x}</div></div>
          ))}
          <div style={infoCell}><div style={small}>Thời gian áp dụng</div><div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(trial.startDate)} → {trial.endDate ? fmt(trial.endDate) : "Ongoing"}</div></div>
          <div style={infoCell}><div style={small}>Baseline (trước khi áp dụng)</div><div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(trial.baseStart)} – {fmt(trial.baseEnd)}</div></div>
          <div style={infoCell}><div style={small}>Người tạo</div><div style={{ fontSize: 13, fontWeight: 600 }}>{trial.createdBy || "—"} <span style={{ ...small, fontWeight: 400 }}>{vnStamp(trial.createdAt)}</span></div></div>
          <div style={infoCell}><div style={small}>Cập nhật lần cuối</div><div style={{ fontSize: 13, fontWeight: 600 }}>{trial.updatedBy || "—"} <span style={{ ...small, fontWeight: 400 }}>{vnStamp(trial.updatedAt)}</span></div></div>
        </div>
        <div style={{ ...infoCell, marginTop: 8 }}>
          <div style={small}>Mô tả giải pháp</div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{trial.description || <span style={{ color: "var(--text-muted)" }}>Chưa có mô tả.</span>}</div>
        </div>

        {error ? <div style={{ marginTop: 14, color: "var(--red)", fontSize: 13 }}>⚠ {error}</div>
          : !imp ? <div style={{ marginTop: 14, ...small }}>{loading ? "Đang tính hiệu quả…" : ""}</div> : (
            <>
              <VerdictBox v={imp.verdict} />

              {imp.warnings.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {imp.warnings.map((w, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--amber)" }}>⚠ {w.text}</div>)}
                </div>
              )}

              <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 16 }}>So sánh Trước & Sau</div>
              <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table className="data-table" style={{ fontSize: 12.5, minWidth: imp.hasControl ? 820 : 520 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }} rowSpan={2}>Chỉ số</th>
                      <th style={{ ...th, textAlign: "center", borderBottom: "1px solid var(--border)" }} colSpan={4}>Phạm vi áp dụng giải pháp</th>
                      {imp.hasControl && <th style={{ ...th, textAlign: "center", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }} colSpan={3} title="Đơn của cùng khách nhưng KHÔNG thuộc phạm vi giải pháp, cùng 2 giai đoạn">Đối chứng (phần còn lại của khách)</th>}
                      {imp.hasControl && <th style={{ ...th }} rowSpan={2} title="Thay đổi của phạm vi trừ thay đổi của đối chứng — phần cải thiện không giải thích được bằng mùa vụ / biến động chung">Hiệu quả ròng</th>}
                    </tr>
                    <tr>
                      <th style={th}>Trước<div style={{ ...small, fontWeight: 400, fontSize: 11 }}>{fmtS(pr.base.from)}–{fmtS(pr.base.to)} · {imp.baseDays} ngày</div></th>
                      <th style={th}>Sau<div style={{ ...small, fontWeight: 400, fontSize: 11 }}>{fmtS(pr.post.from)}–{fmtS(pr.post.to)} · {imp.postDays} ngày{pr.post.ongoing ? "*" : ""}</div></th>
                      <th style={th}>Chênh lệch</th><th style={th}>% thay đổi</th>
                      {imp.hasControl && <><th style={th}>Trước</th><th style={th}>Sau</th><th style={th}>Thay đổi</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{r.name}</td>
                        <td style={td}>{r.b}{r.sub && <div style={{ ...small, fontSize: 11 }}>{r.sub[0]}</div>}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{r.p}{r.sub && <div style={{ ...small, fontSize: 11, fontWeight: 400 }}>{r.sub[1]}</div>}</td>
                        <td style={{ ...td, fontWeight: 700, color: toneOf(r.dRaw, r.good) }}>{r.d}</td>
                        <td style={{ ...td, color: toneOf(r.dRaw, r.good) }}>{r.dp || ""}</td>
                        {imp.hasControl && <><td style={ctd}>{r.cb}</td><td style={ctd}>{r.cp}</td><td style={ctd}>{r.cd}</td></>}
                        {imp.hasControl && <td style={{ ...td, fontWeight: 700, color: toneOf(r.netRaw, r.good) }}>{r.net}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!imp.hasControl && (
                <div style={{ ...small, marginTop: 4 }}>
                  {imp.scope.hasRouteScope ? "Không có đơn đối chứng (khách không có đơn ngoài phạm vi trong 2 giai đoạn)." : "Phạm vi là toàn bộ đơn của khách nên không có nhóm đối chứng — thu hẹp theo kho / tỉnh để có đối chứng."}
                </div>
              )}

              <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "rgba(var(--brand-rgb),0.06)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Số liệu tóm tắt</div>
                {imp.summary.map((s, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>• {s}</div>)}
              </div>

              {cases.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button style={{ ...ghost, padding: "4px 10px", fontSize: 12 }} onClick={() => setShowCases((v) => !v)}>{showCases ? "Ẩn danh sách ca" : `Xem ${cases.length} ca bể vỡ trong phạm vi`}</button>
                  {showCases && (
                    <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
                      <table className="data-table" style={{ fontSize: 12 }}>
                        <thead><tr><th>Giai đoạn</th><th>Mã đơn</th><th>Ngày phát hiện</th><th>Chặng nghi lỗi</th><th>Kho phát hiện</th></tr></thead>
                        <tbody>
                          {cases.map((c) => (
                            <tr key={c.order_code}><td>{c.period === "base" ? "Trước" : "Sau"}</td><td style={{ fontWeight: 700 }}>{c.order_code}</td><td>{c.case_date}</td><td>{c.leg}</td><td>{shortWh(c.warehouse)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div style={{ ...small, marginTop: 10 }}>
                {pr.post.ongoing && "* Ongoing: giai đoạn sau tính đến hôm nay. "}
                Cách tính: đơn theo <b>ngày lấy hàng</b> trong từng giai đoạn · Tấn = tổng khối lượng đơn · On-time = đúng hạn / (đúng hạn + trễ), chỉ đơn đã có kết quả · Ca bể vỡ = ca trong &quot;Báo cáo bể vỡ&quot; Rillnet <b>gắn theo đơn</b> (đơn lấy ở giai đoạn nào thì ca tính vào giai đoạn đó) · Ca/1.000 đơn = ca ÷ đơn lấy × 1.000 · Hiệu quả ròng = thay đổi của phạm vi − thay đổi của đối chứng (on-time: điểm; ca/1.000 đơn: % thay đổi của phạm vi − % thay đổi của đối chứng). Xanh = tốt lên, đỏ = xấu đi. Số liệu cập nhật {vnStamp(imp.dataAsOf)}.
              </div>
            </>
          )}
      </div>
      {/* Portal to <body>: printing a page nested in the scrolling modal would clip it to one page. */}
      {printing && imp && createPortal(<TrialPrintView trial={trial} imp={imp} rows={rows} onClose={() => setPrinting(false)} />, document.body)}
    </div>
  );
}

// White A4 page for "In / Lưu PDF" — reuses the .exec-report print CSS of
// the "Báo cáo tóm tắt" (only this block is printed).
function TrialPrintView({ trial, imp, rows, onClose }) {
  const C = { text: "#111827", muted: "#6b7280", line: "#e5e7eb", head: "#0f7c7b", green: "#15803d", red: "#dc2626" };
  const pv = PRINT_VERDICT[imp.verdict.level];
  const pr = imp.periods;
  const tone = (v, good) => (v == null || !good || Math.abs(v) < 1e-9 ? C.text : v * good > 0 ? C.green : C.red);
  const cell = { padding: "6px 8px", borderBottom: `1px solid ${C.line}`, textAlign: "right", whiteSpace: "nowrap", fontSize: 12 };
  const hcell = { ...cell, background: C.head, color: "#fff", fontWeight: 700, borderBottom: "none" };
  const cases = imp.trial.base.caseCodes.concat(imp.trial.post.caseCodes);
  const btn = { fontSize: 13, padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${C.line}`, background: "#fff", color: C.text };
  return (
    <div className="exec-report" style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#e5e7eb", overflowY: "auto", color: C.text }}>
      <div className="no-print" style={{ position: "sticky", top: 0, display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 20px", background: "#f3f4f6", borderBottom: `1px solid ${C.line}` }}>
        <span style={{ marginRight: "auto", fontSize: 13, color: C.muted, alignSelf: "center" }}>Xem trước bản in — chọn &quot;Lưu dưới dạng PDF&quot; trong hộp thoại in để lưu file.</span>
        <button style={{ ...btn, background: "#c2410c", borderColor: "#c2410c", color: "#fff" }} onClick={() => window.print()}>🖨 In / Lưu PDF</button>
        <button style={btn} onClick={onClose}>Đóng</button>
      </div>
      <div className="exec-page" style={{ maxWidth: 820, margin: "20px auto", background: "#fff", padding: "32px 36px", boxShadow: "0 4px 20px rgba(0,0,0,0.12)", fontFamily: "inherit" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.head, letterSpacing: 0.6, textTransform: "uppercase" }}>SD3 Dashboard Điện Máy · Báo cáo đánh giá hiệu quả giải pháp</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, lineHeight: 1.3 }}>{trial.name}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Mã {trial.id} · Trạng thái: {trial.status} · Số liệu cập nhật {vnStamp(imp.dataAsOf)}</div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 12 }}>
          <tbody>
            {[...scopeParts(trial), ["Thời gian áp dụng", `${fmt(trial.startDate)} → ${trial.endDate ? fmt(trial.endDate) : "Ongoing"}`],
              ["So sánh", `${periodLabels(imp).base} vs ${periodLabels(imp).post}`]].map(([k, x]) => (
              <tr key={k}><td style={{ padding: "4px 8px 4px 0", color: C.muted, width: 150, verticalAlign: "top" }}>{k}</td><td style={{ padding: "4px 0", fontWeight: 600 }}>{x}</td></tr>
            ))}
            {trial.description && <tr><td style={{ padding: "4px 8px 4px 0", color: C.muted, verticalAlign: "top" }}>Mô tả</td><td style={{ padding: "4px 0", whiteSpace: "pre-wrap" }}>{trial.description}</td></tr>}
          </tbody>
        </table>

        <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 8, background: pv.bg, color: pv.color, breakInside: "avoid" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Nhận định tự động{imp.verdict.basis === "net" ? " · theo hiệu quả ròng (đã trừ nhóm đối chứng)" : ""}</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{imp.verdict.label}</div>
          {imp.verdict.reasons.map((s, i) => <div key={i} style={{ fontSize: 12, marginTop: 3, color: C.text }}>• {s}</div>)}
          {imp.verdict.notes.map((s, i) => <div key={`n${i}`} style={{ fontSize: 11.5, marginTop: 3, color: C.muted }}>Lưu ý: {s}</div>)}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 18 }}>So sánh Trước & Sau</div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, breakInside: "avoid" }}>
          <thead>
            <tr>
              <th style={{ ...hcell, textAlign: "left" }}>Chỉ số</th>
              <th style={hcell}>Trước<div style={{ fontWeight: 400, fontSize: 10 }}>{fmtS(pr.base.from)}–{fmtS(pr.base.to)}</div></th>
              <th style={hcell}>Sau<div style={{ fontWeight: 400, fontSize: 10 }}>{fmtS(pr.post.from)}–{fmtS(pr.post.to)}</div></th>
              <th style={hcell}>Chênh lệch</th><th style={hcell}>%</th>
              {imp.hasControl && <><th style={hcell}>Đối chứng<div style={{ fontWeight: 400, fontSize: 10 }}>trước → sau</div></th><th style={hcell}>Hiệu quả ròng</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{r.name}</td>
                <td style={cell}>{r.b}</td>
                <td style={{ ...cell, fontWeight: 700 }}>{r.p}</td>
                <td style={{ ...cell, fontWeight: 700, color: tone(r.dRaw, r.good) }}>{r.d}</td>
                <td style={{ ...cell, color: tone(r.dRaw, r.good) }}>{r.dp || ""}</td>
                {imp.hasControl && <><td style={{ ...cell, color: C.muted }}>{r.cb} → {r.cp}</td><td style={{ ...cell, fontWeight: 700, color: tone(r.netRaw, r.good) }}>{r.net}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {imp.warnings.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {imp.warnings.map((w, i) => <div key={i} style={{ fontSize: 11.5, color: "#92400e", marginTop: 2 }}>⚠ {w.text}</div>)}
          </div>
        )}

        {cases.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 18 }}>Ca bể vỡ trong phạm vi ({cases.length})</div>
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 11 }}>
              <thead><tr>{["Giai đoạn", "Mã đơn", "Ngày phát hiện", "Chặng nghi lỗi", "Kho phát hiện"].map((h) => <th key={h} style={{ ...hcell, textAlign: "left", fontSize: 11 }}>{h}</th>)}</tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.order_code}>{[c.period === "base" ? "Trước" : "Sau", c.order_code, c.case_date, c.leg, shortWh(c.warehouse)].map((x, i) => <td key={i} style={{ ...cell, textAlign: "left", fontSize: 11 }}>{x}</td>)}</tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}

        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 18, lineHeight: 1.5, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          Cách tính: đơn theo ngày lấy hàng · Tấn = tổng khối lượng đơn · On-time = đúng hạn / (đúng hạn + trễ), chỉ đơn đã có kết quả · Ca bể vỡ = ca trong &quot;Báo cáo bể vỡ&quot; Rillnet gắn theo đơn · Ca/1.000 đơn = ca ÷ đơn lấy × 1.000 · Đối chứng = đơn của cùng khách ngoài phạm vi, cùng 2 giai đoạn · Hiệu quả ròng = thay đổi của phạm vi − thay đổi của đối chứng (on-time: điểm; ca/1.000 đơn: % thay đổi của phạm vi − % thay đổi của đối chứng).
          {" "}In lúc {vnStamp(new Date().toISOString())}.
        </div>
      </div>
    </div>
  );
}

export default function TabTrials() {
  const [data, setData] = useState(null); // { trials, version, canDelete, statuses }
  const [err, setErr] = useState(null);
  const [version, setVersion] = useState("");
  const [options, setOptions] = useState(null);
  const [editing, setEditing] = useState(null); // form initial values
  const [selected, setSelected] = useState(null);
  const [impacts, setImpacts] = useState({}); // `${id}|${updatedAt}` → { impact } | { error }
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);

  const load = (v = version) => fetch(`/api/trials${v ? `?v=${encodeURIComponent(v)}` : ""}`)
    .then((r) => r.json())
    .then((j) => { if (!j.ok) throw new Error(j.error || "Không tải được danh sách"); setData(j); setErr(null); return j; })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing || options) return;
    fetch("/api/trials?options=1").then((r) => r.json()).then((j) => { if (j.ok) setOptions(j.options); else setMsg(`⚠ ${j.error}`); }).catch((e) => setMsg(`⚠ ${e.message}`));
  }, [editing, options]);

  const trials = data?.trials || [];
  const sel = trials.find((t) => t.id === selected) || null;
  const impactKey = sel ? `${sel.id}|${sel.updatedAt}` : "";
  useEffect(() => {
    if (!sel || impacts[impactKey]) return;
    setLoadingImpact(true);
    fetch(`/api/trials?impact=${encodeURIComponent(sel.id)}${version ? `&v=${encodeURIComponent(version)}` : ""}`)
      .then((r) => r.json())
      .then((j) => setImpacts((m) => ({ ...m, [impactKey]: j.ok ? { impact: j.impact } : { error: j.error || "Không tính được" } })))
      .catch((e) => setImpacts((m) => ({ ...m, [impactKey]: { error: e.message } })))
      .finally(() => setLoadingImpact(false));
  }, [impactKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => Object.fromEntries((data?.statuses || []).map((s) => [s, trials.filter((t) => t.status === s).length])), [trials, data]);
  const shown = trials.filter((t) => (filter === "all" || t.status === filter)
    && (!q || `${t.name} ${t.clients.join(" ")} ${t.khoLay.join(" ")} ${t.khoGiao.join(" ")} ${t.provinces.join(" ")}`.toLowerCase().includes(q.toLowerCase())));

  const startEdit = (t) => {
    setMsg(null);
    setEditing(t ? { ...EMPTY, ...t, ongoing: !t.endDate } : { ...EMPTY });
    if (typeof window !== "undefined") window.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  const onSaved = async (j) => {
    setVersion(j.version);
    setEditing(null);
    setMsg(`✓ ${j.created ? "Đã thêm" : "Đã lưu"} "${j.trial.name}"`);
    await load(j.version);
    setSelected(j.trial.id);
  };
  const remove = async (t) => {
    if (!confirm(`Xoá giải pháp "${t.name}"?\nDòng vẫn được giữ trong Google Sheet (đánh dấu đã xoá) để tra cứu.`)) return;
    try {
      const r = await fetch("/api/trials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: t.id }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Không xoá được");
      setVersion(j.version);
      if (selected === t.id) setSelected(null);
      setMsg(`✓ Đã xoá "${t.name}"`);
      await load(j.version);
    } catch (e) {
      setMsg(`⚠ ${e.message}`);
    }
  };

  const cur = impacts[impactKey];
  const closeDetail = useCallback(() => setSelected(null), []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="glass" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Sổ tay Cải tiến & Đo lường Giải pháp</div>
            <div style={small}>Ghi lại các giải pháp trial (tách tuyến, test CCDC…) và đo hiệu quả thật từ dữ liệu LTL + Rillnet: trước vs sau, có nhóm đối chứng.</div>
          </div>
          {!editing && <button style={primary} onClick={() => startEdit(null)}>＋ Thêm giải pháp</button>}
        </div>
        {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
      </div>

      {editing && (
        <TrialForm key={editing.id || "new"} initial={editing} options={options} statuses={data?.statuses || ["Đang trial", "Thành công (Đã nhân rộng)", "Đã hủy"]}
          onCancel={() => setEditing(null)} onSaved={onSaved} />
      )}

      <div className="glass" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, khách, kho…" style={{ ...input, width: 220, maxWidth: "100%" }} />
          <button style={seg(filter === "all")} onClick={() => setFilter("all")}>Tất cả ({trials.length})</button>
          {(data?.statuses || []).map((s) => <button key={s} style={seg(filter === s)} onClick={() => setFilter(s)}>{s} ({counts[s] || 0})</button>)}
        </div>
        {err ? <div style={{ color: "var(--red)", fontSize: 13 }}>⚠ {err}</div> : !data ? <div style={small}>Đang tải…</div> : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ fontSize: 12.5, minWidth: 760 }}>
              <thead><tr><th>Giải pháp</th><th>Khách</th><th>Phạm vi</th><th>Thời gian</th><th>Trạng thái</th><th>Cập nhật</th><th /></tr></thead>
              <tbody>
                {shown.map((t) => {
                  const on = t.id === selected;
                  const scope = [
                    t.khoLay.length ? `Lấy: ${t.khoLay.map(shortWh).join(", ")}` : "",
                    t.khoGiao.length ? `Giao: ${t.khoGiao.map(shortWh).join(", ")}` : "",
                    t.provinces.length ? `Tỉnh: ${t.provinces.join(", ")}` : "",
                  ].filter(Boolean).join(" · ") || "Toàn bộ đơn của khách";
                  return (
                    <tr key={t.id} onClick={() => setSelected(on ? null : t.id)} style={{ cursor: "pointer", background: on ? "rgba(var(--brand-rgb),0.10)" : undefined }}>
                      <td style={{ fontWeight: 600, maxWidth: 320, whiteSpace: "normal" }}>{on ? "▾ " : "▸ "}{t.name}</td>
                      <td style={{ whiteSpace: "normal", maxWidth: 160 }}>{t.clients.join(", ")}</td>
                      <td style={{ whiteSpace: "normal", maxWidth: 260, color: "var(--text-secondary)" }}>{scope}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtS(t.startDate)} → {t.endDate ? fmtS(t.endDate) : "Ongoing"}</td>
                      <td><StatusBadge s={t.status} /></td>
                      <td style={{ ...small, whiteSpace: "nowrap" }}>{t.updatedBy}<br />{vnStamp(t.updatedAt)}</td>
                      <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <button style={{ ...ghost, padding: "3px 8px", fontSize: 11.5 }} onClick={() => startEdit(t)}>Sửa</button>
                        {data.canDelete && <button style={{ ...danger, padding: "3px 8px", fontSize: 11.5, marginLeft: 4 }} onClick={() => remove(t)}>Xoá</button>}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr><td colSpan={7} style={{ color: "var(--text-muted)", padding: 16 }}>
                    {trials.length ? "Không có giải pháp khớp bộ lọc." : "Chưa có giải pháp nào — bấm \"＋ Thêm giải pháp\" để ghi giải pháp đầu tiên."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sel && (
        <TrialDetail trial={sel} impact={cur?.impact} error={cur?.error} loading={loadingImpact}
          onClose={closeDetail} onEdit={() => { setSelected(null); startEdit(sel); }} />
      )}
    </div>
  );
}
