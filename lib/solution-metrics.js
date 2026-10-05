/**
 * lib/solution-metrics.js — Kế hoạch G (05/10, user duyệt P1–P4): mỗi giải pháp của Sổ tay khai
 * 1 CHỈ SỐ CHÍNH (bắt buộc) + ngưỡng đạt, tối đa 2 chỉ số phụ và 2 chỉ số "không được xấu đi".
 * File THUẦN (không import gì) để cả form (trình duyệt) lẫn server dùng chung danh mục chỉ số.
 *
 *  - Danh mục METRICS: chỉ những chỉ số đo được THẬT từ dữ liệu dashboard (snapshot LTL + ca Rillnet).
 *    "external" = chỉ số chưa có trong dashboard (VD ePOD, số lần chạm kho, cước): bắt buộc ghi cách đo,
 *    hệ thống KHÔNG tự nhận định (không lặng lẽ dùng bể vỡ thay thế).
 *  - evaluateGoal: so Baseline với giai đoạn sau CHỈ trên chỉ số chính; có nhóm đối chứng dùng được thì
 *    xét hiệu quả RÒNG (cùng quy tắc nhận định cũ: ≥ 100 đơn mỗi giai đoạn). Không đổi `computeVerdict`
 *    (nhận định cũ bể vỡ + on-time vẫn có, hiện phụ).
 */
export const METRIC_KEYS = ["damage_pct", "ontime_pct", "lead_days", "return_pct", "comp_per1k", "external"];
export const MAX_SECONDARY = 2;
export const MAX_GUARDRAILS = 2;

// better: hướng TỐT của chỉ số. targetUnit: "%" = thay đổi tương đối so Baseline; "điểm" = chênh lệch điểm %.
export const METRICS = {
  damage_pct: { label: "% bể vỡ", better: "down", targetUnit: "%", def: "Ca bể vỡ ÷ đơn lấy × 100 (cùng cách tính báo cáo công ty). Mục tiêu = giảm ≥ X% so Baseline." },
  ontime_pct: { label: "% on-time", better: "up", targetUnit: "điểm", def: "Đơn đúng hạn ÷ (đúng hạn + trễ), loại đơn hoàn/huỷ. Mục tiêu = tăng ≥ X điểm so Baseline." },
  lead_days: { label: "Thời gian giao trung bình (ngày)", better: "down", targetUnit: "%", def: "Trung bình (ngày giao − ngày lấy) của đơn đã giao. Mục tiêu = giảm ≥ X% so Baseline." },
  return_pct: { label: "% đơn hoàn / giao thất bại", better: "down", targetUnit: "%", def: "Đơn hoàn, đang hoàn hoặc giao thất bại ÷ tổng đơn lấy. Mục tiêu = giảm ≥ X% so Baseline." },
  comp_per1k: { label: "Tiền đền / 1.000 đơn", better: "down", targetUnit: "%", def: "Tiền đền cho khách (số CS nhập, có thể còn cập nhật) ÷ đơn lấy × 1.000. Mục tiêu = giảm ≥ X% so Baseline." },
  external: { label: "Ngoài hệ thống (tự ghi cách đo)", better: null, targetUnit: "", def: "Chỉ số chưa có trong dashboard (VD ePOD, số lần chạm kho, cước). Phải ghi cách đo; hệ thống không tự nhận định." },
};
export const isMetric = (k) => METRIC_KEYS.includes(k);

const nvn = (x, d) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (x, f) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${f(Math.abs(x))}`;
export function formatMetric(key, v) {
  if (v == null || Number.isNaN(v)) return "—";
  if (key === "damage_pct") return `${nvn(v, 2)}%`;
  if (key === "ontime_pct" || key === "return_pct") return `${nvn(v, key === "ontime_pct" ? 1 : 2)}%`;
  if (key === "lead_days") return `${nvn(v, 2)} ngày`;
  if (key === "comp_per1k") return `${nvn(v / 1e6, 1)} tr`;
  return String(v);
}
export const targetText = (key, target) => {
  const m = METRICS[key];
  if (!m || key === "external" || target == null) return "";
  return m.better === "up" ? `tăng ≥ ${nvn(target, 1)} ${m.targetUnit}` : `giảm ≥ ${nvn(target, 0)}${m.targetUnit}`;
};

// Metric value of one side of an impact (computeTrialImpact → trial/control .base/.post).
export function metricValue(key, side) {
  if (!side) return null;
  switch (key) {
    case "damage_pct": return side.per1k == null ? null : side.per1k / 10;
    case "ontime_pct": return side.ontimePct;
    case "lead_days": return side.leadDays ?? null;
    case "return_pct": return side.returnPct ?? null;
    case "comp_per1k": return side.compPer1k ?? null;
    default: return null;
  }
}
// How much the metric moved, positive = better. { change (rel % or points), improvement }.
function move(key, b, p) {
  const m = METRICS[key];
  if (b == null || p == null) return null;
  if (m.targetUnit === "điểm") { const d = p - b; return { change: d, improvement: m.better === "up" ? d : -d, unit: "điểm" }; }
  if (!b) return p > 0 ? { change: null, improvement: m.better === "down" ? -Infinity : Infinity, unit: "%", fromZero: true } : { change: 0, improvement: 0, unit: "%" };
  const rel = ((p - b) / b) * 100;
  return { change: rel, improvement: m.better === "down" ? -rel : rel, unit: "%" };
}
const chText = (mv) => (mv.fromZero ? "từ 0 lên" : mv.unit === "điểm" ? `${sgn(mv.change, (x) => nvn(x, 1))} điểm` : `${sgn(mv.change, (x) => nvn(x, 1))}%`);

/**
 * @param g    { primaryMetric, primaryTarget, secondaryMetrics[], guardrails[], metricNote }
 * @param imp  computeTrialImpact result (+ leadDays / returnPct fields)
 * @param rules { minPostDays, minPostOrders, minCases, minControlOrders, noisePct, noisePts }
 */
export function evaluateGoal(g, imp, rules, today, startDate) { // eslint-disable-line complexity
  if (!g || !g.primaryMetric) return null;
  const key = g.primaryMetric;
  if (key === "external") {
    return { key, label: "Chưa đo được trong dashboard", level: "external", external: true, metricLabel: METRICS.external.label, reasons: [`Chỉ số đo ngoài hệ thống: ${g.metricNote || "(chưa ghi cách đo)"}. Hệ thống không tự nhận định — người phụ trách cập nhật kết quả.`], secondary: [], guardrails: [], guardWarn: [] };
  }
  const T = imp.trial, C = imp.control;
  const useNet = imp.hasControl && C.base.orders >= rules.minControlOrders && C.post.orders >= rules.minControlOrders;
  const noiseOf = (k) => (METRICS[k].targetUnit === "điểm" ? rules.noisePts : rules.noisePct);
  // One metric on the scope (and the control group when usable): values + movement (positive = better).
  const measure = (k) => {
    const tb = metricValue(k, T.base), tp = metricValue(k, T.post);
    const mv = move(k, tb, tp);
    let net = null, cmv = null;
    if (mv && useNet) {
      cmv = move(k, metricValue(k, C.base), metricValue(k, C.post));
      if (cmv && Number.isFinite(cmv.improvement) && Number.isFinite(mv.improvement)) net = mv.improvement - cmv.improvement;
    }
    const basis = net != null ? "net" : "raw";
    return { key: k, label: METRICS[k].label, base: tb, post: tp, mv, cmv, cb: metricValue(k, C.base), cp: metricValue(k, C.post), net, basis, improvement: net != null ? net : mv ? mv.improvement : null, noise: noiseOf(k) };
  };
  // Not enough data (same sufficiency rules as the automatic verdict, per metric).
  const lacking = (k) => {
    if (startDate > today) return `Chưa đến ngày áp dụng.`;
    if (imp.postDays < rules.minPostDays || T.post.orders < rules.minPostOrders) return `giai đoạn sau mới ${imp.postDays} ngày · ${T.post.orders.toLocaleString("vi-VN")} đơn (cần ≥ ${rules.minPostDays} ngày và ≥ ${rules.minPostOrders} đơn)`;
    if (k === "damage_pct" && T.base.cases + T.post.cases < rules.minCases) return `chỉ ${T.base.cases + T.post.cases} ca bể ở 2 giai đoạn (< ${rules.minCases})`;
    if (k === "return_pct" && T.base.returned + T.post.returned < rules.minCases) return `chỉ ${T.base.returned + T.post.returned} đơn hoàn ở 2 giai đoạn (< ${rules.minCases})`;
    if (k === "lead_days" && (T.base.leadN < 30 || T.post.leadN < 30)) return `đơn đã giao quá ít (Trước ${T.base.leadN}, Sau ${T.post.leadN}; cần ≥ 30)`;
    if (k === "comp_per1k" && !T.base.comp && !T.post.comp) return "chưa có số tiền đền ở 2 giai đoạn";
    if (metricValue(k, T.base) == null || metricValue(k, T.post) == null) return "thiếu số liệu ở một trong 2 giai đoạn";
    return "";
  };
  const line = (m) => `${m.label}: ${formatMetric(m.key, m.base)} → ${formatMetric(m.key, m.post)}${m.mv ? ` (${chText(m.mv)})` : ""}`
    + (m.basis === "net" ? `; đối chứng ${formatMetric(m.key, m.cb)} → ${formatMetric(m.key, m.cp)} → ròng ${m.mv.unit === "điểm" ? `${sgn(m.net, (x) => nvn(x, 1))} điểm` : `${sgn(-m.net, (x) => nvn(x, 1))}%`}` : "");
  const target = g.primaryTarget;
  const P = measure(key);
  const why = lacking(key);
  const reasons = [];
  let level, label;
  if (why) { level = "insufficient"; label = "Chưa đủ dữ liệu"; reasons.push(`Chưa đủ dữ liệu để kết luận: ${why}.`); }
  else if (P.improvement == null) { level = "insufficient"; label = "Chưa đủ dữ liệu"; reasons.push("Thiếu số liệu của chỉ số chính."); }
  else {
    const need = Math.max(target ?? 0, 0);
    if (P.improvement >= need && need > 0) { level = "reached"; label = "Đạt mục tiêu"; }
    else if (P.improvement >= P.noise) { level = "improved"; label = "Có cải thiện, chưa đạt ngưỡng"; }
    else if (P.improvement <= -P.noise) {
      // Net is worse but the scope itself did not get worse → say it is behind the control group, not that it got worse.
      const rawOk = P.basis === "net" && P.mv && P.mv.improvement > -P.noise;
      level = rawOk ? "worse_vs_control" : "worse"; label = rawOk ? "Kém hơn nhóm đối chứng" : "Xấu đi";
    }
    else { level = "flat"; label = "Gần như không đổi"; }
    reasons.push(`${line(P)} → ${label.toLowerCase()}; mục tiêu ${targetText(key, target)}${P.basis === "net" ? " (tính theo hiệu quả ròng, đã trừ nhóm đối chứng)" : ""}.`);
  }
  const trust = [];
  if (key === "lead_days" && imp.hasControl && C.post.orders && T.post.orders) {
    const sT = T.post.leadN / T.post.orders, sC = C.post.leadN / C.post.orders;
    if (sC < sT - 0.05) trust.push(`đơn chưa giao của nhóm đối chứng nhiều hơn (${nvn((1 - sC) * 100, 0)}% so với ${nvn((1 - sT) * 100, 0)}% của phạm vi) nên thời gian giao của nhóm đối chứng bị thấp hơn thực tế`);
  }
  if (imp.hasControl && !useNet) reasons.push(`Nhóm đối chứng quá ít đơn (< ${rules.minControlOrders} đơn mỗi giai đoạn) nên xét thay đổi thô của phạm vi.`);
  else if (useNet && P.net == null && !why) reasons.push("Đối chứng không có số ở giai đoạn Trước (hoặc từ 0) nên xét thay đổi thô của phạm vi.");

  const side = (k) => { const m = measure(k); const w = lacking(k); return { key: k, label: m.label, base: m.base, post: m.post, change: m.mv ? m.mv.change : null, unit: m.mv ? m.mv.unit : "", fromZero: !!(m.mv && m.mv.fromZero), net: m.net, basis: m.basis, improvement: m.improvement, insufficient: w || "", text: w ? `${m.label}: ${formatMetric(k, m.base)} → ${formatMetric(k, m.post)} (chưa đủ dữ liệu: ${w})` : line(m) }; };
  const secondary = (g.secondaryMetrics || []).filter((k) => k !== key && METRICS[k] && k !== "external").slice(0, MAX_SECONDARY).map(side);
  const guardrails = (g.guardrails || []).filter((k) => k !== key && METRICS[k] && k !== "external").slice(0, MAX_GUARDRAILS).map((k) => { const s = side(k); return { ...s, worse: !s.insufficient && s.improvement != null && s.improvement <= -noiseOf(k) }; });
  const guardWarn = guardrails.filter((x) => x.worse).map((x) => x.label);
  if (level === "reached" && guardWarn.length) { label = `Đạt mục tiêu — ⚠ ${guardWarn.join(", ")} xấu đi`; level = "reached_warn"; }
  else if (guardWarn.length) reasons.push(`⚠ Chỉ số không được xấu đi nhưng đã xấu đi: ${guardWarn.join(", ")}.`);
  return {
    key, metricLabel: METRICS[key].label, level, label, reasons, target, targetText: targetText(key, target), basis: P.basis,
    base: P.base, post: P.post, change: P.mv ? P.mv.change : null, unit: P.mv ? P.mv.unit : "", fromZero: !!(P.mv && P.mv.fromZero), net: P.net, improvement: Number.isFinite(P.improvement) ? P.improvement : null,
    control: useNet ? { base: P.cb, post: P.cp } : null, insufficient: why || "", secondary, guardrails, guardWarn, trust,
  };
}

// Validation of the goal part of a solution (messages shown to the user as is).
export function validateGoal(s) {
  if (!String(s.problem || "").trim()) return "Thiếu vấn đề / bối cảnh (giải pháp nhằm giải quyết điều gì)";
  if (!String(s.action || "").trim()) return "Thiếu hành động (giải pháp làm gì)";
  if (!isMetric(s.primaryMetric)) return "Chọn chỉ số chính dùng để đo giải pháp";
  if (s.primaryMetric === "external") {
    if (!String(s.metricNote || "").trim()) return "Chỉ số ngoài hệ thống: ghi rõ cách đo (đo bằng gì, lấy số ở đâu)";
  } else {
    const t = Number(s.primaryTarget);
    if (!Number.isFinite(t) || t <= 0) return `Nhập ngưỡng đạt cho chỉ số chính (${METRICS[s.primaryMetric].better === "up" ? "số điểm tăng tối thiểu" : "% giảm tối thiểu"})`;
    if (t > 1000) return "Ngưỡng đạt không hợp lý (quá lớn)";
  }
  const sec = s.secondaryMetrics || [], gr = s.guardrails || [];
  if (sec.length > MAX_SECONDARY) return `Chỉ số phụ tối đa ${MAX_SECONDARY}`;
  if (gr.length > MAX_GUARDRAILS) return `Chỉ số "không được xấu đi" tối đa ${MAX_GUARDRAILS}`;
  for (const k of [...sec, ...gr]) if (!isMetric(k) || k === "external") return "Chỉ số phụ / không được xấu đi phải chọn từ danh sách đo được trong dashboard";
  if ([...sec, ...gr].includes(s.primaryMetric)) return "Chỉ số chính không được trùng chỉ số phụ hoặc chỉ số không được xấu đi";
  if (new Set([...sec, ...gr]).size !== sec.length + gr.length) return "Một chỉ số chỉ nên chọn một lần (phụ hoặc không được xấu đi)";
  if (!String(s.owner || "").trim()) return "Thiếu người phụ trách";
  return null;
}
