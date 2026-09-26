/**
 * lib/system-health.js — data-source health for the "Trạng thái hệ thống" page.
 *
 * Two signals, because neither alone is enough (SYSTEM_SPEC incident #19):
 *  - heartbeat: cloud-scraper/report_health.py posts each run's per-step
 *    result (ok / session_expired / error) → private Blob. Tells us "Rillnet
 *    session expired at 12:50" precisely.
 *  - freshness: what the data itself says (snapshot age, newest pickup date,
 *    newest damage sync) — catches a scraper that stopped reporting at all.
 */
import { put, get } from "@vercel/blob";
import { loadLtlBase, getBaseBlobBytes } from "./ltl-snapshot";
import { parseDate } from "./transform-ltl";

const HEARTBEAT_PATH = "health/scraper-status.json";
const HISTORY_LIMIT = 30;
const STEP_NAMES = ["raw_ontime", "rillnet", "kpi"];
const H = 3600 * 1000;

// Thresholds (user decision 2026-09-26: a source is "đứng hình" after 24h).
export const STALE_MS = 24 * H;
// Cron runs 08:50/12:50/17:50 VN — the longest normal gap is ~15h overnight.
const SCRAPER_SILENT_MS = 16 * H;

// Heartbeats arrive 3×/day; a 30s per-instance cache keeps the page fast.
let hbCache = { value: null, at: 0 };
async function readHeartbeat({ fresh = false } = {}) {
  if (!fresh && Date.now() - hbCache.at < 30 * 1000) return hbCache.value;
  let value = null;
  try {
    const res = await get(HEARTBEAT_PATH, { access: "private", useCache: false });
    if (res && res.stream) value = JSON.parse(await new Response(res.stream).text());
  } catch {
    value = null;
  }
  hbCache = { value, at: Date.now() };
  return value;
}

export async function recordHeartbeat(payload) {
  const now = new Date().toISOString();
  const prev = (await readHeartbeat({ fresh: true })) || { steps: {}, history: [] };
  const steps = { ...prev.steps };
  for (const s of payload.steps || []) {
    if (!STEP_NAMES.includes(s.name)) continue;
    const before = steps[s.name] || {};
    steps[s.name] = {
      last: { ...s, at: now },
      lastOkAt: s.status === "ok" ? now : before.lastOkAt || null,
      lastOkCount: s.status === "ok" ? s.count ?? null : before.lastOkCount ?? null,
      // first failure of the current streak — "hết phiên từ lúc nào"
      failingSince: s.status === "ok" ? null : before.failingSince || now,
    };
  }
  const history = [
    { at: now, runStartedAt: payload.runStartedAt || null, steps: (payload.steps || []).map((s) => ({ name: s.name, status: s.status, sourceRows: s.sourceRows ?? null, count: s.count ?? null })) },
    ...(prev.history || []),
  ].slice(0, HISTORY_LIMIT);
  const next = { updatedAt: now, steps, history };
  await put(HEARTBEAT_PATH, JSON.stringify(next), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
  });
  hbCache = { value: next, at: Date.now() };
  return next;
}

// Newest date, ignoring future ones: a few legacy Rillnet rows (synced
// 31/08) have day/month swapped, e.g. "2026-12-08" for 12/08.
const maxDate = (values) => {
  const limit = Date.now() + 24 * H;
  let best = null;
  for (const v of values) {
    const d = parseDate(v);
    if (d && d.getTime() <= limit && (!best || d > best)) best = d;
  }
  return best;
};

// Scanning 35k rows is cheap but not free — once per snapshot per instance.
let factsMemo = { builtAt: null, facts: null };
function snapshotFacts(base) {
  if (!base) return {};
  if (factsMemo.builtAt === base.builtAt) return factsMemo.facts;
  const damage = base.rawDamageCauses || [];
  const facts = {
    newestPickup: maxDate(base.ltlRows.map((r) => r.pickup_time)),
    newestDamageSync: maxDate(damage.map((r) => r.synced_at)),
    newestCase: maxDate(damage.map((r) => r.case_date)),
    totalCases: damage.length,
  };
  factsMemo = { builtAt: base.builtAt, facts };
  return facts;
}
const ageMs = (iso) => (iso ? Date.now() - new Date(iso).getTime() : null);

function stepVerdict(step, { paused = false } = {}) {
  if (!step?.last) return { level: "unknown", reason: "Chưa nhận được báo cáo từ scraper" };
  const { status, message } = step.last;
  if (status === "ok") {
    if (ageMs(step.lastOkAt) > STALE_MS) return { level: "red", reason: "Lần đồng bộ thành công gần nhất đã quá 24 giờ" };
    return { level: "green", reason: "Đồng bộ bình thường" };
  }
  if (paused) return { level: "paused", reason: "Đang tạm dừng theo chỉ đạo (pending)" };
  if (status === "session_expired") return { level: "red", reason: "Phiên đăng nhập đã hết hạn — cần đăng nhập lại qua noVNC", detail: message };
  if (status === "not_run") return { level: "yellow", reason: "Bước này không chạy trong lần gần nhất" };
  return { level: "red", reason: "Lỗi khi chạy", detail: message };
}

export async function getSystemHealth() {
  const [hb, base] = await Promise.all([readHeartbeat(), loadLtlBase().catch(() => null)]);
  const { newestPickup, newestDamageSync, newestCase, totalCases } = snapshotFacts(base);
  const steps = hb?.steps || {};

  // ── raw_ontime
  const rawStep = steps.raw_ontime;
  const rawVerdict = stepVerdict(rawStep);
  // Source row count unchanged across every run in the last 24h → the GHN
  // sheet itself stopped growing (our pipeline is fine, the source isn't).
  const recentRuns = (hb?.history || []).filter((h) => ageMs(h.at) <= STALE_MS)
    .map((h) => h.steps.find((s) => s.name === "raw_ontime")?.sourceRows).filter((n) => n != null);
  const sourceFrozen = recentRuns.length >= 3 && recentRuns.every((n) => n === recentRuns[0]);
  if (rawVerdict.level === "green" && sourceFrozen) {
    rawVerdict.level = "yellow";
    rawVerdict.reason = `Sheet nguồn GHN không có dòng mới trong 24 giờ (${recentRuns.length} lần chạy đều ${recentRuns[0]} dòng) — hỏi bên quản lý sheet`;
  }

  // ── Rillnet
  const rilVerdict = stepVerdict(steps.rillnet);

  // ── KPI portal — pending per user instruction (2026-09-17)
  const kpiVerdict = stepVerdict(steps.kpi, { paused: true });

  // ── Snapshot
  const snapAge = ageMs(base?.builtAt);
  const snapVerdict = !base
    ? { level: "red", reason: "Không đọc được snapshot" }
    : snapAge > STALE_MS
      ? { level: "red", reason: "Snapshot đã quá 24 giờ chưa dựng lại" }
      : { level: "green", reason: "Snapshot hợp lệ" };

  // ── Scraper process itself
  const scraperAge = ageMs(hb?.updatedAt);
  const scraperVerdict = !hb
    ? { level: "unknown", reason: "Chưa nhận được báo cáo nào (heartbeat mới bật từ 26/09)" }
    : scraperAge > SCRAPER_SILENT_MS
      ? { level: "red", reason: "Scraper không báo cáo quá 16 giờ — có thể container trên Railway đã dừng" }
      : { level: "green", reason: "Scraper chạy đúng lịch" };

  const sources = [
    {
      key: "scraper", name: "Scraper (Railway)", ...scraperVerdict,
      facts: { lastReportAt: hb?.updatedAt || null, schedule: "08:50 · 12:50 · 17:50 (giờ VN)" },
    },
    {
      key: "raw_ontime", name: "Nguồn LTL (raw_ontime)", ...rawVerdict,
      facts: {
        lastSyncedAt: rawStep?.lastOkAt || null,
        totalRows: rawStep?.lastOkCount ?? base?.sourceRowCount ?? null,
        sourceRows: rawStep?.last?.sourceRows ?? null,
        ltlRows: base?.ltlRows.length ?? null,
        newestPickupDate: newestPickup ? newestPickup.toISOString().slice(0, 10) : null,
        failingSince: rawStep?.failingSince || null,
      },
    },
    {
      key: "rillnet", name: "Rillnet (hư hỏng)", ...rilVerdict,
      facts: {
        lastSyncedAt: steps.rillnet?.lastOkAt || (newestDamageSync ? newestDamageSync.toISOString() : null),
        lastCaseCount: steps.rillnet?.lastOkCount ?? null,
        totalCases: totalCases ?? null,
        newestCaseDate: newestCase ? newestCase.toISOString().slice(0, 10) : null,
        failingSince: steps.rillnet?.failingSince || null,
      },
    },
    {
      key: "kpi", name: "KPI portal (doanh thu)", ...kpiVerdict,
      facts: { lastSyncedAt: steps.kpi?.lastOkAt || null, failingSince: steps.kpi?.failingSince || null },
    },
    {
      key: "snapshot", name: "Snapshot dữ liệu (Vercel Blob)", ...snapVerdict,
      facts: {
        builtAt: base?.builtAt || null,
        sizeBytes: getBaseBlobBytes(),
        ltlRows: base?.ltlRows.length ?? null,
        sourceRows: base?.sourceRowCount ?? null,
      },
    },
  ];

  const order = { red: 0, yellow: 1, unknown: 2, paused: 3, green: 4 };
  const worst = sources.reduce((w, s) => (order[s.level] < order[w] ? s.level : w), "green");
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    overall: worst,
    alertCount: sources.filter((s) => s.level === "red" || s.level === "yellow").length,
    sources,
    history: (hb?.history || []).slice(0, 10),
  };
}
