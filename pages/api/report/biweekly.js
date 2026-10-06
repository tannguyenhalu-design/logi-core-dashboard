/**
 * pages/api/report/biweekly.js — company quality report (Excel), 3 cadences.
 *
 * GET  ?type=week|biweekly|month&period=2026-W38|2026-08
 *        [&version=live|locked] [&format=json]      → .xlsx (or JSON)
 *        [&clients=LG LTL|Aqua B2C]                 → only these clients,
 *        total row "Tổng khách đã chọn" (omit = full layout)
 *        [&format=json&lite=1]  → same JSON without `details` (the drill-down
 *        lists — ~90% of the size); the tab loads them with &part=details
 *        only when a cell is clicked (Kế hoạch A · P7, 28/09). Plain
 *        format=json stays complete (script lock_and_verify.cjs reads it).
 * GET  ?list=1 [&fresh=1]                          → locked reports
 * POST ?type=…&period=…                            → "Chốt số": store the
 *        current numbers so the same file can be re-downloaded later
 *        [&cv=<version>]  config version the tab just saved → re-read it
 * Manager + SD3 only. Reads the LTL snapshot — does not touch /api/data.
 * Rows are grouped by the "Cài đặt kênh khách hàng" config (lib/client-channels.js);
 * computed reports are cached in memory per snapshot + config version.
 * (`week=` is still accepted for the biweekly type, the original param.)
 */
import { getSession } from "../../../lib/auth";
import { loadLtlBase, loadAllBase } from "../../../lib/ltl-snapshot";
import { computeReport, defaultPeriod, normalizePeriod, normalizeClients, REPORT_TYPES } from "../../../lib/biweekly-report";
import { clientKey, KNOWN_INDUSTRIES } from "../../../lib/client-industry";
import { saveLock, readLock, listLocks } from "../../../lib/report-locks";
import { logAction } from "../../../lib/audit-log";
import { readClientChannels } from "../../../lib/client-channels";
import { reportCacheKey, getCachedReport, setCachedReport } from "../../../lib/report-cache";
import { isWarmPing, answerWarm } from "../../../lib/warm";

export const config = { maxDuration: 60 };

const FILE_PREFIX = { week: "Tuan", biweekly: "2-tuan", month: "Thang" };

const INDUSTRY_LABELS = { STTP: "STTP", NHC: "NHC", ECOM: "Ecom" };
const INDUSTRY_TOTAL = { STTP: "Tổng STTP", NHC: "Tổng NHC", ECOM: "Tổng Ecom", "STTP+NHC": "Tổng STTP + NHC" };

// Resolve industry for one row: nganh_hang field first, then clientIndustryMap.
function rowIndustry(row, cim) {
  const ng = String(row.nganh_hang || "").trim().toUpperCase();
  if (KNOWN_INDUSTRIES.includes(ng)) return ng;
  return cim.get(clientKey(row.client_name)) || "OTHER";
}

// Latest numbers, grouped by the current channel config (cached per instance).
async function liveReport(type, period, clients, minVersion, industry) {
  let base, channelsVersion, channelCfg;
  if (!industry || industry === "DM") {
    const [b, { config, version }] = await Promise.all([loadLtlBase(), readClientChannels({ minVersion })]);
    base = b; channelCfg = config; channelsVersion = version;
  } else {
    const [allBase, { config, version }] = await Promise.all([loadAllBase(), readClientChannels({ minVersion })]);
    if (!allBase) throw new Error("Snapshot ngành hàng chưa được build — vui lòng đồng bộ Google Sheet.");
    const targets = new Set(industry === "STTP+NHC" ? ["STTP", "NHC"] : [industry.toUpperCase()]);
    const cim = allBase.clientIndustryMap;
    base = {
      ...allBase,
      ltlRows: allBase.ltlRows.filter((r) => targets.has(rowIndustry(r, cim))),
    };
    channelsVersion = version;
    // Non-DM industries: auto-generate a per-client channelConfig so every client
    // gets its own row in the Ontime / Hàng hoàn tables (sorted by order volume).
    // Channel (B2B/B2C) is intentionally left unset — resolveChannels() will
    // derive it from each client's is_B2C majority in the actual orders.
    const clientVol = {};
    for (const r of base.ltlRows) {
      const name = String(r.client_name || "").trim();
      if (name) clientVol[name] = (clientVol[name] || 0) + 1;
    }
    channelCfg = Object.fromEntries(
      Object.keys(clientVol)
        .sort((a, b) => clientVol[b] - clientVol[a])
        .slice(0, 10)
        .map((name, i) => [name, { ownOntime: true, ownFd: true, order: i + 1 }])
    );
  }
  const industryConfig = !industry || industry === "DM" ? null : {
    totalLabel: INDUSTRY_TOTAL[industry.toUpperCase()] || `Tổng ${industry}`,
    baseDamageClients: [],
    hasDamage: industry.toUpperCase() !== "ECOM",
  };
  const now = Date.now();
  const key = reportCacheKey({ builtAt: base.builtAt, version: channelsVersion, type, period, clients, industry: industry || "DM", now });
  const hit = getCachedReport(key);
  if (hit) return hit;
  const report = { ...computeReport(base, { type, period, clients, channelConfig: channelCfg, industryConfig }, now), channelsVersion: channelsVersion || null };
  setCachedReport(key, report);
  return report;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (isWarmPing(req)) {
    // Snapshot + channel config + lock list in memory, and the default
    // report (what the tab opens on) computed into the report cache.
    return answerWarm(res, async () => {
      await Promise.all([liveReport("biweekly", defaultPeriod("biweekly"), null, ""), listLocks({ fresh: true })]);
    });
  }
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!["manager", "sd3"].includes(session.user.role)) {
    return res.status(403).json({ error: "Chỉ Manager và SD3 được xuất báo cáo" });
  }
  const actor = session.user.name || session.user.email;

  try {
    if (req.method === "GET" && req.query.list) {
      return res.status(200).json({ ok: true, locks: await listLocks({ fresh: req.query.fresh === "1" }) });
    }

    const type = String(req.query.type || "biweekly");
    if (!REPORT_TYPES[type]) return res.status(400).json({ error: "type phải là week, biweekly hoặc month" });
    const rawPeriod = req.query.period || req.query.week;
    const period = rawPeriod ? normalizePeriod(type, rawPeriod) : defaultPeriod(type);
    if (!period) {
      return res.status(400).json({ error: type === "month" ? "period phải dạng 2026-08"
        : type === "biweekly" ? "Kỳ 2 tuần phải kết thúc ở tuần lẻ, vd 2026-W39 (= W38–W39, báo cáo W40)" : "period phải dạng 2026-W38" });
    }
    const clients = normalizeClients(req.query.clients);
    const cv = String(req.query.cv || "");
    // ?industry=STTP|NHC|ECOM|STTP+NHC (omit or "DM" = Điện Máy, existing behavior)
    const rawInd = String(req.query.industry || "").trim().toUpperCase();
    const industry = rawInd && rawInd !== "DM" ? rawInd : null;

    if (req.method === "POST") {
      const report = await liveReport(type, period, clients, cv, industry);
      const meta = await saveLock(type, period, report, actor);
      await logAction({ actor, action: "report.lock", target: `${type} ${period}`, details: { dataAsOf: report.dataAsOf, clients: clients || "mẫu đầy đủ" } }).catch(() => {});
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
      report = await liveReport(type, period, clients, cv, industry);
    }
    if (req.query.format === "json") {
      if (req.query.part === "details") return res.status(200).json({ ok: true, dataAsOf: report.dataAsOf || null, details: report.details || null });
      if (req.query.lite === "1") {
        const { details: _d, ...lite } = report;
        return res.status(200).json({ ok: true, report: { ...lite, hasDetails: !!report.details }, lock });
      }
      return res.status(200).json({ ok: true, report, lock });
    }

    // exceljs (~0.3s to load) only when a file is actually downloaded.
    const { buildBiweeklyWorkbook } = await import("../../../lib/biweekly-xlsx");
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
