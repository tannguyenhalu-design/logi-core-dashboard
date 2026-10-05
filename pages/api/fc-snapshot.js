/**
 * pages/api/fc-snapshot.js
 * Lưu / đọc snapshot Forecast trước event (tính năng "Chốt FC").
 *
 * GET  ?date=YYYY-MM-DD            → trả về snapshot đã chốt (hoặc null)
 * POST { date, dm1O, d0O, dp1O,   → ghi snapshot vào Blob
 *        dm1W, d0W, dp1W,
 *        clientAvg? }
 *
 * Dữ liệu lưu trong Vercel Blob:  "campaign-fc-snapshots.json"
 * Format: { "YYYY-MM-DD": { dm1O, d0O, dp1O, dm1W, d0W, dp1W, clientAvg, savedAt } }
 */
import { getSession } from "../../lib/auth";
import { list, put, head } from "@vercel/blob";

const BLOB_NAME = "campaign-fc-snapshots.json";

async function loadSnapshots() {
  try {
    const { blobs } = await list({ prefix: BLOB_NAME });
    if (!blobs.length) return {};
    const res = await fetch(blobs[0].url);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function saveSnapshots(data) {
  await put(BLOB_NAME, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    const { date } = req.query;
    const all = await loadSnapshots();
    if (date) return res.status(200).json({ ok: true, snapshot: all[date] || null });
    return res.status(200).json({ ok: true, snapshots: all }); // trả về tất cả khi không có date
  }

  if (req.method === "POST") {
    const { date, dm1O, d0O, dp1O, dm1W, d0W, dp1W, clientAvg } = req.body;
    if (!date) return res.status(400).json({ error: "date required" });
    const all = await loadSnapshots();
    all[date] = {
      dm1O: dm1O || 0, d0O: d0O || 0, dp1O: dp1O || 0,
      dm1W: dm1W || 0, d0W: d0W || 0, dp1W: dp1W || 0,
      clientAvg: clientAvg || {},
      savedAt: new Date().toISOString(),
      savedBy: session.user.email || session.user.name || "unknown",
    };
    await saveSnapshots(all);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
