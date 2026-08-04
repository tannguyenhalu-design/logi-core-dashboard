/**
 * pages/api/cron/backup.js
 * Triggered by Vercel Cron (see vercel.json) — daily snapshot of the
 * Projects spreadsheet. Runs server-side on Vercel, independent of
 * anyone's laptop being on (unlike the KPI sync, which needs a local
 * Chrome session and is a known single point of failure).
 */
import { backupProjectsSheet } from "../../../lib/backup";
import { logAction } from "../../../lib/audit-log";

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await backupProjectsSheet();
    await logAction({
      actor: "cron",
      action: "backup.daily",
      target: result.name,
      details: { fileId: result.id, deletedOldBackups: result.deleted },
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/cron/backup] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
