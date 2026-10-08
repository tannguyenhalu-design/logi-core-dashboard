/**
 * lib/data-layer/raw-layer.js — Raw Data Layer
 *
 * Tầng dữ liệu thô: điểm giao tiếp duy nhất với các nguồn dữ liệu bên ngoài.
 * Mọi luồng cào / đọc dữ liệu gốc đều được đóng gói tại đây.
 *
 * Hiện tại:
 *   - Google Sheets (via lib/ltl-snapshot.js buildLtlSnapshot)
 *   - Rillnet "Báo cáo bể vỡ" (đồng bộ qua Apps Script → Google Sheets)
 *   - Scraper portal.ghn.vn (ĐÃ TẮT từ 27/08/2026 — xem memory feedback_no_ghn_portal_scraping)
 *
 * Tương lai (khi có connector):
 *   - GHN OpenAPI (webhook đơn hàng real-time)
 *   - Rillnet API trực tiếp (thay vì qua Sheets)
 */

// ─── Data source catalog ───────────────────────────────────────────────────────
// Mô tả WHERE từng loại dữ liệu thô đến từ đâu.
// Dùng làm tài liệu kiến trúc và để db-adapter/config-secrets biết secret nào cần.
export const RAW_DATA_SOURCES = {
  ltl_ontime: {
    provider: "google_sheets",
    secretKey: "SHEET_ID_LTL",
    tab: "raw_ontime",
    updateFrequency: "3x/day (cron /api/cron/build-snapshot)",
    owner: "GHN SD3 Operations",
    volume: "~50k rows/tháng",
  },
  damage_causes: {
    provider: "google_sheets",
    secretKey: "GOOGLE_SHEET_ID",
    tab: "raw_damage_causes",
    updateFrequency: "every 2h (Apps Script tannt@ghn.vn)",
    owner: "GHN Rillnet",
    volume: "~500 cases/tháng",
  },
  compensation_summary: {
    provider: "google_sheets",
    secretKey: "GOOGLE_SHEET_ID",
    tab: "raw_compensation_summary",
    updateFrequency: "every 2h (Apps Script)",
    owner: "GHN Rillnet / CS",
  },
  damage_money: {
    provider: "google_sheets",
    secretKey: "GOOGLE_SHEET_ID",
    tab: "raw_damage_money",
    updateFrequency: "on-demand (CS điền)",
    owner: "GHN CS Team",
  },
  ai_brain: {
    provider: "google_sheets",
    secretKey: "GOOGLE_SHEET_ID_PROJECTS",
    tab: "AI_Brain",
    updateFrequency: "on-demand (chat + manager approval)",
    owner: "SD3 AI System",
    migrateTarget: "postgres", // write-heavy → ưu tiên migrate sang PostgreSQL
  },
  action_trials: {
    provider: "google_sheets",
    secretKey: "GOOGLE_SHEET_ID_PROJECTS",
    tab: "ActionTrials",
    updateFrequency: "on-demand (manager creates/closes)",
    owner: "SD3 Operations",
    migrateTarget: "postgres",
  },
  users: {
    provider: "google_sheets",
    secretKey: "GOOGLE_SHEET_ID_PROJECTS",
    tab: "Users",
    updateFrequency: "on-demand (admin)",
    owner: "GHN SD3 Admin",
    migrateTarget: "postgres",
  },
};

/**
 * Mô tả luồng refresh dữ liệu thô vào hệ thống.
 * Actual implementation nằm ở lib/ltl-snapshot.js → buildLtlSnapshot().
 * Gọi qua API: GET /api/data?force=true hoặc /api/cron/build-snapshot.
 */
export async function refreshRawData() {
  const { buildLtlSnapshot } = await import("../ltl-snapshot");
  return buildLtlSnapshot();
}

/** Danh sách nguồn cần migrate ra khỏi Google Sheets (write-heavy tables). */
export function getMigrationCandidates() {
  return Object.entries(RAW_DATA_SOURCES)
    .filter(([, v]) => v.migrateTarget)
    .map(([name, v]) => ({ name, target: v.migrateTarget, tab: v.tab, secretKey: v.secretKey }));
}
