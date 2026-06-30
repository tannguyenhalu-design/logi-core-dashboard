/**
 * pages/api/logout.js
 * GET /api/logout — destroy session and redirect to login
 */
import { getSession } from "../../lib/auth";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  session.destroy();
  return res.redirect(302, "/login");
}
