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

  const user = authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  // Create session
  const session = await getSession(req, res);
  session.user = {
    username: user.username,
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
