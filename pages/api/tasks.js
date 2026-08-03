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
      const { title, pics, project, deadline, notes } = req.body || {};
      if (!title || !Array.isArray(pics) || pics.length === 0 || !deadline) {
        return res.status(400).json({ error: "Missing title, pics[], or deadline" });
      }
      const created = await createTasks(
        pics.map((p) => ({ title, pic: p.pic, picName: p.picName, project, deadline, notes })),
        actor
      );
      await logAction({
        actor,
        action: "task.create",
        target: title,
        details: { pics: pics.map((p) => p.pic), deadline, project },
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
