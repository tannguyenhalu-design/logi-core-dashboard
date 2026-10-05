/**
 * lib/solution-summary.js — Kế hoạch H (05/10): đưa báo cáo giải pháp về 3 câu hỏi, thay cho hàng chục con số:
 *   1. KẾT LUẬN   — giải pháp đạt mục tiêu chưa? (1 câu + chip, từ chỉ số chính)      → computeHeadline
 *   2. TIN ĐƯỢC KHÔNG? — mỗi lý do khiến kết luận chưa chắc, 1 dòng                 → computeTrust
 *   3. LÀM GÌ TIẾP — tối đa 3 gợi ý nhân rộng sang tỉnh / miền khác (chỉ khi đủ volume) → computeSuggestions
 * Mọi chi tiết (đối soát, độ phủ, bảng số) nằm ở phần "Chi tiết kiểm chứng". Giải pháp độc lập nhau (một tuyến có
 * thể dùng nhiều giải pháp, VD tách tuyến + CCDC) nên "gợi ý nhân rộng" chỉ tính trong phạm vi RIÊNG của giải pháp.
 */
import { regionOf } from "./vn-regions";
import { formatMetric } from "./solution-metrics";

const nvn = (x, d = 0) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const chg = (g) => (g.fromZero ? "từ 0 lên" : g.change == null ? "" : g.unit === "điểm" ? `${g.change > 0 ? "+" : g.change < 0 ? "−" : "±"}${nvn(Math.abs(g.change), 1)} điểm` : `${g.change > 0 ? "+" : g.change < 0 ? "−" : "±"}${nvn(Math.abs(g.change), 1)}%`);

/** One sentence: the latest phase that already has a real verdict (else the latest phase). */
export function computeHeadline(phases) {
  const withGoal = phases.filter((x) => x.goal);
  if (!withGoal.length) return null;
  const real = [...withGoal].reverse().find((x) => !["insufficient", "external"].includes(x.goal.level));
  const x = real || withGoal[withGoal.length - 1];
  const g = x.goal;
  let text;
  if (g.external) text = "Chỉ số đo nằm ngoài dashboard nên hệ thống không tự kết luận; người phụ trách cập nhật kết quả.";
  else if (g.level === "insufficient") text = `${x.phase.label}: ${g.insufficient || "thiếu số liệu"}.`;
  else text = `${x.phase.label}: ${g.metricLabel} ${formatMetric(g.key, g.base)} → ${formatMetric(g.key, g.post)}${chg(g) ? ` (${chg(g)}${g.basis === "net" ? ", đã trừ nhóm đối chứng" : ""})`  : ""}, mục tiêu ${g.targetText}.`;
  return { phaseId: x.phase.id, phaseLabel: x.phase.label, level: g.level, label: g.label, text, metricLabel: g.metricLabel };
}

/** Reasons the conclusion may not be reliable — one line each (same reason across phases / clients is merged), warnings first. */
export function computeTrust(sol, phases, clientScope, today) {
  const out = [];
  const add = (level, text) => { if (!out.some((o) => o.text === text)) out.push({ level, text }); };
  const ctrl = [], immature = []; let immOrders = 0;
  for (const x of phases) {
    const p = x.phase, g = x.goal, L = p.label;
    if (g && g.level === "insufficient" && g.insufficient) add("info", `${L}: chưa đủ dữ liệu — ${g.insufficient}.`);
    if (g && g.level === "worse_vs_control") add("warn", `${L}: bản thân phạm vi gần như không đổi hoặc tốt lên, nhưng nhóm đối chứng cải thiện nhiều hơn nên bị chấm kém hơn — kiểm tra nhóm đối chứng có so sánh được không.`);
    if (g && g.trust) for (const t of g.trust) add("warn", `${L}: ${t}.`);
    if (p.liveDate && p.liveDate > p.startDate) add("info", `${L}: triển khai dần từ ${dm(p.startDate)}, chạy đủ tuyến từ ${dm(p.liveDate)} — kỳ Sau chỉ đo từ ${dm(p.liveDate)}.`);
    const route = p.khoLay.length + p.khoGiao.length + p.provinces.length > 0;
    if (route && x.impact.hasControl && x.impact.controlMode !== "same_pickup" && g && !g.external) ctrl.push(L);
    const im = x.reconcile && x.reconcile.immature;
    if (im && g && !g.external) { immature.push(L); immOrders = Math.max(immOrders, im.orders); }
  }
  if (ctrl.length) add("warn", `${ctrl.join(", ")}: nhóm đối chứng đang là mọi đơn còn lại của khách (kể cả kho lấy khác) nên có thể không so sánh được với tuyến này — nên chọn "Cùng kho lấy, khác kho giao".`);
  if (immature.length) add("info", `${immature.join(", ")}: đơn lấy 7 ngày gần nhất chưa chín (ca bể / đơn chưa giao còn có thể thay đổi).`);
  if (clientScope) {
    const bad = clientScope.clients.filter((c) => c.baselineStatus !== "ok");
    const nm = (c) => (c.baselineStatus === "none" ? `${c.name} (chưa có đơn)` : `${c.name} (thiếu ngày)`);
    if (bad.length && bad.length <= 2) for (const w of clientScope.warnings) add("warn", w.replace(/^⚠\s*/, ""));
    else if (bad.length) add("warn", `${bad.length}/${clientScope.clients.length} khách chưa có đủ đơn trong Baseline ${dm(clientScope.baseline.from)}–${dm(clientScope.baseline.to)}: ${bad.slice(0, 4).map(nm).join(", ")}${bad.length > 4 ? ` và ${bad.length - 4} khách khác` : ""} — so Trước/Sau không hoàn toàn cùng một tập khách.`);
  }
  return out.sort((a, b2) => (a.level === "warn" ? 0 : 1) - (b2.level === "warn" ? 0 : 1));
}

/** ≤ 3 provinces (same clients, same source warehouses) outside this solution's scope with enough volume. */
export function computeSuggestions(gaps, max = 3) {
  if (!gaps) return null;
  const list = (gaps.applied.byProvince.list || []).filter((x) => x.enough).slice(0, max);
  if (!list.length) return null;
  const items = list.map((x) => ({
    name: x.name, region: regionOf(x.name) || "", orders: x.orders, tons: x.tons, perWeekOrders: x.perWeekOrders, pastCases: x.pastCases,
    text: `${x.name}${regionOf(x.name) ? ` (${regionOf(x.name)})` : ""} — ${nvn(x.orders)} đơn / ${nvn(x.tons, 1)} tấn trong ${gaps.days} ngày (≈ ${nvn(x.perWeekOrders)} đơn/tuần)${x.pastCases ? `, ${x.pastCases} ca bể trước đây` : ""}`,
  }));
  return { title: "Có thể nhân rộng sang", from: gaps.from, to: gaps.to, items, note: "Chỉ tính phạm vi của giải pháp này; chỉ là gợi ý theo sản lượng (≥ 20 đơn hoặc ≥ 1 tấn mỗi tuần), chưa phải xác nhận đã vận hành." };
}
