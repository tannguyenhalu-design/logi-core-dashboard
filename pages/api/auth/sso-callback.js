/**
 * pages/api/auth/sso-callback.js
 * GET /api/auth/sso-callback — GHN SSO v2 redirects here with ?code&state.
 * Exchanges the code for tokens, verifies the ID token against GHN's
 * JWKS (issuer/audience/signature/nonce), then resolves the local
 * account by EmployeeId (see lib/users.js resolveSSOUser).
 */
import { unsealData } from "iron-session";
import { sessionOptions, getSession } from "../../../lib/auth";
import { exchangeCodeForTokens, verifyIdToken, fetchUserInfo } from "../../../lib/sso";
import { resolveSSOUser } from "../../../lib/users";

function clearFlowCookie(res) {
  res.setHeader("Set-Cookie", "sso_flow=; Path=/; HttpOnly; Max-Age=0");
}

export default async function handler(req, res) {
  const { code, state: returnedState, error, error_description: errorDescription } = req.query;

  if (error) {
    clearFlowCookie(res);
    return res.redirect(302, `/login?error=${encodeURIComponent(errorDescription || error)}`);
  }

  const cookieVal = req.cookies?.sso_flow;
  if (!cookieVal) {
    return res.redirect(302, `/login?error=${encodeURIComponent("Phiên đăng nhập SSO đã hết hạn, vui lòng thử lại")}`);
  }

  let flow;
  try {
    flow = await unsealData(cookieVal, { password: sessionOptions.password });
  } catch {
    clearFlowCookie(res);
    return res.redirect(302, `/login?error=${encodeURIComponent("Phiên đăng nhập SSO không hợp lệ")}`);
  }
  clearFlowCookie(res);

  if (!flow?.state || flow.state !== returnedState) {
    return res.redirect(302, `/login?error=${encodeURIComponent("State không khớp — có thể phiên đã bị giả mạo")}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const claims = await verifyIdToken(tokens.id_token, flow.nonce);
    const userinfo = await fetchUserInfo(tokens.access_token);

    // "sub" is the OIDC subject claim — GHN's own docs show it equal to
    // employee_id in their example token, and it's the one claim
    // guaranteed present, so it's the primary source, not a fallback.
    const employeeId = String(claims.sub || userinfo.employee_id || claims.employee_id || userinfo.sub || "").trim();
    if (!employeeId) throw new Error("GHN SSO không trả về mã định danh nhân viên (sub/employee_id)");
    const name = userinfo.preferred_username || userinfo.name || claims.name || employeeId;
    const email = userinfo.email || claims.email || "";

    const user = await resolveSSOUser({ employeeId, name, email });

    const session = await getSession(req, res);
    session.user = {
      employeeId,
      username: name,
      email: email || null,
      name,
      role: user.role,
      pic: user.pic || null,
      project: user.project || null,
      tabs: user.tabs || [],
      idToken: tokens.id_token, // kept only for RP-initiated logout
    };
    await session.save();

    return res.redirect(302, "/dashboard");
  } catch (err) {
    console.error("[/api/auth/sso-callback] error:", err);
    return res.redirect(302, `/login?error=${encodeURIComponent("Đăng nhập GHN SSO thất bại, vui lòng thử lại")}`);
  }
}
