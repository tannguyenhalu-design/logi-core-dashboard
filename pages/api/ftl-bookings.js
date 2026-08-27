/**
 * pages/api/ftl-bookings.js
 * GET/POST/PATCH/DELETE for the FTL booking intake tracker (see
 * lib/ftl-bookings.js) — the single shared list replacing the scattered
 * per-client Zalo booking links CS/GSVT/OPS/SD used to juggle separately.
 * Gated the same way as the "ftl" tab itself (session.user.tabs), not a
 * stricter role — CS staff need write access here specifically.
 */
import { getSession } from "../../lib/auth";
import { getAllBookings, createBooking, createBookingsBulk, updateBookingStatus, updateBookingDetails, deleteBooking, BOOKING_STATUSES } from "../../lib/ftl-bookings";
import { getAllDifficultAddresses, findMatches } from "../../lib/ftl-difficult-addresses";
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
      const [bookings, difficultAddresses] = await Promise.all([
        getAllBookings(),
        getAllDifficultAddresses(),
      ]);
      // Join warning matches inline so the list view can show a badge
      // without every viewer re-running findMatches() client-side.
      const bookingsWithWarnings = bookings.map((b) => ({
        ...b,
        deliveryWarnings: findMatches(b.deliveryAddress, difficultAddresses),
      }));
      return res.status(200).json({ ok: true, bookings: bookingsWithWarnings, statuses: BOOKING_STATUSES, difficultAddresses });
    } catch (err) {
      console.error("[/api/ftl-bookings] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      // Bulk shape ({bookings: [...]}) — from the Excel-import preview/
      // staging table confirming several rows at once — vs. the original
      // single-booking shape (manual "+ Thêm booking" form), kept
      // unchanged for backward compat.
      if (Array.isArray(req.body?.bookings)) {
        const records = req.body.bookings;
        const invalid = records.find((r) => !r.clientName || !r.deliveryAddress);
        if (invalid) {
          return res.status(400).json({ error: "Mỗi booking cần ít nhất Khách hàng và Địa chỉ giao" });
        }
        const bookings = await createBookingsBulk(records, actor);
        await logAction({ actor, action: "ftl_booking.bulk_create", target: `${bookings.length} bookings`, details: { sourceLink: records[0]?.sourceLink } });
        return res.status(200).json({ ok: true, bookings });
      }

      const input = req.body || {};
      if (!input.clientName || !input.deliveryAddress) {
        return res.status(400).json({ error: "Cần ít nhất Khách hàng và Địa chỉ giao" });
      }
      const booking = await createBooking(input, actor);
      await logAction({ actor, action: "ftl_booking.create", target: booking.id, details: { clientName: booking.clientName, deliveryAddress: booking.deliveryAddress } });
      return res.status(200).json({ ok: true, booking });
    } catch (err) {
      console.error("[/api/ftl-bookings] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PATCH") {
    try {
      const { id, status, fields } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      let booking;
      if (status) {
        booking = await updateBookingStatus(id, status, actor);
        await logAction({ actor, action: "ftl_booking.status", target: id, details: { status } });
      } else if (fields) {
        booking = await updateBookingDetails(id, fields, actor);
        await logAction({ actor, action: "ftl_booking.edit", target: id, details: { fields } });
      } else {
        return res.status(400).json({ error: "Cần status hoặc fields để cập nhật" });
      }
      return res.status(200).json({ ok: true, booking });
    } catch (err) {
      console.error("[/api/ftl-bookings] PATCH error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteBooking(id);
      await logAction({ actor, action: "ftl_booking.delete", target: id });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/ftl-bookings] DELETE error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
