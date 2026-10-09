/**
 * POST /api/sync/kho-cleartime
 * Nhận data clearTime từ Apps Script (tannt@ghn.vn), lưu vào Vercel Blob,
 * rồi build lại snapshot LTL để bản đồ kho có số mới ngay.
 * Auth: Bearer CRON_SECRET (same secret as build-snapshot).
 *
 * Body: JSON array of objects with keys matching "anh Tân" sheet headers:
 *   "ID kho", "kho_giao", "backlog lastmile", "backlog ktc",
 *   "đơn tạo N-1", "max gtc (L7D)", "tb gtc (L7D)"
 */
import { put } from "@vercel/blob";
import { buildLtlSnapshot } from "../../../lib/ltl-snapshot";
import { logAction } from "../../../lib/audit-log";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let rows;
  try {
    rows = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Body must be array" });

  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), rows });
  await put("sync/kho-cleartime.json", Buffer.from(payload), {
    access: "private", allowOverwrite: true, contentType: "application/json",
  });
  console.log("[kho-cleartime] synced", rows.length, "rows at", new Date().toISOString());

  // The sync itself already succeeded; a failed rebuild is reported, not thrown.
  const started = Date.now();
  let snapshot;
  try {
    const stats = await buildLtlSnapshot();
    snapshot = { ok: true, builtAt: stats.builtAt, tookMs: Date.now() - started };
    await logAction({
      actor: "snapshot:kho-cleartime",
      action: "snapshot.build",
      target: "ltl",
      details: { ...stats, tookMs: snapshot.tookMs },
    }).catch(() => {});
  } catch (err) {
    console.error("[kho-cleartime] snapshot rebuild failed:", err);
    snapshot = { ok: false, error: err.message };
  }

  return res.json({ ok: true, rows: rows.length, snapshot });
}
