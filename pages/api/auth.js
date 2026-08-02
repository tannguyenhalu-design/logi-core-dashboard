/**
 * pages/api/auth.js
 * POST /api/auth — server-side authentication endpoint.
 * Any @ghn.vn email can self-register on first login; the account is
 * created with role "pending" and has no dashboard access until a
 * manager approves it and assigns a role via /api/admin-users.
 */
import { getSession } from "../../lib/auth";
import { findUserByEmail, createPendingUser } from "../../lib/users";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const email = String(username).trim().toLowerCase();
  if (!email.endsWith("@ghn.vn")) {
    return res.status(403).json({ error: "Chỉ chấp nhận tài khoản @ghn.vn" });
  }

  let user;
  try {
    user = await findUserByEmail(email);
  } catch (err) {
    console.error("[/api/auth] user lookup failed:", err);
    return res.status(500).json({ error: "Lỗi hệ thống, vui lòng thử lại sau" });
  }

  if (!user) {
    try {
      await createPendingUser(email, "default_nopassword");
      user = await findUserByEmail(email); // Re-fetch the newly created user
    } catch (err) {
      console.error("[/api/auth] signup failed:", err);
      return res.status(500).json({ error: "Không thể tạo tài khoản, vui lòng thử lại sau" });
    }
  }

  // Password check completely removed as per user request to allow passwordless login.

  const session = await getSession(req, res);
  session.user = {
    username: user.email,
    email: user.email,
    name: user.email,
    role: user.role,
    pic: user.pic || null,
    project: user.project || null,
    tabs: user.tabs || [],
  };
  await session.save();

  return res.status(200).json({
    ok: true,
    role: user.role,
    project: user.project || null,
    tabs: user.tabs || [],
  });
}
