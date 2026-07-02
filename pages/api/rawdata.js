/**
 * pages/api/rawdata.js
 * Returns compact raw data for client-side transforms.
 * Only needed columns — reduces payload size.
 * Cache-Control header lets CDN cache for 5 minutes.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";
import { fetchSheet } from "../../lib/sheets";

// Only send columns needed by all transforms
const LTL_COLS = [
  "order_code","weight","client_name",
  "from_province_name","from_district_name",
  "to_province_name","to_district_name",
  "status","pickup_time","delivered_time","finish_date","deadline",
  "odr_success","warehouse_lay","warehouse_giao",
  "loai_kho_giao","vung_giao",
  "Tình trạng","Hướng xử lý","Số tiền",
];

function compact(rows, cols) {
  return rows.map(row => {
    const obj = {};
    cols.forEach(c => { if (row[c] !== undefined && row[c] !== null) obj[c] = row[c]; });
    return obj;
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [rawLTL, rawFTL, masterVehicle] = await Promise.all([
      fetchSheet("Raw"),
      fetchSheet("Raw_FTL"),
      fetchSheet("Master data xe"),
    ]);

    // Allow CDN edge cache 5min, stale 10min
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

    return res.status(200).json({
      ok: true,
      ltl:           compact(rawLTL, LTL_COLS),
      ftl:           rawFTL,
      masterVehicle,
    });
  } catch (err) {
    console.error("[/api/rawdata]", err);
    return res.status(500).json({ error: err.message });
  }
}
