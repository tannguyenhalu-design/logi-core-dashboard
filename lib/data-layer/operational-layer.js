/**
 * lib/data-layer/operational-layer.js — Operational Data Layer
 *
 * Tầng vận hành: transform dữ liệu thô → Snapshot được lưu trên Vercel Blob,
 * phục vụ Dashboard real-time và các AI agents (Tiểu Đệ SD3).
 *
 * Delegates to lib/ltl-snapshot.js (current implementation).
 * Future: có thể thêm Redis cache layer giữa Blob và Dashboard.
 *
 * Data flow:
 *   Raw (Google Sheets) → buildSnapshot() → Vercel Blob
 *   Dashboard / AI Chat → loadBase() / loadDefaultBody() ← Vercel Blob
 */

// Re-export snapshot management functions với tên chuẩn layer
export {
  buildLtlSnapshot as buildSnapshot,
  loadLtlBase     as loadBase,
  loadDefaultBody,
} from "../ltl-snapshot";

/**
 * Snapshot health metadata.
 * `loadBase()` trả về object có `builtAt` (ISO timestamp) và `ltlRows.length`.
 * Hàm này tính các thông tin health của snapshot cho monitoring.
 */
export async function getSnapshotHealth() {
  const { loadLtlBase } = await import("../ltl-snapshot");
  try {
    const base = await loadLtlBase();
    const builtAt = base?.builtAt || null;
    const ageMs = builtAt ? Date.now() - Date.parse(builtAt) : null;
    const ageHours = ageMs != null ? Math.round(ageMs / 36e5 * 10) / 10 : null;
    return {
      ok: !!builtAt,
      builtAt,
      ageHours,
      stale: ageHours != null && ageHours > 24,
      rowCount: base?.ltlRows?.length || 0,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Operational layer config: describes the storage backend.
 * Current: Vercel Blob (@vercel/blob). Future: replace with S3 / R2 / Supabase Storage.
 */
export const OPERATIONAL_STORAGE = {
  provider: "vercel_blob",
  snapshotKey: "ltl-snapshot.json",
  defaultBodyKey: "ltl-default-body.json",
  ttlHours: 8,
  rebuildTriggers: ["cron 3x/day", "force=true param", "Apps Script sync"],
};
