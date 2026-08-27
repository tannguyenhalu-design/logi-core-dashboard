import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { isDMClient, isLTLRow, isFromJuly2026 } from "../../lib/dm-clients";
import { parseDate, computePeriodComparison, transformLTL } from "../../lib/transform-ltl";
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
import { computeDamageCauseBreakdown } from "../../lib/transform-ai-insights";
import { getAuditLog } from "../../lib/audit-log";

// Router Agent + Synthesizer Agent are 2 sequential LLM calls, each with a
// provider-fallback chain — observed 10-15s+ end to end in production,
// close to/over Vercel's default serverless timeout, which was silently
// killing requests mid-flight (user sees no reply at all). Raise the cap
// so a slow-but-successful response isn't cut off; if the account's plan
// caps lower than this, Vercel clamps it rather than failing the deploy.
export const config = { maxDuration: 60 };

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
3. Ngắn gọn, có bullet, kết thúc bằng action.
4. TUYỆT ĐỐI KHÔNG được tự cộng/trừ/suy luận ra một con số theo tháng/khoảng thời gian từ các tổng số khác nhau trong dữ liệu (vd lấy tổng 2 tháng trừ đi tổng 1 tháng để suy ra tháng còn lại) — nếu Đại Ca hỏi về số đơn trong 1 khoảng thời gian cụ thể (vd "từ đầu tháng", "tháng này"), PHẢI dùng ĐÚNG trường "soDonThangNayVsThangTruoc" đã được backend tính sẵn. Nếu hỏi về tuần nào tăng/giảm trong tháng và do khách hàng nào, PHẢI dùng ĐÚNG trường "soSanhTuanTrongThangHienTai". Nếu không có sẵn trường phù hợp, PHẢI nói rõ là chưa có số liệu chính xác cho khoảng đó thay vì tự đoán.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  // UI hides the chat button for cs (dashboard.js), but that's not
  // enforcement — block it here too so a direct API call can't bypass it.
  if (session.user.role === "cs") {
    return res.status(403).json({ error: "Vai trò CS không có quyền dùng Tiểu Đệ" });
  }

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
    let earliestPickup = null;
    let latestPickup = null;

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
      if (d) {
        if (!earliestPickup || d < earliestPickup) earliestPickup = d;
        if (!latestPickup || d > latestPickup) latestPickup = d;
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

    const fmtDate = (d) => d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : null;

    const statsContext = {
      phamViDuLieuDon: {
        tuNgay: fmtDate(earliestPickup),
        denNgay: fmtDate(latestPickup),
        ghiChu: "Dữ liệu đơn hàng (raw_ontime) chỉ được lọc lấy từ tháng 7/2026 trở đi (isFromJuly2026) vì dữ liệu các tháng trước đó (3-6/2026) không đầy đủ do lỗi đồng bộ cũ đã fix ngày 16/08/2026 — trước đó pipeline xóa sạch rồi ghi đè lại raw_ontime mỗi lần chạy nên các đơn cũ rớt khỏi cửa sổ dữ liệu nguồn của GHN bị mất vĩnh viễn. Từ 16/08/2026 trở đi dữ liệu được merge/giữ lại, không còn mất nữa.",
      },
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
        tongTrongLuong: (hcmOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1) + " tấn"
      },
      khuVucHaNoi: {
        tongSoDonThang: hanoiOrders.length,
        trungBinhDonMotNgay: hanoiDailyAvg,
        tongTrongLuong: (hanoiOrders.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0) / 1000).toFixed(1) + " tấn"
      },
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

    // Đúng logic "so sánh cùng kỳ" mà Dashboard chính dùng (transformLTL /
    // computePeriodComparison) — cho AI 1 con số CHÍNH XÁC theo tháng thay
    // vì để nó tự suy luận/cộng trừ giữa các tổng khác nhau, vốn hay bị sai
    // (từng ghi nhận: AI tự đoán "tháng 7 ~9.162 đơn" rồi lấy tổng 2 tháng
    // trừ ra tháng 8, ra số lệch ~475 đơn so với số thật trên Dashboard).
    const mtdComparison = computePeriodComparison(filteredLTL, "mtd");
    statsContext.soDonThangNayVsThangTruoc = {
      ghiChu: "Số liệu CHÍNH XÁC do backend tính sẵn, cùng logic với Dashboard chính — dùng ĐÚNG các số này khi được hỏi về đơn hàng theo tháng/khoảng thời gian, KHÔNG tự cộng/trừ suy ra số khác.",
      kyNay: mtdComparison.currentRangeLabel,
      kyTruoc: mtdComparison.previousRangeLabel,
      soDonKyNay: mtdComparison.overall.cur.orders,
      soDonKyTruoc: mtdComparison.overall.prev.orders,
      thayDoiPhanTramSoDon: mtdComparison.overall.ordersDeltaPct,
      tyLeOntimeKyNay: mtdComparison.overall.cur.ontimePct,
      tyLeOntimeKyTruoc: mtdComparison.overall.prev.ontimePct,
    };

    // "Tuần 2 giảm so với tuần 3 là do khách nào" — the AI previously had no
    // week-level breakdown at all (only ordersByDate, never even exposed in
    // statsContext), so any week-over-week question was pure guesswork.
    // Reuse the same isWeekly transformLTL path the dashboard's own
    // "So sánh theo tuần trong tháng" panel uses, scoped to the CURRENT
    // calendar month (the most likely thing "tuần này/tuần trước" refers to).
    const nowForWeek = new Date();
    const weeklyThisMonth = transformLTL(filteredLTL, { months: [nowForWeek.getMonth() + 1], filterMode: "pickup" });
    const weekKeys = Object.keys(weeklyThisMonth.ordersByMonth || {}).map(Number).sort((a, b) => a - b);
    if (weekKeys.length >= 2) {
      const wLast = weekKeys[weekKeys.length - 1];
      const wPrev = weekKeys[weekKeys.length - 2];
      const movers = Object.entries(weeklyThisMonth.ordersByProjectAndWeek || {})
        .map(([name, byWeek]) => ({ name, delta: (byWeek[wLast] || 0) - (byWeek[wPrev] || 0), tuanTruoc: byWeek[wPrev] || 0, tuanSau: byWeek[wLast] || 0 }))
        .filter((m) => m.delta !== 0)
        .sort((a, b) => a.delta - b.delta);
      statsContext.soSanhTuanTrongThangHienTai = {
        ghiChu: "Số liệu CHÍNH XÁC đã tính sẵn cho tháng hiện tại — dùng đúng các số này khi được hỏi tuần nào tăng/giảm và do khách nào, KHÔNG tự suy luận.",
        tuanGanNhat: wLast,
        tuanTruocDo: wPrev,
        khachHangGiamNhieuNhat: movers.filter((m) => m.delta < 0).slice(0, 5),
        khachHangTangNhieuNhat: movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5),
      };
    }

    // Load brain context (fire concurrently with data fetch already done above)
    const [brainContext, auditLog] = await Promise.all([
      loadBrainContext().catch(() => ""),
      getAuditLog(1000).catch(() => []),
    ]);

    // Last login time per person — getAuditLog() already returns newest-first,
    // so the first "user.login" row seen per actor is their most recent login.
    const lastLoginByActor = {};
    for (const entry of auditLog) {
      if (entry.action === "user.login" && entry.actor && !lastLoginByActor[entry.actor]) {
        lastLoginByActor[entry.actor] = entry.timestamp;
      }
    }
    statsContext.hoatDongDangNhapGanDay = {
      ghiChu: "Chỉ ghi nhận đăng nhập qua GHN SSO từ 16/08/2026 trở đi (trước đó hệ thống không log sự kiện đăng nhập, nên không có dữ liệu cũ hơn).",
      danhSach: Object.entries(lastLoginByActor).map(([actor, timestamp]) => ({ nguoiDung: actor, dangNhapGanNhat: timestamp })),
    };

    // Format full conversation history & data into systemInstruction & prompt string
    let historyFormatted = "";
    if (Array.isArray(history) && history.length > 0) {
      historyFormatted = "\n\nLỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ GIỮA QUẢN LÝ VÀ AI:\n" +
        history.map(h => `${h.role === 'user' ? 'Quản lý' : 'AI Agent'}: ${h.text}`).join("\n");
    }

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
        const [rawDamageCauses, claimsByOrderCode] = await Promise.all([
          fetchSheet("raw_damage_causes").catch(() => []),
          getAllClaims().catch(() => ({})),
        ]);
        // getAllClaims() returns an object keyed by orderCode, not an array.
        const claims = Object.values(claimsByOrderCode || {});
        const breakdown = computeDamageCauseBreakdown(rawDamageCauses);
        expertContext =
          "DỮ LIỆU TỪ CHUYÊN GIA DAMAGE_QUERY (BỂ VỠ/HƯ HỎNG — nguồn Rillnet, cập nhật hàng ngày qua CDP scraper):\n" +
          `Tổng số ca bể vỡ/hư hỏng ghi nhận: ${breakdown.totalCases}\n` +
          "Breakdown theo CHẶNG NGHI VẤN (nguyên nhân chính):\n" +
          breakdown.byLeg.map((l) => `- ${l.label}: ${l.count} ca (${l.pct}%)`).join("\n") +
          "\nBreakdown theo khách hàng:\n" +
          breakdown.byClient.map((c) => `- ${c.label}: ${c.count} ca (${c.pct}%)`).join("\n") +
          (claims.length > 0
            ? "\n\nDữ liệu bồi thường (DamageClaims) liên quan:\n" + JSON.stringify(claims.slice(0, 10), null, 2)
            : "");
      } catch (e) {
        expertContext = "Chuyên gia DAMAGE_QUERY báo cáo: Không thể lấy dữ liệu hư hỏng lúc này.";
      }
    } else if (intentInfo.intent === "TASK_CREATION") {
      const titleMatch = message.replace(/tạo task|giao task|giao việc|nhắc nhở|lập task/gi, "").trim();
      if (!intentInfo.extractedName) {
        // Don't silently guess who to assign — a wrong guess means the task
        // never reaches the right person and nobody notices.
        expertContext =
          "Chưa xác định được nhân sự phụ trách task này. Hãy hỏi lại Đại Ca task này giao cho ai trong 4 người: Duy Tú, Kim Diện, Nguyễn Thành Đạt, Thúy Vi — KHÔNG được tự tạo task khi chưa rõ người phụ trách.";
      } else {
        try {
          await createTaskForStaff({
            title: titleMatch || "Kiểm tra vận hành SD3",
            picName: intentInfo.extractedName,
            notes: `Tạo tự động qua AI Agent từ chỉ đạo của ${session.user.name || 'Đại Ca'}`,
          }, session.user.name || session.user.email);
          expertContext = `Đã giao task/công việc thành công: tiêu đề "${titleMatch || 'Kiểm tra vận hành SD3'}" cho nhân sự tên "${intentInfo.extractedName}". Đã ghi nhận vào Quản lý Task & Google Calendar.`;
        } catch (e) {
          expertContext = `Lỗi: Hệ thống không thể tạo task lúc này — ${e.message}`;
        }
      }
    } else if (intentInfo.intent === "PREDICTION") {
      const predictions = predictRevenueTarget(projectsList, { clientOrProject: intentInfo.extractedName });
      if (predictions.length > 0) {
        expertContext = "Kết quả dự báo Run-rate (tiến độ cuối tháng): \n" + predictions.map(p => `- ${p.projectName}: Hiện đạt ${p.doanhThuThucTeHienTai}đ. Dự báo cuối tháng đạt ${p.duBaoCuoiThang} (Tiến độ hoàn thành KPI: ${p.kpiDisplay}).`).join("\n");
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
      // Compact (no pretty-print indentation) — the indent whitespace on a
      // ~35-project, ~20-client JSON blob alone was enough to push requests
      // over Groq's 8,000 TPM limit (confirmed live: 9,569 tokens vs an
      // 8,000 cap), silently knocking Groq out of the fallback chain on
      // every request and leaving only Gemini's 20/day quota to carry the
      // whole bot — exactly the kind of thing that made it "hóc búa" so
      // often. The LLM doesn't need human-readable indentation.
      const synthesizerPrompt = `CƠ SỞ DỮ LIỆU DỰ ÁN & VẬN HÀNH (Tham khảo nếu cần):\n${JSON.stringify(statsContext)}\n\nLỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ:${historyFormatted}\n\nTHÔNG TIN ĐƯỢC CHUYÊN GIA (EXPERT) CUNG CẤP:\n${expertContext}\n\nCÂU HỎI MỚI NHẤT CỦA ĐẠI CA: "${message}"\n\nNHIỆM VỤ:\nDựa vào "Thông tin được chuyên gia cung cấp" và Cơ sở dữ liệu, hãy đóng vai Tiểu Đệ SD3 để trả lời câu hỏi của Đại Ca. 
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
