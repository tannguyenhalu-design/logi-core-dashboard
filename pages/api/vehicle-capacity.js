/**
 * GET /api/vehicle-capacity
 * Trả về dữ liệu sức chứa đội xe, gộp theo vùng.
 * Đọc từ tab KhoGiaoTongTai trong main GOOGLE_SHEET_ID (service account có quyền).
 * Fallback: rawKhoGiaoTongTai từ snapshot blob.
 */
import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { loadLtlBase } from "../../lib/ltl-snapshot";

const numParse = (v) => {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  let raw = [];

  // 1. Đọc trực tiếp từ tab KhoGiaoTongTai (luôn fresh)
  try {
    raw = await fetchSheet("KhoGiaoTongTai");
  } catch (e) {
    console.warn("[vehicle-capacity] fetchSheet failed, fallback to snapshot:", e.message);
  }

  // 2. Fallback: snapshot blob
  if (!raw.length) {
    try {
      const base = await loadLtlBase();
      raw = base?.rawKhoGiaoTongTai || [];
    } catch {
      return res.status(500).json({ ok: false, error: "Không đọc được dữ liệu" });
    }
  }

  if (!raw.length) {
    return res.status(200).json({ ok: true, byVung: {}, total: { warehouses: 0, avgTrucks: 0, avgOrdersGtc: 0, avgTonGtc: 0 } });
  }

  const byVung = {};
  for (const row of raw) {
    const vung = String(row.vung || "").trim() || "Chưa phân vùng";
    const xe  = numParse(row.tb_so_xe);
    const don = numParse(row.tb_don_gtc);
    const kg  = numParse(row.kg_gtc);
    if (!byVung[vung]) byVung[vung] = { warehouses: 0, avgTrucks: 0, avgOrdersGtc: 0, kgGtc: 0 };
    byVung[vung].warehouses++;
    byVung[vung].avgTrucks    += xe;
    byVung[vung].avgOrdersGtc += don;
    byVung[vung].kgGtc        += kg;
  }

  for (const v of Object.values(byVung)) {
    v.avgTrucks    = Math.round(v.avgTrucks * 10) / 10;
    v.avgOrdersGtc = Math.round(v.avgOrdersGtc);
    v.kgGtc        = Math.round(v.kgGtc);
    v.avgTonGtc    = Math.round(v.kgGtc / 1000 * 10) / 10;
  }

  const totalAvgTrucks = Math.round(
    Object.values(byVung).reduce((s, v) => s + v.avgTrucks, 0) * 10
  ) / 10;

  return res.status(200).json({
    ok: true,
    byVung,
    total: {
      warehouses:    raw.length,
      avgTrucks:     totalAvgTrucks,
      avgOrdersGtc:  Math.round(Object.values(byVung).reduce((s, v) => s + v.avgOrdersGtc, 0)),
      avgTonGtc:     Math.round(Object.values(byVung).reduce((s, v) => s + v.avgTonGtc, 0) * 10) / 10,
    },
  });
}
