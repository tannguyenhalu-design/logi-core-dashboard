/**
 * GET  /api/team-notes?week=W42_2026  — đọc dữ liệu báo cáo nội bộ theo tuần
 * POST /api/team-notes                — lưu tasks + matrix + cases theo tuần
 */
import { getSession } from "../../lib/auth";
import { put, get } from "@vercel/blob";

function blobPath(weekKey) {
  return `team-report/${weekKey}.json`;
}

async function loadData(weekKey) {
  try {
    const res = await get(blobPath(weekKey), { access: "private", useCache: false });
    if (!res) return null;
    const text = await new Response(res.stream).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveData(weekKey, payload) {
  await put(blobPath(weekKey), JSON.stringify({ weekKey, ...payload, updatedAt: new Date().toISOString() }), {
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
    const data = await loadData(week);
    return res.status(200).json({ ok: true, data });
  }

  if (req.method === "POST") {
    const { week, tasks, matrix, cases, pipeline } = req.body || {};
    if (!week) return res.status(400).json({ ok: false, error: "Cần tham số week" });
    const cleanTasks = Array.isArray(tasks) ? tasks.map((t) => ({
      id: t.id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      pic: String(t.pic || "").slice(0, 50),
      client: String(t.client || "").slice(0, 100),
      action: String(t.action || "").slice(0, 500),
      deadline: String(t.deadline || "").slice(0, 20),
      status: ["pending", "done", "inprogress"].includes(t.status) ? t.status : "pending",
    })) : [];
    await saveData(week, { tasks: cleanTasks, matrix: matrix || null, cases: cases || null, pipeline: pipeline || null });
    return res.status(200).json({ ok: true, saved: cleanTasks.length });
  }

  return res.status(405).end();
}
