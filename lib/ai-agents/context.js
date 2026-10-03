/**
 * lib/ai-agents/context.js — "ngữ cảnh đã hiểu" của một cuộc chat:
 *   { projects: string[], months: number[]|null, solution: string|null, provinces: string[] }
 *
 * Trình duyệt gửi lại ngữ cảnh của câu trước ở mỗi request (sessionStorage) để
 * câu hỏi bồi ("còn tháng 8?", "so với LG?") hiểu đúng. Ngữ cảnh đến từ client
 * nên KHÔNG tin: mọi giá trị đều đối chiếu với danh sách thật (dự án, tỉnh,
 * Sổ tay) và khách (role client) luôn bị khoá vào dự án của họ.
 */
import { removeAccents, extractMonths } from "../ai-agent-tools";

export const emptyContext = () => ({ projects: [], months: null, solution: null, provinces: [] });

const word = (hay, needle) => new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(hay);

// ── Dự án ────────────────────────────────────────────────────────────────
// Người dùng hay gọi tắt ("LG", "PSD", "Nguyễn Kim") trong khi tên dự án là
// "LG LTL", "PSD Miền Nam"… → thêm bí danh = 1–2 từ đầu của tên.
const TWO_WORD_HEADS = new Set(["nguyen kim", "hong dat", "dien may", "samsung sds", "frt digital"]);
function aliasOf(name) {
  const t = removeAccents(name).split(/\s+/).filter(Boolean);
  if (!t.length) return null;
  const two = t.slice(0, 2).join(" ");
  const head = TWO_WORD_HEADS.has(two) ? two : t[0];
  return head;
}

/** Projects named in the message: full names first (longest wins), then short aliases (all variants of the family). */
export function matchProjectsLoose(message, projectNames) {
  const text = removeAccents(message);
  const sorted = [...projectNames].sort((a, b) => b.length - a.length);
  const hits = [];
  const numericOk = /(du an|khach|client|khach hang)\s*$/;
  for (const name of sorted) {
    const n = removeAccents(name);
    if (!n) continue;
    if (/^\d+$/.test(n)) {
      // Dự án tên toàn số ("266"): chỉ nhận khi đứng ngay sau "dự án/khách".
      const m = text.match(new RegExp(`(.{0,12})\\b${n}\\b`));
      if (!m || !numericOk.test(m[1])) continue;
    } else if (n.length < 3 || !word(text, n)) continue;
    if (!hits.some((h) => removeAccents(h).includes(n))) hits.push(name);
  }
  // Short aliases — skipped for a family the user already named exactly.
  const families = new Map();
  for (const name of projectNames) {
    const a = aliasOf(name);
    if (!a || /^\d+$/.test(a) || a.length < 2) continue;
    (families.get(a) || families.set(a, []).get(a)).push(name);
  }
  for (const [a, members] of families) {
    if (!word(text, a)) continue;
    if (members.some((m) => hits.includes(m))) continue;
    for (const m of members) if (!hits.includes(m)) hits.push(m);
  }
  return hits;
}

// ── Tỉnh ─────────────────────────────────────────────────────────────────
const PROVINCE_ALIAS = { "tp hcm": "Hồ Chí Minh", hcm: "Hồ Chí Minh", "sai gon": "Hồ Chí Minh", "ha noi": "Hà Nội", hn: "Hà Nội", brvt: "Bà Rịa - Vũng Tàu", "vung tau": "Bà Rịa - Vũng Tàu" };

export function provinceNames(rows) {
  const names = new Set();
  for (const r of rows) {
    if (r.from_province_name) names.add(r.from_province_name);
    if (r.to_province_name) names.add(r.to_province_name);
  }
  return names;
}

export function matchProvincesStrict(message, names) {
  const text = removeAccents(message);
  const hits = new Set();
  for (const n of names) {
    const k = removeAccents(n);
    if (k.length >= 3 && word(text, k)) hits.add(n);
  }
  for (const [a, n] of Object.entries(PROVINCE_ALIAS)) if (word(text, a) && names.has(n)) hits.add(n);
  return [...hits];
}

// ── Giải pháp (Sổ tay) ──────────────────────────────────────────────────
const SOL_STOP = new Set(["giai", "phap", "trial", "noi", "trong", "qua", "trinh", "tuyen", "van", "chuyen", "cho", "cua", "khach", "hang", "va", "cac", "mien", "bac", "nam", "trung", "dien", "may", "luan"]);
const solTokens = (s) => removeAccents(String(s).replace(/\[[^\]]*\]/g, " ")).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !SOL_STOP.has(t));

/** Solution id the message points at (GP-… id, name phrase, or ≥ 2 distinctive words) — else null. */
export function matchSolution(message, solutions) {
  if (!solutions?.length) return null;
  const raw = String(message).toUpperCase();
  for (const s of solutions) if (s.id && raw.includes(String(s.id).toUpperCase())) return s.id;
  const text = removeAccents(message);
  const textTokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null;
  for (const s of solutions) {
    const name = removeAccents(String(s.name).replace(/\[[^\]]*\]/g, " ").replace(/—.*$/, "")).replace(/\s+/g, " ").trim();
    if (name.length >= 6 && text.includes(name)) return s.id;
    const toks = [...new Set(solTokens(s.name))];
    const shared = toks.filter((t) => textTokens.has(t)).length;
    if (shared >= 2 && (!best || shared > best.shared)) best = { id: s.id, shared };
  }
  return best ? best.id : null;
}

// ── Tín hiệu / câu hỏi bồi ──────────────────────────────────────────────
export const SOLUTION_WORDS = /giai phap|so tay|trial|nhan rong|mo rong|\bgp-\d|thung nhua|ccdc|tach tuyen|lot pallet|cai tien|baseline|\bpsd\b.*(220|nhua)/;
const FOLLOW_UP_CUES = /^(con|vay|the|thi|so voi|so sanh|va |cung|nua|tiep|chi tiet|tai sao|sao the|giai thich|ro hon|thang \d|t\d)|\b(no|do|nay|kia|tren|ay|nhu vay|nhu tren)\b|\bthi sao\b|\bnua\b/;

export function looksLikeFollowUp(message) {
  const text = removeAccents(message).trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  return words <= 12 && FOLLOW_UP_CUES.test(text);
}

/**
 * Cuối cùng quyết định ngữ cảnh dùng cho câu này.
 *  - det: thực thể bắt được thẳng trong câu (luôn đáng tin).
 *  - planned: ngữ cảnh Planner (AI) đề xuất, ĐÃ đối chiếu danh sách thật.
 *  - prev: ngữ cảnh câu trước (đã sanitize).
 *  - followUp: câu hỏi bồi? (Planner nói, hoặc heuristic nếu Planner lỗi)
 * Tháng: trong câu thắng. Dự án/tỉnh: hợp của (Planner ∪ trong câu) — "so với LG"
 * thành [dự án trước, LG]. Câu độc lập thì không kế thừa gì từ câu trước.
 */
export function mergeContext({ det, planned, prev, followUp }) {
  const out = emptyContext();
  const inherit = followUp ? prev : emptyContext();
  const pick = (a, b) => [...new Set([...(a || []), ...(b || [])])];
  out.projects = pick(planned?.projects?.length ? planned.projects : followUp && !det.projects.length ? inherit.projects : [], det.projects);
  out.provinces = pick(planned?.provinces?.length ? planned.provinces : followUp && !det.provinces.length ? inherit.provinces : [], det.provinces);
  out.months = det.months?.length ? det.months : planned?.months?.length ? planned.months : followUp ? inherit.months : null;
  out.solution = det.solution || planned?.solution || (followUp ? inherit.solution : null) || null;
  return out;
}

/** Validate a context object (from the browser or from the Planner's JSON) against the real lists. */
export function sanitizeContext(raw, { allProjects, provinceSet, solutionIds, clientProject }) {
  const out = emptyContext();
  if (!raw || typeof raw !== "object") {
    if (clientProject) out.projects = [clientProject];
    return out;
  }
  const projKey = new Map(allProjects.map((p) => [removeAccents(p), p]));
  const provKey = new Map([...provinceSet].map((p) => [removeAccents(p), p]));
  const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  out.projects = [...new Set(asList(raw.projects).map((p) => projKey.get(removeAccents(p))).filter(Boolean))].slice(0, 6);
  out.provinces = [...new Set(asList(raw.provinces).map((p) => provKey.get(removeAccents(p))).filter(Boolean))].slice(0, 6);
  const months = asList(raw.months).map(Number).filter((n) => Number.isInteger(n) && n >= 7 && n <= 12);
  out.months = months.length ? [...new Set(months)].sort((a, b) => a - b) : null;
  const sol = typeof raw.solution === "string" ? raw.solution.trim() : "";
  out.solution = sol && solutionIds.has(sol) ? sol : null;
  if (clientProject) out.projects = [clientProject];
  return out;
}

/** Tháng tương đối: "tháng này" / "tháng trước" (giờ VN), chỉ trong cửa sổ dữ liệu 07–12. */
export function extractRelativeMonths(message, now = new Date(Date.now() + 7 * 3600 * 1000)) {
  const text = removeAccents(message);
  const cur = now.getUTCMonth() + 1;
  const out = [];
  if (/thang nay|thang hien tai/.test(text)) out.push(cur);
  if (/thang truoc|thang vua roi|thang ngoai/.test(text)) out.push(cur - 1);
  return out.filter((m) => m >= 7 && m <= 12);
}

export function extractMonthsAll(message) {
  const explicit = extractMonths(message) || [];
  const rel = extractRelativeMonths(message);
  const all = [...new Set([...explicit, ...rel])].sort((a, b) => a - b);
  return all.length ? all : null;
}
