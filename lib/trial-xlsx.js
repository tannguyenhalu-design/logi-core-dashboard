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
  const W = imp.hasControl ? 9 : 5;
  const ws = wb.addWorksheet("Đánh giá", { views: [{ showGridLines: false }] });
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
  // [label, base, post, delta, deltaPct, cBase, cPost, cDelta, net, fmtValue, fmtDelta, good, fmtControlDelta, fmtNet]
  const PCT = "+0.0%;-0.0%;0.0%";
  const PT = '+0.0" điểm";-0.0" điểm";0.0" điểm"';
  const rows = [
    ["Tổng đơn", T.base.orders, T.post.orders, T.delta.orders, pct(T.delta.ordersPct), C.base.orders, C.post.orders, pct(C.delta.ordersPct), null, "#,##0", "+#,##0;-#,##0;0", 0, PCT, PCT],
    ["Tổng tấn", T.base.tons, T.post.tons, T.delta.tons, pct(T.delta.tonsPct), C.base.tons, C.post.tons, pct(C.delta.tonsPct), null, "#,##0.0", "+#,##0.0;-#,##0.0;0.0", 0, PCT, PCT],
    ["% On-time", pct(T.base.ontimePct), pct(T.post.ontimePct), T.delta.ontimePts, null, pct(C.base.ontimePct), pct(C.post.ontimePct), C.delta.ontimePts, imp.net.ontimePts, "0.0%", PT, 1, PT, PT],
    ["Tổng số ca bể vỡ", T.base.cases, T.post.cases, T.delta.cases, pct(T.delta.casesPct), C.base.cases, C.post.cases, C.delta.cases, null, "#,##0", "+#,##0;-#,##0;0", -1, "+#,##0;-#,##0;0", PCT],
    ["Ca bể vỡ / 1.000 đơn", T.base.per1k, T.post.per1k, T.delta.per1k, pct(T.delta.per1kPct), C.base.per1k, C.post.per1k, pct(C.delta.per1kPct), pct(imp.net.per1kPct), "0.00", "+0.00;-0.00;0.00", -1, PCT, PCT],
  ];
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

  // 4. Warnings + method
  if (imp.warnings.length) {
    section(ws, "4. Cảnh báo dữ liệu", W);
    for (const w of imp.warnings) {
      const r = ws.addRow([`⚠ ${w.text}`]);
      r.font = { color: { argb: "FF92400E" } };
      r.alignment = { wrapText: true };
      ws.mergeCells(r.number, 1, r.number, W);
      r.height = 15 * Math.max(1, Math.ceil(w.text.length / 120));
    }
  }
  section(ws, `${imp.warnings.length ? 5 : 4}. Cách tính`, W);
  const R = v.rules;
  for (const s of [
    "Phạm vi = khách hàng áp dụng ∩ kho lấy ∩ kho giao ∩ tỉnh giao đã chọn (để trống = tất cả). Đối chứng = đơn của cùng các khách nhưng ngoài phạm vi, cùng 2 giai đoạn.",
    "Đơn tính theo ngày lấy hàng. Tấn = tổng khối lượng đơn. On-time = đúng hạn / (đúng hạn + trễ), chỉ đơn đã có kết quả.",
    "Ca bể vỡ = ca trong \"Báo cáo bể vỡ\" Rillnet, gắn theo đơn (đơn lấy ở giai đoạn nào thì ca tính vào giai đoạn đó). Ca/1.000 đơn = ca ÷ đơn lấy × 1.000.",
    "Hiệu quả ròng = thay đổi của phạm vi − thay đổi của đối chứng (on-time: điểm; Ca/1.000 đơn: % thay đổi của phạm vi − % thay đổi của đối chứng).",
    `Nhận định: Cải thiện xuất sắc = ca/1.000 đơn giảm ≥ ${-R.damageStrong}% hoặc on-time +≥ ${R.ontimeStrong} điểm, chỉ số còn lại không xấu đi · Có cải thiện = giảm ≥ ${-R.damageGood}% hoặc +≥ ${R.ontimeGood} điểm, không chỉ số nào xấu đi · Không hiệu quả = ca/1.000 đơn tăng ≥ ${R.damageBad}% hoặc on-time −≥ ${-R.ontimeBad} điểm, không có chỉ số bù lại · còn lại = Cần theo dõi thêm. Dùng hiệu quả ròng khi đối chứng có ≥ ${R.minControlOrders} đơn mỗi giai đoạn (bể vỡ: % thay đổi của phạm vi − % thay đổi của đối chứng).`,
    `Chưa đủ dữ liệu → Cần theo dõi thêm: giai đoạn sau < 14 ngày hoặc < 100 đơn. Tổng ca bể vỡ 2 giai đoạn < ${R.minCases} → không xét bể vỡ.`,
  ]) {
    const r = ws.addRow([`• ${s}`]);
    r.font = { size: 10, color: { argb: GREY } };
    r.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(r.number, 1, r.number, W);
    r.height = 14 * Math.max(1, Math.ceil(s.length / 130));
  }

  // Sheet 2: damage cases
  const cs = wb.addWorksheet("Ca bể vỡ");
  cs.columns = [{ width: 12 }, { width: 16 }, { width: 16 }, { width: 28 }, { width: 44 }];
  const cases = [...T.base.caseCodes, ...T.post.caseCodes];
  const ct = cs.addRow([`Ca bể vỡ trong phạm vi — ${trial.name}`]);
  ct.font = { bold: true, size: 12 };
  cs.mergeCells(ct.number, 1, ct.number, 5);
  cs.addRow([`Trước: ${T.base.cases} ca · Sau: ${T.post.cases} ca (gắn theo ngày lấy của đơn)`]).font = { italic: true, color: { argb: GREY } };
  cs.addRow([]);
  header(cs.addRow(["Giai đoạn", "Mã đơn", "Ngày phát hiện", "Chặng nghi lỗi", "Kho phát hiện"]));
  for (const c of cases) {
    const r = cs.addRow([c.period === "base" ? "Trước" : "Sau", c.order_code, c.case_date, c.leg, c.warehouse]);
    r.eachCell((x) => { x.border = ALL; });
  }
  if (!cases.length) cs.addRow(["Không có ca bể vỡ nào trong phạm vi ở 2 giai đoạn."]);

  return wb.xlsx.writeBuffer();
}
