/**
 * pages/api/report/biweekly.js — bi-weekly company report (Excel).
 * GET ?week=2026-W37 (default: last completed ISO week) → .xlsx download;
 * &format=json returns the computed tables (preview / cross-checking).
 * Manager + SD3 only. Reads the LTL snapshot — does not touch /api/data.
 */
import { getSession } from "../../../lib/auth";
import { loadLtlBase } from "../../../lib/ltl-snapshot";
import { computeBiweekly, mondayOfIsoWeek, lastCompletedWeekMonday } from "../../../lib/biweekly-report";
import { buildBiweeklyWorkbook } from "../../../lib/biweekly-xlsx";
import { logAction } from "../../../lib/audit-log";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!["manager", "sd3"].includes(session.user.role)) {
    return res.status(403).json({ error: "Chỉ Manager và SD3 được xuất báo cáo" });
  }

  const endMonday = req.query.week ? mondayOfIsoWeek(req.query.week) : lastCompletedWeekMonday();
  if (!endMonday) return res.status(400).json({ error: "Tham số week không hợp lệ (vd 2026-W37)" });

  try {
    const base = await loadLtlBase();
    const report = computeBiweekly(base, endMonday);
    if (req.query.format === "json") return res.status(200).json({ ok: true, report });

    const buf = await buildBiweeklyWorkbook(report);
    logAction({ actor: session.user.name || session.user.email, action: "report.biweekly", target: report.endWeek }).catch(() => {});
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Bao-cao-Dien-may-${report.endWeek}.xlsx"`);
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    console.error("[/api/report/biweekly] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
