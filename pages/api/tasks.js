/**
 * pages/api/tasks.js
 * SD3 task/deadline tracker — shared across the team via a Sheet-backed
 * store (see lib/tasks.js), not per-browser localStorage.
 */
import { getSession } from "../../lib/auth";
import { getAllTasks, createTasks, updateTaskStatus, deleteTask } from "../../lib/tasks";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("operations")) {
    return res.status(403).json({ error: "Bạn không có quyền xem Vận hành SD3" });
  }
  const actor = session.user.name || session.user.email;

  if (req.method === "GET") {
    try {
      const tasks = await getAllTasks();
      return res.status(200).json({ ok: true, tasks });
    } catch (err) {
      console.error("[/api/tasks] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      // Either one task-group in the body directly ({title, pics, ...})
      // or several at once via `tasks: [{title, pics, ...}, ...]` — lets
      // "giao 4 task khác nhau cùng lúc" happen in a single save instead
      // of reopening the modal 4 times. Each group still fans out across
      // its own selected assignees, all written in one batched append.
      const groups = Array.isArray(req.body?.tasks) ? req.body.tasks : [req.body];

      for (const g of groups) {
        if (!g?.title || !Array.isArray(g.pics) || g.pics.length === 0 || !g.deadline) {
          return res.status(400).json({ error: "Mỗi task cần có tiêu đề, ít nhất 1 người phụ trách, và hạn chót" });
        }
      }

      // Each group fans out into one row per assignee (own status, own
      // deadline outcome to track) — they all share a groupId so the UI
      // can show them back as a single task instead of N unrelated ones.
      const flat = groups.flatMap((g) => {
        const groupId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return g.pics.map((p) => ({
          groupId,
          title: g.title,
          pic: p.pic,
          picName: p.picName,
          project: g.project,
          deadline: g.deadline,
          notes: g.notes,
        }));
      });
      const created = await createTasks(flat, actor);

      await logAction({
        actor,
        action: "task.create",
        target: groups.map((g) => g.title).join(", "),
        details: { count: created.length, groups: groups.map((g) => ({ title: g.title, pics: g.pics.map((p) => p.pic), deadline: g.deadline })) },
      });
      return res.status(200).json({ ok: true, tasks: created });
    } catch (err) {
      console.error("[/api/tasks] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PATCH") {
    try {
      const { id, status } = req.body || {};
      if (!id || !status) return res.status(400).json({ error: "Missing id or status" });
      const task = await updateTaskStatus(id, status, actor);
      await logAction({ actor, action: "task.update_status", target: id, details: { status } });
      return res.status(200).json({ ok: true, task });
    } catch (err) {
      console.error("[/api/tasks] PATCH error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteTask(id);
      await logAction({ actor, action: "task.delete", target: id });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/tasks] DELETE error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
