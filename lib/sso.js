/**
 * lib/sso.js
 * GHN SSO v2 (OpenID Connect) client — replaces the old passwordless
 * @ghn.vn login. Auth code flow, ID token verified against GHN's JWKS,
 * see docs/sso-v2-oidc-integration-guide.md for the spec this follows.
 */
import { jwtVerify, createRemoteJWKSet } from "jose";

const SSO_ENV = process.env.GHN_SSO_ENV === "production" ? "production" : "staging";
const BASE_URL =
  SSO_ENV === "production"
    ? "https://online-gateway.ghn.vn/sso-v2/public-api"
    : "https://dev-online-gateway.ghn.vn/sso-v2/public-api";

export const SSO_ISSUER = BASE_URL;
const AUTHORIZE_ENDPOINT = `${BASE_URL}/oauth2/authorize`;
const TOKEN_ENDPOINT = `${BASE_URL}/oauth2/token`;
const USERINFO_ENDPOINT = `${BASE_URL}/oauth2/userinfo`;
const LOGOUT_ENDPOINT = `${BASE_URL}/oauth2/logout`;
const JWKS_URI = `${BASE_URL}/oauth2/jwks`;

const CLIENT_ID = process.env.GHN_SSO_CLIENT_ID;
const CLIENT_SECRET = process.env.GHN_SSO_CLIENT_SECRET;
const REDIRECT_URI = process.env.GHN_SSO_REDIRECT_URI;

let jwks;
function getJWKS() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URI));
  return jwks;
}

export function ssoConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

export function buildAuthorizationUrl({ state, nonce }) {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return url.toString();
}

export async function exchangeCodeForTokens(code) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error_description || data.error || "Token exchange failed");
  }
  return data; // { access_token, id_token, token_type, expires_in }
}

export async function verifyIdToken(idToken, expectedNonce) {
  const { payload } = await jwtVerify(idToken, getJWKS(), {
    issuer: SSO_ISSUER,
    audience: CLIENT_ID,
  });
  if (payload.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch — token này không thuộc phiên đăng nhập hiện tại");
  }
  return payload;
}

export async function fetchUserInfo(accessToken) {
  const resp = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error("Không lấy được thông tin người dùng từ GHN SSO");
  return resp.json();
}

export function buildLogoutUrl({ idToken, postLogoutRedirectUri, state }) {
  const url = new URL(LOGOUT_ENDPOINT);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  if (postLogoutRedirectUri) url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
