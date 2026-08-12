/**
 * pages/api/ai-memory.js
 * Memory API — đọc và ghi vào Bộ Não của Tiểu Đệ SD3
 *
 * GET  /api/ai-memory           → trả về brain context hiện tại
 * POST /api/ai-memory           → lưu insight mới (manual hoặc từ chat)
 * GET  /api/ai-memory?action=summary → tạo Weekly Summary
 * DELETE /api/ai-memory         → xóa toàn bộ brain (reset)
 */
import { getSession } from "../../lib/auth";
import {
  loadBrainContext,
  saveBrainInsights,
  generateWeeklySummary,
  BRAIN_TYPES,
} from "../../lib/ai-brain";
import { getAuth } from "../../lib/sheets";
import { google } from "googleapis";

const BRAIN_SHEET_NAME = "AI_Brain";

async function getRawBrainEntries() {
  const auth = getAuth();
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });
  const spreadsheetId =
    process.env.GOOGLE_SHEET_ID_PROJECTS ||
    process.env.SHEET_ID_PROJECTS ||
    process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${BRAIN_SHEET_NAME}'!A1:H500`,
  });
  return res.data.values || [];
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  // ── GET: read brain ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { action } = req.query;

    if (action === "summary") {
      // Generate weekly knowledge summary
      const summary = await generateWeeklySummary();
      return res.status(200).json({ ok: true, summary });
    }

    if (action === "raw") {
      // Return raw entries for admin view
      const rows = await getRawBrainEntries();
      const headers = rows[0] || [];
      const entries = rows.slice(1).map((r) => ({
        timestamp:  r[0] || "",
        type:       r[1] || "",
        topic:      r[2] || "",
        insight:    r[3] || "",
        source:     r[4] || "",
        confidence: parseFloat(r[5]) || 0,
        usedCount:  parseInt(r[6]) || 0,
        lastUsed:   r[7] || "",
      }));
      return res.status(200).json({ ok: true, entries, total: entries.length });
    }

    // Default: return formatted brain context
    const context = await loadBrainContext();
    const rows = await getRawBrainEntries();
    const total = Math.max(rows.length - 1, 0);
    return res.status(200).json({ ok: true, context, totalEntries: total });
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
      range: `'${BRAIN_SHEET_NAME}'!A2:H500`,
    });
    return res.status(200).json({ ok: true, message: "Brain đã được reset thành công" });
  }

  return res.status(405).end();
}
