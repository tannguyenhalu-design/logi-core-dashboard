/**
 * pages/api/debug-counts.js
 * Debug endpoint: show raw counts from Google Sheet so we can
 * compare against what the dashboard shows. Manager only.
 * DELETE THIS FILE after debugging.
 */
import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { isDMClient } from "../../lib/dm-clients";

function parseDate(val) {
  if (!val) return null;
  if (typeof val === "number") {
    const excelEpoch = new Date(1899, 11, 30).getTime();
    return new Date(excelEpoch + val * 86400000);
  }
  const str = String(val).trim();
  const ddmm = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmm) {
    return new Date(parseInt(ddmm[3]), parseInt(ddmm[2]) - 1, parseInt(ddmm[1]));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user || session.user.role !== "manager") {
    return res.status(403).json({ error: "Manager only" });
  }

  const ltlSheetId = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc";
  const rawOntime = await fetchSheet("raw_ontime", ltlSheetId);

  // Count ALL rows in sheet
  const totalRaw = rawOntime.length;

  // Count DM clients
  const dmRows = rawOntime.filter(r => isDMClient(r["client_name"]));
  const totalDM = dmRows.length;

  // Count by month (pickup_time) for DM clients
  const byMonth = {};
  const byMonthStatus = {};
  dmRows.forEach(r => {
    const d = parseDate(r["pickup_time"]);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;

    const status = String(r["status"] || "").toLowerCase().trim();
    if (!byMonthStatus[key]) byMonthStatus[key] = {};
    byMonthStatus[key][status] = (byMonthStatus[key][status] || 0) + 1;
  });

  // Aug 2026 detail
  const aug2026 = dmRows.filter(r => {
    const d = parseDate(r["pickup_time"]);
    return d && d.getFullYear() === 2026 && d.getMonth() === 7; // month=7 = August
  });

  // Sample first 5 of Aug 2026
  const sample = aug2026.slice(0, 5).map(r => ({
    order_code: r["order_code"],
    client_name: r["client_name"],
    pickup_time: r["pickup_time"],
    status: r["status"],
    odr_success: r["odr_success"],
  }));

  // Count unique order_code in Aug 2026
  const uniqueOrdersAug = new Set(aug2026.map(r => r["order_code"])).size;

  // Status breakdown for Aug 2026
  const statusBreakdownAug = {};
  aug2026.forEach(r => {
    const s = String(r["status"] || "").toLowerCase().trim() || "(empty)";
    statusBreakdownAug[s] = (statusBreakdownAug[s] || 0) + 1;
  });

  return res.status(200).json({
    totalRowsInSheet: totalRaw,
    totalDMClientRows: totalDM,
    byPickupMonth: Object.fromEntries(Object.entries(byMonth).sort()),
    byMonthWithStatus: Object.fromEntries(
      Object.entries(byMonthStatus)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, v])
    ),
    aug2026: {
      totalRows: aug2026.length,
      uniqueOrderCodes: uniqueOrdersAug,
      statusBreakdown: statusBreakdownAug,
      sample,
    },
  });
}
