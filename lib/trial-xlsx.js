/**
 * lib/trial-xlsx.js — "Xuất báo cáo đánh giá" of one improvement trial
 * (Sổ tay cải tiến, 28/09). Renders the already-computed impact
 * (computeTrialImpact → same numbers as the screen) into:
 *   1. "Đánh giá"  — solution info, automated verdict with its reasons,
 *                    Before vs After table (+ control group, net effect) as
 *                    real numbers with Excel formats, warnings, method;
 *   2. "Ca bể vỡ"  — the Rillnet cases of the scope, per period.
 * Same look as the company report (teal headers).
 */
import ExcelJS from "exceljs";
import { VERDICT_LABELS, fmt } from "./trials";

const TEAL = "FF0F7C7B";
const WHITE = "FFFFFFFF";
const GREY = "FF6B7280";
const RED = "FFDC2626";
const GREEN = "FF15803D";
const BORDER = { style: "thin", color: { argb: "FFD1D5DB" } };
const ALL = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
const VERDICT_FILL = { excellent: "FFD1FAE5", improved: "FFE0F2FE", watch: "FFFEF3C7", ineffective: "FFFEE2E2" };
const VERDICT_FONT = { excellent: "FF065F46", improved: "FF075985", watch: "FF92400E", ineffective: "FF991B1B" };

const vnTime = (iso) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return "—";
  const v = new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString();
  return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
};
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
// Kế hoạch E: tiền đền cho khách (số CS nhập) + truy thu tham khảo.
export const MONEY_NOTE = "Tiền đền = số CS nhập theo mã đơn, có thể còn cập nhật sau QC. Truy thu = thu lại từ nhân viên GHN làm sai, KHÔNG giảm thiệt hại → chỉ tham khảo, không trừ.";
const VND = "#,##0";
const VND_D = "+#,##0;-#,##0;0";
const coverage = (T) => `${T.base.compWithAmount + T.post.compWithAmount}/${T.base.compensated + T.post.compensated} ca đã chốt đền bù có số tiền`;

function header(row) {
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    c.font = { bold: true, color: { argb: WHITE } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = ALL;
  });
  row.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
}
function section(ws, text, width) {
  ws.addRow([]);
  const r = ws.addRow([text]);
  r.font = { bold: true, size: 12, color: { argb: TEAL } };
  ws.mergeCells(r.number, 1, r.number, width);
}
// good: 1 = higher is better, -1 = lower is better, 0 = neutral
function tone(cell, v, good) {
  if (v == null || !good || Math.abs(v) < 1e-9) return;
  cell.font = { ...(cell.font || {}), color: { argb: v * good > 0 ? GREEN : RED } };
}

export async function buildTrialWorkbook(trial, imp, { exportedBy = "" } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SD3 Dashboard Điện Máy";
  addEvaluationSheets(wb, trial, imp, { exportedBy });
  return wb.xlsx.writeBuffer();
}

// The "Đánh giá" + "Ca bể vỡ" sheets of one trial / phase (reused per phase
// by the solution workbook, KẾ HOẠCH B 28/09).
export function addEvaluationSheets(wb, trial, imp, { exportedBy = "", sheet = "Đánh giá", casesSheet = "Ca bể vỡ", reconcile = null } = {}) {
  const W = imp.hasControl ? 9 : 5;
  const ws = wb.addWorksheet(sheet, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 16 }];

  const t1 = ws.addRow(["BÁO CÁO ĐÁNH GIÁ HIỆU QUẢ GIẢI PHÁP"]);
  t1.font = { bold: true, size: 15 };
  ws.mergeCells(t1.number, 1, t1.number, W);
  const t2 = ws.addRow([trial.name]);
  t2.font = { bold: true, size: 12 };
  t2.alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(t2.number, 1, t2.number, W);
  const t3 = ws.addRow([`SD3 Dashboard Điện Máy · số liệu cập nhật ${vnTime(imp.dataAsOf)} · xuất ${vnTime(new Date().toISOString())}${exportedBy ? ` bởi ${exportedBy}` : ""}`]);
  t3.font = { italic: true, size: 10, color: { argb: GREY } };
  ws.mergeCells(t3.number, 1, t3.number, W);

  // 1. General info
  section(ws, "1. Thông tin giải pháp", W);
  const pr = imp.periods;
  const info = [
    ["Mã giải pháp", trial.id],
    ["Trạng thái", trial.status],
    ["Khách hàng áp dụng", trial.clients.join(", ")],
    ["Kho lấy", trial.khoLay.length ? trial.khoLay.join(", ") : "Tất cả"],
    ["Kho giao", trial.khoGiao.length ? trial.khoGiao.join(", ") : "Tất cả"],
    ["Tỉnh giao", trial.provinces.length ? trial.provinces.join(", ") : "Tất cả"],
    ["Thời gian áp dụng", `${fmt(trial.startDate)} → ${trial.endDate ? fmt(trial.endDate) : "Ongoing (đang chạy)"}`],
    ["Giai đoạn Trước (Baseline)", `${fmt(pr.base.from)} – ${fmt(pr.base.to)} (${imp.baseDays} ngày)`],
    ["Giai đoạn Sau (đã tính)", `${fmt(pr.post.from)} – ${fmt(pr.post.to)} (${imp.postDays} ngày${pr.post.ongoing ? ", tính đến hôm nay" : ""})`],
    ["Mô tả", trial.description || "—"],
    ["Người tạo", `${trial.createdBy || "—"} · ${vnTime(trial.createdAt)}`],
    ["Cập nhật lần cuối", `${trial.updatedBy || "—"} · ${vnTime(trial.updatedAt)}`],
  ];
  for (const [k, v] of info) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.getCell(1).alignment = { vertical: "top" };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(r.number, 2, r.number, W);
    // Rough height for long wrapped text (Excel does not auto-size merged cells).
    const lines = String(v).split("\n").reduce((a, s) => a + Math.max(1, Math.ceil(s.length / 95)), 0);
    if (lines > 1) r.height = 15 * lines;
  }

  // 2. Verdict
  const v = imp.verdict;
  section(ws, "2. Nhận định tự động", W);
  const vr = ws.addRow([`Kết luận: ${VERDICT_LABELS[v.level]}`]);
  ws.mergeCells(vr.number, 1, vr.number, W);
  vr.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDICT_FILL[v.level] } };
  vr.getCell(1).font = { bold: true, size: 13, color: { argb: VERDICT_FONT[v.level] } };
  vr.height = 22;
  const basis = ws.addRow([v.basis === "net" ? "Cơ sở: hiệu quả ròng (đã trừ thay đổi của nhóm đối chứng)" : "Cơ sở: thay đổi của phạm vi giải pháp (không dùng đối chứng)"]);
  basis.font = { italic: true, color: { argb: GREY } };
  ws.mergeCells(basis.number, 1, basis.number, W);
  for (const s of [...v.reasons, ...v.notes.map((x) => `Lưu ý: ${x}`)]) {
    const r = ws.addRow([`• ${s}`]);
    r.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(r.number, 1, r.number, W);
    r.height = 15 * Math.max(1, Math.ceil(s.length / 120));
  }

  // 3. Before vs After
  section(ws, "3. So sánh Trước & Sau", W);
  const head = ["Chỉ số", `Trước\n${dm(pr.base.from)}–${dm(pr.base.to)}`, `Sau\n${dm(pr.post.from)}–${dm(pr.post.to)}`, "Chênh lệch", "% thay đổi"];
  if (imp.hasControl) head.push("Đối chứng Trước", "Đối chứng Sau", "Đối chứng thay đổi", "Hiệu quả ròng");
  const hr = ws.addRow(head);
  header(hr);
  hr.height = 30;
  const T = imp.trial, C = imp.control;
  const pct = (x) => (x == null ? null : x / 100);
  const k = (per1k) => (per1k == null ? null : per1k / 1000); // % bể vỡ as an Excel fraction
  // [label, base, post, delta, deltaPct, cBase, cPost, cDelta, net, fmtValue, fmtDelta, good, fmtControlDelta, fmtNet]
  const PCT = "+0.0%;-0.0%;0.0%";
  const PT = '+0.0" điểm";-0.0" điểm";0.0" điểm"';
  const rows = [
    ["Tổng đơn", T.base.orders, T.post.orders, T.delta.orders, pct(T.delta.ordersPct), C.base.orders, C.post.orders, pct(C.delta.ordersPct), null, "#,##0", "+#,##0;-#,##0;0", 0, PCT, PCT],
    ["Tổng tấn", T.base.tons, T.post.tons, T.delta.tons, pct(T.delta.tonsPct), C.base.tons, C.post.tons, pct(C.delta.tonsPct), null, "#,##0.0", "+#,##0.0;-#,##0.0;0.0", 0, PCT, PCT],
    ["% On-time", pct(T.base.ontimePct), pct(T.post.ontimePct), T.delta.ontimePts, null, pct(C.base.ontimePct), pct(C.post.ontimePct), C.delta.ontimePts, imp.net.ontimePts, "0.0%", PT, 1, PT, PT],
    ["Tổng số ca bể vỡ", T.base.cases, T.post.cases, T.delta.cases, pct(T.delta.casesPct), C.base.cases, C.post.cases, C.delta.cases, null, "#,##0", "+#,##0;-#,##0;0", -1, "+#,##0;-#,##0;0", PCT],
    ["% Bể vỡ", k(T.base.per1k), k(T.post.per1k), T.delta.per1k == null ? null : T.delta.per1k / 10, pct(T.delta.per1kPct), k(C.base.per1k), k(C.post.per1k), pct(C.delta.per1kPct), pct(imp.net.per1kPct), "0.00%", '+0.00" điểm";-0.00" điểm";0.00" điểm"', -1, PCT, PCT],
  ];
  if (T.base.comp != null) rows.push(
    ["Tiền đền cho khách (đ)", T.base.comp, T.post.comp, T.delta.comp, pct(T.delta.compPct), C.base.comp, C.post.comp, pct(C.delta.compPct), null, VND, VND_D, -1, PCT, PCT],
    ["Tiền đền / 1.000 đơn (đ)", T.base.compPer1k, T.post.compPer1k, T.delta.compPer1k, pct(T.delta.compPer1kPct), C.base.compPer1k, C.post.compPer1k, pct(C.delta.compPer1kPct), pct(imp.net.compPer1kPct), VND, VND_D, -1, PCT, PCT],
    ["Truy thu — tham khảo (đ)", T.base.truyThu, T.post.truyThu, T.delta.truyThu, null, C.base.truyThu, C.post.truyThu, C.post.truyThu - C.base.truyThu, null, VND, VND_D, 0, VND_D, PCT],
  );
  for (const [label, b, p, d, dp, cb, cp, cd, net, fv, fd, good, fcd, fnet] of rows) {
    const vals = [label, b, p, d, dp];
    if (imp.hasControl) vals.push(cb, cp, cd, net);
    const r = ws.addRow(vals.map((x) => (x == null ? "—" : x)));
    r.eachCell((c, i) => {
      c.border = ALL;
      if (i > 1) c.alignment = { horizontal: "right" };
      if (typeof c.value !== "number") return;
      if (i === 2 || i === 3 || i === 6 || i === 7) c.numFmt = fv;
      else if (i === 4) c.numFmt = fd;
      else if (i === 5) c.numFmt = "+0.0%;-0.0%;0.0%";
      else if (i === 8) c.numFmt = fcd;
      else if (i === 9) c.numFmt = fnet;
    });
    r.getCell(1).font = { bold: true };
    r.getCell(3).font = { bold: true };
    tone(r.getCell(4), d, good);
    tone(r.getCell(5), dp, good);
    if (imp.hasControl) {
      for (const i of [6, 7, 8]) r.getCell(i).font = { color: { argb: GREY } };
      tone(r.getCell(9), net, good);
      r.getCell(9).font = { ...(r.getCell(9).font || {}), bold: true };
    }
  }
  const sub = ws.addRow([`On-time: Trước ${T.base.late} trễ / ${T.base.evaluated} đơn có kết quả · Sau ${T.post.late} trễ / ${T.post.evaluated}${T.post.open ? ` · ${T.post.open} đơn giai đoạn sau chưa có kết quả giao` : ""}`]);
  sub.font = { size: 10, color: { argb: GREY } };
  ws.mergeCells(sub.number, 1, sub.number, W);
  if (imp.savings) {
    const sv = imp.savings;
    const r1 = ws.addRow([`💰 ${sv.text}`]);
    r1.font = { bold: true, color: { argb: !sv.ok ? GREY : sv.value >= 0 ? GREEN : RED } };
    r1.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(r1.number, 1, r1.number, W);
    r1.height = 15 * Math.max(1, Math.ceil(sv.text.length / 110));
    for (const t of [`${coverage(T)}. ${MONEY_NOTE}`, ...sv.notes.filter((x) => !x.startsWith("Tiền đền = "))]) {
      const r2 = ws.addRow([t]);
      r2.font = { size: 10, italic: true, color: { argb: GREY } };
      r2.alignment = { wrapText: true, vertical: "top" };
      ws.mergeCells(r2.number, 1, r2.number, W);
      r2.height = 14 * Math.max(1, Math.ceil(t.length / 130));
    }
  }

  // 4. (Kế hoạch F1) Đối soát 2 góc nhìn bể vỡ
  let sec = 4;
  if (reconcile) { addReconcileSection(ws, reconcile, `${sec}. Đối soát 2 góc nhìn bể vỡ (cohort / real-time)`, W); sec++; }

  // Warnings + method
  if (imp.warnings.length) {
    section(ws, `${sec++}. Cảnh báo dữ liệu`, W);
    for (const w of imp.warnings) {
      const r = ws.addRow([`⚠ ${w.text}`]);
      r.font = { color: { argb: "FF92400E" } };
      r.alignment = { wrapText: true };
      ws.mergeCells(r.number, 1, r.number, W);
      r.height = 15 * Math.max(1, Math.ceil(w.text.length / 120));
    }
  }
  section(ws, `${sec}. Cách tính`, W);
  const R = v.rules;
  for (const s of [
    "Phạm vi = khách hàng áp dụng ∩ kho lấy ∩ kho giao ∩ tỉnh giao đã chọn (để trống = tất cả). Đối chứng = đơn của cùng các khách nhưng ngoài phạm vi, cùng 2 giai đoạn.",
    "Đơn tính theo ngày lấy hàng. Tấn = tổng khối lượng đơn. On-time = đúng hạn / (đúng hạn + trễ), chỉ đơn đã có kết quả.",
    "Ca bể vỡ = ca trong \"Báo cáo bể vỡ\" Rillnet, gắn theo đơn (đơn lấy ở giai đoạn nào thì ca tính vào giai đoạn đó). % Bể vỡ = ca ÷ đơn lấy × 100 (như báo cáo công ty: ca / đơn LTC).",
    "Hiệu quả ròng = thay đổi của phạm vi − thay đổi của đối chứng (on-time: điểm; % bể vỡ: % thay đổi tương đối của phạm vi − % thay đổi của đối chứng).",
    `Nhận định: Cải thiện xuất sắc = % bể vỡ giảm ≥ ${-R.damageStrong}% hoặc on-time +≥ ${R.ontimeStrong} điểm, chỉ số còn lại không xấu đi · Có cải thiện = giảm ≥ ${-R.damageGood}% hoặc +≥ ${R.ontimeGood} điểm, không chỉ số nào xấu đi · Không hiệu quả = % bể vỡ tăng ≥ ${R.damageBad}% hoặc on-time −≥ ${-R.ontimeBad} điểm, không có chỉ số bù lại · còn lại = Cần theo dõi thêm. Dùng hiệu quả ròng khi đối chứng có ≥ ${R.minControlOrders} đơn mỗi giai đoạn (bể vỡ: % thay đổi của phạm vi − % thay đổi của đối chứng).`,
    `Chưa đủ dữ liệu → Cần theo dõi thêm: giai đoạn sau < 14 ngày hoặc < 100 đơn. Tổng ca bể vỡ 2 giai đoạn < ${R.minCases} → không xét bể vỡ.`,
    "Tiền đền cho khách = số CS nhập theo mã đơn (có thể còn cập nhật sau QC), gắn theo đơn như ca bể. Ước tính tiết kiệm = (tiền / 1.000 đơn trước − sau) × số đơn giai đoạn sau; có đối chứng (≥ 100 đơn mỗi giai đoạn, có tiền ở giai đoạn Trước) thì trừ xu hướng đối chứng: (trước × (1 + % thay đổi của đối chứng) − sau) × đơn sau ÷ 1.000. Luôn là ước tính, KHÔNG ảnh hưởng nhận định. Truy thu không trừ vào thiệt hại.",
  ]) {
    const r = ws.addRow([`• ${s}`]);
    r.font = { size: 10, color: { argb: GREY } };
    r.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(r.number, 1, r.number, W);
    r.height = 14 * Math.max(1, Math.ceil(s.length / 130));
  }

  // Sheet 2: damage cases
  const cs = wb.addWorksheet(casesSheet);
  cs.columns = [{ width: 12 }, { width: 16 }, { width: 16 }, { width: 28 }, { width: 44 }, { width: 16 }, { width: 18 }];
  const cases = [...T.base.caseCodes, ...T.post.caseCodes];
  const ct = cs.addRow([`Ca bể vỡ trong phạm vi — ${trial.name}`]);
  ct.font = { bold: true, size: 12 };
  cs.mergeCells(ct.number, 1, ct.number, 5);
  cs.addRow([`Trước: ${T.base.cases} ca · Sau: ${T.post.cases} ca (gắn theo ngày lấy của đơn)`]).font = { italic: true, color: { argb: GREY } };
  cs.addRow([]);
  header(cs.addRow(["Giai đoạn", "Mã đơn", "Ngày phát hiện", "Chặng nghi lỗi", "Kho phát hiện", "Tiền đền (đ)", "Truy thu — tham khảo (đ)"]));
  for (const c of cases) {
    const r = cs.addRow([c.period === "base" ? "Trước" : "Sau", c.order_code, c.case_date, c.leg, c.warehouse,
      c.comp_amount ? c.comp_amount : c.compensated ? "đã chốt, chưa có số" : "", c.truy_thu_amount ? c.truy_thu_amount : ""]);
    r.eachCell((x) => { x.border = ALL; });
    r.getCell(6).numFmt = VND; r.getCell(7).numFmt = VND;
  }
  if (!cases.length) cs.addRow(["Không có ca bể vỡ nào trong phạm vi ở 2 giai đoạn."]);
}

// ── Kế hoạch F1 ──────────────────────────────────────────────────────────
const PCT_CH = "+0.0%;-0.0%;0.0%";
const wrapRow = (ws, text, W, opts = {}) => {
  const r = ws.addRow([text]);
  r.font = { size: opts.size || 11, italic: !!opts.italic, bold: !!opts.bold, color: { argb: opts.color || "FF000000" } };
  r.alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(r.number, 1, r.number, W);
  r.height = (opts.line || 15) * Math.max(1, Math.ceil(String(text).length / (opts.chars || 120)));
  return r;
};
// Cohort vs real-time block of one phase: real numbers (counts, % bể vỡ as 0.00%, % change) + the matrix + the auto-written notes.
function addReconcileSection(ws, r, titleText, W) {
  section(ws, titleText, W);
  const hd = ws.addRow(["Góc nhìn", "Đơn Trước", "Đơn Sau", "Ca Trước", "Ca Sau", "% bể vỡ Trước", "% bể vỡ Sau", "Thay đổi (%)"]);
  header(hd); hd.height = 30;
  for (const [name, v] of [["Cohort — ca của đơn lấy trong kỳ (nhận định tự động)", r.cohort], ["Real-time — ca ghi nhận trong kỳ (tham khảo)", r.realtime]]) {
    const row = ws.addRow([name, v.base.orders, v.post.orders, v.base.cases, v.post.cases, v.base.pct == null ? "—" : v.base.pct / 100, v.post.pct == null ? "—" : v.post.pct / 100, v.changePct == null ? "—" : v.changePct / 100]);
    row.eachCell((c, i) => { c.border = ALL; if (i > 1) c.alignment = { horizontal: "right" }; });
    row.getCell(1).font = { bold: true }; row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    for (const i of [2, 3, 4, 5]) row.getCell(i).numFmt = "#,##0";
    row.getCell(6).numFmt = "0.00%"; row.getCell(7).numFmt = "0.00%"; row.getCell(8).numFmt = PCT_CH;
    tone(row.getCell(8), v.changePct, -1);
    row.height = 30;
  }
  ws.addRow([]);
  const cols = r.matrix.cols.filter((c, i) => i < 2 || c.total > 0), rows = r.matrix.rows.filter((x, i) => i < 2 || x.total > 0);
  const mh = ws.addRow(["Ca của đơn lấy trong kỳ ↓ · được ghi nhận ở kỳ →", ...cols.map((c) => c.label), "Cohort (tổng hàng)"]);
  header(mh); mh.height = 45;
  for (const x of rows) {
    const row = ws.addRow([x.label, ...cols.map((c) => x.cells[c.key]), x.total]);
    row.eachCell((c, i) => { c.border = ALL; if (i > 1) { c.alignment = { horizontal: "right" }; c.numFmt = "#,##0"; } });
    row.getCell(1).font = { bold: true }; row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    cols.forEach((c, i) => { if (x.cells[c.key] > 0 && x.key !== c.key) row.getCell(i + 2).font = { bold: true, color: { argb: "FF92400E" } }; });
    row.getCell(cols.length + 2).font = { bold: true };
  }
  const tr = ws.addRow(["Real-time (tổng cột)", ...cols.map((c) => c.total), ""]);
  tr.eachCell((c, i) => { c.border = ALL; c.font = { italic: true, color: { argb: GREY } }; if (i > 1) c.alignment = { horizontal: "right" }; });
  for (const t of [...r.notes, ...r.concentration, r.delayText]) wrapRow(ws, `• ${t}`, W);
  if (r.immature) wrapRow(ws, `⚠ ${r.immature.text}`, W, { color: "FF92400E" });
  if (r.warn) wrapRow(ws, r.warn, W, { bold: true, color: RED });
  wrapRow(ws, r.realtimeNote, W, { size: 10, italic: true, color: GREY, line: 14, chars: 130 });
}

// Sheet "Độ phủ & khoảng trống": coverage per phase + whole solution, then the gaps (both client scopes).
function addCoverageSheet(wb, sol, report) {
  const cov = report.coverage;
  if (!cov) return;
  const ws = wb.addWorksheet("Độ phủ & khoảng trống", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 18 }];
  const W = 9;
  const t = ws.addRow(["ĐỘ PHỦ TÁCH TUYẾN VÀ KHOẢNG TRỐNG MỞ RỘNG"]); t.font = { bold: true, size: 15 }; ws.mergeCells(t.number, 1, t.number, W);
  wrapRow(ws, `${sol.name} · số liệu ${vnTime(report.dataAsOf)}`, W, { italic: true, size: 10, color: GREY });
  section(ws, "1. Độ phủ — đơn / tấn thuộc phạm vi giải pháp ÷ điện máy xuất từ kho nguồn cùng kỳ", W);
  const hr = ws.addRow(["Giai đoạn", "Từ ngày", "Đến ngày", "Đơn thuộc phạm vi", "Tấn thuộc phạm vi", "Tổng đơn điện máy từ kho nguồn", "Tổng tấn từ kho nguồn", "Độ phủ — đơn", "Độ phủ — tấn"]);
  header(hr); hr.height = 45;
  const covRows = [...cov.phases.map((x) => [x.label, x]), ...(cov.phases.length > 1 ? [["Cả giải pháp (gộp, không đếm trùng)", cov.solution]] : [])];
  for (const [name, x] of covRows) {
    const r = ws.addRow([name, x.from ? fmt(x.from) : "—", x.to ? fmt(x.to) : "—", x.orders, x.tons, x.allOrders, x.allTons, x.pctOrders == null ? "—" : x.pctOrders / 100, x.pctTons == null ? "—" : x.pctTons / 100]);
    r.eachCell((c, i) => { c.border = ALL; if (i > 1) c.alignment = { horizontal: "right" }; });
    r.getCell(1).font = { bold: true };
    r.getCell(4).numFmt = "#,##0"; r.getCell(5).numFmt = "#,##0.0"; r.getCell(6).numFmt = "#,##0"; r.getCell(7).numFmt = "#,##0.0"; r.getCell(8).numFmt = "0.0%"; r.getCell(9).numFmt = "0.0%";
  }
  ws.addRow([]);
  const h2 = ws.addRow(["Trong các khách áp dụng", "", "", "Đơn của khách (cùng kho nguồn)", "Tấn của khách", "", "", "Phạm vi ÷ khách — đơn", "Phạm vi ÷ khách — tấn"]);
  header(h2); h2.height = 45;
  for (const [name, x] of covRows) {
    const r = ws.addRow([name, "", "", x.clientOrders, x.clientTons, "", "", x.pctClientOrders == null ? "—" : x.pctClientOrders / 100, x.pctClientTons == null ? "—" : x.pctClientTons / 100]);
    r.eachCell((c, i) => { c.border = ALL; if (i > 1) c.alignment = { horizontal: "right" }; });
    r.getCell(1).font = { bold: true };
    r.getCell(4).numFmt = "#,##0"; r.getCell(5).numFmt = "#,##0.0"; r.getCell(8).numFmt = "0.0%"; r.getCell(9).numFmt = "0.0%";
  }
  wrapRow(ws, `Kho nguồn: ${cov.solution.sourceText || "—"}. Từng giai đoạn tính từ ngày bắt đầu của nó; cả giải pháp gộp phạm vi mọi giai đoạn từ ngày bắt đầu giai đoạn đầu (một đơn chỉ đếm 1 lần).`, W, { size: 10, italic: true, color: GREY, line: 14, chars: 130 });
  wrapRow(ws, `⚠ ${cov.note}`, W, { bold: true, color: "FF92400E", chars: 120 });

  const g = report.gaps;
  if (g) {
    section(ws, "2. Khoảng trống — sản lượng từ kho nguồn chưa thuộc giải pháp nào trong Sổ tay", W);
    wrapRow(ws, `Kho nguồn: ${g.source} · kỳ xét ${fmt(g.from)} → ${fmt(g.to)} (${g.days} ngày = ${g.weeks.toFixed(1).replace(".", ",")} tuần). ${g.ruleText}`, W, { chars: 120 });
    for (const [key, label] of [["applied", "Khách áp dụng"], ["all", "Mọi khách"]]) {
      const sc = g[key];
      ws.addRow([]);
      const sh = ws.addRow([`${label} — ${g.summary[key === "applied" ? 0 : 1]}`]); sh.font = { bold: true, color: { argb: TEAL } }; ws.mergeCells(sh.number, 1, sh.number, W); sh.alignment = { wrapText: true, vertical: "top" }; sh.height = 32;
      for (const [dim, dl, flag] of [["byProvince", "Theo tỉnh giao", true], ["byWarehouse", "Theo kho giao", true], ["byClient", "Theo khách", false]]) {
        const d = sc[dim];
        const dh = ws.addRow([`${dl} — ${d.total} mục${flag ? `, ${d.enoughCount} ứng viên đủ volume` : ""}${d.total > d.list.length ? ` (hiện ${d.list.length} đầu)` : ""}`]); dh.font = { bold: true }; ws.mergeCells(dh.number, 1, dh.number, W);
        const hh = ws.addRow(["Tên", "Đơn", "Tấn", "Đơn / tuần", "Tấn / tuần", "Ca bể 01/07→nay", "Đơn 01/07→nay (cùng luồng)", "% bể vỡ trước đây", "Ứng viên đủ volume"]);
        header(hh); hh.height = 45;
        for (const x of d.list) {
          const r = ws.addRow([x.name, x.orders, x.tons, x.perWeekOrders, x.perWeekTons, x.pastCases, x.pastOrders, x.pastPct == null ? "—" : x.pastPct / 100, flag && x.enough ? "★ đủ volume" : ""]);
          r.eachCell((c, i) => { c.border = ALL; if (i > 1) c.alignment = { horizontal: "right" }; });
          r.getCell(1).alignment = { wrapText: true, vertical: "top" };
          r.getCell(2).numFmt = "#,##0"; r.getCell(3).numFmt = "#,##0.0"; r.getCell(4).numFmt = "#,##0.0"; r.getCell(5).numFmt = "#,##0.00"; r.getCell(6).numFmt = "#,##0"; r.getCell(7).numFmt = "#,##0"; r.getCell(8).numFmt = "0.00%";
          if (flag && x.enough) { r.getCell(9).font = { bold: true, color: { argb: GREEN } }; r.getCell(1).font = { bold: true }; }
        }
      }
    }
    ws.addRow([]);
    wrapRow(ws, `Đã đối chiếu với ${g.checkedSolutions.length} giải pháp: ${g.checkedSolutions.map((x) => `${x.id} (${x.name})`).join("; ")}. ${g.note}`, W, { size: 10, italic: true, color: GREY, line: 14, chars: 130 });
    wrapRow(ws, "⚠ Dữ liệu không có cờ đơn đã thật sự đi qua tuyến tách; khoảng trống chỉ là phần sản lượng chưa nằm trong phạm vi giải pháp nào.", W, { bold: true, color: "FF92400E" });
  }
  addSourcesRows(ws, report, W);
}

// "Nguồn dữ liệu" at the bottom of a sheet (Kế hoạch F1).
function addSourcesRows(ws, report, W) {
  if (!report.sources) return;
  ws.addRow([]);
  const h = ws.addRow(["Nguồn dữ liệu"]); h.font = { bold: true, color: { argb: TEAL } }; ws.mergeCells(h.number, 1, h.number, W);
  for (const x of report.sources.list) wrapRow(ws, `• ${x.label}${x.atText ? ` (${x.atText})` : ""}: ${x.detail}${x.stale ? " ⚠" : ""}`, W, { size: 10, color: x.stale ? "FF92400E" : GREY, line: 14, chars: 130 });
}

// Solution workbook (KẾ HOẠCH B): phase comparison + "Theo dõi sau thành công"
// + one evaluation sheet and one case sheet per phase. Same numbers as the screen.
export async function buildSolutionWorkbook(sol, report, { exportedBy = "" } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SD3 Dashboard Điện Máy";
  const ws = wb.addWorksheet("So sánh giai đoạn", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 18 }, { width: 14 }, { width: 24 }, { width: 44 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 18 }];
  const W = 17;
  const t = ws.addRow([`BÁO CÁO GIẢI PHÁP: ${sol.name}`]); t.font = { bold: true, size: 15 }; ws.mergeCells(t.number, 1, t.number, W);
  const s = ws.addRow([`Khách: ${sol.clients.join(", ")} · Trạng thái: ${sol.status} · Baseline chung ${fmt(sol.baseStart)} – ${fmt(sol.baseEnd)} · số liệu ${vnTime(report.dataAsOf)} · xuất ${vnTime(new Date().toISOString())}${exportedBy ? ` bởi ${exportedBy}` : ""}`]);
  s.font = { italic: true, size: 10, color: { argb: GREY } }; ws.mergeCells(s.number, 1, s.number, W);
  if (sol.description) { const d = ws.addRow([sol.description]); d.alignment = { wrapText: true, vertical: "top" }; ws.mergeCells(d.number, 1, d.number, W); d.height = 15 * Math.max(1, String(sol.description).split("\n").length); }
  ws.addRow([]);
  header(ws.addRow(["Giai đoạn", "Trạng thái", "Thời gian (giai đoạn sau)", "Phạm vi", "Đơn", "Tấn", "% On-time", "Ca bể", "% Bể vỡ", "On-time so baseline", "Bể vỡ so baseline (%)", "Nhận định", "On-time so GĐ trước", "Bể vỡ so GĐ trước (%)", "Tiền đền / 1.000 đơn — baseline (đ)", "Tiền đền / 1.000 đơn — sau (đ)", "Ước tính tiết kiệm (đ)"]));
  const PT = '+0.0" điểm";-0.0" điểm";0.0" điểm"', PC = "+0.0%;-0.0%;0.0%";
  for (const c of report.comparison) {
    const scope = [c.scope.khoLay.length ? `Lấy: ${c.scope.khoLay.join(", ")}` : "", c.scope.khoGiao.length ? `Giao: ${c.scope.khoGiao.length} kho` : "", c.scope.provinces.length ? `Tỉnh: ${c.scope.provinces.join(", ")}` : ""].filter(Boolean).join(" · ") || "Toàn bộ đơn của khách";
    const net = (v) => (v == null ? "—" : v);
    const r = ws.addRow([c.label, c.status, `${fmt(c.postFrom)} – ${fmt(c.postTo)} (${c.postDays} ngày)`, scope, c.post.orders, c.post.tons, c.post.ontimePct == null ? "—" : c.post.ontimePct / 100, c.post.cases,
      c.post.per1k == null ? "—" : c.post.per1k / 1000, net(c.delta.ontimePts), c.delta.per1kPct == null ? "—" : c.delta.per1kPct / 100, c.verdict,
      c.vsPrev && c.vsPrev.ontimePts != null ? c.vsPrev.ontimePts : "—", c.vsPrev && c.vsPrev.per1kPct != null ? c.vsPrev.per1kPct / 100 : "—",
      c.base.compPer1k == null ? "—" : c.base.compPer1k, c.post.compPer1k == null ? "—" : c.post.compPer1k, c.savings && c.savings.ok ? Math.round(c.savings.value) : "chưa có số"]);
    r.eachCell((x, i) => { x.border = ALL; x.alignment = { vertical: "top", wrapText: i === 4 }; });
    r.getCell(5).numFmt = "#,##0"; r.getCell(6).numFmt = "#,##0.0"; r.getCell(7).numFmt = "0.0%"; r.getCell(9).numFmt = "0.00%";
    r.getCell(10).numFmt = PT; r.getCell(11).numFmt = PC; r.getCell(13).numFmt = PT; r.getCell(14).numFmt = PC;
    r.getCell(15).numFmt = VND; r.getCell(16).numFmt = VND; r.getCell(17).numFmt = VND_D;
    if (c.savings && c.savings.ok) tone(r.getCell(17), c.savings.value, 1);
    tone(r.getCell(10), c.delta.ontimePts, 1); tone(r.getCell(11), c.delta.per1kPct, -1);
    r.getCell(1).font = { bold: true };
  }
  const note = ws.addRow(["Mỗi giai đoạn so với CÙNG baseline chung trên phạm vi của chính giai đoạn đó. Các giai đoạn có thể chạy song song. \"So GĐ trước\" = số giai đoạn sau của giai đoạn này trừ của giai đoạn liền trước (phạm vi có thể khác nhau)."]);
  note.font = { italic: true, size: 10, color: { argb: GREY } }; ws.mergeCells(note.number, 1, note.number, W); note.alignment = { wrapText: true }; note.height = 30;
  const mn = ws.addRow([`Tiền: ước tính tiết kiệm = (tiền đền / 1.000 đơn trước − sau) × đơn giai đoạn sau, trừ xu hướng nhóm đối chứng — luôn là ƯỚC TÍNH, không ảnh hưởng nhận định. ${MONEY_NOTE}`]);
  mn.font = { italic: true, size: 10, color: { argb: GREY } }; ws.mergeCells(mn.number, 1, mn.number, W); mn.alignment = { wrapText: true }; mn.height = 30;
  for (const c of report.comparison) if (c.savings) { const r = ws.addRow([`${c.label}: ${c.savings.text} (${coverage(c)})`]); r.font = { size: 10 }; ws.mergeCells(r.number, 1, r.number, W); r.alignment = { wrapText: true }; }
  if (report.alerts.length) {
    ws.addRow([]);
    for (const a of report.alerts) { const r = ws.addRow([`⚠ ${a.text}`]); r.font = { color: { argb: RED }, bold: true }; ws.mergeCells(r.number, 1, r.number, W); }
  }
  addSourcesRows(ws, report, W);

  // Theo dõi sau thành công
  const monitored = report.phases.filter((x) => x.monitor);
  if (monitored.length) {
    const ms = wb.addWorksheet("Theo dõi", { views: [{ showGridLines: false }] });
    ms.columns = [{ width: 16 }, { width: 24 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 9 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 34 }, { width: 15 }, { width: 17 }];
    const tt = ms.addRow(["THEO DÕI SAU THÀNH CÔNG — so với kỳ liền trước"]); tt.font = { bold: true, size: 14 }; ms.mergeCells(tt.number, 1, tt.number, 12);
    const tn = ms.addRow(["Tháng = các tuần có thứ 2 thuộc tháng (như báo cáo công ty); tuần = ISO. Kỳ đang chạy so cùng số ngày của kỳ trước. Cảnh báo khi % bể vỡ tăng ≥ 10% (tương đối) hoặc on-time giảm ≥ 1 điểm (< 5 ca ở 2 kỳ → bỏ trục bể vỡ; tuần < 100 đơn không cảnh báo). Tiền đền chỉ là thông tin thêm (số CS nhập, có thể còn cập nhật sau QC), không vào cảnh báo."]);
    tn.font = { italic: true, size: 10, color: { argb: GREY } }; ms.mergeCells(tn.number, 1, tn.number, 10); tn.alignment = { wrapText: true }; tn.height = 30;
    for (const x of monitored) {
      for (const kind of ["month", "week"]) {
        const m = x.monitor[kind];
        ms.addRow([]);
        const h = ms.addRow([`${x.phase.label} — theo ${kind === "month" ? "THÁNG" : "TUẦN"}`]); h.font = { bold: true, size: 12, color: { argb: TEAL } }; ms.mergeCells(h.number, 1, h.number, 10);
        header(ms.addRow(["Kỳ", "Ngày", "Đơn", "Tấn", "% On-time", "Ca bể", "% Bể vỡ", "On-time so kỳ trước", "Bể vỡ so kỳ trước (%)", "Cảnh báo", "Tiền đền (đ)", "Tiền đền / 1.000 đơn (đ)"]));
        const b = m.baseline;
        const br = ms.addRow(["Baseline", `${fmt(report.baseline.from)} – ${fmt(report.baseline.to)}`, b.orders, b.tons, b.ontimePct == null ? "—" : b.ontimePct / 100, b.cases, b.per1k == null ? "—" : b.per1k / 1000, "", "", "", b.comp ?? "—", b.compPer1k ?? "—"]);
        br.getCell(11).numFmt = VND; br.getCell(12).numFmt = VND;
        br.font = { italic: true, color: { argb: GREY } };
        br.getCell(3).numFmt = "#,##0"; br.getCell(4).numFmt = "#,##0.0"; br.getCell(5).numFmt = "0.0%"; br.getCell(7).numFmt = "0.00%";
        for (const row of m.rows) {
          const st = row.stats;
          const r = ms.addRow([`${row.label}${row.running ? "*" : ""}`, `${fmt(row.from)} – ${fmt(row.to)}${row.sameDays ? " (so cùng số ngày)" : ""}`, st.orders, st.tons, st.ontimePct == null ? "—" : st.ontimePct / 100, st.cases, st.per1k == null ? "—" : st.per1k / 1000,
            row.vs && row.vs.ontimePts != null ? row.vs.ontimePts : "—", row.vs && row.vs.per1kPct != null && row.vs.damageOk ? row.vs.per1kPct / 100 : "—", row.alerts.length ? `⚠ ${row.alerts.join(", ")}` : "",
            st.comp ?? "—", st.compPer1k ?? "—"]);
          r.getCell(11).numFmt = VND; r.getCell(12).numFmt = VND;
          r.getCell(3).numFmt = "#,##0"; r.getCell(4).numFmt = "#,##0.0"; r.getCell(5).numFmt = "0.0%"; r.getCell(7).numFmt = "0.00%"; r.getCell(8).numFmt = PT; r.getCell(9).numFmt = PC;
          tone(r.getCell(8), row.vs && row.vs.ontimePts, 1); tone(r.getCell(9), row.vs && row.vs.damageOk ? row.vs.per1kPct : null, -1);
          if (row.alerts.length) r.getCell(10).font = { bold: true, color: { argb: RED } };
          [br, r].forEach((q) => q.eachCell((c2) => { c2.border = ALL; }));
        }
      }
    }
  }

  addCoverageSheet(wb, sol, report);

  // One evaluation + case sheet per phase (sheet names ≤ 31 chars, unique)
  const used = new Set();
  const nameFor = (base) => { let n = base.replace(/[\\/*?:[\]]/g, " ").slice(0, 28); let k = n, i = 2; while (used.has(k)) k = `${n.slice(0, 25)} ${i++}`; used.add(k); return k; };
  for (const x of report.phases) {
    addEvaluationSheets(wb, { ...x.phase, name: `${sol.name} — ${x.phase.label}`, clients: sol.clients, baseStart: sol.baseStart, baseEnd: sol.baseEnd }, x.impact,
      { exportedBy, sheet: nameFor(`${x.phase.label} - Đánh giá`), casesSheet: nameFor(`${x.phase.label} - Ca bể`), reconcile: x.reconcile || null });
  }
  return wb.xlsx.writeBuffer();
}
