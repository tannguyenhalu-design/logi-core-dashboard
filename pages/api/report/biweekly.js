/**
 * pages/api/report/biweekly.js — company quality report (Excel), 3 cadences.
 *
 * GET  ?type=week|biweekly|month&period=2026-W38|2026-08
 *        [&version=live|locked] [&format=json]      → .xlsx (or JSON)
 * GET  ?list=1                                     → locked reports
 * POST ?type=…&period=…                            → "Chốt số": store the
 *        current numbers so the same file can be re-downloaded later
 * Manager + SD3 only. Reads the LTL snapshot — does not touch /api/data.
 * (`week=` is still accepted for the biweekly type, the original param.)
 */
import { getSession } from "../../../lib/auth";
import { loadLtlBase } from "../../../lib/ltl-snapshot";
import { computeReport, defaultPeriod, normalizePeriod, REPORT_TYPES } from "../../../lib/biweekly-report";
import { buildBiweeklyWorkbook } from "../../../lib/biweekly-xlsx";
import { saveLock, readLock, listLocks } from "../../../lib/report-locks";
import { logAction } from "../../../lib/audit-log";

export const config = { maxDuration: 60 };

const FILE_PREFIX = { week: "Tuan", biweekly: "2-tuan", month: "Thang" };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!["manager", "sd3"].includes(session.user.role)) {
    return res.status(403).json({ error: "Chỉ Manager và SD3 được xuất báo cáo" });
  }
  const actor = session.user.name || session.user.email;

  try {
    if (req.method === "GET" && req.query.list) {
      return res.status(200).json({ ok: true, locks: await listLocks() });
    }

    const type = String(req.query.type || "biweekly");
    if (!REPORT_TYPES[type]) return res.status(400).json({ error: "type phải là week, biweekly hoặc month" });
    const rawPeriod = req.query.period || req.query.week;
    const period = rawPeriod ? normalizePeriod(type, rawPeriod) : defaultPeriod(type);
    if (!period) return res.status(400).json({ error: type === "month" ? "period phải dạng 2026-08" : "period phải dạng 2026-W38" });

    if (req.method === "POST") {
      const report = computeReport(await loadLtlBase(), { type, period });
      const meta = await saveLock(type, period, report, actor);
      await logAction({ actor, action: "report.lock", target: `${type} ${period}`, details: { dataAsOf: report.dataAsOf } }).catch(() => {});
      return res.status(200).json({ ok: true, lock: meta });
    }
    if (req.method !== "GET") return res.status(405).end();

    let report, lock = null;
    if (req.query.version === "locked") {
      const saved = await readLock(type, period);
      if (!saved) return res.status(404).json({ error: "Kỳ này chưa được chốt số" });
      report = saved.report;
      lock = { lockedAt: saved.lockedAt, lockedBy: saved.lockedBy };
    } else {
      report = computeReport(await loadLtlBase(), { type, period });
    }
    if (req.query.format === "json") return res.status(200).json({ ok: true, report, lock });

    const buf = await buildBiweeklyWorkbook(report, lock);
    logAction({ actor, action: "report.export", target: `${type} ${period}${lock ? " (đã chốt)" : ""}` }).catch(() => {});
    const name = `Bao-cao-Dien-may-${FILE_PREFIX[type]}-${period}${lock ? "-da-chot" : ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    console.error("[/api/report/biweekly] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
