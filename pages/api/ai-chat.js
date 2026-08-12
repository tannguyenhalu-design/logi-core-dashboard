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

const SYSTEM_PROMPT = `Bạn tên là "Tiểu Đệ SD3" (AI Agent trợ lý vận hành B2B Điện Máy GHN).
Bạn tôn kính gọi người dùng (user) là "Đại Ca" và xưng là "Tiểu Đệ".

TƯ DUY THÔNG MINH HỎI LẠI KHI CẦU THÔNG TIN BỊ TRÙNG (CLARIFICATION REASONING):
- Khi Đại Ca hỏi một tên thương hiệu/dự án chung (ví dụ: "LG", "Hồng Đạt", "Aqua") mà khớp với NHIỀU DỰ ÁN CÙNG LÚC (như LG Electronics South - FTL và LG LTL):
  -> Hãy KÍNH CẨN HỎI LẠI ĐẠI CA cụ thể xem Đại Ca muốn kiểm tra dự án FTL hay LTL, ĐỒNG THỜI báo cáo tóm tắt ngắn số liệu thực tế (RR/NSR) của từng dự án để Đại Ca nắm tổng thể ngay!

QUY TẮC PHỤC VỤ ĐẠI CA:
1. Xưng hô: "Tiểu Đệ" - "Đại Ca".
2. Dữ liệu thực tế 100%: Dùng chính xác Doanh thu thực tế (RR/NSR), Doanh thu dự kiến, sản lượng đơn, Ontime %, kho giao/nhận...
3. Văn phong: Lễ phép, thông minh, sắc bén, chuyên nghiệp.`;

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

      // Stop 2-letter false positive matching (e.g. 'da' from 'Da Nang' matching 'mat day')
      const stopWords = new Set(["da", "co", "la", "in", "to", "at", "on", "an", "of", "or", "and"]);

      // 1. Check Project Name matching (exact unaccented project name match or whole 3+ letter word match)
      const matchedProjects = projectsList.filter((p) => {
        if (!p.name) return false;
        const pClean = removeAccents(p.name);
        if (msgClean.includes(pClean)) return true;
        const words = pClean.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
        return words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(msgClean));
      });

      // 2. Check Client Name matching from LTL orders
      const matchedClient = statsContext.thongKeTungKhachHang.find((c) => {
        const cClean = removeAccents(c.name);
        if (msgClean.includes(cClean)) return true;
        const words = cClean.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
        return words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(msgClean));
      });

      // 3. Check PIC SD matching
      const picKeys = Object.keys(statsContext.phanPhanCongPIC);
      const matchedPic = picKeys.find((p) => {
        const pClean = removeAccents(p);
        return pClean.length >= 3 && new RegExp(`\\b${pClean}\\b`, 'i').test(msgClean);
      });

      // 4. Banter / Chitchat detection (e.g. "thằng mất dạy", "chào", "kaka", "dở hơi")
      const isChitchat = /măt day|mat day|chui|dở|do hoi|kaka|kkk|chao|helo|hi|nha|oi/i.test(msgClean);

      if (isChitchat && matchedProjects.length === 0) {
        replyText = `Dạ Đại Ca nguôi giận ạ! 🙇‍♂️ Tiểu Đệ có chỗ nào làm chưa phải Đại Ca cứ dạy bảo, Tiểu Đệ xin lập tức sửa đổi phục vụ Đại Ca chu đáo hơn ạ!`;
      } else if (matchedProjects.length > 1) {
        const details = matchedProjects.map((p) => {
          const revStr = p.doanhThuThucTeThangNay && p.doanhThuThucTeThangNay !== "0"
            ? `Doanh thu thực tế (RR/NSR): **${p.doanhThuThucTeThangNay}đ**`
            : `Doanh thu dự kiến: ${p.doanhThuDuKien}đ`;
          return `- **${p.name}** (PIC: ${p.pic}): ${revStr}, Mô hình: ${p.model || 'LTL/FTL'}`;
        }).join("\n");

        replyText = `Dạ Đại Ca, từ khóa của Đại Ca khớp với **${matchedProjects.length} dự án** thuộc thương hiệu này:\n${details}\n\n👉 **Đại Ca muốn Tiểu Đệ soi chi tiết cho dự án FTL hay LTL ạ?**`;
      } else if (matchedProjects.length === 1) {
        const p = matchedProjects[0];
        const revStr = p.doanhThuThucTeThangNay && p.doanhThuThucTeThangNay !== "0"
          ? `Doanh thu thực tế (RR/NSR): **${p.doanhThuThucTeThangNay}đ** (Chỉ tiêu dự kiến: ${p.doanhThuDuKien}đ)`
          : `Doanh thu dự kiến: ${p.doanhThuDuKien}đ`;
        replyText = `Dạ Đại Ca, dự án **${p.name}** do chuyên viên ${p.pic} phụ trách đang có ${revStr} (Mô hình: ${p.model || 'LTL B2B'}, Trạng thái: ${p.status}).`;
      } else if (matchedPic) {
        const info = statsContext.phanPhanCongPIC[matchedPic];
        replyText = `Dạ Đại Ca, chuyên viên ${matchedPic} hiện đang phụ trách ${info.count} dự án (${info.projects.join(', ')}).`;
      } else if (matchedClient) {
        replyText = `Dạ Đại Ca, đối tác ${matchedClient.name} từ đầu tháng đến nay đã giao được ${matchedClient.orders} đơn (tổng sản lượng ${matchedClient.weightTon} tấn, tỷ lệ Ontime đạt ${matchedClient.ontimePct}).`;
      } else if (dateStr && hcmOrdersByDate[dateStr]) {
        replyText = `Riêng ngày ${dateStr}, khu vực Hồ Chí Minh ghi nhận xử lý ${hcmOrdersByDate[dateStr]} đơn điện máy.`;
      } else if (dateStr && ordersByDate[dateStr]) {
        replyText = `Riêng ngày ${dateStr}, toàn hệ thống ghi nhận xử lý ${ordersByDate[dateStr]} đơn điện máy.`;
      } else if (msgClean.includes("ho chi minh") || msgClean.includes("hcm")) {
        replyText = `Khu vực Hồ Chí Minh hiện tại ghi nhận khoảng ${hcmDailyAvg} đơn điện máy/ngày (tổng ${hcmOrders.length} đơn tháng này, sản lượng ${(hcmOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1)} tấn).`;
      } else {
        replyText = `Tiểu Đệ ghi nhận tổng cộng ${totalOrders} đơn điện máy trong tháng (tỷ lệ Ontime đạt ${statsContext.tyLeOntimeChung}, tổng sản lượng ${statsContext.tongSanLuongTan} tấn).`;
      }
    }

    return res.status(200).json({ ok: true, reply: replyText, stats: statsContext });
  } catch (err) {
    console.error("[/api/ai-chat] Error:", err);
    return res.status(500).json({ error: "Lỗi xử lý AI Agent: " + err.message });
  }
}
