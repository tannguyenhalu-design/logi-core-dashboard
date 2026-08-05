/**
 * pages/api/logout.js
 * GET /api/logout — destroy local session and, if the user came in via
 * GHN SSO, also end the SSO session itself (RP-Initiated Logout) so a
 * "log out" click actually logs them out, not just this one app.
 */
import { getSession } from "../../lib/auth";
import { buildLogoutUrl, ssoConfigured } from "../../lib/sso";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  const idToken = session.user?.idToken;
  session.destroy();

  if (ssoConfigured() && idToken) {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const postLogoutRedirectUri = `${proto}://${req.headers.host}/login`;
    return res.redirect(302, buildLogoutUrl({ idToken, postLogoutRedirectUri }));
  }

  return res.redirect(302, "/login");
}
