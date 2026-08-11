/**
 * lib/ai-narrative.js
 * Turns the already-computed LTL insight numbers (breakage routes, capacity
 * routes, period-comparison deltas) into a short Vietnamese narrative via
 * Gemini — the rest of the AI Insights tab is rule-based math; this is the
 * one call that actually reasons over it in natural language.
 */
import { GoogleGenAI } from "@google/genai";

let client;
function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY env var");
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `Bạn là chuyên viên phân tích vận hành logistics cho đội Solution Điện Máy tại GHN.
Bạn nhận dữ liệu vận hành LTL (đã được tính toán sẵn: tỷ lệ bể vỡ theo tuyến, tuyến sắp đầy xe, so sánh số đơn/trọng lượng/ontime so với kỳ trước) và viết nhận định ngắn cho quản lý đọc.

Yêu cầu:
- Viết tiếng Việt tự nhiên, giọng báo cáo nội bộ, không khách sáo.
- Không liệt kê lại số liệu thô — người đọc đã thấy bảng số liệu ngay bên cạnh. Chỉ nêu điều đáng chú ý và vì sao nó đáng chú ý.
- Ưu tiên vấn đề nghiêm trọng nhất trước, kèm đề xuất hành động cụ thể (không nói chung chung kiểu "cần theo dõi thêm").
- Nếu dữ liệu không có gì bất thường, nói thẳng là ổn, đừng cố tìm vấn đề để viết.
- Không dùng markdown heading hay bullet list — viết đoạn văn liền mạch, tối đa 5 câu.`;

export async function generateInsightNarrative(insights) {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Dữ liệu vận hành LTL hiện tại:\n\n${JSON.stringify(insights, null, 2)}\n\nViết nhận định.`,
    config: {
      systemInstruction: SYSTEM_PROMPT,
    },
  });
  return (response.text || "").trim();
}
