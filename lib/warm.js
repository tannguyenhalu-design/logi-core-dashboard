/**
 * lib/warm.js — keep-warm pings (Kế hoạch A · P5, 28/09).
 * A Vercel function that nobody called for a while starts cold: the first
 * click then waits 1–5s (function start + loading googleapis/blob + reading
 * the snapshot). cloud-scraper/keep_warm.sh (Railway cron, every 5 minutes
 * 07:00–20:00 VN) calls the main routes with ?warm=1 and the shared
 * SNAPSHOT_SECRET header; each route then only loads what its first real
 * request would need and answers { ok } — no data, no session, no writes.
 */
export function isWarmPing(req) {
  const secret = process.env.SNAPSHOT_SECRET;
  return req.query?.warm === "1" && !!secret && req.headers["x-snapshot-secret"] === secret;
}

export async function answerWarm(res, work) {
  const started = Date.now();
  res.setHeader("Cache-Control", "private, no-store");
  try {
    await work();
    return res.status(200).json({ ok: true, warm: true, ms: Date.now() - started });
  } catch (err) {
    return res.status(500).json({ ok: false, warm: true, error: err.message });
  }
}
