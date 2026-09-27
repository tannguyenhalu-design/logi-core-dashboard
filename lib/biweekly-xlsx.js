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
function metricTable(ws, section, countTitle, rateTitle, cols, rows, delta, higherIsBetter) {
  const n = cols.length;
  const d = delta ? 1 : 0;
  const cw = n + d;
  const h1 = ws.addRow([section, countTitle, ...Array(cw - 1).fill(""), rateTitle, ...Array(cw - 1).fill("")]);
  ws.mergeCells(h1.number, 2, h1.number, 1 + cw);
  ws.mergeCells(h1.number, 2 + cw, h1.number, 1 + 2 * cw);
  styleHeader(h1);
  const labels = cols.map((c) => (c.mature === false ? `${c.label}*` : c.label));
  const dLabel = delta ? [`± vs ${cols[delta[0]].label}`] : [];
  styleHeader(ws.addRow(["Khách", ...labels, ...dLabel, ...labels, ...dLabel.map((l) => l.replace("±", "± điểm"))]));
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
    const row = ws.addRow([r.name, ...counts, ...cDelta, ...rates, ...rDelta]);
    row.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = ALL_BORDERS;
      if (i >= 2) c.alignment = { horizontal: "right" };
      if (i >= 2 && i <= 1 + n) c.numFmt = "#,##0";
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
  const asOf = `Báo cáo ${rep.typeLabel.toLowerCase()} · ${rep.periodLabel} · dữ liệu tính đến ${vnTime(rep.dataAsOf)} · ${version}`;
  const unripe = "* Tuần/tháng chưa chốt dữ liệu: còn đơn đang giao / ca bể vỡ nhập muộn — số có thể còn thay đổi.";
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
      "Khác = khách Điện Máy ngoài danh sách, chia B2B/B2C theo is_B2C.",
      unripe,
    ], w);
    setWidths(ws, 24, 11, w);
  }

  // ② Bể vỡ
  {
    const ws = wb.addWorksheet("Bể vỡ", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    const w = width(rep.damage);
    title(ws, "Bể vỡ và đền bù", asOf, w);
    metricTable(ws, "Bể vỡ", "# case bể và đền (ghi nhận theo ngày phát hiện)", "% bể đền / GTC", rep.damage.cols, rep.damage.rows, rep.damage.delta, false);
    footnotes(ws, [
      "Case bể và đền = ca trong \"Báo cáo bể vỡ\" của Rillnet (CS tick 💰 · đơn cũ bù tay · đã chốt tiền), gồm cả hư ngoại quan lẫn sản phẩm bên trong.",
      "GTC = đơn giao thành công trong tuần (theo ngày giao).",
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
    footnotes(ws, ["# đơn FD = đơn phát sinh hoàn (deliver_type = return), theo tuần lấy hàng; % FD = FD / # đơn LTC.", unripe], w);
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
    for (const sec of ["Ontime LTL", "Bể vỡ và đền bù", "Hàng hoàn", "FTL", "Next steps"]) {
      ws.addRow([]);
      styleHeader(ws.addRow([sec]));
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
    ws.addRow(["Ca bể vỡ trong các tuần của kỳ (theo ngày phát hiện)"]).font = { bold: true, size: 12 };
    styleHeader(ws.addRow(["Tuần", "Mã đơn", "Khách", "Ngày phát hiện", "Chặng nghi vấn", "Kho phát hiện", "Đã chốt đền bù", "Truy thu", "Tiền truy thu"]));
    for (const d of rep.details.damageCases) {
      const r = ws.addRow([d.week, d.order_code, d.client, d.case_date, d.leg, d.warehouse, d.compensated ? "Có" : "",
        d.truy_thu === "co" ? "Có" : d.truy_thu === "khong" ? "Không" : "Chờ chốt", d.truy_thu_amount || ""]);
      r.getCell(9).numFmt = "#,##0";
    }
    ws.addRow([]);
    ws.addRow(["Đơn hàng hoàn (FD) trong các tuần của kỳ"]).font = { bold: true, size: 12 };
    styleHeader(ws.addRow(["Tuần lấy", "Mã đơn", "Khách", "Ngày lấy", "Trạng thái"]));
    for (const f of rep.details.fdOrders) ws.addRow([f.week, f.order_code, f.client, f.pickup_time, f.status]);
    [8, 16, 22, 14, 26, 38, 14, 12, 14].forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });
  }

  return wb.xlsx.writeBuffer();
}
