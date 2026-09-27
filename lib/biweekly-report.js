/**
 * lib/biweekly-report.js — "Quản lý chất lượng ngành hàng điện tử / điện máy",
 * the user's company report in three cadences (approved 2026-09-27):
 *   - week:     the 4 ISO weeks ending at the chosen week, ± vs previous week
 *   - biweekly: previous month + 3 weeks (Ontime, Hàng hoàn), 4 weeks (Bể vỡ)
 *               — the layout of the user's existing report
 *   - month:    3 months ending at the chosen month + that month's weeks,
 *               ± vs previous month
 * computed from the same LTL snapshot + Rillnet data as the dashboard.
 *
 * Definitions were reverse-engineered from the user's W35–W37 report and
 * matched on real data (SYSTEM_SPEC §8.0b):
 *  - Week = ISO week (Mon–Sun). A "month" = the ISO weeks whose MONDAY falls
 *    in it (2026-08 = weeks of 03/08 … 31/08) — matched all 7 clients exactly.
 *  - # đơn LTC = orders by the ISO week of pickup_time.
 *  - % ontime = ontime / (ontime + late) over DELIVERED orders only.
 *  - "Khác" rows split B2B / B2C by raw_ontime.is_B2C.
 *  - # đơn FD = deliver_type "return" (by pickup week); % FD = FD / # đơn LTC.
 *  - Bể vỡ = Rillnet "Báo cáo bể vỡ" cases (countedDamage), week of the case
 *    (ngày phát hiện); % = cases / GTC (delivered orders by delivery week).
 *  - FTL: no data source with SLA yet — a blank template the user fills in.
 */
import { countedDamage } from "./damage-rules";

export const B2B_CLIENTS = ["LG LTL", "Samsung SDS DAN", "PSD Miền Nam", "Hồng Đạt MXT", "Hồng Đạt"];
export const B2C_CLIENTS = ["Aqua B2C", "Casper"];
// The user's "Hàng hoàn" table lists Nguyễn Kim Miền Bắc on its own row (its
// FD rate is the outlier), unlike the Ontime table.
export const FD_B2C_CLIENTS = ["Aqua B2C", "Casper", "Nguyễn Kim Miền Bắc"];
export const DAMAGE_CLIENTS = ["LG LTL", "PSD Miền Nam", "DigiWorld", "Nguyễn Kim Miền Bắc", "Nguyễn Kim Miền Nam", "Aqua B2C", "Casper"];
export const FTL_CLIENTS = ["LG Pantos FTL", "Aqua B2B FTL", "Karofi FTL", "Thợ ĐMX FTL", "Hisense FTL", "DGW FTL Tỉnh", "DGW FTL Nội thành", "Karofi Livotec FTL"];
export const REPORT_TYPES = { week: "Tuần", biweekly: "2 tuần", month: "Tháng" };
const DISPLAY = { DigiWorld: "Digiworld" };
// Dashboard data starts with July 2026 pickups; earlier months would show a
// partial first week only, so they are left out of the month report.
const DATA_START_MONTH = "2026-07";

const DAY = 86400000;
// A week's numbers keep moving while its orders are still being delivered
// and late damage cases are entered: flag it until 7 days after it ends.
const MATURE_AFTER_DAYS = 14; // Monday + 7 (end of week) + 7

const ymd = (d) => d.toISOString().slice(0, 10);
export function mondayOf(dateStr) {
  const s = String(dateStr || "").trim();
  let y, m, d;
  let x = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (x) [, y, m, d] = x;
  else if ((x = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) [, d, m, y] = x;
  else return null;
  const t = Date.UTC(+y, +m - 1, +d);
  if (Number.isNaN(t)) return null;
  const wd = (new Date(t).getUTCDay() + 6) % 7;
  return ymd(new Date(t - wd * DAY));
}

export function isoWeekOf(monday) {
  const d = new Date(monday + "T00:00:00Z");
  const thursday = new Date(d.getTime() + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  return { year, week: Math.round((d.getTime() - week1Monday) / (7 * DAY)) + 1 };
}

// "2026-W37" → Monday "2026-09-07"
export function mondayOfIsoWeek(param) {
  const m = String(param || "").match(/^(\d{4})-?W(\d{1,2})$/i);
  if (!m) return null;
  const year = +m[1], week = +m[2];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  return ymd(new Date(week1Monday + (week - 1) * 7 * DAY));
}

const vnToday = (now) => ymd(new Date(now + 7 * 3600 * 1000));
export function lastCompletedWeekMonday(now = Date.now()) {
  return ymd(new Date(Date.parse(mondayOf(vnToday(now))) - 7 * DAY));
}
// Last month whose weeks have all ended.
export function lastCompletedMonth(now = Date.now()) {
  const lastMon = lastCompletedWeekMonday(now);
  const next = addDays(lastMon, 7);
  return next.slice(0, 7) !== lastMon.slice(0, 7) ? lastMon.slice(0, 7) : shiftMonth(lastMon.slice(0, 7), -1);
}

export const weekKey = (monday) => { const { year, week } = isoWeekOf(monday); return `${year}-W${String(week).padStart(2, "0")}`; };
const weekLabel = (monday) => `W${isoWeekOf(monday).week}`;
const addDays = (monday, n) => ymd(new Date(Date.parse(monday) + n * DAY));
const isMature = (lastMonday, now) => now >= Date.parse(lastMonday) + MATURE_AFTER_DAYS * DAY;
function shiftMonth(key, n) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function mondaysOfMonth(key) {
  const first = key + "-01";
  let mon = mondayOf(first);
  if (mon < first) mon = addDays(mon, 7);
  const out = [];
  for (; mon.slice(0, 7) === key; mon = addDays(mon, 7)) out.push(mon);
  return out;
}

const weekCol = (m, now) => ({ key: m, label: weekLabel(m), mondays: [m], kind: "week", mature: isMature(m, now), range: `${m.slice(8, 10)}/${m.slice(5, 7)}–${addDays(m, 6).slice(8, 10)}/${addDays(m, 6).slice(5, 7)}` });
const monthCol = (key, now) => { const ms = mondaysOfMonth(key); return { key, label: key, mondays: ms, kind: "month", mature: isMature(ms[ms.length - 1], now) }; };
const lastWeeks = (endMonday, n, now) => Array.from({ length: n }, (_, i) => weekCol(addDays(endMonday, -7 * (n - 1 - i)), now));

// Column plan per report type. `delta` = [fromIndex, toIndex] compared in the ± columns.
function plan(type, period, now) {
  if (type === "month") {
    const months = [shiftMonth(period, -2), shiftMonth(period, -1), period].filter((k) => k >= DATA_START_MONTH).map((k) => monthCol(k, now));
    const weeks = mondaysOfMonth(period).map((m) => weekCol(m, now));
    const cols = [...months, ...weeks];
    const delta = months.length >= 2 ? [months.length - 2, months.length - 1] : null;
    return { periodKey: period, periodLabel: `Tháng ${period.slice(5, 7)}/${period.slice(0, 4)}`, ontime: { cols, delta }, damage: { cols, delta }, ftl: { cols: weeks } };
  }
  const endMonday = mondayOfIsoWeek(period);
  if (type === "week") {
    const cols = lastWeeks(endMonday, 4, now);
    return { periodKey: weekKey(endMonday), periodLabel: `Tuần ${weekLabel(endMonday)} (${cols[3].range})`, ontime: { cols, delta: [2, 3] }, damage: { cols, delta: [2, 3] }, ftl: { cols } };
  }
  // biweekly — the user's existing layout
  const month = monthCol(shiftMonth(endMonday.slice(0, 7), -1), now);
  const w3 = lastWeeks(endMonday, 3, now);
  const w4 = lastWeeks(endMonday, 4, now);
  return { periodKey: weekKey(endMonday), periodLabel: `Kỳ 2 tuần đến ${weekLabel(endMonday)} (${w3[2].range})`, ontime: { cols: [month, ...w3], delta: null }, damage: { cols: w4, delta: null }, ftl: { cols: w4 } };
}

const pct = (a, b) => (b > 0 ? a / b : null);
const indexer = (cols) => {
  const map = new Map();
  cols.forEach((c, i) => c.mondays.forEach((m) => { if (!map.has(m)) map.set(m, []); map.get(m).push(i); }));
  return map;
};
const publicCols = (cols) => cols.map(({ key, label, kind, mature, range }) => ({ key, label, kind, mature, range }));

export function computeReport(base, { type = "biweekly", period }, now = Date.now()) {
  if (!REPORT_TYPES[type]) throw new Error("Loại báo cáo không hợp lệ");
  const p = plan(type, period, now);
  const rows = (base.ltlRows || []).filter((r) => String(r.pickup_time || "").trim());

  // ── Ontime + FD (same columns)
  const oCols = p.ontime.cols;
  const oIdx = indexer(oCols);
  const blank = () => oCols.map(() => ({ n: 0, ontime: 0, late: 0, fd: 0 }));
  const perClient = {};
  const isB2C = {};
  const fdOrders = [];
  for (const r of rows) {
    const cols = oIdx.get(mondayOf(r.pickup_time));
    if (!cols) continue;
    const client = r.client_name;
    const target = (perClient[client] = perClient[client] || blank());
    if (isB2C[client] === undefined) isB2C[client] = String(r.is_B2C ?? "").trim() === "1";
    const delivered = String(r.status || "").toLowerCase() === "delivered";
    const odr = String(r.odr_success || "").toLowerCase();
    const isFd = String(r.deliver_type || "").toLowerCase() === "return"
      || (!r.deliver_type && /return/.test(String(r.status || "").toLowerCase()));
    for (const i of cols) {
      const b = target[i];
      b.n++;
      if (delivered && odr === "ontime") b.ontime++;
      else if (delivered && odr === "late") b.late++;
      if (isFd) b.fd++;
    }
    if (isFd && cols.some((i) => oCols[i].kind === "week")) {
      fdOrders.push({ week: weekLabel(mondayOf(r.pickup_time)), order_code: r.order_code, client, pickup_time: r.pickup_time, status: r.status });
    }
  }
  const sum = (list) => oCols.map((_, i) => list.reduce((a, g) => ({
    n: a.n + g[i].n, ontime: a.ontime + g[i].ontime, late: a.late + g[i].late, fd: a.fd + g[i].fd,
  }), { n: 0, ontime: 0, late: 0, fd: 0 }));
  // Named clients get their own row; everyone else goes to that group's
  // "Khác" by is_B2C (a named client always stays in its listed group).
  const assemble = (b2bList, b2cList) => {
    const g = { B2B: {}, B2C: {} };
    b2bList.forEach((c) => { g.B2B[c] = perClient[c] || blank(); });
    g.B2B["Khác"] = blank();
    b2cList.forEach((c) => { g.B2C[c] = perClient[c] || blank(); });
    g.B2C["Khác"] = blank();
    for (const [client, cells] of Object.entries(perClient)) {
      if (b2bList.includes(client) || b2cList.includes(client)) continue;
      const other = isB2C[client] ? g.B2C["Khác"] : g.B2B["Khác"];
      cells.forEach((c, i) => { other[i].n += c.n; other[i].ontime += c.ontime; other[i].late += c.late; other[i].fd += c.fd; });
    }
    const toRows = (group, totalLabel) => [
      ...Object.entries(group).map(([name, cells]) => ({ name, cells })),
      { name: totalLabel, cells: sum(Object.values(group)), total: true },
    ];
    return [...toRows(g.B2B, "Tổng Khách B2B LTL"), ...toRows(g.B2C, "Tổng Khách B2C"),
      { name: "Tổng Điện máy", cells: sum([...Object.values(g.B2B), ...Object.values(g.B2C)]), total: true, grand: true }];
  };
  const shape = (metric, all) => all.map((r) => ({
    name: r.name, total: !!r.total, grand: !!r.grand,
    counts: r.cells.map((c) => (metric === "fd" ? c.fd : c.n)),
    rates: r.cells.map((c) => (metric === "fd" ? pct(c.fd, c.n) : pct(c.ontime, c.ontime + c.late))),
  }));

  // ── Damage: cases by detection week, % over GTC (delivered by delivery week)
  const dCols = p.damage.cols;
  const dIdx = indexer(dCols);
  const byCode = new Map(rows.map((r) => [String(r.order_code || "").trim(), r]));
  const dmg = {}; const gtc = {};
  const ensure = (o, k) => (o[k] = o[k] || dCols.map(() => 0));
  DAMAGE_CLIENTS.forEach((c) => { ensure(dmg, c); ensure(gtc, c); });
  const damageCases = [];
  for (const d of countedDamage(base.rawDamageCauses || [])) {
    const r = byCode.get(String(d.order_code || "").trim());
    if (!r) continue;
    const wk = mondayOf(d.case_date);
    const cols = dIdx.get(wk);
    if (!cols) continue;
    for (const i of cols) ensure(dmg, r.client_name)[i]++;
    if (cols.some((i) => dCols[i].kind === "week")) {
      damageCases.push({
        week: weekLabel(wk), order_code: d.order_code, client: r.client_name, case_date: d.case_date,
        leg: d.suspected_leg || "", warehouse: d.detected_at_warehouse || "",
        compensated: String(d.compensated ?? "") === "1",
        truy_thu: String(d.truy_thu || "").trim() || "cho", truy_thu_amount: Number(d.truy_thu_amount) || 0,
      });
    }
  }
  for (const r of rows) {
    if (String(r.status || "").toLowerCase() !== "delivered") continue;
    const cols = dIdx.get(mondayOf(r.delivered_time));
    if (cols) for (const i of cols) ensure(gtc, r.client_name)[i]++;
  }
  // Report's client list first, then any other client that had a case.
  const dmgClients = [...DAMAGE_CLIENTS, ...Object.keys(dmg).filter((c) => !DAMAGE_CLIENTS.includes(c) && dmg[c].some(Boolean))];
  const dmgTotal = dCols.map((_, i) => dmgClients.reduce((a, c) => a + dmg[c][i], 0));
  const gtcTotal = dCols.map((_, i) => dmgClients.reduce((a, c) => a + (gtc[c] ? gtc[c][i] : 0), 0));
  const damageRows = [
    ...dmgClients.map((c) => ({
      name: DISPLAY[c] || c, counts: dmg[c], gtc: gtc[c] || dCols.map(() => 0),
      rates: dmg[c].map((n, i) => pct(n, (gtc[c] || [])[i] || 0) ?? (n ? null : 0)),
    })),
    { name: "Tổng Điện máy", total: true, grand: true, counts: dmgTotal, gtc: gtcTotal, rates: dmgTotal.map((n, i) => pct(n, gtcTotal[i])) },
  ];

  return {
    type,
    typeLabel: REPORT_TYPES[type],
    period: p.periodKey,
    periodLabel: p.periodLabel,
    dataAsOf: base.builtAt || null,
    computedAt: new Date(now).toISOString(),
    ontime: { cols: publicCols(oCols), delta: p.ontime.delta, rows: shape("ontime", assemble(B2B_CLIENTS, B2C_CLIENTS)) },
    fd: { cols: publicCols(oCols), delta: p.ontime.delta, rows: shape("fd", assemble(B2B_CLIENTS, FD_B2C_CLIENTS)) },
    damage: { cols: publicCols(dCols), delta: p.damage.delta, rows: damageRows },
    ftl: { cols: publicCols(p.ftl.cols), clients: FTL_CLIENTS },
    details: {
      damageCases: damageCases.sort((a, b) => a.week.localeCompare(b.week) || a.client.localeCompare(b.client)),
      fdOrders: fdOrders.sort((a, b) => a.week.localeCompare(b.week) || a.client.localeCompare(b.client)),
    },
  };
}

// Default period for a type: last completed week / last completed month.
export function defaultPeriod(type, now = Date.now()) {
  return type === "month" ? lastCompletedMonth(now) : weekKey(lastCompletedWeekMonday(now));
}
export function normalizePeriod(type, raw) {
  if (type === "month") return /^\d{4}-\d{2}$/.test(String(raw || "")) ? raw : null;
  const mon = mondayOfIsoWeek(raw);
  return mon ? weekKey(mon) : null;
}
