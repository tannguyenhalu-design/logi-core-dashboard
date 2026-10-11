/**
 * GET  /api/fc-annotations        — lấy toàn bộ annotations
 * POST /api/fc-annotations        — thêm annotation
 * DELETE /api/fc-annotations?id=X — xóa annotation theo id
 */
import { getSession } from "../../lib/auth";
import { put, get } from "@vercel/blob";

const BLOB_KEY = "annotations/fc-annotations.json";

async function loadAnnotations() {
  try {
    const res = await get(BLOB_KEY, { access: "private", useCache: false });
    if (!res) return [];
    const text = await new Response(res.stream).text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.annotations) ? parsed.annotations : [];
  } catch {
    return [];
  }
}

async function saveAnnotations(list) {
  await put(BLOB_KEY, JSON.stringify({ annotations: list }), {
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
    const list = await loadAnnotations();
    return res.status(200).json({ ok: true, annotations: list });
  }

  if (req.method === "POST") {
    const { client, reason, reasonType, scope, eventDate } = req.body || {};
    if (!client || !reason || !reasonType || !scope) {
      return res.status(400).json({ ok: false, error: "Thiếu trường bắt buộc" });
    }
    const list = await loadAnnotations();
    // Upsert: 1 annotation per (client, scope, eventDate)
    const idx = list.findIndex(
      (a) => a.client === client && a.scope === scope && (scope === "global" || a.eventDate === eventDate)
    );
    const entry = {
      id: idx >= 0 ? list[idx].id : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      client,
      reason,
      reasonType,       // "pause" | "explain"
      scope,            // "event" | "global"
      eventDate: scope === "event" ? (eventDate || "") : "",
      timestamp: new Date().toISOString(),
      createdBy: session.user.email || session.user.name || "unknown",
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    await saveAnnotations(list);
    return res.status(200).json({ ok: true, annotation: entry });
  }

  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, error: "Cần id" });
    let list = await loadAnnotations();
    list = list.filter((a) => a.id !== id);
    await saveAnnotations(list);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
