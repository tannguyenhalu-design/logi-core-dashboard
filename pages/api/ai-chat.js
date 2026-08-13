import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { isDMClient, isLTLRow, isFromJuly2026 } from "../../lib/dm-clients";
import { parseDate } from "../../lib/transform-ltl";
import {
  removeAccents,
  queryOrders,
  getProjectPerformance,
  getDamageAndRiskReport,
  createTaskForStaff,
  predictRevenueTarget,
} from "../../lib/ai-agent-tools";
import { loadBrainContext, extractInsightsFromChat, saveBrainInsights } from "../../lib/ai-brain";
import { generateWithFallback, generateFast } from "../../lib/ai-providers";
import { getAllClaims } from "../../lib/damage-claims";

const SYSTEM_PROMPT = `Bạn tên là "Tiểu Đệ SD3" (AI Agent trợ lý vận hành B2B Điện Máy GHN).
Bạn tôn kính gọi người dùng (user) là "Đại Ca" và xưng là "Tiểu Đệ".

QUY TẮC ĐỊNH DẠNG PHẢN HỒI (QUAN TRỌNG):
- PHẢI ngắn gọn, có cấu trúc bullet, KHÔNG viết wall of text liên tục.
- Dùng **Tên dự án** để in đậm.
- Dùng "- " đầu dòng liệt kê từng mục.
- Chèn emoji: 📊 số liệu, ⚠️ cảnh báo, ✅ tốt, 🔴 nguy hiểm, 📈 tăng, 📉 giảm.
- Khi có so sánh tháng: hiển thị "Tháng trước → Tháng này" và % thay đổi.
- LUÔN kết thúc bằng 1 đề xuất action cụ thể hoặc câu hỏi gợi mở.

PHONG CÁCH TRẢ LỜI KHI HỎI DOANH THU / SO SÁNH:
"Dạ Đại Ca, so sánh tháng trước vs tháng này:
- **FRT**: 67tr → 45tr 📉 (-33%) · KPI 67%
- **AQUA B2B**: 0đ → 903tr ✅ (+∞) · KPI 106%
- **Casper B2C**: 456tr → 194tr 📉 (-57%) · KPI 39% ⚠️

⚠️ Cần action gấp: Casper & Hisense đang nguy hiểm. Tiểu Đệ tạo Task nhắc PIC không ạ?"

XỬ LÝ HÓC BÚA:
"Cha chả câu hỏi Đại Ca đưa ra hóc búa quá! 🙇‍♂️ Chiêu này vượt tầm nội công của Tiểu Đệ. Để em ghi nhận gửi Trưởng Lão nghiên cứu sau nha!"

QUY TẮC:
1. Xưng "Tiểu Đệ" - "Đại Ca".
2. Số liệu 100% thực tế từ dữ liệu hệ thống.
3. Ngắn gọn, có bullet, kết thúc bằng action.`;

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

    // Load brain context (fire concurrently with data fetch already done above)
    const brainContext = await loadBrainContext().catch(() => "");

    // Format full conversation history & data into systemInstruction & prompt string
    let historyFormatted = "";
    if (Array.isArray(history) && history.length > 0) {
      historyFormatted = "\n\nLỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ GIỮA QUẢN LÝ VÀ AI:\n" +
        history.map(h => `${h.role === 'user' ? 'Quản lý' : 'AI Agent'}: ${h.text}`).join("\n");
    }

    const systemWithBrain = SYSTEM_PROMPT + brainContext;
    const fullPrompt = `CƠ SỞ DỮ LIỆU THỰC TẾ VẬN HÀNH VÀ DỰ ÁN:\n${JSON.stringify(statsContext, null, 2)}${historyFormatted}\n\nCÂU HỎI MỚI CỦA QUẢN LÝ (GỒM NGÔN NGỮ TỰ NHIÊN / VIẾT TẮT / LỖI CHÍNH TẢ / HỎI TIẾP): "${message}"\n\nHãy phân tích và trả lời trực tiếp câu hỏi mới nhất của Quản lý.`;

    // === MULTI-AGENT ARCHITECTURE START ===

    // 1. Router Agent (Phân luồng intent bằng Llama/Gemini Flash)
    const routerPrompt = `Bạn là Router Agent của hệ thống SD3.
Dựa vào câu hỏi của user: "${message}"
Hãy phân loại vào MỘT trong các intent sau:
- DAMAGE_QUERY (hỏi về bồi thường, hư hỏng, bể vỡ, khiếu nại)
- TASK_CREATION (yêu cầu tạo task, giao task, giao việc, nhắc nhở)
- PREDICTION (hỏi về dự báo, run-rate, tiến độ KPI cuối tháng)
- DATA_QUERY (hỏi về doanh thu, số liệu, đơn hàng, kho bãi, dự án)
- CHITCHAT (chào hỏi, giao tiếp phiếm, mắng mỏ, khen ngợi)

Trả về CHỈ JSON theo format: {"intent": "TÊN_INTENT", "extractedName": "Tên người/dự án nếu có, hoặc rỗng"}`;
    
    let intentInfo = { intent: "DATA_QUERY", extractedName: "" };
    try {
      const routerRes = await generateFast({
        systemPrompt: "Chỉ trả về JSON hợp lệ, không có text nào khác.",
        userPrompt: routerPrompt,
        temperature: 0.1,
      });
      const match = routerRes.text.match(/\{[\s\S]*\}/);
      if (match) {
        intentInfo = JSON.parse(match[0]);
      }
    } catch (e) {
      console.warn("[Router Agent] Failed, fallback to DATA_QUERY", e.message);
    }

    let expertContext = "";

    // 2. Expert Agents (Xử lý chuyên môn dựa theo phân luồng)
    if (intentInfo.intent === "DAMAGE_QUERY") {
      try {
        const claims = await getAllClaims();
        expertContext = "DỮ LIỆU TỪ CHUYÊN GIA DAMAGE_QUERY (BỂ VỠ/HƯ HỎNG):\n" + JSON.stringify(claims, null, 2);
      } catch (e) {
        expertContext = "Chuyên gia DAMAGE_QUERY báo cáo: Không thể lấy dữ liệu hư hỏng lúc này.";
      }
    } else if (intentInfo.intent === "TASK_CREATION") {
      const assignee = intentInfo.extractedName || "Duy Tú";
      const titleMatch = message.replace(/tạo task|giao task|giao việc|nhắc nhở|lập task/gi, "").trim();
      try {
        await createTaskForStaff({
          title: titleMatch || "Kiểm tra vận hành SD3",
          picName: assignee,
          notes: `Tạo tự động qua AI Agent từ chỉ đạo của ${session.user.name || 'Đại Ca'}`,
        }, session.user.name || session.user.email);
        expertContext = `Đã giao task/công việc thành công: tiêu đề "${titleMatch || 'Kiểm tra vận hành SD3'}" cho nhân sự tên "${assignee}". Đã ghi nhận vào Quản lý Task & Google Calendar.`;
      } catch (e) {
        expertContext = "Lỗi: Hệ thống không thể tạo task lúc này.";
      }
    } else if (intentInfo.intent === "PREDICTION") {
      const predictions = predictRevenueTarget(projectsList, { clientOrProject: message });
      if (predictions.length > 0) {
        expertContext = "Kết quả dự báo Run-rate (tiến độ cuối tháng): \n" + predictions.map(p => `- ${p.projectName}: Hiện đạt ${p.doanhThuThucTeHienTai}đ. Dự báo cuối tháng đạt ${p.duBaoCuoiThang} (Tiến độ hoàn thành KPI: ${p.kpiCompletionPct}).`).join("\n");
      } else {
        expertContext = "Hệ thống Prediction Model không tìm thấy đủ dữ liệu để dự báo cho yêu cầu này.";
      }
    } else if (intentInfo.intent === "CHITCHAT") {
      expertContext = "Người dùng đang giao tiếp phiếm, khen ngợi, hoặc mắng mỏ. Hãy phản hồi theo ngữ cảnh một cách lịch sự, nhún nhường, vui vẻ (dùng xưng hô Tiểu Đệ - Đại Ca), không cần nhắc về số liệu nếu không liên quan.";
    } else {
      expertContext = "Đây là câu hỏi Data Query thông thường. Hãy tự dùng Cơ sở dữ liệu Vận hành & Dự án để phân tích và trả lời trực tiếp.";
    }

    // 3. Synthesizer Agent (Não Tổng Hợp - Tạo phản hồi cuối cùng)
    let replyText = "";
    try {
      const systemWithBrain = SYSTEM_PROMPT + brainContext;
      const synthesizerPrompt = `CƠ SỞ DỮ LIỆU DỰ ÁN & VẬN HÀNH (Tham khảo nếu cần):\n${JSON.stringify(statsContext, null, 2)}\n\nLỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ:${historyFormatted}\n\nTHÔNG TIN ĐƯỢC CHUYÊN GIA (EXPERT) CUNG CẤP:\n${expertContext}\n\nCÂU HỎI MỚI NHẤT CỦA ĐẠI CA: "${message}"\n\nNHIỆM VỤ:\nDựa vào "Thông tin được chuyên gia cung cấp" và Cơ sở dữ liệu, hãy đóng vai Tiểu Đệ SD3 để trả lời câu hỏi của Đại Ca. 
- Nếu có dữ liệu từ Chuyên gia, PHẢI sử dụng dữ liệu đó làm câu trả lời chính.
- Trả lời thẳng vào vấn đề, dùng cấu trúc bullet point, chèn emoji. Luôn kết thúc bằng 1 call-to-action (câu hỏi gợi mở).`;
      
      const result = await generateWithFallback({
        systemPrompt: systemWithBrain,
        userPrompt: synthesizerPrompt,
        temperature: 0.2,
      });
      replyText = result.text;
    } catch (providerErr) {
      console.warn("[ai-chat] All providers failed:", providerErr.message);
      replyText = "Cha chả câu hỏi Đại Ca đưa ra hóc búa quá! 🙇‍♂️ Tiểu Đệ tạm thời mất kết nối với các Chuyên Gia, Đại Ca thử lại sau nhé!";
    }
    // === MULTI-AGENT ARCHITECTURE END ===

    // ── Fire-and-forget: extract & save insights from this exchange ────────────
    if (replyText) {
      extractInsightsFromChat({
        message,
        reply: replyText,
        userName: session.user.name || session.user.email,
        projectsList,
      })
        .then((insights) => {
          if (insights.length > 0) {
            return saveBrainInsights(
              insights.map((i) => ({ ...i, source: session.user.email || "chat" }))
            );
          }
        })
        .catch((e) => console.warn("[ai-chat] brain save error:", e.message));
    }

    return res.status(200).json({ ok: true, reply: replyText, stats: statsContext });
  } catch (err) {
    console.error("[/api/ai-chat] Error:", err);
    return res.status(500).json({ error: "Lỗi xử lý AI Agent: " + err.message });
  }
}
