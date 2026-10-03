/**
 * pages/api/ai-chat.js — "Tiểu Đệ SD3", đa tác tử (Kế hoạch F · F2, 02/10/2026).
 *
 * Planner (AI nhanh) → 3 tác tử module code (Số liệu · Hư hỏng & rủi ro · Giải pháp & mở rộng)
 * chạy song song trên snapshot LTL trong bộ nhớ → Aggregator (AI) viết lời, chỉ chép số do
 * tác tử trả về. Logic nằm ở lib/ai-agents/*; file này chỉ lo đăng nhập, phân quyền, nạp dữ liệu.
 *
 * Request : { message, history: [{role:"user"|"model", text}] (≤ 12), context?: {projects, months, solution, provinces} }
 * Response: { ok, reply, sources[], steps[], context, intent, dataAsOf, canApprove, timing }
 *
 * Phân quyền: cs → 403; client (khách) bị khoá vào dự án của mình; tác tử Giải pháp chỉ Manager + SD3.
 * FTL / doanh thu / dự báo / task → câu trả lời cố định, không gọi AI.
 */
import { getSession } from "../../lib/auth";
import { loadLtlBase, loadDefaultBody } from "../../lib/ltl-snapshot";
import { computeDashboard } from "../../lib/ltl-dashboard";
import { extractInsightsFromChat, saveBrainInsights, loadBrain } from "../../lib/ai-brain";
import { runAgentPipeline } from "../../lib/ai-agents";
import { canSeeSolutions } from "../../lib/ai-agents/common";

// Planner + Aggregator = 2 lần gọi AI nối tiếp (nhà cung cấp dự phòng) — quan sát thực tế 10–15s;
// đừng để Vercel cắt một câu trả lời đang chạy chậm.
export const config = { maxDuration: 60 };

const MAX_HISTORY = 12;
const clean = (s, n) => String(s ?? "").slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  // UI hides the chat button for cs (dashboard.js), but that's not
  // enforcement — block it here too so a direct API call can't bypass it.
  if (session.user.role === "cs") {
    return res.status(403).json({ error: "Vai trò CS không có quyền dùng Tiểu Đệ" });
  }

  const message = clean(req.body?.message, 1000).trim();
  if (!message) return res.status(400).json({ error: "Vui lòng nhập câu hỏi" });
  const history = (Array.isArray(req.body?.history) ? req.body.history : [])
    .filter((h) => h && typeof h.text === "string" && h.text.trim())
    .slice(-MAX_HISTORY)
    .map((h) => ({ role: h.role === "user" ? "user" : "model", text: clean(h.text, 1500) }));

  try {
    const role = session.user.role || "manager";
    const clientProject = role === "client" ? session.user.project || null : null;
    const params = {
      role, userPic: session.user.pic || null,
      months: null, projects: clientProject ? [clientProject] : null, filterMode: "pickup",
      viewAsType: clientProject ? "client" : "manager", viewAsValue: null,
      dateFrom: null, dateTo: null, origin: null, periodWeeks: "mtd",
    };

    // Sổ tay chỉ đọc cho Manager + SD3 (lỗi Sheets không được làm hỏng câu trả lời khác).
    const solutionsPromise = canSeeSolutions(role)
      ? import("../../lib/solutions").then((m) => m.readSolutions()).catch((e) => { console.warn("[ai-chat] readSolutions failed:", e.message); return { solutions: [] }; })
      : Promise.resolve({ solutions: [] });
    const brain = loadBrain({ question: message });

    const [base, defaultBody, solutionsData] = await Promise.all([
      loadLtlBase(),
      clientProject ? null : loadDefaultBody(),
      solutionsPromise,
    ]);
    const body = defaultBody || computeDashboard(base, params);

    const out = await runAgentPipeline({
      message, history, prevContext: req.body?.context, role, clientProject, base, body, params, solutionsData, brain,
    });

    // Fire-and-forget: learn from this exchange (lib/ai-brain.js) — chỉ thành "Đề xuất", Manager duyệt sau.
    if (out.reply && !out.fixed && !out.failed) {
      extractInsightsFromChat({
        message,
        reply: out.reply,
        userName: session.user.name || session.user.email,
        projectsList: (clientProject ? [clientProject] : body.ltl.allProjects || []).map((name) => ({ name })),
      })
        .then((insights) => insights.length > 0 && saveBrainInsights(insights.map((i) => ({ ...i, source: session.user.email || "chat" }))))
        .catch((e) => console.warn("[ai-chat] brain save error:", e.message));
    }

    return res.status(200).json({
      ok: true,
      reply: out.reply,
      sources: out.sources,
      steps: out.steps,
      context: out.context,
      intent: out.intent,
      dataAsOf: base.builtAt,
      canApprove: role === "manager" && !out.fixed && !out.failed,
      timing: out.timing,
    });
  } catch (err) {
    console.error("[/api/ai-chat] Error:", err);
    return res.status(500).json({ error: "Lỗi xử lý AI Agent: " + err.message });
  }
}
