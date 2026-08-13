/**
 * lib/ai-brain.js
 * Bộ Não (Knowledge Brain) cho Tiểu Đệ SD3
 *
 * Cơ chế hoạt động:
 * 1. Sau mỗi cuộc chat → trích xuất insight → ghi vào sheet "AI_Brain"
 * 2. Khi chat mới → đọc top insights → inject vào system prompt
 * 3. Hàng tuần → AI tự tổng hợp thành "Knowledge Summary"
 *
 * Schema sheet AI_Brain:
 * [Timestamp, Type, Topic, Insight, Source, Confidence, UsedCount, LastUsed]
 */

import { getAuth, invalidateCache } from "./sheets";
import { google } from "googleapis";
import { generateFast, generateWithFallback } from "./ai-providers";

const BRAIN_SHEET_NAME = "AI_Brain";
const MAX_BRAIN_INJECT = 30;      // Top N insights injected per chat
const MIN_CONFIDENCE = 0.5;       // Minimum confidence to inject

// Types of brain entries
export const BRAIN_TYPES = {
  USER_PREF: "user_preference",   // Đại Ca thích hỏi gì, format nào
  BUSINESS:  "business_insight",  // Pattern kinh doanh AI tự phát hiện
  CORRECTION:"correction",        // User sửa AI trả lời sai
  FAQ:       "faq",               // Câu hỏi hay gặp + câu trả lời tốt
  PATTERN:   "pattern",           // Pattern vận hành lặp lại
};

async function getSheetsClient() {
  const auth = getAuth();
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

function getSpreadsheetId() {
  return (
    process.env.GOOGLE_SHEET_ID_PROJECTS ||
    process.env.SHEET_ID_PROJECTS ||
    process.env.GOOGLE_SHEET_ID
  );
}

// ─── Ensure AI_Brain sheet exists ─────────────────────────────────────────────
async function ensureBrainSheet(sheets) {
  const spreadsheetId = getSpreadsheetId();
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some(
      (s) => s.properties.title === BRAIN_SHEET_NAME
    );
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: BRAIN_SHEET_NAME } } }],
        },
      });
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${BRAIN_SHEET_NAME}'!A1:H1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Timestamp", "Type", "Topic", "Insight", "Source", "Confidence", "UsedCount", "LastUsed"]],
        },
      });
    }
  } catch (e) {
    console.warn("[ai-brain] ensureBrainSheet error:", e.message);
  }
}

// ─── Read brain entries ────────────────────────────────────────────────────────
export async function loadBrainContext() {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    await ensureBrainSheet(sheets);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${BRAIN_SHEET_NAME}'!A2:H500`,
    });
    const rows = res.data.values || [];

    if (rows.length === 0) return "";

    // Parse, filter by confidence, sort by usedCount desc
    const entries = rows
      .map((r) => ({
        timestamp: r[0] || "",
        type:      r[1] || "",
        topic:     r[2] || "",
        insight:   r[3] || "",
        source:    r[4] || "",
        confidence: parseFloat(r[5]) || 0,
        usedCount: parseInt(r[6]) || 0,
      }))
      .filter((e) => e.insight && e.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.usedCount - a.usedCount || b.confidence - a.confidence)
      .slice(0, MAX_BRAIN_INJECT);

    if (entries.length === 0) return "";

    // Group by type for cleaner injection
    const grouped = {};
    entries.forEach((e) => {
      if (!grouped[e.type]) grouped[e.type] = [];
      grouped[e.type].push(e.insight);
    });

    const typeLabels = {
      [BRAIN_TYPES.USER_PREF]: "📌 Sở thích & phong cách Đại Ca",
      [BRAIN_TYPES.BUSINESS]:  "📊 Insight kinh doanh đã học",
      [BRAIN_TYPES.CORRECTION]:"✏️ Corrections (AI đã học từ sai lầm)",
      [BRAIN_TYPES.FAQ]:       "❓ FAQ hay gặp",
      [BRAIN_TYPES.PATTERN]:   "🔄 Pattern vận hành",
    };

    let brainText = "\n\n--- BỘ NÃO TIỂU ĐỆ (Kiến thức tích lũy từ các cuộc chat trước) ---\n";
    Object.entries(grouped).forEach(([type, insights]) => {
      brainText += `\n${typeLabels[type] || type}:\n`;
      insights.forEach((i) => { brainText += `  - ${i}\n`; });
    });
    brainText += "--- KẾT THÚC BỘ NÃO ---\n";
    brainText += "Hãy sử dụng kiến thức trên để phục vụ Đại Ca tốt hơn, đặc biệt nhớ các correction và user preference.\n";

    return brainText;
  } catch (e) {
    console.warn("[ai-brain] loadBrainContext error:", e.message);
    return "";
  }
}

// ─── Save new insight entries ──────────────────────────────────────────────────
export async function saveBrainInsights(insights) {
  if (!insights || insights.length === 0) return;
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    await ensureBrainSheet(sheets);

    const now = new Date().toISOString();
    const newRows = insights.map((ins) => [
      now,
      ins.type || BRAIN_TYPES.BUSINESS,
      ins.topic || "",
      ins.insight,
      ins.source || "auto",
      String(ins.confidence || 0.7),
      "0",
      now,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${BRAIN_SHEET_NAME}'!A:H`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: newRows },
    });

    invalidateCache(`brain:${spreadsheetId}`);
  } catch (e) {
    console.warn("[ai-brain] saveBrainInsights error:", e.message);
  }
}

// ─── Increment usedCount for injected entries ──────────────────────────────────
export async function markBrainUsed(topicKeyword) {
  // Fire-and-forget usage tracking — not critical
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${BRAIN_SHEET_NAME}'!A2:H500`,
    });
    const rows = res.data.values || [];
    const updates = [];
    rows.forEach((r, idx) => {
      if (r[2] && String(r[2]).toLowerCase().includes(topicKeyword.toLowerCase())) {
        const rowNum = idx + 2;
        const newCount = (parseInt(r[6]) || 0) + 1;
        updates.push({
          range: `'${BRAIN_SHEET_NAME}'!G${rowNum}:H${rowNum}`,
          values: [[String(newCount), new Date().toISOString()]],
        });
      }
    });
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "USER_ENTERED", data: updates },
      });
    }
  } catch (_) { /* silent */ }
}

// ─── Extract insights from a Q&A pair using AI ────────────────────────────────
export async function extractInsightsFromChat({ message, reply, userName, projectsList }) {
  try {
    const projectNames = (projectsList || []).slice(0, 20).map((p) => p.name).join(", ");

    const extractPrompt = `Phân tích cuộc hội thoại và trích xuất TỐI ĐA 3 insights có giá trị (nếu có).

Manager hỏi: "${message}"
AI trả lời: "${reply.slice(0, 400)}"
Người dùng: ${userName || "Manager"}
Dự án: ${projectNames}

Trả về JSON array, mỗi phần tử:
{"type":"user_preference|business_insight|correction|faq|pattern","topic":"max 5 từ","insight":"1-2 câu ngắn gọn","confidence":0.0-1.0}

Nếu không có insight đáng học → trả về []
Chỉ trả về JSON array thuần, không có text khác.`;

    const result = await generateFast({
      systemPrompt: "Bạn là hệ thống trích xuất kiến thức từ cuộc hội thoại. Chỉ trả về JSON array thuần.",
      userPrompt: extractPrompt,
      temperature: 0.1,
    });

    const text = result.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed.filter((p) => p.insight && p.confidence >= 0.5) : [];
  } catch (e) {
    console.warn("[ai-brain] extractInsightsFromChat error:", e.message);
    return [];
  }
}

// ─── Weekly knowledge summarizer ──────────────────────────────────────────────
export async function generateWeeklySummary() {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${BRAIN_SHEET_NAME}'!A2:H500`,
    });
    const rows = res.data.values || [];
    if (rows.length < 5) return null;

    const allInsights = rows.map((r) => `[${r[1]}] ${r[2]}: ${r[3]}`).join("\n");

    const result = await generateWithFallback({
      systemPrompt: "Bạn là trợ lý tổng hợp kiến thức. Trả lời rõ ràng có cấu trúc, tiếng Việt.",
      userPrompt: `Dưới đây là ${rows.length} insights AI Agent SD3 đã học được. 
Hãy tổng hợp thành bản tóm tắt ngắn gọn (không quá 300 từ) chia thành: 
1. Đại Ca quan tâm nhất điều gì?
2. Dự án/vấn đề lặp đi lặp lại?
3. AI đã sửa lỗi gì?
4. Khuyến nghị cải thiện AI?

Insights:
${allInsights}`,
      temperature: 0.3,
    });

    return result.text;
  } catch (e) {
    console.warn("[ai-brain] generateWeeklySummary error:", e.message);
    return null;
  }
}
