/**
 * pages/api/admin-users.js
 * Manager-only: list all accounts and approve/assign roles.
 */
import { getSession } from "../../lib/auth";
import { getAllUsers, updateUserRole, createUserWithRole, findUserByEmail } from "../../lib/users";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager") {
    return res.status(403).json({ error: "Chỉ Manager mới có quyền quản lý người dùng" });
  }

  if (req.method === "GET") {
    try {
      const users = await getAllUsers();
      return res.status(200).json({
        ok: true,
        users: users.map((u) => ({
          email: u.email,
          role: u.role,
          pic: u.pic,
          project: u.project,
          tabs: u.tabs,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
          updatedBy: u.updatedBy,
        })),
      });
    } catch (err) {
      console.error("[/api/admin-users] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { email, role, pic, project, tabs } = req.body || {};
      if (!email || !role) return res.status(400).json({ error: "Thiếu email hoặc vai trò" });
      if (!["pending", "manager", "sd3", "cs", "client"].includes(role)) {
        return res.status(400).json({ error: "Vai trò không hợp lệ" });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!normalizedEmail.endsWith("@ghn.vn")) {
        return res.status(400).json({ error: "Chỉ chấp nhận email @ghn.vn" });
      }
      const normalizedTabs = Array.isArray(tabs) ? tabs.filter((t) => ["ltl", "operations", "tachtrip"].includes(t)) : undefined;

      const existing = await findUserByEmail(normalizedEmail);
      if (existing) {
        await updateUserRole(normalizedEmail, { role, pic, project, tabs: normalizedTabs, updatedBy: session.user.email });
      } else {
        await createUserWithRole(normalizedEmail, { role, pic, project, tabs: normalizedTabs, updatedBy: session.user.email });
      }

      await logAction({
        actor: session.user.email,
        action: existing ? "user.role_update" : "user.create",
        target: normalizedEmail,
        details: { role, pic, project, tabs: normalizedTabs },
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/admin-users] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
