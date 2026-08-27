/**
 * pages/api/cron/cache-refresh.js
 * Vercel Cron — chạy 3 lần/ngày: 09:00, 13:00, 18:00 (ICT/UTC+7)
 * = 02:00, 06:00, 11:00 UTC
 *
 * Nhiệm vụ:
 * 1. Flush toàn bộ in-memory cache của sheets.js → data tươi lần fetch kế tiếp
 * 2. Warm-up lại cache bằng cách pre-fetch các sheet nặng (raw_ontime, Raw_FTL...)
 * 3. Log hành động vào audit log
 */
import { clearAllCache, fetchSheet } from "../../../lib/sheets";
import { logAction } from "../../../lib/audit-log";

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
    // ── 1. Flush the entire in-memory sheet cache ───────────────────────────────
    // Previously this looped over hardcoded sheet-name strings and called
    // invalidateCache(name) — but fetchSheet() keys its cache as
    // `sheet:${spreadsheetId}:${sheetName}`, so those calls never matched
    // anything and this cron has been a silent no-op since it was added.
    clearAllCache();

    // ── 2. Warm the cache back up ───────────────────────────────────────────────
    // Previously the comment above promised this but no code did it — every
    // flush left the cache cold until whichever user happened to load the
    // dashboard next ate the full raw_ontime fetch+transform themselves. Now
    // pre-fetch the same sheets /api/data.js needs, right after the flush.
    // Note: this only warms the lambda instance that runs THIS cron
    // invocation — Vercel may route a user's next request to a different
    // instance, so this reduces cold-cache hits but doesn't eliminate them.
    const ltlSheetId = process.env.SHEET_ID_LTL;
    const warmResults = await Promise.allSettled([
      fetchSheet("raw_ontime", ltlSheetId),
      fetchSheet("mapping", ltlSheetId),
      fetchSheet("raw_damage_causes"),
      fetchSheet("raw_compensation_summary"),
    ]);
    const warmedCount = warmResults.filter((r) => r.status === "fulfilled").length;

    // ── 3. Log the refresh ────────────────────────────────────────────────────
    await logAction({
      actor: "cron:cache-refresh",
      action: "cache.flush",
      target: "all",
      details: {
        slot: slotName,
        ictTime: `${String(ictHour).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
        warmedCount,
        totalSheets: warmResults.length,
      },
    }).catch(() => {}); // audit log failure should not block response

    return res.status(200).json({
      ok: true,
      slot: slotName,
      warmedCount,
      totalSheets: warmResults.length,
      message: `Cache refreshed tại ${slotName} ICT — đã warm lại ${warmedCount}/${warmResults.length} sheet`,
    });
  } catch (err) {
    console.error("[/api/cron/cache-refresh] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
