/**
 * pages/api/tachtrip.js
 * Bản đồ & Tách Chuyến — reuses the same "raw_ontime" LTL sheet as
 * /api/rawdata, mapped into the shape lib/transform-tach-trip.js expects.
 */
import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { isDMClient } from "../../lib/dm-clients";
import { transformTachTrip } from "../../lib/transform-tach-trip";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("tachtrip")) {
    return res.status(403).json({ error: "Bạn không có quyền xem Tách Chuyến" });
  }

  try {
    const ltlSheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";
    const rawOntime = await fetchSheet("raw_ontime", ltlSheetId);

    const mapped = rawOntime
      .filter((r) => isDMClient(r["client_name"]))
      .map((row) => ({
        client_name: row["client_name"],
        from_province_name: row["from_province_name"],
        to_province_name: row["to_province_name"],
        status: row["status"],
        pickup_time: row["pickup_time"],
        weight: row["weight"],
        warehouse_lay: row["kho_lay"],
        warehouse_giao: row["kho_giao"],
      }));

    const tcData = transformTachTrip(mapped);

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    return res.status(200).json({ ok: true, tcData });
  } catch (err) {
    console.error("[/api/tachtrip]", err);
    return res.status(500).json({ error: err.message });
  }
}
