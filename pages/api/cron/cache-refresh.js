/**
 * pages/api/cron/cache-refresh.js
 * Vercel Cron — chạy 3 lần/ngày: 09:00, 13:00, 18:00 (ICT/UTC+7)
 * = 02:00, 06:00, 11:00 UTC
 *
 * Nhiệm vụ:
 * 1. Flush toàn bộ in-memory cache của sheets.js → data tươi lần fetch kế tiếp
 * 2. Warm-up cache bằng cách pre-fetch /api/data (không cần session — dùng internal key)
 * 3. Log hành động vào audit log
 */
import { invalidateCache } from "../../../lib/sheets";
import { logAction } from "../../../lib/audit-log";

// Danh sách cache keys pattern cần flush
const CACHE_PATTERNS = [
  "raw_ontime",
  "Raw_FTL",
  "Master data xe",
  "raw_damage",
  "mapping",
  "Data dự án",
  "AI_Brain",
];

export default async function handler(req, res) {
  // Chỉ cho phép Vercel Cron (Bearer token) hoặc internal call
  const auth = req.headers.authorization;
  const isVercelCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isInternalCall = req.headers["x-internal-refresh"] === process.env.CRON_SECRET;

  if (!process.env.CRON_SECRET || (!isVercelCron && !isInternalCall)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const ictHour = (now.getUTCHours() + 7) % 24; // giờ ICT
  const slotName =
    ictHour < 10 ? "09:00" :
    ictHour < 14 ? "13:00" : "18:00";

  try {
    // ── 1. Flush all known sheet caches ───────────────────────────────────────
    let flushedCount = 0;
    for (const key of CACHE_PATTERNS) {
      invalidateCache(key);
      flushedCount++;
    }

    // ── 2. Log the refresh ────────────────────────────────────────────────────
    await logAction({
      actor: "cron:cache-refresh",
      action: "cache.flush",
      target: `${flushedCount} sheets`,
      details: {
        slot: slotName,
        ictTime: `${String(ictHour).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
        flushedKeys: CACHE_PATTERNS,
      },
    }).catch(() => {}); // audit log failure should not block response

    return res.status(200).json({
      ok: true,
      slot: slotName,
      flushed: flushedCount,
      message: `Cache refreshed tại ${slotName} ICT — data sẽ được kéo tươi lần tải kế tiếp`,
    });
  } catch (err) {
    console.error("[/api/cron/cache-refresh] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
