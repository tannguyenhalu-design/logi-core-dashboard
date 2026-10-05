/**
 * pages/api/cron/backup-raw-ontime.js
 * Cron hàng ngày: backup incremental raw_ontime → Google Sheet riêng.
 *
 * Vercel Cron: chạy lúc 2:00 UTC (9:00 sáng VN) — sau khi scraper sync xong.
 *
 * Query params (dùng để trigger thủ công):
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  — backfill khoảng ngày cụ thể
 *   ?full=1                          — full sync toàn bộ (lần đầu setup)
 */
import { backupRawOntimeDelta } from "../../../lib/backup-raw-ontime";
import { logAction } from "../../../lib/audit-log";

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { from, to, full } = req.query;

  try {
    const result = await backupRawOntimeDelta({
      from: from || null,
      to: to || null,
      forceAll: full === "1",
    });

    await logAction({
      actor: "cron",
      action: "backup.raw_ontime",
      target: `raw_ontime_backup`,
      details: result,
    }).catch(() => {}); // log fail không chặn response

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/cron/backup-raw-ontime] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
