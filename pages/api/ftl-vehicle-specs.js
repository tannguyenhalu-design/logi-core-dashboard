/**
 * pages/api/ftl-vehicle-specs.js
 * GET the GHN fleet spec table (see lib/ftl-vehicle-specs.js), POST to
 * replace it wholesale from an uploaded Excel file (small, hand-curated
 * table re-uploaded whenever GHN's fleet spec changes — not an
 * accumulating log).
 */
import { getSession } from "../../lib/auth";
import { getAllVehicleSpecs, replaceVehicleSpecs } from "../../lib/ftl-vehicle-specs";
import { logAction } from "../../lib/audit-log";

function hasFTLAccess(session) {
  return session.user.role === "manager" || (session.user.tabs || []).includes("ftl");
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!hasFTLAccess(session)) {
    return res.status(403).json({ error: "Bạn không có quyền xem Booking FTL" });
  }
  const actor = session.user.name || session.user.email || session.user.username;

  if (req.method === "GET") {
    try {
      const specs = await getAllVehicleSpecs();
      return res.status(200).json({ ok: true, specs });
    } catch (err) {
      console.error("[/api/ftl-vehicle-specs] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { specs } = req.body || {};
      if (!Array.isArray(specs) || specs.length === 0) {
        return res.status(400).json({ error: "Missing specs[]" });
      }
      const result = await replaceVehicleSpecs(specs, actor);
      await logAction({ actor, action: "ftl_vehicle_specs.replace", target: `${result.count} models` });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      console.error("[/api/ftl-vehicle-specs] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
