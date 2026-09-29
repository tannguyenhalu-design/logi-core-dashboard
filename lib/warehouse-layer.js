/**
 * lib/warehouse-layer.js — "Kho" layer of the Bản đồ tỉnh thành view
 * (Kế hoạch D · bước 2a, 29/09).
 *
 * Inputs (Sheet tabs copied into the LTL snapshot):
 *  - Warehouses: 125 main GHN warehouses (id, name, type, lat/lng, address…)
 *  - WarehouseAlias: every warehouse name seen in the order data → lat/lng +
 *    a location status (chắc chắn / user xác nhận / ước lượng / bưu cục —
 *    chưa nối / chưa có vị trí / bỏ qua).
 *
 * Output: one entry per map point ("site") — names sharing the same
 * coordinates are merged (e.g. the KCN Xuyên Á cluster: KA WH HCM + KGHN HCM
 * + KGHN Đức Hòa + B2B Đức Hòa) — with the Điện máy load per day as delivery
 * warehouse (kho giao) and pickup warehouse (kho lấy), plus what could not be
 * placed. Only the Điện máy LTL orders of this dashboard are counted: this is
 * NOT the warehouse's total load (capacity comparison waits for bước 2b/2c).
 *
 * Display only — reads the already-filtered rows, changes no other number.
 */

// lat/lng → SVG units of VietnamMap (viewBox 0 0 560 1000). Least-squares fit
// of each province's mean post-office position (GHN file) to lib/centroids.json,
// then tuned so warehouses fall inside their province (SYSTEM_SPEC mục 19):
// 85/92 KGHN inside, the rest ≤ 6.4 km off; ~1.73 km per SVG unit.
const PROJ_X = [72.9142, -0.4864, -7436.0419]; // · lng, · lat, + c
const PROJ_Y = [-0.1348, -64.1577, 1537.2989];
export function projectLatLng(lat, lng) {
  return [PROJ_X[0] * lng + PROJ_X[1] * lat + PROJ_X[2], PROJ_Y[0] * lng + PROJ_Y[1] * lat + PROJ_Y[2]];
}

const TOP_N = 5;
const UNPLACED_LIST = 40;
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const num = (v) => (v === "" || v == null ? NaN : Number(v));
const dayOf = (v) => {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return m[0].includes("/") ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : `${m[1]}-${m[2]}-${m[3]}`;
};
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// Unplaced groups, in the order the list shows them.
const UNPLACED_KIND = {
  "bưu cục — chưa nối": "buuCuc",
  "chưa có vị trí": "noLocation",
  "bỏ qua": "ignored",
};

/**
 * Name → site index. Cached per snapshot by the caller (it only depends on
 * the two Sheet tabs).
 */
export function buildWarehouseIndex(rawWarehouses = [], rawAlias = []) {
  const whById = new Map();
  for (const w of rawWarehouses) {
    const id = String(w.warehouse_id ?? "").trim();
    if (id) whById.set(id, w);
  }
  const sites = new Map(); // key → site
  const byName = new Map(); // norm(name) → { name, site | null, kind }
  for (const a of rawAlias) {
    const name = String(a.ten_kho_trong_don || "").trim();
    if (!name) continue;
    const status = String(a.trang_thai || "").trim();
    const lat = num(a.lat), lng = num(a.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || UNPLACED_KIND[status]) {
      byName.set(norm(name), { name, site: null, kind: UNPLACED_KIND[status] || "noLocation", status });
      continue;
    }
    // Same point (±~10 m) = one dot on the map.
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    let site = sites.get(key);
    if (!site) {
      const [x, y] = projectLatLng(lat, lng);
      site = { id: key, lat, lng, x: r2(x), y: r2(y), names: [], estimated: false };
      sites.set(key, site);
    }
    const id = String(a.warehouse_id ?? "").trim();
    const w = id ? whById.get(id) : null;
    site.names.push({
      name, status, note: String(a.ghi_chu || "").trim(),
      warehouseId: id || null,
      fileName: String(a.ten_trong_file_kho || w?.warehouse_name || "").trim() || null,
      type: String(w?.loai_kho || "").trim() || guessType(name),
      province: String(a.tinh || w?.province || "").trim(),
      district: String(w?.district || "").trim(),
      address: String(w?.address || "").trim(),
    });
    if (status === "ước lượng") site.estimated = true;
    byName.set(norm(name), { name, site, kind: null, status });
  }
  return { sites: [...sites.values()], byName };
}

function guessType(name) {
  const n = norm(name);
  if (n.includes("b2b")) return "Kho B2B";
  if (n.includes("key account")) return "KA WH";
  if (n.startsWith("(")) return "Bưu cục";
  if (n.includes("giao hàng nặng")) return "Kho giao hàng nặng";
  return "";
}

function newAcc() {
  return { orders: 0, grams: 0, days: new Map(), clients: new Map(), routes: new Map(), names: new Map() };
}

function bump(map, k, n = 1) { if (k) map.set(k, (map.get(k) || 0) + n); }

// Per-day stats over `dayList` (every calendar day of the period, zeros too):
// mean = total ÷ days, P90 = nearest-rank 90th percentile, max = busiest day.
function dayStats(acc, dayList) {
  const n = dayList.length;
  const ord = dayList.map((d) => acc.days.get(d)?.o || 0);
  const kg = dayList.map((d) => (acc.days.get(d)?.g || 0) / 1000);
  const p90 = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
  };
  let maxI = 0;
  for (let i = 1; i < n; i++) if (ord[i] > ord[maxI]) maxI = i;
  let maxK = 0;
  for (let i = 1; i < n; i++) if (kg[i] > kg[maxK]) maxK = i;
  const tons = acc.grams / 1e6;
  return {
    orders: acc.orders,
    tons: r2(tons),
    ordersPerDay: { avg: n ? r1(acc.orders / n) : 0, p90: p90(ord), max: n ? ord[maxI] : 0, maxDate: n && ord[maxI] > 0 ? dayList[maxI] : null },
    tonsPerDay: { avg: n ? r2(tons / n) : 0, p90: r2(p90(kg) / 1000), max: n ? r2(kg[maxK] / 1000) : 0, maxDate: n && kg[maxK] > 0 ? dayList[maxK] : null },
    topClients: top(acc.clients),
    topRoutes: top(acc.routes),
    byName: top(acc.names, 20),
  };
}

const top = (map, n = TOP_N) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, orders]) => ({ name, orders }));

/**
 * @param rows   the view's filtered rows (transformLTL filteredRows — same
 *               filter as every other panel, pending pickups excluded)
 * @param index  buildWarehouseIndex(...)
 * @param opts   { dateField: "pickup_time" | "delivered_time" }
 */
export function computeWarehouseLayer(rows, index, { dateField = "pickup_time" } = {}) {
  if (!index || !index.sites.length) return null;
  const acc = new Map(); // site.id → { giao, lay }
  const unplaced = new Map(); // name → { name, kind, giao, lay }
  const totals = { giao: { orders: 0, placed: 0, unplaced: 0, blank: 0 }, lay: { orders: 0, placed: 0, unplaced: 0, blank: 0 } };
  let first = "", last = "";

  // Lookups memoized per raw string (~37k rows × 2 roles, a few hundred names).
  const hitCache = new Map();
  const lookup = (raw) => {
    let h = hitCache.get(raw);
    if (h === undefined) {
      const name = String(raw || "").trim();
      h = name ? (index.byName.get(norm(name)) || { name, site: null, kind: "newName" }) : null;
      hitCache.set(raw, h);
    }
    return h;
  };
  const dayCache = new Map();
  const dayMemo = (v) => {
    let d = dayCache.get(v);
    if (d === undefined) dayCache.set(v, (d = dayOf(v)));
    return d;
  };

  const add = (role, whName, r, day, grams) => {
    const t = totals[role];
    t.orders++;
    const hit = lookup(whName);
    if (!hit) { t.blank++; return; }
    if (!hit.site) {
      t.unplaced++;
      const k = hit.name;
      const u = unplaced.get(k) || { name: k, kind: hit.kind, giao: 0, lay: 0 };
      u[role]++;
      unplaced.set(k, u);
      return;
    }
    t.placed++;
    let s = acc.get(hit.site.id);
    if (!s) acc.set(hit.site.id, (s = { giao: newAcc(), lay: newAcc() }));
    const a = s[role];
    a.orders++;
    a.grams += grams;
    if (day) {
      const d = a.days.get(day) || { o: 0, g: 0 };
      d.o++; d.g += grams;
      a.days.set(day, d);
    }
    bump(a.clients, String(r.client_name || "").trim());
    bump(a.names, hit.name);
    // Main flows: into a delivery warehouse, from which pickup warehouse;
    // out of a pickup warehouse, to which province.
    bump(a.routes, role === "giao"
      ? String(r.kho_lay || r.warehouse_lay || r.from_province_name || "").trim()
      : String(r.to_province_name || "").trim());
  };

  for (const r of rows) {
    const day = dayMemo(r[dateField]);
    if (day) { if (!first || day < first) first = day; if (day > last) last = day; }
    const grams = parseFloat(r.weight) || 0;
    add("giao", r.kho_giao || r.warehouse_giao, r, day, grams);
    add("lay", r.kho_lay || r.warehouse_lay, r, day, grams);
  }

  // Every calendar day from the first to the last day of the view (days
  // without any order count as 0 — like the plan's 90-day table).
  const dayList = [];
  if (first) {
    for (let t = Date.parse(first + "T00:00:00Z"), end = Date.parse(last + "T00:00:00Z"); t <= end; t += 86400000) {
      dayList.push(new Date(t).toISOString().slice(0, 10));
    }
  }

  const sites = [];
  for (const site of index.sites) {
    const s = acc.get(site.id);
    if (!s) continue;
    const types = [...new Set(site.names.map((n) => n.type).filter(Boolean))];
    // null = no order in that role (most delivery warehouses never pick up).
    const giao = s.giao.orders ? dayStats(s.giao, dayList) : null;
    const lay = s.lay.orders ? dayStats(s.lay, dayList) : null;
    // Per-name split only matters when several names share the dot.
    if (site.names.length < 2) { if (giao) delete giao.byName; if (lay) delete lay.byName; }
    sites.push({
      id: site.id, x: site.x, y: site.y, lat: site.lat, lng: site.lng,
      estimated: site.estimated,
      names: site.names,
      types,
      giao, lay,
    });
  }
  const tot = (x) => (x.giao?.orders || 0) + (x.lay?.orders || 0);
  sites.sort((a, b) => tot(b) - tot(a));

  const unplacedList = [...unplaced.values()].sort((a, b) => (b.giao + b.lay) - (a.giao + a.lay));
  const groups = {};
  for (const u of unplacedList) {
    const g = groups[u.kind] || (groups[u.kind] = { names: 0, giao: 0, lay: 0 });
    g.names++; g.giao += u.giao; g.lay += u.lay;
  }

  return {
    dateField,
    period: { from: first || null, to: last || null, days: dayList.length },
    sites,
    totals,
    unplaced: { groups, list: unplacedList.slice(0, UNPLACED_LIST), count: unplacedList.length },
  };
}
