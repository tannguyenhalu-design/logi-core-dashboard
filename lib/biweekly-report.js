/**
 * lib/biweekly-report.js — "Quản lý chất lượng ngành hàng điện tử / điện máy",
 * the user's bi-weekly company report (approved 2026-09-27), computed from the
 * same LTL snapshot + Rillnet data as the dashboard.
 *
 * Definitions were reverse-engineered from the user's own W35–W37 report and
 * matched on real data (see SYSTEM_SPEC incident/rules section):
 *  - Week = ISO week (Mon–Sun). "Tháng" column = the ISO weeks whose MONDAY
 *    falls in that month (2026-08 = weeks of 03/08 … 31/08) — matched all 7
 *    clients exactly (LG 2,582, Aqua 3,481…).
 *  - # đơn LTC = orders by the ISO week of pickup_time.
 *  - % ontime = ontime / (ontime + late) over DELIVERED orders only.
 *  - "Khác" rows split B2B / B2C by raw_ontime.is_B2C.
 *  - # đơn FD = deliver_type "return" (by pickup week); % FD = FD / # đơn LTC.
 *  - Bể vỡ = Rillnet "Báo cáo bể vỡ" cases (countedDamage), week of the case
 *    (ngày phát hiện); % = cases / GTC (delivered orders by delivery week).
 *  - FTL: no data source with SLA yet — the sheet is a blank template the
 *    user fills in (user decision 2026-09-27).
 */
import { countedDamage } from "./damage-rules";

export const B2B_CLIENTS = ["LG LTL", "Samsung SDS DAN", "PSD Miền Nam", "Hồng Đạt MXT", "Hồng Đạt"];
export const B2C_CLIENTS = ["Aqua B2C", "Casper"];
// The user's "Hàng hoàn" table lists Nguyễn Kim Miền Bắc on its own row (its
// FD rate is the outlier), unlike the Ontime table.
export const FD_B2C_CLIENTS = ["Aqua B2C", "Casper", "Nguyễn Kim Miền Bắc"];
export const DAMAGE_CLIENTS = ["LG LTL", "PSD Miền Nam", "DigiWorld", "Nguyễn Kim Miền Bắc", "Nguyễn Kim Miền Nam", "Aqua B2C", "Casper"];
export const FTL_CLIENTS = ["LG Pantos FTL", "Aqua B2B FTL", "Karofi FTL", "Thợ ĐMX FTL", "Hisense FTL", "DGW FTL Tỉnh", "DGW FTL Nội thành", "Karofi Livotec FTL"];
const DISPLAY = { DigiWorld: "Digiworld" };

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

export function lastCompletedWeekMonday(now = Date.now()) {
  const today = ymd(new Date(now + 7 * 3600 * 1000));
  return ymd(new Date(Date.parse(mondayOf(today)) - 7 * DAY));
}

const weekLabel = (monday) => `W${isoWeekOf(monday).week}`;
const addDays = (monday, n) => ymd(new Date(Date.parse(monday) + n * DAY));
const isMature = (lastMonday, now) => now >= Date.parse(lastMonday) + MATURE_AFTER_DAYS * DAY;

function periods(endMonday, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(endMonday, -7 * i));
  return out;
}

// "Tháng" = the month before the end week's month; its weeks = Mondays in it.
function monthPeriod(endMonday) {
  const d = new Date(endMonday + "T00:00:00Z");
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const key = first.toISOString().slice(0, 7);
  const mondays = [];
  let mon = mondayOf(ymd(first));
  if (mon < ymd(first)) mon = addDays(mon, 7);
  for (; mon.slice(0, 7) === key; mon = addDays(mon, 7)) mondays.push(mon);
  return { key, mondays };
}

const pct = (a, b) => (b > 0 ? a / b : null);

export function computeBiweekly(base, endMonday, now = Date.now()) {
  const rows = (base.ltlRows || []).filter((r) => String(r.pickup_time || "").trim());
  const month = monthPeriod(endMonday);
  const weeks3 = periods(endMonday, 3);
  const weeks4 = periods(endMonday, 4);

  // ── Ontime + FD: buckets = [month, w-2, w-1, w]
  const ontimeCols = [
    { key: "month", label: month.key, mondays: month.mondays, mature: isMature(month.mondays[month.mondays.length - 1], now) },
    ...weeks3.map((m) => ({ key: m, label: weekLabel(m), mondays: [m], mature: isMature(m, now) })),
  ];
  const colOf = new Map();
  ontimeCols.forEach((c, i) => c.mondays.forEach((m) => { if (!colOf.has(m)) colOf.set(m, []); colOf.get(m).push(i); }));

  const blank = () => ontimeCols.map(() => ({ n: 0, ontime: 0, late: 0, fd: 0 }));
  const perClient = {}; // client → buckets
  const isB2C = {};     // client → raw_ontime.is_B2C
  const fdOrders = [];

  for (const r of rows) {
    const cols = colOf.get(mondayOf(r.pickup_time));
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
    if (isFd && cols.some((i) => i > 0)) {
      fdOrders.push({ week: weekLabel(mondayOf(r.pickup_time)), order_code: r.order_code, client, pickup_time: r.pickup_time, status: r.status });
    }
  }

  const sum = (list) => ontimeCols.map((_, i) => list.reduce((a, g) => ({
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

  // ── Damage: 4 weeks by case week, % over GTC (delivered by delivery week)
  const byCode = new Map(rows.map((r) => [String(r.order_code || "").trim(), r]));
  const wIdx = new Map(weeks4.map((m, i) => [m, i]));
  const dmg = {}; const gtc = {};
  const ensure = (o, k) => (o[k] = o[k] || weeks4.map(() => 0));
  DAMAGE_CLIENTS.forEach((c) => { ensure(dmg, c); ensure(gtc, c); });
  const damageCases = [];
  for (const d of countedDamage(base.rawDamageCauses || [])) {
    const r = byCode.get(String(d.order_code || "").trim());
    if (!r) continue;
    const i = wIdx.get(mondayOf(d.case_date));
    if (i === undefined) continue;
    ensure(dmg, r.client_name)[i]++;
    damageCases.push({
      week: weekLabel(weeks4[i]), order_code: d.order_code, client: r.client_name, case_date: d.case_date,
      leg: d.suspected_leg || "", warehouse: d.detected_at_warehouse || "",
      compensated: String(d.compensated ?? "") === "1",
      truy_thu: String(d.truy_thu || "").trim() || "cho", truy_thu_amount: Number(d.truy_thu_amount) || 0,
    });
  }
  for (const r of rows) {
    if (String(r.status || "").toLowerCase() !== "delivered") continue;
    const i = wIdx.get(mondayOf(r.delivered_time));
    if (i !== undefined) ensure(gtc, r.client_name)[i]++;
  }
  // Report's client list first, then any other client that had a case.
  const dmgClients = [...DAMAGE_CLIENTS, ...Object.keys(dmg).filter((c) => !DAMAGE_CLIENTS.includes(c) && dmg[c].some(Boolean))];
  const dmgTotal = weeks4.map((_, i) => dmgClients.reduce((a, c) => a + dmg[c][i], 0));
  const gtcTotal = weeks4.map((_, i) => dmgClients.reduce((a, c) => a + (gtc[c] ? gtc[c][i] : 0), 0));
  const damageRows = [
    ...dmgClients.map((c) => ({
      name: DISPLAY[c] || c, counts: dmg[c], gtc: gtc[c] || weeks4.map(() => 0),
      rates: dmg[c].map((n, i) => pct(n, (gtc[c] || [])[i] || 0) ?? (n ? null : 0)),
    })),
    { name: "Tổng Điện máy", total: true, grand: true, counts: dmgTotal, gtc: gtcTotal, rates: dmgTotal.map((n, i) => pct(n, gtcTotal[i])) },
  ];

  const weekCols = (list) => list.map((m) => ({ key: m, label: weekLabel(m), mondays: [m], mature: isMature(m, now), from: m, to: addDays(m, 6) }));

  return {
    endWeek: `${isoWeekOf(endMonday).year}-W${String(isoWeekOf(endMonday).week).padStart(2, "0")}`,
    endMonday,
    dataAsOf: base.builtAt || null,
    ontime: { cols: ontimeCols.map(({ key, label, mature }) => ({ key, label, mature })), rows: shape("ontime", assemble(B2B_CLIENTS, B2C_CLIENTS)) },
    fd: { cols: ontimeCols.map(({ key, label, mature }) => ({ key, label, mature })), rows: shape("fd", assemble(B2B_CLIENTS, FD_B2C_CLIENTS)) },
    damage: { cols: weekCols(weeks4).map(({ key, label, mature }) => ({ key, label, mature })), rows: damageRows },
    ftl: { cols: weekCols(weeks4).map(({ key, label }) => ({ key, label })), clients: FTL_CLIENTS },
    details: {
      damageCases: damageCases.sort((a, b) => a.week.localeCompare(b.week) || a.client.localeCompare(b.client)),
      fdOrders: fdOrders.sort((a, b) => a.week.localeCompare(b.week) || a.client.localeCompare(b.client)),
    },
  };
}
