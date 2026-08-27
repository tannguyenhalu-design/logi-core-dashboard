/**
 * pages/api/tasks.js
 * SD3 task/deadline tracker — shared across the team via a Sheet-backed
 * store (see lib/tasks.js), not per-browser localStorage.
 */
import { getSession } from "../../lib/auth";
import { getAllTasks, createTasks, updateTaskStatus, updateTaskDetails, deleteTask } from "../../lib/tasks";
import { logAction } from "../../lib/audit-log";
import { emailsMatch } from "../../lib/pic-aliases";
import { resolvePicName } from "../../lib/pic-directory";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("operations")) {
    return res.status(403).json({ error: "Bạn không có quyền xem Vận hành SD3" });
  }
  const actor = session.user.name || session.user.email;

  const isManager = session.user.role === "manager";
  const userEmail = String(session.user.email || "").toLowerCase();

  // "Is this task mine" primarily compares email (t.pic vs the session's
  // real SSO email, through EMAIL_ALIASES for known work-key mismatches).
  // That alias table only helps people it's been manually kept in sync
  // for — a real incident (2026-08-17) found BOTH assignees' aliases were
  // never actually verified against a real login (neither had logged in
  // yet when the alias was written), so a still-wrong guess would have
  // silently hidden their tasks with no error anywhere. Name is the
  // sturdier signal: session.user.pic is set directly by a manager in
  // Quản lý người dùng (not guessed), and resolvePicName() maps a task's
  // stored PIC (whatever email/alias form) to that same canonical display
  // name via lib/pic-directory.js's PIC_NAMES — so a task still matches
  // its assignee even if the email on file for them is imperfect.
  const isMine = (t) =>
    emailsMatch(t.pic, userEmail) || (session.user.pic && resolvePicName(t.pic) === session.user.pic);

  if (req.method === "GET") {
    try {
      const allTasks = await getAllTasks();
      // Non-managers only see tasks they're personally assigned to — a task
      // given to 3 people shows for all 3 (each has their own row/pic), a
      // task given to 1 shows only for that 1. Manager keeps full oversight.
      const tasks = isManager
        ? allTasks
        : allTasks.filter(isMine);
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
    if (req.body?.action === "editDetails") {
      try {
        const { groupId, title, project, deadline, notes, pics } = req.body || {};
        if (!groupId) return res.status(400).json({ error: "Missing groupId" });
        if (title !== undefined && !String(title).trim()) {
          return res.status(400).json({ error: "Tên task không được để trống" });
        }
        if (deadline !== undefined && !deadline) {
          return res.status(400).json({ error: "Hạn chót không được để trống" });
        }
        // Editing task content (title/deadline/notes/PIC) is manager-only —
        // an assignee's own recourse is the completion-note "phản hồi" on
        // the regular status-update path below, not rewriting the task.
        if (!isManager) {
          return res.status(403).json({ error: "Chỉ Manager mới có thể sửa nội dung task" });
        }
        if (Array.isArray(pics) && pics.length === 0) {
          return res.status(400).json({ error: "Task cần ít nhất 1 người phụ trách" });
        }
        const tasks = await updateTaskDetails(groupId, { title, project, deadline, notes, pics }, actor);
        await logAction({ actor, action: "task.edit_details", target: groupId, details: { title, project, deadline, notes, pics: pics?.map((p) => p.pic) } });
        return res.status(200).json({ ok: true, tasks });
      } catch (err) {
        console.error("[/api/tasks] PATCH editDetails error:", err);
        return res.status(500).json({ error: err.message });
      }
    }

    try {
      const { id, status, note } = req.body || {};
      if (!id || !status) return res.status(400).json({ error: "Missing id or status" });
      // A row can only be updated by the person it's assigned to, or a
      // manager — otherwise anyone with operations access could mark a
      // teammate's task done (or reopen it) on their behalf.
      if (!isManager) {
        const allTasks = await getAllTasks();
        const target = allTasks.find((t) => t.id === id);
        if (!target || !isMine(target)) {
          return res.status(403).json({ error: "Bạn chỉ có thể cập nhật task của chính mình" });
        }
      }
      const task = await updateTaskStatus(id, status, actor, note);
      await logAction({ actor, action: "task.update_status", target: id, details: { status, note } });
      return res.status(200).json({ ok: true, task });
    } catch (err) {
      console.error("[/api/tasks] PATCH error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    if (!isManager) return res.status(403).json({ error: "Chỉ Manager mới có thể xoá task" });
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
