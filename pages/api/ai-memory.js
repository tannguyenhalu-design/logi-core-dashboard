/**
 * pages/api/ai-memory.js
 * Memory API — đọc và ghi vào Bộ Não của Tiểu Đệ SD3
 *
 * GET  /api/ai-memory                  → brain context hiện tại
 * GET  /api/ai-memory?action=raw       → toàn bộ entries (A–K, có Status)
 * GET  /api/ai-memory?action=summary   → tạo Weekly Summary
 * POST /api/ai-memory                  → lưu insight mới (manual hoặc từ chat)
 * PATCH /api/ai-memory                 → duyệt / bỏ 1 entry { row, ts, status, insight?, topic? }
 *                                        hoặc duyệt câu trả lời chat { approveReply, reply, message }
 * DELETE /api/ai-memory                → xóa toàn bộ brain (manager only)
 */
import { getSession } from "../../lib/auth";
import {
  loadBrainContext,
  saveBrainInsights,
  generateWeeklySummary,
  readBrainEntries,
  reviewBrainEntry,
  extractInsightsFromChat,
  BRAIN_TYPES,
  BRAIN_STATUS,
} from "../../lib/ai-brain";
import { getAuth } from "../../lib/sheets";
import { google } from "googleapis";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  // ── GET: read brain ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { action } = req.query;

    if (action === "summary") {
      const summary = await generateWeeklySummary();
      return res.status(200).json({ ok: true, summary });
    }

    if (action === "raw") {
      // Return full entries with Status/VerifiedBy/VerifiedAt and row numbers.
      const entries = await readBrainEntries({ fresh: true });
      return res.status(200).json({ ok: true, entries, total: entries.length });
    }

    // Default: formatted brain context
    const [context, entries] = await Promise.all([loadBrainContext(), readBrainEntries()]);
    return res.status(200).json({ ok: true, context, totalEntries: entries.length });
  }

  // ── PATCH: duyệt / bỏ entry hoặc câu trả lời chat ──────────────────────────
  if (req.method === "PATCH") {
    if (session.user.role !== "manager") {
      return res.status(403).json({ error: "Chỉ Manager mới có thể duyệt" });
    }
    const actor = session.user.name || session.user.email;
    const body = req.body || {};

    // Duyệt câu trả lời chat: lưu insights từ reply với status = Đã duyệt
    if (body.approveReply) {
      const { reply, message } = body;
      if (!reply) return res.status(400).json({ error: "Thiếu reply" });
      const insights = await extractInsightsFromChat({ message: message || "", reply, userName: actor, projectsList: [] });
      if (!insights.length) return res.status(200).json({ ok: true, saved: 0, note: "Không rút được insight từ câu trả lời này" });
      await saveBrainInsights(insights.map((i) => ({ ...i, source: session.user.email || "manager-approve", status: BRAIN_STATUS.APPROVED, verifiedBy: actor })));
      return res.status(200).json({ ok: true, saved: insights.length });
    }

    // Duyệt / Bỏ / sửa 1 entry cụ thể
    const { row, ts, status, insight, topic } = body;
    const r = await reviewBrainEntry({ row, ts, status, insight, topic, actor });
    return res.status(r.ok ? 200 : 400).json(r);
  }

  // ── POST: save insight(s) ────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { insights, type, topic, insight, confidence } = req.body || {};

    let toSave = [];
    if (Array.isArray(insights)) {
      toSave = insights;
    } else if (insight) {
      // Single insight shorthand
      toSave = [{ type: type || BRAIN_TYPES.BUSINESS, topic, insight, confidence: confidence || 0.8, source: session.user.email || "manual" }];
    }

    if (toSave.length === 0) {
      return res.status(400).json({ error: "No insights to save" });
    }

    // Add source = manual + user email
    toSave = toSave.map((i) => ({ ...i, source: i.source || session.user.email || "manual" }));

    await saveBrainInsights(toSave);
    return res.status(200).json({ ok: true, saved: toSave.length });
  }

  // ── DELETE: reset brain (manager only) ───────────────────────────────────────
  if (req.method === "DELETE") {
    if (session.user.role !== "manager") {
      return res.status(403).json({ error: "Chỉ Manager mới có thể reset Brain" });
    }
    const auth = getAuth();
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient });
    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID_PROJECTS ||
      process.env.SHEET_ID_PROJECTS ||
      process.env.GOOGLE_SHEET_ID;

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'AI_Brain'!A2:K2000`,
    });
    return res.status(200).json({ ok: true, message: "Brain đã được reset thành công" });
  }

  return res.status(405).end();
}
