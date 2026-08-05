/**
 * pages/api/auth/sso-login.js
 * GET — kicks off the GHN SSO v2 (OIDC) authorization code flow.
 * state/nonce are sealed into a short-lived cookie (not the real
 * session — the user isn't authenticated yet) and checked in
 * sso-callback.js to guard against CSRF/replay.
 */
import crypto from "crypto";
import { sealData } from "iron-session";
import { sessionOptions } from "../../../lib/auth";
import { buildAuthorizationUrl, ssoConfigured } from "../../../lib/sso";

export default async function handler(req, res) {
  if (!ssoConfigured()) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(500).send(
      "GHN SSO chưa được cấu hình (thiếu GHN_SSO_CLIENT_ID / GHN_SSO_CLIENT_SECRET / GHN_SSO_REDIRECT_URI). Liên hệ quản trị viên."
    );
    return;
  }

  const state = crypto.randomBytes(32).toString("hex");
  const nonce = crypto.randomBytes(32).toString("hex");
  const sealed = await sealData({ state, nonce }, { password: sessionOptions.password, ttl: 600 });

  const cookieParts = [
    `sso_flow=${sealed}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
  ];
  if (process.env.NODE_ENV === "production") cookieParts.push("Secure");
  res.setHeader("Set-Cookie", cookieParts.join("; "));

  res.writeHead(302, { Location: buildAuthorizationUrl({ state, nonce }) });
  res.end();
}
