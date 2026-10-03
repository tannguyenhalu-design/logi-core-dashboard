/**
 * Planner — lần gọi AI nhanh #1 của "Tiểu Đệ SD3".
 *
 * Nhận câu hỏi + vài tin gần nhất + ngữ cảnh câu trước → trả JSON:
 *   { intent, agents: ["numbers"|"damage"|"solutions"], steps: [...], followUp, context: {...} }
 * Planner chỉ ĐỊNH HƯỚNG. Mọi thứ nó trả đều bị đối chiếu với dữ liệu thật
 * (tên dự án, tỉnh, mã giải pháp, quyền của người hỏi) và hợp với tín hiệu cứng
 * bắt bằng code, nên Planner lỗi/hoang tưởng cũng không làm sai số.
 * Planner lỗi hẳn → kế hoạch dựng bằng code (`fallbackPlan`), vẫn trả lời được.
 */
import { generateFast } from "../ai-providers";
import { extractOrderCodes } from "../ai-agent-tools";
import { removeAccents, canSeeSolutions } from "./common";
import {
  sanitizeContext, mergeContext, looksLikeFollowUp, matchProjectsLoose, matchProvincesStrict, matchSolution,
  extractMonthsAll, SOLUTION_WORDS,
} from "./context";

export const INTENTS = ["ORDER_LOOKUP", "ROUTE_COMPARE", "DAMAGE_QUERY", "SOLUTION_QUERY", "DATA_QUERY", "UNSUPPORTED", "CHITCHAT"];
const AGENTS = ["numbers", "damage", "solutions"];

const DAMAGE_WORDS = /be vo|hu hong|hong hoc|boi thuong|den bu|khieu nai|rillnet|mop|meo|truy thu|ca con mo|chua xu ly|tai phat/;
const ROUTE_WORDS = /tuyen|chang|tu .+ (di|den|toi|ra|vao) |→|->/;
const UNSUPPORTED_WORDS = /doanh thu|revenue|\bnsr\b|run.?rate|du bao|giao task|tao task|giao viec/;
const EXPAND_WORDS = /mo rong|nhan rong|nen mo|them tuyen|tuyen nao|con tuyen|ap dung them|nen ap dung|khoang trong|do phu/;
const RATE_WORDS = /ty le|phan tram|bao nhieu %|\d\s*%|tren tong/;

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

function plannerPrompt({ message, history, prevContext, allProjects, solutions, solutionsAllowed }) {
  const recent = history.slice(-4).map((h) => `${h.role === "user" ? "Đại Ca" : "Tiểu Đệ"}: ${clip(h.text, 220)}`).join("\n") || "(chưa có)";
  const sols = solutionsAllowed && solutions.length ? solutions.slice(0, 12).map((s) => `${s.id} | ${s.name}`).join("\n") : "(không có / người hỏi không có quyền)";
  return `Bạn là Planner của trợ lý vận hành LTL Điện Máy. Phân tích câu hỏi và lập kế hoạch, KHÔNG trả lời câu hỏi.

CÂU HỎI: "${message}"
HỘI THOẠI GẦN ĐÂY:
${recent}
NGỮ CẢNH CÂU TRƯỚC (đã hiểu): ${JSON.stringify(prevContext)}
DANH SÁCH DỰ ÁN (chỉ được dùng đúng các tên này): ${allProjects.join("; ")}
DANH SÁCH GIẢI PHÁP SỔ TAY (id | tên):
${sols}

Chọn intent: ORDER_LOOKUP (tra mã đơn cụ thể) | ROUTE_COMPARE (tuyến/tỉnh đi→đến) | DAMAGE_QUERY (bể vỡ, hư hỏng, đền bù, ca còn mở, nguyên nhân) | SOLUTION_QUERY (giải pháp cải tiến trong Sổ tay: hiệu quả, trial, nhân rộng, mở rộng tuyến) | DATA_QUERY (số đơn, tấn, on-time, late, đơn treo, chờ lấy, dự án, kho) | UNSUPPORTED (FTL/chuyến xe, doanh thu/NSR, dự báo, tạo/giao task) | CHITCHAT.
Tác tử có thể gọi: "numbers" (số liệu đơn/tấn/on-time/tuyến), "damage" (hư hỏng & rủi ro), "solutions" (Sổ tay giải pháp). Có thể chọn nhiều tác tử; chọn đủ để trả lời trọn câu.
"context" = dự án / tháng (số 7–12) / giải pháp (id) / tỉnh mà câu hỏi đang nói tới. Câu hỏi bồi ("còn tháng 8?", "so với LG?") thì kế thừa phần câu trước đã hiểu mà câu mới không đổi, và đặt "followUp": true. Câu hỏi mới hoàn toàn thì "followUp": false và KHÔNG kế thừa.
Hỏi "tuyến LTL nào nên chuyển sang FTL" là ROUTE_COMPARE/DAMAGE_QUERY, không phải UNSUPPORTED.

Trả về JSON thuần:
{"intent":"...","agents":["..."],"followUp":false,"context":{"projects":[],"months":[],"solution":null,"provinces":[]},"steps":["tối đa 4 bước ngắn Tiếng Việt: cần tính gì"]}`;
}

/** Hard signals read straight from the message — always trusted. */
export function detectSignals(message, { allProjects, provinceSet, solutions, solutionsAllowed }) {
  const text = removeAccents(message);
  const codes = extractOrderCodes(message);
  const det = {
    projects: matchProjectsLoose(message, allProjects),
    months: extractMonthsAll(message),
    provinces: matchProvincesStrict(message, provinceSet),
    solution: solutionsAllowed ? matchSolution(message, solutions) : null,
  };
  return {
    text, codes, det,
    damage: DAMAGE_WORDS.test(text),
    route: ROUTE_WORDS.test(text),
    unsupported: UNSUPPORTED_WORDS.test(text),
    solutionTalk: solutionsAllowed && (SOLUTION_WORDS.test(text) || !!det.solution),
    solutionTalkDenied: !solutionsAllowed && SOLUTION_WORDS.test(text),
    expand: EXPAND_WORDS.test(text),
    rate: RATE_WORDS.test(text),
    weekly: /tuan/.test(text),
  };
}

/** Code-only plan (Planner failed, or to complement it). */
function fallbackPlan(sig, intentHint) {
  let intent = intentHint && INTENTS.includes(intentHint) ? intentHint : null;
  if (!intent) {
    if (sig.codes.length) intent = "ORDER_LOOKUP";
    else if (sig.solutionTalk) intent = "SOLUTION_QUERY";
    else if (sig.damage) intent = "DAMAGE_QUERY";
    else if (sig.route && sig.det.provinces.length) intent = "ROUTE_COMPARE";
    else intent = "DATA_QUERY";
  }
  return { intent, agents: [], steps: [], followUp: null, context: null };
}

/**
 * @returns {Promise<{plan, ctx, signals, plannerOk, plannerProvider, ms}>}
 *   plan.agents = tác tử sẽ chạy (đã lọc theo quyền); ctx = ngữ cảnh đã hiểu (đã đối chiếu).
 */
export async function planQuestion({ message, history, prevContext, allProjects, provinceSet, solutions, role, clientProject }) {
  const t0 = Date.now();
  const solutionsAllowed = canSeeSolutions(role);
  const sig = detectSignals(message, { allProjects, provinceSet, solutions, solutionsAllowed });
  const solutionIds = new Set((solutionsAllowed ? solutions : []).map((s) => s.id));
  const lists = { allProjects, provinceSet, solutionIds, clientProject };
  const prev = sanitizeContext(prevContext, lists);

  let planned = null, plannerOk = false, plannerProvider = null;
  if (!sig.unsupported || sig.codes.length) {
    try {
      const out = await generateFast({
        systemPrompt: "Chỉ trả về JSON hợp lệ, không có text nào khác.",
        userPrompt: plannerPrompt({ message, history, prevContext: prev, allProjects, solutions, solutionsAllowed }),
        temperature: 0.1,
      });
      const m = out.text.match(/\{[\s\S]*\}/);
      if (m) { planned = JSON.parse(m[0]); plannerOk = true; plannerProvider = out.provider; }
    } catch (e) {
      console.warn("[ai-chat] planner failed, using code plan:", e.message);
    }
  }

  const base = planned && INTENTS.includes(planned.intent) ? planned : fallbackPlan(sig, null);
  let intent = base.intent;
  const followUp = planned && typeof planned.followUp === "boolean" ? planned.followUp : looksLikeFollowUp(message) && !sig.codes.length;
  const plannedCtx = planned?.context ? sanitizeContext(planned.context, lists) : null;
  let ctx = mergeContext({ det: sig.det, planned: plannedCtx, prev, followUp });
  if (clientProject) ctx.projects = [clientProject]; // khách chỉ thấy dự án của mình

  // Hard signals override a Planner slip.
  if (sig.codes.length) intent = "ORDER_LOOKUP";
  if (sig.unsupported && !sig.codes.length) intent = "UNSUPPORTED";

  // Which agents run: Planner's pick ∪ hard signals, minus what this role may not see.
  const picked = new Set((Array.isArray(planned?.agents) ? planned.agents : []).filter((a) => AGENTS.includes(a)));
  if (intent === "DATA_QUERY" || intent === "ORDER_LOOKUP" || intent === "ROUTE_COMPARE") picked.add("numbers");
  if (intent === "DAMAGE_QUERY") picked.add("damage");
  if (intent === "SOLUTION_QUERY") picked.add("solutions");
  if (sig.codes.length) picked.add("numbers");
  if (sig.damage) picked.add("damage");
  if (sig.solutionTalk) picked.add("solutions");
  if (intent === "SOLUTION_QUERY" && !solutionsAllowed) { intent = "DATA_QUERY"; picked.add("numbers"); }
  if (!solutionsAllowed) picked.delete("solutions");
  if (intent === "CHITCHAT" || intent === "UNSUPPORTED") picked.clear();
  else if (!picked.size) picked.add("numbers");

  // Cờ cho tác tử.
  const routes = ctx.provinces.length > 0 && (intent === "ROUTE_COMPARE" || sig.route || ctx.provinces.length >= 2);
  const flags = { routes, weekly: sig.weekly, expand: sig.expand };
  // Câu hỏi bồi về tuyến ("còn tháng 8?") — giữ chế độ tuyến khi tỉnh được kế thừa.
  if (followUp && ctx.provinces.length && prev.provinces.length && !sig.det.provinces.length && intent !== "DATA_QUERY") flags.routes = true;

  const steps = (Array.isArray(planned?.steps) ? planned.steps : []).filter((s) => typeof s === "string").slice(0, 4).map((s) => clip(s, 140));
  return {
    plan: { intent, agents: AGENTS.filter((a) => picked.has(a)), steps, followUp, flags },
    ctx, signals: sig, plannerOk, plannerProvider, ms: Date.now() - t0,
  };
}

/**
 * Vòng ReAct bổ sung (tối đa 1): Planner "thấy thiếu dữ liệu" sau khi tác tử trả kết quả
 * → gọi thêm tác tử chưa chạy. Chỉ bằng code, không thêm lần gọi AI.
 */
export function planFollowUp({ plan, signals, results, role }) {
  const ran = new Set(plan.agents);
  const extra = [];
  const reasons = [];
  // Hỏi TỶ LỆ bể vỡ mà mới có tác tử Hư hỏng → cần mẫu số (đơn) từ tác tử Số liệu.
  if (ran.has("damage") && !ran.has("numbers") && signals.rate) { extra.push("numbers"); reasons.push("câu hỏi cần tỷ lệ — lấy thêm số đơn làm mẫu số"); }
  // Tác tử Số liệu chạy một mình nhưng câu có từ khoá hư hỏng mà Planner bỏ sót.
  if (ran.has("numbers") && !ran.has("damage") && signals.damage) { extra.push("damage"); reasons.push("câu hỏi nhắc hư hỏng — lấy thêm ca Rillnet"); }
  // Giải pháp: hỏi mở rộng nhưng tác tử Giải pháp chưa chạy (Planner bỏ sót).
  if (!ran.has("solutions") && canSeeSolutions(role) && signals.expand && signals.solutionTalk) { extra.push("solutions"); reasons.push("câu hỏi về mở rộng giải pháp"); }
  return { agents: extra, reasons };
}
