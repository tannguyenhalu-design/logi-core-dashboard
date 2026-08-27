/**
 * pages/api/ftl-caps.js
 * GET: SD3/Manager only — same restriction as the "Số xe sử dụng theo ngày"
 * panel this feeds (see /api/ftl-data), not exposed to CS accounts.
 * POST (upsert/delete via dailyCap<=0): manager-only.
 */
import { getSession } from "../../lib/auth";
import { getAllCaps, upsertCap } from "../../lib/ftl-caps";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role === "cs") {
    return res.status(403).json({ error: "Vai trò CS không có quyền xem cap xe" });
  }

  if (req.method === "GET") {
    try {
      const caps = await getAllCaps();
      return res.status(200).json({ ok: true, caps });
    } catch (err) {
      console.error("[/api/ftl-caps] GET error:", err);
      return res.status(500).json({ error: "Lỗi tải cap xe: " + err.message });
    }
  }

  if (req.method === "POST") {
    if (session.user.role !== "manager") {
      return res.status(403).json({ error: "Chỉ Manager mới có quyền cài đặt cap xe" });
    }
    const { clientName, pickupProvince, vehicleType, dailyCap } = req.body || {};
    if (!clientName || !vehicleType) {
      return res.status(400).json({ error: "Thiếu clientName hoặc vehicleType" });
    }
    try {
      await upsertCap({ clientName, pickupProvince, vehicleType, dailyCap }, session.user.email || session.user.name);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/ftl-caps] POST error:", err);
      return res.status(500).json({ error: "Lỗi lưu cap xe: " + err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
