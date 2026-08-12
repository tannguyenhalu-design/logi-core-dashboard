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

const SYSTEM_PROMPT = `Bạn là Siêu AI Agent Đa Năng & Copilot Vận Hành B2B Logistics Điện Máy (LogiCore Omni AI Agent).
Bạn được trang bị NĂNG LỰC TRI THỨC TOÀN NĂNG (TOÀN BỘ TRI THỨC NHƯ CHATGPT/CLAUDE/GEMINI) KẾT HỢP DỮ LIỆU THỰC TẾ NỘI BỘ.

1. NĂNG LỰC TOÀN NĂNG NHƯ CHATGPT:
- Bạn trả lời mượt mà, sâu sắc MỌI câu hỏi: Từ viết email thương lượng đối tác, tư vấn chiến lược cắt giảm chi phí kho bãi, giải toán, phân tích thị trường, dịch thuật, viết code, tư vấn quy trình SOP, lập kế hoạch nhân sự...
- Không giới hạn phạm vi câu hỏi. Nếu Quản lý hỏi câu hỏi xã hội hay chuyên môn tổng quát, hãy trả lời tự nhiên, sắc bén y hệt ChatGPT.

2. NĂNG LỰC DỮ LIỆU NỘI BỘ REAL-TIME (ENTERPRISE DATA GROUNDING):
- Khi câu hỏi đụng tới số liệu công ty (đơn hàng, dự án, PIC, sản lượng, Ontime, hư hỏng, kho giao/nhận...), bạn sử dụng CHÍNH XÁC cơ sở dữ liệu thực tế được cấp.

3. KHẢ NĂNG THỰC THI HÀNH ĐỘNG (AGENTIC ACTION EXECUTION):
- Khi Quản lý yêu cầu tạo Task / Giao việc / Nhắc nhở (ví dụ: "Tạo task giao Duy Tú kiểm tra kho Củ Chi trước 17h"), hãy trả lời xác nhận và bổ sung 1 dòng JSON hành động ở cuối:
[ACTION:CREATE_TASK:{"title":"...","assignee":"...","deadline":"...","notes":"..."}]

VĂN PHONG: Tiếng Việt tự nhiên, súc tích, sắc bén, chuyên nghiệp.`;

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
    if (Array.isArray(rawProjects)) {
      rawProjects.forEach((row) => {
        const name = String(row["TÊN DỰ ÁN"] || row["Client name"] || row["Tên dự án"] || "").trim();
        const pic = String(row["ĐẢM NHIỆM"] || row["PIC SD"] || row["PIC"] || "Chưa gán").trim();
        const revenueTarget = String(row["Doanh Thu dự kiến"] || row["Doanh thu dự kiến"] || "0").trim();
        const lastMoNSR = String(row["Last Mo NSR"] || "0").trim();
        const actualNSR = String(row["RR/NSR"] || "0").trim();
        const model = String(row["MÔ HÌNH VẬN HÀNH"] || row["Mô hình vận hành"] || "").trim();
        const status = String(row["TRẠNG THÁI"] || row["Trạng thái"] || "").trim();

        if (name) {
          projectsList.push({
            name,
            pic,
            doanhThuDuKien: revenueTarget,
            doanhThuThucTeThangNay: actualNSR,
            doanhThuThucTeThangTruoc: lastMoNSR,
            model,
            status,
          });
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
      danhSachDuAn: projectsList,
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

    // Format full conversation history & data into systemInstruction & prompt string
    let historyFormatted = "";
    if (Array.isArray(history) && history.length > 0) {
      historyFormatted = "\n\nLỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ GIỮA QUẢN LÝ VÀ AI:\n" +
        history.map(h => `${h.role === 'user' ? 'Quản lý' : 'AI Agent'}: ${h.text}`).join("\n");
    }

    const fullPrompt = `CƠ SỞ DỮ LIỆU THỰC TẾ VẬN HÀNH VÀ DỰ ÁN:\n${JSON.stringify(statsContext, null, 2)}${historyFormatted}\n\nCÂU HỎI MỚI CỦA QUẢN LÝ (GỒM NGÔN NGỮ TỰ NHIÊN / VIẾT TẮT / LỖI CHÍNH TẢ / HỎI TIẾP): "${message}"\n\nHãy phân tích và trả lời trực tiếp câu hỏi mới nhất của Quản lý.`;

    const models = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.5-flash"];
    let replyText = "";
    const ai = getClient();

    for (const model of models) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: fullPrompt,
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
      const removeAccents = (str) =>
        String(str || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "D")
          .toLowerCase();

      const msgClean = removeAccents(message);
      const matchDate = message.match(/(\d{1,2})[\/\-](\d{1,2})/);
      let dateStr = "";
      if (matchDate) {
        dateStr = `${matchDate[1].padStart(2, '0')}/${matchDate[2].padStart(2, '0')}`;
      }

      // 1. Check Project Name matching (unaccented substring / word match e.g. "lg", "aqua", "casper", "hong dat")
      const matchedProjects = projectsList.filter((p) => {
        if (!p.name) return false;
        const pClean = removeAccents(p.name);
        return msgClean.includes(pClean) || pClean.split(" ").some((w) => w.length >= 2 && msgClean.includes(w));
      });

      // 2. Check Client Name matching from LTL orders
      const matchedClient = statsContext.thongKeTungKhachHang.find((c) => {
        const cClean = removeAccents(c.name);
        return msgClean.includes(cClean) || cClean.split(" ").some((w) => w.length >= 2 && msgClean.includes(w));
      });

      // 3. Check PIC SD matching
      const picKeys = Object.keys(statsContext.phanPhanCongPIC);
      const matchedPic = picKeys.find((p) => msgClean.includes(removeAccents(p)));

      if (matchedProjects.length > 0) {
        const details = matchedProjects.map((p) => {
          const revStr = p.doanhThuThucTeThangNay && p.doanhThuThucTeThangNay !== "0"
            ? `Doanh thu thực tế (RR/NSR): ${p.doanhThuThucTeThangNay}đ (Chỉ tiêu dự kiến: ${p.doanhThuDuKien}đ)`
            : `Doanh thu dự kiến: ${p.doanhThuDuKien}đ`;
          return `- **${p.name}** (PIC: ${p.pic}): ${revStr}, Mô hình: ${p.model || 'LTL B2B'}, Trạng thái: ${p.status}`;
        }).join("\n");

        replyText = `Dạ Chủ nhân, hệ thống ghi nhận ${matchedProjects.length} dự án liên quan đến truy vấn của Chủ nhân:\n${details}`;
      } else if (matchedPic) {
        const info = statsContext.phanPhanCongPIC[matchedPic];
        replyText = `Dạ Chủ nhân, chuyên viên ${matchedPic} hiện đang phụ trách ${info.count} dự án (${info.projects.join(', ')}).`;
      } else if (matchedClient) {
        replyText = `Dạ Chủ nhân, đối tác ${matchedClient.name} từ đầu tháng đến nay đã giao được ${matchedClient.orders} đơn (tổng sản lượng ${matchedClient.weightTon} tấn, tỷ lệ Ontime đạt ${matchedClient.ontimePct}).`;
      } else if (dateStr && hcmOrdersByDate[dateStr]) {
        replyText = `Riêng ngày ${dateStr}, khu vực Hồ Chí Minh ghi nhận xử lý ${hcmOrdersByDate[dateStr]} đơn điện máy.`;
      } else if (dateStr && ordersByDate[dateStr]) {
        replyText = `Riêng ngày ${dateStr}, toàn hệ thống ghi nhận xử lý ${ordersByDate[dateStr]} đơn điện máy.`;
      } else if (msgClean.includes("ho chi minh") || msgClean.includes("hcm")) {
        replyText = `Khu vực Hồ Chí Minh hiện tại ghi nhận khoảng ${hcmDailyAvg} đơn điện máy/ngày (tổng ${hcmOrders.length} đơn tháng này, sản lượng ${(hcmOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1)} tấn).`;
      } else {
        replyText = `Đầy tớ ghi nhận tổng cộng ${totalOrders} đơn điện máy trong tháng (tỷ lệ Ontime đạt ${statsContext.tyLeOntimeChung}, tổng sản lượng ${statsContext.tongSanLuongTan} tấn).`;
      }
    }

    return res.status(200).json({ ok: true, reply: replyText, stats: statsContext });
  } catch (err) {
    console.error("[/api/ai-chat] Error:", err);
    return res.status(500).json({ error: "Lỗi xử lý AI Agent: " + err.message });
  }
}
