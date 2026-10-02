/**
 * lib/solution-reconcile.js — Kế hoạch F · phiên F1 (user duyệt 02/10):
 * báo cáo giải pháp của Sổ tay thêm
 *   (A) ĐỐI SOÁT 2 GÓC NHÌN BỂ VỠ cho từng giai đoạn:
 *       - COHORT   = ca của đơn lấy trong kỳ (cách tính của nhận định tự động);
 *       - REAL-TIME = ca có ngày ghi nhận Rillnet (`case_date`) trong kỳ, thuộc đơn
 *         nằm trong PHẠM VI giai đoạn (mọi ngày lấy). Tỷ lệ real-time = ca ghi
 *         nhận trong kỳ ÷ đơn lấy trong cùng kỳ → chỉ THAM KHẢO (tử số, mẫu số
 *         khác bản chất).
 *   (B) ĐỘ PHỦ tách tuyến + KHOẢNG TRỐNG mở rộng (đơn/tấn thuộc phạm vi giải
 *       pháp ÷ tổng điện máy xuất từ kho nguồn; phần kho nguồn chưa thuộc giải
 *       pháp nào trong Sổ tay).
 *   (C) Danh sách "Nguồn dữ liệu" của báo cáo.
 *
 * Chỉ ĐỌC dữ liệu đã có: không đổi số ca, % bể vỡ, on-time, nhận định tự động,
 * tiền đền. ⚠ Dữ liệu KHÔNG có cờ "đơn thật sự đi qua tuyến tách" → "độ phủ" là
 * phần đơn thuộc PHẠM VI áp dụng, không phải xác nhận đã vận hành.
 * Mọi câu chữ (chú thích, cảnh báo) do hàm ở đây TỰ SINH để màn hình, Word,
 * Excel, In, Copy tóm tắt và tác tử AI dùng chung một nội dung.
 */
import { countedDamage } from "./damage-rules";
import { caseIso } from "./damage-money";
import { buildWarehouseIndex } from "./warehouse-layer";
import { khoLayOf, khoGiaoOf, VERDICT_RULES, IMMATURE_DAYS, fmt } from "./trials";

const DAY = 86400000;
export const GAP_RULES = { ordersPerWeek: 20, tonsPerWeek: 1 }; // ứng viên "đủ volume": ≥ 20 đơn HOẶC ≥ 1 tấn MỖI TUẦN
export const COVERAGE_NOTE = "Độ phủ = phần đơn thuộc PHẠM VI áp dụng của giải pháp (khách × kho lấy × kho giao × tỉnh), không phải xác nhận đơn đã thật sự đi qua tuyến tách — dữ liệu không có cờ này.";
export const REALTIME_NOTE = "Tham khảo: tử số (ca có ngày ghi nhận trong kỳ, mọi đơn của phạm vi) và mẫu số (đơn lấy trong kỳ) khác bản chất; nhận định tự động vẫn theo cohort.";
const GAP_LIST_MAX = 12;
const CODES_MAX = 6;

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const n0 = (x) => Math.round(x).toLocaleString("vi-VN");
const nf = (x, d = 1) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pctTxt = (x) => (x == null ? "—" : `${nf(x, 2)}%`);
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const rangeTxt = (from, to) => (from.slice(0, 7) === to.slice(0, 7) ? `${from.slice(8, 10)}–${ddmm(to)}` : `${ddmm(from)}–${ddmm(to)}`);
const vnStamp = (iso) => { if (!iso || Number.isNaN(Date.parse(iso))) return ""; const v = new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString(); return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`; };
const pickupOf = (r) => String(r.pickup_time || "").slice(0, 10);
const codeOf = (r) => String(r.order_code || "").trim();

// ── Warehouse clusters (WarehouseAlias: names sharing one coordinate) ─────
let whCache = { builtAt: undefined, rows: null, idx: null };
function warehouseIndex(base) {
  if (!base.rawWarehouseAlias?.length) return null;
  if (whCache.idx && whCache.builtAt === base.builtAt && whCache.rows === base.rawWarehouseAlias) return whCache.idx;
  whCache = { builtAt: base.builtAt, rows: base.rawWarehouseAlias, idx: buildWarehouseIndex(base.rawWarehouses || [], base.rawWarehouseAlias) };
  return whCache.idx;
}
/**
 * Source warehouses (as typed in the phase) → { all, set: Set<norm name>, names, merged }.
 * Every name sharing a coordinate with a source name joins the cluster (KA WH
 * HCM + KGHN HCM + KGHN Đức Hòa + B2B Đức Hòa = KCN Xuyên Á). Empty source =
 * every pickup warehouse.
 */
export function sourceCluster(base, sourceNames) {
  const names = [...new Set((sourceNames || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!names.length) return { all: true, set: null, names: [], merged: [] };
  const idx = warehouseIndex(base);
  const set = new Set(names.map(norm));
  const merged = [];
  if (idx) {
    for (const n of names) {
      const hit = idx.byName.get(norm(n));
      if (!hit?.site) continue;
      for (const m of hit.site.names) {
        if (!set.has(norm(m.name))) { set.add(norm(m.name)); merged.push(m.name); }
      }
    }
  }
  return { all: false, set, names, merged };
}
const inCluster = (cl, kho) => cl.all || cl.set.has(norm(kho));
const clusterText = (cl) => (cl.all ? "mọi kho lấy" : `${cl.names.join(", ")}${cl.merged.length ? ` (gộp cụm cùng toạ độ: ${cl.merged.join(", ")})` : ""}`);

// ── (A) Đối soát 2 góc nhìn bể vỡ ────────────────────────────────────────
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const nearestRank = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };

// A view's direction vs the rules of the automatic verdict (±10% of the % bể vỡ; < minCases cases in the 2 periods → not enough).
function viewDir(v) {
  const R = VERDICT_RULES;
  if (v.base.cases + v.post.cases < R.minCases) return { dir: null, why: `chỉ ${v.base.cases + v.post.cases} ca ở 2 kỳ (< ${R.minCases})` };
  if (!v.base.pct) return { dir: v.post.cases >= R.minCases ? "up" : null, why: "kỳ Baseline 0 ca" };
  const ch = ((v.post.pct - v.base.pct) / v.base.pct) * 100;
  return { dir: ch <= R.damageGood ? "down" : ch >= R.damageBad ? "up" : "flat", changePct: ch };
}
const DIR_TEXT = { down: "giảm", up: "tăng", flat: "gần như không đổi" };
const viewSentence = (name, v, d) => `${name} ${DIR_TEXT[d.dir]}${d.dir !== "flat" ? ` ${nf(Math.abs(d.changePct), 1)}%` : d.changePct != null ? ` (${d.changePct > 0 ? "+" : d.changePct < 0 ? "−" : "±"}${nf(Math.abs(d.changePct), 1)}%)` : ""} (${pctTxt(v.base.pct)} → ${pctTxt(v.post.pct)})`;

/**
 * Per phase. `impact` = computeTrialImpact result (same periods / order counts /
 * cohort cases — cohort is read from the very same rule, then checked).
 */
export function computeReconcile(base, sol, phase, impact, today, cases) {
  const clients = new Set(sol.clients), kl = new Set(phase.khoLay), kg = new Set(phase.khoGiao), pv = new Set(phase.provinces);
  const P = impact.periods;
  const bucket = (d) => (!d ? "out" : d >= P.base.from && d <= P.base.to ? "base" : d >= P.post.from && d <= P.post.to ? "post" : "out");
  const started = phase.startDate <= today;

  // Orders of the phase's scope (any pickup day) and their pickup day.
  const scope = new Map();
  let immOrders = 0;
  const immFrom = addDays(today, -(IMMATURE_DAYS - 1));
  for (const r of base.ltlRows || []) {
    if (!clients.has(r.client_name)) continue;
    if ((kl.size && !kl.has(khoLayOf(r))) || (kg.size && !kg.has(khoGiaoOf(r))) || (pv.size && !pv.has(String(r.to_province_name || "").trim()))) continue;
    const d = pickupOf(r);
    scope.set(codeOf(r), d);
    if (started && d >= immFrom && d >= P.post.from && d <= P.post.to) immOrders++;
  }

  const sizeOf = (k) => (k === "base" ? impact.trial.base.orders : impact.trial.post.orders);
  const cell = () => ({ n: 0, items: [] });
  const matrix = { base: { base: cell(), post: cell(), out: cell() }, post: { base: cell(), post: cell(), out: cell() }, out: { base: cell(), post: cell(), out: cell() } };
  const delays = [];
  let longest = null, noDate = 0;
  const days = { base: new Map(), post: new Map() };
  for (const c of cases) {
    const code = codeOf(c);
    if (!scope.has(code)) continue;
    const pd = scope.get(code), rec = caseIso(c);
    const pb = bucket(pd), rb = bucket(rec);
    if (!rec) noDate++;
    const m = matrix[pb][rb];
    m.n++;
    m.items.push({ code, pickup: pd, recorded: rec });
    if (pb !== "out") days[pb].set(pd, (days[pb].get(pd) || 0) + 1);
    if (pb !== "out" && rec && pd) {
      const dl = Math.max(0, daysBetween(pd, rec));
      delays.push(dl);
      if (!longest || dl > longest.days) longest = { days: dl, code, pickup: pd, recorded: rec };
    }
  }

  const view = (get) => {
    const mk = (k) => { const orders = sizeOf(k), n = get(k); return { orders, cases: n, pct: orders ? (n / orders) * 100 : null }; };
    return { base: mk("base"), post: mk("post") };
  };
  const rowSum = (k) => matrix[k].base.n + matrix[k].post.n + matrix[k].out.n;
  const colSum = (k) => matrix.base[k].n + matrix.post[k].n + matrix.out[k].n;
  const cohort = view((k) => rowSum(k));
  const realtime = view((k) => colSum(k));
  const cd = viewDir(cohort), rd = viewDir(realtime);
  cohort.changePct = cd.changePct ?? null; cohort.dir = cd.dir; realtime.changePct = rd.changePct ?? null; realtime.dir = rd.dir;

  const labelOf = { base: `Baseline ${rangeTxt(P.base.from, P.base.to)}`, post: `Sau ${ddmm(P.post.from)}→${ddmm(P.post.to)}`, out: "ngoài 2 kỳ" };
  const rows = [
    { key: "base", label: `Đơn lấy trong ${labelOf.base}` },
    { key: "post", label: `Đơn lấy trong ${labelOf.post}` },
    { key: "out", label: "Đơn lấy ngoài 2 kỳ" },
  ].map((r) => ({ ...r, total: rowSum(r.key), cells: { base: matrix[r.key].base.n, post: matrix[r.key].post.n, out: matrix[r.key].out.n } }));
  const cols = [
    { key: "base", label: `ghi nhận trong ${labelOf.base}`, total: colSum("base") },
    { key: "post", label: `ghi nhận trong ${labelOf.post}`, total: colSum("post") },
    { key: "out", label: "ghi nhận ngoài 2 kỳ / chưa có ngày", total: colSum("out") },
  ];

  // Auto-written explanations of every case that changes period between the 2 views.
  const codesTxt = (items) => `${items.slice(0, CODES_MAX).map((i) => i.code).join(", ")}${items.length > CODES_MAX ? ` và ${items.length - CODES_MAX} ca khác` : ""}`;
  const notes = [];
  const moved = [];
  const add = (pk, rk, text) => {
    const m = matrix[pk][rk];
    if (!m.n) return;
    moved.push({ from: pk, to: rk, n: m.n, items: m.items.slice(0, CODES_MAX * 2) });
    notes.push(text(m.n, codesTxt(m.items)));
  };
  const baseR = rangeTxt(P.base.from, P.base.to), postR = `${ddmm(P.post.from)}→${ddmm(P.post.to)}`;
  add("base", "post", (n, c) => `${n} ca của đơn lấy ${baseR} được ghi nhận từ ${ddmm(P.post.from)} (kỳ Sau) nên tính vào kỳ Sau ở góc nhìn thực tế (${c}).`);
  add("post", "base", (n, c) => `${n} ca của đơn lấy ${postR} có ngày ghi nhận nằm trong Baseline ${baseR} nên góc nhìn thực tế tính vào Baseline (${c}).`);
  add("out", "base", (n, c) => `${n} ca của đơn lấy ngoài 2 kỳ (ngoài Baseline và kỳ Sau) được ghi nhận trong Baseline nên góc nhìn thực tế tính vào Baseline, cohort không tính (${c}).`);
  add("out", "post", (n, c) => `${n} ca của đơn lấy ngoài 2 kỳ được ghi nhận trong kỳ Sau nên góc nhìn thực tế tính vào kỳ Sau, cohort không tính (${c}).`);
  add("base", "out", (n, c) => `${n} ca của đơn lấy ${baseR} có ngày ghi nhận ngoài 2 kỳ hoặc chưa có ngày nên góc nhìn thực tế không tính (${c}).`);
  add("post", "out", (n, c) => `${n} ca của đơn lấy ${postR} có ngày ghi nhận ngoài 2 kỳ hoặc chưa có ngày nên góc nhìn thực tế không tính (${c}).`);
  if (!notes.length) notes.push("Mọi ca được ghi nhận cùng kỳ với ngày lấy đơn nên hai góc nhìn cho cùng số ca.");

  const pickupDays = {};
  for (const k of ["base", "post"]) {
    const arr = [...days[k].entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = arr.reduce((s, x) => s + x[1], 0);
    pickupDays[k] = { cases: total, distinct: arr.length, top: arr.slice(0, 5).map(([date, n]) => ({ date, cases: n })) };
  }
  const concentration = ["base", "post"].map((k) => {
    const d = pickupDays[k];
    if (d.cases < VERDICT_RULES.minCases || d.distinct > 5) return null;
    return `${d.cases} ca ${k === "base" ? "Baseline" : "kỳ Sau"} (cohort) đến từ chỉ ${d.distinct} ngày lấy (${d.top.map((x) => `${ddmm(x.date)}: ${x.cases}`).join(", ")}) — tỷ lệ kỳ này có thể bị kéo bởi vài lô.`;
  }).filter(Boolean);

  const delay = delays.length ? { n: delays.length, median: median(delays), p75: nearestRank(delays, 0.75), max: Math.max(...delays), longest } : null;
  const delayText = delay ? `Độ trễ từ ngày lấy đến ngày Rillnet ghi nhận (${delay.n} ca): trung vị ${nf(delay.median, delay.median % 1 ? 1 : 0)} ngày, 75% ca ≤ ${delay.p75} ngày, lâu nhất ${delay.max} ngày${longest ? ` (${longest.code})` : ""}.` : "Chưa có ca nào để tính độ trễ ghi nhận.";

  // Orders of the last IMMATURE_DAYS days are not "mature": their cases may still be recorded.
  let immature = null;
  if (started && P.post.to >= addDays(today, -IMMATURE_DAYS)) {
    immature = {
      from: immFrom < P.post.from ? P.post.from : immFrom, orders: immOrders,
      text: `Số chưa chín: ${n0(immOrders)} đơn lấy ${IMMATURE_DAYS} ngày gần nhất (từ ${ddmm(immFrom)}) chưa đủ thời gian để ca bể được ghi nhận${delay ? ` (độ trễ trung vị ${nf(delay.median, delay.median % 1 ? 1 : 0)} ngày, lâu nhất ${delay.max} ngày)` : ""} — cả hai góc nhìn của kỳ Sau có thể còn tăng thêm.`,
    };
  }

  // ⚠ opposite conclusions: one view "down" and the other not, or one "up" and the other not.
  let warn = null;
  const skipWhy = [!cd.dir && `cohort ${cd.why}`, !rd.dir && `real-time ${rd.why}`].filter(Boolean);
  if (cd.dir && rd.dir && cd.dir !== rd.dir) {
    warn = `⚠ Hai góc nhìn cho kết luận khác hướng: ${viewSentence("cohort", cohort, cd)}, còn ${viewSentence("real-time", realtime, rd)}. Nhận định tự động vẫn theo cohort — nên đọc kèm số real-time.`;
  }

  const summary = [
    `Cohort (ca của đơn lấy trong kỳ): ${pctTxt(cohort.base.pct)} (${cohort.base.cases}/${n0(cohort.base.orders)} đơn) → ${pctTxt(cohort.post.pct)} (${cohort.post.cases}/${n0(cohort.post.orders)} đơn).`,
    `Real-time (ca ghi nhận trong kỳ ÷ đơn lấy trong kỳ, tham khảo): ${pctTxt(realtime.base.pct)} (${realtime.base.cases} ca) → ${pctTxt(realtime.post.pct)} (${realtime.post.cases} ca).`,
    ...notes, ...concentration, delayText,
    ...(immature ? [immature.text] : []),
    ...(warn ? [warn] : []),
    ...(skipWhy.length ? [`Chưa so hướng 2 góc nhìn: ${skipWhy.join("; ")}.`] : []),
  ];

  return {
    periods: { base: { ...P.base, orders: sizeOf("base") }, post: { from: P.post.from, to: P.post.to, orders: sizeOf("post") } },
    cohort, realtime, matrix: { rows, cols }, moved, notes, noDate, delay, delayText, immature, pickupDays, concentration, warn, summary,
    checks: { cohortMatchesImpact: cohort.base.cases === impact.trial.base.cases && cohort.post.cases === impact.trial.post.cases },
    realtimeNote: REALTIME_NOTE,
  };
}

// ── (B) Độ phủ ────────────────────────────────────────────────────────────
const tonsOf = (r) => (parseFloat(r.weight) || 0) / 1e6;

/**
 * Coverage of every phase (from its own start day) and of the whole solution
 * (union of the phase windows — an order counts once).
 * `phases` = [{ phase, impact }] as in computeSolutionReport.
 */
export function computeCoverage(base, sol, phases, today) {
  const clients = new Set(sol.clients);
  const defs = phases.map(({ phase: p, impact }) => {
    const from = impact.periods.post.from, to = impact.periods.post.to;
    return {
      phase: p, from, to, active: p.startDate <= today && to >= from, cluster: sourceCluster(base, p.khoLay),
      kl: new Set(p.khoLay), kg: new Set(p.khoGiao), pv: new Set(p.provinces),
      acc: { all: { o: 0, t: 0 }, clients: { o: 0, t: 0 }, scope: { o: 0, t: 0 } },
    };
  });
  const solAcc = { all: { o: 0, t: 0 }, clients: { o: 0, t: 0 }, scope: { o: 0, t: 0 } };
  const bump = (a, t) => { a.o++; a.t += t; };
  const activeDefs = defs.filter((x) => x.active);
  // Whole solution = scope of ANY phase over the whole period from the first phase start to the last day
  // (union, an order counts once) — the per-phase rows above count each phase from its own start day.
  const solFrom = activeDefs.length ? activeDefs.map((x) => x.from).sort()[0] : null;
  const solTo = activeDefs.length ? activeDefs.map((x) => x.to).sort().pop() : null;
  const scopeHit = (x, r, kho) => (!x.kl.size || x.kl.has(kho)) && (!x.kg.size || x.kg.has(khoGiaoOf(r))) && (!x.pv.size || x.pv.has(String(r.to_province_name || "").trim()));
  for (const r of base.ltlRows || []) {
    const d = pickupOf(r);
    if (!d) continue;
    const t = tonsOf(r), kho = khoLayOf(r), isClient = clients.has(r.client_name);
    for (const x of defs) {
      if (!x.active || d < x.from || d > x.to || !inCluster(x.cluster, kho)) continue;
      bump(x.acc.all, t);
      if (!isClient) continue;
      bump(x.acc.clients, t);
      if (scopeHit(x, r, kho)) bump(x.acc.scope, t);
    }
    if (!activeDefs.length || d < solFrom || d > solTo) continue;
    if (!activeDefs.some((x) => inCluster(x.cluster, kho))) continue;
    bump(solAcc.all, t);
    if (!isClient) continue;
    bump(solAcc.clients, t);
    if (activeDefs.some((x) => scopeHit(x, r, kho))) bump(solAcc.scope, t);
  }
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const shape = (acc, extra = {}) => ({
    orders: acc.scope.o, tons: acc.scope.t,
    allOrders: acc.all.o, allTons: acc.all.t, clientOrders: acc.clients.o, clientTons: acc.clients.t,
    pctOrders: pct(acc.scope.o, acc.all.o), pctTons: pct(acc.scope.t, acc.all.t),
    pctClientOrders: pct(acc.scope.o, acc.clients.o), pctClientTons: pct(acc.scope.t, acc.clients.t),
    ...extra,
  });
  const out = defs.map((x) => shape(x.acc, { phaseId: x.phase.id, label: x.phase.label, from: x.from, to: x.to, active: x.active, source: { names: x.cluster.names, merged: x.cluster.merged, all: x.cluster.all, text: clusterText(x.cluster) } }));
  const solution = shape(solAcc, {
    from: solFrom, to: solTo,
    phases: activeDefs.length, sourceText: [...new Set(activeDefs.map((x) => clusterText(x.cluster)))].join(" · "),
  });
  return { phases: out, solution, note: COVERAGE_NOTE };
}

// ── (B) Khoảng trống mở rộng ──────────────────────────────────────────────
/**
 * Output of the solution's source warehouses that no solution of the Sổ tay
 * covers (scope only — client × kho lấy × kho giao × tỉnh of ANY phase of ANY
 * solution, whatever its status, since the point is "don't suggest a flow that
 * is already in a solution"). Period = from the solution's first phase start
 * to its last day. Two views: the solution's own clients, and every client.
 */
export function computeGaps(base, sol, phases, allSolutions, today) {
  const act = phases.filter(({ phase: p, impact }) => p.startDate <= today && impact.periods.post.to >= impact.periods.post.from);
  if (!act.length) return null;
  const from = act.map(({ impact }) => impact.periods.post.from).sort()[0];
  const to = act.map(({ impact }) => impact.periods.post.to).sort().pop();
  const days = daysBetween(from, to) + 1, weeks = days / 7;
  const clusters = act.map(({ phase }) => sourceCluster(base, phase.khoLay));
  const inSource = (kho) => clusters.some((c) => inCluster(c, kho));
  const own = new Set(sol.clients);

  // Every phase of every solution as a scope matcher.
  const matchers = [];
  for (const s of allSolutions || [sol]) {
    const cs = new Set(s.clients);
    for (const p of s.phases) matchers.push({ sid: s.id, cs, kl: new Set(p.khoLay), kg: new Set(p.khoGiao), pv: new Set(p.provinces) });
  }
  // ids of the solutions whose scope contains this order (empty = no solution covers it)
  const coveredBy = (r) => {
    const kl = khoLayOf(r), kg = khoGiaoOf(r), pv = String(r.to_province_name || "").trim();
    const ids = new Set();
    for (const m of matchers) if (m.cs.has(r.client_name) && (!m.kl.size || m.kl.has(kl)) && (!m.kg.size || m.kg.has(kg)) && (!m.pv.size || m.pv.has(pv))) ids.add(m.sid);
    return ids;
  };

  const mkScope = () => ({ eligible: { o: 0, t: 0 }, gap: { o: 0, t: 0 }, others: { o: 0, t: 0, ids: new Set() }, by: { province: new Map(), warehouse: new Map(), client: new Map() } });
  const scopes = { applied: mkScope(), all: mkScope() };
  const codeKeys = new Map(); // order_code → keys (for the all-time case counts)
  const cell = (m, k) => { let c = m.get(k); if (!c) m.set(k, (c = { o: 0, t: 0, po: 0, pc: 0 })); return c; };
  for (const r of base.ltlRows || []) {
    const kho = khoLayOf(r);
    if (!kho || !inSource(kho)) continue;
    const d = pickupOf(r);
    if (!d) continue;
    const inWin = d >= from && d <= to;
    const isOwn = own.has(r.client_name);
    const cov = coveredBy(r), isCov = cov.size > 0, othersOnly = isCov && !cov.has(sol.id);
    const keys = { province: String(r.to_province_name || "").trim() || "(không rõ tỉnh)", warehouse: khoGiaoOf(r) || "(không rõ kho giao)", client: String(r.client_name || "").trim() || "(không rõ khách)" };
    const t = tonsOf(r);
    for (const [sk, sc] of Object.entries(scopes)) {
      if (sk === "applied" && !isOwn) continue;
      if (inWin) { sc.eligible.o++; sc.eligible.t += t; }
      if (othersOnly && inWin) { sc.others.o++; sc.others.t += t; for (const id of cov) sc.others.ids.add(id); }
      if (isCov) continue; // covered flows never appear as gap
      if (inWin) { sc.gap.o++; sc.gap.t += t; for (const dim of ["province", "warehouse", "client"]) { const c = cell(sc.by[dim], keys[dim]); c.o++; c.t += t; } }
      // all-time orders of the same uncovered flows (denominator of the past-case rate)
      for (const dim of ["province", "warehouse", "client"]) cell(sc.by[dim], keys[dim]).po++;
    }
    const code = codeOf(r);
    if (code && !isCov) codeKeys.set(code, { keys, own: isOwn });
  }
  for (const c of countedDamage(base.rawDamageCauses || [])) {
    const k = codeKeys.get(codeOf(c));
    if (!k) continue;
    for (const [sk, sc] of Object.entries(scopes)) {
      if (sk === "applied" && !k.own) continue;
      for (const dim of ["province", "warehouse", "client"]) { const x = sc.by[dim].get(k.keys[dim]); if (x) x.pc++; }
    }
  }

  const shapeScope = (sc, clientsText) => {
    const rank = (dim) => {
      const all = [...sc.by[dim].entries()].filter(([, c]) => c.o > 0).map(([name, c]) => {
        const perWeekOrders = c.o / weeks, perWeekTons = c.t / weeks;
        return {
          name, orders: c.o, tons: c.t, perWeekOrders, perWeekTons,
          enough: dim !== "client" && (perWeekOrders >= GAP_RULES.ordersPerWeek || perWeekTons >= GAP_RULES.tonsPerWeek),
          pastOrders: c.po, pastCases: c.pc, pastPct: c.po ? (c.pc / c.po) * 100 : null,
        };
      }).sort((a, b) => b.orders - a.orders || b.tons - a.tons || a.name.localeCompare(b.name));
      return { total: all.length, enoughCount: all.filter((x) => x.enough).length, list: all.slice(0, GAP_LIST_MAX) };
    };
    return {
      clientsText,
      eligibleOrders: sc.eligible.o, eligibleTons: sc.eligible.t, gapOrders: sc.gap.o, gapTons: sc.gap.t,
      gapPctOrders: sc.eligible.o ? (sc.gap.o / sc.eligible.o) * 100 : null, gapPctTons: sc.eligible.t ? (sc.gap.t / sc.eligible.t) * 100 : null,
      // already inside ANOTHER solution of the Sổ tay (not this one) → left out of the gap, shown so the numbers add up
      othersOrders: sc.others.o, othersTons: sc.others.t, othersIds: [...sc.others.ids].filter((id) => id !== sol.id),
      byProvince: rank("province"), byWarehouse: rank("warehouse"), byClient: rank("client"),
    };
  };
  const text = (sc, label) => `${label}: ${n0(sc.gapOrders)} đơn / ${nf(sc.gapTons, 1)} tấn chưa thuộc giải pháp nào (${pctTxt(sc.gapPctOrders)} đơn xuất từ kho nguồn)${sc.othersOrders ? `; ${n0(sc.othersOrders)} đơn / ${nf(sc.othersTons, 1)} tấn đã thuộc giải pháp khác (${sc.othersIds.join(", ")}) nên không tính là khoảng trống` : ""}.`;
  const applied = shapeScope(scopes.applied, sol.clients.join(", "));
  const all = shapeScope(scopes.all, "mọi khách");
  return {
    from, to, days, weeks,
    source: clusters.map((c) => clusterText(c)).filter((v, i, a) => a.indexOf(v) === i).join(" · "),
    rules: GAP_RULES,
    ruleText: `Ứng viên "đủ volume" = ≥ ${GAP_RULES.ordersPerWeek} đơn hoặc ≥ ${GAP_RULES.tonsPerWeek} tấn mỗi tuần (trung bình tuần của kỳ xét ${ddmm(from)}→${ddmm(to)}, ${days} ngày) tại một tỉnh / kho giao.`,
    checkedSolutions: (allSolutions || [sol]).map((s) => ({ id: s.id, name: s.name, status: s.status, phases: s.phases.length })),
    applied, all,
    summary: [text(applied, `Khách áp dụng (${sol.clients.length > 3 ? `${sol.clients.length} khách` : sol.clients.join(", ")})`), text(all, "Mọi khách")],
    note: "Chưa thuộc giải pháp nào = không nằm trong phạm vi (khách × kho lấy × kho giao × tỉnh) của bất kỳ giai đoạn nào của mọi giải pháp trong Sổ tay (cả đã hủy / dừng). Số ca bể = ca của các đơn cùng luồng từ 01/07/2026 đến nay.",
  };
}

// ── (C) Nguồn dữ liệu ─────────────────────────────────────────────────────
const maxOf = (rows, f) => rows.reduce((a, r) => { const v = String(r?.[f] || ""); return v > a ? v : a; }, "");
export function buildSources(base, sol, { gaps = null } = {}) {
  const dmg = base.rawDamageCauses || [];
  const syncedAt = [maxOf(dmg, "synced_at"), maxOf(base.rawCompensationSummary || [], "synced_at")].sort().pop() || null;
  const stale = syncedAt ? Date.now() - Date.parse(syncedAt) > 24 * 3600 * 1000 : true;
  const whAt = maxOf(base.rawWarehouses || [], "cap_nhat");
  const list = [
    { key: "ltl", label: "Snapshot LTL", at: base.builtAt || null, atText: vnStamp(base.builtAt), detail: `${n0((base.ltlRows || []).length)} đơn điện máy LTL từ 01/07/2026` },
    { key: "rillnet", label: "Rillnet — Báo cáo bể vỡ", at: syncedAt, atText: vnStamp(syncedAt), stale, detail: `${n0(countedDamage(dmg).length)} ca bể vỡ đang tính, đồng bộ lần cuối ${vnStamp(syncedAt) || "không rõ"}${stale ? " (đã quá 24 giờ chưa đồng bộ)" : ""}` },
    { key: "notebook", label: `Sổ tay cải tiến ${sol.id}`, at: sol.updatedAt || null, atText: vnStamp(sol.updatedAt), detail: `${sol.name}${gaps ? ` · đối chiếu khoảng trống với ${gaps.checkedSolutions.length} giải pháp: ${gaps.checkedSolutions.map((s) => s.id).join(", ")}` : ""}` },
    { key: "warehouses", label: "Danh sách kho GHN", at: null, atText: whAt, detail: `${n0((base.rawWarehouses || []).length)} kho chính + ${n0((base.rawWarehouseAlias || []).length)} tên kho trong đơn (WarehouseAlias)${whAt ? `, cập nhật ${whAt}` : ""}` },
  ];
  return { list, text: `Nguồn dữ liệu: ${list.map((s) => `${s.label}${s.atText ? ` (${s.atText})` : ""}`).join(" · ")}.` };
}

export { fmt as fmtDate, rangeTxt, ddmm };
