/**
 * GET  /api/sops          — đọc danh sách SOPs CCDC từ Blob
 * POST /api/sops          — tạo/sửa/xóa SOP
 *   { action: "upsert", sop: {...} }
 *   { action: "delete", id: "..." }
 */
import { getSession } from "../../lib/auth";
import { put, get } from "@vercel/blob";

const BLOB_PATH = "sops-library.json";

async function loadSops() {
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

async function saveSops(sops) {
  await put(BLOB_PATH, JSON.stringify(sops), {
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
    const sops = await loadSops();
    return res.status(200).json({ ok: true, sops });
  }

  if (req.method === "POST") {
    const { action, sop, id } = req.body || {};
    const sops = await loadSops();

    if (action === "upsert") {
      const clean = {
        id: String(sop?.id || `sop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        title: String(sop?.title || "").slice(0, 150),
        materialType: ["mút EVA", "nẹp góc PP", "vách ngăn", "khác"].includes(sop?.materialType) ? sop.materialType : "khác",
        useCase: String(sop?.useCase || "").slice(0, 500),
        steps: String(sop?.steps || "").slice(0, 2000),
        note: String(sop?.note || "").slice(0, 500),
        updatedAt: new Date().toISOString(),
        updatedBy: session.user.name || session.user.email || "?",
      };
      const idx = sops.findIndex((s) => s.id === clean.id);
      if (idx >= 0) sops[idx] = clean;
      else sops.push(clean);
      await saveSops(sops);
      return res.status(200).json({ ok: true, sops });
    }

    if (action === "delete") {
      const filtered = sops.filter((s) => s.id !== String(id || ""));
      await saveSops(filtered);
      return res.status(200).json({ ok: true, sops: filtered });
    }

    return res.status(400).json({ ok: false, error: "action không hợp lệ" });
  }

  return res.status(405).end();
}
