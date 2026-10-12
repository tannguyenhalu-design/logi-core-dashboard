/**
 * components/TabInternalReport.js
 * Tab "Báo cáo nội bộ ĐTĐM" — chuẩn format giao ban Confluence W38-W41.
 * Bảng 1: On-time LTL chi tiết từng KH (auto từ /api/report/biweekly).
 * Bảng 2: Bể vỡ & Đền bù chi tiết từng KH + Insight textarea.
 * Bảng 3: Pipeline dự án mới (8 cột).
 * Bảng 4: Action Plan PIC Tú / Đạt / Diện / Tân.
 * Lưu: localStorage (per period) + Vercel Blob.
 */
import { useState, useEffect, useCallback, useRef } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function vnNow() { return new Date(Date.now() + 7 * 3600 * 1000); }

function getISOWeek(d) {
  const tmp = new Date(d.getTime());
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const ys = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return { week: Math.ceil((((tmp - ys) / 86400000) + 1) / 7), year: tmp.getUTCFullYear() };
}

function defaultBiweeklyPeriod(week, year) {
  const lastOdd = week % 2 === 0 ? week - 1 : week - 2;
  if (lastOdd < 1) return `${year - 1}-W51`;
  return `${year}-W${String(lastOdd).padStart(2, "0")}`;
}

function listBiweeklyPeriods(week, year) {
  const lastOdd = week % 2 === 0 ? week - 1 : week - 2;
  const out = [];
  for (let i = 0; i < 8; i++) {
    const odd = lastOdd - i * 2;
    if (odd < 1) break;
    out.push({ value: `${year}-W${String(odd).padStart(2, "0")}`, label: `W${odd - 1}–W${odd}` });
  }
  return out;
}

const fmtN = (v) => (v == null || v === "" || v === 0 ? "—" : Number(v).toLocaleString("vi-VN"));
const fmtP = (v) => (v == null || isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`);
const colShortLabel = (col) => {
  if (col.kind === "span") return col.sub || col.label;
  const m = String(col.label || "").match(/W(\d+)/);
  const suffix = col.mature === false ? "*" : "";
  return m ? `W${m[1]}${suffix}` : (col.label || "");
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PICS = ["Tú", "Đạt", "Diện", "Tân"];
const TASK_STATUSES = ["pending", "inprogress", "done"];
const TASK_LABEL = { pending: "Chờ xử lý", inprogress: "Đang làm", done: "Hoàn thành" };
const TASK_COLOR = { pending: "var(--text-muted)", inprogress: "var(--amber)", done: "var(--green)" };

const PIPELINE_STATUSES = ["Đang đàm phán", "Chờ hợp đồng", "Đang onboard", "Hoạt động", "Tạm dừng", "Từ chối"];
const PIPELINE_STATUS_COLOR = { "Đang đàm phán": "var(--amber)", "Chờ hợp đồng": "#3b82f6", "Đang onboard": "var(--cyan, #06b6d4)", "Hoạt động": "var(--green)", "Tạm dừng": "var(--text-muted)", "Từ chối": "var(--red)" };

const INITIAL_PIPELINE = [
  { id: "p01", name: "Honda",              status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p02", name: "MUJI",               status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p03", name: "LC FOODS",           status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p04", name: "NÓN SƠN",            status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p05", name: "LOF",                status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p06", name: "FINE TODAY",         status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p07", name: "Digiworld MN",       status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p08", name: "Mutosi",             status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p09", name: "Karcher",            status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
  { id: "p10", name: "Lắp đặt Nguyễn Kim",status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" },
];

// ── Shared styles ─────────────────────────────────────────────────────────────

const panel = { background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 16 };
const h3s = { fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 };
const thBase = { padding: "6px 8px", fontSize: 11, fontWeight: 600, color: "#fff", background: "rgba(15,124,123,0.85)", whiteSpace: "nowrap", textAlign: "right" };
const tdBase = { padding: "5px 8px", fontSize: 11.5, borderBottom: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" };
const cellInput = { width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 11.5, color: "var(--text-primary)", padding: "2px 4px" };

// ── Sub: SectionHeader ────────────────────────────────────────────────────────

function SectionHeader({ title, badge, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      <h3 style={{ ...h3s, margin: 0 }}>{title}</h3>
      {badge && <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: "rgba(15,124,123,0.15)", color: "var(--cyan, #06b6d4)", fontWeight: 600 }}>{badge}</span>}
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

// ── Sub: OntimeTable ──────────────────────────────────────────────────────────

function OntimeTable({ section, loading }) {
  if (loading) return <div style={{ fontSize: 12, color: "var(--amber)", padding: "20px 0", textAlign: "center" }}>⏳ Đang tải số liệu từ Báo cáo Công ty...</div>;
  if (!section) return <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>Chưa có dữ liệu — chọn kỳ ở trên.</div>;
  const { cols, rows, delta } = section;
  const deltaIdx = delta || [cols.length - 2, cols.length - 1];
  const sep = { borderLeft: "2px solid rgba(15,124,123,0.4)" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...thBase, textAlign: "left", minWidth: 160 }} rowSpan={2}>Khách hàng</th>
            <th style={{ ...thBase, textAlign: "center", ...sep }} colSpan={cols.length + 1}># Đơn LTC</th>
            <th style={{ ...thBase, textAlign: "center", ...sep }} colSpan={cols.length + 1}>% On-time</th>
          </tr>
          <tr>
            {[0, 1].map(() => cols.map((c, i) => (
              <th key={`${i}_${c.key}`} style={{ ...thBase, ...(i === 0 ? sep : {}), fontWeight: c.kind === "span" ? 700 : 500, fontSize: 10.5, background: c.kind === "span" && c.sub === "Kỳ này" ? "rgba(15,124,123,1)" : "rgba(15,124,123,0.85)" }}>
                {colShortLabel(c)}
              </th>
            )).concat(<th key="delta" style={{ ...thBase, fontSize: 10.5 }}>±</th>))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isTot = row.total && !row.grand;
            const isGrand = row.grand;
            const rowBg = isGrand ? "rgba(15,124,123,0.18)" : isTot ? "rgba(15,124,123,0.07)" : undefined;
            const fw = isGrand ? 700 : isTot ? 600 : 400;
            const d = delta ? (() => {
              const [ia, ib] = delta;
              const ca = Number(row.counts[ia]), cb = Number(row.counts[ib]);
              const ra = row.rates[ia], rb = row.rates[ib];
              return {
                count: !ca && !cb ? null : cb - ca,
                rate: ra == null || rb == null ? null : (rb - ra) * 100,
              };
            })() : null;
            return (
              <tr key={ri} style={{ background: rowBg }}>
                <td style={{ ...tdBase, textAlign: "left", fontWeight: fw, paddingLeft: isTot || isGrand ? 8 : 14, color: isGrand ? "var(--cyan, #06b6d4)" : "var(--text-primary)" }}>
                  {!isTot && !isGrand ? "└ " : ""}{row.name}
                </td>
                {/* counts */}
                {cols.map((c, i) => (
                  <td key={`c${i}`} style={{ ...tdBase, ...(i === 0 ? sep : {}), fontWeight: fw, color: c.sub === "Kỳ này" ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    {fmtN(row.counts[i])}
                  </td>
                ))}
                <td style={{ ...tdBase, fontWeight: 600, color: d?.count == null ? "var(--text-muted)" : d.count > 0 ? "var(--green)" : d.count < 0 ? "var(--red)" : "var(--text-muted)" }}>
                  {d?.count == null ? "—" : (d.count > 0 ? "+" : "") + d.count.toLocaleString("vi-VN")}
                </td>
                {/* rates */}
                {cols.map((c, i) => (
                  <td key={`r${i}`} style={{ ...tdBase, ...(i === 0 ? sep : {}), fontWeight: fw, color: c.sub === "Kỳ này" ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    {fmtP(row.rates[i])}
                  </td>
                ))}
                <td style={{ ...tdBase, fontWeight: 600, color: d?.rate == null ? "var(--text-muted)" : d.rate > 0 ? "var(--green)" : d.rate < 0 ? "var(--red)" : "var(--text-muted)" }}>
                  {d?.rate == null ? "—" : `${d.rate > 0 ? "+" : ""}${d.rate.toFixed(1)} đ`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>* Tuần chưa đủ 14 ngày chốt số — có thể biến động thêm</p>
    </div>
  );
}

// ── Sub: DamageTable ──────────────────────────────────────────────────────────

function DamageTable({ section, loading, insights, setInsights }) {
  if (loading) return <div style={{ fontSize: 12, color: "var(--amber)", padding: "20px 0", textAlign: "center" }}>⏳ Đang tải...</div>;
  if (!section) return <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>Chưa có dữ liệu.</div>;
  const { cols, rows, delta } = section;
  const sep = { borderLeft: "2px solid rgba(15,124,123,0.4)" };
  const denKey = rows.some((r) => Array.isArray(r.ltc)) ? "ltc" : "gtc";
  return (
    <div>
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: "left", minWidth: 160 }} rowSpan={2}>Khách hàng</th>
              <th style={{ ...thBase, textAlign: "center", ...sep }} colSpan={cols.length + 1}># Case bể và đền</th>
              <th style={{ ...thBase, textAlign: "center", ...sep }} colSpan={cols.length + 1}>% Bể đền / LTC</th>
            </tr>
            <tr>
              {[0, 1].map(() => cols.map((c, i) => (
                <th key={`${i}_${c.key}`} style={{ ...thBase, ...(i === 0 ? sep : {}), fontSize: 10.5, fontWeight: c.kind === "span" ? 700 : 500, background: c.kind === "span" && c.sub === "Kỳ này" ? "rgba(15,124,123,1)" : "rgba(15,124,123,0.85)" }}>
                  {colShortLabel(c)}
                </th>
              )).concat(<th key="delta" style={{ ...thBase, fontSize: 10.5 }}>±</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isGrand = row.grand;
              const isTot = row.total && !row.grand;
              const rowBg = isGrand ? "rgba(15,124,123,0.18)" : isTot ? "rgba(15,124,123,0.07)" : undefined;
              const fw = isGrand ? 700 : isTot ? 600 : 400;
              const d = delta ? (() => {
                const [ia, ib] = delta;
                const ca = Number(row.counts[ia]), cb = Number(row.counts[ib]);
                const ra = row.rates[ia], rb = row.rates[ib];
                return { count: cb - ca, rate: ra == null || rb == null ? null : (rb - ra) * 100 };
              })() : null;
              const denRow = row[denKey];
              return (
                <tr key={ri} style={{ background: rowBg }}>
                  <td style={{ ...tdBase, textAlign: "left", fontWeight: fw, paddingLeft: isGrand || isTot ? 8 : 14, color: isGrand ? "var(--cyan, #06b6d4)" : "var(--text-primary)" }}>
                    {!isTot && !isGrand ? "└ " : ""}{row.name}
                  </td>
                  {cols.map((c, i) => (
                    <td key={`c${i}`} style={{ ...tdBase, ...(i === 0 ? sep : {}), fontWeight: fw, color: Number(row.counts[i]) > 0 ? "var(--red)" : "var(--text-muted)" }}>
                      {row.counts[i] > 0 ? fmtN(row.counts[i]) : "—"}
                    </td>
                  ))}
                  <td style={{ ...tdBase, fontWeight: 600, color: d?.count == null ? "var(--text-muted)" : d.count < 0 ? "var(--green)" : d.count > 0 ? "var(--red)" : "var(--text-muted)" }}>
                    {d?.count == null || d.count === 0 ? "—" : (d.count > 0 ? "+" : "") + d.count}
                  </td>
                  {cols.map((c, i) => {
                    const ltcVal = denRow ? denRow[i] : null;
                    return (
                      <td key={`r${i}`} style={{ ...tdBase, ...(i === 0 ? sep : {}), fontWeight: fw, color: row.rates[i] > 0 ? "var(--red)" : "var(--text-muted)" }}>
                        <div>{row.rates[i] > 0 ? fmtP(row.rates[i]) : "—"}</div>
                        {ltcVal != null && <div style={{ fontSize: 9.5, opacity: 0.65 }}>{row.counts[i]}/{fmtN(ltcVal)}</div>}
                      </td>
                    );
                  })}
                  <td style={{ ...tdBase, fontWeight: 600, color: d?.rate == null ? "var(--text-muted)" : d.rate < 0 ? "var(--green)" : d.rate > 0 ? "var(--red)" : "var(--text-muted)" }}>
                    {d?.rate == null || d.rate === 0 ? "—" : `${d.rate > 0 ? "+" : ""}${d.rate.toFixed(2)} đ`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Insight & Giải trình textarea */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>📝 Insight & Giải trình case phát sinh trong kỳ</div>
        <textarea
          value={insights}
          onChange={(e) => setInsights(e.target.value)}
          placeholder={"VD:\n• Smartlink GYR4ND4B — nghi mất hàng, đang xác minh kho HN\n• Komex — móp tủ lạnh HN-BN, Điện đang làm việc với Komex\n• PSD — lên Rillnet trễ, Tân follow up"}
          rows={5}
          style={{ width: "100%", background: "var(--surface-0, rgba(255,255,255,0.04))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "var(--text-primary)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6, boxSizing: "border-box" }}
        />
      </div>
    </div>
  );
}

// ── Sub: PipelineTable ────────────────────────────────────────────────────────

const PIPE_COLS = [
  { key: "name",   label: "Tên dự án",               width: 160 },
  { key: "status", label: "Trạng thái",               width: 120, isSelect: true },
  { key: "time",   label: "Thời gian dự kiến",        width: 100 },
  { key: "model",  label: "Mô hình",                  width: 90 },
  { key: "vol",    label: "Volume dự kiến",           width: 90 },
  { key: "area",   label: "Khu vực Pick up",          width: 110 },
  { key: "desc",   label: "Mô tả cách vận hành",     width: 180 },
  { key: "issues", label: "Khó khăn",                 width: 180 },
];

function PipelineTable({ pipeline, setPipeline }) {
  const update = (id, field, val) => setPipeline((p) => p.map((r) => r.id !== id ? r : { ...r, [field]: val }));
  const remove = (id) => setPipeline((p) => p.filter((r) => r.id !== id));
  const add = () => setPipeline((p) => [...p, { id: `p${Date.now()}`, name: "", status: "Đang đàm phán", time: "", model: "", vol: "", area: "", desc: "", issues: "" }]);
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%" }}>
          <thead>
            <tr>
              {PIPE_COLS.map((c) => <th key={c.key} style={{ ...thBase, textAlign: "left", minWidth: c.width, padding: "6px 8px" }}>{c.label}</th>)}
              <th style={{ ...thBase, width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {pipeline.map((row) => (
              <tr key={row.id}>
                {PIPE_COLS.map((c) => (
                  <td key={c.key} style={{ ...tdBase, textAlign: "left", padding: "4px 6px" }}>
                    {c.isSelect ? (
                      <select value={row[c.key]} onChange={(e) => update(row.id, c.key, e.target.value)} style={{ ...cellInput, color: PIPELINE_STATUS_COLOR[row[c.key]] || "var(--text-primary)", cursor: "pointer" }}>
                        {PIPELINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input value={row[c.key]} onChange={(e) => update(row.id, c.key, e.target.value)} placeholder="—" style={cellInput} />
                    )}
                  </td>
                ))}
                <td style={{ ...tdBase, textAlign: "center" }}>
                  <button onClick={() => remove(row.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--red)", fontSize: 12, padding: 0 }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} style={{ marginTop: 8, width: "100%", fontSize: 11, padding: "5px", borderRadius: 6, border: "1px dashed var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-secondary)" }}>+ Thêm dự án</button>
    </div>
  );
}

// ── Sub: PICTaskBoard ─────────────────────────────────────────────────────────

function PICTaskBoard({ tasks, setTasks }) {
  const add = (pic) => setTasks((p) => [...p, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, pic, client: "", action: "", deadline: "", status: "pending" }]);
  const update = (id, field, val) => setTasks((p) => p.map((t) => t.id !== id ? t : { ...t, [field]: val }));
  const remove = (id) => setTasks((p) => p.filter((t) => t.id !== id));
  return (
    <div>
      {PICS.map((pic) => {
        const mine = tasks.filter((t) => t.pic === pic);
        return (
          <div key={pic} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ background: "var(--amber)", color: "#fff", borderRadius: 4, padding: "1px 10px", fontSize: 11, fontWeight: 700 }}>{pic}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{mine.length} task</span>
              <button onClick={() => add(pic)} style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-secondary)" }}>+ Thêm</button>
            </div>
            {mine.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", padding: "4px 0" }}>Chưa có task</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, textAlign: "left", minWidth: 130 }}>Khách / Sự cố</th>
                    <th style={{ ...thBase, textAlign: "left" }}>Action Plan</th>
                    <th style={{ ...thBase, width: 100 }}>Deadline</th>
                    <th style={{ ...thBase, width: 100 }}>Trạng thái</th>
                    <th style={{ ...thBase, width: 28 }} />
                  </tr>
                </thead>
                <tbody>
                  {mine.map((t) => (
                    <tr key={t.id}>
                      <td style={{ ...tdBase, textAlign: "left", padding: "4px 6px" }}><input value={t.client} onChange={(e) => update(t.id, "client", e.target.value)} placeholder="KH / sự cố" style={cellInput} /></td>
                      <td style={{ ...tdBase, textAlign: "left", padding: "4px 6px" }}><input value={t.action} onChange={(e) => update(t.id, "action", e.target.value)} placeholder="Việc cần làm..." style={cellInput} /></td>
                      <td style={{ ...tdBase, padding: "4px 6px" }}><input type="date" value={t.deadline} onChange={(e) => update(t.id, "deadline", e.target.value)} style={{ ...cellInput, fontSize: 11 }} /></td>
                      <td style={{ ...tdBase, padding: "4px 6px" }}>
                        <select value={t.status} onChange={(e) => update(t.id, "status", e.target.value)} style={{ ...cellInput, color: TASK_COLOR[t.status], cursor: "pointer" }}>
                          {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td style={{ ...tdBase, textAlign: "center" }}><button onClick={() => remove(t.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--red)", fontSize: 12, padding: 0 }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Excel Export ─────────────────────────────────────────────────────────────

// Palette Excel
const XL_HDR  = { fill: { fgColor: { rgb: "0F7C7B" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
const XL_GRAND = { fill: { fgColor: { rgb: "BFEAE9" } }, font: { bold: true, color: { rgb: "0A5756" }, sz: 10 }, alignment: { horizontal: "right" } };
const XL_GRAND_L = { ...XL_GRAND, alignment: { horizontal: "left" } };
const XL_TOTAL = { fill: { fgColor: { rgb: "EDF8F8" } }, font: { bold: true, sz: 10 }, alignment: { horizontal: "right" } };
const XL_TOTAL_L = { ...XL_TOTAL, alignment: { horizontal: "left" } };
const XL_NORM  = { font: { sz: 10 }, alignment: { horizontal: "right" } };
const XL_NORM_L = { ...XL_NORM, alignment: { horizontal: "left" } };

function styleRow(ws, ri, numCols, styleLeft, styleRight) {
  for (let c = 0; c < numCols; c++) {
    const addr = encodeCell(ri, c);
    if (!ws[addr]) ws[addr] = { v: "", t: "s" };
    ws[addr].s = c === 0 ? styleLeft : styleRight;
  }
}
function encodeCell(r, c) {
  const col = c < 26 ? String.fromCharCode(65 + c) : String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
  return `${col}${r + 1}`;
}

async function buildExcel({ report, pipeline, tasks, insights, periLabel, period }) {
  const XLSX = await import("xlsx-js-style");
  const wb = XLSX.utils.book_new();
  const NUM_HDR_ROWS = 2; // double header

  // ── Sheet 1: On-time LTL ─────────────────────────────────────────────────
  if (report?.ontime) {
    const { cols, rows } = report.ontime;
    const colLabels = cols.map(colShortLabel);
    const totalCols = 1 + cols.length + 1 + cols.length + 1; // KH + counts + ± + rates + ±
    const hdr1 = ["Khách hàng", ...colLabels.map(() => "# Đơn LTC"), "", ...colLabels.map(() => "% On-time"), ""];
    const hdr2 = ["", ...colLabels, "±", ...colLabels, "±"];
    const dataRows = [];
    for (const row of rows) {
      const counts = cols.map((_, i) => row.counts[i] ?? "");
      const rates = cols.map((_, i) => row.rates[i] != null ? +(row.rates[i] * 100).toFixed(1) : "");
      const [ia, ib] = report.ontime.delta || [cols.length - 2, cols.length - 1];
      const dCount = (row.counts[ib] ?? 0) - (row.counts[ia] ?? 0);
      const dRate = row.rates[ia] != null && row.rates[ib] != null ? +((row.rates[ib] - row.rates[ia]) * 100).toFixed(1) : "";
      dataRows.push({ values: [row.name, ...counts, dCount, ...rates, dRate], grand: row.grand, total: row.total });
    }
    const ws1 = XLSX.utils.aoa_to_sheet([hdr1, hdr2, ...dataRows.map((r) => r.values)]);
    ws1["!cols"] = [{ wch: 26 }, ...cols.map(() => ({ wch: 10 })), { wch: 6 }, ...cols.map(() => ({ wch: 9 })), { wch: 6 }];
    // Style headers
    styleRow(ws1, 0, totalCols, XL_HDR, XL_HDR);
    styleRow(ws1, 1, totalCols, XL_HDR, XL_HDR);
    // Style data rows
    dataRows.forEach((row, i) => {
      const ri = NUM_HDR_ROWS + i;
      if (row.grand)       styleRow(ws1, ri, totalCols, XL_GRAND_L, XL_GRAND);
      else if (row.total)  styleRow(ws1, ri, totalCols, XL_TOTAL_L, XL_TOTAL);
      else                 styleRow(ws1, ri, totalCols, XL_NORM_L, XL_NORM);
    });
    XLSX.utils.book_append_sheet(wb, ws1, "1. On-time LTL");
  }

  // ── Sheet 2: Bể vỡ & Đền bù ─────────────────────────────────────────────
  if (report?.damage) {
    const { cols, rows } = report.damage;
    const colLabels = cols.map(colShortLabel);
    const totalCols = 1 + cols.length + 1 + cols.length + 1;
    const hdr1 = ["Khách hàng", ...colLabels.map(() => "# Case bể đền"), "", ...colLabels.map(() => "% Bể đền / LTC"), ""];
    const hdr2 = ["", ...colLabels, "±", ...colLabels, "±"];
    const dataRows = [];
    for (const row of rows) {
      const counts = cols.map((_, i) => row.counts[i] ?? "");
      const rates = cols.map((_, i) => row.rates[i] != null ? +(row.rates[i] * 100).toFixed(2) : "");
      const [ia, ib] = report.damage.delta || [cols.length - 2, cols.length - 1];
      const dCount = (row.counts[ib] ?? 0) - (row.counts[ia] ?? 0);
      const dRate = row.rates[ia] != null && row.rates[ib] != null ? +((row.rates[ib] - row.rates[ia]) * 100).toFixed(2) : "";
      dataRows.push({ values: [row.name, ...counts, dCount, ...rates, dRate], grand: row.grand, total: row.total });
    }
    const insightRows = [[], ["Insight & Giải trình case:"], [insights || "(chưa có nội dung)"]];
    const ws2 = XLSX.utils.aoa_to_sheet([hdr1, hdr2, ...dataRows.map((r) => r.values), ...insightRows]);
    ws2["!cols"] = [{ wch: 26 }, ...cols.map(() => ({ wch: 10 })), { wch: 6 }, ...cols.map(() => ({ wch: 10 })), { wch: 6 }];
    styleRow(ws2, 0, totalCols, XL_HDR, XL_HDR);
    styleRow(ws2, 1, totalCols, XL_HDR, XL_HDR);
    dataRows.forEach((row, i) => {
      const ri = NUM_HDR_ROWS + i;
      if (row.grand)       styleRow(ws2, ri, totalCols, XL_GRAND_L, XL_GRAND);
      else if (row.total)  styleRow(ws2, ri, totalCols, XL_TOTAL_L, XL_TOTAL);
      else                 styleRow(ws2, ri, totalCols, XL_NORM_L, XL_NORM);
    });
    XLSX.utils.book_append_sheet(wb, ws2, "2. Bể vỡ & Đền bù");
  }

  // ── Sheet 3: Pipeline ────────────────────────────────────────────────────
  {
    const headers = ["Tên dự án", "Trạng thái", "Thời gian dự kiến", "Mô hình", "Volume dự kiến", "Khu vực Pick up", "Mô tả cách vận hành", "Khó khăn"];
    const data = [headers, ...pipeline.map((p) => [p.name, p.status, p.time, p.model, p.vol, p.area, p.desc, p.issues])];
    const ws3 = XLSX.utils.aoa_to_sheet(data);
    ws3["!cols"] = [22, 18, 16, 14, 14, 16, 28, 28].map((wch) => ({ wch }));
    styleRow(ws3, 0, headers.length, XL_HDR, XL_HDR);
    XLSX.utils.book_append_sheet(wb, ws3, "3. Pipeline");
  }

  // ── Sheet 4: Action Plan PIC ─────────────────────────────────────────────
  {
    const headers = ["PIC", "Khách / Sự cố", "Action Plan", "Deadline", "Trạng thái"];
    const data = [headers, ...tasks.map((t) => [t.pic, t.client, t.action, t.deadline, TASK_LABEL[t.status] || t.status])];
    const ws4 = XLSX.utils.aoa_to_sheet(data);
    ws4["!cols"] = [8, 22, 36, 12, 14].map((wch) => ({ wch }));
    styleRow(ws4, 0, headers.length, XL_HDR, XL_HDR);
    XLSX.utils.book_append_sheet(wb, ws4, "4. Action Plan PIC");
  }

  // ── Download ─────────────────────────────────────────────────────────────
  const safeLabel = (periLabel || period || "export").replace(/[^\w\-]/g, "_");
  XLSX.writeFile(wb, `BaoCaoNoiBo_DTDM_${safeLabel}.xlsx`);
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TabInternalReport() {
  const now = vnNow();
  const { week: thisWeek, year: thisYear } = getISOWeek(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
  const periodOptions = listBiweeklyPeriods(thisWeek, thisYear);
  const [period, setPeriod] = useState(periodOptions[0]?.value ?? defaultBiweeklyPeriod(thisWeek, thisYear));

  // API data
  const [report, setReport] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);

  // Editable per-period data
  const [insights, setInsights] = useState("");
  const [tasks, setTasks] = useState([]);

  // Shared across periods
  const [pipeline, setPipeline] = useState(() => {
    try { const r = localStorage.getItem("teamreport_pipeline"); return r ? JSON.parse(r) : INITIAL_PIPELINE; } catch { return INITIAL_PIPELINE; }
  });

  // UI
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blobLoaded, setBlobLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Load API report when period changes ─────────────────────────────────────
  useEffect(() => {
    setApiLoading(true);
    setReport(null);
    fetch(`/api/report/biweekly?type=biweekly&period=${encodeURIComponent(period)}&format=json&lite=1`)
      .then((r) => r.json())
      .then((d) => { setReport(d.report || null); setApiLoading(false); })
      .catch(() => setApiLoading(false));
  }, [period]);

  // ── Load localStorage when period changes ───────────────────────────────────
  useEffect(() => {
    try {
      const t = localStorage.getItem(`teamreport_tasks_${period}`);
      setTasks(t ? JSON.parse(t) : []);
      const ins = localStorage.getItem(`teamreport_insights_${period}`);
      setInsights(ins || "");
    } catch { setTasks([]); setInsights(""); }
    setBlobLoaded(false);
    // Load from Blob
    fetch(`/api/team-notes?week=${encodeURIComponent(period)}`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (!data) return;
        if (Array.isArray(data.tasks)) setTasks(data.tasks);
        if (typeof data.insights === "string") setInsights(data.insights);
        if (Array.isArray(data.pipeline)) setPipeline(data.pipeline);
        setBlobLoaded(true);
      }).catch(() => {});
  }, [period]);

  // ── Persist localStorage ─────────────────────────────────────────────────────
  useEffect(() => { try { localStorage.setItem(`teamreport_tasks_${period}`, JSON.stringify(tasks)); } catch {} }, [tasks, period]);
  useEffect(() => { try { localStorage.setItem(`teamreport_insights_${period}`, insights); } catch {} }, [insights, period]);
  useEffect(() => { try { localStorage.setItem("teamreport_pipeline", JSON.stringify(pipeline)); } catch {} }, [pipeline]);

  // ── Save to Blob ─────────────────────────────────────────────────────────────
  const saveToBlob = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/team-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: period, tasks, insights, pipeline }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  }, [period, tasks, insights, pipeline]);

  // ── Build Zalo text ──────────────────────────────────────────────────────────
  const copyZalo = useCallback(() => {
    const periOpt = periodOptions.find((o) => o.value === period);
    const periLabel = periOpt?.label ?? period;
    const lines = [];
    lines.push(`📊 GIAO BAN NỘI BỘ ĐTĐM — ${periLabel}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━");

    if (report?.ontime) {
      const { cols, rows, delta } = report.ontime;
      const [ia, ib] = delta || [cols.length - 2, cols.length - 1];
      const prevCol = colShortLabel(cols[ia]);
      const currCol = colShortLabel(cols[ib]);
      lines.push(`📦 ON-TIME LTL (${prevCol} → ${currCol})`);
      for (const row of rows) {
        if (!row.grand && !row.total) continue;
        const cnt = `${(row.counts[ia] || 0).toLocaleString("vi-VN")} → ${(row.counts[ib] || 0).toLocaleString("vi-VN")} đơn`;
        const ot = `${fmtP(row.rates[ia])} → ${fmtP(row.rates[ib])}`;
        const d = row.rates[ia] != null && row.rates[ib] != null ? ((row.rates[ib] - row.rates[ia]) * 100).toFixed(1) : null;
        const dStr = d != null ? ` (${Number(d) >= 0 ? "+" : ""}${d} đ)` : "";
        lines.push(`${row.grand ? "▶" : "  "} ${row.name}: ${cnt} | OT: ${ot}${dStr}`);
      }
    }

    if (report?.damage) {
      const { cols, rows, delta } = report.damage;
      const [ia, ib] = delta || [cols.length - 2, cols.length - 1];
      const hasCase = rows.some((r) => (r.counts[ib] || 0) > 0);
      if (hasCase) {
        lines.push("━━━━━━━━━━━━━━━━━━━━");
        lines.push("💥 BỂ VỠ & ĐỀN BÙ — Kỳ này");
        for (const row of rows) {
          if ((row.counts[ib] || 0) === 0) continue;
          lines.push(`• ${row.name}: ${row.counts[ib]} ca (kỳ trước: ${row.counts[ia]})`);
        }
      }
    }

    if (insights.trim()) {
      lines.push("━━━━━━━━━━━━━━━━━━━━");
      lines.push("📝 GIẢI TRÌNH CASE");
      lines.push(insights.trim());
    }

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("✅ PHÂN CÔNG TUẦN MỚI");
    for (const pic of PICS) {
      const mine = tasks.filter((t) => t.pic === pic && t.status !== "done");
      if (!mine.length) continue;
      lines.push(`👤 ${pic}:`);
      for (const t of mine) {
        const dl = t.deadline ? ` (${t.deadline.slice(5).replace("-", "/")})` : "";
        lines.push(`  • ${[t.client, t.action].filter(Boolean).join(": ")}${dl}`);
      }
    }

    const newProjs = pipeline.filter((p) => ["Đang đàm phán", "Đang onboard"].includes(p.status));
    if (newProjs.length) {
      lines.push("━━━━━━━━━━━━━━━━━━━━");
      lines.push("🆕 DỰ ÁN MỚI");
      for (const p of newProjs) {
        lines.push(`• ${p.name} — ${p.status}${p.time ? " · " + p.time : ""}${p.issues ? " ⚠ " + p.issues : ""}`);
      }
    }

    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    });
  }, [report, insights, tasks, pipeline, period, periodOptions]);

  // Period label for display
  const periOpt = periodOptions.find((o) => o.value === period);
  const periLabel = periOpt?.label ?? period;

  const btnBase = { fontSize: 12, padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 600, border: "none" };

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1300 }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          Báo cáo nội bộ ĐTĐM
        </h2>

        {/* Period selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
          Kỳ báo cáo:
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--amber)", fontWeight: 700, cursor: "pointer" }}>
            {periodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={saveToBlob} disabled={saving} style={{ ...btnBase, background: saving ? "var(--border)" : "var(--amber)", color: saving ? "var(--text-muted)" : "#fff" }}>
            {saving ? "Đang lưu..." : saved ? "✓ Đã lưu" : "💾 Lưu báo cáo"}
          </button>
          <button
            onClick={async () => {
              setExporting(true);
              try { await buildExcel({ report, pipeline, tasks, insights, periLabel, period }); } catch (e) { alert("Lỗi xuất Excel: " + e.message); }
              setExporting(false);
            }}
            disabled={exporting || apiLoading}
            style={{ ...btnBase, background: exporting ? "var(--border)" : "#1d6f42", color: exporting ? "var(--text-muted)" : "#fff" }}
          >
            {exporting ? "Đang xuất..." : "📊 Xuất Excel"}
          </button>
          <button onClick={copyZalo} style={{ ...btnBase, background: copied ? "var(--green)" : "var(--surface-1, var(--bg-panel))", color: copied ? "#fff" : "var(--text-primary)", border: "1px solid var(--border)" }}>
            {copied ? "✓ Đã copy!" : "📋 Copy Báo cáo Zalo"}
          </button>
        </div>
      </div>

      {/* Status badge */}
      {apiLoading && <div style={{ fontSize: 11.5, color: "var(--amber)", marginBottom: 10 }}>⏳ Đang tải dữ liệu từ Báo cáo Công ty ({period})...</div>}
      {!apiLoading && report && <div style={{ fontSize: 11.5, color: "var(--green)", marginBottom: 10 }}>✓ Đã nạp số liệu kỳ {periLabel} từ Báo cáo Công ty · {blobLoaded ? "☁ Cloud sync OK" : "Lưu local"}</div>}

      {/* ── Bảng 1: On-time chi tiết ──────────────────────────────────── */}
      <div style={panel}>
        <SectionHeader title={`Bảng 1 — On-time LTL theo KH`} badge={periLabel} />
        <OntimeTable section={report?.ontime} loading={apiLoading} />
      </div>

      {/* ── Bảng 2: Bể vỡ & Đền bù ───────────────────────────────────── */}
      <div style={panel}>
        <SectionHeader title={`Bảng 2 — Bể vỡ & Đền bù theo KH`} badge={periLabel} />
        <DamageTable section={report?.damage} loading={apiLoading} insights={insights} setInsights={setInsights} />
      </div>

      {/* ── Bảng 3: Pipeline dự án mới ───────────────────────────────── */}
      <div style={panel}>
        <SectionHeader title="Bảng 3 — Dự án mới (Pipeline)" />
        <PipelineTable pipeline={pipeline} setPipeline={setPipeline} />
      </div>

      {/* ── Bảng 4: Action Plan PIC ───────────────────────────────────── */}
      <div style={panel}>
        <SectionHeader title={`Bảng 4 — Action Plan & Phân công PIC`} badge={periLabel} />
        <PICTaskBoard tasks={tasks} setTasks={setTasks} />
      </div>

      <div style={{ fontSize: 10.5, color: "var(--text-muted)", textAlign: "center", marginTop: 8 }}>
        Dữ liệu tự động lưu localStorage · Nhấn "Lưu báo cáo" để sync Cloud · {blobLoaded ? "☁ Cloud" : "Local only"}
      </div>
    </div>
  );
}
