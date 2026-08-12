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

const SYSTEM_PROMPT = `Bạn là Trợ lý AI B2B Logistics Điện Máy (LogiCore AI Agent).
Bạn là bộ não phân tích chuyên sâu cho đội ngũ Quản lý và Chuyên viên Solution Điện Máy tại GHN.

BẠN CÓ TOÀN BỘ CƠ SỞ DỮ LIỆU THỰC TẾ VẬN HÀNH:
- Chi tiết 35 Dự án Vận hành SD3 (tên dự án, PIC phụ trách, Doanh thu dự kiến, Mô hình LTL/FTL, SOP, trạng thái).
- Sản lượng đơn hàng, khối lượng (tấn/kg) và % Ontime theo từng Khách hàng / Đối tác.
- Thống kê chi tiết theo Kho lấy / Kho giao và theo từng ngày cụ thể trong tháng.
- Dữ liệu sự cố hư hỏng đền bù và tuyến đường rủi ro.

YÊU CẦU PHÂN TÍCH AGENTIC CHUYÊN SÂU:
1. Trả lời trực tiếp, chính xác 100% dựa vào dữ liệu thực tế được cấp.
2. Thực hiện tốt các yêu cầu so sánh, đối chiếu (giữa các PIC, giữa các dự án, giữa các kho, giữa các ngày, giữa các vùng miền).
3. Duy trì mạch ngữ cảnh hội thoại (khi người dùng hỏi dồn, hỏi lấp lửng như "thế ngày 11/08 thì sao", "dự án nào doanh thu cao nhất", "ai đang phụ trách nhiều nhất").
4. Trình bày bằng tiếng Việt chuyên nghiệp, ngắn gọn, súc tích (độ dài 3-5 câu).`;

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
    const rawDamage = await fetchSheet("raw_damage", ltlSheetId).catch(() => []);
    const masterSheetId = process.env.GOOGLE_SHEET_ID_PROJECTS || process.env.SHEET_ID_PROJECTS || process.env.GOOGLE_SHEET_ID;
    const rawProjects = await fetchSheet("Data dự án", masterSheetId).catch(() => []);

    const filteredLTL = (rawLTL || []).filter(
      (r) => isDMClient(r["client_name"]) && isFromJuly2026(r["pickup_time"]) && isLTLRow(r)
    );

    // 1. Projects & PIC Context
    const projectsList = [];
    const picSummary = {};
    if (Array.isArray(rawProjects) && rawProjects.length > 1) {
      const headers = rawProjects[0].map((h) => String(h || "").trim());
      const nameIdx = headers.findIndex(h => h === "TÊN DỰ ÁN" || h === "Client name" || h === "Tên dự án");
      const picIdx = headers.findIndex(h => h === "ĐẢM NHIỆM" || h === "PIC SD" || h === "PIC");
      const revIdx = headers.findIndex(h => h === "Doanh Thu dự kiến" || h === "Doanh thu dự kiến");
      const modelIdx = headers.findIndex(h => h === "MÔ HÌNH VẬN HÀNH" || h === "Mô hình vận hành");
      const statusIdx = headers.findIndex(h => h === "TRẠNG THÁI" || h === "Trạng thái");

      rawProjects.slice(1).forEach((row) => {
        const name = String(row[nameIdx] || "").trim();
        const pic = String(row[picIdx] || "Chưa gán").trim();
        const revenue = String(row[revIdx] || "0").trim();
        const model = String(row[modelIdx] || "").trim();
        const status = String(row[statusIdx] || "").trim();

        if (name) {
          projectsList.push({ name, pic, revenue, model, status });
          if (!picSummary[pic]) picSummary[pic] = { count: 0, projects: [] };
          picSummary[pic].count++;
          picSummary[pic].projects.push(name);
        }
      });
    }

    // 2. Orders & Operations Context
    const totalOrders = filteredLTL.length;
    let totalWeight = 0;
    let deliveredCount = 0;
    let ontimeCount = 0;

    const hcmOrders = [];
    const hanoiOrders = [];
    const clientStats = {};
    const warehouseStats = {};
    const ordersByDate = {};
    const hcmOrdersByDate = {};
    const hanoiOrdersByDate = {};

    filteredLTL.forEach((r) => {
      const w = parseFloat(r["weight"]) || 0;
      totalWeight += w;
      const giao = String(r["kho_giao"] || r["warehouse_giao"] || "").trim();
      const lay = String(r["kho_lay"] || r["warehouse_lay"] || "").trim();
      const client = String(r["client_name"] || "").trim();
      const giaoLower = giao.toLowerCase();
      const layLower = lay.toLowerCase();

      const pTime = r["pickup_time"];
      const d = parseDate(pTime);
      let dateKey = "";
      if (d) {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        dateKey = `${dd}/${mm}`;
      }

      if (dateKey) {
        ordersByDate[dateKey] = (ordersByDate[dateKey] || 0) + 1;
      }

      if (client) {
        if (!clientStats[client]) clientStats[client] = { orders: 0, weight: 0, delivered: 0, ontime: 0 };
        clientStats[client].orders++;
        clientStats[client].weight += w;
      }

      if (giao) {
        if (!warehouseStats[giao]) warehouseStats[giao] = { orders: 0, weight: 0 };
        warehouseStats[giao].orders++;
        warehouseStats[giao].weight += w;
      }

      if (giaoLower.includes("hồ chí minh") || giaoLower.includes("hcm") || giaoLower.includes("sài gòn") || layLower.includes("hcm") || layLower.includes("hồ chí minh")) {
        hcmOrders.push(r);
        if (dateKey) hcmOrdersByDate[dateKey] = (hcmOrdersByDate[dateKey] || 0) + 1;
      }
      if (giaoLower.includes("hà nội") || giaoLower.includes("hn") || layLower.includes("hà nội") || layLower.includes("hn")) {
        hanoiOrders.push(r);
        if (dateKey) hanoiOrdersByDate[dateKey] = (hanoiOrdersByDate[dateKey] || 0) + 1;
      }

      const st = String(r["status"] || "").toLowerCase();
      if (st === "delivered") {
        deliveredCount++;
        const odr = String(r["odr_success"] || "").toLowerCase();
        if (odr === "ontime") {
          ontimeCount++;
          if (client && clientStats[client]) clientStats[client].ontime++;
        }
        if (client && clientStats[client]) clientStats[client].delivered++;
      }
    });

    const hcmDailyAvg = Math.round(hcmOrders.length / 30);
    const hanoiDailyAvg = Math.round(hanoiOrders.length / 30);

    const statsContext = {
      tongSoDuAnSystem: projectsList.length,
      danhSachDuAn: projectsList.slice(0, 20),
      phanPhanCongPIC: picSummary,
      tongSoDonSystem: totalOrders,
      tongSanLuongKg: Math.round(totalWeight),
      tongSanLuongTan: (totalWeight / 1000).toFixed(1),
      tyLeOntimeChung: deliveredCount > 0 ? ((ontimeCount / deliveredCount) * 100).toFixed(1) + "%" : "N/A",
      khuVucHCM: {
        tongSoDonThang: hcmOrders.length,
        trungBinhDonMotNgay: hcmDailyAvg,
        tongTrongLuong: (hcmOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1) + " tấn",
        chiTietTungNgayHCM: hcmOrdersByDate
      },
      khuVucHaNoi: {
        tongSoDonThang: hanoiOrders.length,
        trungBinhDonMotNgay: hanoiDailyAvg,
        tongTrongLuong: (hanoiOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1) + " tấn",
        chiTietTungNgayHN: hanoiOrdersByDate
      },
      chiTietNgayToanHeThong: ordersByDate,
      thongKeTungKhachHang: Object.entries(clientStats).map(([name, s]) => ({
        name,
        orders: s.orders,
        weightTon: (s.weight / 1000).toFixed(1),
        ontimePct: s.delivered > 0 ? ((s.ontime / s.delivered) * 100).toFixed(1) + "%" : "N/A"
      })),
      topKhoGiaoHang: Object.entries(warehouseStats)
        .sort((a, b) => b[1].orders - a[1].orders)
        .slice(0, 10)
        .map(([name, s]) => ({ name, orders: s.orders, weightTon: (s.weight / 1000).toFixed(1) }))
    };

    // Construct multi-turn contents prompt
    const contents = [
      {
        role: "user",
        parts: [{ text: `DƯ LIỆU VẬN HÀNH THỰC TẾ VÀ DỰ ÁN (CƠ SỞ DỮ LIỆU TỰ ĐỘNG):\n${JSON.stringify(statsContext, null, 2)}` }]
      },
      ...history.map((h) => ({
        role: h.role === "user" ? "user" : "model",
        parts: [{ text: h.text }]
      })),
      {
        role: "user",
        parts: [{ text: `CÂU HỎI MỚI CỦA MANAGER: "${message}"` }]
      }
    ];

    const models = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.5-flash"];
    let replyText = "";
    const ai = getClient();

    for (const model of models) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents,
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
      const matchDate = message.match(/(\d{1,2})[\/\-](\d{1,2})/);
      let dateStr = "";
      if (matchDate) {
        dateStr = `${matchDate[1].padStart(2, '0')}/${matchDate[2].padStart(2, '0')}`;
      }
      if (dateStr && hcmOrdersByDate[dateStr]) {
        replyText = `Riêng ngày ${dateStr}, khu vực Hồ Chí Minh ghi nhận xử lý ${hcmOrdersByDate[dateStr]} đơn điện máy.`;
      } else if (dateStr && ordersByDate[dateStr]) {
        replyText = `Riêng ngày ${dateStr}, toàn hệ thống ghi nhận xử lý ${ordersByDate[dateStr]} đơn điện máy.`;
      } else if (message.toLowerCase().includes("hồ chí minh") || message.toLowerCase().includes("hcm")) {
        replyText = `Khu vực Hồ Chí Minh hiện tại ghi nhận khoảng ${hcmDailyAvg} đơn điện máy/ngày (tổng ${hcmOrders.length} đơn tháng này, sản lượng ${(hcmOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1)} tấn).`;
      } else {
        replyText = `Hệ thống ghi nhận tổng cộng ${totalOrders} đơn điện máy trong tháng (tỷ lệ Ontime đạt ${statsContext.tyLeOntimeChung}, tổng sản lượng ${statsContext.tongSanLuongTan} tấn).`;
      }
    }

    return res.status(200).json({ ok: true, reply: replyText, stats: statsContext });
  } catch (err) {
    console.error("[/api/ai-chat] Error:", err);
    return res.status(500).json({ error: "Lỗi xử lý AI Agent: " + err.message });
  }
}
