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
Bạn nhận một khối JSON số liệu đã tính sẵn (nội dung và cấu trúc có thể khác nhau tuỳ màn hình — dự án, task, tuyến vận chuyển, so sánh kỳ...) và viết nhận định ngắn cho người đọc.

QUY TẮC BẮT BUỘC:
- CHỈ được nhắc tới số liệu/tên xuất hiện đúng trong JSON được cung cấp. Tuyệt đối không bịa thêm số liệu, tên tuyến, tên dự án, hay % nào không có trong JSON.
- Nếu JSON không chứa trường nào đó (ví dụ không có "route"/"tuyến"), không được tự suy diễn hay nhắc tới khái niệm đó.

Yêu cầu văn phong:
- Viết tiếng Việt tự nhiên, giọng báo cáo nội bộ, không khách sáo.
- Không liệt kê lại số liệu thô — người đọc đã thấy bảng số liệu ngay bên cạnh. Chỉ nêu điều đáng chú ý và vì sao nó đáng chú ý.
- Ưu tiên vấn đề nghiêm trọng nhất trước, kèm đề xuất hành động cụ thể (không nói chung chung kiểu "cần theo dõi thêm").
- Nếu dữ liệu không có gì bất thường, nói thẳng là ổn, đừng cố tìm vấn đề để viết.
- Không dùng markdown heading hay bullet list — viết đoạn văn liền mạch, tối đa 5 câu.`;

function generateFallbackNarrative(insights) {
  const parts = [];
  if (insights.overall) {
    const o = insights.overall;
    const ordersDirection = (o.ordersDeltaPct ?? 0) >= 0 ? "tăng" : "giảm";
    const weightDirection = (o.weightDeltaPct ?? 0) >= 0 ? "tăng" : "giảm";
    const ontimeDirection = (o.ontimeDeltaPoints ?? 0) >= 0 ? "tăng" : "giảm";

    parts.push(
      `Tổng quan so với cùng kỳ: Số lượng đơn hàng ${ordersDirection} ${Math.abs(o.ordersDeltaPct || 0)}%, khối lượng vận chuyển ${weightDirection} ${Math.abs(o.weightDeltaPct || 0)}%, và chỉ số Ontime ${ontimeDirection} ${Math.abs(o.ontimeDeltaPoints || 0)} điểm.`
    );
  }
  if (insights.warningItems && insights.warningItems.length > 0) {
    const names = insights.warningItems.slice(0, 5).map((w) => w.name).join(", ");
    parts.push(
      `Có ${insights.warningItems.length} khách hàng/tuyến cần ưu tiên kiểm tra do giảm sút (gồm: ${names}).`
    );
  }
  if (insights.breakageRoutes && insights.breakageRoutes.length > 0) {
    const r = insights.breakageRoutes[0];
    parts.push(`Tuyến ${r.route} ghi nhận tỷ lệ hư hỏng cao đáng chú ý (${r.rate}% với ${r.damaged} ca).`);
  }
  if (parts.length === 0) {
    return "Tình hình vận hành ổn định, sản lượng và chỉ số đúng giờ duy trì đạt kế hoạch.";
  }
  return parts.join(" ");
}

export async function generateInsightNarrative(insights) {
  const models = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.5-flash"];
  const ai = getClient();

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Dữ liệu (JSON) cần phân tích — chỉ dùng đúng thông tin trong đây:\n\n${JSON.stringify(insights, null, 2)}\n\nViết nhận định.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.3,
        },
      });
      const text = (response.text || "").trim();
      if (text) return text;
    } catch (err) {
      console.warn(`[ai-narrative] Model ${model} failed (${err.message}), trying next model...`);
    }
  }
  return generateFallbackNarrative(insights || {});
}
