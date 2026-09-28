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
  }
  if (report.alerts.length) {
    kids.push(P("Cảnh báo theo dõi sau thành công:", { bold: true, color: RED }));
    report.alerts.forEach((a) => kids.push(P(`⚠ ${a.text}`, { color: RED, size: 20 })));
  }

  kids.push(H("3. So sánh các giai đoạn (cùng baseline chung)"));
  kids.push(table(["Giai đoạn", "Giai đoạn sau", "Đơn", "Tấn", "% On-time", "Ca/1.000 đơn", "On-time so baseline", "Ca/1.000 so baseline", "Nhận định"],
    report.comparison.map((c) => [c.label, `${fmt(c.postFrom).slice(0, 5)}–${fmt(c.postTo).slice(0, 5)}`, n0(c.post.orders), n1(c.post.tons), pctTxt(c.post.ontimePct), n2(c.post.per1k),
      c.delta.ontimePts == null ? "—" : `${sgn(c.delta.ontimePts, n1)} điểm`, c.delta.per1kPct == null ? "—" : `${sgn(c.delta.per1kPct, n1)}%`, { text: c.verdict, bold: true, color: VERDICT_COLOR[c.verdictLevel] }]),
    { widths: [12, 14, 8, 8, 10, 11, 12, 12, 13], left: [0, 1, 8] }));
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
      ["Ca/1.000 đơn", n2(T.base.per1k), n2(T.post.per1k), sgn(T.delta.per1k, n2), T.delta.per1kPct == null ? "—" : `${sgn(T.delta.per1kPct, n1)}%`],
    ];
    const head = ["Chỉ số", `Trước ${fmt(imp.periods.base.from).slice(0, 5)}–${fmt(imp.periods.base.to).slice(0, 5)}`, `Sau ${fmt(imp.periods.post.from).slice(0, 5)}–${fmt(imp.periods.post.to).slice(0, 5)}`, "Chênh lệch", "% thay đổi"];
    if (imp.hasControl) {
      head.push("Đối chứng trước → sau", "Hiệu quả ròng");
      const add = [[n0(C.base.orders), n0(C.post.orders), "—"], [n1(C.base.tons), n1(C.post.tons), "—"], [pctTxt(C.base.ontimePct), pctTxt(C.post.ontimePct), imp.net.ontimePts == null ? "—" : `${sgn(imp.net.ontimePts, n1)} điểm`], [n0(C.base.cases), n0(C.post.cases), "—"], [n2(C.base.per1k), n2(C.post.per1k), imp.net.per1kPct == null ? "—" : `${sgn(imp.net.per1kPct, n1)}%`]];
      rows.forEach((r, i) => r.push(`${add[i][0]} → ${add[i][1]}`, add[i][2]));
    }
    kids.push(table(head, rows));
    imp.warnings.forEach((w) => kids.push(P(`⚠ ${w.text}`, { size: 18, color: "92400E" })));

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
        kids.push(table(["Kỳ", "Đơn", "% On-time", "Ca bể", "Ca/1.000 đơn", "On-time so kỳ trước", "Ca/1.000 so kỳ trước", "Cảnh báo"], [
          ["Baseline", n0(m.baseline.orders), pctTxt(m.baseline.ontimePct), n0(m.baseline.cases), n2(m.baseline.per1k), "", "", ""],
          ...m.rows.map((r) => [`${r.label}${r.running ? "*" : ""}`, n0(r.stats.orders), pctTxt(r.stats.ontimePct), n0(r.stats.cases), n2(r.stats.per1k),
            r.vs && r.vs.ontimePts != null ? `${sgn(r.vs.ontimePts, n1)} điểm` : "—", r.vs && r.vs.damageOk && r.vs.per1kPct != null ? `${sgn(r.vs.per1kPct, n1)}%` : "—", r.alerts.length ? { text: `⚠ ${r.alerts.join(", ")}`, color: "DC2626", bold: true } : ""]),
        ], { widths: [11, 9, 11, 8, 12, 15, 15, 19], left: [0, 7] }));
      }
      kids.push(P("* kỳ đang chạy — so với cùng số ngày của kỳ trước. Tháng = các tuần có thứ 2 thuộc tháng.", { italics: true, color: GREY, size: 16 }));
    }
  }

  kids.push(H(`${sec}. Cách tính`));
  [
    "Đơn tính theo ngày lấy hàng. On-time = số đơn có cờ GHN ontime / số đơn có cờ ontime hoặc late, loại đơn hoàn/huỷ (cùng cách tính báo cáo công ty).",
    "Ca bể vỡ = ca trong \"Báo cáo bể vỡ\" Rillnet, gắn theo đơn (đơn lấy ở giai đoạn nào thì ca tính vào giai đoạn đó). Ca/1.000 đơn = ca ÷ đơn lấy × 1.000.",
    "Nhóm đối chứng = đơn của cùng khách nhưng ngoài phạm vi giai đoạn, cùng 2 khoảng thời gian. Hiệu quả ròng = thay đổi của phạm vi − thay đổi của đối chứng.",
    "Nhận định: Cải thiện xuất sắc / Có cải thiện / Cần theo dõi thêm / Không hiệu quả theo luật cố định (ca/1.000 đơn ±10% / −30%, on-time ±1 / +3 điểm; mẫu nhỏ hoặc < 5 ca → Cần theo dõi thêm / bỏ trục bể vỡ).",
  ].forEach((t) => kids.push(P(`• ${t}`, { size: 18, color: GREY })));

  const doc = new Document({ creator: "SD3 Dashboard Điện Máy", title: sol.name, styles: { default: { document: { run: { font: "Arial" } } } }, sections: [{ properties: {}, children: kids }] });
  return Packer.toBuffer(doc);
}
