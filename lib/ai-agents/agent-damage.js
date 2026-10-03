/**
 * Tác tử 2 — HƯ HỎNG & RỦI RO (ca Rillnet, chặng nghi vấn, ca còn mở, tiền đền).
 *
 * Nguồn: tab raw_damage_causes (Rillnet "Báo cáo bể vỡ", chỉ ca được tính —
 * lib/damage-rules.js) NỐI với đơn LTL Điện Máy theo mã đơn, đúng như
 * lib/ltl-dashboard.js làm (khách = khách của ĐƠN; ca không có đơn Điện Máy
 * thì bỏ). Tháng = tháng GHI NHẬN ca (case_date) — cùng cách tab Hư hỏng của
 * Dashboard lọc. Tiền đền = số tiền CS điền mới nhất theo mã đơn (comp_amount,
 * Kế hoạch E phiên 1); truy thu là thu lại từ nhân viên → KHÔNG phải tiền đền
 * cho khách, KHÔNG trừ vào thiệt hại.
 */
import { parseDate } from "../transform-ltl";
import { vnToday } from "../ltl-dashboard";
import { countedDamage, isCompensated, truyThuOf, truyThuAmount, compAmount } from "../damage-rules";
import { monthsLabel, rillnetSource, snapshotSource, vn } from "./common";

const DAY = 86400000;
const money = (n) => `${Math.round(n || 0).toLocaleString("vi-VN")} đ`;
// Ca đã xong = "Đã chốt — không truy thu" hoặc "Hoàn tất kết luận QLRR"; mọi trạng thái khác còn mở (user chốt 29/09, Kế hoạch E).
const DONE_STATUSES = new Set(["đã chốt — không truy thu", "hoàn tất kết luận qlrr"]);
export const isOpenCase = (d) => !DONE_STATUSES.has(String(d.status || "").trim().toLowerCase());

function khauOf(status) {
  const s = String(status || "");
  if (/chưa tiếp nhận/i.test(s)) return "Chưa tiếp nhận";
  if (/\bCS\b/.test(s)) return "CS";
  if (/\bOM\b/.test(s)) return "OM";
  if (/KTC|KCT/.test(s)) return "KTC/KCT";
  if (/ảnh/i.test(s)) return "Chờ ảnh";
  return s || "(trống)";
}

// Same predicate transform-ltl.js passProjectDmg uses (so a project filter selects the same cases as on the dashboard).
function passProject(clientName, projects) {
  if (!projects?.length) return true;
  const dmgName = String(clientName || "").trim().toLowerCase();
  if (!dmgName) return false;
  return projects.some((p) => {
    const proj = String(p || "").trim().toLowerCase();
    return proj === dmgName || proj.includes(dmgName) || dmgName.includes(proj);
  });
}

let memo = { builtAt: null, byCode: null };
function orderMap(base) {
  if (memo.builtAt === base.builtAt && memo.byCode) return memo.byCode;
  const m = new Map();
  for (const r of base.ltlRows) {
    const c = String(r.order_code || "").trim();
    if (c && !m.has(c)) m.set(c, r);
  }
  memo = { builtAt: base.builtAt, byCode: m };
  return m;
}

const topN = (map, n, keyName) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ [keyName]: k, soCa: v }));
const bump = (o, k, by = 1) => { o[k] = (o[k] || 0) + by; };

/** Cases joined to their LTL order, narrowed by the question's scope. Exported for tests. */
export function scopedCases(base, { projects, months, provinces }) {
  const byCode = orderMap(base);
  const out = [];
  for (const d of countedDamage(base.rawDamageCauses || [])) {
    const o = byCode.get(String(d.order_code || "").trim());
    if (!o) continue; // not a real Điện Máy LTL order → not on this dashboard
    if (!passProject(o.client_name, projects)) continue;
    const cd = parseDate(d.case_date);
    if (months?.length && !(cd && months.includes(cd.getMonth() + 1))) continue;
    if (provinces?.length) {
      const f = o.from_province_name, t = o.to_province_name;
      const ok = provinces.length >= 2 ? provinces.includes(f) && provinces.includes(t) : f === provinces[0] || t === provinces[0];
      if (!ok) continue;
    }
    out.push({ ...d, client_name: o.client_name, _caseDate: cd, _from: o.from_province_name, _to: o.to_province_name });
  }
  return out;
}

export function runDamageAgent({ base, ctx, flags = {} }) {
  const { projects, months, provinces } = ctx;
  const scoped = scopedCases(base, { projects, months, provinces: flags.routes ? provinces : [] });
  const today = Date.parse(vnToday());
  const steps = [];
  const raw = countedDamage(base.rawDamageCauses || []).length;
  const rn = rillnetSource(base);
  steps.push(`Đọc ${raw} ca Báo cáo bể vỡ Rillnet (đồng bộ ${rn.asOfLabel || "?"})`);
  const scopeText = `${monthsLabel(months)} (theo tháng ghi nhận ca) · ${projects.length ? projects.join(", ") : "tất cả dự án"}${flags.routes && provinces.length ? ` · tỉnh: ${provinces.join(", ")}` : ""}`;
  steps.push(`Nối với đơn LTL Điện Máy → ${scoped.length} ca trong phạm vi ${scopeText}`);

  const legs = {}, clients = {}, warehouses = {}, routes = {}, routeLeg = {}, statusC = {};
  let compensated = 0, withMoney = 0, moneyTotal = 0, moneyUnknownSource = 0;
  const bySource = {};
  const tt = { co: 0, coTien: 0, khong: 0, cho: 0 };
  const open = [];
  const moneyByClient = {}, moneyByRoute = {};
  for (const d of scoped) {
    const leg = String(d.suspected_leg || "Không rõ").trim() || "Không rõ";
    bump(legs, leg);
    bump(clients, d.client_name || "Không rõ");
    bump(warehouses, String(d.detected_at_warehouse || "(không rõ)").trim() || "(không rõ)");
    const route = String(d.suspected_route || "").trim();
    if (route) { bump(routes, route); (routeLeg[route] = routeLeg[route] || {}); bump(routeLeg[route], leg); }
    if (isCompensated(d)) compensated++;
    const amt = compAmount(d);
    if (amt > 0) {
      withMoney++; moneyTotal += amt;
      const src = String(d.comp_amount_source || "").trim() || "không rõ";
      bySource[src] = bySource[src] || { soCa: 0, tong: 0 };
      bySource[src].soCa++; bySource[src].tong += amt;
      bump(moneyByClient, d.client_name || "Không rõ", amt);
      if (route) bump(moneyByRoute, route, amt);
    }
    const ttk = truyThuOf(d);
    tt[ttk] = (tt[ttk] || 0) + 1;
    if (ttk === "co") tt.coTien += truyThuAmount(d);
    if (isOpenCase(d)) {
      bump(statusC, String(d.status || "(trống)").trim() || "(trống)");
      const days = d._caseDate ? Math.max(0, Math.round((today - d._caseDate.getTime()) / DAY)) : null;
      open.push({ maDon: String(d.order_code).trim(), khach: d.client_name, trangThai: d.status, khau: khauOf(d.status), soNgayTon: days, changNghiVan: d.suspected_leg || null });
    }
  }
  open.sort((a, b) => (b.soNgayTon ?? -1) - (a.soNgayTon ?? -1));
  const openByKhau = {};
  for (const c of open) bump(openByKhau, c.khau);

  // Tái phát: 28 ngày gần nhất so với 28 ngày trước đó (theo ngày ghi nhận ca) — chỉ trong phạm vi khách/tháng đã chọn.
  const recent = {}, prior = {}, recentRoute = {}, priorRoute = {};
  for (const d of scoped) {
    if (!d._caseDate) continue;
    const age = Math.round((today - d._caseDate.getTime()) / DAY);
    const route = String(d.suspected_route || "").trim();
    if (age >= 0 && age < 28) { bump(recent, d.client_name); if (route) bump(recentRoute, route); }
    else if (age >= 28 && age < 56) { bump(prior, d.client_name); if (route) bump(priorRoute, route); }
  }
  const recur = (rec, pri, key) => Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ [key]: k, ca28NgayGan: v, ca28NgayTruoc: pri[k] || 0 }));

  const data = {
    phamVi: scopeText,
    cachTinh: "Ca hư hỏng = danh sách Báo cáo bể vỡ của Rillnet, nối với đơn LTL Điện Máy theo mã đơn (khách tính theo đơn). Theo tháng = tháng ghi nhận ca. Rillnet ghi nhận ca sau ngày lấy hàng vài ngày (trung vị ~5 ngày) nên ca của đơn lấy gần đây có thể còn chưa đủ.",
    tongSoCa: scoped.length,
    theoChangNghiVan: Object.entries(legs).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count, pct: scoped.length ? Math.round((count / scoped.length) * 100) : 0 })),
    theoKhachHang: Object.entries(clients).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count, pct: scoped.length ? Math.round((count / scoped.length) * 100) : 0 })),
    theoKhoPhatHien: topN(warehouses, 8, "kho"),
    tuyenNhieuCa: Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tuyen, soCa]) => ({
      tuyen, soCa, changNghiVanChinh: Object.entries(routeLeg[tuyen]).sort((a, b) => b[1] - a[1])[0][0],
    })),
    caConMo: {
      dinhNghia: "Mọi trạng thái TRỪ 'Đã chốt — không truy thu' và 'Hoàn tất kết luận QLRR'; số ngày tồn tính từ ngày ghi nhận ca đến hôm nay",
      tongSo: open.length,
      theoTrangThai: Object.entries(statusC).sort((a, b) => b[1] - a[1]).map(([trangThai, soCa]) => ({ trangThai, soCa })),
      theoKhau: Object.entries(openByKhau).sort((a, b) => b[1] - a[1]).map(([khau, soCa]) => ({ khau, soCa })),
      tonLauNhat: open.slice(0, 5),
    },
    tienDenChoKhach: {
      dinhNghia: "Số tiền CS điền theo từng mã đơn khi đánh dấu có đền bù (số dự kiến — sau khi khách QC lại, CS nhập lại số đúng nên luôn là số MỚI NHẤT). Nguồn 'chot' = Ops đã chốt tiền; 'du_kien' = số CS điền dự kiến; 'cs_tick' = số CS điền lúc tick.",
      soCaDaChotDenBu: compensated,
      soCaCoSoTien: withMoney,
      tongTien: money(moneyTotal),
      theoNguonSo: Object.entries(bySource).map(([nguon, v]) => ({ nguon, soCa: v.soCa, tongTien: money(v.tong) })),
      theoKhach: Object.entries(moneyByClient).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([khach, t]) => ({ khach, tongTien: money(t) })),
      theoTuyen: Object.entries(moneyByRoute).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tuyen, t]) => ({ tuyen, tongTien: money(t) })),
      ghiChu: withMoney < compensated ? `Mới ${withMoney}/${compensated} ca đã chốt đền bù có số tiền trên Rillnet` : undefined,
    },
    truyThu: {
      ghiChu: "Truy thu = thu lại từ nhân viên GHN làm sai — KHÔNG phải tiền đền cho khách và KHÔNG trừ vào thiệt hại; chỉ để tham khảo.",
      coTruyThu: tt.co, tongTienTruyThu: money(tt.coTien), khongTruyThu: tt.khong, choChot: tt.cho,
    },
    taiPhat: {
      dinhNghia: "28 ngày gần nhất so với 28 ngày trước đó (theo ngày ghi nhận ca)",
      theoKhach: recur(recent, prior, "khach"),
      theoTuyen: recur(recentRoute, priorRoute, "tuyen"),
    },
  };
  const topLeg = data.theoChangNghiVan[0], topClient = data.theoKhachHang[0], topRoute = data.tuyenNhieuCa[0];
  data.tomTatSanSang = [
    `${scopeText}: ${vn(scoped.length)} ca hư hỏng (Báo cáo bể vỡ Rillnet).`,
    topLeg ? `Chặng nghi vấn nhiều nhất: ${topLeg.label} — ${vn(topLeg.count)} ca (${topLeg.pct}%).` : null,
    topClient && !projects.length ? `Khách nhiều ca nhất: ${topClient.label} — ${vn(topClient.count)} ca (${topClient.pct}%).` : null,
    topRoute ? `Tuyến (kho → kho) nhiều ca nhất: ${topRoute.tuyen} — ${vn(topRoute.soCa)} ca, chặng nghi vấn chính ${topRoute.changNghiVanChinh}.` : null,
    `Ca còn mở: ${vn(open.length)}${open.length ? ` — ${data.caConMo.theoKhau.map((k) => `${k.khau} ${vn(k.soCa)}`).join(", ")}; tồn lâu nhất ${open[0].soNgayTon ?? "?"} ngày (mã ${open[0].maDon}, ${open[0].khach}).` : "."}`,
    `Tiền đền cho khách (số CS điền, dự kiến/cập nhật): ${vn(withMoney)}/${vn(compensated)} ca đã chốt đền bù có số tiền, tổng ${money(moneyTotal)}. Truy thu là thu lại từ nhân viên (không phải tiền đền cho khách): ${vn(tt.co)} ca, ${money(tt.coTien)}.`,
    data.taiPhat.theoKhach[0] ? `Khách có nhiều ca nhất 28 ngày gần đây: ${data.taiPhat.theoKhach.slice(0, 3).map((k) => `${k.khach} ${k.ca28NgayGan} ca (28 ngày trước: ${k.ca28NgayTruoc})`).join("; ")}.` : null,
  ].filter(Boolean);
  steps.push(`Phân tích chặng nghi vấn, ${open.length} ca còn mở, tiền đền (${withMoney} ca có số tiền)`);
  return { agent: "damage", data, sources: [rn, snapshotSource(base, "nối ca Rillnet với đơn LTL theo mã đơn")], steps };
}
