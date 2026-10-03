/**
 * lib/ai-agents/index.js — điều phối "Tiểu Đệ SD3" đa tác tử (Kế hoạch F · F2).
 *
 *   Planner (AI nhanh #1) → 3 tác tử (module code, chạy trên snapshot trong bộ nhớ,
 *   [+ tối đa 1 vòng bổ sung bằng code]) → Aggregator (AI #2, chỉ chép số tác tử trả).
 *
 * Luôn đúng 2 lần gọi AI (Planner + Aggregator). Thẻ nguồn + "các bước đã làm"
 * do hệ thống dựng từ metadata tác tử, không do AI viết.
 */
import { planQuestion, planFollowUp } from "./planner";
import { aggregate } from "./aggregator";
import { runNumbersAgent } from "./agent-numbers";
import { runDamageAgent } from "./agent-damage";
import { runSolutionsAgent } from "./agent-solutions";
import { makeSource, mergeSources, maxIso } from "./common";
import { provinceNames } from "./context";

export const UNSUPPORTED_REPLY = `Dạ Đại Ca, Tiểu Đệ giờ chỉ phụ trách **LTL Điện Máy** thôi ạ 🙇‍♂️
- Dashboard đã bỏ phân hệ FTL, doanh thu/KPI doanh thu, dự báo và giao task (09/2026), nên Tiểu Đệ không có dữ liệu để trả lời chính xác — Tiểu Đệ không dám đoán bừa.
- Tiểu Đệ trả lời được: số đơn/sản lượng, tỷ lệ on-time, đơn late, đơn treo quá hạn, đơn chờ lấy, bể vỡ & nguyên nhân, ca còn mở, so sánh tuyến/kho, tra cứu mã đơn LTL và kết quả các giải pháp trong Sổ tay (Manager/SD3).

Đại Ca muốn xem phần nào của LTL ạ?`;

export const AI_DOWN_REPLY = "Dạ Đại Ca, Tiểu Đệ tạm thời mất kết nối với các máy chủ AI 🙇‍♂️ Đại Ca thử lại sau ít phút giúp em nhé!";

const AGENT_TITLE = { numbers: "Tác tử Số liệu", damage: "Tác tử Hư hỏng & rủi ro", solutions: "Tác tử Giải pháp & mở rộng" };
const AGENT_BUDGET_MS = 50000; // đến mốc này (từ lúc nhận request) mà AI chưa trả lời thì thôi thử nhà cung cấp tiếp

async function runAgent(name, args) {
  const t0 = Date.now();
  try {
    const r = name === "numbers" ? runNumbersAgent(args)
      : name === "damage" ? runDamageAgent(args)
        : await runSolutionsAgent(args);
    return { ...r, ms: Date.now() - t0 };
  } catch (e) {
    console.warn(`[ai-agents] ${name} failed:`, e);
    return { agent: name, error: `${AGENT_TITLE[name]} gặp lỗi (${e.message})`, data: null, sources: [], steps: [`${AGENT_TITLE[name]} gặp lỗi — bỏ qua phần này`], ms: Date.now() - t0 };
  }
}

/**
 * @param a.history    [{role:"user"|"model", text}] (tối đa 12)
 * @param a.prevContext ngữ cảnh câu trước (từ trình duyệt — sẽ được đối chiếu lại)
 * @param a.params     tham số computeDashboard theo người hỏi (đã khoá theo role / khách)
 * @param a.brain      Promise của loadBrain() — đọc song song với mọi thứ
 */
export async function runAgentPipeline({ message, history = [], prevContext, role, clientProject, base, body, params, solutionsData, brain }) {
  const started = Date.now();
  const deadlineAt = started + AGENT_BUDGET_MS;
  const allProjects = clientProject ? [clientProject] : body.ltl.allProjects || [];
  const provinceSet = provinceNames(base.ltlRows);
  const solutions = solutionsData?.solutions || [];

  const planned = await planQuestion({ message, history, prevContext, allProjects, provinceSet, solutions, role, clientProject });
  const { plan, ctx, signals } = planned;
  // Câu hỏi về 1 giải pháp: dự án = khách của giải pháp (gọi tắt "PSD" không kéo thêm PSD Miền Bắc/Trung).
  if (ctx.solution) {
    const sol = solutions.find((s) => s.id === ctx.solution);
    if (sol) {
      const inter = ctx.projects.filter((p) => sol.clients.includes(p));
      ctx.projects = inter.length ? inter : sol.clients.length <= 3 ? sol.clients : [];
    }
  }
  const steps = [{
    id: "planner", title: "Hiểu câu hỏi",
    detail: [
      `Loại câu hỏi: ${plan.intent}${plan.followUp ? " · câu hỏi bồi (kế thừa ngữ cảnh)" : ""}`,
      plan.agents.length ? `Gọi: ${plan.agents.map((a) => AGENT_TITLE[a]).join(" + ")}` : "Không cần tra số liệu",
      planned.plannerOk ? `Planner AI: ${planned.plannerProvider}` : "Planner AI lỗi/bỏ qua — dùng kế hoạch dựng bằng code",
    ],
    ms: planned.ms,
  }];
  const timing = { planner: planned.ms };

  if (plan.intent === "UNSUPPORTED") {
    return { reply: UNSUPPORTED_REPLY, intent: plan.intent, sources: [], steps, context: ctx, timing: { ...timing, total: Date.now() - started }, aiCalls: planned.plannerOk ? 1 : 0, fixed: true };
  }

  // ── Các tác tử chạy song song trên cùng snapshot ──
  const common = { base, body, params, ctx, message, codes: signals.codes, clientProject, flags: plan.flags };
  const args = (name) => (name === "solutions" ? { base, ctx, flags: plan.flags, solutionsData } : common);
  let results = await Promise.all(plan.agents.map((n) => runAgent(n, args(n))));

  // ── Tối đa 1 vòng bổ sung khi Planner thấy thiếu dữ liệu ──
  const followUp = planFollowUp({ plan, signals, results, role });
  if (followUp.agents.length) {
    const more = await Promise.all(followUp.agents.map((n) => runAgent(n, args(n))));
    results = [...results, ...more];
    steps.push({ id: "react", title: "Vòng bổ sung (thiếu dữ liệu)", detail: followUp.reasons, ms: Math.max(...more.map((r) => r.ms)) });
  }
  const order = { numbers: 0, damage: 1, solutions: 2 };
  results.sort((a, b) => order[a.agent] - order[b.agent]);
  const agentSteps = results.map((r) => ({ id: r.agent, title: AGENT_TITLE[r.agent], detail: r.steps, ms: r.ms }));
  steps.splice(1, 0, ...agentSteps);
  results.forEach((r) => { timing[r.agent] = r.ms; });

  const notes = [];
  if (signals.solutionTalkDenied) notes.push("Người hỏi không có quyền xem Sổ tay giải pháp (chỉ Manager và SD3) — nói nhẹ nhàng, không nêu nội dung giải pháp.");
  if (clientProject) notes.push(`Người hỏi là khách ${clientProject} — chỉ trả lời về dự án này.`);

  // ── Bộ nhớ ──
  const brainRes = await brain;
  const sourceLists = results.map((r) => r.sources);
  if (brainRes?.approvedRelevant?.length) {
    const rel = brainRes.approvedRelevant;
    sourceLists.push([makeSource({
      id: "bo-nho-da-duyet", kind: "brain", label: "Bộ nhớ đã duyệt",
      scope: rel.map((e) => `${e.topic || "quy tắc"} — ${e.verifiedBy || "Manager"}${e.dateLabel ? `, ${e.dateLabel}` : ""}`).join("; "),
      asOf: maxIso(rel.map((e) => e.verifiedAt)), note: "Cách trả lời / định nghĩa đã được Manager duyệt — không phải số liệu",
    })]);
  }
  const sources = mergeSources(sourceLists);

  // ── Aggregator ──
  const t0 = Date.now();
  let reply, aggProvider = null;
  try {
    const out = await aggregate({ message, history, ctx, results, notes, chitchat: plan.intent === "CHITCHAT", brainText: brainRes?.text, deadlineAt });
    reply = out.text; aggProvider = out.provider;
  } catch (e) {
    console.warn("[ai-agents] aggregator failed:", e.message);
    reply = AI_DOWN_REPLY;
  }
  timing.aggregator = Date.now() - t0;
  steps.push({
    id: "aggregator", title: "Tổng hợp & viết lời",
    detail: [aggProvider ? `Viết lời bằng ${aggProvider} — chỉ chép số do các tác tử trả về` : "Các máy chủ AI đều không trả lời"],
    ms: timing.aggregator,
  });
  timing.total = Date.now() - started;

  return {
    reply, intent: plan.intent, sources: reply === AI_DOWN_REPLY ? [] : sources, steps, context: ctx, timing,
    aiCalls: (planned.plannerOk ? 1 : 0) + 1, plannerProvider: planned.plannerProvider, aggregatorProvider: aggProvider, agents: plan.agents.concat(followUp.agents),
    failed: reply === AI_DOWN_REPLY, results,
  };
}
