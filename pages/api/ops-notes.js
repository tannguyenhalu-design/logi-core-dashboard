/**
 * GET  /api/ops-notes?week=W41_2026  — lấy danh sách lưu ý theo tuần
 * POST /api/ops-notes                — lưu/ghi đè danh sách lưu ý theo tuần
 */
import { getSession } from "../../lib/auth";
import { put, get } from "@vercel/blob";

function blobPath(weekKey) {
  return `ops-notes/${weekKey}.json`;
}

async function loadNotes(weekKey) {
  try {
    const res = await get(blobPath(weekKey), { access: "private", useCache: false });
    if (!res) return [];
    const text = await new Response(res.stream).text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.notes) ? parsed.notes : [];
  } catch {
    return [];
  }
}

async function saveNotes(weekKey, notes) {
  await put(blobPath(weekKey), JSON.stringify({ weekKey, notes, updatedAt: new Date().toISOString() }), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (req.method === "GET") {
    const { week } = req.query;
    if (!week) return res.status(400).json({ ok: false, error: "Cần tham số week" });
    const notes = await loadNotes(week);
    return res.status(200).json({ ok: true, notes });
  }

  if (req.method === "POST") {
    const { week, notes } = req.body || {};
    if (!week || !Array.isArray(notes)) {
      return res.status(400).json({ ok: false, error: "Cần week và notes[]" });
    }
    // Validate từng note
    const clean = notes.map((n) => ({
      id: n.id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      issue:      String(n.issue || "").slice(0, 200),
      detail:     String(n.detail || "").slice(0, 2000),
      imageUrl:   String(n.imageUrl || "").slice(0, 500),
      actionPlan: String(n.actionPlan || "").slice(0, 1000),
    }));
    await saveNotes(week, clean);
    return res.status(200).json({ ok: true, saved: clean.length });
  }

  return res.status(405).end();
}
