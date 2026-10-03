/**
 * Tác tử 3 — GIẢI PHÁP & MỞ RỘNG (Sổ tay cải tiến). Chỉ Manager + SD3.
 *
 * Dùng nguyên `computeSolutionReport` (lib/solutions.js) — cùng số với màn hình
 * Sổ tay / Word / Excel. Phần "tuyến chưa áp dụng" là bản TẠM TÍNH gọn để trả
 * lời "còn tuyến nào nên mở rộng"; khoảng trống chính thức của Sổ tay sẽ do
 * phiên F1 thêm.
 *
 * CHỖ CẮM CHO PHIÊN F1: nếu `computeSolutionReport` trả thêm các khoá
 *   report.reconcile  (đối soát cohort / real-time + cảnh báo ngược hướng)
 *   report.coverage   (độ phủ theo giai đoạn / cả giải pháp)
 *   report.gaps       (khoảng trống mở rộng)
 *   report.phases[i].reconcile / .coverage
 * thì tác tử TỰ chép nguyên vào `data` (không sửa số) — khi đó bỏ khối
 * `tuyenChuaApDung` tạm tính bằng cờ `data.tuyenChuaApDung = undefined`.
 * Đổi tên khoá thì sửa PASSTHROUGH dưới đây, không phải sửa chỗ khác.
 */
import { computeSolutionReport, readSolutions } from "../solutions";
import { vnToday } from "../ltl-dashboard";
import { countedDamage } from "../damage-rules";
import { khoLayOf, khoGiaoOf, DATA_START } from "../trials";
import { getOntimeOutcome } from "../transform-ltl";
import { makeSource, snapshotSource, rillnetSource, round1, round2, vn, dm } from "./common";

const DAY = 86400000;
const PASSTHROUGH_SOLUTION = ["reconcile", "coverage", "gaps"];
const PASSTHROUGH_PHASE = ["reconcile", "coverage"];
// Ngưỡng "đủ volume" gợi ý mở rộng (user duyệt 02/10): ≥ 20 đơn HOẶC ≥ 1 tấn mỗi tuần tại một tỉnh.
export const EXPAND_ORDERS_PER_WEEK = 20;
export const EXPAND_TONS_PER_WEEK = 1;
const MAX_SOLUTIONS_OVERVIEW = 5;

const stat = (s) => (s ? {
  soDon: s.orders, trongLuongTan: round1(s.tons), tyLeOntime: round1(s.ontimePct), donDaDanhGia: s.evaluated,
  soCaBeVo: s.cases, caTren1000Don: round1(s.per1k), tyLeBeVoPct: s.per1k == null ? null : round2(s.per1k / 10),
} : null);
const delta = (d) => (d ? { soDonPct: round1(d.ordersPct), trongLuongPct: round1(d.tonsPct), ontimeDiem: round1(d.ontimePts), soCaBeVoChenh: d.cases, caTren1000DonPct: round1(d.per1kPct) } : null);
const cap = (arr, n) => (arr.length > n ? [...arr.slice(0, n), `…(+${arr.length - n})`] : arr);

function phaseBlock(x) {
  const I = x.impact, T = I.trial;
  const out = {
    giaiDoan: x.phase.label, trangThai: x.phase.status, ngayApDung: x.phase.startDate, ngayKetThuc: x.phase.endDate || "đang chạy",
    phamVi: { khoLay: cap(x.phase.khoLay, 6), soKhoGiao: x.phase.khoGiao.length, khoGiao: cap(x.phase.khoGiao, 8), tinhGiao: x.phase.provinces },
    kyBaseline: `${I.periods.base.from} → ${I.periods.base.to}`, kySau: `${I.periods.post.from} → ${I.periods.post.to}`, soNgaySau: I.postDays,
    baseline: stat(T.base), sau: stat(T.post), thayDoi: delta(T.delta),
    doiChung: I.hasControl ? { baseline: stat(I.control.base), sau: stat(I.control.post), thayDoi: delta(I.control.delta) } : "không có nhóm đối chứng đủ lớn",
    hieuQuaRong: I.hasControl ? { ontimeDiem: round1(I.net.ontimePts), caTren1000DonPctChenhLech: round1(I.net.per1kPct) } : null,
    ketLuanTuDong: I.verdict?.label || null,
    canhBao: (I.warnings || []).map((w) => w.text),
    maDonCoCaBeVoSau: cap((T.post.caseCodes || []).map((c) => c.order_code), 8),
  };
  for (const k of PASSTHROUGH_PHASE) if (x[k]) out[k] = x[k];
  return out;
}

function solutionHeader(sol) {
  return {
    id: sol.id, ten: sol.name, trangThai: sol.status, khach: cap(sol.clients, 8), baseline: `${sol.baseStart} → ${sol.baseEnd}`,
    moTa: sol.description ? String(sol.description).slice(0, 300) : undefined,
    giaiDoan: sol.phases.map((p) => ({ nhan: p.label, trangThai: p.status, batDau: p.startDate, ketThuc: p.endDate || "đang chạy" })),
  };
}

/** True when the order falls in at least one phase scope of the solution AND was picked up while that phase was running. */
function scopeTester(sol) {
  const clients = new Set(sol.clients);
  const phases = sol.phases.map((p) => ({ kl: new Set(p.khoLay), kg: new Set(p.khoGiao), pv: new Set(p.provinces), from: p.startDate || "", to: p.endDate || "9999-12-31" }));
  return (r) => {
    if (!clients.has(r.client_name)) return false;
    const d = String(r.pickup_time || "").slice(0, 10);
    return phases.some((s) => d >= s.from && d <= s.to
      && (!s.kl.size || s.kl.has(khoLayOf(r))) && (!s.kg.size || s.kg.has(khoGiaoOf(r))) && (!s.pv.size || s.pv.has(String(r.to_province_name || "").trim())));
  };
}

const sentence = (arr) => arr.filter(Boolean);
function phaseSummary(b) {
  const bs = b.baseline, ps = b.sau;
  const rate = (s) => `${vn(s.tyLeBeVoPct, 2)}% (${vn(s.soCaBeVo)} ca / ${vn(s.soDon)} đơn)`;
  const ctrl = b.doiChung && typeof b.doiChung === "object" ? ` Nhóm đối chứng (đơn cùng khách nằm NGOÀI phạm vi giai đoạn này): % bể vỡ ${vn(b.doiChung.baseline.tyLeBeVoPct, 2)}% → ${vn(b.doiChung.sau.tyLeBeVoPct, 2)}%, on-time ${vn(b.doiChung.baseline.tyLeOntime, 1)}% → ${vn(b.doiChung.sau.tyLeOntime, 1)}%.` : " Chưa có nhóm đối chứng đủ lớn.";
  return `${b.giaiDoan} (${b.trangThai}, áp dụng từ ${dm(b.ngayApDung)}, ${b.soNgaySau} ngày đo sau): % bể vỡ baseline ${rate(bs)} → sau ${rate(ps)}; on-time ${vn(bs.tyLeOntime, 1)}% → ${vn(ps.tyLeOntime, 1)}% (sau: ${vn(ps.donDaDanhGia)} đơn đã đánh giá).${ctrl} Kết luận tự động của Sổ tay: ${b.ketLuanTuDong ? `"${b.ketLuanTuDong}"` : "chưa đủ dữ liệu để kết luận"}.${b.canhBao.length ? ` Lưu ý: ${b.canhBao.join(" ")}` : ""}`;
}

/**
 * Tuyến/tỉnh giao CHƯA thuộc giải pháp nào trong Sổ tay, tính từ kho nguồn của giải pháp đang hỏi — tạm tính.
 * Mẫu số/giai đoạn: từ ngày áp dụng sớm nhất của giải pháp đến hôm nay.
 */
export function expansionCandidates(base, sol, allSolutions, today) {
  const start = sol.phases.map((p) => p.startDate).filter(Boolean).sort()[0] || DATA_START;
  const from = start < DATA_START ? DATA_START : start;
  const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(from)) / DAY) + 1);
  const weeks = days / 7;
  const sourceKho = new Set(sol.phases.flatMap((p) => p.khoLay));
  const clients = new Set(sol.clients);
  const covered = allSolutions.filter((s) => s.status !== "Đã hủy").map(scopeTester);
  const caseByCode = new Map();
  for (const c of countedDamage(base.rawDamageCauses || [])) { const k = String(c.order_code || "").trim(); caseByCode.set(k, (caseByCode.get(k) || 0) + 1); }
  const prov = new Map();
  let total = { orders: 0, grams: 0 };
  for (const r of base.ltlRows) {
    if (!clients.has(r.client_name)) continue;
    const d = String(r.pickup_time || "").slice(0, 10);
    if (!d || d < from || d > today) continue;
    if (sourceKho.size && !sourceKho.has(khoLayOf(r))) continue;
    total.orders++; total.grams += parseFloat(r.weight) || 0;
    if (covered.some((t) => t(r))) continue;
    const p = String(r.to_province_name || "").trim() || "(không rõ)";
    const a = prov.get(p) || { orders: 0, grams: 0, ontime: 0, late: 0, cases: 0, kho: {} };
    a.orders++; a.grams += parseFloat(r.weight) || 0;
    const o = getOntimeOutcome(r); if (o === "ontime") a.ontime++; else if (o === "late") a.late++;
    a.cases += caseByCode.get(String(r.order_code || "").trim()) || 0;
    const kg = khoGiaoOf(r) || "(không rõ)"; a.kho[kg] = (a.kho[kg] || 0) + 1;
    prov.set(p, a);
  }
  // Danh sách kho GHN (tab Warehouses): số kho giao hàng nặng chính thức của từng tỉnh — tỉnh chưa có kho thì chưa mở tuyến được.
  const heavyByProvince = {};
  for (const w of base.rawWarehouses || []) if (/giao hàng nặng/i.test(w.loai_kho || "") && w.province) heavyByProvince[w.province] = (heavyByProvince[w.province] || 0) + 1;
  const useKho = !!base.rawWarehouses?.length;
  const rows = [...prov.entries()].map(([tinh, a]) => {
    const perWeek = a.orders / weeks, tonsPerWeek = a.grams / 1e6 / weeks;
    return {
      tinhGiao: tinh, soDon: a.orders, trongLuongTan: round1(a.grams / 1e6), donMoiTuan: round1(perWeek), tanMoiTuan: round2(tonsPerWeek),
      duVolume: perWeek >= EXPAND_ORDERS_PER_WEEK || tonsPerWeek >= EXPAND_TONS_PER_WEEK,
      tyLeOntime: a.ontime + a.late ? round1((a.ontime / (a.ontime + a.late)) * 100) : null,
      soCaBeVoTruocDay: a.cases,
      ...(useKho ? { soKhoGiaoHangNangTrongDanhSachGHN: heavyByProvince[tinh] || 0 } : {}),
      khoGiaoNhieuNhat: Object.entries(a.kho).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, n]) => `${k} (${n} đơn)`),
    };
  }).sort((a, b) => Number(b.duVolume) - Number(a.duVolume) || b.soCaBeVoTruocDay - a.soCaBeVoTruocDay || b.soDon - a.soDon);
  return {
    dinhNghia: `Đơn của khách giải pháp "${sol.name}", lấy từ kho nguồn của giải pháp (${sourceKho.size ? [...sourceKho].slice(0, 3).join("; ") : "mọi kho"}), từ ${from} đến ${today}, KHÔNG nằm trong phạm vi của giải pháp nào trong Sổ tay. Bản tạm tính — chưa phải 'khoảng trống' chính thức.`,
    nguongDuVolume: `≥ ${EXPAND_ORDERS_PER_WEEK} đơn HOẶC ≥ ${EXPAND_TONS_PER_WEEK} tấn mỗi tuần tại một tỉnh giao`,
    soTuan: round1(weeks),
    tongDonTuKhoNguon: total.orders, tongTanTuKhoNguon: round1(total.grams / 1e6),
    tinhChuaApDung: rows.slice(0, 8),
    luuY: "Dữ liệu không có cờ đơn thật sự đi qua giải pháp — 'chưa áp dụng' nghĩa là đơn nằm ngoài PHẠM VI khai báo của các giải pháp.",
  };
}

// "2026-09-29 18:19" (giờ VN) → ISO
function warehouseListSource(base) {
  const v = (base.rawWarehouses || []).map((w) => String(w.cap_nhat || "")).filter(Boolean).sort().pop();
  const iso = v && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v) ? new Date(`${v.replace(" ", "T")}:00+07:00`).toISOString() : null;
  return makeSource({ id: "danh-sach-kho-ghn", kind: "kho", label: "Danh sách kho GHN", scope: "kho giao hàng nặng theo tỉnh (tab Warehouses)", asOf: iso });
}

/** @returns {Promise<{agent,data,sources,steps}>} */
export async function runSolutionsAgent({ base, ctx, flags = {}, solutionsData }) {
  const steps = [];
  const today = vnToday();
  const { solutions } = solutionsData || (await readSolutions().catch(() => ({ solutions: [] })));
  const live = solutions.filter((s) => s.status !== "Đã hủy" || ctx.solution === s.id);
  steps.push(`Đọc Sổ tay cải tiến: ${solutions.length} giải pháp`);
  const sources = [];
  const data = { homNay: today, soGiaiPhap: solutions.length };
  if (!solutions.length) { data.ghiChu = "Sổ tay chưa có giải pháp nào."; return { agent: "solutions", data, sources: [], steps }; }

  const chosen = ctx.solution ? solutions.find((s) => s.id === ctx.solution) : null;
  const asOfOf = (s) => {
    const v = [s.updatedAt, ...s.phases.map((p) => p.updatedAt)].filter(Boolean).sort().pop();
    return v ? new Date(v).toISOString() : null;
  };
  const solSource = (s, note = "") => makeSource({ id: `so-tay:${s.id}`, kind: "so-tay", label: `Sổ tay ${s.id}`, scope: s.name, asOf: asOfOf(s), note });

  if (chosen) {
    const report = computeSolutionReport(base, chosen, today);
    data.giaiPhap = solutionHeader(chosen);
    data.baoCao = {
      kyBaseline: `${report.baseline.from} → ${report.baseline.to}`,
      cachDoLuong: "Hiệu quả đo theo đơn lấy trong từng kỳ; ca bể vỡ gắn với ĐƠN (ca của đơn lấy trong kỳ). Ca/1.000 đơn ÷ 10 = % bể vỡ. Hiệu quả ròng = thay đổi của phạm vi trừ thay đổi của nhóm đối chứng.",
      giaiDoan: report.phases.map(phaseBlock),
      canhBaoTheoDoi: report.alerts.map((a) => a.text),
    };
    for (const k of PASSTHROUGH_SOLUTION) if (report[k]) data.baoCao[k] = report[k];
    data.tomTatSanSang = sentence([
      `Giải pháp ${chosen.id} "${chosen.name}" (${chosen.status}); baseline ${dm(report.baseline.from)} → ${dm(report.baseline.to)}.`,
      ...data.baoCao.giaiDoan.map(phaseSummary),
      data.baoCao.canhBaoTheoDoi.length ? `Cảnh báo theo dõi sau thành công: ${data.baoCao.canhBaoTheoDoi.join("; ")}.` : null,
    ]);
    steps.push(`Tính báo cáo giải pháp ${chosen.id} (${report.phases.length} giai đoạn) bằng computeSolutionReport`);
    sources.push(solSource(chosen), snapshotSource(base, `đơn LTL của khách giải pháp ${chosen.id}`), rillnetSource(base, "ca bể vỡ gắn với đơn của giải pháp"));
    if (flags.expand || !report.coverage) {
      data.tuyenChuaApDung = expansionCandidates(base, chosen, live, today);
      steps.push(`Tìm tỉnh giao chưa thuộc giải pháp nào: ${data.tuyenChuaApDung.tinhChuaApDung.filter((r) => r.duVolume).length} tỉnh đủ volume`);
      if (base.rawWarehouses?.length) sources.push(warehouseListSource(base));
      const ex = data.tuyenChuaApDung, ok = ex.tinhChuaApDung.filter((t) => t.duVolume);
      const line = (t) => `${t.tinhGiao} (${vn(t.donMoiTuan, 1)} đơn/tuần, ${vn(t.tanMoiTuan, 2)} tấn/tuần, ${t.soCaBeVoTruocDay} ca bể trước đây${t.soKhoGiaoHangNangTrongDanhSachGHN != null ? `, ${t.soKhoGiaoHangNangTrongDanhSachGHN} kho giao hàng nặng trong danh sách kho GHN` : ""})`;
      data.tomTatSanSang.push(ok.length
        ? `Tỉnh giao NGOÀI phạm vi mọi giải pháp và đủ ngưỡng gợi ý mở rộng (${ex.nguongDuVolume}; tạm tính, ${vn(ex.soTuan, 1)} tuần dữ liệu): ${ok.map(line).join("; ")}.`
        : `Hiện KHÔNG có tỉnh giao nào ngoài phạm vi mọi giải pháp đạt ngưỡng gợi ý mở rộng (${ex.nguongDuVolume}). Gần ngưỡng nhất: ${ex.tinhChuaApDung.slice(0, 3).map(line).join("; ") || "(không có)"}.`);
    }
  } else {
    const list = live.filter((s) => s.status !== "Đã hủy");
    data.giaiPhap = list.map(solutionHeader);
    if (list.length <= MAX_SOLUTIONS_OVERVIEW) {
      data.tomTatKetQua = list.map((s) => {
        const rep = computeSolutionReport(base, s, today);
        return { id: s.id, ten: s.name, giaiDoan: rep.comparison.map((c) => ({ nhan: c.label, trangThai: c.status, soDonSau: c.post.orders, tyLeOntimeSau: round1(c.post.ontimePct), tyLeBeVoSauPct: c.post.per1k == null ? null : round2(c.post.per1k / 10), tyLeBeVoBaselinePct: c.base.per1k == null ? null : round2(c.base.per1k / 10), ketLuanTuDong: c.verdict })) };
      });
    }
    steps.push(`Tóm tắt kết quả ${list.length} giải pháp`);
    sources.push(...list.map((s) => solSource(s)), snapshotSource(base, "đơn LTL của khách các giải pháp"), rillnetSource(base, "ca bể vỡ gắn với đơn của giải pháp"));
  }

  return { agent: "solutions", data, sources, steps };
}
