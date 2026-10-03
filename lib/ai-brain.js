/**
 * lib/ai-brain.js
 * Bộ Não (Knowledge Brain) cho Tiểu Đệ SD3
 *
 * Cơ chế hoạt động:
 * 1. Sau mỗi cuộc chat → trích xuất insight → ghi vào sheet "AI_Brain" với Status "Đề xuất"
 * 2. Manager rà ở tab Bộ Não: ✓ Duyệt / ✗ Bỏ / sửa. Manager cũng có thể bấm
 *    "✓ Duyệt câu trả lời này" dưới 1 câu trả lời → mục "Đã duyệt" (chỉ dạy CÁCH TRẢ LỜI /
 *    định nghĩa / quy tắc — KHÔNG lưu số, số luôn tính lại từ snapshot).
 * 3. Khi chat mới → nạp: mục "Đã duyệt" như kiến thức chắc chắn (ưu tiên); chỉ vài mục "Đề xuất"
 *    tốt nhất, gắn nhãn "chưa duyệt — chỉ tham khảo, không dùng cho số liệu"; mục "Bỏ" không nạp.
 * 4. Hàng tuần → AI tự tổng hợp thành "Knowledge Summary"
 *
 * Schema sheet AI_Brain (ghi RAW):
 * [Timestamp, Type, Topic, Insight, Source, Confidence, UsedCount, LastUsed, Status, VerifiedBy, VerifiedAt]
 * Dòng cũ chưa có Status (A–H) được coi là "Đề xuất"; scripts/migrate-ai-brain-status.mjs điền sẵn 1 lần.
 * VerifiedBy/VerifiedAt ghi người + giờ RA QUYẾT ĐỊNH (cả khi Duyệt lẫn Bỏ).
 */

import { getAuth, invalidateCache, getCached, setCached } from "./sheets";
import { google } from "googleapis";
import { generateFast, generateWithFallback } from "./ai-providers";

export const BRAIN_SHEET_NAME = "AI_Brain";
export const BRAIN_HEADERS = ["Timestamp", "Type", "Topic", "Insight", "Source", "Confidence", "UsedCount", "LastUsed", "Status", "VerifiedBy", "VerifiedAt"];
export const LAST_COL = "K";
const READ_RANGE_ROWS = 1500;
const MAX_APPROVED_INJECT = 25;   // mục "Đã duyệt" nạp mỗi lần chat
const MAX_PROPOSED_INJECT = 5;    // mục "Đề xuất" nạp mỗi lần chat (nhãn chưa duyệt)
const MIN_CONFIDENCE = 0.5;       // Minimum confidence to inject a proposal
const CACHE_KEY = "ai-brain:entries";
const CACHE_TTL = 60 * 1000;

export const BRAIN_STATUS = { PROPOSED: "Đề xuất", APPROVED: "Đã duyệt", REJECTED: "Bỏ" };
const STATUS_SET = new Set(Object.values(BRAIN_STATUS));
export const normStatus = (v) => (STATUS_SET.has(String(v || "").trim()) ? String(v).trim() : BRAIN_STATUS.PROPOSED);

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

const sheetNameOf = (opts) => (opts && opts.sheetName) || BRAIN_SHEET_NAME;
let headerChecked = false; // per serverless instance — the header check is one extra API call

// ─── Ensure AI_Brain sheet exists with the 11-column header ───────────────────
async function ensureBrainSheet(sheets, opts) {
  const spreadsheetId = getSpreadsheetId();
  const name = sheetNameOf(opts);
  if (headerChecked && name === BRAIN_SHEET_NAME) return;
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some((s) => s.properties.title === name);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: name } } }] },
      });
    }
    // Header: write/extend only when A1:K1 is incomplete; never touches data rows.
    const h = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${name}'!A1:${LAST_COL}1` });
    const have = (h.data.values && h.data.values[0]) || [];
    if (have.length < BRAIN_HEADERS.length || BRAIN_HEADERS.some((c, i) => i >= 8 && have[i] !== c) ) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${name}'!A1:${LAST_COL}1`,
        valueInputOption: "RAW",
        requestBody: { values: [BRAIN_HEADERS] },
      });
    }
    if (name === BRAIN_SHEET_NAME) headerChecked = true;
  } catch (e) {
    console.warn("[ai-brain] ensureBrainSheet error:", e.message);
  }
}

function parseRow(r, idx) {
  return {
    row: idx + 2,
    timestamp: r[0] || "",
    type: r[1] || "",
    topic: r[2] || "",
    insight: r[3] || "",
    source: r[4] || "",
    confidence: parseFloat(r[5]) || 0,
    usedCount: parseInt(r[6]) || 0,
    lastUsed: r[7] || "",
    status: normStatus(r[8]),
    verifiedBy: r[9] || "",
    verifiedAt: r[10] || "",
  };
}

/** All non-empty brain rows with their sheet row number. 60s memory cache; `fresh` bypasses it. */
export async function readBrainEntries({ fresh = false, sheetName } = {}) {
  const useCache = !sheetName && !fresh;
  if (useCache) { const c = getCached(CACHE_KEY); if (c) return c; }
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await ensureBrainSheet(sheets, { sheetName });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetNameOf({ sheetName })}'!A2:${LAST_COL}${READ_RANGE_ROWS}`,
  });
  const entries = (res.data.values || []).map(parseRow).filter((e) => e.insight);
  if (!sheetName) setCached(CACHE_KEY, entries, CACHE_TTL);
  return entries;
}

const dropCache = () => invalidateCache(CACHE_KEY);

const tokens = (s) => new Set(String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4));

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");

const typeLabels = {
  [BRAIN_TYPES.USER_PREF]: "📌 Sở thích & phong cách Đại Ca",
  [BRAIN_TYPES.BUSINESS]:  "📊 Insight kinh doanh",
  [BRAIN_TYPES.CORRECTION]:"✏️ Correction (đã học từ sai lầm)",
  [BRAIN_TYPES.FAQ]:       "❓ FAQ / cách trả lời",
  [BRAIN_TYPES.PATTERN]:   "🔄 Pattern vận hành",
};

/**
 * Build the brain block for the system prompt.
 * @param question  câu hỏi hiện tại — dùng để đánh dấu mục Đã duyệt LIÊN QUAN và dựng thẻ nguồn
 * @returns {{ text: string, approvedRelevant: Array, counts: {approved, proposed} }}
 */
export async function loadBrain({ question = "", hints = [] } = {}) {
  try {
    const all = await readBrainEntries();
    const q = tokens(`${question} ${hints.join(" ")}`);
    const overlap = (e) => { let n = 0; for (const t of tokens(`${e.topic} ${e.insight}`)) if (q.has(t)) n++; return n; };

    const approved = all.filter((e) => e.status === BRAIN_STATUS.APPROVED)
      .map((e) => ({ ...e, rel: overlap(e) }))
      .sort((a, b) => b.rel - a.rel || (b.verifiedAt > a.verifiedAt ? 1 : -1))
      .slice(0, MAX_APPROVED_INJECT);
    const proposed = all.filter((e) => e.status === BRAIN_STATUS.PROPOSED && e.confidence >= MIN_CONFIDENCE)
      .map((e) => ({ ...e, rel: overlap(e) }))
      .sort((a, b) => b.rel - a.rel || b.usedCount - a.usedCount || b.confidence - a.confidence)
      .slice(0, MAX_PROPOSED_INJECT);

    let text = "";
    if (approved.length) {
      text += "\n\n--- KIẾN THỨC ĐÃ ĐƯỢC MANAGER DUYỆT (chắc chắn; ưu tiên làm theo — nhưng đây là CÁCH TRẢ LỜI / định nghĩa / quy tắc, KHÔNG phải số liệu: mọi số vẫn lấy từ DỮ LIỆU) ---\n";
      for (const e of approved) text += `  - ${e.rel > 0 ? "[liên quan câu hỏi] " : ""}${e.insight}\n`;
      text += "--- HẾT KIẾN THỨC ĐÃ DUYỆT ---\n";
    }
    if (proposed.length) {
      text += "\n--- GỢI Ý CHƯA DUYỆT (chưa duyệt — chỉ tham khảo, KHÔNG dùng cho số liệu, KHÔNG coi là sự thật) ---\n";
      for (const e of proposed) text += `  - ${e.insight}\n`;
      text += "--- HẾT GỢI Ý CHƯA DUYỆT ---\n";
    }
    return {
      text,
      approvedRelevant: approved.filter((e) => e.rel > 0).slice(0, 3).map((e) => ({ topic: e.topic, verifiedBy: e.verifiedBy, verifiedAt: e.verifiedAt, dateLabel: fmtDate(e.verifiedAt) })),
      counts: { approved: approved.length, proposed: proposed.length },
    };
  } catch (e) {
    console.warn("[ai-brain] loadBrain error:", e.message);
    return { text: "", approvedRelevant: [], counts: { approved: 0, proposed: 0 } };
  }
}

// Back-compat: string-only context (GET /api/ai-memory).
export async function loadBrainContext() {
  return (await loadBrain({})).text;
}

// ─── Save new insight entries ──────────────────────────────────────────────────
const normText = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * @param insights [{type, topic, insight, confidence, source, status?, verifiedBy?}]
 * AI-extracted insights are always "Đề xuất"; a Manager typing one by hand passes status "Đã duyệt" + verifiedBy.
 */
export async function saveBrainInsights(insights, opts = {}) {
  if (!insights || insights.length === 0) return;
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    await ensureBrainSheet(sheets, opts);

    // Skip exact duplicates of what is already stored (the extractor tends to re-propose the same line).
    let known = new Set();
    try { known = new Set((await readBrainEntries({ fresh: true, sheetName: opts.sheetName })).map((e) => normText(e.insight))); } catch (_) { /* ignore */ }

    const now = new Date().toISOString();
    const newRows = insights.filter((ins) => ins.insight && !known.has(normText(ins.insight))).map((ins) => {
      const status = normStatus(ins.status);
      return [
        now,
        ins.type || BRAIN_TYPES.BUSINESS,
        ins.topic || "",
        ins.insight,
        ins.source || "auto",
        String(ins.confidence || 0.7),
        "0",
        now,
        status,
        status === BRAIN_STATUS.APPROVED ? ins.verifiedBy || "" : "",
        status === BRAIN_STATUS.APPROVED ? now : "",
      ];
    });
    if (!newRows.length) return 0;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetNameOf(opts)}'!A:${LAST_COL}`,
      valueInputOption: "RAW",
      requestBody: { values: newRows },
    });
    dropCache();
    return newRows.length;
  } catch (e) {
    console.warn("[ai-brain] saveBrainInsights error:", e.message);
    return 0;
  }
}

/**
 * Manager decision on one row. `ts` (the row's Timestamp) must still match — rows can shift
 * after a reset, and we never want to overwrite the wrong line.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function reviewBrainEntry({ row, ts, status, insight, topic, actor }, opts = {}) {
  if (!Number.isInteger(row) || row < 2) return { ok: false, error: "Dòng không hợp lệ" };
  if (!STATUS_SET.has(status)) return { ok: false, error: "Trạng thái không hợp lệ" };
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const name = sheetNameOf(opts);
  const cur = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${name}'!A${row}:${LAST_COL}${row}` });
  const r = (cur.data.values && cur.data.values[0]) || [];
  if (!r[3] || String(r[0] || "") !== String(ts || "")) return { ok: false, error: "Mục này đã đổi chỗ hoặc bị xoá — tải lại tab Bộ Não" };
  const now = new Date().toISOString();
  const data = [
    { range: `'${name}'!I${row}:K${row}`, values: [[status, status === BRAIN_STATUS.PROPOSED ? "" : actor || "", status === BRAIN_STATUS.PROPOSED ? "" : now]] },
  ];
  if (typeof insight === "string" && insight.trim() && insight.trim() !== String(r[3])) {
    data.push({ range: `'${name}'!C${row}:D${row}`, values: [[typeof topic === "string" ? topic.trim() : r[2] || "", insight.trim()]] });
  } else if (typeof topic === "string" && topic.trim() !== String(r[2] || "")) {
    data.push({ range: `'${name}'!C${row}`, values: [[topic.trim()]] });
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
  dropCache();
  return { ok: true };
}

/**
 * "✓ Duyệt câu trả lời này": distil the approved answer into a RULE / definition / how-to-answer line
 * with NO figures, then store it as "Đã duyệt". The numbers are never reused (they are recomputed from the snapshot).
 */
export async function addApprovedAnswer({ question, reply, sources = [], dataAsOf, actor }, opts = {}) {
  const q = String(question || "").slice(0, 400);
  const a = String(reply || "").slice(0, 1800);
  if (!q || !a) return { ok: false, error: "Thiếu câu hỏi hoặc câu trả lời" };
  let rule = null, topic = "";
  const prompt = (strict) => `Câu hỏi của Đại Ca: "${q}"\nCâu trả lời đã được Manager duyệt: "${a}"\n\nViết 1–2 câu quy tắc để Tiểu Đệ lần sau trả lời ĐÚNG DẠNG câu hỏi này: nên dùng nguồn/định nghĩa/cách trình bày nào, cần lưu ý điều gì.\nBẮT BUỘC: KHÔNG chứa bất kỳ con số, phần trăm, ngày tháng, mã đơn nào (số luôn được tính lại từ dữ liệu mới nhất). ${strict ? "LẦN TRƯỚC bạn lỡ để số trong câu — tuyệt đối không có chữ số 0-9." : ""}\nTrả về JSON thuần: {"topic":"tối đa 5 từ","rule":"..."}`;
  for (const strict of [false, true]) {
    try {
      const out = await generateFast({ systemPrompt: "Bạn chắt lọc quy tắc trả lời từ câu trả lời mẫu. Chỉ trả về JSON thuần.", userPrompt: prompt(strict), temperature: 0.1 });
      const m = out.text.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const j = JSON.parse(m[0]);
      if (j.rule && !/\d/.test(String(j.rule)) && !/\d/.test(String(j.topic || ""))) { rule = String(j.rule).trim(); topic = String(j.topic || "").trim(); break; }
    } catch (_) { /* try again / fall through */ }
  }
  if (!rule) {
    // Fallback without AI: record the question TYPE only (question text with digits removed) — still no numbers.
    const generic = q.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
    rule = `Với câu hỏi dạng "${generic}": Manager đã duyệt cách trả lời của Tiểu Đệ (bố cục, nguồn dùng, cách nêu phạm vi). Luôn lấy số mới từ dữ liệu, không dùng lại số cũ.`;
    topic = generic.split(/\s+/).slice(0, 5).join(" ");
  }
  const evidence = sources.map((s) => `${s.label}${s.asOfLabel ? ` (${s.asOfLabel})` : ""}`).join("; ");
  const src = `Duyệt câu trả lời${evidence ? ` · nguồn lúc duyệt: ${evidence}` : ""}${dataAsOf ? ` · dữ liệu tính đến ${new Date(dataAsOf).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}`.slice(0, 480);
  const saved = await saveBrainInsights([{ type: BRAIN_TYPES.FAQ, topic, insight: rule, confidence: 1, source: src, status: BRAIN_STATUS.APPROVED, verifiedBy: actor }], opts);
  return saved ? { ok: true, topic, rule } : { ok: false, error: "Không lưu được (có thể mục này đã có trong Bộ Não)" };
}

/**
 * One-off migration: fill Status = "Đề xuất" for every data row that has none, widen the header to A–K.
 * Rows are never deleted or reordered. Returns the before/after counts so the caller can log them.
 */
export async function migrateBrainStatus({ dryRun = false, sheetName } = {}) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const name = sheetNameOf({ sheetName });
  if (!dryRun) await ensureBrainSheet(sheets, { sheetName });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${name}'!A2:${LAST_COL}${READ_RANGE_ROWS}` });
  const rows = res.data.values || [];
  const before = { rows: rows.length, withInsight: rows.filter((r) => r[3]).length };
  const todo = [];
  rows.forEach((r, i) => { if (r[3] && !STATUS_SET.has(String(r[8] || "").trim())) todo.push(i + 2); });
  if (!dryRun && todo.length) {
    // Contiguous blocks keep the write count small; I2:I… only — A–H are untouched.
    const data = todo.map((rowNum) => ({ range: `'${name}'!I${rowNum}:K${rowNum}`, values: [[BRAIN_STATUS.PROPOSED, "", ""]] }));
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
    dropCache();
  }
  const after = dryRun ? before : await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${name}'!A2:${LAST_COL}${READ_RANGE_ROWS}` }).then((x) => {
    const v = x.data.values || [];
    const by = {};
    v.forEach((r) => { if (r[3]) by[normStatus(r[8])] = (by[normStatus(r[8])] || 0) + 1; });
    return { rows: v.length, withInsight: v.filter((r) => r[3]).length, byStatus: by };
  });
  return { sheet: name, before, migrated: todo.length, after, dryRun };
}

// ─── Increment usedCount for injected entries ──────────────────────────────────
export async function markBrainUsed(topicKeyword) {
  // Fire-and-forget usage tracking — not critical
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${BRAIN_SHEET_NAME}'!A2:H${READ_RANGE_ROWS}`,
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
        requestBody: { valueInputOption: "RAW", data: updates },
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
    const entries = (await readBrainEntries()).filter((e) => e.status !== BRAIN_STATUS.REJECTED);
    if (entries.length < 5) return null;

    const allInsights = entries.map((e) => `[${e.type}${e.status === BRAIN_STATUS.APPROVED ? " · đã duyệt" : ""}] ${e.topic}: ${e.insight}`).join("\n");

    const result = await generateWithFallback({
      systemPrompt: "Bạn là trợ lý tổng hợp kiến thức. Trả lời rõ ràng có cấu trúc, tiếng Việt.",
      userPrompt: `Dưới đây là ${entries.length} insights AI Agent SD3 đã học được.
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
