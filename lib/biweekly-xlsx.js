/**
 * lib/biweekly-xlsx.js — renders computeReport() into the company Excel
 * file: one sheet per section in the same layout as the user's report
 * (teal headers, bold group totals, 0.0% rates, optional ± columns), an
 * empty "Insight" sheet for the user's commentary and a "Chi tiết" sheet to
 * trace the numbers. `lock` (optional) = { lockedAt, lockedBy } when the
 * file is re-downloaded from a "Chốt số" snapshot.
 */
import ExcelJS from "exceljs";

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
  const labels = cols.map((c) => (c.mature === false ? `${c.label}*` : c.label));
  const dLabel = delta ? [`± vs ${cols[delta[0]].label}`] : [];
  styleHeader(ws.addRow(["Khách", ...labels, ...dLabel, ...labels, ...dLabel.map((l) => l.replace("±", "± điểm")), ...(extra ? labels : [])]));
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

export async function buildBiweeklyWorkbook(rep, lock = null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SD3 Dashboard Điện Máy";
  wb.created = new Date();
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

  // ① Ontime LTL
  {
    const ws = wb.addWorksheet("Ontime LTL", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    const w = width(rep.ontime);
    title(ws, "2.1. Quản lý chất lượng ngành hàng điện tử / điện máy — Ontime LTL", asOf, w);
    metricTable(ws, "Ontime", "# đơn LTC", "% ontime", rep.ontime.cols, rep.ontime.rows, rep.ontime.delta, true);
    footnotes(ws, [
      "Tuần = tuần ISO (thứ 2 – chủ nhật). Tháng = các tuần có thứ 2 thuộc tháng đó.",
      "# đơn LTC = đơn lấy hàng thành công, gán tuần theo ngày lấy. % ontime = đơn giao đúng hạn / đơn đã giao (ontime + late).",
      sel ? totalNote : "Khác = khách Điện Máy ngoài danh sách, chia B2B/B2C theo is_B2C.",
      unripe,
    ], w);
    setWidths(ws, 24, 11, w);
  }

  // ② Bể vỡ
  {
    const ws = wb.addWorksheet("Bể vỡ", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    const w = width(rep.damage) + rep.damage.cols.length;
    title(ws, "Bể vỡ và đền bù", asOf, w);
    metricTable(ws, "Bể vỡ", "# case bể và đền (ghi nhận theo ngày phát hiện)", "% bể đền / GTC", rep.damage.cols, rep.damage.rows, rep.damage.delta, false,
      { title: "# GTC (đơn giao thành công — mẫu số)", key: "gtc" });
    footnotes(ws, [
      "Case bể và đền = ca trong \"Báo cáo bể vỡ\" của Rillnet (CS tick 💰 · đơn cũ bù tay · đã chốt tiền), gồm cả hư ngoại quan lẫn sản phẩm bên trong.",
      "% bể đền của mỗi khách = ca bể của khách đó / GTC của chính khách đó. GTC = đơn giao thành công trong tuần (theo ngày giao).",
      "Tổng khách đã chọn = tổng ca bể / tổng GTC của đúng các khách trong bảng (không phải toàn ngành Điện máy).",
      "Khối # GTC bên phải = mẫu số của từng ô %. GTC nhỏ (dưới 50 đơn) thì 1 ca đã ra % rất cao — nên nhìn số ca.",
      "CÁCH GÁN TUẦN — mỗi chỉ số dùng một mốc ngày khác nhau:",
      "   • # đơn LTC (sheet Ontime/Hàng hoàn): theo ngày LẤY hàng.",
      "   • GTC (mẫu số % bể đền): theo ngày GIAO thành công.",
      "   • # case bể: theo ngày PHÁT HIỆN trên Rillnet (ngày phát sinh sự vụ; chưa nhập thì lấy ngày CS lập phiếu) — giống \"Báo cáo bể vỡ\" của Rillnet.",
      "   → Ví dụ: đơn lấy W37, giao W38, phát hiện hư W38 → đơn nằm ở W37 (# đơn LTC) nhưng ca bể tính vào W38.",
      "   → Vì vậy % bể đền là tỷ lệ tham chiếu theo tuần (ca phát hiện trong tuần / đơn giao trong tuần), không phải tỷ lệ bể của đúng các đơn giao tuần đó.",
      "   → Sheet \"Chi tiết\" ghi rõ tuần lấy / tuần giao của từng ca để đối chiếu.",
      unripe,
    ], w);
    setWidths(ws, 24, 11, w);
  }

  // ③ Hàng hoàn
  {
    const ws = wb.addWorksheet("Hàng hoàn", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    const w = width(rep.fd);
    title(ws, "Hàng hoàn — 1 đơn hoàn = 1 rủi ro bể vỡ đền bù", asOf, w);
    metricTable(ws, "Failed delivery", "# đơn FD", "% FD", rep.fd.cols, rep.fd.rows, rep.fd.delta, false);
    footnotes(ws, ["# đơn FD = đơn phát sinh hoàn (deliver_type = return), theo tuần lấy hàng; % FD = FD / # đơn LTC.", ...(sel ? [totalNote] : []), unripe], w);
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

  // Insight — empty boxes per section
  {
    const ws = wb.addWorksheet("Insight");
    ws.getColumn(1).width = 110;
    ws.addRow([`Nhận định — ${rep.periodLabel}`]).font = { bold: true, size: 14 };
    ws.addRow([asOf]).font = { italic: true, size: 10, color: { argb: GREY } };
    const all = rep.insights || {};
    const bySection = { "Ontime LTL": all.ontime, "Bể vỡ và đền bù": all.damage, "Hàng hoàn": all.fd };
    const noneLabel = { "Bể vỡ và đền bù": "Không phát sinh ca", "Hàng hoàn": "Không có đơn hoàn" };
    for (const sec of ["Ontime LTL", "Bể vỡ và đền bù", "Hàng hoàn", "FTL", "Next steps"]) {
      ws.addRow([]);
      styleHeader(ws.addRow([sec]));
      // Draft insight written from the numbers (fixed templates, no AI) —
      // clearly marked so the user reviews it before sending.
      const ins = bySection[sec];
      if (ins && (ins.clients.length || ins.total)) {
        const hint = ws.addRow([`Gợi ý của hệ thống (tự viết từ số liệu ${ins.span}${ins.prevSpan ? `, so với ${ins.prevSpan}` : ""}) — kiểm tra, sửa hoặc xoá trước khi gửi:`]);
        hint.font = { italic: true, size: 10, color: { argb: GREY } };
        const add = (text, opts = {}) => {
          const r = ws.addRow([text]);
          r.getCell(1).alignment = { wrapText: true, vertical: "top", indent: opts.indent || 0 };
          if (opts.bold) r.font = { bold: true };
          if (opts.grey) r.font = { italic: true, size: 10, color: { argb: GREY } };
          r.height = Math.max(15, Math.ceil(String(text).length / 120) * 15);
        };
        if (ins.total) add(ins.total, { bold: true });
        if (ins.pending) add(ins.pending);
        if (ins.note) add(ins.note, { grey: true });
        for (const c of ins.clients) {
          add("• " + c.lines[0], { bold: true });
          for (const l of c.lines.slice(1)) add(l, { indent: 2 });
        }
        if (ins.none && ins.none.length) add(`${noneLabel[sec] || "Không có"}: ${ins.none.join(", ")}.`);
        ws.addRow([]).getCell(1).value = "Nhận định của bạn:";
      }
      const start = ws.rowCount + 1;
      for (let i = 0; i < 6; i++) ws.addRow([""]);
      ws.mergeCells(start, 1, ws.rowCount, 1);
      const cell = ws.getCell(start, 1);
      cell.border = ALL_BORDERS;
      cell.alignment = { vertical: "top", wrapText: true };
    }
  }

  // Chi tiết — trace list
  {
    const ws = wb.addWorksheet("Chi tiết");
    ws.addRow(["Ca bể vỡ trong các tuần của kỳ (gán tuần theo ngày phát hiện)"]).font = { bold: true, size: 12 };
    const note = ws.addRow(["Tuần lấy / Tuần giao là tuần của chính đơn đó — có thể khác tuần phát hiện (ca được tính vào tuần phát hiện)."]);
    note.font = { italic: true, size: 10, color: { argb: GREY } };
    styleHeader(ws.addRow(["Tuần phát hiện", "Mã đơn", "Khách", "Ngày phát hiện", "Ngày tạo", "Tuần tạo", "Tuần lấy", "Tuần giao", "Trạng thái đơn",
      "Kho lấy", "Tỉnh lấy", "Kho giao", "Tỉnh giao", "Chặng nghi vấn", "Kho phát hiện", "Kg", "Đã chốt đền bù", "Truy thu", "Tiền truy thu"]));
    const dmy = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
    // Grouped per client so "which orders / which route" reads top to bottom.
    const cases = [...rep.details.damageCases].sort((a, b) => a.client.localeCompare(b.client) || String(a.monday || a.week).localeCompare(String(b.monday || b.week)) || a.order_code.localeCompare(b.order_code));
    for (const d of cases) {
      const r = ws.addRow([d.week, d.order_code, d.client, d.case_date, dmy(d.created_date), d.created_week || "", d.pickup_week || "", d.delivered_week || "", d.order_status || "",
        d.kho_lay || "", d.from_province || "", d.kho_giao || "", d.to_province || "", d.leg, d.warehouse, d.weight_kg ?? "", d.compensated ? "Có" : "",
        d.truy_thu === "co" ? "Có" : d.truy_thu === "khong" ? "Không" : "Chờ chốt", d.truy_thu_amount || ""]);
      r.getCell(16).numFmt = "#,##0";
      r.getCell(19).numFmt = "#,##0";
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
    ws.addRow([`Đơn giao trễ trong các tuần của kỳ (gán tuần theo ngày lấy) — ${rep.periodLabel}`]).font = { bold: true, size: 12 };
    const note = ws.addRow(["Trễ = đơn đã giao thành công nhưng quá hạn giao (odr_success = late). Số ngày trễ = ngày giao − hạn giao (tối thiểu 1). Đơn chưa giao xong chưa tính."]);
    note.font = { italic: true, size: 10, color: { argb: GREY } };
    styleHeader(ws.addRow(["Tuần lấy", "Mã đơn", "Khách", "Ngày lấy", "Hạn giao", "Ngày giao", "Trễ (ngày)", "Kho lấy", "Tỉnh lấy", "Kho giao", "Tỉnh giao", "Kg"]));
    const late = [...rep.details.lateOrders].sort((a, b) => a.client.localeCompare(b.client) || a.monday.localeCompare(b.monday) || b.days_late - a.days_late || a.order_code.localeCompare(b.order_code));
    for (const o of late) {
      const r = ws.addRow([o.week, o.order_code, o.client, o.pickup_date, o.deadline, o.delivered_date, o.days_late ?? "", o.kho_lay, o.from_province, o.kho_giao, o.to_province, o.weight_kg ?? ""]);
      if ((o.days_late || 0) >= 3) r.getCell(7).font = { bold: true, color: { argb: RED } };
    }
    [9, 16, 22, 12, 12, 12, 10, 34, 14, 34, 14, 8].forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });
  }

  return wb.xlsx.writeBuffer();
}
