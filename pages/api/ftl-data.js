/**
 * pages/api/ftl-data.js
 * GET /api/ftl-data?clients=A,B&dateFrom=2026-08-01&dateTo=2026-08-16&address=...
 * Điện Máy FTL orders, read from "raw_ftl_orders". Separate endpoint from
 * /api/data since it refreshes on its own (much faster) cadence — see
 * cloud-scraper/sync_ftl_order_sheet.js for how that sheet gets populated
 * (manually, from GHN tech's own export — no more portal.ghn.vn scraping).
 */
import { getSession } from "../../lib/auth";
import { fetchSheet, getCached, setCached } from "../../lib/sheets";
import { transformFTLLive } from "../../lib/transform-ftl-live";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getSession(req, res);
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const clients = req.query.clients
    ? String(req.query.clients).split(",").filter(Boolean)
    : null;
  const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : null;
  const dateTo = req.query.dateTo ? String(req.query.dateTo).trim() : null;
  const address = req.query.address ? String(req.query.address).trim() : null;

  try {
    const cacheKey = "ftl:raw_ftl_orders";
    let rawRows = getCached(cacheKey);
    if (!rawRows) {
      rawRows = await fetchSheet("raw_ftl_orders").catch(() => []);
      setCached(cacheKey, rawRows, 3 * 60 * 1000); // 3 min — short, since source refreshes every 30 min anyway
    }

    const data = transformFTLLive(rawRows, { clients, dateFrom, dateTo, address });

    // "Số xe sử dụng theo ngày" (capacity planning: daily fleet stats + cap
    // evaluation) is SD3/Manager-internal per user instruction (2026-08-20)
    // — stripped server-side, not just hidden in the UI, so a CS account
    // can't see it by reading the API response directly either.
    if (session.user.role === "cs") {
      delete data.dailyVehicleStats;
      delete data.dailyVehicleStatsByProvince;
      delete data.dailyVehicleStatsByRegion;
      delete data.dailyVehicleStatsOverall;
      delete data.dailyVehicleTypes;
      delete data.totalDaysInRange;
    }

    // "Đích giao hàng theo khách" (tỉnh/địa chỉ giao phổ biến nhất + loại
    // xe) là dữ liệu nội bộ SD3 — theo yêu cầu người dùng (2026-08-25) chỉ
    // SD3/Manager mới xem được, stripped server-side như các trường
    // SD3-only khác ở trên chứ không chỉ ẩn ở UI.
    if (session.user.role !== "manager" && session.user.role !== "sd3") {
      delete data.destinationBreakdown;
    }

    return res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error("[/api/ftl-data] Error:", err);
    return res.status(500).json({ error: "Lỗi tải dữ liệu FTL: " + err.message });
  }
}
