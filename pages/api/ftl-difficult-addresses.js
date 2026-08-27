/**
 * pages/api/ftl-difficult-addresses.js
 * GET the list of flagged "địa chỉ khó giao" + POST to flag one — see
 * lib/ftl-difficult-addresses.js. Same access gate as /api/ftl-bookings.
 */
import { getSession } from "../../lib/auth";
import { getAllDifficultAddresses, flagAddress, unflagAddress } from "../../lib/ftl-difficult-addresses";
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
      const difficultAddresses = await getAllDifficultAddresses();
      return res.status(200).json({ ok: true, difficultAddresses });
    } catch (err) {
      console.error("[/api/ftl-difficult-addresses] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { address, reason } = req.body || {};
      if (!address) return res.status(400).json({ error: "Missing address" });
      const entry = await flagAddress({ address, reason, actor });
      await logAction({ actor, action: "ftl_difficult_address.flag", target: entry.addressDisplay, details: { reason } });
      return res.status(200).json({ ok: true, entry });
    } catch (err) {
      console.error("[/api/ftl-difficult-addresses] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { addressNormalized } = req.body || {};
      if (!addressNormalized) return res.status(400).json({ error: "Missing addressNormalized" });
      await unflagAddress(addressNormalized);
      await logAction({ actor, action: "ftl_difficult_address.unflag", target: addressNormalized });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/ftl-difficult-addresses] DELETE error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
