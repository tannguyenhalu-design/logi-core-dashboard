/**
 * pages/api/auth.js
 * TEMPORARY passwordless login for @ghn.vn emails — stopgap while GHN
 * SSO client_id/secret aren't configured yet (see lib/sso.js). Remove
 * this file + the email form in pages/login.js once SSO is live; the
 * account it creates is keyed the same way SSO accounts are (see
 * lib/users.js resolvePasswordlessUser), so nothing else needs to change.
 */
import { getSession } from "../../lib/auth";
import { resolvePasswordlessUser } from "../../lib/users";

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
    user = await resolvePasswordlessUser(email);
  } catch (err) {
    console.error("[/api/auth] user lookup failed:", err);
    return res.status(500).json({ error: "Lỗi hệ thống, vui lòng thử lại sau" });
  }

  const session = await getSession(req, res);
  session.user = {
    employeeId: user.employeeId || null,
    username: user.email || email,
    email: user.email || email,
    name: user.name || email,
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
