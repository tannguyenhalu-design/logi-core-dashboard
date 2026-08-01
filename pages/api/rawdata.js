/**
 * pages/api/rawdata.js
 * Returns compact raw data for client-side transforms.
 * Only needed columns — reduces payload size.
 * Cache-Control header lets CDN cache for 5 minutes.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";
import { fetchSheet } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const ltlSheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";

    const [rawOntime, rawDamage] = await Promise.all([
      fetchSheet("raw_ontime", ltlSheetId),
      fetchSheet("raw_damage", ltlSheetId),
    ]);

    // Build a map for damage cases by order_code
    const damageMap = new Map();
    rawDamage.forEach(row => {
      const code = String(row["order_code"] || "").trim();
      if (code) {
        damageMap.set(code, row);
      }
    });

    // Merge raw_damage into raw_ontime to maintain backward compatibility
    const mergedLTL = rawOntime.map(row => {
      const orderCode = String(row["order_code"] || "").trim();
      const dmg = damageMap.get(orderCode);

      let statusDamage = "";
      let compensationAmount = 0;
      let handling = "";

      if (dmg) {
        statusDamage = String(dmg["damage_type"] || "").trim();
        const statusStr = String(dmg["case_status"] || "").trim();
        const isNumber = /^[0-9.,]+$/.test(statusStr);
        const cleaned = statusStr.replace(/[.,]/g, "");
        const num = parseFloat(cleaned);

        if (!isNaN(num) && num > 0) {
          compensationAmount = num;
          handling = "Đền bù";
        } else if (statusStr.includes("Đền bù") || statusStr.includes("đền bù")) {
          handling = "Đền bù";
        } else {
          const reason = String(dmg["qlrr_reason"] || "").trim();
          if (reason.length > 0) {
            handling = "Đã xử lý (không đền bù)";
          } else {
            handling = "Chưa xử lý";
          }
        }
      }

      return {
        order_code:          orderCode,
        weight:              row["weight"],
        client_name:         row["client_name"],
        from_province_name:  row["from_province_name"],
        from_district_name:  row["from_district_name"],
        to_province_name:    row["to_province_name"],
        to_district_name:    row["to_district_name"],
        status:              row["status"],
        pickup_time:         row["pickup_time"],
        delivered_time:      row["delivered_time"],
        finish_date:         row["finish_date"],
        deadline:            row["deadline_plus"], // Map deadline_plus to deadline
        odr_success:         row["odr_success"],
        warehouse_lay:       row["kho_lay"],       // Map kho_lay to warehouse_lay
        warehouse_giao:      row["kho_giao"],      // Map kho_giao to warehouse_giao
        loai_kho_giao:       row["loai_kho_giao"] || null,
        vung_giao:           row["vung_giao"] || null,
        "Tình trạng":        statusDamage,
        "Hướng xử lý":        handling,
        "Số tiền":           compensationAmount,
      };
    });

    // Disable Edge CDN caching to force fresh data load
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");

    return res.status(200).json({
      ok: true,
      ltl:           mergedLTL,
      damage:        rawDamage,
    });
  } catch (err) {
    console.error("[/api/rawdata]", err);
    return res.status(500).json({ error: err.message });
  }
}
