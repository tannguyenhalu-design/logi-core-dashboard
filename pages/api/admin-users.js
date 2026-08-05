/**
 * pages/api/admin-users.js
 * Manager-only: list all accounts and approve/assign roles.
 * Accounts are identified by GHN SSO EmployeeId once the person has
 * logged in at least once; before that a manager can pre-provision
 * access by full name (see lib/users.js resolveSSOUser for the link-up).
 */
import { getSession } from "../../lib/auth";
import { getAllUsers, updateUserRole, createUserWithRole, findUserByName } from "../../lib/users";
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
          name: u.name,
          employeeId: u.employeeId,
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
      const { name, employeeId, role, pic, project, tabs } = req.body || {};
      if (!role) return res.status(400).json({ error: "Thiếu vai trò" });
      if (!["pending", "manager", "sd3", "cs"].includes(role)) {
        return res.status(400).json({ error: "Vai trò không hợp lệ" });
      }
      const normalizedTabs = Array.isArray(tabs) ? tabs.filter((t) => ["ltl", "operations", "tachtrip"].includes(t)) : undefined;

      if (employeeId) {
        await updateUserRole({ employeeId }, { role, pic, project, tabs: normalizedTabs, updatedBy: session.user.email || session.user.name });
        await logAction({
          actor: session.user.email || session.user.name,
          action: "user.role_update",
          target: employeeId,
          details: { role, pic, project, tabs: normalizedTabs },
        });
        return res.status(200).json({ ok: true });
      }

      const normalizedName = String(name || "").trim();
      if (!normalizedName) return res.status(400).json({ error: "Thiếu tên người dùng" });

      const existing = await findUserByName(normalizedName);
      if (existing) {
        await updateUserRole({ employeeId: existing.employeeId, name: normalizedName }, { role, pic, project, tabs: normalizedTabs, updatedBy: session.user.email || session.user.name });
      } else {
        await createUserWithRole(normalizedName, { role, pic, project, tabs: normalizedTabs, updatedBy: session.user.email || session.user.name });
      }

      await logAction({
        actor: session.user.email || session.user.name,
        action: existing ? "user.role_update" : "user.create",
        target: normalizedName,
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
