/**
 * pages/api/ai-alert.js
 * Proactive Alert Engine — scans all projects on chat open and returns:
 * 1. 🔔 Alert list: projects at risk (< 50% KPI or revenue dropped)
 * 2. 📈 Month comparison: this month vs last month per project
 * 3. 🧠 Action recommendations: specific suggested next steps
 */
import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { GoogleGenAI } from "@google/genai";

let _client;
function getClient() {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

function parseMoney(val) {
  if (!val) return 0;
  const s = String(val).replace(/[^\d.,]/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

function fmtMoney(val) {
  if (!val || val === 0) return "0đ";
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1) + " tỷ";
  if (val >= 1_000_000) return Math.round(val / 1_000_000) + " triệu";
  return val.toLocaleString("vi-VN") + "đ";
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const masterSheetId =
      process.env.GOOGLE_SHEET_ID_PROJECTS ||
      process.env.SHEET_ID_PROJECTS ||
      process.env.GOOGLE_SHEET_ID;
    const rawProjects = await fetchSheet("Data dự án", masterSheetId).catch(() => []);

    if (!Array.isArray(rawProjects) || rawProjects.length === 0) {
      return res.status(200).json({ ok: true, alerts: [], summary: null });
    }

    // Parse all projects with revenue data
    const projects = rawProjects
      .map((row) => {
        const name = String(
          row["TÊN DỰ ÁN"] || row["Client name"] || row["Tên dự án"] || ""
        ).trim();
        const pic = String(row["ĐẢM NHIỆM"] || row["PIC SD"] || row["PIC"] || "Chưa gán").trim();
        const target = parseMoney(row["Doanh Thu dự kiến"] || row["Doanh thu dự kiến"]);
        const lastMo = parseMoney(row["Last Mo NSR"]);
        const thisMo = parseMoney(row["RR/NSR"]);
        const model = String(row["MÔ HÌNH VẬN HÀNH"] || row["Mô hình vận hành"] || "").trim();
        const status = String(row["TRẠNG THÁI"] || row["Trạng thái"] || "").trim();
        return { name, pic, target, lastMo, thisMo, model, status };
      })
      .filter((p) => p.name);

    // Calculate today's date to estimate month progress %
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthProgress = dayOfMonth / daysInMonth; // e.g. 0.38 for day 12 of 31

    // Classify each project
    const alerts = [];
    const comparisons = [];
    const recommendations = [];

    projects.forEach((p) => {
      const kpiPct = p.target > 0 ? (p.thisMo / p.target) * 100 : null;
      // Expected run-rate based on month progress
      const runRate = p.target > 0 ? monthProgress * 100 : null;
      const kpiGap = kpiPct !== null && runRate !== null ? kpiPct - runRate : null;

      // Month comparison
      const momChange = p.lastMo > 0
        ? ((p.thisMo - p.lastMo) / p.lastMo) * 100
        : p.thisMo > 0 ? 100 : 0;

      // Classify status
      let alertLevel = null;
      let alertMsg = "";
      if (p.thisMo === 0 && p.target > 0) {
        alertLevel = "critical";
        alertMsg = `🔴 **${p.name}** chưa có doanh thu (mục tiêu ${fmtMoney(p.target)})`;
      } else if (kpiGap !== null && kpiGap < -20) {
        alertLevel = "warning";
        alertMsg = `⚠️ **${p.name}** đạt ${Math.round(kpiPct)}% KPI, đang chậm ${Math.abs(Math.round(kpiGap))}% so với tiến độ tháng`;
      } else if (momChange < -30 && p.lastMo > 0) {
        alertLevel = "watch";
        alertMsg = `📉 **${p.name}** giảm ${Math.abs(Math.round(momChange))}% so với tháng trước`;
      }
      if (alertLevel) alerts.push({ level: alertLevel, msg: alertMsg, project: p });

      // Month comparison summary
      const trend = momChange > 5 ? "▲" : momChange < -5 ? "▼" : "→";
      const trendEmoji = momChange > 5 ? "✅" : momChange < -5 ? "🔴" : "⚠️";
      comparisons.push({
        name: p.name,
        thisMo: fmtMoney(p.thisMo),
        lastMo: fmtMoney(p.lastMo),
        target: fmtMoney(p.target),
        kpiPct: kpiPct !== null ? Math.round(kpiPct) : null,
        momChangePct: Math.round(momChange),
        trend,
        trendEmoji,
        pic: p.pic,
      });

      // Action recommendations for at-risk projects
      if (alertLevel === "critical") {
        recommendations.push({
          project: p.name,
          pic: p.pic,
          action: `Liên hệ ngay với **${p.pic}** để kiểm tra tình trạng dự án **${p.name}** — chưa phát sinh doanh thu trong tháng!`,
          priority: "🔴 Khẩn cấp",
        });
      } else if (alertLevel === "warning") {
        const neededPerDay = p.target > 0
          ? fmtMoney(Math.round((p.target - p.thisMo) / Math.max(daysInMonth - dayOfMonth, 1)))
          : "N/A";
        recommendations.push({
          project: p.name,
          pic: p.pic,
          action: `**${p.pic}** cần push thêm ~${neededPerDay}/ngày cho **${p.name}** trong ${daysInMonth - dayOfMonth} ngày còn lại để đạt KPI`,
          priority: "⚠️ Cần theo dõi",
        });
      }
    });

    // Build a short AI-generated summary using the alert data
    let aiSummary = null;
    const criticalCount = alerts.filter((a) => a.level === "critical").length;
    const warningCount = alerts.filter((a) => a.level === "warning").length;
    const goodCount = projects.filter(
      (p) => p.target > 0 && (p.thisMo / p.target) * 100 >= monthProgress * 100
    ).length;

    if (alerts.length > 0) {
      const alertLines = alerts.slice(0, 5).map((a) => a.msg).join("\n");
      const prompt = `Bạn là Tiểu Đệ SD3, trợ lý vận hành B2B Điện Máy GHN. Hãy tổng hợp ngắn gọn (3-4 dòng) tình hình dưới đây và kết thúc bằng 1 câu hỏi action gợi ý cho quản lý (Đại Ca). Xưng "Tiểu Đệ", gọi "Đại Ca", dùng emoji, ngắn gọn có cấu trúc:

Hôm nay ngày ${dayOfMonth}/${now.getMonth() + 1}, tiến độ tháng ${Math.round(monthProgress * 100)}%.
Có ${criticalCount} dự án nguy hiểm (0đ doanh thu), ${warningCount} dự án chậm KPI, ${goodCount} dự án đang tốt.
Chi tiết:
${alertLines}`;

      try {
        const ai = getClient();
        const resp = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: prompt,
          config: { temperature: 0.3 },
        });
        aiSummary = (resp.text || "").trim();
      } catch (e) {
        // Fallback summary without AI
        aiSummary = `Dạ Đại Ca, Tiểu Đệ vừa scan hệ thống! 🔍\n- 🔴 **${criticalCount} dự án** chưa có doanh thu tháng này\n- ⚠️ **${warningCount} dự án** đang chậm KPI\n- ✅ **${goodCount} dự án** đang đúng tiến độ\n\nĐại Ca muốn Tiểu Đệ zoom vào dự án nào cần action gấp không ạ?`;
      }
    } else {
      aiSummary = `Dạ Đại Ca, Tiểu Đệ vừa scan toàn bộ ${projects.length} dự án! ✅\nHôm nay ngày ${dayOfMonth}/${now.getMonth() + 1} (tiến độ tháng ${Math.round(monthProgress * 100)}%) — tất cả các dự án đang đúng hoặc vượt kế hoạch. Rất tốt Đại Ca ơi! 🎉`;
    }

    return res.status(200).json({
      ok: true,
      summary: aiSummary,
      alerts,
      comparisons,
      recommendations,
      meta: {
        dayOfMonth,
        daysInMonth,
        monthProgressPct: Math.round(monthProgress * 100),
        totalProjects: projects.length,
        criticalCount,
        warningCount,
        goodCount,
      },
    });
  } catch (err) {
    console.error("[/api/ai-alert] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
