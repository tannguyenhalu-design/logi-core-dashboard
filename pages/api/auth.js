/**
 * pages/api/auth.js
 * POST /api/auth — server-side authentication endpoint.
 * Any @ghn.vn email can self-register on first login; the account is
 * created with role "pending" and has no dashboard access until a
 * manager approves it and assigns a role via /api/admin-users.
 */
import { getSession } from "../../lib/auth";
import { findUserByEmail, createPendingUser, checkPassword, setUserPassword } from "../../lib/users";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
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
      await createPendingUser(email, password);
    } catch (err) {
      console.error("[/api/auth] signup failed:", err);
      return res.status(500).json({ error: "Không thể tạo tài khoản, vui lòng thử lại sau" });
    }
    return res.status(403).json({
      error: "Tài khoản mới đã được tạo. Vui lòng chờ quản lý duyệt quyền truy cập.",
      pending: true,
    });
  }

  if (user.role === "pending") {
    return res.status(403).json({
      error: "Tài khoản của bạn đang chờ quản lý duyệt quyền truy cập.",
      pending: true,
    });
  }

  if (!user.passwordHash) {
    // Manager pre-created this account (with a role already assigned) but no
    // password yet — the first login attempt sets it.
    try {
      await setUserPassword(user.email, password);
    } catch (err) {
      console.error("[/api/auth] set initial password failed:", err);
      return res.status(500).json({ error: "Không thể đặt mật khẩu, vui lòng thử lại sau" });
    }
  } else if (!checkPassword(user, password)) {
    return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
  }

  const session = await getSession(req, res);
  session.user = {
    username: user.email,
    email: user.email,
    name: user.email,
    role: user.role,
    pic: user.pic || null,
    project: user.project || null,
  };
  await session.save();

  return res.status(200).json({
    ok: true,
    role: user.role,
    project: user.project || null,
  });
}
