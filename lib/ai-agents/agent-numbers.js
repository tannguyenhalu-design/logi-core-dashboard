/**
 * Tác tử 1 — SỐ LIỆU (đơn, tấn, on-time, tuyến, đơn treo / chờ lấy).
 *
 * Chạy trên cùng snapshot với Dashboard: mọi số lấy từ lib/ltl-dashboard.js
 * (computeDashboard) hoặc lib/ai-agent-tools.js — AI không tự tính.
 * Trả { agent, data, sources, steps }.
 */
import { computeDashboard, isPendingPickup } from "../ltl-dashboard";
import { transformLTL } from "../transform-ltl";
import { lookupOrders, compareRoutes } from "../ai-agent-tools";
import { tan, pctOf, round1, round2, vn, vnTime, monthsLabel, snapshotSource } from "./common";

const MAX_PER_PROJECT = 4;

/** Phần "tổng quan" — giống hệt phần ngữ cảnh cũ của /api/ai-chat (số tổng, theo tháng, so cùng kỳ, đơn treo…). */
export function overviewBlock(body, base) {
  const l = body.ltl;
  const pc = l.periodComparison;
  const pickupDates = base.ltlRows.map((r) => String(r.pickup_time || "").slice(0, 10)).filter(Boolean).sort();
  return {
    phamViDuLieu: {
      nguon: "Snapshot LTL Điện Máy (raw_ontime của GHN) — cùng nguồn và cùng cách tính với Dashboard",
      capNhatLuc: vnTime(body.dataAsOf),
      donLayHangTu: pickupDates[0] || null,
      donLayHangDen: pickupDates[pickupDates.length - 1] || null,
      cachTinh: "Tổng đơn tính theo ngày lấy hàng (không gồm đơn chưa lấy). On-time = đơn giao đúng hạn / đơn đã đánh giá (đã giao, hoặc chưa giao nhưng đã trễ).",
    },
    tongQuanToanBo: {
      tongDon: l.totalOrders,
      trongLuongTan: tan(l.totalWeight * 1000),
      tyLeOntime: l.evalCount > 0 ? round1(l.ontimePct) : null,
      donDaDanhGia: l.evalCount,
      donLate: l.lateCount,
      caBeVo: l.totalBroken,
    },
    theoThang: Object.keys(l.ordersByMonth || {}).map((m) => {
      const o = l.ontimeByMonth?.[m] || { ontime: 0, late: 0 };
      return { thang: `T${m}`, soDon: l.ordersByMonth[m], trongLuongTan: tan((l.weightByMonth?.[m] || 0) * 1000), tyLeOntime: pctOf(o.ontime, o.ontime + o.late), donLate: o.late };
    }),
    soSanhCungKy: pc?.overall ? {
      kyNay: pc.currentRangeLabel,
      kyTruoc: pc.previousRangeLabel,
      soDon: [pc.overall.prev.orders, pc.overall.cur.orders],
      tyLeOntime: [pc.overall.prev.ontimePct, pc.overall.cur.ontimePct],
      donLate: [pc.overall.prev.lateCount, pc.overall.cur.lateCount],
      caBeVo: [pc.overall.prev.damageCount, pc.overall.cur.damageCount],
      thayDoiDaTinhSan: {
        soDonPct: pc.overall.ordersDeltaPct,
        tyLeOntimeDiem: pc.overall.ontimeDeltaPoints,
        donLate: pc.overall.cur.lateCount - pc.overall.prev.lateCount,
        caBeVo: pc.overall.cur.damageCount - pc.overall.prev.damageCount,
      },
      ghiChu: "Mỗi cặp là [kỳ trước, kỳ này]; % / điểm thay đổi lấy ở thayDoiDaTinhSan. Số đơn/on-time tăng là tốt; đơn late và ca bể vỡ GIẢM là TỐT.",
    } : null,
    onTimeGiamManh: body.anomalies?.items?.length
      ? { soVoi: body.anomalies.compareLabel, nguong: "giảm ≥ 10 điểm, mỗi kỳ ≥ 5 đơn đã đánh giá", duAn: body.anomalies.items }
      : "Không có dự án nào giảm on-time ≥ 10 điểm so với kỳ trước",
    donTreoQuaHan: body.stuck ? {
      dinhNghia: "Đã lấy hàng, chưa giao/hoàn/hủy, đã quá ngày hạn giao — tính đến hôm nay, không phụ thuộc tháng",
      tongSo: body.stuck.count,
      theoSoNgayQuaHan: body.stuck.byAge,
      duAnNhieuNhat: body.stuck.topClients,
    } : null,
    donChoLayHang: body.pendingPickup ? { tongSo: body.pendingPickup.count, theoTrangThai: body.pendingPickup.byStatus, ghiChu: "Chưa có ngày lấy hàng nên không tính vào tổng đơn" } : null,
    theoDuAn: Object.values(l.projectSummaries || {})
      .sort((a, b) => b.totalOrders - a.totalOrders)
      .map((p) => ({ duAn: p.name, soDon: p.totalOrders, trongLuongTan: tan(p.totalWeight * 1000), tyLeOntime: pctOf(p.ontimeCount, p.evalCount), donLate: p.lateCount, caBeVo: p.damageCount || 0 })),
    tuyenNhieuDonNhat: (l.routeStats || []).slice(0, 8).map((r) => ({ tuyen: `${r.from} → ${r.to}`, soDon: r.orders })),
    khoCanhBao: (l.warehouseAlerts || []).slice(0, 5).map((w) => ({ kho: w.warehouse, donLate: w.late, caBeVo: w.broken })),
  };
}

const kpiOf = (k) => ({
  tongDon: k.totalOrders,
  trongLuongTan: tan(k.totalWeight * 1000),
  tyLeOntime: k.ontimePct == null ? null : round1(k.ontimePct),
  donLate: k.lateCount,
  caBeVo: k.totalBroken,
  // ca bể vỡ ÷ tổng đơn × 100 (cùng cách Dashboard / Sổ tay tính % bể vỡ)
  tyLeBeVoPct: k.totalOrders > 0 ? round2((k.totalBroken / k.totalOrders) * 100) : null,
});
const kpiLine = (label, k) => `${label}: ${vn(k.tongDon)} đơn, ${vn(k.trongLuongTan, 1)} tấn, on-time ${k.tyLeOntime == null ? "chưa có" : `${vn(k.tyLeOntime, 1)}%`}, ${vn(k.donLate)} đơn late, ${vn(k.caBeVo)} ca bể vỡ${k.tyLeBeVoPct == null ? "" : ` (${vn(k.tyLeBeVoPct, 2)}% trên tổng đơn)`}.`;

/**
 * @param args.ctx      ngữ cảnh đã hiểu { projects, months, provinces }
 * @param args.params   tham số computeDashboard của người hỏi (đã khoá theo role)
 * @param args.flags    { routes: bool, weekly: bool }
 */
export function runNumbersAgent({ base, body, params, ctx, message, codes, clientProject, flags = {} }) {
  const steps = [`Đọc Snapshot LTL (cập nhật ${vnTime(body.dataAsOf) || "?"})`];
  const overview = overviewBlock(body, base);
  const data = {}; // khối trả lời đúng câu hỏi đứng TRƯỚC; tổng quan ghép vào cuối (mô hình nhỏ hay chỉ đọc đầu JSON)
  const summary = [];
  const months = ctx.months;
  const projects = ctx.projects;
  const scopeProjects = projects.length ? projects : params.projects;
  const scopeText = `${monthsLabel(months)} · ${projects.length ? projects.join(", ") : "tất cả dự án"}`;

  // Tra mã đơn
  if (codes?.length) {
    let found = lookupOrders(base, codes);
    if (clientProject) found = found.map((o) => (o.timThay && o.duAn !== clientProject ? { maDon: o.maDon, timThay: false, ghiChu: "Không thuộc dự án của bạn" } : o));
    data.traCuuDon = found;
    steps.push(`Tra ${codes.length} mã đơn: ${found.filter((o) => o.timThay).length} mã có trong dữ liệu`);
  }

  // Số đúng theo tháng / dự án nêu trong câu — cùng phép tính Dashboard chạy khi chọn bộ lọc đó.
  if (months || (projects.length && !clientProject)) {
    const k = computeDashboard(base, { ...params, months, projects: scopeProjects, kpiOnly: true });
    data.soLieuDungTheoCauHoi = { phamVi: scopeText, ...kpiOf(k) };
    summary.push(kpiLine(scopeText, data.soLieuDungTheoCauHoi));
    if (projects.length) {
      data.soLieuDungTheoCauHoi.onTimeTungDuAn = Object.fromEntries(
        Object.entries(k.ontimeByProject || {}).filter(([n]) => projects.includes(n))
          .map(([n, o]) => [n, { tyLeOntime: pctOf(o.ontime, o.ontime + o.late), donLate: o.late, donDaDanhGia: o.ontime + o.late }]),
      );
    }
    steps.push(`Tính số liệu ${scopeText} bằng đúng bộ lọc của Dashboard`);

    // "So với LG", "PSD vs Aqua": số riêng từng dự án (để AI không phải tự chia tách số gộp).
    if (projects.length >= 2 && !clientProject) {
      data.soLieuTungDuAn = {
        phamVi: `${monthsLabel(months)} — mỗi dự án tính riêng`,
        duAn: projects.slice(0, MAX_PER_PROJECT).map((p) => ({
          duAn: p, ...kpiOf(computeDashboard(base, { ...params, months, projects: [p], kpiOnly: true })),
        })),
      };
      data.soLieuTungDuAn.duAn.forEach((d) => summary.push(kpiLine(`${d.duAn} · ${monthsLabel(months)}`, d)));
      steps.push(`Tính riêng từng dự án (${data.soLieuTungDuAn.duAn.length} dự án) để so sánh`);
    }
  }

  // Tuần này vs tuần trước trong tháng hiện tại ("tuần này giảm do khách nào").
  if (flags.weekly) {
    const curMonth = new Date(Date.now() + 7 * 3600 * 1000).getUTCMonth() + 1;
    const weekly = transformLTL(base.ltlRows.filter((r) => !isPendingPickup(r)), { months: [curMonth], filterMode: "pickup", projects: params.projects });
    const weeks = Object.keys(weekly.ordersByMonth || {}).map(Number).sort((a, b) => a - b);
    if (weeks.length >= 2) {
      const [wPrev, wLast] = weeks.slice(-2);
      const movers = Object.entries(weekly.ordersByProjectAndWeek || {})
        .map(([name, byWeek]) => ({ duAn: name, tuanTruoc: byWeek[wPrev] || 0, tuanNay: byWeek[wLast] || 0, chenhLech: (byWeek[wLast] || 0) - (byWeek[wPrev] || 0) }))
        .filter((m) => m.chenhLech !== 0);
      data.soSanhTuanTrongThang = {
        thang: `T${curMonth}`, tuanTruoc: wPrev, tuanGanNhat: wLast,
        soDonTheoTuan: weekly.ordersByMonth,
        giamNhieuNhat: movers.filter((m) => m.chenhLech < 0).sort((a, b) => a.chenhLech - b.chenhLech).slice(0, 5),
        tangNhieuNhat: movers.filter((m) => m.chenhLech > 0).sort((a, b) => b.chenhLech - a.chenhLech).slice(0, 5),
      };
      steps.push(`So tuần ${wLast} với tuần ${wPrev} của T${curMonth}`);
    }
  }

  // Tuyến giữa các tỉnh nêu trong câu.
  if (ctx.provinces.length && flags.routes) {
    data.soSanhTuyen = {
      phamVi: `${scopeText} · tỉnh: ${ctx.provinces.join(", ")}`,
      tuyen: compareRoutes(base, { provinces: ctx.provinces, months, projects: scopeProjects }),
    };
    steps.push(`So sánh tuyến quanh ${ctx.provinces.join(", ")}`);
  }

  // Hỏi theo dự án cụ thể → bỏ bảng "theo dự án" 26 dòng (tác tử đã tính riêng), cho nhẹ prompt.
  if (projects.length) delete overview.theoDuAn;
  if (summary.length) data.tomTatSanSang = summary;
  Object.assign(data, overview);
  const sources = [snapshotSource(base, `đơn lấy từ 01/07/2026 · ${scopeText}`)];
  return { agent: "numbers", data, sources, steps };
}
