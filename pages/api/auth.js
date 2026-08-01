/**
 * pages/api/auth.js
 * POST /api/auth — server-side authentication endpoint
 * Passwords are validated here on the server, never exposed to client JS.
 */
import { getSession, authenticate } from "../../lib/auth";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  // Chỉ cho phép email @ghn.vn
  if (!username.toLowerCase().endsWith("@ghn.vn")) {
    return res.status(403).json({ error: "Chỉ chấp nhận tài khoản @ghn.vn" });
  }

  const user = authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
  }

  // Create session
  const session = await getSession(req, res);
  session.user = {
    username: user.username,
    email: user.username,
    name: user.name || user.username,
    role: user.role,
    project: user.project || null,
  };
  await session.save();

  return res.status(200).json({
    ok: true,
    role: user.role,
    project: user.project || null,
  });
}
