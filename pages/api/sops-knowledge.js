/**
 * GET  /api/sops-knowledge        — đọc toàn bộ entries knowledge base
 * POST /api/sops-knowledge        — upsert/delete entry (Manager only)
 *   { action: "upsert",      entry: { id?, title, category, content, tags?, customSteps? } }
 *   { action: "delete",      id: "..." }
 *   { action: "add-step",    entry_id: "...", step: { label, color, hint } }
 *   { action: "remove-step", entry_id: "...", step_id: "..." }
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
const VALID_COLORS = ["#06b6d4","#f59e0b","#10b981","#8b5cf6","#ef4444","#f97316","#3b82f6","#ec4899"];

function cleanStep(s) {
  return {
    id: /^step_[\w-]{4,}$/.test(String(s.id || ""))
      ? String(s.id)
      : `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: String(s.label || "Bước mới").slice(0, 100).trim(),
    color: VALID_COLORS.includes(s.color) ? s.color : "#06b6d4",
    hint:  String(s.hint || "").slice(0, 300).trim(),
  };
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (req.method === "GET") {
    const entries = await loadKB();
    return res.status(200).json({ ok: true, entries });
  }

  if (req.method === "POST") {
    const role = session.user.role;
    if (role !== "manager" && role !== "sd3") {
      return res.status(403).json({ ok: false, error: "Chỉ Manager/SD được chỉnh sửa knowledge base" });
    }

    const { action, entry, id, entry_id, step, step_id } = req.body || {};

    if (action === "upsert") {
      if (!entry?.title || !entry?.content) {
        return res.status(400).json({ ok: false, error: "Thiếu title hoặc content" });
      }
      const entries = await loadKB();
      const existing = entries.find(e => e.id === String(entry.id || ""));
      const clean = {
        id: String(entry.id || `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        title:    String(entry.title).slice(0, 200),
        category: VALID_CATEGORIES.includes(entry.category) ? entry.category : "khác",
        content:  String(entry.content).slice(0, 10000),
        tags:     Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 20) : [],
        updatedAt: new Date().toISOString(),
        updatedBy: session.user.name || session.user.email || "?",
        // Preserve customSteps: use incoming if provided, else keep existing
        customSteps: Array.isArray(entry.customSteps)
          ? entry.customSteps.map(cleanStep).slice(0, 10)
          : (existing?.customSteps || []),
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

    if (action === "add-step") {
      if (!entry_id || !step?.label) {
        return res.status(400).json({ ok: false, error: "Thiếu entry_id hoặc step.label" });
      }
      const entries = await loadKB();
      const idx = entries.findIndex(e => e.id === String(entry_id));
      if (idx < 0) return res.status(404).json({ ok: false, error: "Entry không tồn tại" });
      if (!entries[idx].customSteps) entries[idx].customSteps = [];
      if (entries[idx].customSteps.length >= 10) {
        return res.status(400).json({ ok: false, error: "Tối đa 10 bước tùy chỉnh mỗi SOP" });
      }
      const newStep = cleanStep(step);
      entries[idx].customSteps.push(newStep);
      await saveKB(entries);
      return res.status(200).json({ ok: true, step: newStep });
    }

    if (action === "remove-step") {
      if (!entry_id || !step_id) {
        return res.status(400).json({ ok: false, error: "Thiếu entry_id hoặc step_id" });
      }
      const entries = await loadKB();
      const idx = entries.findIndex(e => e.id === String(entry_id));
      if (idx < 0) return res.status(404).json({ ok: false, error: "Entry không tồn tại" });
      entries[idx].customSteps = (entries[idx].customSteps || []).filter(s => s.id !== String(step_id));
      await saveKB(entries);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: "action không hợp lệ (upsert | delete | add-step | remove-step)" });
  }

  return res.status(405).end();
}
