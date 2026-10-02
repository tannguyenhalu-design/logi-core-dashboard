/**
 * lib/trial-docx.js — "Xuất Word" of a Sổ tay solution (KẾ HOẠCH B, 28/09;
 * user chose a .docx with photos over an automatic Google Doc — it opens in
 * Google Docs too). Built from the SAME report object as the screen:
 * overview, conclusion per phase, phase comparison, per-phase detail with the
 * automated verdict, before/after table, photos + captions, and the
 * "Theo dõi sau thành công" tables.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, ShadingType, BorderStyle,
} from "docx";
import { fmt } from "./trials";

const TEAL = "0F7C7B", GREY = "6B7280", GREEN = "15803D", RED = "B91C1C";
const VERDICT_COLOR = { excellent: "065F46", improved: "075985", watch: "92400E", ineffective: "991B1B" };
const n0 = (x) => (x == null ? "—" : Math.round(x).toLocaleString("vi-VN"));
const n1 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const n2 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sgn = (x, f) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${f(Math.abs(x))}`);
const pctTxt = (x) => (x == null ? "—" : `${n1(x)}%`);
const vnTime = (iso) => { if (!iso) return "—"; const v = new Date(Date.parse(iso) + 7 * 3600e3).toISOString(); return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`; };

const P = (text, opt = {}) => new Paragraph({ spacing: { after: 80 }, ...opt.para, children: [new TextRun({ text: String(text), size: opt.size || 21, bold: opt.bold, italics: opt.italics, color: opt.color })] });
const H = (text, level = HeadingLevel.HEADING_2) => new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, color: TEAL, bold: true })] });
const shortWh = (x) => String(x || "").replace(/^Kho Giao Hàng Nặng - /, "").replace(/^Key Account Warehouse /, "KA WH ").trim();
const bv = (per1k) => (per1k == null ? "—" : `${n2(per1k / 10)}%`);
// Kế hoạch E: tiền đền cho khách (triệu đồng) + truy thu tham khảo.
const tr = (x) => (x == null ? "—" : !x ? "0" : `${n1(x / 1e6)} tr`);
const trd = (x) => (x == null ? "—" : `${sgn(x / 1e6, n1)} tr`);
const MONEY_NOTE = "Tiền đền = số CS nhập theo mã đơn, có thể còn cập nhật sau QC. Truy thu = thu lại từ nhân viên GHN làm sai, không giảm thiệt hại → chỉ tham khảo, không trừ.";
const coverage = (T) => `${T.base.compWithAmount + T.post.compWithAmount}/${T.base.compensated + T.post.compensated} ca đã chốt đền bù có số tiền`;
const saveTxt = (sv) => (sv && sv.ok ? `${sv.value >= 0 ? "~" : "+"}${tr(Math.abs(sv.value))}` : "chưa có số");
const border = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" };
function table(head, rows, { widths, left = [0] } = {}) {
  const txt = (t) => (t && typeof t === "object" ? t.text : t);
  const cell = (t, h, i) => new TableCell({
    width: widths ? { size: widths[i], type: WidthType.PERCENTAGE } : undefined,
    shading: h ? { type: ShadingType.CLEAR, fill: TEAL, color: "auto" } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph({ alignment: left.includes(i) ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: String(txt(t) ?? ""), size: 18, bold: h || !!(t && typeof t === "object" && t.bold), color: h ? "FFFFFF" : (t && typeof t === "object" && t.color) || undefined })] })],
  });
  const mk = (arr, h) => new TableRow({ tableHeader: h, children: arr.map((t, i) => cell(t, h, i)) });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [mk(head, true), ...rows.map((r) => mk(r, false))] });
}

// Pixel size of a JPEG / PNG buffer (no native image library on the server).
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: "jpg" };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { w: 800, h: 600, type: "jpg" };
}

// ── Kế hoạch F1: đối soát 2 góc nhìn, độ phủ, khoảng trống, nguồn dữ liệu ──
const pc2 = (x) => (x == null ? "—" : `${n2(x)}%`);
const pc1 = (x) => (x == null ? "—" : `${n1(x)}%`);
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const chg = (v) => (v.changePct == null ? "—" : `${sgn(v.changePct, n1)}%`);
const dirColor = (d) => (d === "down" ? GREEN : d === "up" ? RED : undefined);

// Per phase: cohort vs real-time table + the "ca của đơn lấy trong kỳ X được ghi nhận ở kỳ Y" matrix + auto-written notes.
function reconcileBlock(r) {
  const out = [];
  out.push(P("Đối soát 2 góc nhìn bể vỡ (nhận định tự động giữ nguyên theo cohort)", { bold: true, color: TEAL, para: { spacing: { before: 160, after: 60 } } }));
  const vr = (name, v) => [name, `${pc2(v.base.pct)} (${n0(v.base.cases)} ca / ${n0(v.base.orders)} đơn)`, `${pc2(v.post.pct)} (${n0(v.post.cases)} ca / ${n0(v.post.orders)} đơn)`, { text: chg(v), bold: true, color: dirColor(v.dir) }];
  out.push(table(["Góc nhìn", `Trước (Baseline ${ddmm(r.periods.base.from)}–${ddmm(r.periods.base.to)})`, `Sau (${ddmm(r.periods.post.from)}–${ddmm(r.periods.post.to)})`, "Thay đổi"],
    [vr("Cohort — ca của đơn lấy trong kỳ", r.cohort), vr("Real-time — ca ghi nhận trong kỳ ÷ đơn lấy trong kỳ (tham khảo)", r.realtime)], { widths: [34, 26, 26, 14], left: [0] }));
  const cols = r.matrix.cols.filter((c, i) => i < 2 || c.total > 0), rows = r.matrix.rows.filter((x, i) => i < 2 || x.total > 0);
  out.push(P("Ca của đơn lấy trong kỳ X được ghi nhận ở kỳ Y", { bold: true, size: 20, para: { spacing: { before: 100, after: 40 } } }));
  const head = ["Đơn lấy ↓ · Ghi nhận →", ...cols.map((c) => c.label), "Cohort (tổng hàng)"];
  const w = Math.floor(60 / (cols.length + 1));
  out.push(table(head, [
    ...rows.map((x) => [x.label, ...cols.map((c) => ({ text: String(x.cells[c.key]), bold: x.cells[c.key] > 0 && x.key !== c.key, color: x.cells[c.key] > 0 && x.key !== c.key ? "92400E" : undefined })), { text: String(x.total), bold: true }]),
    [{ text: "Real-time (tổng cột)", color: GREY }, ...cols.map((c) => ({ text: String(c.total), color: GREY })), ""],
  ], { widths: [40, ...cols.map(() => w), 100 - 40 - w * cols.length], left: [0] }));
  [...r.notes, ...r.concentration, r.delayText].forEach((t) => out.push(P(`• ${t}`, { size: 19 })));
  if (r.immature) out.push(P(`⚠ ${r.immature.text}`, { size: 19, color: "92400E" }));
  if (r.warn) out.push(P(r.warn, { size: 20, bold: true, color: RED }));
  out.push(P(r.realtimeNote, { size: 16, italics: true, color: GREY }));
  return out;
}

// Whole-solution coverage + gaps.
function coverageBlock(report) {
  const out = [];
  const cov = report.coverage, g = report.gaps;
  if (!cov) return out;
  const S = cov.solution;
  const row = (name, x) => [name, x.active === false ? "chưa áp dụng" : `${ddmm(x.from)}–${ddmm(x.to)}`, `${n0(x.orders)} đơn · ${n1(x.tons)} t`, `${n0(x.allOrders)} đơn · ${n1(x.allTons)} t`, { text: `${pc1(x.pctOrders)} đơn · ${pc1(x.pctTons)} tấn`, bold: true }, `${pc1(x.pctClientOrders)} đơn · ${pc1(x.pctClientTons)} tấn`];
  out.push(table(["Giai đoạn", "Kỳ tính", "Thuộc phạm vi", "Điện máy từ kho nguồn (mọi khách)", "Độ phủ (% tổng điện máy)", "Trong khách áp dụng"],
    [...cov.phases.map((x) => row(x.label, x)), ...(cov.phases.length > 1 ? [row("Cả giải pháp (gộp, không đếm trùng)", { ...S, active: S.phases > 0 })] : [])], { widths: [17, 11, 17, 21, 19, 15], left: [0, 1] }));
  out.push(P(`Kho nguồn: ${S.sourceText || "—"}. Từng giai đoạn tính từ ngày bắt đầu của nó; cả giải pháp gộp phạm vi mọi giai đoạn từ ngày bắt đầu giai đoạn đầu (một đơn chỉ đếm 1 lần).`, { size: 17, italics: true, color: GREY }));
  out.push(P(`⚠ ${cov.note}`, { size: 18, color: "92400E", bold: true }));
  if (g) {
    out.push(P("Khoảng trống mở rộng — sản lượng từ kho nguồn chưa thuộc giải pháp nào trong Sổ tay", { bold: true, color: TEAL, para: { spacing: { before: 200, after: 60 } } }));
    out.push(P(`Kho nguồn: ${g.source} · kỳ xét ${ddmm(g.from)}→${ddmm(g.to)} (${g.days} ngày). ${g.ruleText}`, { size: 19 }));
    const gt = (label, dim, flag) => {
      out.push(P(`${label} — ${dim.total} mục${flag ? `, ${dim.enoughCount} ứng viên đủ volume` : ""}${dim.total > 8 ? " (hiện 8 đầu)" : ""}`, { bold: true, size: 19, para: { spacing: { before: 100, after: 30 } } }));
      out.push(table(["Tên", "Đơn", "Tấn", "Đơn/tuần", "Tấn/tuần", "Ca bể 01/07→nay", ...(flag ? ["Ứng viên"] : [])],
        dim.list.slice(0, 8).map((x) => [{ text: x.name, bold: x.enough }, n0(x.orders), n1(x.tons), n1(x.perWeekOrders), n2(x.perWeekTons), `${n0(x.pastCases)} (${pc2(x.pastPct)})`, ...(flag ? [{ text: x.enough ? "★ đủ volume" : "", bold: true, color: GREEN }] : [])]),
        { widths: flag ? [32, 9, 9, 10, 10, 14, 16] : [42, 10, 10, 11, 11, 16], left: [0] }));
    };
    out.push(P(g.summary[0], { bold: true, size: 20, para: { spacing: { before: 120, after: 40 } } }));
    gt("Theo tỉnh giao (khách áp dụng)", g.applied.byProvince, true);
    gt("Theo kho giao (khách áp dụng)", g.applied.byWarehouse, true);
    out.push(P(g.summary[1], { bold: true, size: 20, para: { spacing: { before: 160, after: 40 } } }));
    gt("Theo tỉnh giao (mọi khách)", g.all.byProvince, true);
    gt("Theo khách (mọi khách)", g.all.byClient, false);
    out.push(P(`Đã đối chiếu với ${g.checkedSolutions.length} giải pháp: ${g.checkedSolutions.map((x) => x.id).join(", ")}. ${g.note}`, { size: 17, italics: true, color: GREY }));
    out.push(P("⚠ Dữ liệu không có cờ đơn đã thật sự đi qua tuyến tách; khoảng trống chỉ là phần sản lượng chưa nằm trong phạm vi giải pháp nào.", { size: 18, color: "92400E", bold: true }));
  }
  return out;
}

/**
 * @param sol     solution with phases
 * @param report  computeSolutionReport()
 * @param images  Map phaseId → [{ buf, caption }]
 */
export async function buildSolutionDocx(sol, report, images = new Map(), { exportedBy = "" } = {}) {
  const kids = [];
  kids.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "BÁO CÁO ĐÁNH GIÁ GIẢI PHÁP", bold: true, size: 20, color: TEAL })] }));
  kids.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 80 }, children: [new TextRun({ text: sol.name, bold: true, size: 34 })] }));
  kids.push(P(`SD3 Dashboard Điện Máy · số liệu cập nhật ${vnTime(report.dataAsOf)} · xuất ${vnTime(new Date().toISOString())}${exportedBy ? ` bởi ${exportedBy}` : ""}`, { italics: true, color: GREY, size: 18 }));

  kids.push(H("1. Thông tin chung"));
  kids.push(table(["Mục", "Nội dung"], [
    ["Khách hàng", sol.clients.join(", ")],
    ["Trạng thái giải pháp", sol.status],
    ["Baseline chung", `${fmt(sol.baseStart)} – ${fmt(sol.baseEnd)} (trước giai đoạn đầu tiên)`],
    ["Số giai đoạn", `${sol.phases.length}: ${sol.phases.map((p) => `${p.label} (${p.status})`).join(" · ")}`],
  ], { widths: [28, 72], left: [0, 1] }));
  if (sol.description) sol.description.split("\n").forEach((l) => kids.push(P(l)));

  kids.push(H("2. Kết luận theo giai đoạn"));
  for (const x of report.phases) {
    const v = x.impact.verdict;
    kids.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: `${x.phase.label}: `, bold: true, size: 22 }),
      new TextRun({ text: v.label, bold: true, size: 22, color: VERDICT_COLOR[v.level] }),
      new TextRun({ text: `  (${fmt(x.phase.startDate)} → ${x.phase.endDate ? fmt(x.phase.endDate) : "nay"} · ${x.phase.status})`, size: 20, color: GREY }),
    ] }));
    v.reasons.forEach((r) => kids.push(P(`• ${r}`, { size: 20, para: { indent: { left: 360 } } })));
    if (x.impact.savings) kids.push(P(`💰 ${x.impact.savings.text}`, { size: 20, para: { indent: { left: 360 } } }));
    if (x.reconcile && x.reconcile.warn) kids.push(P(x.reconcile.warn, { size: 20, bold: true, color: RED, para: { indent: { left: 360 } } }));
  }
  if (report.alerts.length) {
    kids.push(P("Cảnh báo theo dõi sau thành công:", { bold: true, color: RED }));
    report.alerts.forEach((a) => kids.push(P(`⚠ ${a.text}`, { color: RED, size: 20 })));
  }

  kids.push(H("3. So sánh các giai đoạn (cùng baseline chung)"));
  kids.push(table(["Giai đoạn", "Giai đoạn sau", "Đơn", "Tấn", "% On-time", "% Bể vỡ", "On-time so baseline", "Bể vỡ so baseline", "Tiền đền / 1.000 đơn", "Tiết kiệm (ước tính)", "Nhận định"],
    report.comparison.map((c) => [c.label, `${fmt(c.postFrom).slice(0, 5)}–${fmt(c.postTo).slice(0, 5)}`, n0(c.post.orders), n1(c.post.tons), pctTxt(c.post.ontimePct), bv(c.post.per1k),
      c.delta.ontimePts == null ? "—" : `${sgn(c.delta.ontimePts, n1)} điểm`, c.delta.per1kPct == null ? "—" : `${sgn(c.delta.per1kPct, n1)}%`,
      `${tr(c.base.compPer1k)} → ${tr(c.post.compPer1k)}`, saveTxt(c.savings), { text: c.verdict, bold: true, color: VERDICT_COLOR[c.verdictLevel] }]),
    { widths: [10, 11, 7, 7, 8, 8, 10, 10, 11, 8, 10], left: [0, 1, 10] }));
  kids.push(P("Mỗi giai đoạn so với cùng baseline chung, trên phạm vi của chính nó; các giai đoạn có thể chạy song song.", { italics: true, color: GREY, size: 18 }));

  let sec = 4;
  for (const x of report.phases) {
    const p = x.phase, imp = x.impact, T = imp.trial, C = imp.control, v = imp.verdict;
    kids.push(H(`${sec++}. ${p.label}`));
    const scope = [p.khoLay.length ? `Kho lấy: ${p.khoLay.map(shortWh).join(", ")}` : "", p.khoGiao.length ? `Kho giao (${p.khoGiao.length}): ${p.khoGiao.slice(0, 10).map(shortWh).join(", ")}${p.khoGiao.length > 10 ? ` và ${p.khoGiao.length - 10} kho khác` : ""}` : "", p.provinces.length ? `Tỉnh giao: ${p.provinces.join(", ")}` : ""].filter(Boolean);
    kids.push(P(`Thời gian: ${fmt(p.startDate)} → ${p.endDate ? fmt(p.endDate) : "Ongoing"} · Trạng thái: ${p.status}`));
    kids.push(P(`Phạm vi: ${scope.join(" · ") || "Toàn bộ đơn của khách"}`));
    if (p.description) p.description.split("\n").forEach((l) => kids.push(P(l, { size: 20 })));
    kids.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: `Nhận định: ${v.label}`, bold: true, size: 22, color: VERDICT_COLOR[v.level] }), new TextRun({ text: v.basis === "net" ? " (theo hiệu quả ròng, đã trừ nhóm đối chứng)" : "", size: 18, color: GREY })] }));
    v.reasons.forEach((r) => kids.push(P(`• ${r}`, { size: 20 })));
    v.notes.forEach((r) => kids.push(P(`Lưu ý: ${r}`, { size: 18, italics: true, color: GREY })));
    const rows = [
      ["Tổng đơn", n0(T.base.orders), n0(T.post.orders), sgn(T.delta.orders, n0), T.delta.ordersPct == null ? "—" : `${sgn(T.delta.ordersPct, n1)}%`],
      ["Tổng tấn", n1(T.base.tons), n1(T.post.tons), sgn(T.delta.tons, n1), T.delta.tonsPct == null ? "—" : `${sgn(T.delta.tonsPct, n1)}%`],
      ["% On-time", pctTxt(T.base.ontimePct), pctTxt(T.post.ontimePct), T.delta.ontimePts == null ? "—" : `${sgn(T.delta.ontimePts, n1)} điểm`, ""],
      ["Ca bể vỡ", n0(T.base.cases), n0(T.post.cases), sgn(T.delta.cases, n0), T.delta.casesPct == null ? "—" : `${sgn(T.delta.casesPct, n1)}%`],
      ["% Bể vỡ", bv(T.base.per1k), bv(T.post.per1k), T.delta.per1k == null ? "—" : `${sgn(T.delta.per1k / 10, n2)} điểm`, T.delta.per1kPct == null ? "—" : `${sgn(T.delta.per1kPct, n1)}%`],
      ["Tiền đền cho khách", tr(T.base.comp), tr(T.post.comp), trd(T.delta.comp), T.delta.compPct == null ? "—" : `${sgn(T.delta.compPct, n1)}%`],
      ["Tiền đền / 1.000 đơn", tr(T.base.compPer1k), tr(T.post.compPer1k), trd(T.delta.compPer1k), T.delta.compPer1kPct == null ? "—" : `${sgn(T.delta.compPer1kPct, n1)}%`],
      ["Truy thu (tham khảo)", tr(T.base.truyThu), tr(T.post.truyThu), trd(T.delta.truyThu), ""],
    ];
    const head = ["Chỉ số", `Trước ${fmt(imp.periods.base.from).slice(0, 5)}–${fmt(imp.periods.base.to).slice(0, 5)}`, `Sau ${fmt(imp.periods.post.from).slice(0, 5)}–${fmt(imp.periods.post.to).slice(0, 5)}`, "Chênh lệch", "% thay đổi"];
    if (imp.hasControl) {
      head.push("Đối chứng trước → sau", "Hiệu quả ròng");
      const add = [[n0(C.base.orders), n0(C.post.orders), "—"], [n1(C.base.tons), n1(C.post.tons), "—"], [pctTxt(C.base.ontimePct), pctTxt(C.post.ontimePct), imp.net.ontimePts == null ? "—" : `${sgn(imp.net.ontimePts, n1)} điểm`], [n0(C.base.cases), n0(C.post.cases), "—"], [bv(C.base.per1k), bv(C.post.per1k), imp.net.per1kPct == null ? "—" : `${sgn(imp.net.per1kPct, n1)}%`],
        [tr(C.base.comp), tr(C.post.comp), "—"], [tr(C.base.compPer1k), tr(C.post.compPer1k), imp.net.compPer1kPct == null ? "—" : `${sgn(imp.net.compPer1kPct, n1)}%`], [tr(C.base.truyThu), tr(C.post.truyThu), "—"]];
      rows.forEach((r, i) => r.push(`${add[i][0]} → ${add[i][1]}`, add[i][2]));
    }
    kids.push(table(head, rows));
    if (imp.savings) {
      kids.push(P(`💰 ${imp.savings.text}`, { bold: true, size: 20, color: !imp.savings.ok ? GREY : imp.savings.value >= 0 ? GREEN : RED, para: { spacing: { before: 80, after: 40 } } }));
      kids.push(P(`${coverage(T)}. ${MONEY_NOTE}`, { size: 18, italics: true, color: GREY }));
      imp.savings.notes.filter((x) => !x.startsWith("Tiền đền = ")).forEach((x) => kids.push(P(`Lưu ý: ${x}`, { size: 18, italics: true, color: GREY })));
    }
    imp.warnings.forEach((w) => kids.push(P(`⚠ ${w.text}`, { size: 18, color: "92400E" })));
    if (x.reconcile) kids.push(...reconcileBlock(x.reconcile));

    const imgs = images.get(p.id) || [];
    if (imgs.length) {
      kids.push(P("Ảnh minh hoạ", { bold: true, para: { spacing: { before: 120, after: 60 } } }));
      for (const im of imgs) {
        const sz = imageSize(im.buf);
        const w = Math.min(520, sz.w), h = Math.round((w * sz.h) / sz.w);
        kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: sz.type, data: im.buf, transformation: { width: w, height: h } })] }));
        if (im.caption) kids.push(P(im.caption, { italics: true, color: GREY, size: 18, para: { alignment: AlignmentType.CENTER } }));
      }
    }

    if (x.monitor) {
      for (const kind of ["month", "week"]) {
        const m = x.monitor[kind];
        kids.push(P(`Theo dõi sau thành công — theo ${kind === "month" ? "tháng" : "tuần"}`, { bold: true, para: { spacing: { before: 160, after: 60 } } }));
        kids.push(table(["Kỳ", "Đơn", "% On-time", "Ca bể", "% Bể vỡ", "Tiền đền", "On-time so kỳ trước", "Bể vỡ so kỳ trước", "Cảnh báo"], [
          ["Baseline", n0(m.baseline.orders), pctTxt(m.baseline.ontimePct), n0(m.baseline.cases), bv(m.baseline.per1k), tr(m.baseline.comp), "", "", ""],
          ...m.rows.map((r) => [`${r.label}${r.running ? "*" : ""}`, n0(r.stats.orders), pctTxt(r.stats.ontimePct), n0(r.stats.cases), bv(r.stats.per1k), tr(r.stats.comp),
            r.vs && r.vs.ontimePts != null ? `${sgn(r.vs.ontimePts, n1)} điểm` : "—", r.vs && r.vs.damageOk && r.vs.per1kPct != null ? `${sgn(r.vs.per1kPct, n1)}%` : "—", r.alerts.length ? { text: `⚠ ${r.alerts.join(", ")}`, color: "DC2626", bold: true } : ""]),
        ], { widths: [10, 8, 10, 7, 10, 10, 14, 14, 17], left: [0, 8] }));
      }
      kids.push(P("* kỳ đang chạy — so với cùng số ngày của kỳ trước. Tháng = các tuần có thứ 2 thuộc tháng.", { italics: true, color: GREY, size: 16 }));
    }
  }

  if (report.coverage) { kids.push(H(`${sec++}. Độ phủ tách tuyến & khoảng trống mở rộng`)); kids.push(...coverageBlock(report)); }

  kids.push(H(`${sec}. Cách tính`));
  [
    "Đơn tính theo ngày lấy hàng. On-time = số đơn có cờ GHN ontime / số đơn có cờ ontime hoặc late, loại đơn hoàn/huỷ (cùng cách tính báo cáo công ty).",
    "Ca bể vỡ = ca trong \"Báo cáo bể vỡ\" Rillnet, gắn theo đơn (đơn lấy ở giai đoạn nào thì ca tính vào giai đoạn đó). % Bể vỡ = ca ÷ đơn lấy × 100 (như báo cáo công ty: ca / đơn LTC); “so baseline / so kỳ trước” của bể vỡ là % thay đổi tương đối (VD 3,04% → 0,67% = −78%).",
    "Nhóm đối chứng = đơn của cùng khách nhưng ngoài phạm vi giai đoạn, cùng 2 khoảng thời gian. Hiệu quả ròng = thay đổi của phạm vi − thay đổi của đối chứng.",
    "Nhận định: Cải thiện xuất sắc / Có cải thiện / Cần theo dõi thêm / Không hiệu quả theo luật cố định (% bể vỡ thay đổi ±10% / −30%, on-time ±1 / +3 điểm; mẫu nhỏ hoặc < 5 ca → Cần theo dõi thêm / bỏ trục bể vỡ).",
    "Đối soát 2 góc nhìn: Cohort = ca của đơn lấy trong kỳ (cách tính của nhận định tự động); Real-time = ca có ngày ghi nhận Rillnet trong kỳ, thuộc đơn nằm trong phạm vi giai đoạn (mọi ngày lấy), ÷ đơn lấy trong cùng kỳ — chỉ tham khảo vì tử số và mẫu số khác bản chất. Cảnh báo ⚠ khi hai góc nhìn cho kết luận khác hướng (một bên giảm ≥ 10%, bên kia không giảm; hoặc một bên tăng ≥ 10%, bên kia không tăng; < 5 ca ở 2 kỳ thì không so hướng).",
    "Độ phủ = đơn/tấn thuộc phạm vi giải pháp (khách × kho lấy × kho giao × tỉnh) ÷ tổng đơn/tấn điện máy xuất từ kho nguồn cùng kỳ (mọi khách, gộp các kho cùng toạ độ theo danh sách kho GHN). Khoảng trống = sản lượng từ kho nguồn chưa nằm trong phạm vi của giải pháp nào trong Sổ tay. Dữ liệu không có cờ đơn thật sự đi qua tuyến tách nên độ phủ chỉ là phần đơn thuộc phạm vi áp dụng.",
    "Tiền đền cho khách = số CS nhập theo mã đơn (có thể còn cập nhật sau QC), gắn theo đơn như ca bể. Ước tính tiết kiệm = (tiền / 1.000 đơn trước − sau) × số đơn giai đoạn sau, trừ xu hướng nhóm đối chứng (% thay đổi) khi đối chứng đủ đơn — luôn là ƯỚC TÍNH, không ảnh hưởng nhận định. Truy thu (thu từ nhân viên GHN) không trừ vào thiệt hại, chỉ để tham khảo.",
  ].forEach((t) => kids.push(P(`• ${t}`, { size: 18, color: GREY })));
  if (report.sources) {
    kids.push(P("Nguồn dữ liệu", { bold: true, color: TEAL, para: { spacing: { before: 160, after: 40 } } }));
    report.sources.list.forEach((x) => kids.push(P(`• ${x.label}${x.atText ? ` (${x.atText})` : ""}: ${x.detail}${x.stale ? " ⚠" : ""}`, { size: 18, color: x.stale ? "92400E" : GREY })));
  }

  const doc = new Document({ creator: "SD3 Dashboard Điện Máy", title: sol.name, styles: { default: { document: { run: { font: "Arial" } } } }, sections: [{ properties: {}, children: kids }] });
  return Packer.toBuffer(doc);
}
