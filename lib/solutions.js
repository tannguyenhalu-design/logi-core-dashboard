/**
 * lib/solutions.js — "Sổ tay cải tiến" with PHASES (KẾ HOẠCH B, user
 * decisions 2026-09-28). A GIẢI PHÁP (solution) has ONE shared baseline and
 * several GIAI ĐOẠN (phases): Trial 1 → Trial 2 → … → "Nhân rộng cả nước".
 *
 *  - Solution row  (tab `ActionSolutions`): name, clients, shared baseline,
 *    overall status (Đang trial / Đã thành solution chung / Đã hủy), description.
 *  - Phase row     (tab `ActionTrials`, the original trial tab + columns
 *    solution_id, phase_no, phase_label, images): its own scope (kho lấy /
 *    kho giao / tỉnh giao — empty = every order of the solution's clients),
 *    dates, status (Đang trial / Thành công / Dừng), description, photos.
 *    Phases run IN PARALLEL: starting a new one never ends the previous one.
 *  - Rows written before phases existed (no solution_id) are shown as a
 *    one-phase solution until someone saves them into a real solution.
 *
 * Every phase is measured with lib/trials.js computeTrialImpact against the
 * SOLUTION's baseline (same formulas, verdict and control group as before).
 * On top of that the solution report has: a phase comparison table, a weekly
 * series per phase, and — for phases marked "Thành công" (or all phases once
 * the solution is "Đã thành solution chung") — "Theo dõi sau thành công":
 * month (weeks whose Monday is in the month, like the company report) and
 * ISO-week tables compared with the period before, with an alert when
 * % bể vỡ (Ca/1.000 đơn ÷ 10) rises ≥ 10% (relative) or on-time drops ≥ 1 point (VERDICT_RULES; < 5
 * cases in the two periods → damage axis ignored; weekly alerts only for
 * weeks with ≥ 100 orders). All sheet writes are RAW; deletes are soft.
 */
import { google } from "googleapis";
import { getAuth, fetchSheet, invalidateCache, getCached, setCached } from "./sheets";
import { getOntimeOutcome } from "./transform-ltl";
import { countedDamage, compAmount, truyThuAmount } from "./damage-rules";
import { computeTrialImpact, khoLayOf, khoGiaoOf, VERDICT_RULES, DATA_START, fmt } from "./trials";
import { computeReconcile, computeCoverage, computeGaps, buildSources } from "./solution-reconcile";

export const SOL_SHEET = "ActionSolutions";
export const PHASE_SHEET = "ActionTrials";
export const SOL_HEADERS = ["id", "name", "clients", "base_start", "base_end", "status", "description", "created_by", "created_at", "updated_by", "updated_at", "deleted_at", "deleted_by"];
export const PHASE_HEADERS = [
  "id", "name", "clients", "kho_lay", "kho_giao", "to_province",
  "base_start", "base_end", "start_date", "end_date", "status", "description",
  "created_by", "created_at", "updated_by", "updated_at", "deleted_at", "deleted_by",
  "solution_id", "phase_no", "phase_label", "images",
];
export const SOLUTION_STATUSES = ["Đang trial", "Đã thành solution chung", "Đã hủy"];
export const PHASE_STATUSES = ["Đang trial", "Thành công", "Dừng"];
// Phase status names used before 28/09 (one row = one trial).
const OLD_PHASE_STATUS = { "Thành công (Đã nhân rộng)": "Thành công", "Đã hủy": "Dừng" };
export const MONITOR_WEEK_MIN_ORDERS = 100;
export const MAX_IMAGES = 10;

const SEP = " | ";
const DAY = 86400000;
const PARSED_KEY = "action-solutions:parsed";
const TTL_MS = 60 * 1000;
const cacheKey = (tab) => `sheet:${process.env.GOOGLE_SHEET_ID}:${tab}`;
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim()) ? String(v).trim() : "");
const list = (v) => String(v || "").split(SEP).map((s) => s.trim()).filter(Boolean);
const join = (a) => (a || []).map((s) => String(s).trim()).filter(Boolean).join(SEP);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const mondayOf = (iso) => { const t = Date.parse(iso); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); };
const colLetter = (n) => { let s = ""; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function isoWeekNo(monday) {
  const d = new Date(monday + "T00:00:00Z"), th = new Date(d.getTime() + 3 * DAY);
  const j4 = new Date(Date.UTC(th.getUTCFullYear(), 0, 4));
  return Math.round((d.getTime() - (j4.getTime() - ((j4.getUTCDay() + 6) % 7) * DAY)) / (7 * DAY)) + 1;
}
function parseImages(v) {
  try { const a = JSON.parse(String(v || "[]")); return Array.isArray(a) ? a.filter((x) => x && x.path) : []; } catch { return []; }
}

// ── Read ────────────────────────────────────────────────────────────────
function parseSolution(r) {
  return {
    id: String(r.id || "").trim(), name: String(r.name || ""), clients: list(r.clients),
    baseStart: isoDay(r.base_start), baseEnd: isoDay(r.base_end),
    status: SOLUTION_STATUSES.includes(r.status) ? r.status : SOLUTION_STATUSES[0],
    description: String(r.description || ""),
    createdBy: r.created_by || "", createdAt: r.created_at ? String(r.created_at) : "",
    updatedBy: r.updated_by || "", updatedAt: r.updated_at ? String(r.updated_at) : "",
    deletedAt: r.deleted_at ? String(r.deleted_at) : "",
  };
}
function parsePhase(r) {
  const status = PHASE_STATUSES.includes(r.status) ? r.status : OLD_PHASE_STATUS[r.status] || PHASE_STATUSES[0];
  return {
    id: String(r.id || "").trim(), solutionId: String(r.solution_id || "").trim(),
    phaseNo: Number(r.phase_no) || 0, label: String(r.phase_label || "").trim(),
    name: String(r.name || ""), clients: list(r.clients),
    khoLay: list(r.kho_lay), khoGiao: list(r.kho_giao), provinces: list(r.to_province),
    baseStart: isoDay(r.base_start), baseEnd: isoDay(r.base_end),
    startDate: isoDay(r.start_date), endDate: isoDay(r.end_date), status,
    description: String(r.description || ""), images: parseImages(r.images),
    createdBy: r.created_by || "", createdAt: r.created_at ? String(r.created_at) : "",
    updatedBy: r.updated_by || "", updatedAt: r.updated_at ? String(r.updated_at) : "",
    deletedAt: r.deleted_at ? String(r.deleted_at) : "",
  };
}

/** { solutions: [{...solution, phases, legacy?}], version } — cached 60s; `minVersion` forces a fresh read. */
export async function readSolutions({ minVersion = "" } = {}) {
  const cached = getCached(PARSED_KEY);
  if (cached && (!minVersion || cached.version >= minVersion)) return cached;
  invalidateCache(cacheKey(SOL_SHEET));
  invalidateCache(cacheKey(PHASE_SHEET));
  const [solRows, phaseRows] = await Promise.all([fetchSheet(SOL_SHEET).catch(() => []), fetchSheet(PHASE_SHEET).catch(() => [])]);
  const sols = solRows.map(parseSolution).filter((s) => s.id);
  const phases = phaseRows.map(parsePhase).filter((p) => p.id);
  let version = "";
  for (const x of [...sols, ...phases]) for (const v of [x.updatedAt, x.deletedAt]) if (v > version) version = v;
  const liveSols = new Map(sols.filter((s) => !s.deletedAt).map((s) => [s.id, { ...s, phases: [] }]));
  const out = [...liveSols.values()];
  for (const p of phases) {
    if (p.deletedAt) continue;
    const s = p.solutionId && liveSols.get(p.solutionId);
    if (s) { s.phases.push(p); continue; }
    if (p.solutionId) continue; // its solution was deleted
    // Legacy trial (before phases): shown as a one-phase solution.
    out.push({
      id: `legacy:${p.id}`, legacy: true, name: p.name, clients: p.clients, baseStart: p.baseStart, baseEnd: p.baseEnd,
      status: p.status === "Dừng" ? "Đã hủy" : "Đang trial", description: p.description,
      createdBy: p.createdBy, createdAt: p.createdAt, updatedBy: p.updatedBy, updatedAt: p.updatedAt,
      phases: [{ ...p, phaseNo: 1, label: p.label || "Trial 1" }],
    });
  }
  for (const s of out) {
    s.phases.sort((a, b) => a.phaseNo - b.phaseNo || a.startDate.localeCompare(b.startDate));
    s.phases.forEach((p, i) => { if (!p.label) p.label = `Trial ${i + 1}`; });
  }
  out.sort((a, b) => (lastStart(b) || "").localeCompare(lastStart(a) || "") || b.createdAt.localeCompare(a.createdAt));
  const result = { solutions: out, version };
  setCached(PARSED_KEY, result, TTL_MS);
  return result;
}
const lastStart = (s) => s.phases.reduce((a, p) => (p.startDate > a ? p.startDate : a), "");

// ── Validation (messages shown to the user as is) ───────────────────────
export function validateSolution(s) {
  if (!String(s.name || "").trim()) return "Thiếu tên giải pháp";
  if (!Array.isArray(s.clients) || !s.clients.filter(Boolean).length) return "Chọn ít nhất 1 khách hàng áp dụng";
  const bs = isoDay(s.baseStart), be = isoDay(s.baseEnd);
  if (!bs || !be) return "Thiếu khoảng Baseline chung (trước giai đoạn đầu tiên)";
  if (be < bs) return "Baseline: ngày cuối phải sau ngày đầu";
  if (!SOLUTION_STATUSES.includes(s.status)) return "Trạng thái giải pháp không hợp lệ";
  return null;
}
export function validatePhase(p, solution) {
  if (!String(p.label || "").trim()) return "Thiếu tên giai đoạn (vd Trial 2)";
  const sd = isoDay(p.startDate), ed = isoDay(p.endDate);
  if (!sd) return "Thiếu ngày bắt đầu giai đoạn";
  if (p.endDate && !ed) return "Ngày kết thúc không hợp lệ";
  if (ed && ed < sd) return "Ngày kết thúc phải sau ngày bắt đầu";
  if (!PHASE_STATUSES.includes(p.status)) return "Trạng thái giai đoạn không hợp lệ";
  if (solution && solution.baseEnd && sd <= solution.baseEnd) return `Giai đoạn phải bắt đầu sau Baseline chung (kết thúc ${fmt(solution.baseEnd)})`;
  return null;
}

// ── Write ───────────────────────────────────────────────────────────────
async function sheetsClient() { return google.sheets({ version: "v4", auth: getAuth() }); }
// Fresh grid of a tab; creates the tab / missing header columns on the fly.
async function grid(tab, headers) {
  const sheets = await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  let values;
  try {
    values = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!A:${colLetter(Math.max(headers.length, 26) + 4)}` })).data.values || [];
  } catch (err) {
    if (!/Unable to parse range|not found/i.test(err.message || "")) throw err;
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: [{ addSheet: { properties: { title: tab } } }] } });
    values = [];
  }
  let header = (values[0] || []).map((h) => String(h).trim());
  const missing = headers.filter((h) => !header.includes(h));
  if (!values.length || missing.length) {
    header = [...header, ...missing];
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${tab}'!A1`, valueInputOption: "RAW", resource: { values: [header] } });
    values = [header, ...values.slice(1)];
  }
  return { sheets, spreadsheetId, values, header };
}
async function putRow(g, tab, rowIdx, rec) {
  const row = g.header.map((h) => (h in rec ? rec[h] : ""));
  if (rowIdx > 0) await g.sheets.spreadsheets.values.update({ spreadsheetId: g.spreadsheetId, range: `'${tab}'!A${rowIdx + 1}`, valueInputOption: "RAW", resource: { values: [row] } });
  else await g.sheets.spreadsheets.values.append({ spreadsheetId: g.spreadsheetId, range: `'${tab}'!A:${colLetter(g.header.length - 1)}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", resource: { values: [row] } });
}
const rowOf = (g, id) => g.values.findIndex((r, i) => i > 0 && String(r[g.header.indexOf("id")] || "").trim() === id);
const recOf = (g, i) => Object.fromEntries(g.header.map((h, j) => [h, g.values[i][j] ?? ""]));
const dropCache = () => { invalidateCache(cacheKey(SOL_SHEET)); invalidateCache(cacheKey(PHASE_SHEET)); invalidateCache(PARSED_KEY); };
function newId(prefix) {
  const vn = new Date(Date.now() + 7 * 3600 * 1000).toISOString();
  return `${prefix}-${vn.slice(2, 4)}${vn.slice(5, 7)}${vn.slice(8, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function phaseRecord(p, sol, phaseNo, prev, actor, now) {
  return {
    id: p.id, name: String(p.name || p.label).trim(), clients: join(sol.clients),
    kho_lay: join(p.khoLay), kho_giao: join(p.khoGiao), to_province: join(p.provinces),
    // Shared baseline copied for reference (the solution row is the source).
    base_start: sol.baseStart, base_end: sol.baseEnd,
    start_date: isoDay(p.startDate), end_date: isoDay(p.endDate), status: p.status,
    description: String(p.description || "").trim(),
    created_by: prev ? prev.created_by : actor, created_at: prev ? prev.created_at : now,
    updated_by: actor, updated_at: now, deleted_at: "", deleted_by: "",
    solution_id: sol.id, phase_no: phaseNo, phase_label: String(p.label).trim(),
    images: prev ? prev.images || "[]" : "[]",
  };
}

/**
 * Create / update a solution. `firstPhase` (create only) adds Trial 1;
 * `adoptPhaseIds` attaches existing phase rows (legacy trials) in that order
 * as Trial 1, 2… keeping their scope, dates and photos.
 */
export async function saveSolution(input, actor, { firstPhase = null, adoptPhaseIds = [], adoptLabels = [] } = {}) {
  const now = new Date().toISOString();
  const gs = await grid(SOL_SHEET, SOL_HEADERS);
  const idx = input.id ? rowOf(gs, input.id) : -1;
  if (input.id && idx < 0) throw new Error("Không tìm thấy giải pháp cần sửa (có thể đã bị xoá)");
  const prev = idx > 0 ? recOf(gs, idx) : null;
  if (prev && prev.deleted_at) throw new Error("Giải pháp này đã bị xoá");
  const sol = {
    id: input.id || newId("GP"), name: String(input.name).trim(), clients: input.clients.map((c) => String(c).trim()).filter(Boolean),
    baseStart: isoDay(input.baseStart), baseEnd: isoDay(input.baseEnd), status: input.status, description: String(input.description || "").trim(),
  };
  await putRow(gs, SOL_SHEET, idx, {
    id: sol.id, name: sol.name, clients: join(sol.clients), base_start: sol.baseStart, base_end: sol.baseEnd, status: sol.status, description: sol.description,
    created_by: prev ? prev.created_by : actor, created_at: prev ? prev.created_at : now, updated_by: actor, updated_at: now, deleted_at: "", deleted_by: "",
  });
  const gp = await grid(PHASE_SHEET, PHASE_HEADERS);
  // Keep every phase's copy of clients/baseline in step with the solution.
  const writes = [];
  gp.values.forEach((r, i) => {
    if (i === 0) return;
    const rec = recOf(gp, i);
    if (String(rec.solution_id).trim() !== sol.id || rec.deleted_at) return;
    if (rec.clients === join(sol.clients) && rec.base_start === sol.baseStart && rec.base_end === sol.baseEnd) return;
    writes.push([i, { ...rec, clients: join(sol.clients), base_start: sol.baseStart, base_end: sol.baseEnd }]);
  });
  let no = 0;
  for (const [i, rec] of gp.values.map((r, i) => [i, i > 0 ? recOf(gp, i) : null])) if (rec && String(rec.solution_id).trim() === sol.id && !rec.deleted_at) no = Math.max(no, Number(rec.phase_no) || 0);
  for (let k = 0; k < adoptPhaseIds.length; k++) {
    const i = rowOf(gp, adoptPhaseIds[k]);
    if (i < 0) throw new Error(`Không tìm thấy giai đoạn ${adoptPhaseIds[k]}`);
    const rec = recOf(gp, i);
    if (rec.deleted_at) throw new Error(`Giai đoạn ${adoptPhaseIds[k]} đã bị xoá`);
    no += 1;
    const old = parsePhase(rec);
    writes.push([i, { ...rec, clients: join(sol.clients), base_start: sol.baseStart, base_end: sol.baseEnd, solution_id: sol.id, phase_no: no,
      phase_label: adoptLabels[k] || rec.phase_label || `Trial ${no}`, status: old.status, updated_by: actor, updated_at: now,
      description: rec.description && rec.name && !String(rec.description).includes(rec.name) ? `[Tên gốc: ${rec.name}]\n${rec.description}` : rec.description }]);
  }
  for (const [i, rec] of writes) await putRow(gp, PHASE_SHEET, i, rec);
  let phase = null;
  if (!input.id && firstPhase) {
    phase = { ...firstPhase, id: newId("TR"), label: firstPhase.label || "Trial 1" };
    await putRow(gp, PHASE_SHEET, -1, phaseRecord(phase, sol, no + 1, null, actor, now));
  }
  dropCache();
  return { solution: sol, created: !input.id, version: now, before: prev ? parseSolution(prev) : null, phaseId: phase ? phase.id : null };
}

export async function savePhase(input, actor, solution) {
  const now = new Date().toISOString();
  const gp = await grid(PHASE_SHEET, PHASE_HEADERS);
  const idx = input.id ? rowOf(gp, input.id) : -1;
  if (input.id && idx < 0) throw new Error("Không tìm thấy giai đoạn cần sửa (có thể đã bị xoá)");
  const prev = idx > 0 ? recOf(gp, idx) : null;
  if (prev && prev.deleted_at) throw new Error("Giai đoạn này đã bị xoá");
  let no = prev ? Number(prev.phase_no) || 0 : 0;
  if (!prev) gp.values.forEach((r, i) => { if (i > 0) { const rec = recOf(gp, i); if (String(rec.solution_id).trim() === solution.id && !rec.deleted_at) no = Math.max(no, Number(rec.phase_no) || 0); } });
  const phase = { ...input, id: input.id || newId("TR") };
  const rec = phaseRecord(phase, solution, prev ? no : no + 1, prev, actor, now);
  if (prev) rec.name = prev.name || rec.name; // keep the original trial name for history
  await putRow(gp, PHASE_SHEET, idx, rec);
  dropCache();
  return { phase: parsePhase(rec), created: !prev, version: now, before: prev ? parsePhase(prev) : null };
}

async function softDelete(tab, headers, id, actor) {
  const g = await grid(tab, headers);
  const i = rowOf(g, id);
  if (i < 0) throw new Error("Không tìm thấy bản ghi");
  const now = new Date().toISOString();
  await putRow(g, tab, i, { ...recOf(g, i), deleted_at: now, deleted_by: actor });
  return { now, name: recOf(g, i).name || id };
}
export async function deletePhase(id, actor) { const r = await softDelete(PHASE_SHEET, PHASE_HEADERS, id, actor); dropCache(); return { version: r.now, name: r.name }; }
export async function deleteSolution(id, actor) {
  const r = await softDelete(SOL_SHEET, SOL_HEADERS, id, actor);
  const gp = await grid(PHASE_SHEET, PHASE_HEADERS);
  for (let i = 1; i < gp.values.length; i++) {
    const rec = recOf(gp, i);
    if (String(rec.solution_id).trim() === id && !rec.deleted_at) await putRow(gp, PHASE_SHEET, i, { ...rec, deleted_at: r.now, deleted_by: actor });
  }
  dropCache();
  return { version: r.now, name: r.name };
}
export async function setPhaseImages(phaseId, images, actor) {
  const gp = await grid(PHASE_SHEET, PHASE_HEADERS);
  const i = rowOf(gp, phaseId);
  if (i < 0) throw new Error("Không tìm thấy giai đoạn");
  const now = new Date().toISOString();
  await putRow(gp, PHASE_SHEET, i, { ...recOf(gp, i), images: JSON.stringify(images), updated_by: actor, updated_at: now });
  dropCache();
  return { version: now };
}

// ── Report ──────────────────────────────────────────────────────────────
/** The phase as a "trial" for computeTrialImpact: solution clients + shared baseline + phase scope. */
export const phaseTrial = (sol, p) => ({ ...p, clients: sol.clients, baseStart: sol.baseStart, baseEnd: sol.baseEnd, name: `${sol.name} — ${p.label}` });
export const isMonitored = (sol, p) => p.status === "Thành công" || sol.status === "Đã thành solution chung";

// Per-day totals of a phase's scope (pickup day): orders, grams, ontime,
// evaluated, cases (attached to the order, like the impact).
function dailyTotals(base, sol, p, caseCount, caseMoney = new Map()) {
  const clients = new Set(sol.clients), kl = new Set(p.khoLay), kg = new Set(p.khoGiao), pv = new Set(p.provinces);
  const days = new Map();
  for (const r of base.ltlRows || []) {
    if (!clients.has(r.client_name)) continue;
    const d = String(r.pickup_time || "").slice(0, 10);
    if (!d) continue;
    if ((kl.size && !kl.has(khoLayOf(r))) || (kg.size && !kg.has(khoGiaoOf(r))) || (pv.size && !pv.has(String(r.to_province_name || "").trim()))) continue;
    const a = days.get(d) || { orders: 0, grams: 0, on: 0, ev: 0, cases: 0, comp: 0, tt: 0 };
    a.orders++;
    a.grams += parseFloat(r.weight) || 0;
    const o = getOntimeOutcome(r);
    if (o) { a.ev++; if (o === "ontime") a.on++; }
    const code = String(r.order_code || "").trim();
    a.cases += caseCount.get(code) || 0;
    const mo = caseMoney.get(code);
    if (mo) { a.comp += mo.comp; a.tt += mo.tt; }
    days.set(d, a);
  }
  return days;
}
function sumWindow(days, from, to) {
  const s = { orders: 0, grams: 0, on: 0, ev: 0, cases: 0, comp: 0, tt: 0 };
  for (let d = from; d <= to; d = addDays(d, 1)) { const a = days.get(d); if (a) { s.orders += a.orders; s.grams += a.grams; s.on += a.on; s.ev += a.ev; s.cases += a.cases; s.comp += a.comp || 0; s.tt += a.tt || 0; } }
  return { orders: s.orders, tons: s.grams / 1e6, ontime: s.on, evaluated: s.ev, ontimePct: s.ev ? (s.on / s.ev) * 100 : null, cases: s.cases, per1k: s.orders ? (s.cases / s.orders) * 1000 : null,
    // Tiền đền cho khách (Kế hoạch E) — thông tin thêm, không vào cảnh báo.
    comp: s.comp, compPer1k: s.orders ? (s.comp / s.orders) * 1000 : null, truyThu: s.tt };
}
// Company-report month of a Monday = its calendar month.
function periodsFrom(startIso, today, kind) {
  const out = [];
  let mon = mondayOf(startIso < DATA_START ? DATA_START : startIso);
  if (kind === "week") {
    for (; mon <= today; mon = addDays(mon, 7)) out.push({ key: mon, label: `W${isoWeekNo(mon)}`, from: mon, to: addDays(mon, 6) });
    return out;
  }
  // month: consecutive Mondays grouped by the Monday's yyyy-mm
  let cur = null;
  for (; mon <= today; mon = addDays(mon, 7)) {
    const m = mon.slice(0, 7);
    if (!cur || cur.key !== m) { cur = { key: m, label: `T${m.slice(5, 7)}/${m.slice(0, 4)}`, from: mon, to: addDays(mon, 6) }; out.push(cur); } else cur.to = addDays(mon, 6);
  }
  return out;
}
function compare(cur, prev) {
  const R = VERDICT_RULES;
  const ontimePts = cur.ontimePct != null && prev.ontimePct != null ? cur.ontimePct - prev.ontimePct : null;
  const per1kPct = cur.per1k != null && prev.per1k ? ((cur.per1k - prev.per1k) / prev.per1k) * 100 : null;
  const damageOk = cur.cases + prev.cases >= R.minCases;
  return { ontimePts, per1kPct, damageOk, ordersPct: prev.orders ? ((cur.orders - prev.orders) / prev.orders) * 100 : null };
}
function monitorTable(days, phase, today, kind, baseline) {
  const R = VERDICT_RULES;
  const periods = periodsFrom(phase.startDate, today, kind);
  const rows = [];
  periods.forEach((per, i) => {
    const from = per.from < phase.startDate ? phase.startDate : per.from; // first period starts at the phase start
    const to = per.to > today ? today : per.to;
    const running = to < per.to; // period not over yet (today inside it)
    const partial = running || from > per.from; // … or clipped to the phase start
    const stats = sumWindow(days, from, to);
    let prevStats = null, vs = null, same = false;
    if (i > 0) {
      const pp = periods[i - 1];
      const ppFrom = pp.from < phase.startDate ? phase.startDate : pp.from;
      if (to < per.to) { // running period: same number of days of the previous one
        const n = Math.round((Date.parse(to) - Date.parse(from)) / DAY);
        prevStats = sumWindow(days, ppFrom, addDays(ppFrom, n) > pp.to ? pp.to : addDays(ppFrom, n));
        same = true;
      } else prevStats = sumWindow(days, ppFrom, pp.to > today ? today : pp.to);
      vs = compare(stats, prevStats);
    }
    const alerts = [];
    if (vs && (kind === "month" || stats.orders >= MONITOR_WEEK_MIN_ORDERS)) {
      if (vs.damageOk && vs.per1kPct != null && vs.per1kPct >= R.damageBad) alerts.push(`% bể vỡ ${(prevStats.per1k / 10).toFixed(2).replace(".", ",")}% → ${(stats.per1k / 10).toFixed(2).replace(".", ",")}% (+${vs.per1kPct.toFixed(0)}%)`);
      if (vs.damageOk && !prevStats.per1k && stats.cases >= R.minCases) alerts.push(`từ 0 lên ${stats.cases} ca bể`);
      if (vs.ontimePts != null && vs.ontimePts <= R.ontimeBad) alerts.push(`on-time ${vs.ontimePts.toFixed(1).replace(".", ",")} điểm`);
    }
    rows.push({ key: per.key, label: per.label, from, to, partial, running, sameDays: same, stats, prev: prevStats, vs, alerts });
  });
  return { kind, baseline, rows };
}

/**
 * Everything the solution screen / files need.
 * @param base loadLtlBase() result · @param sol solution with phases · @param today yyyy-mm-dd (VN)
 * @param opts.allSolutions every solution of the Sổ tay (readSolutions().solutions) — needed for the
 *   "khoảng trống" (flows no solution covers); without it the gaps are left out.
 * @param opts.lite skip the Kế hoạch F1 additions (reconcile / coverage / gaps / sources) — outer list only.
 * Kế hoạch F1 (02/10) adds, never changes the fields above: phases[i].reconcile (cohort vs real-time),
 * phases[i].coverage, coverage (whole solution), gaps, sources.
 */
export function computeSolutionReport(base, sol, today, { allSolutions = null, lite = false } = {}) {
  const caseCount = new Map();
  const caseMoney = new Map();
  for (const c of countedDamage(base.rawDamageCauses || [])) {
    const k = String(c.order_code || "").trim();
    caseCount.set(k, (caseCount.get(k) || 0) + 1);
    const m = caseMoney.get(k) || { comp: 0, tt: 0 };
    m.comp += compAmount(c); m.tt += truyThuAmount(c);
    caseMoney.set(k, m);
  }
  const phases = sol.phases.map((p) => {
    const trial = phaseTrial(sol, p);
    const impact = computeTrialImpact(base, trial, today);
    const days = dailyTotals(base, sol, p, caseCount, caseMoney);
    const monitored = isMonitored(sol, p);
    const baseline = impact.trial.base;
    const monitor = monitored ? { month: monitorTable(days, p, today, "month", baseline), week: monitorTable(days, p, today, "week", baseline) } : null;
    // weekly series from the baseline start (for the chart)
    const series = periodsFrom(sol.baseStart || p.startDate, today, "week").map((w) => ({ key: w.key, label: w.label, ...sumWindow(days, w.from, w.to > today ? today : w.to) }));
    return { phase: p, impact, monitor, series, startWeek: mondayOf(p.startDate) };
  });
  // Comparison table: post-period numbers of every phase vs the shared baseline and vs the phase before.
  const comparison = phases.map((x, i) => {
    const T = x.impact.trial, prev = i > 0 ? phases[i - 1].impact.trial.post : null;
    return {
      phaseId: x.phase.id, label: x.phase.label, status: x.phase.status, startDate: x.phase.startDate, endDate: x.phase.endDate,
      postFrom: x.impact.periods.post.from, postTo: x.impact.periods.post.to, postDays: x.impact.postDays,
      scope: { khoLay: x.phase.khoLay, khoGiao: x.phase.khoGiao, provinces: x.phase.provinces },
      base: T.base, post: T.post, delta: T.delta, net: x.impact.net, hasControl: x.impact.hasControl,
      verdict: x.impact.verdict.label, verdictLevel: x.impact.verdict.level,
      vsPrev: prev ? {
        ontimePts: T.post.ontimePct != null && prev.ontimePct != null ? T.post.ontimePct - prev.ontimePct : null,
        per1kPct: T.post.per1k != null && prev.per1k ? ((T.post.per1k - prev.per1k) / prev.per1k) * 100 : null,
        compPer1kPct: T.post.compPer1k != null && prev.compPer1k ? ((T.post.compPer1k - prev.compPer1k) / prev.compPer1k) * 100 : null,
      } : null,
      savings: x.impact.savings,
    };
  });
  const alerts = [];
  for (const x of phases) {
    if (!x.monitor) continue;
    for (const kind of ["month", "week"]) {
      const last = x.monitor[kind].rows[x.monitor[kind].rows.length - 1];
      if (last && last.alerts.length) alerts.push({ phaseId: x.phase.id, phase: x.phase.label, kind, period: last.label, running: last.running, text: `${x.phase.label} · ${last.label}${last.running ? " (đang chạy)" : ""}: ${last.alerts.join(", ")} so ${kind === "month" ? "tháng" : "tuần"} trước` });
    }
  }
  const out = { solutionId: sol.id, today, baseline: { from: sol.baseStart, to: sol.baseEnd }, phases, comparison, alerts, dataAsOf: base.builtAt };
  if (lite) return out;
  // ── Kế hoạch F1: đối soát 2 góc nhìn, độ phủ, khoảng trống, nguồn dữ liệu ──
  const cases = countedDamage(base.rawDamageCauses || []);
  for (const x of phases) x.reconcile = computeReconcile(base, sol, x.phase, x.impact, today, cases);
  const cov = computeCoverage(base, sol, phases, today);
  phases.forEach((x, i) => { x.coverage = cov.phases[i]; });
  out.coverage = cov;
  out.gaps = allSolutions ? computeGaps(base, sol, phases, allSolutions, today) : null;
  out.sources = buildSources(base, sol, { gaps: out.gaps });
  return out;
}
