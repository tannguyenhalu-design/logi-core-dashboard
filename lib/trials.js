/**
 * lib/trials.js — "Sổ tay Cải tiến & Đo lường Giải pháp" (user decisions
 * 2026-09-28). Manager + SD3 record improvement trials (tách tuyến, test
 * CCDC…) and see their measured effect from the LTL snapshot:
 *
 *  - scope   = clients (required) ∩ kho lấy ∩ kho giao ∩ tỉnh giao (each
 *              optional, empty = all);
 *  - periods = Baseline (dates typed by the creator) vs Post-Trial
 *              (start_date → end_date, or → today while Ongoing);
 *  - orders are dated by pickup day; on-time = ontime / (ontime + late) via
 *    getOntimeOutcome, like every dashboard number;
 *  - damage  = counted Rillnet cases ("Báo cáo bể vỡ") attached to THE ORDER:
 *              a case falls in the period its order was picked up in, and
 *              Ca/1.000 đơn = cases / orders picked × 1000 — it measures the
 *              orders that actually ran under the trial;
 *  - control = the same clients' orders OUTSIDE the scope, same two periods,
 *              so a change that also happens there (season, peak) is not
 *              credited to the trial ("hiệu quả ròng" = trial Δ − control Δ).
 *
 * Stored in the `ActionTrials` tab of GOOGLE_SHEET_ID, one row per trial,
 * written RAW. Deleting (Manager only) is a soft delete (deleted_at) so the
 * audit trail stays in the sheet.
 */
import { google } from "googleapis";
import { getAuth, fetchSheet, invalidateCache, getCached, setCached } from "./sheets";
import { getOntimeOutcome } from "./transform-ltl";
import { countedDamage } from "./damage-rules";

export const SHEET_NAME = "ActionTrials";
export const HEADERS = [
  "id", "name", "clients", "kho_lay", "kho_giao", "to_province",
  "base_start", "base_end", "start_date", "end_date", "status", "description",
  "created_by", "created_at", "updated_by", "updated_at", "deleted_at", "deleted_by",
];
export const STATUSES = ["Đang trial", "Thành công (Đã nhân rộng)", "Đã hủy"];
export const DATA_START = "2026-07-01";
// Below this the post period is flagged "mẫu nhỏ, chưa đủ kết luận".
export const MIN_POST_DAYS = 14;
export const MIN_POST_ORDERS = 100;
// Orders picked up this recently mostly have no delivery result yet, and
// damage is often reported days after delivery.
export const IMMATURE_DAYS = 7;

const SEP = " | ";
const DAY = 86400000;
const FINAL = new Set(["delivered", "returned", "cancel", "lost", "damage"]);
const COL = (i) => String.fromCharCode(65 + i);
const LAST_COL = COL(HEADERS.length - 1);
const CACHE_KEY = `sheet:${process.env.GOOGLE_SHEET_ID}:${SHEET_NAME}`;
const PARSED_KEY = "action-trials:parsed";
const TTL_MS = 60 * 1000;

const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim()) ? String(v).trim() : "");
const list = (v) => String(v || "").split(SEP).map((s) => s.trim()).filter(Boolean);
export const khoLayOf = (r) => String(r.kho_lay || r.warehouse_lay || "").trim();
export const khoGiaoOf = (r) => String(r.kho_giao || r.warehouse_giao || "").trim();
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

function parse(rows) {
  const out = [];
  for (const r of rows || []) {
    const id = String(r.id || "").trim();
    if (!id) continue;
    out.push({
      id,
      name: String(r.name || ""),
      clients: list(r.clients),
      khoLay: list(r.kho_lay),
      khoGiao: list(r.kho_giao),
      provinces: list(r.to_province),
      baseStart: isoDay(r.base_start),
      baseEnd: isoDay(r.base_end),
      startDate: isoDay(r.start_date),
      endDate: isoDay(r.end_date), // "" = Ongoing
      status: STATUSES.includes(r.status) ? r.status : STATUSES[0],
      description: String(r.description || ""),
      createdBy: r.created_by || "", createdAt: r.created_at ? String(r.created_at) : "",
      updatedBy: r.updated_by || "", updatedAt: r.updated_at ? String(r.updated_at) : "",
      deletedAt: r.deleted_at ? String(r.deleted_at) : "",
    });
  }
  return out;
}
const versionOf = (all) => all.reduce((a, t) => [t.updatedAt, t.deletedAt].reduce((x, y) => (y > x ? y : x), a), "");

// { trials (not deleted, newest first), version }. `minVersion` = the
// version this browser just saved: forces a fresh read on an instance whose
// cache is older, so every serverless instance shows the save at once.
export async function readTrials({ minVersion = "" } = {}) {
  const cached = getCached(PARSED_KEY);
  if (cached && (!minVersion || cached.version >= minVersion)) return cached;
  invalidateCache(CACHE_KEY);
  const rows = await fetchSheet(SHEET_NAME).catch(() => []);
  const all = parse(rows);
  const result = {
    trials: all.filter((t) => !t.deletedAt).sort((a, b) => (b.startDate || "").localeCompare(a.startDate || "") || b.createdAt.localeCompare(a.createdAt)),
    version: versionOf(all),
  };
  setCached(PARSED_KEY, result, TTL_MS);
  return result;
}

// Input check shared by the API (error text is shown to the user as is).
export function validateTrial(t) {
  const name = String(t.name || "").trim();
  if (!name) return "Thiếu tên giải pháp";
  if (!Array.isArray(t.clients) || !t.clients.filter(Boolean).length) return "Chọn ít nhất 1 khách hàng áp dụng";
  const d = { baseStart: isoDay(t.baseStart), baseEnd: isoDay(t.baseEnd), startDate: isoDay(t.startDate), endDate: isoDay(t.endDate) };
  if (!d.startDate) return "Thiếu ngày bắt đầu áp dụng";
  if (t.endDate && !d.endDate) return "Ngày kết thúc không hợp lệ";
  if (d.endDate && d.endDate < d.startDate) return "Ngày kết thúc phải sau ngày bắt đầu";
  if (!d.baseStart || !d.baseEnd) return "Thiếu khoảng Baseline (trước khi áp dụng)";
  if (d.baseEnd < d.baseStart) return "Baseline: ngày cuối phải sau ngày đầu";
  if (d.baseEnd >= d.startDate) return "Baseline phải kết thúc trước ngày bắt đầu áp dụng";
  if (!STATUSES.includes(t.status)) return "Trạng thái không hợp lệ";
  return null;
}

async function sheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

// Fresh read of the raw grid (never the cache) → { values, spreadsheetId, sheets }
async function readGrid() {
  const sheets = await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  let values;
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SHEET_NAME}'!A:${LAST_COL}` });
    values = resp.data.values || [];
  } catch (err) {
    // First save: the tab does not exist yet.
    if (!/Unable to parse range|not found/i.test(err.message || "")) throw err;
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] } });
    values = [];
  }
  if (!values.length) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${SHEET_NAME}'!A1`, valueInputOption: "RAW", resource: { values: [HEADERS] } });
    values = [HEADERS];
  }
  return { values, spreadsheetId, sheets };
}

function newId() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000).toISOString();
  return `TR-${vn.slice(2, 4)}${vn.slice(5, 7)}${vn.slice(8, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// Create (no id) or update one trial. Returns { trial, version, created }.
export async function saveTrial(t, actor) {
  const { values, spreadsheetId, sheets } = await readGrid();
  const header = values[0].map((h) => String(h).trim());
  const idx = (name) => header.indexOf(name);
  const now = new Date().toISOString();
  const rowIdx = t.id ? values.findIndex((r, i) => i > 0 && String(r[idx("id")] || "").trim() === t.id) : -1;
  if (t.id && rowIdx === -1) throw new Error("Không tìm thấy giải pháp cần sửa (có thể đã bị xoá)");
  const prev = rowIdx > 0 ? values[rowIdx] : [];
  if (rowIdx > 0 && prev[idx("deleted_at")]) throw new Error("Giải pháp này đã bị xoá");
  const rec = {
    id: t.id || newId(),
    name: String(t.name).trim(),
    clients: t.clients.map((s) => String(s).trim()).filter(Boolean).join(SEP),
    kho_lay: (t.khoLay || []).map((s) => String(s).trim()).filter(Boolean).join(SEP),
    kho_giao: (t.khoGiao || []).map((s) => String(s).trim()).filter(Boolean).join(SEP),
    to_province: (t.provinces || []).map((s) => String(s).trim()).filter(Boolean).join(SEP),
    base_start: isoDay(t.baseStart), base_end: isoDay(t.baseEnd),
    start_date: isoDay(t.startDate), end_date: isoDay(t.endDate),
    status: t.status,
    description: String(t.description || "").trim(),
    created_by: rowIdx > 0 ? prev[idx("created_by")] || "" : actor || "",
    created_at: rowIdx > 0 ? prev[idx("created_at")] || "" : now,
    updated_by: actor || "", updated_at: now, deleted_at: "", deleted_by: "",
  };
  // Write in the sheet's own column order (a column moved by hand stays put).
  const row = header.map((h) => (h in rec ? rec[h] : ""));
  // RAW: stored exactly as typed — a description starting with "=" stays text.
  if (rowIdx > 0) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${SHEET_NAME}'!A${rowIdx + 1}`, valueInputOption: "RAW", resource: { values: [row] } });
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId, range: `'${SHEET_NAME}'!A:${LAST_COL}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", resource: { values: [row] } });
  }
  invalidateCache(CACHE_KEY);
  invalidateCache(PARSED_KEY);
  return { trial: parse([rec])[0], version: now, created: rowIdx === -1, before: rowIdx > 0 ? parse([Object.fromEntries(header.map((h, i) => [h, prev[i]]))])[0] : null };
}

// Soft delete (Manager only — checked by the API).
export async function deleteTrial(id, actor) {
  const { values, spreadsheetId, sheets } = await readGrid();
  const header = values[0].map((h) => String(h).trim());
  const rowIdx = values.findIndex((r, i) => i > 0 && String(r[header.indexOf("id")] || "").trim() === id);
  if (rowIdx === -1) throw new Error("Không tìm thấy giải pháp");
  const now = new Date().toISOString();
  const row = header.map((h, i) => (h === "deleted_at" ? now : h === "deleted_by" ? actor || "" : values[rowIdx][i] ?? ""));
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${SHEET_NAME}'!A${rowIdx + 1}`, valueInputOption: "RAW", resource: { values: [row] } });
  invalidateCache(CACHE_KEY);
  invalidateCache(PARSED_KEY);
  return { version: now, name: values[rowIdx][header.indexOf("name")] || id };
}

// Pickers for the form: every client with its kho lấy / kho giao / tỉnh giao
// and order counts, so the form only offers names that exist in the data.
export function scopeOptions(base) {
  const by = {};
  const bump = (m, k) => { if (k) m[k] = (m[k] || 0) + 1; };
  for (const r of base.ltlRows || []) {
    if (!String(r.pickup_time || "").trim()) continue;
    const c = (by[r.client_name] = by[r.client_name] || { orders: 0, khoLay: {}, khoGiao: {}, provinces: {} });
    c.orders++;
    bump(c.khoLay, khoLayOf(r));
    bump(c.khoGiao, khoGiaoOf(r));
    bump(c.provinces, String(r.to_province_name || "").trim());
  }
  return by;
}

// ── Impact ──────────────────────────────────────────────────────────────
function emptyAcc() { return { orders: 0, grams: 0, ontime: 0, late: 0, open: 0, cases: 0, caseCodes: [] }; }
function finish(a) {
  const evaluated = a.ontime + a.late;
  return {
    orders: a.orders,
    weightKg: Math.round(a.grams / 1000),
    ontime: a.ontime, late: a.late, evaluated,
    ontimePct: evaluated ? (a.ontime / evaluated) * 100 : null,
    cases: a.cases,
    per1k: a.orders ? (a.cases / a.orders) * 1000 : null,
    open: a.open, // picked up, not delivered/closed yet → no on-time result
    caseCodes: a.caseCodes,
  };
}
const pctChange = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

/**
 * @param base  loadLtlBase() result
 * @param trial parsed trial
 * @param today yyyy-mm-dd (Vietnam)
 */
export function computeTrialImpact(base, trial, today) {
  const clients = new Set(trial.clients);
  const khoLay = new Set(trial.khoLay), khoGiao = new Set(trial.khoGiao), provinces = new Set(trial.provinces);
  const hasRouteScope = khoLay.size + khoGiao.size + provinces.size > 0;
  const inScope = (r) => (!khoLay.size || khoLay.has(khoLayOf(r)))
    && (!khoGiao.size || khoGiao.has(khoGiaoOf(r)))
    && (!provinces.size || provinces.has(String(r.to_province_name || "").trim()));

  // Post-trial stops at today (Ongoing, or an end date still in the future).
  const postEnd = trial.endDate && trial.endDate < today ? trial.endDate : today;
  const periods = {
    base: { from: trial.baseStart, to: trial.baseEnd },
    post: { from: trial.startDate, to: postEnd, ongoing: !trial.endDate, plannedEnd: trial.endDate || "" },
  };
  const periodOf = (d) => (d >= periods.base.from && d <= periods.base.to ? "base" : d >= periods.post.from && d <= periods.post.to ? "post" : null);

  const acc = { trial: { base: emptyAcc(), post: emptyAcc() }, control: { base: emptyAcc(), post: emptyAcc() } };
  const where = new Map(); // order_code → [group, period]
  for (const r of base.ltlRows || []) {
    if (!clients.has(r.client_name)) continue;
    const p = periodOf(String(r.pickup_time || "").slice(0, 10));
    if (!p) continue;
    const g = inScope(r) ? "trial" : "control";
    const a = acc[g][p];
    a.orders++;
    a.grams += parseFloat(r.weight) || 0;
    const o = getOntimeOutcome(r);
    if (o === "ontime") a.ontime++;
    else if (o === "late") a.late++;
    else if (!FINAL.has(String(r.status || "").trim().toLowerCase())) a.open++;
    where.set(String(r.order_code || "").trim(), [g, p]);
  }
  for (const c of countedDamage(base.rawDamageCauses || [])) {
    const code = String(c.order_code || "").trim();
    const w = where.get(code);
    if (!w) continue;
    const a = acc[w[0]][w[1]];
    a.cases++;
    if (w[0] === "trial") a.caseCodes.push({ order_code: code, case_date: c.case_date || "", leg: c.suspected_leg || "", warehouse: c.detected_at_warehouse || "", period: w[1] });
  }

  const res = {};
  for (const g of ["trial", "control"]) {
    const b = finish(acc[g].base), p = finish(acc[g].post);
    res[g] = {
      base: b, post: p,
      delta: {
        orders: p.orders - b.orders, ordersPct: pctChange(p.orders, b.orders),
        ontimePts: p.ontimePct != null && b.ontimePct != null ? p.ontimePct - b.ontimePct : null,
        cases: p.cases - b.cases, casesPct: pctChange(p.cases, b.cases),
        per1k: p.per1k != null && b.per1k != null ? p.per1k - b.per1k : null,
        per1kPct: p.per1k != null && b.per1k ? pctChange(p.per1k, b.per1k) : null,
      },
    };
  }
  const hasControl = res.control.base.orders > 0 && res.control.post.orders > 0;
  const net = {
    ontimePts: hasControl && res.trial.delta.ontimePts != null && res.control.delta.ontimePts != null ? res.trial.delta.ontimePts - res.control.delta.ontimePts : null,
    per1k: hasControl && res.trial.delta.per1k != null && res.control.delta.per1k != null ? res.trial.delta.per1k - res.control.delta.per1k : null,
  };

  const postDays = periods.post.to >= periods.post.from ? daysBetween(periods.post.from, periods.post.to) : 0;
  const warnings = [];
  if (trial.startDate > today) warnings.push({ kind: "future", text: `Chưa đến ngày áp dụng (${fmt(trial.startDate)}) — chưa có số giai đoạn sau.` });
  if (periods.base.from < DATA_START) warnings.push({ kind: "data", text: `Dữ liệu chỉ có từ 01/07/2026 — phần Baseline trước ngày này không có đơn.` });
  if (trial.startDate <= today && (postDays < MIN_POST_DAYS || res.trial.post.orders < MIN_POST_ORDERS)) {
    warnings.push({ kind: "small", text: `Mẫu nhỏ (${postDays} ngày · ${res.trial.post.orders.toLocaleString("vi-VN")} đơn giai đoạn sau; cần ≥ ${MIN_POST_DAYS} ngày và ≥ ${MIN_POST_ORDERS} đơn) — chưa đủ để kết luận.` });
  }
  if (trial.startDate <= today && periods.post.to >= addDays(today, -IMMATURE_DAYS)) {
    const open = res.trial.post.open;
    warnings.push({ kind: "immature", text: `Số giai đoạn sau chưa chín: ${open.toLocaleString("vi-VN")} đơn chưa có kết quả giao (chưa tính vào on-time), ca bể vỡ của đơn ${IMMATURE_DAYS} ngày gần nhất có thể còn phát hiện thêm.` });
  }
  if (res.trial.base.orders && res.trial.base.orders < MIN_POST_ORDERS) warnings.push({ kind: "small-base", text: `Baseline chỉ có ${res.trial.base.orders.toLocaleString("vi-VN")} đơn — so sánh kém tin cậy.` });

  return {
    id: trial.id, periods, postDays, baseDays: daysBetween(periods.base.from, periods.base.to),
    scope: { clients: trial.clients, khoLay: trial.khoLay, khoGiao: trial.khoGiao, provinces: trial.provinces, hasRouteScope },
    trial: res.trial, control: res.control, hasControl, net, warnings,
    summary: summaryLines(res, net, hasControl),
    dataAsOf: base.builtAt,
  };
}

// ── Text ────────────────────────────────────────────────────────────────
export const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const n0 = (x) => Math.round(x).toLocaleString("vi-VN");
const n1 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const n2 = (x) => (x == null ? "—" : x.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sgn = (x, f) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${f(Math.abs(x))}`);

// Plain-language result lines (fixed templates, no AI) for the screen and
// the "Copy tóm tắt" button.
function summaryLines(res, net, hasControl) {
  const t = res.trial, c = res.control;
  const lines = [];
  lines.push(`Sản lượng: ${n0(t.base.orders)} → ${n0(t.post.orders)} đơn (${t.delta.ordersPct == null ? "—" : `${sgn(t.delta.ordersPct, n1)}%`}).`);
  if (t.base.ontimePct != null && t.post.ontimePct != null) {
    lines.push(`On-time: ${n1(t.base.ontimePct)}% → ${n1(t.post.ontimePct)}% (${sgn(t.delta.ontimePts, n1)} điểm)`
      + (hasControl && net.ontimePts != null ? `; đối chứng ${sgn(c.delta.ontimePts, n1)} điểm → hiệu quả ròng ${sgn(net.ontimePts, n1)} điểm.` : "."));
  } else lines.push("On-time: chưa đủ đơn đã giao để so sánh.");
  lines.push(`Ca bể vỡ: ${t.base.cases} → ${t.post.cases} ca.`);
  if (t.base.per1k != null && t.post.per1k != null) {
    lines.push(`Ca/1.000 đơn: ${n2(t.base.per1k)} → ${n2(t.post.per1k)} (${t.delta.per1kPct == null ? (t.post.per1k > 0 ? "trước đó 0 ca" : "cùng 0") : `${sgn(t.delta.per1kPct, n1)}%`})`
      + (hasControl && net.per1k != null ? `; đối chứng ${n2(c.base.per1k)} → ${n2(c.post.per1k)} → hiệu quả ròng ${sgn(net.per1k, n2)} ca/1.000 đơn.` : "."));
  }
  return lines;
}
