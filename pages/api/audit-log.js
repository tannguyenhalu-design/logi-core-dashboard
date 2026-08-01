/**
 * pages/api/audit-log.js
 * Manager-only: view the change history (project edits, role assignments).
 */
import { getSession } from "../../lib/auth";
import { getAuditLog } from "../../lib/audit-log";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager") {
    return res.status(403).json({ error: "Chỉ Manager mới có quyền xem nhật ký hoạt động" });
  }
  try {
    const logs = await getAuditLog(300);
    return res.status(200).json({ ok: true, logs });
  } catch (err) {
    console.error("[/api/audit-log] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
