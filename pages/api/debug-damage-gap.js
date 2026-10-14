/**
 * GET /api/debug-damage-gap
 * Tìm các order code có trong Rillnet (raw_damage_causes) nhưng KHÔNG có trong
 * raw_ontime (dmOrderCodes) — đây là nguyên nhân chênh lệch 17 vs 15.
 * XÓA FILE NÀY SAU KHI DEBUG XONG.
 */
import { getSession } from "../../lib/auth";
import { loadLtlBase } from "../../lib/ltl-snapshot";
import { countedDamage } from "../../lib/damage-rules";

function parseIso(v) {
  if (!v) return "";
  const s = String(v).trim();
  // Hỗ trợ "DD/MM/YYYY" và "YYYY-MM-DD"
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return "";
}

function caseIso(c) {
  return parseIso(c.case_date || c.pickup_time || "");
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  // Chỉ manager mới được debug
  if (session.user.role !== "manager") return res.status(403).json({ error: "Manager only" });

  const base = await loadLtlBase();

  // ── Bước 1: rawDamageCauses (đúng filter countedDamage như dashboard) ──
  const rawDamageCauses = countedDamage(base.rawDamageCauses || []);

  // ── Bước 2: dmOrderCodes — tất cả order_code trong raw_ontime (KHÔNG filter) ──
  const dmOrderCodes = new Set(
    base.ltlRows.map(r => String(r["order_code"] || "").trim()).filter(Boolean)
  );

  // ── Bước 3: Date range từ raw_compensation_summary (range Rillnet dùng) ──
  const summary = (base.rawCompensationSummary || [])[0] || null;
  const from = summary?.range_from ? parseIso(summary.range_from) : "";
  const to   = summary?.range_to   ? parseIso(summary.range_to)   : "";

  // ── Bước 4: Filter rawDamageCauses theo cùng range đó (như reconcileRillnet) ──
  const ranged = rawDamageCauses.filter(c => {
    const d = caseIso(c);
    return (!from || d >= from) && (!to || d <= to);
  });

  // ── Bước 5: Tách ra 2 nhóm ──
  const inRawOntime  = ranged.filter(c => dmOrderCodes.has(String(c.order_code || "").trim()));
  const notInRawOntime = ranged.filter(c => !dmOrderCodes.has(String(c.order_code || "").trim()));

  // ── Chi tiết các đơn bị thiếu ──
  const missing = notInRawOntime.map(c => ({
    order_code:   String(c.order_code || "").trim(),
    client_name:  c.client_name || "",
    case_date:    c.case_date   || "",
    pickup_time:  c.pickup_time || "",
    counted:      c.counted,
    compensated:  c.compensated,
    damage_type:  c.type || c.damage_type || "",
    suspected_leg: c.suspected_leg || "",
    comp_amount:  c.comp_amount || "",
  }));

  return res.status(200).json({
    summary: {
      rillnet_range: { from, to },
      rillnet_reported: summary ? Number(summary.case_count) || null : null,
      scope: summary?.scope || null,
      total_rawDamageCauses: rawDamageCauses.length,
      total_in_range: ranged.length,
      in_raw_ontime: inRawOntime.length,
      not_in_raw_ontime: notInRawOntime.length,
      total_dmOrderCodes: dmOrderCodes.size,
    },
    missing_order_codes: missing,
  });
}
