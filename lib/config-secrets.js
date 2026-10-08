/**
 * lib/config-secrets.js — Centralized Secret Manager
 *
 * Priority chain khi đọc secrets:
 *   1. GTalk Miniapp Secret Portal  (khi GTALK_SECRET_PORTAL_URL được cấu hình)
 *   2. process.env                  (Vercel Environment Variables — mặc định hiện tại)
 *
 * Thiết kế:
 *   - Nếu GTalk Portal không accessible → tự động fallback về process.env, không throw.
 *   - Per-instance in-memory cache để tránh gọi Portal nhiều lần trong 1 request.
 *   - Existing code (ai-providers.js, sheets.js, ...) KHÔNG cần sửa đổi.
 *     config-secrets.js là entry point cho code MỚI và cho GTalk Miniapp deployment.
 *
 * Usage trong code mới:
 *   import { getSecret } from "./config-secrets";
 *   const key = await getSecret("GEMINI_API_KEY");
 */

// ─── GTalk Secret Portal (stub) ───────────────────────────────────────────────
// Khi GTALK_SECRET_PORTAL_URL và GTALK_SECRET_PORTAL_TOKEN được cấu hình,
// các secrets sẽ được đọc từ Portal thay vì Vercel env.
async function fetchFromGTalkPortal(key) {
  const portalUrl  = process.env.GTALK_SECRET_PORTAL_URL;
  const portalToken = process.env.GTALK_SECRET_PORTAL_TOKEN;
  if (!portalUrl || !portalToken) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000); // 3s timeout
  try {
    const res = await fetch(
      `${portalUrl}/api/secrets/${encodeURIComponent(key)}`,
      {
        headers: {
          Authorization: `Bearer ${portalToken}`,
          "X-App-Id":    "miniapp-sd3-control-tower",
          "X-App-Version": process.env.npm_package_version || "1.0.0",
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.value ?? null;
  } catch {
    // Portal không accessible → fallback to env, không log lỗi (expected trên Vercel)
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main: get secret with priority chain ─────────────────────────────────────
const _cache = new Map(); // per-instance cache (reset on cold start)

/**
 * Đọc secret theo priority chain: GTalk Portal → process.env.
 * @param {string} key  Tên secret (ví dụ "GEMINI_API_KEY")
 * @returns {Promise<string|null>}
 */
export async function getSecret(key) {
  if (_cache.has(key)) return _cache.get(key);

  // 1. GTalk Secret Portal
  const fromPortal = await fetchFromGTalkPortal(key);
  if (fromPortal != null) {
    _cache.set(key, fromPortal);
    return fromPortal;
  }

  // 2. Vercel Environment Variables
  const fromEnv = process.env[key] ?? null;
  if (fromEnv != null) _cache.set(key, fromEnv);
  return fromEnv;
}

/** Đọc sync từ process.env (không qua Portal — dùng cho configs không sensitive). */
export const getEnv = (key, fallback = null) => process.env[key] ?? fallback;

/** Clear in-memory cache (dùng trong tests). */
export const clearSecretCache = () => _cache.clear();

// ─── Convenience wrappers cho các secrets hay dùng ───────────────────────────
export const getGeminiKey      = () => getSecret("GEMINI_API_KEY");
export const getGroqKey        = () => getSecret("GROQ_API_KEY");
export const getGoogleSheetId  = () => getSecret("GOOGLE_SHEET_ID");
export const getSheetIdLtl     = () => getSecret("SHEET_ID_LTL");
export const getSheetIdProjects = () =>
  getSecret("GOOGLE_SHEET_ID_PROJECTS") ?? getSecret("SHEET_ID_PROJECTS") ?? getSecret("GOOGLE_SHEET_ID");

// ─── Secret health check ──────────────────────────────────────────────────────
const REQUIRED_SECRETS = [
  "GEMINI_API_KEY",
  "GOOGLE_SHEET_ID",
  "SHEET_ID_LTL",
  "NEXTAUTH_SECRET",
];

/**
 * Kiểm tra các secrets bắt buộc có sẵn không.
 * Dùng bởi /api/system-health để báo cáo trạng thái secret management.
 * @returns {Promise<{ok:boolean, missing:string[], source:"portal"|"env"|"mixed"}>}
 */
export async function checkRequiredSecrets() {
  const results = await Promise.all(
    REQUIRED_SECRETS.map(async (k) => ({ key: k, value: await getSecret(k) }))
  );
  const missing = results.filter((r) => !r.value).map((r) => r.key);
  const fromPortal = !!process.env.GTALK_SECRET_PORTAL_URL;
  return {
    ok: missing.length === 0,
    missing,
    source: fromPortal ? "portal" : "env",
    checked: REQUIRED_SECRETS.length,
  };
}
