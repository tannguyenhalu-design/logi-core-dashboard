/**
 * pages/api/rawdata.js
 * Returns compact raw data for client-side transforms.
 * Only needed columns — reduces payload size.
 * Cache-Control header lets CDN cache for 5 minutes.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";
import { fetchSheet } from "../../lib/sheets";
import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const ltlSheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";
    const backupPath = path.join(process.cwd(), "lib", "backup-data.json");

    let rawOntime = [];
    let rawDamage = [];

    try {
      const [ontimeSheet, damageSheet] = await Promise.all([
        fetchSheet("raw_ontime", ltlSheetId),
        fetchSheet("raw_damage", ltlSheetId),
      ]);

      if (ontimeSheet && ontimeSheet.length > 10) {
        rawOntime = ontimeSheet;
        rawDamage = damageSheet;

        // Save local backup asynchronously
        try {
          fs.writeFileSync(backupPath, JSON.stringify({ rawOntime, rawDamage }, null, 2), "utf8");
        } catch (err) {
          console.error("Failed to write Vercel data backup:", err);
        }
      } else {
        throw new Error("Returned spreadsheet rows count too low");
      }
    } catch (sheetErr) {
      console.warn("Failed fetching from Google Sheets API, falling back to local backup file...", sheetErr);
      if (fs.existsSync(backupPath)) {
        const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
        rawOntime = backup.rawOntime || [];
        rawDamage = backup.rawDamage || [];
      }
    }

    const isDMClient = (clientName) => {
      if (!clientName) return false;
      const name = String(clientName).trim();
      const dmList = [
        "266", "AUX", "Aqua B2B", "Aqua B2C", "Bluestone", "Casper", 
        "CellphoneS North (HTV)", "Cellphones", "DigiWorld", "Elmich B2B", 
        "FRT B2B", "FRT B2C", "Hisense FTL", "Hisense LTL", "Hồng Đạt", 
        "Hồng Đạt MXT", "LG LTL", "LG Pantos", "Nguyễn Kim", 
        "Nguyễn Kim Miền Bắc", "Nguyễn Kim Miền Nam", "PSD", "PSD LTL", 
        "Samsung", "Samsung SDS - Xdocs Hải Phòng", "Samsung SDS - Xdocs H", 
        "Samsung SDS DAN", "Thợ ĐMX FTL", "Toshiba B2B", "Điện máy Tân Long"
      ];
      if (dmList.includes(name)) return true;
      const lowerName = name.toLowerCase();
      const dmKeywords = ["nguyễn kim", "psd", "samsung", "aqua", "lg ltl", "lg pantos", "casper", "bluestone", "elmich", "toshiba", "hisense", "cellphones"];
      for (const kw of dmKeywords) {
        if (lowerName.includes(kw)) return true;
      }
      return false;
    };

    const filteredOntime = rawOntime.filter(r => isDMClient(r["client_name"]));
    const filteredDamage = rawDamage.filter(r => isDMClient(r["client_name"]));

    // Build a map for damage cases by order_code
    const damageMap = new Map();
    filteredDamage.forEach(row => {
      const code = String(row["order_code"] || "").trim();
      if (code) {
        damageMap.set(code, row);
      }
    });

    // Merge raw_damage into raw_ontime to maintain backward compatibility
    const mergedLTL = filteredOntime.map(row => {
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
        deadline:            row["deadline_plus"],
        odr_success:         row["odr_success"],
        warehouse_lay:       row["kho_lay"],
        warehouse_giao:      row["kho_giao"],
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
      damage:        filteredDamage,
    });
  } catch (err) {
    console.error("[/api/rawdata]", err);
    return res.status(500).json({ error: err.message });
  }
}
