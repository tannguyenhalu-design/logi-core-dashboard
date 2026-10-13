import { getSession } from "../../lib/auth";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const canView = session.user.role === "manager";
  return res.status(200).json({ ok: true, canView });
}
