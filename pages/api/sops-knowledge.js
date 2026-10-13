/**
 * GET  /api/sops-knowledge        — đọc toàn bộ entries knowledge base
 * POST /api/sops-knowledge        — upsert/delete entry (Manager only)
 *   { action: "upsert", entry: { id?, title, category, content, tags? } }
 *   { action: "delete", id: "..." }
 */
import { getSession } from "../../lib/auth";
import { put, get } from "@vercel/blob";

const BLOB_PATH = "sops-knowledge.json";

async function loadKB() {
  try {
    const res = await get(BLOB_PATH, { access: "private", useCache: false });
    if (!res) return [];
    const text = await new Response(res.stream).text();
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function saveKB(entries) {
  await put(BLOB_PATH, JSON.stringify(entries), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

const VALID_CATEGORIES = ["đóng gói", "vận chuyển", "xử lý sự cố", "CCDC", "quy trình nội bộ", "khách hàng", "khác"];

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (req.method === "GET") {
    const entries = await loadKB();
    return res.status(200).json({ ok: true, entries });
  }

  if (req.method === "POST") {
    if (session.user.role !== "manager") {
      return res.status(403).json({ ok: false, error: "Chỉ Manager được chỉnh sửa knowledge base" });
    }

    const { action, entry, id } = req.body || {};

    if (action === "upsert") {
      if (!entry?.title || !entry?.content) {
        return res.status(400).json({ ok: false, error: "Thiếu title hoặc content" });
      }
      const entries = await loadKB();
      const clean = {
        id: String(entry.id || `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        title: String(entry.title).slice(0, 200),
        category: VALID_CATEGORIES.includes(entry.category) ? entry.category : "khác",
        content: String(entry.content).slice(0, 10000),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 20) : [],
        updatedAt: new Date().toISOString(),
        updatedBy: session.user.name || session.user.email || "?",
      };
      const idx = entries.findIndex((e) => e.id === clean.id);
      if (idx >= 0) entries[idx] = clean;
      else entries.push(clean);
      await saveKB(entries);
      return res.status(200).json({ ok: true, entry: clean, total: entries.length });
    }

    if (action === "delete") {
      const entries = await loadKB();
      const filtered = entries.filter((e) => e.id !== String(id || ""));
      await saveKB(filtered);
      return res.status(200).json({ ok: true, total: filtered.length });
    }

    return res.status(400).json({ ok: false, error: "action không hợp lệ (upsert | delete)" });
  }

  return res.status(405).end();
}
