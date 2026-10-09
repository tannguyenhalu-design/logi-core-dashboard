/**
 * lib/biweekly-xlsx.js — renders computeReport() into the company Excel
 * file: one sheet per section in the same layout as the user's report
 * (teal headers, bold group totals, 0.0% rates, optional ± columns), an
 * empty "Insight" sheet for the user's commentary and a "Chi tiết" sheet to
 * trace the numbers. `lock` (optional) = { lockedAt, lockedBy } when the
 * file is re-downloaded from a "Chốt số" snapshot.
 */
import ExcelJS from "exceljs";
import { SHOW_TRUY_THU, scrubTruyThu } from "./display-flags";

const TEAL = "FF0F7C7B";
const WHITE = "FFFFFFFF";
const GREY = "FF6B7280";
const RED = "FFDC2626";
const GREEN = "FF15803D";
const BORDER = { style: "thin", color: { argb: "FFD1D5DB" } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

const vnTime = (iso) => (iso
  ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—");

function title(ws, text, sub, width) {
  ws.addRow([text]).font = { bold: true, size: 14 };
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, width);
  const s = ws.addRow([sub]);
  s.font = { italic: true, size: 10, color: { argb: GREY } };
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, width);
  ws.addRow([]);
}

function styleHeader(row) {
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    c.font = { bold: true, color: { argb: WHITE } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = ALL_BORDERS;
  });
  row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
}

// Two-level header: [section | countTitle × cols (+Δ) | rateTitle × cols (+Δ)].
// delta = [from, to]: count Δ as % change, rate Δ in percentage points.
// higherIsBetter decides the colour of the rate Δ (ontime ↑ good; FD/bể vỡ ↑ bad).
// extra = { title, key } appends one more block of plain counts (r[key]),
// e.g. the # GTC denominator of the Bể vỡ table (user 27/09: "1 case 3% vậy
// tổng số GTC là bao nhiêu?").
function metricTable(ws, section, countTitle, rateTitle, cols, rows, delta, higherIsBetter, extra = null) {
  const n = cols.length;
  const d = delta ? 1 : 0;
  const cw = n + d;
  const h1 = ws.addRow([section, countTitle, ...Array(cw - 1).fill(""), rateTitle, ...Array(cw - 1).fill(""), ...(extra ? [extra.title, ...Array(n - 1).fill("")] : [])]);
  ws.mergeCells(h1.number, 2, h1.number, 1 + cw);
  ws.mergeCells(h1.number, 2 + cw, h1.number, 1 + 2 * cw);
  if (extra && n > 1) ws.mergeCells(h1.number, 2 + 2 * cw, h1.number, 1 + 2 * cw + n);
  styleHeader(h1);
  // Biweekly two-week totals (28/09): "2 tuần trước (W36–W37)" / "Kỳ này (W38–W39)".
  const labels = cols.map((c) => {
    const l = c.mature === false ? `${c.label}*` : c.label;
    return c.kind === "span" ? `${c.sub}\n(${l})` : l;
  });
  const dLabel = delta ? [cols[delta[0]].kind === "span" ? "± vs 2 tuần trước" : `± vs ${cols[delta[0]].label}`] : [];
  const h2 = ws.addRow(["Khách", ...labels, ...dLabel, ...labels, ...dLabel.map((l) => l.replace("±", "± điểm")), ...(extra ? labels : [])]);
  styleHeader(h2);
  if (cols.some((c) => c.kind === "span")) h2.height = 30;
  for (const r of rows) {
    const counts = [...r.counts];
    const rates = r.rates.map((v) => (v == null ? "" : v));
    let cDelta = [], rDelta = [];
    if (delta) {
      const [a, b] = delta;
      const ca = Number(r.counts[a]), cb = Number(r.counts[b]);
      cDelta = [r.counts[a] === "" || !ca ? "" : (cb - ca) / ca];
      const ra = r.rates[a], rb = r.rates[b];
      rDelta = [ra == null || rb == null || ra === "" || rb === "" ? "" : (rb - ra) * 100];
    }
    const extraVals = extra ? (r[extra.key] || []).map((v) => (v == null ? "" : v)) : [];
    const row = ws.addRow([r.name, ...counts, ...cDelta, ...rates, ...rDelta, ...extraVals]);
    row.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = ALL_BORDERS;
      if (i >= 2) c.alignment = { horizontal: "right" };
      if (i >= 2 && i <= 1 + n) c.numFmt = "#,##0";
      else if (extra && i > 1 + 2 * cw) c.numFmt = "#,##0";
      else if (d && i === 2 + n) c.numFmt = "+0%;-0%;0%";
      else if (i >= 2 + cw && i <= 1 + cw + n) c.numFmt = "0.0%";
      else if (d && i === 2 + cw + n) {
        c.numFmt = "+0.0\" đ\";-0.0\" đ\";0.0\" đ\"";
        if (typeof c.value === "number" && c.value !== 0 && !r.total) {
          c.font = { bold: true, color: { argb: (c.value > 0) === higherIsBetter ? GREEN : RED } };
        }
      }
    });
    if (r.total) {
      row.eachCell({ includeEmpty: true }, (c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
        c.font = { bold: true, color: { argb: WHITE } };
      });
    }
  }
}

function footnotes(ws, lines, width) {
  ws.addRow([]);
  for (const l of lines) {
    const r = ws.addRow([l]);
    r.font = { italic: true, size: 10, color: { argb: GREY } };
    ws.mergeCells(r.number, 1, r.number, width);
  }
}

function setWidths(ws, first, rest, count) {
  ws.getColumn(1).width = first;
  for (let i = 2; i <= count; i++) ws.getColumn(i).width = rest;
}

const INDUSTRY_TITLES = {
  STTP: "ngành STTP (Siêu thị thực phẩm)",
  NHC: "ngành NHC (Ngành hàng chung)",
  ECOM: "ngành Ecom (Hàng nặng)",
  "STTP+NHC": "STTP + NHC tổng hợp",
};

export async function buildBiweeklyWorkbook(rep, lock = null, industry = null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SD3 Dashboard Điện Máy";
  wb.created = new Date();
  const indTitle = industry ? (INDUSTRY_TITLES[industry] ?? `ngành ${industry}`) : "ngành hàng điện tử / điện máy";
  const version = lock
    ? `SỐ ĐÃ CHỐT lúc ${vnTime(lock.lockedAt)}${lock.lockedBy ? ` bởi ${lock.lockedBy}` : ""}`
    : "Số mới nhất (chưa chốt)";
  const sel = rep.selection && rep.selection.length ? rep.selection : null;
  const who = sel ? `Khách: ${sel.map((c) => (c === "DigiWorld" ? "Digiworld" : c)).join(", ")}` : "Mẫu đầy đủ";
  const asOf = `Báo cáo ${rep.typeLabel.toLowerCase()} · ${rep.periodLabel} · ${who} · dữ liệu tính đến ${vnTime(rep.dataAsOf)} · ${version}`;
  const totalNote = "Tổng khách đã chọn = cộng số của đúng các khách trong bảng (không phải toàn ngành Điện máy).";
  const unripeBase = "* Tuần/tháng chưa chốt dữ liệu: còn đơn đang giao / ca bể vỡ nhập muộn — số có thể còn thay đổi.";
  // Period still running (asked for mid-week): say plainly the numbers are "so far".
  const unripe = rep.inProgress
    ? `KỲ ĐANG DIỄN RA: số tính đến ${vnTime(rep.dataAsOf)}, các ngày còn lại của kỳ chưa có — số còn tăng. ${unripeBase}`
    : unripeBase;
  const width = (sec) => 1 + 2 * (sec.cols.length + (sec.delta ? 1 : 0));
  // Biweekly (28/09): how the two-week total columns and ± are computed.
  const spanNote = (sec) => (sec.cols.some((c) => c.kind === "span")
    ? ["2 tuần trước / Kỳ này = cộng 2 tuần (số đơn/ca cộng lại, % tính lại trên tổng, không lấy trung bình 2 tuần). ± = Kỳ này so với 2 tuần trước: số đơn/ca theo % thay đổi, tỷ lệ theo điểm %."] : []);

  // ① Ontime LTL
  {
    const ws = wb.addWorksheet("Ontime LTL", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    const w = width(rep.ontime);
    title(ws, `2.1. Quản lý chất lượng ${indTitle} — Ontime LTL`, asOf, w);
    metricTable(ws, "Ontime", "# đơn LTC", "% ontime", rep.ontime.cols, rep.ontime.rows, rep.ontime.delta, true);
    footnotes(ws, [
      "Tuần = tuần ISO (thứ 2 – chủ nhật). Tháng = các tuần có thứ 2 thuộc tháng đó.",
      "# đơn LTC = đơn lấy hàng thành công, gán tuần theo ngày lấy. % ontime = số đơn có odr_success = ontime / số đơn có odr_success là ontime hoặc late (cờ của GHN, theo ngày giao thành công so với hạn); loại đơn có trạng thái hoàn/huỷ (return, returned, cancel…); đơn chưa có cờ (đang giao) chưa tính. Cùng cách tính với báo cáo chất lượng của công ty (từ 28/09).",
      ...spanNote(rep.ontime),
      sel ? totalNote : (industry ? "Khác = khách không có dòng riêng trong bảng." : "Khác = khách Điện Máy không có dòng riêng, chia B2B / B2C theo \"Cài đặt kênh khách hàng\" (khách chưa cài đặt: theo đa số đơn trong dữ liệu)."),
      unripe,
    ], w);
    setWidths(ws, 24, 11, w);
  }

  // ② Bể vỡ (skip for industries without damage tracking, e.g. Ecom)
  if (rep.hasDamage !== false) {
    const ws = wb.addWorksheet("Bể vỡ", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    const w = width(rep.damage) + rep.damage.cols.length;
    title(ws, "Bể vỡ và đền bù", asOf, w);
    // Denominator: # đơn LTC by pickup week (user 28/09); locks taken before carry GTC.
    const isLtc = rep.damage.rows.some((r) => Array.isArray(r.ltc));
    const den = isLtc ? "LTC" : "GTC";
    metricTable(ws, "Bể vỡ", "# case bể và đền (ghi nhận theo ngày phát hiện)", `% bể đền / ${den}`, rep.damage.cols, rep.damage.rows, rep.damage.delta, false,
      isLtc ? { title: "# đơn LTC (đơn lấy thành công — mẫu số)", key: "ltc" } : { title: "# GTC (đơn giao thành công — mẫu số)", key: "gtc" });
    footnotes(ws, [
      "Case bể và đền = ca trong \"Báo cáo bể vỡ\" của Rillnet (CS tick 💰 · đơn cũ bù tay · đã chốt tiền), gồm cả hư ngoại quan lẫn sản phẩm bên trong.",
      isLtc
        ? "% bể đền của mỗi khách = ca bể của khách đó (theo ngày phát hiện) / đơn LTC của chính khách đó (đơn lấy thành công trong tuần, theo ngày lấy)."
        : "% bể đền của mỗi khách = ca bể của khách đó / GTC của chính khách đó. GTC = đơn giao thành công trong tuần (theo ngày giao).",
      `Tổng khách đã chọn = tổng ca bể / tổng ${den} của đúng các khách trong bảng (không phải toàn ngành Điện máy).`,
      ...spanNote(rep.damage),
      `Khối # ${den} bên phải = mẫu số của từng ô %. ${den} nhỏ (dưới 50 đơn) thì 1 ca đã ra % rất cao — nên nhìn số ca.`,
      "CÁCH GÁN TUẦN — mỗi chỉ số dùng một mốc ngày khác nhau:",
      isLtc ? "   • # đơn LTC (mẫu số % bể đền, cũng là # đơn LTC sheet Ontime): theo ngày LẤY hàng." : "   • # đơn LTC (sheet Ontime/Hàng hoàn): theo ngày LẤY hàng.",
      ...(isLtc ? [] : ["   • GTC (mẫu số % bể đền): theo ngày GIAO thành công."]),
      "   • # case bể: theo ngày PHÁT HIỆN trên Rillnet (ngày phát sinh sự vụ; chưa nhập thì lấy ngày CS lập phiếu) — giống \"Báo cáo bể vỡ\" của Rillnet.",
      "   → Ví dụ: đơn lấy W37, giao W38, phát hiện hư W38 → đơn nằm ở W37 (# đơn LTC) nhưng ca bể tính vào W38.",
      isLtc
        ? "   → Vì vậy % bể đền là tỷ lệ tham chiếu theo tuần (ca phát hiện trong tuần / đơn lấy trong tuần), không phải tỷ lệ bể của đúng các đơn lấy tuần đó."
        : "   → Vì vậy % bể đền là tỷ lệ tham chiếu theo tuần (ca phát hiện trong tuần / đơn giao trong tuần), không phải tỷ lệ bể của đúng các đơn giao tuần đó.",
      "   → Sheet \"Chi tiết\" ghi rõ tuần lấy / tuần giao của từng ca để đối chiếu.",
      unripe,
    ], w);
    setWidths(ws, 24, 11, w);
  } // end Bể vỡ

  // ③ Hàng hoàn
  {
    const ws = wb.addWorksheet("Hàng hoàn", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    const w = width(rep.fd);
    title(ws, "Hàng hoàn — 1 đơn hoàn = 1 rủi ro bể vỡ đền bù", asOf, w);
    metricTable(ws, "Failed delivery", "# đơn FD", "% FD", rep.fd.cols, rep.fd.rows, rep.fd.delta, false);
    footnotes(ws, ["# đơn FD = đơn phát sinh hoàn (deliver_type = return), theo tuần lấy hàng; % FD = FD / # đơn LTC.", ...spanNote(rep.fd), ...(sel ? [totalNote] : []), unripe], w);
    setWidths(ws, 24, 11, w);
  }

  // ④ FTL — blank template (no SLA data source yet, user fills it in)
  {
    const ws = wb.addWorksheet("FTL");
    const n = rep.ftl.cols.length;
    const w = 1 + 2 * n;
    title(ws, "FTL — ontime (lấy từ portal B2B, điền tay)", "Chưa có nguồn dữ liệu có hạn giao — bảng để trống để điền số.", w);
    metricTable(ws, "Ontime", "# đơn LTC", "% ontime", rep.ftl.cols, [
      ...rep.ftl.clients.map((c) => ({ name: c, counts: Array(n).fill(""), rates: Array(n).fill("") })),
      { name: "Tổng khách FTL", total: true, counts: Array(n).fill(""), rates: Array(n).fill("") },
    ], null, true);
    setWidths(ws, 24, 11, w);
  }

  // Insight — multi-column executive grid: A=client, B=KPI, C=details, D=routes/locations
  {
    const ws = wb.addWorksheet("Insight");
    ws.getColumn(1).width = 25;
    ws.getColumn(2).width = 20;
    ws.getColumn(3).width = 50;
    ws.getColumn(4).width = 40;
    const LIGHT_GREY = "FFF3F4F6";

    ws.addRow([`Nhận định — ${rep.periodLabel}`, "", "", ""]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
    ws.getCell(ws.rowCount, 1).font = { bold: true, size: 14 };
    ws.addRow([asOf, "", "", ""]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
    ws.getCell(ws.rowCount, 1).font = { italic: true, size: 10, color: { argb: GREY } };

    const all = rep.insights || {};
    const SEC_DEFS = [
      { header: "Section 1: ONTIME SLA & LATE DELIVERIES (Chậm chuyến & Vỡ tuyến)", ins: all.ontime, noneLabel: "Không phát sinh", headerColor: "FF0F7C7B", colDLabel: "Tuyến trọng điểm", colDKeys: ["Tuyến trễ nổi bật", "Không có tuyến trễ nổi bật"] },
      { header: "Section 2: RILLNET DAMAGE & LOSS (Bể vỡ & Đền bù)", ins: all.damage, noneLabel: "Không phát sinh ca", headerColor: "FFEF4444", colDLabel: "Chặng / Kho nghi vấn", colDKeys: ["Chặng nghi vấn", "Kho phát hiện"] },
      { header: "Section 3: FAILED DELIVERY & RETURNS (Hàng hoàn & Rủi ro)", ins: all.fd, noneLabel: "Không có đơn hoàn", headerColor: "FFF59E0B", colDLabel: "Kho hoàn trọng điểm", colDKeys: ["Kho giao hoàn nhiều"] },
    ];

    for (const { header, ins, noneLabel, headerColor, colDLabel, colDKeys } of SEC_DEFS) {
      ws.addRow([]);

      // Section header — colored fill, white text, merged A:D
      const secRow = ws.addRow([header, "", "", ""]);
      ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
      const secCell = ws.getCell(ws.rowCount, 1);
      secCell.font = { bold: true, size: 12, color: { argb: WHITE } };
      secCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerColor } };
      secCell.alignment = { horizontal: "left", vertical: "middle" };
      secCell.border = ALL_BORDERS;
      secRow.height = 22;

      if (!(ins && (ins.clients.length || ins.total))) {
        // No data — empty notes box only
        const s = ws.rowCount + 1;
        for (let i = 0; i < 4; i++) ws.addRow(["", "", "", ""]);
        ws.mergeCells(s, 1, ws.rowCount, 4);
        ws.getCell(s, 1).border = ALL_BORDERS;
        ws.getCell(s, 1).alignment = { vertical: "top", wrapText: true };
        continue;
      }

      // Hint row (merged)
      ws.addRow([`Gợi ý hệ thống (${ins.span}${ins.prevSpan ? `, so với ${ins.prevSpan}` : ""}) — kiểm tra, sửa trước khi gửi`, "", "", ""]);
      ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
      ws.getCell(ws.rowCount, 1).font = { italic: true, size: 10, color: { argb: GREY } };

      // Section total (merged, light-blue fill)
      if (ins.total) {
        const totRow = ws.addRow([ins.total, "", "", ""]);
        ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
        const tc = ws.getCell(ws.rowCount, 1);
        tc.font = { bold: true };
        tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
        tc.alignment = { wrapText: true, vertical: "top" };
        tc.border = ALL_BORDERS;
        totRow.height = Math.max(16, Math.ceil(ins.total.length / 120) * 16);
      }
      if (ins.pending) {
        ws.addRow([ins.pending, "", "", ""]);
        ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
        const pc = ws.getCell(ws.rowCount, 1);
        pc.font = { color: { argb: "FFF59E0B" } };
        pc.alignment = { wrapText: true, vertical: "top" };
        pc.border = ALL_BORDERS;
      }
      if (ins.note) {
        ws.addRow([ins.note, "", "", ""]);
        ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
        const nc = ws.getCell(ws.rowCount, 1);
        nc.font = { italic: true, size: 10, color: { argb: GREY } };
        nc.alignment = { wrapText: true, vertical: "top" };
        nc.border = ALL_BORDERS;
      }

      // Column header row (same color as section header)
      const colHdr = ws.addRow(["Khách hàng", "KPI & Biến động", "Chi tiết", colDLabel]);
      colHdr.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: WHITE } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerColor } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = ALL_BORDERS;
      });
      colHdr.height = 18;

      // One data row per client
      for (const c of ins.clients) {
        const sep = c.lines[0].indexOf(": ");
        const clientName = sep > -1 ? c.lines[0].slice(0, sep) : c.lines[0];
        const kpiText = sep > -1 ? c.lines[0].slice(sep + 2) : "";
        const colCLines = [], colDLines = [];
        for (const l of c.lines.slice(1)) {
          const cl = scrubTruyThu(l);
          if (colDKeys.some((k) => cl.includes(k))) colDLines.push(cl);
          else colCLines.push(cl);
        }
        const dr = ws.addRow([clientName, kpiText, colCLines.join("\n"), colDLines.join("\n")]);
        dr.getCell(1).font = { bold: true, size: 11 };
        dr.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREY } };
        for (const ci of [1, 2, 3, 4]) {
          dr.getCell(ci).alignment = { wrapText: true, vertical: "top" };
          dr.getCell(ci).border = ALL_BORDERS;
        }
        dr.height = Math.max(18, Math.max(colCLines.length, colDLines.length, 1) * 16);
      }

      // None label (merged)
      if (ins.none && ins.none.length) {
        ws.addRow([`${noneLabel}: ${ins.none.join(", ")}.`, "", "", ""]);
        ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
        const nc = ws.getCell(ws.rowCount, 1);
        nc.font = { italic: true, color: { argb: GREY } };
        nc.alignment = { wrapText: true, vertical: "top" };
        nc.border = ALL_BORDERS;
      }

      // User notes fill-in box (merged A:D)
      ws.addRow(["Nhận định của bạn:", "", "", ""]);
      ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
      ws.getCell(ws.rowCount, 1).alignment = { vertical: "top" };
      const noteStart = ws.rowCount + 1;
      for (let i = 0; i < 4; i++) ws.addRow(["", "", "", ""]);
      ws.mergeCells(noteStart, 1, ws.rowCount, 4);
      ws.getCell(noteStart, 1).border = ALL_BORDERS;
      ws.getCell(noteStart, 1).alignment = { vertical: "top", wrapText: true };
    }

    // FTL + Next steps manual fill-in boxes (teal header, merged A:D)
    for (const sec of ["FTL", "Next steps"]) {
      ws.addRow([]);
      ws.addRow([sec, "", "", ""]);
      ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
      const ftlCell = ws.getCell(ws.rowCount, 1);
      ftlCell.font = { bold: true, color: { argb: WHITE } };
      ftlCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
      ftlCell.alignment = { horizontal: "left", vertical: "middle" };
      ftlCell.border = ALL_BORDERS;
      const ftlStart = ws.rowCount + 1;
      for (let i = 0; i < 4; i++) ws.addRow(["", "", "", ""]);
      ws.mergeCells(ftlStart, 1, ws.rowCount, 4);
      ws.getCell(ftlStart, 1).border = ALL_BORDERS;
      ws.getCell(ftlStart, 1).alignment = { vertical: "top", wrapText: true };
    }
  }

  // Chi tiết — trace list
  {
    const ws = wb.addWorksheet("Chi tiết");
    ws.addRow(["Ca bể vỡ trong các tuần của kỳ (gán tuần theo ngày phát hiện)"]).font = { bold: true, size: 12 };
    const note = ws.addRow(["Tuần lấy / Tuần giao là tuần của chính đơn đó — có thể khác tuần phát hiện (ca được tính vào tuần phát hiện)."]);
    note.font = { italic: true, size: 10, color: { argb: GREY } };
    styleHeader(ws.addRow(["Tuần phát hiện", "Mã đơn", "Khách", "Ngày phát hiện", "Ngày tạo", "Tuần tạo", "Tuần lấy", "Tuần giao", "Trạng thái đơn",
      "Kho lấy", "Tỉnh lấy", "Kho giao", "Tỉnh giao", "Chặng nghi vấn", "Kho phát hiện", "Kg", "Đã chốt đền bù", ...(SHOW_TRUY_THU ? ["Truy thu", "Tiền truy thu"] : [])]));
    const dmy = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
    // Grouped per client so "which orders / which route" reads top to bottom.
    const cases = [...rep.details.damageCases].sort((a, b) => a.client.localeCompare(b.client) || String(a.monday || a.week).localeCompare(String(b.monday || b.week)) || a.order_code.localeCompare(b.order_code));
    for (const d of cases) {
      const r = ws.addRow([d.week, d.order_code, d.client, d.case_date, dmy(d.created_date), d.created_week || "", d.pickup_week || "", d.delivered_week || "", d.order_status || "",
        d.kho_lay || "", d.from_province || "", d.kho_giao || "", d.to_province || "", d.leg, d.warehouse, d.weight_kg ?? "", d.compensated ? "Có" : "",
        ...(SHOW_TRUY_THU ? [d.truy_thu === "co" ? "Có" : d.truy_thu === "khong" ? "Không" : "Chờ chốt", d.truy_thu_amount || ""] : [])]);
      r.getCell(16).numFmt = "#,##0";
      if (SHOW_TRUY_THU) r.getCell(19).numFmt = "#,##0";
    }
    ws.addRow([]);
    ws.addRow(["Đơn hàng hoàn (FD) trong các tuần của kỳ"]).font = { bold: true, size: 12 };
    styleHeader(ws.addRow(["Tuần lấy", "Mã đơn", "Khách", "Ngày lấy", "Trạng thái", "Kho lấy", "Tỉnh lấy", "Kho giao", "Tỉnh giao", "Kg", "Có ca bể (Rillnet)"]));
    const fds = [...rep.details.fdOrders].sort((a, b) => a.client.localeCompare(b.client) || String(a.monday || a.week).localeCompare(String(b.monday || b.week)) || String(a.order_code).localeCompare(String(b.order_code)));
    for (const f of fds) {
      ws.addRow([f.week, f.order_code, f.client, String(f.pickup_time || "").slice(0, 10), f.status,
        f.kho_lay ?? "", f.from_province ?? "", f.kho_giao ?? "", f.to_province ?? "", f.weight_kg ?? "", f.has_damage ? "Có" : ""]);
    }
    [12, 16, 22, 13, 12, 9, 9, 9, 12, 34, 14, 34, 14, 26, 34, 7, 12, 10, 14].forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });
  }

  // Đơn trễ — every late order in the period's week columns (user 27/09),
  // grouped per client, so readers can look up any late order in the file.
  if (Array.isArray(rep.details.lateOrders)) {
    const ws = wb.addWorksheet("Đơn trễ", { views: [{ state: "frozen", ySplit: 3 }] });
    ws.addRow([`Đơn trễ trong các tuần của kỳ (gán tuần theo ngày lấy) — ${rep.periodLabel}`]).font = { bold: true, size: 12 };
    const note = ws.addRow(["Trễ = đơn có odr_success = late (giao trễ, hoặc chưa giao mà GHN đã gắn trễ). Không gồm đơn hoàn/huỷ. Số ngày trễ = ngày giao − hạn giao (đơn chưa giao: hôm nay − hạn giao; tối thiểu 1)."]);
    note.font = { italic: true, size: 10, color: { argb: GREY } };
    styleHeader(ws.addRow(["Tuần lấy", "Mã đơn", "Khách", "Ngày lấy", "Hạn giao", "Ngày giao", "Trễ (ngày)", "Loại trễ", "Kho lấy", "Tỉnh lấy", "Kho giao", "Tỉnh giao", "Kg"]));
    const late = [...rep.details.lateOrders].sort((a, b) => a.client.localeCompare(b.client) || a.monday.localeCompare(b.monday) || (b.days_late ?? -1) - (a.days_late ?? -1) || a.order_code.localeCompare(b.order_code));
    for (const o of late) {
      const r = ws.addRow([o.week, o.order_code, o.client, o.pickup_date, o.deadline, o.delivered_date, o.days_late ?? "", o.late_kind || "Giao trễ", o.kho_lay, o.from_province, o.kho_giao, o.to_province, o.weight_kg ?? ""]);
      if ((o.days_late || 0) >= 3) r.getCell(7).font = { bold: true, color: { argb: RED } };
    }
    [9, 16, 22, 12, 12, 12, 10, 18, 34, 14, 34, 14, 8].forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });
  }

  return wb.xlsx.writeBuffer();
}
