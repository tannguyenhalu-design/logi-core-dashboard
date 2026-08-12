import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { isDMClient, isLTLRow, isFromJuly2026 } from "../../lib/dm-clients";
import { parseDate } from "../../lib/transform-ltl";
import { GoogleGenAI } from "@google/genai";

let client;
function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `Bạn là Trợ lý AI B2B Logistics Điện Máy (LogiCore Copilot).
Bạn trả lời các câu hỏi về tình hình vận hành, đơn hàng, tuyến đường, sản lượng, tỷ lệ giao đúng giờ (Ontime) và hư hỏng của đội Điện Máy GHN.

QUY TẮC:
- CHỈ trả lời dựa trên số liệu thực tế được tính toán và truyền vào. Không bịa thêm số liệu không có thực.
- Trả lời bằng tiếng Việt chuyên nghiệp, ngắn gọn, súc tích (độ dài 2-4 câu).
- Trình bày rõ ràng các con số (VD: 1.250 đơn/ngày, 89.5% Ontime, 45.2 tấn).`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  const { message, history = [] } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Vui lòng nhập câu hỏi" });
  }

  try {
    const ltlSheetId = process.env.SHEET_ID_LTL;
    const rawLTL = await fetchSheet("raw_ontime", ltlSheetId).catch(() => []);
    const filteredLTL = (rawLTL || []).filter(
      (r) => isDMClient(r["client_name"]) && isFromJuly2026(r["pickup_time"]) && isLTLRow(r)
    );

    // Compute stats for query context
    const totalOrders = filteredLTL.length;
    let totalWeight = 0;
    let deliveredCount = 0;
    let ontimeCount = 0;
    
    // Group by destination warehouse / province
    const hcmOrders = [];
    const hanoiOrders = [];
    const clientStats = {};

    filteredLTL.forEach((r) => {
      const w = parseFloat(r["weight"]) || 0;
      totalWeight += w;
      const giao = String(r["kho_giao"] || r["warehouse_giao"] || "").toLowerCase();
      const lay = String(r["kho_lay"] || r["warehouse_lay"] || "").toLowerCase();
      const client = String(r["client_name"] || "").trim();

      if (client) {
        if (!clientStats[client]) clientStats[client] = { orders: 0, weight: 0 };
        clientStats[client].orders++;
        clientStats[client].weight += w;
      }

      if (giao.includes("hồ chí minh") || giao.includes("hcm") || giao.includes("sài gòn") || lay.includes("hcm") || lay.includes("hồ chí minh")) {
        hcmOrders.push(r);
      }
      if (giao.includes("hà nội") || giao.includes("hn") || lay.includes("hà nội") || lay.includes("hn")) {
        hanoiOrders.push(r);
      }

      const st = String(r["status"] || "").toLowerCase();
      if (st === "delivered") {
        deliveredCount++;
        const odr = String(r["odr_success"] || "").toLowerCase();
        if (odr === "ontime") ontimeCount++;
      }
    });

    const hcmDailyAvg = Math.round(hcmOrders.length / 30); // ~30 days in month
    const hanoiDailyAvg = Math.round(hanoiOrders.length / 30);

    const statsContext = {
      tongSoDonSystem: totalOrders,
      tongSanLuongKg: Math.round(totalWeight),
      tongSanLuongTan: (totalWeight / 1000).toFixed(1),
      tyLeOntimeChung: deliveredCount > 0 ? ((ontimeCount / deliveredCount) * 100).toFixed(1) + "%" : "N/A",
      khuVucHCM: {
        tongSoDonThang: hcmOrders.length,
        trungBinhDonMotNgay: hcmDailyAvg,
        tongTrongLuong: (hcmOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1) + " tấn"
      },
      khuVucHaNoi: {
        tongSoDonThang: hanoiOrders.length,
        trungBinhDonMotNgay: hanoiDailyAvg,
        tongTrongLuong: (hanoiOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1) + " tấn"
      },
      topKhachHang: Object.entries(clientStats)
        .sort((a, b) => b[1].orders - a[1].orders)
        .slice(0, 5)
        .map(([name, s]) => ({ name, orders: s.orders, weightTon: (s.weight / 1000).toFixed(1) }))
    };

    const models = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.5-flash"];
    let replyText = "";
    const ai = getClient();

    for (const model of models) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: `CƠ SỞ DỮ LIỆU THỰC TẾ (CHỈ DÙNG SỐ LIỆU NÀY TÍNH TOÁN):\n${JSON.stringify(statsContext, null, 2)}\n\nCÂU HỎI CỦA QUẢN LÝ: "${message}"\n\nHãy trả lời ngắn gọn, chuẩn xác.`,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.2,
          },
        });
        replyText = (resp.text || "").trim();
        if (replyText) break;
      } catch (err) {
        console.warn(`[ai-chat] Model ${model} failed:`, err.message);
      }
    }

    if (!replyText) {
      if (message.toLowerCase().includes("hồ chí minh") || message.toLowerCase().includes("hcm")) {
        replyText = `Khu vực Hồ Chí Minh hiện tại ghi nhận khoảng ${hcmDailyAvg} đơn điện máy/ngày (tổng ${hcmOrders.length} đơn tháng này, sản lượng ${(hcmOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1)} tấn).`;
      } else {
        replyText = `Hệ thống ghi nhận tổng cộng ${totalOrders} đơn điện máy trong tháng (tỷ lệ Ontime đạt ${statsContext.tyLeOntimeChung}, tổng sản lượng ${statsContext.tongSanLuongTan} tấn).`;
      }
    }

    return res.status(200).json({ ok: true, reply: replyText, stats: statsContext });
  } catch (err) {
    console.error("[/api/ai-chat] Error:", err);
    return res.status(500).json({ error: "Lỗi xử lý AI: " + err.message });
  }
}
