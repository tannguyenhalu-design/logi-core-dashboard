/**
 * lib/exceptions.js — "Cần can thiệp ngay hôm nay" on the LTL overview
 * (user decision 2026-09-27). At most 3 issues, ranked by how many orders
 * they affect, each with the numbers behind it and the orders to chase.
 *
 *   (a) route late past SLA: a pickup warehouse → delivery province route
 *       with the most open orders that are overdue (the "đơn treo" rule) or
 *       due today and not delivered, at least ROUTE_MIN orders;
 *   (b) client damage spike: last 7 days (cases by detection date / orders
 *       delivered by delivery date — the company-report definition) at
 *       least SPIKE_FACTOR × the rate of the 28 days before, and at least
 *       SPIKE_MIN_CASES cases in the 7 days;
 *   (c) project on-time drop: the existing projectDrops rule (≥ 10 points,
 *       ≥ 5 evaluated orders each side), affected = late orders now.
 * Scope = the "Cần chú ý" row: project / pickup province / viewAs, never the
 * month filter ("today" issues matter whatever month is on screen).
 */
export const ROUTE_MIN = 5;
export const SPIKE_FACTOR = 2;
export const SPIKE_MIN_CASES = 3;
export const SPIKE_DAYS = 7;
export const SPIKE_BASE_DAYS = 28;
const MAX_ITEMS = 3;
const MAX_ORDERS = 60;

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const wh = (r, a, b) => String(r[a] || r[b] || "").trim();
const shortWh = (s) => String(s || "")
  .replace(/^Kho Giao Hàng Nặng - /, "")
  .replace(/^Key Account Warehouse /, "KA WH ")
  .replace(/^Kho B2B - /, "B2B ")
  .trim()
  .replace(/^KA WH Ho Chi Minh$/i, "KA-HCM")
  .replace(/^KA WH H[aà] N[oộ]i?$/i, "KA-HN")
  .replace(/^KA WH [ĐD][aà] N[aẵ]ng?$/i, "KA-ĐN");
const vnPct = (x) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
function caseDay(v) {
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})|^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return m[1] ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : `${m[4]}-${m[5]}-${m[6]}`;
}

/**
 * @param stuck    open overdue orders in scope (with overdue days)
 * @param due      open orders due today in scope
 * @param rows     every order in scope (project / origin / viewAs, all months)
 * @param damage   counted Rillnet cases in scope (viewAs)
 * @param drops    projectDrops items of the current comparison
 * @param today    yyyy-mm-dd (Vietnam)
 * @param overdueDays (row, today) → days past the SLA date
 */
export function computeExceptions({ stuck, due, rows, damage, drops, dropsLabel, today, overdueDays }) {
  const items = [];

  // (a) routes late past SLA
  const routes = new Map();
  const addRoute = (r, kind) => {
    const from = wh(r, "warehouse_lay", "kho_lay") || String(r.from_province_name || "").trim() || "?";
    const to = String(r.to_province_name || "").trim() || "?";
    const key = `${from}→${to}`;
    const o = routes.get(key) || { from, to, overdue: 0, dueToday: 0, maxDays: 0, clients: {}, orders: [] };
    if (kind === "overdue") {
      o.overdue++;
      o.maxDays = Math.max(o.maxDays, overdueDays(r, today) || 0);
    } else o.dueToday++;
    o.clients[r.client_name] = (o.clients[r.client_name] || 0) + 1;
    {
      o.orders.push({
        order_code: r.order_code, client: r.client_name, status: r.status,
        deadline: String(r.deadline_plus || "").slice(0, 10), overdue_days: kind === "overdue" ? overdueDays(r, today) : 0,
        kho_giao: wh(r, "warehouse_giao", "kho_giao"), to_province: to,
      });
    }
    routes.set(key, o);
  };
  for (const r of stuck) addRoute(r, "overdue");
  for (const r of due) addRoute(r, "due");
  for (const o of routes.values()) {
    const n = o.overdue + o.dueToday;
    if (n < ROUTE_MIN) continue;
    const topClients = Object.entries(o.clients).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, k]) => `${c} ${k}`).join(", ");
    items.push({
      type: "route", affected: n,
      title: `Tuyến ${shortWh(o.from)} → ${o.to}: ${n} đơn trễ SLA`,
      why: `${o.overdue} đơn đã quá hạn (lâu nhất ${o.maxDays} ngày)${o.dueToday ? ` + ${o.dueToday} đơn đến hạn hôm nay chưa giao` : ""} · ${topClients}`,
      action: "Gọi kho giao / điều phối tuyến",
      // longest overdue first, then cut — the list shows who to chase first
      orders: o.orders.sort((a, b) => b.overdue_days - a.overdue_days || String(a.order_code).localeCompare(String(b.order_code))).slice(0, MAX_ORDERS),
    });
  }

  // (b) client damage spikes
  const t = Date.parse(today);
  const recentFrom = iso(t - (SPIKE_DAYS - 1) * DAY);
  const baseFrom = iso(t - (SPIKE_DAYS + SPIKE_BASE_DAYS - 1) * DAY), baseTo = iso(t - SPIKE_DAYS * DAY);
  const byCode = new Map();
  const gtc = {};
  for (const r of rows) {
    byCode.set(String(r.order_code || "").trim(), r);
    if (String(r.status || "").toLowerCase() !== "delivered") continue;
    const d = String(r.delivered_time || "").slice(0, 10);
    const g = (gtc[r.client_name] = gtc[r.client_name] || { recent: 0, base: 0 });
    if (d >= recentFrom && d <= today) g.recent++;
    else if (d >= baseFrom && d <= baseTo) g.base++;
  }
  const cases = {};
  for (const c of damage) {
    const r = byCode.get(String(c.order_code || "").trim());
    if (!r) continue;
    const d = caseDay(c.case_date);
    const k = (cases[r.client_name] = cases[r.client_name] || { recent: [], base: 0 });
    if (d >= recentFrom && d <= today) k.recent.push({ c, r });
    else if (d >= baseFrom && d <= baseTo) k.base++;
  }
  for (const [client, k] of Object.entries(cases)) {
    const g = gtc[client] || { recent: 0, base: 0 };
    const n = k.recent.length;
    if (n < SPIKE_MIN_CASES || !g.recent) continue;
    const rate = n / g.recent;
    const baseRate = g.base ? k.base / g.base : 0;
    if (baseRate > 0 && rate < SPIKE_FACTOR * baseRate) continue;
    const ratio = baseRate > 0 ? `${(rate / baseRate).toFixed(1).replace(".", ",")}×` : "trước đó 0 ca";
    items.push({
      type: "damage", affected: n,
      title: `${client}: bể vỡ tăng đột biến — ${n} ca trong ${SPIKE_DAYS} ngày`,
      why: `${vnPct(rate)} trên ${g.recent} đơn giao (7 ngày) so với ${vnPct(baseRate)} của ${SPIKE_BASE_DAYS} ngày trước (${k.base} ca / ${g.base} đơn) → ${ratio}`,
      action: "Kiểm tra đóng gói / chặng trung chuyển với khách",
      orders: k.recent.slice(0, MAX_ORDERS).map(({ c, r }) => ({
        order_code: c.order_code, client, case_date: c.case_date, leg: c.suspected_leg || "",
        warehouse: c.detected_at_warehouse || "", kho_lay: wh(r, "warehouse_lay", "kho_lay"), to_province: r.to_province_name || "",
      })),
    });
  }

  // (c) project on-time drops (same "kỳ trước" as the KPI delta)
  for (const d of drops || []) {
    const late = Math.round(d.curN * (1 - d.cur / 100));
    items.push({
      type: "ontime", affected: late, project: d.name,
      title: `${d.name}: on-time giảm ${Math.abs(d.deltaPoints).toString().replace(".", ",")} điểm`,
      why: `${String(d.cur).replace(".", ",")}% (${late} đơn trễ / ${d.curN}) so với ${String(d.prev).replace(".", ",")}% ${dropsLabel ? `(${dropsLabel})` : "kỳ trước"}`,
      action: "Lọc dự án để xem tuyến / kho gây trễ",
      orders: [],
    });
  }

  items.sort((a, b) => b.affected - a.affected || a.title.localeCompare(b.title));
  return {
    items: items.slice(0, MAX_ITEMS),
    candidates: items.length,
    rules: {
      route: `≥ ${ROUTE_MIN} đơn quá hạn + đến hạn hôm nay chưa giao trên 1 tuyến kho lấy → tỉnh giao`,
      damage: `${SPIKE_DAYS} ngày gần nhất ≥ ${SPIKE_FACTOR}× tỷ lệ ${SPIKE_BASE_DAYS} ngày trước (ca / đơn giao) và ≥ ${SPIKE_MIN_CASES} ca`,
      ontime: "on-time giảm ≥ 10 điểm so kỳ trước (≥ 5 đơn mỗi kỳ)",
    },
    windows: { recent: [recentFrom, today], base: [baseFrom, baseTo] },
  };
}
