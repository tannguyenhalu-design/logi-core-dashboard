/**
 * pages/api/root-cause.js — Root Cause Investigation endpoint (Phase 3).
 *
 * POST { anomaly_id, anomaly? }
 *   1. Loads the LTL snapshot.
 *   2. Runs deterministic analyzeRootCause() — NEVER sends raw data to AI.
 *   3. Feeds the structured analysis to AI Aggregator for natural Vietnamese explanation.
 *   4. Returns the full structured result + AI narrative.
 *
 * Auth: manager or sd3 only.
 */
import { getSession } from "../../lib/auth";
import { loadLtlBase } from "../../lib/ltl-snapshot";
import { scanAnomalies } from "../../lib/anomaly-detector";
import { analyzeRootCause } from "../../lib/root-cause-engine";
import { generateWithFallback } from "../../lib/ai-providers";

export const config = { maxDuration: 60 };

const ROOT_CAUSE_SYSTEM_PROMPT = `Bạn là chuyên gia phân tích nguyên nhân vận hành LTL (hàng lẻ) ngành Điện Máy tại GHN, khu vực SD3.
Nhiệm vụ: Giải thích kết quả phân tích định lượng đã tính sẵn bằng tiếng Việt rõ ràng, trung thực.

QUY TẮC QUAN TRỌNG:
1. KHÔNG ĐƯỢC khẳng định "Nguyên nhân gốc rễ là X" — chỉ được nói "Ứng viên nguyên nhân" hoặc "Có thể do".
2. Chỉ được dùng số trong phần "PHÂN TÍCH ĐỊNH LƯỢNG" bên dưới. KHÔNG tự tính thêm.
3. Nêu rõ "Độ mạnh bằng chứng" theo đúng giá trị đã tính (STRONG/MODERATE/WEAK/CIRCUMSTANTIAL).
4. Nếu bằng chứng yếu → nói thẳng là chưa kết luận được, đề xuất điều tra thêm.
5. Bắt buộc trình bày 4 khối: CÁI GÌ → TẠI SAO (ứng viên) → ĐỘ TIN CẬY → HÀNH ĐỘNG.

ĐỊNH DẠNG (bắt buộc):
## 🔍 CÁI GÌ đã xảy ra
[tóm tắt bất thường, kỳ nào, con số cụ thể]

## 🧩 TẠI SAO có thể đã xảy ra
[liệt kê từng ứng viên nguyên nhân, kèm mức độ bằng chứng]
⚠️ Nếu có bằng chứng phản bác → nêu rõ

## 📊 BẰNG CHỨNG
[contribution analysis, peer comparison — dùng số từ dữ liệu]

## ✅ HÀNH ĐỘNG TIẾP THEO
[điều tra gì, ai cần được liên hệ]

> 📎 **Độ tin cậy phân tích:** [confidence_score]% · [lý do ngắn]`;

function buildRootCausePrompt(analysis) {
  return `PHÂN TÍCH ĐỊNH LƯỢNG (JSON — chỉ được dùng số trong này):
${JSON.stringify(analysis, null, 0)}

Hãy giải thích phân tích trên theo đúng 4 khối quy định, bằng tiếng Việt, súc tích và trung thực.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!["manager", "sd3"].includes(session.user.role)) {
    return res.status(403).json({ error: "Chỉ manager và SD3 có thể xem phân tích nguyên nhân" });
  }

  const { anomaly_id, anomaly: providedAnomaly } = req.body || {};
  if (!anomaly_id) return res.status(400).json({ error: "Thiếu anomaly_id" });

  const started = Date.now();

  try {
    // 1. Load snapshot
    const base = await loadLtlBase().catch(() => null);
    if (!base?.ltlRows?.length) {
      return res.status(503).json({ ok: false, error: "Snapshot chưa sẵn sàng — thử lại sau" });
    }

    // 2. Find the anomaly (use provided or scan fresh)
    let anomaly = providedAnomaly;
    if (!anomaly || anomaly.anomaly_id !== anomaly_id) {
      const today = new Date().toISOString().slice(0, 10);
      const allAnomalies = scanAnomalies(base, { today, minSeverity: "LOW", maxResults: 100 });
      anomaly = allAnomalies.find((a) => a.anomaly_id === anomaly_id);
    }
    if (!anomaly) {
      return res.status(404).json({ ok: false, error: `Không tìm thấy anomaly: ${anomaly_id}` });
    }

    // 3. Deterministic analysis — MUST happen before AI
    const analysis = analyzeRootCause(anomaly, base);

    // 4. AI narrative (strictly from analysis data, no hallucination)
    let aiNarrative = null;
    try {
      aiNarrative = await generateWithFallback(
        ROOT_CAUSE_SYSTEM_PROMPT,
        buildRootCausePrompt(analysis),
        { maxTokens: 1500 }
      );
    } catch (aiErr) {
      console.warn("[root-cause] AI narrative failed (non-blocking):", aiErr.message);
    }

    const tookMs = Date.now() - started;
    return res.status(200).json({
      ok: true,
      anomaly_id,
      tookMs,
      analysis,
      ai_narrative: aiNarrative || null,
    });
  } catch (err) {
    console.error("[/api/root-cause] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
