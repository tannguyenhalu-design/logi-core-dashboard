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
 *
 * Client selection (user decision 2026-09-27): the company looks at one or a
 * few key accounts, never the whole industry. `clients` (raw client names)
 * limits all three tables to those clients and their total row
 * "Tổng khách đã chọn" adds up only them — for Bể vỡ that is Σ cases / Σ GTC
 * of the selected clients. Without `clients` the full layout of the user's
 * original report is kept (named rows + "Khác" + B2B/B2C subtotals).
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
export const SELECTED_TOTAL = "Tổng khách đã chọn";
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
// The week of `lastMonday` ends Sunday 24:00 Vietnam time (UTC+7).
export const isInProgress = (lastMonday, now = Date.now()) => now < Date.parse(lastMonday) + 7 * DAY - 7 * 3600 * 1000;
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
    return { periodKey: period, lastMonday: weeks[weeks.length - 1].key, periodLabel: `Tháng ${period.slice(5, 7)}/${period.slice(0, 4)}`, ontime: { cols, delta }, damage: { cols, delta }, ftl: { cols: weeks } };
  }
  const endMonday = mondayOfIsoWeek(period);
  if (type === "week") {
    const cols = lastWeeks(endMonday, 4, now);
    return { periodKey: weekKey(endMonday), lastMonday: endMonday, periodLabel: `Tuần ${weekLabel(endMonday)} (${cols[3].range})`, ontime: { cols, delta: [2, 3] }, damage: { cols, delta: [2, 3] }, ftl: { cols } };
  }
  // biweekly — the user's existing layout
  const month = monthCol(shiftMonth(endMonday.slice(0, 7), -1), now);
  const w3 = lastWeeks(endMonday, 3, now);
  const w4 = lastWeeks(endMonday, 4, now);
  // Named after the two weeks it reports (user 27/09: "2 tuần 38 - 39 (14/09 - 27/09)").
  const two = `${weekLabel(w3[1].key)}–${weekLabel(endMonday)} (${w3[1].range.split("–")[0]}–${w3[2].range.split("–")[1]})`;
  return { periodKey: weekKey(endMonday), lastMonday: endMonday, periodLabel: `Kỳ 2 tuần ${two} · báo cáo ${weekLabel(addDays(endMonday, 7))}`, ontime: { cols: [month, ...w3], delta: null }, damage: { cols: w4, delta: null }, ftl: { cols: w4 } };
}

const pct = (a, b) => (b > 0 ? a / b : null);
const indexer = (cols) => {
  const map = new Map();
  cols.forEach((c, i) => c.mondays.forEach((m) => { if (!map.has(m)) map.set(m, []); map.get(m).push(i); }));
  return map;
};
const publicCols = (cols) => cols.map(({ key, label, kind, mature, range }) => ({ key, label, kind, mature, range }));

// "LG LTL|Aqua B2C" or an array → unique, trimmed names; empty → null (full layout).
export function normalizeClients(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw || "").split("|")).map((c) => String(c).trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : null;
}

export function computeReport(base, { type = "biweekly", period, clients = null }, now = Date.now()) {
  if (!REPORT_TYPES[type]) throw new Error("Loại báo cáo không hợp lệ");
  const p = plan(type, period, now);
  const selection = normalizeClients(clients);
  const picked = selection ? new Set(selection) : null;
  const rows = (base.ltlRows || []).filter((r) => String(r.pickup_time || "").trim());

  // ── Ontime + FD (same columns)
  const oCols = p.ontime.cols;
  const oIdx = indexer(oCols);
  const blank = () => oCols.map(() => ({ n: 0, ontime: 0, late: 0, fd: 0 }));
  const perClient = {};
  const isB2C = {};
  const fdOrders = [];
  const lateOrders = [];
  // Per client → pickup-week Monday → route → [evaluated, late] (week columns
  // only) — the route table behind a clicked Ontime cell.
  const ontimeRoutes = {};
  const damagedCodes = new Set(countedDamage(base.rawDamageCauses || []).map((d) => String(d.order_code || "").trim()));
  const periodOrders = {}; // orders per client in the report window (selector list)
  for (const r of rows) {
    const mon = mondayOf(r.pickup_time);
    const cols = oIdx.get(mon);
    if (!cols) continue;
    const client = r.client_name;
    periodOrders[client] = (periodOrders[client] || 0) + 1;
    const target = (perClient[client] = perClient[client] || blank());
    if (isB2C[client] === undefined) isB2C[client] = String(r.is_B2C ?? "").trim() === "1";
    const delivered = String(r.status || "").toLowerCase() === "delivered";
    const odr = String(r.odr_success || "").toLowerCase();
    const isFd = isReturnRow(r);
    for (const i of cols) {
      const b = target[i];
      b.n++;
      if (delivered && odr === "ontime") b.ontime++;
      else if (delivered && odr === "late") b.late++;
      if (isFd) b.fd++;
    }
    const inWeekCol = cols.some((i) => oCols[i].kind === "week");
    if (!inWeekCol || (picked && !picked.has(client))) continue;
    const route = orderRoute(r);
    if (delivered && (odr === "ontime" || odr === "late")) {
      const perMon = (ontimeRoutes[client] = ontimeRoutes[client] || {});
      const byMon = (perMon[mon] = perMon[mon] || {});
      const key = `${route.kho_lay} → ${route.kho_giao}`;
      const cell = (byMon[key] = byMon[key] || [0, 0]);
      cell[0]++;
      if (odr === "late") {
        cell[1]++;
        const deadline = String(r.deadline_plus || r.deadline || "").slice(0, 10);
        const deliveredDate = String(r.delivered_time || "").slice(0, 10);
        lateOrders.push({
          week: weekLabel(mon), monday: mon, order_code: r.order_code, client,
          pickup_date: String(r.pickup_time).slice(0, 10), deadline, delivered_date: deliveredDate,
          days_late: daysLate(deliveredDate, deadline), ...route,
        });
      }
    }
    if (isFd) {
      fdOrders.push({
        week: weekLabel(mon), monday: mon, order_code: r.order_code, client, pickup_time: r.pickup_time, status: r.status,
        ...route, has_damage: damagedCodes.has(String(r.order_code || "").trim()),
      });
    }
  }
  const sum = (list) => oCols.map((_, i) => list.reduce((a, g) => ({
    n: a.n + g[i].n, ontime: a.ontime + g[i].ontime, late: a.late + g[i].late, fd: a.fd + g[i].fd,
  }), { n: 0, ontime: 0, late: 0, fd: 0 }));
  // Named clients get their own row; everyone else goes to that group's
  // "Khác" by is_B2C (a named client always stays in its listed group).
  // Each row also carries the raw client names it adds up (`clients`) so the
  // tab can list the late / returned orders behind any cell, "Khác" included.
  const assemble = (b2bList, b2cList) => {
    const g = { B2B: {}, B2C: {} };
    const entry = (c) => ({ cells: perClient[c] || blank(), clients: [c] });
    b2bList.forEach((c) => { g.B2B[c] = entry(c); });
    g.B2B["Khác"] = { cells: blank(), clients: [] };
    b2cList.forEach((c) => { g.B2C[c] = entry(c); });
    g.B2C["Khác"] = { cells: blank(), clients: [] };
    for (const [client, cells] of Object.entries(perClient)) {
      if (b2bList.includes(client) || b2cList.includes(client)) continue;
      const other = isB2C[client] ? g.B2C["Khác"] : g.B2B["Khác"];
      other.clients.push(client);
      cells.forEach((c, i) => { const o = other.cells[i]; o.n += c.n; o.ontime += c.ontime; o.late += c.late; o.fd += c.fd; });
    }
    const toRows = (group, totalLabel) => [
      ...Object.entries(group).map(([name, e]) => ({ name, cells: e.cells, clients: e.clients })),
      { name: totalLabel, cells: sum(Object.values(group).map((e) => e.cells)), clients: Object.values(group).flatMap((e) => e.clients), total: true },
    ];
    const all = [...Object.values(g.B2B), ...Object.values(g.B2C)];
    return [...toRows(g.B2B, "Tổng Khách B2B LTL"), ...toRows(g.B2C, "Tổng Khách B2C"),
      { name: "Tổng Điện máy", cells: sum(all.map((e) => e.cells)), clients: all.flatMap((e) => e.clients), total: true, grand: true }];
  };
  // Selected clients only, B2B first then B2C, one total over just them.
  const assembleSelected = () => {
    const b2b = selection.filter((c) => B2B_CLIENTS.includes(c) || (!B2C_CLIENTS.includes(c) && !FD_B2C_CLIENTS.includes(c) && !isB2C[c]));
    const b2c = selection.filter((c) => !b2b.includes(c));
    const list = [...b2b, ...b2c].map((c) => ({ name: DISPLAY[c] || c, cells: perClient[c] || blank(), clients: [c] }));
    return [...list, { name: SELECTED_TOTAL, cells: sum(list.map((r) => r.cells)), clients: [...b2b, ...b2c], total: true, grand: true }];
  };
  const shape = (metric, all) => all.map((r) => ({
    name: r.name, total: !!r.total, grand: !!r.grand, clients: r.clients,
    counts: r.cells.map((c) => (metric === "fd" ? c.fd : c.n)),
    rates: r.cells.map((c) => (metric === "fd" ? pct(c.fd, c.n) : pct(c.ontime, c.ontime + c.late))),
    // ontime only: the late count behind each rate (drill-down check)
    ...(metric === "fd" ? {} : { late: r.cells.map((c) => c.late), evaluated: r.cells.map((c) => c.ontime + c.late) }),
  }));

  // ── Damage: cases by detection week, % over GTC (delivered by delivery week)
  const dCols = p.damage.cols;
  const dIdx = indexer(dCols);
  const byCode = new Map(rows.map((r) => [String(r.order_code || "").trim(), r]));
  const dmg = {}; const gtc = {};
  const ensure = (o, k) => (o[k] = o[k] || dCols.map(() => 0));
  DAMAGE_CLIENTS.forEach((c) => { ensure(dmg, c); ensure(gtc, c); });
  const damageCases = [];
  const damageCasesMonthOnly = [];
  for (const d of countedDamage(base.rawDamageCauses || [])) {
    const r = byCode.get(String(d.order_code || "").trim());
    if (!r) continue;
    if (picked && !picked.has(r.client_name)) continue;
    const wk = mondayOf(d.case_date);
    const cols = dIdx.get(wk);
    if (!cols) continue;
    for (const i of cols) ensure(dmg, r.client_name)[i]++;
    const created = String(r.created_time || "").slice(0, 10);
    const c = {
      week: weekLabel(wk), monday: wk, order_code: d.order_code, client: r.client_name, case_date: d.case_date,
      // So readers can see a case sits in a different week than its order
      // (user 27/09: "đơn đó tạo từ tuần nào? xuất phát từ tuyến nào kho nào?").
      created_date: created, created_week: mondayOf(created) ? weekLabel(mondayOf(created)) : "",
      pickup_date: String(r.pickup_time || "").slice(0, 10),
      pickup_week: mondayOf(r.pickup_time) ? weekLabel(mondayOf(r.pickup_time)) : "",
      delivered_date: String(r.delivered_time || "").slice(0, 10),
      delivered_week: mondayOf(r.delivered_time) ? weekLabel(mondayOf(r.delivered_time)) : "",
      order_status: r.status || "",
      kho_lay: r.warehouse_lay || r.kho_lay || "", from_province: r.from_province_name || "",
      kho_giao: r.warehouse_giao || r.kho_giao || "", to_province: r.to_province_name || "",
      weight_kg: Math.round((Number(r.weight) || 0) / 1000),
      leg: d.suspected_leg || "", warehouse: d.detected_at_warehouse || "",
      compensated: String(d.compensated ?? "") === "1",
      truy_thu: String(d.truy_thu || "").trim() || "cho", truy_thu_amount: Number(d.truy_thu_amount) || 0,
    };
    // Week columns feed the "Chi tiết" sheet; month-only cases are kept apart
    // so the tab can still list them when a month cell is clicked.
    if (cols.some((i) => dCols[i].kind === "week")) damageCases.push(c);
    else damageCasesMonthOnly.push(c);
  }
  for (const r of rows) {
    if (String(r.status || "").toLowerCase() !== "delivered") continue;
    const cols = dIdx.get(mondayOf(r.delivered_time));
    if (cols) for (const i of cols) ensure(gtc, r.client_name)[i]++;
  }
  // Selected clients; else the report's client list, then any other client
  // that had a case. The total adds up exactly the rows shown.
  const dmgClients = selection
    ? selection.map((c) => (ensure(dmg, c), ensure(gtc, c), c))
    : [...DAMAGE_CLIENTS, ...Object.keys(dmg).filter((c) => !DAMAGE_CLIENTS.includes(c) && dmg[c].some(Boolean))];
  const dmgTotal = dCols.map((_, i) => dmgClients.reduce((a, c) => a + dmg[c][i], 0));
  const gtcTotal = dCols.map((_, i) => dmgClients.reduce((a, c) => a + (gtc[c] ? gtc[c][i] : 0), 0));
  const damageRows = [
    ...dmgClients.map((c) => ({
      name: DISPLAY[c] || c, counts: dmg[c], gtc: gtc[c] || dCols.map(() => 0),
      rates: dmg[c].map((n, i) => pct(n, (gtc[c] || [])[i] || 0) ?? (n ? null : 0)),
    })),
    { name: SELECTED_TOTAL, total: true, grand: true, counts: dmgTotal, gtc: gtcTotal, rates: dmgTotal.map((n, i) => pct(n, gtcTotal[i])) },
  ];
  // Every Điện máy client with orders in the window (or a case), busiest first.
  const ontimeRows = shape("ontime", selection ? assembleSelected() : assemble(B2B_CLIENTS, B2C_CLIENTS));
  const fdRows = shape("fd", selection ? assembleSelected() : assemble(B2B_CLIENTS, FD_B2C_CLIENTS));
  const clientOptions = [...new Set([...Object.keys(periodOrders), ...Object.keys(dmg).filter((c) => dmg[c].some(Boolean))])]
    .map((c) => ({ name: c, label: DISPLAY[c] || c, orders: periodOrders[c] || 0, b2c: !!isB2C[c] }))
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));

  return {
    type,
    typeLabel: REPORT_TYPES[type],
    period: p.periodKey,
    // A period whose last week has not ended yet (user 27/09: the boss can ask
    // mid-week) — numbers are "so far", flagged in the label and the file.
    inProgress: isInProgress(p.lastMonday, now),
    periodLabel: isInProgress(p.lastMonday, now) ? `${p.periodLabel} · đang diễn ra` : p.periodLabel,
    dataAsOf: base.builtAt || null,
    computedAt: new Date(now).toISOString(),
    selection,
    clientOptions,
    ontime: { cols: withMondays(oCols), delta: p.ontime.delta, rows: ontimeRows },
    fd: { cols: withMondays(oCols), delta: p.ontime.delta, rows: fdRows },
    damage: { cols: withMondays(dCols), delta: p.damage.delta, rows: damageRows },
    ftl: { cols: publicCols(p.ftl.cols), clients: FTL_CLIENTS },
    insights: {
      damage: damageInsights(type, dCols, dmgClients, dmg, gtc, damageCases),
      ...flowInsights(type, period, oCols, rows, ontimeRows, fdRows, damagedCodes, now),
    },
    details: {
      damageCases: damageCases.sort(byWeekThenClient),
      damageCasesMonthOnly: damageCasesMonthOnly.sort(byWeekThenClient),
      fdOrders: fdOrders.sort(byWeekThenClient),
      lateOrders: lateOrders.sort(byWeekThenClient),
      ontimeRoutes,
    },
  };
}

const withMondays = (cols) => publicCols(cols).map((c, i) => ({ ...c, mondays: cols[i].mondays }));
const isReturnRow = (r) => String(r.deliver_type || "").toLowerCase() === "return"
  || (!r.deliver_type && /return/.test(String(r.status || "").toLowerCase()));
const orderRoute = (r) => ({
  kho_lay: r.warehouse_lay || r.kho_lay || "", from_province: r.from_province_name || "",
  kho_giao: r.warehouse_giao || r.kho_giao || "", to_province: r.to_province_name || "",
  weight_kg: Math.round((Number(r.weight) || 0) / 1000),
});
// Whole days between the deadline and the delivery day (both yyyy-mm-dd);
// a late order delivered on its deadline day (time of day) counts as 1.
function daysLate(delivered, deadline) {
  const a = Date.parse(delivered), b = Date.parse(deadline);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(1, Math.round((a - b) / DAY));
}

// ── Ontime + Hàng hoàn insight drafts (user 27/09), same rules as Bể vỡ:
// fixed sentence templates over computed numbers, never an AI model.
// Written for each NAMED client row + one total line ("Khác" only counts in
// the total). A route is called out when it has ≥ LATE_ROUTE_MIN late
// orders AND its on-time rate is ≥ LATE_ROUTE_GAP points below the client's
// own rate over the same weeks (user rule 27/09).
export const LATE_ROUTE_MIN = 3;
export const LATE_ROUTE_GAP = 5;
const FINAL = new Set(["delivered", "returned", "return", "cancel", "lost", "damage"]);
const pts = (a, b) => `${a >= b ? "+" : ""}${(a - b).toFixed(1).replace(".", ",")} điểm`;
function flowSpans(type, period, oCols) {
  const weekIdx = oCols.map((c, i) => (c.kind === "week" ? i : -1)).filter((i) => i >= 0);
  let focus;
  if (type === "month") focus = mondaysOfMonth(period);
  else if (type === "biweekly") focus = weekIdx.slice(-2).map((i) => oCols[i].mondays[0]);
  else focus = weekIdx.slice(-1).map((i) => oCols[i].mondays[0]);
  let prev;
  if (type === "month") { const pm = shiftMonth(period, -1); prev = pm >= DATA_START_MONTH ? mondaysOfMonth(pm) : []; }
  else prev = focus.map((m) => addDays(m, -7 * focus.length));
  const label = (ms) => (!ms.length ? "" : type === "month" ? `${ms[0].slice(0, 7)}` : ms.length > 1 ? `${weekLabel(ms[0])}–${weekLabel(ms[ms.length - 1])}` : weekLabel(ms[0]));
  return { focus, prev, span: label(focus), prevSpan: label(prev) };
}
function flowInsights(type, period, oCols, rows, ontimeRows, fdRows, damagedCodes, now) {
  const { focus, prev, span, prevSpan } = flowSpans(type, period, oCols);
  if (!focus.length) return {};
  const fSet = new Set(focus), pSet = new Set(prev);
  const immature = focus.filter((m) => !isMature(m, now));
  const stat = (clients) => {
    const set = new Set(clients);
    const s = { f: { n: 0, on: 0, late: 0, fd: 0, pending: 0, list: [], fdList: [] }, p: { n: 0, on: 0, late: 0, fd: 0 } };
    for (const r of rows) {
      if (!set.has(r.client_name)) continue;
      const m = mondayOf(r.pickup_time);
      const bucket = fSet.has(m) ? s.f : pSet.has(m) ? s.p : null;
      if (!bucket) continue;
      bucket.n++;
      const status = String(r.status || "").toLowerCase();
      const odr = String(r.odr_success || "").toLowerCase();
      if (status === "delivered" && odr === "ontime") bucket.on++;
      if (status === "delivered" && odr === "late") { bucket.late++; if (bucket === s.f) bucket.list.push(r); }
      if (isReturnRow(r)) { bucket.fd++; if (bucket === s.f) bucket.fdList.push(r); }
      if (bucket === s.f && !FINAL.has(status) && immature.includes(m)) bucket.pending++;
    }
    return s;
  };
  const rate = (b) => (b.on + b.late ? (b.on / (b.on + b.late)) * 100 : null);
  const pctTxt = (x) => (x == null ? "—" : `${x.toFixed(1).replace(".", ",")}%`);
  const named = (rowsOf) => rowsOf.filter((r) => !r.total && r.name !== "Khác" && r.clients && r.clients.length === 1);
  const grand = (rowsOf) => rowsOf.find((r) => r.grand);
  const wk = (r) => weekLabel(mondayOf(r.pickup_time));
  const pendingNote = (s) => (immature.length && s.f.pending ? `⏳ ${immature.map(weekLabel).join(", ")} chưa chín: còn ${vnInt(s.f.pending)} đơn chưa giao xong — % còn thay đổi.` : null);

  // Ontime
  const ontime = { span, prevSpan, routeRule: `≥ ${LATE_ROUTE_MIN} đơn trễ và thấp hơn % chung của khách ≥ ${LATE_ROUTE_GAP} điểm`, clients: [] };
  for (const row of named(ontimeRows)) {
    const c = row.clients[0];
    const s = stat([c]);
    const fr = rate(s.f), pr = rate(s.p);
    if (fr == null && !s.f.n) continue;
    const lines = [];
    let head = `${row.name}: ${pctTxt(fr)} ontime trong ${span} (${vnInt(s.f.late)} đơn trễ / ${vnInt(s.f.on + s.f.late)} đơn đã giao được tính)`;
    if (prev.length) head += pr == null ? `; ${prevSpan}: chưa có số` : `; ${prevSpan}: ${pctTxt(pr)} → ${fr == null ? "—" : pts(fr, pr)}`;
    lines.push(head + ".");
    const pn = pendingNote(s); if (pn) lines.push(pn);
    if (s.f.late) {
      const d = s.f.list.map((r) => daysLate(String(r.delivered_time).slice(0, 10), String(r.deadline_plus || r.deadline || "").slice(0, 10))).filter((x) => x != null);
      const b1 = d.filter((x) => x === 1).length, b2 = d.filter((x) => x === 2).length, b3 = d.filter((x) => x >= 3).length;
      const avg = d.length ? d.reduce((a, x) => a + x, 0) / d.length : 0;
      lines.push(`Trễ bao lâu: ${b1} đơn 1 ngày, ${b2} đơn 2 ngày, ${b3} đơn từ 3 ngày (trung bình ${avg.toFixed(1).replace(".", ",")} ngày).`);
      // routes over the focus weeks
      const rt = new Map();
      for (const r of rows) {
        if (r.client_name !== c || !fSet.has(mondayOf(r.pickup_time))) continue;
        const status = String(r.status || "").toLowerCase(), odr = String(r.odr_success || "").toLowerCase();
        if (status !== "delivered" || (odr !== "ontime" && odr !== "late")) continue;
        const k = `${shortWh(r.warehouse_lay || r.kho_lay)} → ${shortWh(r.warehouse_giao || r.kho_giao)}`;
        const o = rt.get(k) || { n: 0, late: 0 }; o.n++; if (odr === "late") o.late++; rt.set(k, o);
      }
      const hot = [...rt.entries()].map(([k, o]) => ({ k, ...o, rate: ((o.n - o.late) / o.n) * 100 }))
        .filter((o) => o.late >= LATE_ROUTE_MIN && fr != null && o.rate <= fr - LATE_ROUTE_GAP)
        .sort((a, b) => b.late - a.late || a.rate - b.rate);
      if (hot.length) lines.push(`Tuyến trễ nổi bật: ${hot.slice(0, 4).map((o) => `${o.k} ${o.late}/${o.n} trễ (${pctTxt(o.rate)})`).join("; ")}.`);
      else lines.push(`Không có tuyến trễ nổi bật (${ontime.routeRule}).`);
    }
    ontime.clients.push({ client: c, label: row.name, lines, late: s.f.late });
  }
  const og = grand(ontimeRows);
  if (og) {
    const s = stat(og.clients);
    ontime.total = `${og.name}: ${pctTxt(rate(s.f))} ontime trong ${span} (${vnInt(s.f.late)} đơn trễ / ${vnInt(s.f.on + s.f.late)} đơn đã giao được tính)`
      + (prev.length ? `; ${prevSpan}: ${pctTxt(rate(s.p))}${rate(s.f) != null && rate(s.p) != null ? ` → ${pts(rate(s.f), rate(s.p))}` : ""}.` : ".");
    ontime.pending = pendingNote(s);
  }

  // Hàng hoàn
  const fd = { span, prevSpan, note: "Dữ liệu nguồn không có lý do hoàn — gợi ý chỉ nêu nơi hoàn và đối chiếu ca bể Rillnet.", clients: [], none: [] };
  for (const row of named(fdRows)) {
    const c = row.clients[0];
    const s = stat([c]);
    if (!s.f.fd) { if (s.f.n) fd.none.push(row.name); continue; }
    const lines = [];
    let head = `${row.name}: ${vnInt(s.f.fd)} đơn hoàn trong ${span}, ${vnPct(s.f.fd, s.f.n)} trên ${vnInt(s.f.n)} đơn lấy`;
    if (prev.length) head += `; ${prevSpan}: ${vnInt(s.p.fd)} đơn (${vnPct(s.p.fd, s.p.n)}) → ${s.f.fd > s.p.fd ? `tăng ${s.f.fd - s.p.fd}` : s.f.fd < s.p.fd ? `giảm ${s.p.fd - s.f.fd}` : "không đổi"}`;
    lines.push(head + ".");
    const byWeek = tally(s.f.fdList, wk);
    if (focus.length > 1) lines.push(`Theo tuần lấy: ${byWeek.sort((a, b) => a[0].localeCompare(b[0])).map(([w, k]) => `${w}: ${k}`).join(", ")}.`);
    const byHub = tally(s.f.fdList, (r) => `${shortWh(r.warehouse_giao || r.kho_giao)}${r.to_province_name ? ` (${r.to_province_name})` : ""}`);
    lines.push(`Kho giao hoàn nhiều: ${byHub.slice(0, 3).map(([h, k]) => `${h} ${k}`).join(", ")}${byHub.length > 3 ? ", …" : ""}.`);
    const byProv = tally(s.f.fdList, (r) => r.to_province_name);
    if (byProv.length > 1) lines.push(`Tỉnh giao: ${byProv.slice(0, 3).map(([h, k]) => `${h} ${k}`).join(", ")}${byProv.length > 3 ? ", …" : ""}.`);
    const withDmg = s.f.fdList.filter((r) => damagedCodes.has(String(r.order_code || "").trim())).length;
    lines.push(`${withDmg}/${s.f.fd} đơn hoàn có ca bể trên Rillnet.`);
    fd.clients.push({ client: c, label: row.name, lines, fd: s.f.fd });
  }
  fd.clients.sort((a, b) => b.fd - a.fd || a.label.localeCompare(b.label));
  const fg = grand(fdRows);
  if (fg) {
    const s = stat(fg.clients);
    const withDmg = s.f.fdList.filter((r) => damagedCodes.has(String(r.order_code || "").trim())).length;
    fd.total = `${fg.name}: ${vnInt(s.f.fd)} đơn hoàn trong ${span}, ${vnPct(s.f.fd, s.f.n)} trên ${vnInt(s.f.n)} đơn lấy`
      + (prev.length ? `; ${prevSpan}: ${vnInt(s.p.fd)} đơn (${vnPct(s.p.fd, s.p.n)})` : "") + `. ${withDmg}/${s.f.fd} đơn hoàn có ca bể trên Rillnet.`;
    fd.pending = pendingNote(s);
  }
  return { ontime, fd };
}

const byWeekThenClient = (a, b) => a.monday.localeCompare(b.monday) || a.client.localeCompare(b.client) || a.order_code.localeCompare(b.order_code);

// ── Damage insight drafts (user 27/09). Written from the computed numbers
// with fixed sentence templates — never by an AI model, which has invented
// figures before (SYSTEM_SPEC incidents #9, #30). The user edits them before
// sending. "Focus" = the weeks the report is about; "prev" = the same span
// right before it.
const SMALL_GTC = 50;
const vnInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const vnPct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "—");
const shortWh = (s) => String(s || "").replace(/^Kho Giao Hàng Nặng - /, "").replace(/^Key Account Warehouse /, "KA WH ").trim() || "(không rõ)";
function tally(list, keyFn) {
  const m = new Map();
  for (const x of list) { const k = keyFn(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function focusSpans(type, dCols) {
  const idx = dCols.map((c, i) => i);
  if (type === "biweekly") return { focus: idx.slice(-2), prev: idx.slice(-4, -2) };
  if (type === "week") return { focus: idx.slice(-1), prev: idx.slice(-2, -1) };
  const months = idx.filter((i) => dCols[i].kind === "month");
  return { focus: months.slice(-1), prev: months.slice(-2, -1) };
}
function damageInsights(type, dCols, clients, dmg, gtc, cases) {
  const { focus, prev } = focusSpans(type, dCols);
  if (!focus.length) return null;
  const span = (ix) => (ix.length > 1 ? `${dCols[ix[0]].label}–${dCols[ix[ix.length - 1]].label}` : ix.length ? dCols[ix[0]].label : "");
  const focusMondays = new Set(focus.flatMap((i) => dCols[i].mondays));
  const firstFocusMonday = [...focusMondays].sort()[0];
  const sumAt = (arr, ix) => ix.reduce((a, i) => a + ((arr || [])[i] || 0), 0);
  const out = { span: span(focus), prevSpan: span(prev), small: SMALL_GTC, clients: [], none: [] };
  let tN = 0, tG = 0, tPN = 0, tPG = 0;
  for (const c of clients) {
    const n = sumAt(dmg[c], focus), g = sumAt(gtc[c], focus), pn = sumAt(dmg[c], prev), pg = sumAt(gtc[c], prev);
    tN += n; tG += g; tPN += pn; tPG += pg;
    const label = DISPLAY[c] || c;
    if (!n) { out.none.push(label); continue; }
    const list = cases.filter((x) => x.client === c && focusMondays.has(x.monday));
    const lines = [];
    const perWeek = focus.length > 1 ? ` (${focus.map((i) => `${dCols[i].label}: ${(dmg[c] || [])[i] || 0}`).join(", ")})` : "";
    let head = `${label}: ${n} ca bể trong ${out.span}${perWeek}, ${vnPct(n, g)} trên ${vnInt(g)} đơn giao thành công`;
    if (prev.length) head += `; ${out.prevSpan}: ${pn} ca (${vnPct(pn, pg)}) → ${n > pn ? `tăng ${n - pn} ca` : n < pn ? `giảm ${pn - n} ca` : "không đổi"}`;
    lines.push(head + ".");
    if (g < SMALL_GTC) lines.push(`⚠ Mẫu số nhỏ (${vnInt(g)} đơn giao) — % dao động mạnh, nên nhìn số ca.`);
    const byCreated = tally(list, (x) => x.created_week || x.pickup_week);
    const early = list.filter((x) => { const m = mondayOf(x.created_date || x.pickup_date); return m && m < firstFocusMonday; }).length;
    if (byCreated.length) lines.push(`Đơn tạo: ${byCreated.slice(0, 4).map(([w, k]) => `${k} ca ${w}`).join(", ")}${byCreated.length > 4 ? ", …" : ""}${early ? ` — ${early} ca là đơn tạo trước kỳ, phát hiện muộn` : ""}.`);
    const byFrom = tally(list, (x) => shortWh(x.kho_lay));
    if (byFrom.length) lines.push(`Kho lấy: ${byFrom.slice(0, 3).map(([w, k]) => `${w} ${k}/${n}`).join(", ")}.`);
    const routes = tally(list, (x) => `${shortWh(x.kho_lay)} → ${shortWh(x.kho_giao)}`).filter(([, k]) => k >= 2);
    if (routes.length) lines.push(`Tuyến lặp lại: ${routes.slice(0, 3).map(([r, k]) => `${r} (${k} ca)`).join("; ")}.`);
    const byDetect = tally(list, (x) => shortWh(x.warehouse));
    if (byDetect.length) lines.push(`Kho phát hiện: ${byDetect.slice(0, 4).map(([w, k]) => `${w} ${k}`).join(", ")}.`);
    const byLeg = tally(list, (x) => x.leg);
    if (byLeg.length) lines.push(`Chặng nghi vấn: ${byLeg.slice(0, 2).map(([w, k]) => `${w} ${k}/${n}`).join(", ")}.`);
    const returned = list.filter((x) => /return/i.test(x.order_status)).length;
    if (returned) lines.push(`${returned}/${n} đơn đã bị hoàn.`);
    const comp = list.filter((x) => x.compensated).length;
    const tt = { co: list.filter((x) => x.truy_thu === "co"), khong: list.filter((x) => x.truy_thu === "khong").length, cho: list.filter((x) => x.truy_thu === "cho").length };
    const ttAmount = tt.co.reduce((a, x) => a + x.truy_thu_amount, 0);
    lines.push(`Đền bù: ${comp} ca đã chốt; truy thu: ${tt.co.length} có${tt.co.length ? ` (${vnInt(ttAmount)}đ)` : ""}, ${tt.khong} không, ${tt.cho} chờ chốt.`);
    out.clients.push({ client: c, label, cases: n, gtc: g, lines });
  }
  out.clients.sort((a, b) => b.cases - a.cases || a.label.localeCompare(b.label));
  out.total = `Tổng các khách trong bảng: ${tN} ca bể trong ${out.span}, ${vnPct(tN, tG)} trên ${vnInt(tG)} đơn giao thành công`
    + (prev.length ? `; ${out.prevSpan}: ${tPN} ca (${vnPct(tPN, tPG)}).` : ".");
  return out;
}

// Default period for a type: last completed week / last completed month.
// The 2-week report is sent in EVEN weeks and covers the two weeks before
// (user 27/09: report W30 = W28–W29 … report W40 = W38–W39), so a biweekly
// period always ends on an ODD week.
export const isBiweeklyEnd = (monday) => isoWeekOf(monday).week % 2 === 1;
export function defaultPeriod(type, now = Date.now()) {
  if (type === "month") return lastCompletedMonth(now);
  let mon = lastCompletedWeekMonday(now);
  if (type === "biweekly" && !isBiweeklyEnd(mon)) mon = addDays(mon, -7);
  return weekKey(mon);
}
export function normalizePeriod(type, raw) {
  if (type === "month") return /^\d{4}-\d{2}$/.test(String(raw || "")) ? raw : null;
  const mon = mondayOfIsoWeek(raw);
  if (!mon || (type === "biweekly" && !isBiweeklyEnd(mon))) return null;
  return weekKey(mon);
}
