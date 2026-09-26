/**
 * lib/ai-agent-tools.js — deterministic tools behind "Tiểu Đệ SD3".
 * Every number the AI quotes comes from here or from the dashboard body
 * (lib/ltl-dashboard.js), both computed from the same LTL snapshot, so the
 * chat and the dashboard can never disagree. The LLM only phrases results.
 */
import { getOntimeOutcome } from "./transform-ltl";
import { computeDamageCauseBreakdown } from "./transform-ai-insights";
import { isPendingPickup, stuckOverdueDays, vnToday } from "./ltl-dashboard";
import { countedDamage, isCompensated, truyThuOf, truyThuAmount } from "./damage-rules";

/**
 * Utility: Remove accents for Vietnamese fuzzy matching
 */
export function removeAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const pct1 = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const tan = (grams) => Math.round(grams / 1e5) / 10; // raw weight is grams

// "tháng 8", "T8", "tháng 7 và 8" → [7, 8]; only months inside the data window.
export function extractMonths(message) {
  const found = new Set();
  const text = removeAccents(message);
  for (const m of text.matchAll(/(?:thang|\bt)\s*(\d{1,2})(?:\s*(?:va|,|-|den|toi)\s*(\d{1,2}))?/g)) {
    [m[1], m[2]].filter(Boolean).map(Number).forEach((n) => { if (n >= 7 && n <= 12) found.add(n); });
  }
  return found.size ? [...found].sort((a, b) => a - b) : null;
}

const monthOf = (row) => {
  const m = String(row.pickup_time || "").match(/^\d{4}-(\d{2})/);
  return m ? Number(m[1]) : null;
};

// Projects named in the message (longest names first so "Nguyễn Kim Miền Bắc"
// wins over "Nguyễn Kim").
export function matchProjects(message, projectNames) {
  const text = removeAccents(message);
  const sorted = [...projectNames].sort((a, b) => b.length - a.length);
  const hits = [];
  for (const name of sorted) {
    const n = removeAccents(name);
    if (n.length >= 3 && text.includes(n) && !hits.some((h) => removeAccents(h).includes(n))) hits.push(name);
  }
  return hits;
}

/**
 * Tool 1: order lookup by code. GHN codes look like GY86QDTF, SHPGP2345,
 * PSD26-CH-03778-1136 — any 6+ char token mixing letters and digits.
 */
export function extractOrderCodes(message) {
  const tokens = String(message).toUpperCase().match(/[A-Z0-9][A-Z0-9-]{4,}[A-Z0-9]/g) || [];
  return [...new Set(tokens.filter((t) => /[A-Z]/.test(t) && /\d/.test(t)))].slice(0, 10);
}

export function lookupOrders(base, codes) {
  const today = vnToday();
  const damageByCode = {};
  for (const d of countedDamage(base.rawDamageCauses || [])) {
    const c = String(d.order_code || "").toUpperCase();
    if (c) (damageByCode[c] = damageByCode[c] || []).push(d);
  }
  const byCode = new Map();
  for (const r of base.ltlRows) byCode.set(String(r.order_code || "").toUpperCase(), r);
  return codes.map((code) => {
    const r = byCode.get(code);
    const dmg = (damageByCode[code] || []).map((d) => ({
      loai: d.type, changNghiVan: d.suspected_leg, khoPhatHien: d.detected_at_warehouse, trangThaiCa: d.status, ngayGhiNhan: d.case_date,
      daChotDenBuChoKhach: isCompensated(d), truyThu: truyThuOf(d) === "co" ? `có · ${truyThuAmount(d).toLocaleString("vi-VN")}đ` : truyThuOf(d) === "khong" ? "không truy thu" : "chờ chốt",
    }));
    if (!r) {
      return { maDon: code, timThay: false, ghiChu: "Không có trong dữ liệu LTL Điện Máy (từ 07/2026)", caBeVo: dmg.length ? dmg : undefined };
    }
    const overdue = stuckOverdueDays(r, today);
    return {
      maDon: code,
      timThay: true,
      duAn: r.client_name,
      trangThai: r.status,
      ngayTao: r.created_time || null,
      ngayLayHang: r.pickup_time || "(chưa lấy hàng)",
      hanGiao: String(r.deadline_plus || "").slice(0, 10) || null,
      ngayGiao: r.delivered_time || null,
      ketQuaSLA: getOntimeOutcome(r) || (isPendingPickup(r) ? "chưa lấy hàng" : "chưa có kết quả"),
      donTreoQuaHanNgay: overdue,
      tuyen: `${r.from_province_name || "?"} → ${r.to_province_name || "?"}`,
      khoLay: r.kho_lay || r.warehouse_lay || null,
      khoGiao: r.kho_giao || r.warehouse_giao || null,
      trongLuongKg: Math.round((parseFloat(r.weight) || 0) / 100) / 10,
      caBeVo: dmg.length ? dmg : "không có",
    };
  });
}

/**
 * Tool 2: route comparison between provinces named in the message
 * (1 province → its top routes in/out; 2+ → the routes among them).
 */
export function matchProvinces(message, rows) {
  const names = new Set();
  for (const r of rows) {
    if (r.from_province_name) names.add(r.from_province_name);
    if (r.to_province_name) names.add(r.to_province_name);
  }
  const text = removeAccents(message);
  const alias = { "tp hcm": "Hồ Chí Minh", hcm: "Hồ Chí Minh", "sai gon": "Hồ Chí Minh", "ha noi": "Hà Nội", hn: "Hà Nội" };
  const hits = new Set();
  for (const n of names) if (text.includes(removeAccents(n))) hits.add(n);
  for (const [a, n] of Object.entries(alias)) if (new RegExp(`\\b${a}\\b`).test(text) && names.has(n)) hits.add(n);
  return [...hits];
}

export function compareRoutes(base, { provinces, months, projects }) {
  const damaged = new Set((countedDamage(base.rawDamageCauses || [])).map((d) => String(d.order_code || "").toUpperCase()));
  const rows = base.ltlRows.filter((r) =>
    !isPendingPickup(r)
    && (!months || months.includes(monthOf(r)))
    && (!projects?.length || projects.includes(r.client_name)));
  const inScope = provinces.length >= 2
    ? (r) => provinces.includes(r.from_province_name) && provinces.includes(r.to_province_name)
    : (r) => r.from_province_name === provinces[0] || r.to_province_name === provinces[0];
  const map = {};
  for (const r of rows) {
    if (!inScope(r)) continue;
    const key = `${r.from_province_name || "?"} → ${r.to_province_name || "?"}`;
    const s = (map[key] = map[key] || { tuyen: key, soDon: 0, grams: 0, ontime: 0, late: 0, beVo: 0, khach: {} });
    s.soDon++;
    s.grams += parseFloat(r.weight) || 0;
    const o = getOntimeOutcome(r);
    if (o === "ontime") s.ontime++;
    else if (o === "late") s.late++;
    if (damaged.has(String(r.order_code || "").toUpperCase())) s.beVo++;
    s.khach[r.client_name] = (s.khach[r.client_name] || 0) + 1;
  }
  return Object.values(map)
    .sort((a, b) => b.soDon - a.soDon)
    .slice(0, 12)
    .map((s) => ({
      tuyen: s.tuyen,
      soDon: s.soDon,
      trongLuongTan: tan(s.grams),
      tyLeOntime: pct1(s.ontime, s.ontime + s.late),
      donLate: s.late,
      donDaDanhGia: s.ontime + s.late,
      caBeVo: s.beVo,
      tyLeBeVoPct: pct1(s.beVo, s.soDon),
      khachChinh: Object.entries(s.khach).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n} (${c})`),
    }));
}

/**
 * Tool 3: damage causes (Rillnet) — same breakdown as the "Hư hỏng & Rủi ro"
 * view, optionally narrowed to the projects named in the question.
 */
export function damageReport(base, { projects }) {
  const all = countedDamage(base.rawDamageCauses || []);
  const scoped = projects?.length
    ? all.filter((d) => projects.some((p) => removeAccents(p) === removeAccents(d.client_name)))
    : all;
  const b = computeDamageCauseBreakdown(scoped);
  const byWarehouse = {};
  for (const d of scoped) {
    const w = d.detected_at_warehouse || "(không rõ)";
    byWarehouse[w] = (byWarehouse[w] || 0) + 1;
  }
  const comp = scoped.filter(isCompensated).length;
  const tt = scoped.filter((d) => truyThuOf(d) === "co");
  return {
    phamVi: projects?.length ? projects.join(", ") : "tất cả dự án Điện Máy",
    tongSoCa: b.totalCases,
    denBu: { daChotDenBuChoKhach: comp, coTruyThu: tt.length, tongTienTruyThu: tt.reduce((a, d) => a + truyThuAmount(d), 0), khongTruyThu: scoped.filter((d) => truyThuOf(d) === "khong").length, choChot: scoped.filter((d) => truyThuOf(d) === "cho").length, ghiChu: "Theo định nghĩa Báo cáo bể vỡ của Rillnet (từ 07/2026, tất cả tháng)" },
    theoChangNghiVan: b.byLeg,
    theoKhachHang: b.byClient?.slice(0, 10),
    theoKhoPhatHien: Object.entries(byWarehouse).sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([kho, soCa]) => ({ kho, soCa })),
  };
}
