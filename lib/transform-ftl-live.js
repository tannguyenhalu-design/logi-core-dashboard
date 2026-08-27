/**
 * lib/transform-ftl-live.js
 * Turns raw_ftl_orders rows into the funnel + client×vehicle matrix + alert
 * list the FTL tab shows. Scoped to Điện Máy clients only via
 * FTL_PORTAL_DM_CLIENTS — the source data covers GHN's whole FTL business
 * (Seedcom Food, DHL, Wilmar, coffee chains, etc.), not just Điện Máy.
 *
 * As of 2026-08-27, raw_ftl_orders comes from manually re-running
 * cloud-scraper/sync_ftl_order_sheet.js against GHN tech's own "FTL_order"
 * export — not CDP-scraped from portal.ghn.vn anymore. That script maps
 * order_status/trip_status/license_plate/vehicle_capacity_value into this
 * same schema, so the status vocabulary and field meanings below are
 * unchanged; "driver" and "requested_vehicle_type" just stay blank now (that
 * source has no equivalent field), and "trip_count" is a simple 0/1 rather
 * than a real trip tally.
 */
import { isFTLPortalDMClient, canonicalFTLPortalClientName } from "./dm-clients";
import { regionOf } from "./vn-regions";

// Full status vocabulary confirmed against live raw_ftl_orders data on
// 2026-08-16 (11 distinct values seen). "Đã tạo" is the earliest stage —
// order created, not yet picked up — and is by far the largest non-terminal
// bucket (~200/673 Điện Máy orders), so it gets its own two-way split below
// rather than being lumped into "processing".
const DONE_STATUSES = new Set(["Giao thành công", "Hoàn thành"]);
const ISSUE_STATUSES = new Set(["Hủy đơn", "Giao thất bại", "Lấy thất bại", "Trả hàng", "Hư hỏng"]);
const TERMINAL_STATUSES = new Set([...DONE_STATUSES, ...ISSUE_STATUSES]);
const CREATED_STATUS = "Đã tạo";

// 3-way grouping used by the client×vehicle matrix cells — collapses the
// portal's raw statuses into "hoàn tất / đang xử lý / sự cố" so a cell
// reads as a single glance-able (a/b/c), full detail is one click away.
function statusGroup(status) {
  if (DONE_STATUSES.has(status)) return "done";
  if (ISSUE_STATUSES.has(status)) return "issue";
  return "processing"; // Đã tạo, Đang vận chuyển, Lấy thành công, Đã giao một phần
}

function isTripCompleted(r) {
  return String(r["trip_completed"] || "").trim().toLowerCase() === "true";
}

// trip_status comes straight from GHN's API as English enum codes
// (PLANNED/ASSIGNED/IN_TRANSIT/COMPLETED/CANCELLED) — fine for a machine,
// not for a dispatcher glancing at the dashboard. Translate once here so
// every table on the tab shows the same plain-Vietnamese wording instead of
// raw codes like "COMPLETED + IN_TRANSIT" leaking into the UI.
const TRIP_STATUS_VI = {
  PLANNED: "Đã lên kế hoạch",
  ASSIGNED: "Đã gán xe",
  IN_TRANSIT: "Đang chạy",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã hủy",
};
function translateTripStatus(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.split("+").map((part) => {
    const p = part.trim();
    return TRIP_STATUS_VI[p] || p;
  }).join(" + ");
}

// The KPI funnel must show the same corrected picture as the matrix/alerts,
// not the raw order-level "status" — confirmed on live data (2026-08-16):
// 89 Điện Máy FTL orders had trip_completed=true while still labeled
// something else at order level, including ALL 26 orders raw-labeled
// "Đang vận chuyển" (in transit) and both orders labeled "Giao thất bại"
// (delivery failed) — every one of those had actually already delivered
// successfully per the real trip data.
function effectiveDisplayStatus(r) {
  if (isTripCompleted(r)) return "Giao thành công";
  return String(r["status"] || "(không rõ)").trim();
}

// "status" (mục 1 "Trạng thái đơn", from GHN's bulk export) can stay
// permanently stuck at "Đã tạo" even after the truck has actually finished
// its run — confirmed on a real order where "Trạng thái đơn" never left
// "Đã tạo" while "Trạng thái chuyến đi" (mục 5, per-trip, scraped
// separately by ftl_enrich_vehicle.py) already read "Đã hoàn thành". Prefer
// the trip-level signal whenever it's available; it only ever pushes
// TOWARD "done", never away from it, since it's just confirming completion
// the order-level field failed to record.
function effectiveStatusGroup(r) {
  if (isTripCompleted(r)) return "done";
  return statusGroup(String(r["status"] || "").trim());
}

function parseVNDate(str) {
  // "15/08/2026" -> Date. Order-creation dates on this sheet are always
  // this format (matches the portal's own display format).
  const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

// Local (not UTC) date key — matches the dateKey built inline further down
// for the daily-vehicle-stats maps, pulled out here since the
// "runningTodayOrders" check needs the exact same "same calendar day"
// comparison against `new Date()`.
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysSince(dateObj) {
  if (!dateObj) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((startOfToday - dateObj) / 86400000));
}

// Matrix columns must only ever be GHN's real fleet sizes (1.9T/5T/8T) — no
// synthetic "combo" columns. A split-booking order's vehicle_capacity is
// stored as a joined string ("1.9T + 5T", one real truck each) — split it
// back into its real, individual types so a split order counts toward
// EVERY type of truck it actually used, e.g. +1 in the 5T column AND +1 in
// the 1.9T column, rather than living in its own one-off combo bucket. The
// two counts don't need to sum back to the order count — that's expected:
// 1 split-booking order legitimately used 2 distinct physical trucks.
export function vehicleTypesOf(capacityRaw) {
  const cap = String(capacityRaw || "").trim();
  if (!cap) return ["(chưa rõ)"];
  return cap.split("+").map((s) => s.trim()).filter(Boolean);
}

export function transformFTLLive(rawRows, { clients = null, dateFrom = null, dateTo = null, address = null } = {}) {
  // Canonicalize client_name right here (see dm-clients.js's
  // canonicalFTLPortalClientName comment) so every computation below —
  // matrix, daily vehicle stats, destination breakdown — sees ONE merged
  // client instead of the portal's inconsistent "SF | AQUA B2B" vs
  // "AQUA B2B" / "Công Ty Tnhh LX Pantos Việt Nam" vs "Pantos | LG FTL"
  // labeling splitting it into duplicate rows.
  const dmRows = (rawRows || [])
    .filter((r) => isFTLPortalDMClient(r["client_name"]))
    .map((r) => ({ ...r, client_name: canonicalFTLPortalClientName(r["client_name"]) }));

  // allClients/allVehicleTypes are computed from the full DM set (before
  // date/address filtering) so the filter dropdowns don't shrink themselves
  // out from under the user as they narrow other filters.
  const allClients = [...new Set(dmRows.map((r) => String(r["client_name"] || "").trim()))].sort();

  let scopedRows = clients && clients.length > 0
    ? dmRows.filter((r) => clients.includes(String(r["client_name"] || "").trim()))
    : dmRows;

  // "Chuyến đang chạy hôm nay" — theo yêu cầu người dùng (2026-08-26): xem
  // nhanh có bao nhiêu chuyến FTL có NGÀY LẤY HÀNG là hôm nay, bất kể giao
  // xong hôm nay hay mai (chuyến đường dài thường lấy 1 ngày, giao ngày kế
  // tiếp). Deliberately computed from the client-filtered-but-NOT
  // date-range-filtered set (a snapshot of `scopedRows` before the
  // dateFrom/dateTo filter below narrows it further) — this is a fixed
  // "right now" pulse-check, so it must still show "hôm nay" even when the
  // date-range picker is showing some other past month; only the client
  // dropdown should still narrow it. No confirmed separate "ngày lấy hàng
  // dự kiến" field exists on raw_ftl_orders (see sync_ftl_to_db.js's
  // COLUMN_MAP — only created_date/pickup_success_date/delivery_success_date/
  // return_success_date), and created_date is what the rest of this file
  // already treats as the pickup-day proxy for planning (every
  // "Số xe sử dụng theo ngày" bucket keys off it) — same interpretation here.
  const todayStr = toDateKey(new Date());
  const runningTodayOrders = scopedRows.filter((r) => {
    if (String(r["status"] || "").trim() === "Hủy đơn") return false;
    const d = parseVNDate(r["created_date"]);
    return d && toDateKey(d) === todayStr;
  });

  const fromDate = dateFrom ? new Date(dateFrom) : null;
  const toDate = dateTo ? new Date(dateTo) : null;
  if (fromDate || toDate) {
    scopedRows = scopedRows.filter((r) => {
      const d = parseVNDate(r["created_date"]);
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }

  if (address && address.trim()) {
    const needle = address.trim().toLowerCase();
    scopedRows = scopedRows.filter((r) =>
      String(r["delivery_address"] || "").toLowerCase().includes(needle) ||
      String(r["pickup_address"] || "").toLowerCase().includes(needle)
    );
  }

  const statusCounts = {};
  scopedRows.forEach((r) => {
    const st = effectiveDisplayStatus(r);
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });

  // "Sau 20h chưa giao" — Điện Máy FTL orders that are ALREADY dispatched
  // (Đang vận chuyển / Đã giao một phần) but still open too long. "Đã tạo"
  // is deliberately excluded here — it's covered by the two banners below
  // instead (unassignedOrders / stalledAssignedOrders), which give more
  // specific, actionable framing for that stage (has a truck or not) than
  // a generic "overdue" label would. Without this exclusion, ~165 of the
  // 169 open "Đã tạo" orders showed up in BOTH this banner and one of the
  // two below — same order double-counted under two different banners,
  // confirmed against live data 2026-08-16.
  //
  // Orders created before today are ALWAYS shown here regardless of
  // current clock time — if it slipped past its own day it's already
  // overdue no matter when someone opens the dashboard. Only orders
  // created TODAY are gated behind 20:00 ICT, to give same-day deliveries
  // their normal working hours before flagging them.
  const now = new Date();
  const ictHour = (now.getUTCHours() + 7) % 24;
  const isAfter8pm = ictHour >= 20;
  const overdueList = scopedRows.filter((r) => {
    if (isTripCompleted(r)) return false;
    const status = String(r["status"] || "").trim();
    if (status === CREATED_STATUS) return false;
    if (TERMINAL_STATUSES.has(status)) return false;
    const age = daysSince(parseVNDate(r["created_date"]));
    if (age === null) return false;
    return age >= 1 || isAfter8pm;
  });

  // "Đã tạo" (order created, not yet picked up) is the earliest stage — split
  // it in two, since the two cases need completely different follow-up:
  //   - chưa gán tài xế: no truck assigned on GHN's side at all yet
  //   - đã gán nhưng chưa xuất phát: truck IS assigned but order hasn't moved
  //     past "Đã tạo" (should have progressed to "Lấy thành công"/"Đang vận
  //     chuyển" by now)
  // Every order still lacking a plate gets re-visited by
  // ftl_enrich_vehicle.py every sync cycle (its per-run cap now covers the
  // whole Điện Máy backlog), so an empty plate here reliably means "GHN
  // hasn't assigned a truck yet" rather than "bot hasn't checked yet".
  // Excludes any order whose trip is actually done per mục 5, even though
  // "status" (mục 1) still reads "Đã tạo" — that's not really "stuck", it's
  // just an order-level field GHN never got around to updating.
  const createdRows = scopedRows.filter((r) => String(r["status"] || "").trim() === CREATED_STATUS && !isTripCompleted(r));
  const toAlertRow = (r) => {
    const d = parseVNDate(r["created_date"]);
    return {
      orderCode: r["order_code"] || "",
      clientName: r["client_name"] || "",
      createdDate: r["created_date"] || "",
      daysSinceCreated: daysSince(d),
      status: r["status"] || "",
      tripStatus: translateTripStatus(r["trip_status"]),
      plate: r["plate"] || "",
      driver: r["driver"] || "",
      deliveryAddress: r["delivery_address"] || "",
    };
  };
  const byAgeDesc = (a, b) => (b.daysSinceCreated ?? -1) - (a.daysSinceCreated ?? -1);
  const unassignedOrders = createdRows.filter((r) => !r["plate"]).map(toAlertRow).sort(byAgeDesc);
  const stalledAssignedOrders = createdRows.filter((r) => r["plate"]).map(toAlertRow).sort(byAgeDesc);

  const orders = scopedRows.map((r) => ({
    orderCode: r["order_code"] || "",
    customOrderCode: r["custom_order_code"] || "",
    clientName: r["client_name"] || "",
    createdDate: r["created_date"] || "",
    status: r["status"] || "",
    statusGroup: effectiveStatusGroup(r),
    tripStatus: translateTripStatus(r["trip_status"]),
    tripCompleted: isTripCompleted(r),
    // Same first-segment normalization as the daily vehicle stats above —
    // needed so clicking a day chip in "Số xe sử dụng theo ngày" can filter
    // orders down to the exact same (client, province, date) bucket that
    // produced that count.
    pickupProvince: String(r["pickup_province"] || "").split(";")[0].trim(),
    pickupAddress: r["pickup_address"] || "",
    deliveryProvince: String(r["delivery_province"] || "").split(";")[0].trim(),
    deliveryAddress: r["delivery_address"] || "",
    deliveryPointCount: r["delivery_point_count"] || "",
    plate: r["plate"] || "",
    driver: r["driver"] || "",
    vehicleCapacity: r["vehicle_capacity"] || "",
    tripCount: Number(r["trip_count"]) || 0,
  }));

  // Sort newest-first by created date for display.
  orders.sort((a, b) => {
    const da = parseVNDate(a.createdDate);
    const db = parseVNDate(b.createdDate);
    if (!da || !db) return 0;
    return db - da;
  });

  // Client × vehicle-type matrix — real GHN fleet sizes only (1.9T/5T/8T).
  // Orders GHN hasn't assigned a truck to yet are deliberately left OUT of
  // the matrix entirely rather than shown as a "(chưa rõ)" column — that
  // set is exactly what the 🟠 "chưa gán tài xế" banner above already
  // tracks (unassignedOrders), so showing it a second time here as a fake
  // vehicle-type column was redundant. A split-booking order (2+ distinct
  // trucks) counts once per real truck type it used — see vehicleTypesOf.
  // TabFTL.js filters the `orders` array below (by clientName + a type its
  // vehicleCapacity list includes + statusGroup) for the click-through
  // detail, no need to duplicate order lists here.
  const matrixMap = {}; // clientName -> vehicleType -> {done, processing, issue}
  const vehicleTypesSet = new Set();
  scopedRows.forEach((r) => {
    if (!r["vehicle_capacity"]) return; // no assigned truck -> covered by the unassigned-driver alert instead
    const client = String(r["client_name"] || "").trim();
    const group = effectiveStatusGroup(r);
    for (const cap of vehicleTypesOf(r["vehicle_capacity"])) {
      vehicleTypesSet.add(cap);
      if (!matrixMap[client]) matrixMap[client] = {};
      if (!matrixMap[client][cap]) matrixMap[client][cap] = { done: 0, processing: 0, issue: 0 };
      matrixMap[client][cap][group]++;
    }
  });
  const vehicleTypes = [...vehicleTypesSet].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const clientVehicleMatrix = Object.entries(matrixMap).map(([clientName, byVehicle]) => ({
    clientName,
    cells: byVehicle,
  })).sort((a, b) => {
    const totalA = Object.values(a.cells).reduce((s, c) => s + c.done + c.processing + c.issue, 0);
    const totalB = Object.values(b.cells).reduce((s, c) => s + c.done + c.processing + c.issue, 0);
    return totalB - totalA;
  });

  // Daily vehicle usage — for capacity planning ("how many trucks/day does
  // each project typically need"). Counts DISTINCT plates active per
  // calendar day (by created_date). Per user instruction (2026-08-20):
  // exclude only cancelled orders ("Hủy đơn" — statusGroup "issue"); orders
  // GHN shows as not-yet-assigned a plate are STILL counted — per the user,
  // the truck is genuinely out running, GSVT staff just forgot to log the
  // plate/driver into the system, so this is a data-entry gap, not a "no
  // vehicle used" case. Since there's no real plate to dedupe such an order
  // against, each one is credited as its own distinct (unidentified)
  // vehicle for that day, under a "(chưa rõ)" type — undercounting by
  // merging unlogged orders into fewer trucks than reality would be worse
  // for capacity planning than this. Split-booking orders ("1.9T + 5T")
  // pair their plates to their vehicle types positionally — both lists come
  // from the same GHN trips array in ftl_enrich_vehicle.py, so the order
  // lines up in the common case; if the two lists ever have different
  // lengths (rare), fall back to crediting every plate to every type rather
  // than guessing a pairing.
  const UNKNOWN_TYPE = "(chưa rõ)";

  // "Đang chạy hôm nay" theo khách hàng × loại tải trọng — theo yêu cầu
  // người dùng (2026-08-26), ngay sau câu hỏi "hôm nay có bao nhiêu chuyến
  // đang chạy": muốn biết luôn TỪNG DỰ ÁN cần bao nhiêu xe mỗi loại
  // (1.9T/5T/8T) trong số đó. Đếm theo BIỂN SỐ khác nhau (không phải số
  // đơn) — cùng quy ước dedupe với "Số xe sử dụng theo ngày" phía dưới, vì
  // 1 xe có thể chạy nhiều đơn cùng ngày nhưng vẫn chỉ là 1 xe thực tế.
  //
  // QUAN TRỌNG (sửa 2026-08-26 theo phản hồi người dùng): "vehicle_capacity"
  // (từ trips API, có xe/tài xế thật) và "requested_vehicle_type" (từ order-
  // detail API's vehicle_spec_code) là 2 khái niệm HOÀN TOÀN KHÁC NHAU —
  // vehicle_capacity = xe GHN THỰC SỰ điều (đáng tin), còn
  // requested_vehicle_type = loại xe KHÁCH ĐẶT lúc tạo đơn (chỉ là dự kiến,
  // GHN có thể đổi loại xe khác khi thực sự dispatch). Gộp chung 2 số này
  // vào 1 cột như bản trước dễ khiến OPS tưởng nhầm "khách yêu cầu" là
  // "GHN đã xác nhận". Tách riêng 2 map để UI hiển thị rạch ròi.
  const runningTodayConfirmedMap = {}; // clientName -> vehicleType -> Set(plate) — CÓ xe/tài xế thật
  const runningTodayRequestedMap = {}; // clientName -> vehicleType -> count — CHỈ là khách đặt, chưa có xe thật
  runningTodayOrders.forEach((r) => {
    const client = String(r["client_name"] || "").trim();
    const plateRaw = String(r["plate"] || "").trim();
    if (plateRaw) {
      const plates = plateRaw.split("+").map((s) => s.trim()).filter(Boolean);
      const types = vehicleTypesOf(r["vehicle_capacity"]);
      if (!runningTodayConfirmedMap[client]) runningTodayConfirmedMap[client] = {};
      const addPlate = (type, plate) => {
        if (!runningTodayConfirmedMap[client][type]) runningTodayConfirmedMap[client][type] = new Set();
        runningTodayConfirmedMap[client][type].add(plate);
      };
      if (plates.length === types.length) {
        plates.forEach((p, i) => addPlate(types[i], p));
      } else {
        types.forEach((type) => plates.forEach((p) => addPlate(type, p)));
      }
    } else {
      // Chưa có xe/chuyến thật — đếm theo SỐ ĐƠN (không phải biển số, vì
      // chưa có biển số nào để dedupe), dùng "Tải trọng yêu cầu" của khách
      // nếu GHN đã ghi nhận, không thì "(chưa rõ)".
      const types = r["requested_vehicle_type"] ? vehicleTypesOf(r["requested_vehicle_type"]) : [UNKNOWN_TYPE];
      if (!runningTodayRequestedMap[client]) runningTodayRequestedMap[client] = {};
      types.forEach((type) => {
        runningTodayRequestedMap[client][type] = (runningTodayRequestedMap[client][type] || 0) + 1;
      });
    }
  });
  const runningTodayVehicleTypesSet = new Set();
  Object.values(runningTodayConfirmedMap).forEach((byType) => Object.keys(byType).forEach((t) => runningTodayVehicleTypesSet.add(t)));
  Object.values(runningTodayRequestedMap).forEach((byType) => Object.keys(byType).forEach((t) => runningTodayVehicleTypesSet.add(t)));
  const runningTodayVehicleTypes = [...runningTodayVehicleTypesSet].sort((a, b) => {
    if (a === UNKNOWN_TYPE) return 1;
    if (b === UNKNOWN_TYPE) return -1;
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const runningTodayClientNames = new Set([...Object.keys(runningTodayConfirmedMap), ...Object.keys(runningTodayRequestedMap)]);
  const runningTodayByClient = [...runningTodayClientNames]
    .map((clientName) => {
      const confirmedByType = runningTodayConfirmedMap[clientName] || {};
      const requestedByType = runningTodayRequestedMap[clientName] || {};
      const confirmedPlates = new Set();
      const byType = {};
      runningTodayVehicleTypes.forEach((type) => {
        const confirmedCount = confirmedByType[type]?.size || 0;
        const requestedCount = requestedByType[type] || 0;
        if (confirmedByType[type]) confirmedByType[type].forEach((p) => confirmedPlates.add(p));
        if (confirmedCount || requestedCount) byType[type] = { confirmed: confirmedCount, requested: requestedCount };
      });
      const totalRequested = Object.values(requestedByType).reduce((s, n) => s + n, 0);
      return { clientName, totalVehicles: confirmedPlates.size, totalRequested, byType };
    })
    .sort((a, b) => (b.totalVehicles + b.totalRequested) - (a.totalVehicles + a.totalRequested));

  const dailyVehicleTotalMap = {}; // clientName -> dateKey -> Set(plate)
  const dailyVehicleByTypeMap = {}; // clientName -> vehicleType -> dateKey -> Set(plate)
  // Same breakdown again, but ALSO split by pickup province — needed for
  // clients that run a fixed daily fleet PER PICKUP REGION rather than one
  // combined number (e.g. SF | AQUA B2B: a separate cap for Đồng Nai/miền
  // Nam pickups vs Hưng Yên/miền Bắc pickups). Kept as a second parallel
  // structure instead of folding province into the main one above so the
  // main "Số xe sử dụng theo ngày" table can keep showing one row per
  // client by default — only clients that actually have a per-province cap
  // set need this finer split, checked against ftl_vehicle_caps client-side.
  const dailyVehicleByProvinceMap = {}; // clientName -> province -> dateKey -> Set(plate)
  const dailyVehicleByProvinceTypeMap = {}; // clientName -> province -> vehicleType -> dateKey -> Set(plate)
  // Region-level (Miền Bắc/Trung/Nam) pools — combined ACROSS clients, unlike
  // the per-client maps above, because "how many vehicles to prepare in the
  // South today" is a fleet-planning question independent of which client
  // each truck happens to serve (lib/vn-regions.js).
  const dailyVehicleByRegionMap = {}; // region -> dateKey -> Set(plate)
  const dailyVehicleByRegionTypeMap = {}; // region -> vehicleType -> dateKey -> Set(plate)
  // Grand total across ALL clients/regions combined — same "unique plate
  // per day" dedup as the region pools above, just without the region
  // split, for "tổng trung bình xe/ngày toàn hệ thống, theo từng loại xe".
  const dailyVehicleGlobalMap = {}; // dateKey -> Set(plate)
  const dailyVehicleGlobalTypeMap = {}; // vehicleType -> dateKey -> Set(plate)
  scopedRows.forEach((r) => {
    if (effectiveStatusGroup(r) === "issue") return;
    const d = parseVNDate(r["created_date"]);
    if (!d) return;
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const client = String(r["client_name"] || "").trim();
    // Multi-stop pickups store pickup_province as the same province
    // repeated once per stop, ";"-joined (e.g. "Đồng Nai; Đồng Nai; Đồng
    // Nai") — take just the first segment so these don't fragment into
    // their own noise buckets separate from plain "Đồng Nai".
    const province = String(r["pickup_province"] || "").split(";")[0].trim();
    const plateRaw = String(r["plate"] || "").trim();
    let plates, types;
    if (plateRaw) {
      plates = plateRaw.split("+").map((s) => s.trim()).filter(Boolean);
      types = vehicleTypesOf(r["vehicle_capacity"]);
    } else {
      // Chưa gán biển số trên hệ thống — không có gì để gộp trùng, nên
      // dùng chính mã đơn làm khóa nhận diện tạm cho 1 xe "chưa rõ".
      plates = [`__unlogged__${r["order_code"] || Math.random()}`];
      types = [UNKNOWN_TYPE];
    }

    if (!dailyVehicleTotalMap[client]) dailyVehicleTotalMap[client] = {};
    if (!dailyVehicleTotalMap[client][dateKey]) dailyVehicleTotalMap[client][dateKey] = new Set();
    plates.forEach((p) => dailyVehicleTotalMap[client][dateKey].add(p));

    if (!dailyVehicleByProvinceMap[client]) dailyVehicleByProvinceMap[client] = {};
    if (!dailyVehicleByProvinceMap[client][province]) dailyVehicleByProvinceMap[client][province] = {};
    if (!dailyVehicleByProvinceMap[client][province][dateKey]) dailyVehicleByProvinceMap[client][province][dateKey] = new Set();
    plates.forEach((p) => dailyVehicleByProvinceMap[client][province][dateKey].add(p));

    const region = regionOf(province);
    if (!dailyVehicleByRegionMap[region]) dailyVehicleByRegionMap[region] = {};
    if (!dailyVehicleByRegionMap[region][dateKey]) dailyVehicleByRegionMap[region][dateKey] = new Set();
    plates.forEach((p) => dailyVehicleByRegionMap[region][dateKey].add(p));
    if (!dailyVehicleByRegionTypeMap[region]) dailyVehicleByRegionTypeMap[region] = {};
    const addPlateToRegionType = (type, plate) => {
      if (!dailyVehicleByRegionTypeMap[region][type]) dailyVehicleByRegionTypeMap[region][type] = {};
      if (!dailyVehicleByRegionTypeMap[region][type][dateKey]) dailyVehicleByRegionTypeMap[region][type][dateKey] = new Set();
      dailyVehicleByRegionTypeMap[region][type][dateKey].add(plate);
    };
    if (plates.length === types.length) {
      plates.forEach((p, i) => addPlateToRegionType(types[i], p));
    } else {
      types.forEach((type) => plates.forEach((p) => addPlateToRegionType(type, p)));
    }

    if (!dailyVehicleGlobalMap[dateKey]) dailyVehicleGlobalMap[dateKey] = new Set();
    plates.forEach((p) => dailyVehicleGlobalMap[dateKey].add(p));
    const addPlateToGlobalType = (type, plate) => {
      if (!dailyVehicleGlobalTypeMap[type]) dailyVehicleGlobalTypeMap[type] = {};
      if (!dailyVehicleGlobalTypeMap[type][dateKey]) dailyVehicleGlobalTypeMap[type][dateKey] = new Set();
      dailyVehicleGlobalTypeMap[type][dateKey].add(plate);
    };
    if (plates.length === types.length) {
      plates.forEach((p, i) => addPlateToGlobalType(types[i], p));
    } else {
      types.forEach((type) => plates.forEach((p) => addPlateToGlobalType(type, p)));
    }

    if (!dailyVehicleByTypeMap[client]) dailyVehicleByTypeMap[client] = {};
    if (!dailyVehicleByProvinceTypeMap[client]) dailyVehicleByProvinceTypeMap[client] = {};
    if (!dailyVehicleByProvinceTypeMap[client][province]) dailyVehicleByProvinceTypeMap[client][province] = {};
    const addPlateToType = (type, plate) => {
      if (!dailyVehicleByTypeMap[client][type]) dailyVehicleByTypeMap[client][type] = {};
      if (!dailyVehicleByTypeMap[client][type][dateKey]) dailyVehicleByTypeMap[client][type][dateKey] = new Set();
      dailyVehicleByTypeMap[client][type][dateKey].add(plate);

      if (!dailyVehicleByProvinceTypeMap[client][province][type]) dailyVehicleByProvinceTypeMap[client][province][type] = {};
      if (!dailyVehicleByProvinceTypeMap[client][province][type][dateKey]) dailyVehicleByProvinceTypeMap[client][province][type][dateKey] = new Set();
      dailyVehicleByProvinceTypeMap[client][province][type][dateKey].add(plate);
    };
    if (plates.length === types.length) {
      plates.forEach((p, i) => addPlateToType(types[i], p));
    } else {
      types.forEach((type) => plates.forEach((p) => addPlateToType(type, p)));
    }
  });

  // Số ngày trong CẢ khoảng đang lọc (kể cả ngày không có xe nào chạy) —
  // dùng để tính 1 chỉ số "TB xe/ngày" thứ hai, khác với avgPerDay (chỉ
  // chia cho số ngày CÓ xe). Không có 2 số này thì 1 khách chỉ ship lai
  // rai vài ngày/tháng (VD: Kex Express) sẽ hiện "TB 5 xe/ngày" — đúng
  // toán học trên NHỮNG NGÀY nó chạy, nhưng dễ hiểu lầm thành "ngày nào
  // cũng cần chuẩn bị 5 xe", trong khi thực tế chỉ vài ngày/tháng mới cần.
  // Nếu có filter Từ ngày/Đến ngày thì dùng đúng khoảng đó; nếu không thì
  // lấy khoảng ngày thực tế xuất hiện trong scopedRows.
  let totalDaysInRange;
  if (fromDate && toDate) {
    totalDaysInRange = Math.round((toDate - fromDate) / 86400000) + 1;
  } else {
    let minD = null, maxD = null;
    scopedRows.forEach((r) => {
      const d = parseVNDate(r["created_date"]);
      if (!d) return;
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    });
    totalDaysInRange = minD && maxD ? Math.round((maxD - minD) / 86400000) + 1 : 1;
  }

  function statsFromDailySets(byDate) {
    const counts = Object.values(byDate).map((s) => s.size);
    if (counts.length === 0) return null;
    const sum = counts.reduce((a, b) => a + b, 0);
    const dailyBreakdown = Object.entries(byDate)
      .map(([date, s]) => ({ date, count: s.size }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      daysWithData: counts.length,
      avgPerDay: Math.round((sum / counts.length) * 10) / 10,
      avgPerDayInRange: Math.round((sum / totalDaysInRange) * 10) / 10,
      minPerDay: Math.min(...counts),
      maxPerDay: Math.max(...counts),
      dailyBreakdown,
    };
  }

  const dailyVehicleStats = Object.entries(dailyVehicleTotalMap)
    .map(([clientName, byDate]) => {
      const overall = statsFromDailySets(byDate);
      const byType = {};
      Object.entries(dailyVehicleByTypeMap[clientName] || {}).forEach(([type, byDateForType]) => {
        byType[type] = statsFromDailySets(byDateForType);
      });
      // Gắn kèm loại xe cho từng ngày trong dailyBreakdown — "3 xe hôm 25/06"
      // một mình không đủ, cần biết đó là 3 xe 8T hay 1 xe mỗi loại.
      if (overall) {
        overall.dailyBreakdown = overall.dailyBreakdown.map((d) => {
          const byTypeForDate = {};
          Object.entries(dailyVehicleByTypeMap[clientName] || {}).forEach(([type, byDateForType]) => {
            const s = byDateForType[d.date];
            if (s && s.size > 0) byTypeForDate[type] = s.size;
          });
          return { ...d, byType: byTypeForDate };
        });
      }
      return { clientName, overall, byType };
    })
    .filter((r) => r.overall)
    .sort((a, b) => (b.overall?.avgPerDay || 0) - (a.overall?.avgPerDay || 0));

  // Same as dailyVehicleStats above but one row per (client, pickup
  // province) — only meaningful for the handful of clients that actually
  // have a per-province cap configured (see ftl_vehicle_caps / /api/ftl-caps);
  // for everyone else the plain per-client rows above are all that's shown.
  const dailyVehicleStatsByProvince = [];
  Object.entries(dailyVehicleByProvinceMap).forEach(([clientName, byProvince]) => {
    Object.entries(byProvince).forEach(([pickupProvince, byDate]) => {
      const overall = statsFromDailySets(byDate);
      if (!overall) return;
      const byType = {};
      const typeMapForProvince = (dailyVehicleByProvinceTypeMap[clientName] || {})[pickupProvince] || {};
      Object.entries(typeMapForProvince).forEach(([type, byDateForType]) => {
        byType[type] = statsFromDailySets(byDateForType);
      });
      overall.dailyBreakdown = overall.dailyBreakdown.map((d) => {
        const byTypeForDate = {};
        Object.entries(typeMapForProvince).forEach(([type, byDateForType]) => {
          const s = byDateForType[d.date];
          if (s && s.size > 0) byTypeForDate[type] = s.size;
        });
        return { ...d, byType: byTypeForDate };
      });
      dailyVehicleStatsByProvince.push({ clientName, pickupProvince, overall, byType });
    });
  });

  // Region rollup — "trung bình 1 ngày cần chuẩn bị bao nhiêu xe cho Miền
  // Bắc / Miền Nam". Sorted Bắc → Trung → Nam → Khác rather than by volume,
  // since this is read as a fixed north/south planning checklist, not a
  // ranking.
  const REGION_ORDER = ["Miền Bắc", "Miền Trung", "Miền Nam", "Khác"];
  const dailyVehicleStatsByRegion = Object.entries(dailyVehicleByRegionMap)
    .map(([region, byDate]) => {
      const overall = statsFromDailySets(byDate);
      if (!overall) return null;
      const byType = {};
      Object.entries(dailyVehicleByRegionTypeMap[region] || {}).forEach(([type, byDateForType]) => {
        byType[type] = statsFromDailySets(byDateForType);
      });
      overall.dailyBreakdown = overall.dailyBreakdown.map((d) => {
        const byTypeForDate = {};
        Object.entries(dailyVehicleByRegionTypeMap[region] || {}).forEach(([type, byDateForType]) => {
          const s = byDateForType[d.date];
          if (s && s.size > 0) byTypeForDate[type] = s.size;
        });
        return { ...d, byType: byTypeForDate };
      });
      return { region, overall, byType };
    })
    .filter(Boolean)
    .sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region));

  // Grand total — same shape as one region row, just summed across all of
  // them, for "tổng trung bình xe/ngày toàn hệ thống, theo từng loại xe".
  const dailyVehicleStatsOverall = (() => {
    const overall = statsFromDailySets(dailyVehicleGlobalMap);
    if (!overall) return null;
    const byType = {};
    Object.entries(dailyVehicleGlobalTypeMap).forEach(([type, byDateForType]) => {
      byType[type] = statsFromDailySets(byDateForType);
    });
    overall.dailyBreakdown = overall.dailyBreakdown.map((d) => {
      const byTypeForDate = {};
      Object.entries(dailyVehicleGlobalTypeMap).forEach(([type, byDateForType]) => {
        const s = byDateForType[d.date];
        if (s && s.size > 0) byTypeForDate[type] = s.size;
      });
      return { ...d, byType: byTypeForDate };
    });
    return { overall, byType };
  })();

  // Column set for the panel above — separate from `vehicleTypes` (matrix
  // columns, real GHN fleet sizes only) because this one can also include
  // UNKNOWN_TYPE for unlogged-plate orders. Real sizes sort numerically
  // first, "(chưa rõ)" always last.
  const dailyVehicleTypesSet = new Set();
  Object.values(dailyVehicleByTypeMap).forEach((byType) => Object.keys(byType).forEach((t) => dailyVehicleTypesSet.add(t)));
  const dailyVehicleTypes = [...dailyVehicleTypesSet].sort((a, b) => {
    if (a === UNKNOWN_TYPE) return 1;
    if (b === UNKNOWN_TYPE) return -1;
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  // "Đích giao hàng" — theo yêu cầu người dùng (2026-08-25): với mỗi khách
  // Điện Máy, các chuyến FTL trong khoảng đang lọc thường giao đến TỈNH nào
  // nhiều nhất, kèm địa chỉ giao cụ thể phổ biến nhất tại tỉnh đó và
  // breakdown theo loại xe (1.9T/5T/8T) của các chuyến giao tỉnh đó. Đơn
  // chưa gán xe (không có vehicle_capacity) vẫn tính vào tổng/tỉnh, chỉ rơi
  // vào cột "(chưa rõ)" ở phần loại xe — cùng quy ước UNKNOWN_TYPE với
  // "Số xe sử dụng theo ngày" phía trên.
  const REGION_ORDER_DEST = ["Miền Bắc", "Miền Trung", "Miền Nam", "Khác"];

  // Đơn đã hủy chưa từng thực sự chạy tới đâu cả — theo yêu cầu người dùng
  // (2026-08-25), loại hẳn khỏi thống kê "chuyến hay giao tỉnh nào" thay vì
  // chỉ ẩn ở UI, vì tính cả đơn hủy sẽ làm sai % và cả việc xác định 1
  // khách có thật sự chạy 2 miền lấy hàng hay không.
  const destScopedRows = scopedRows.filter((r) => String(r["status"] || "").trim() !== "Hủy đơn");

  // Một số khách chạy 2 mạng lấy hàng tách biệt theo miền (VD: AQUA — kho
  // Đồng Nai/Long An phục vụ miền Nam, kho Hưng Yên phục vụ miền Bắc) —
  // theo yêu cầu người dùng (2026-08-25), những khách này cần tách hẳn
  // thành "Tên khách — Miền X" ở mức khách hàng (không chỉ gộp con số
  // trong 1 card), vì đây thực chất là 2 hoạt động vận hành độc lập. Xác
  // định "chạy nhiều miền" bằng miền LẤY hàng (pickup_province), không
  // phải miền giao — tổng quát cho bất kỳ khách nào sau này rơi vào cùng
  // tình huống (Karofi, LG, ...), không hardcode riêng theo tên khách.
  const pickupRegionsByClient = {}; // client -> Set(pickupRegion)
  destScopedRows.forEach((r) => {
    const client = String(r["client_name"] || "").trim();
    const pickupProvince = String(r["pickup_province"] || "").split(";")[0].trim();
    const pickupRegion = regionOf(pickupProvince);
    if (!pickupRegionsByClient[client]) pickupRegionsByClient[client] = new Set();
    pickupRegionsByClient[client].add(pickupRegion);
  });
  function destGroupKeyFor(r) {
    const client = String(r["client_name"] || "").trim();
    if ((pickupRegionsByClient[client]?.size || 0) < 2) return client;
    const pickupProvince = String(r["pickup_province"] || "").split(";")[0].trim();
    return `${client} — ${regionOf(pickupProvince)}`;
  }
  // rawClientName/pickupRegion — kept alongside the display groupKey so the
  // UI can filter `orders` back to exactly the rows a card summarizes for
  // click-through drilldown (the groupKey itself is a synthetic display
  // string like "SF | AQUA B2B — Miền Nam", not something orders carries).
  const destGroupMeta = {}; // groupKey -> { rawClientName, pickupRegion }
  destScopedRows.forEach((r) => {
    const groupKey = destGroupKeyFor(r);
    if (!destGroupMeta[groupKey]) {
      const client = String(r["client_name"] || "").trim();
      destGroupMeta[groupKey] = {
        rawClientName: client,
        pickupRegion: (pickupRegionsByClient[client]?.size || 0) >= 2
          ? regionOf(String(r["pickup_province"] || "").split(";")[0].trim())
          : null,
      };
    }
  });

  const destByGroupProvince = {}; // groupKey -> province -> { count, byType, addressCounts }
  const destByGroupRegion = {}; // groupKey -> deliveryRegion -> { count, byType }
  const destByGroupTotal = {};
  destScopedRows.forEach((r) => {
    const groupKey = destGroupKeyFor(r);
    const province = String(r["delivery_province"] || "").split(";")[0].trim() || "(chưa rõ)";
    const address = String(r["delivery_address"] || "").trim();
    const deliveryRegion = regionOf(province);
    destByGroupTotal[groupKey] = (destByGroupTotal[groupKey] || 0) + 1;
    if (!destByGroupProvince[groupKey]) destByGroupProvince[groupKey] = {};
    if (!destByGroupProvince[groupKey][province]) {
      destByGroupProvince[groupKey][province] = { count: 0, byType: {}, addressCounts: {} };
    }
    const bucket = destByGroupProvince[groupKey][province];
    bucket.count++;
    for (const t of vehicleTypesOf(r["vehicle_capacity"])) {
      bucket.byType[t] = (bucket.byType[t] || 0) + 1;
    }
    if (address) bucket.addressCounts[address] = (bucket.addressCounts[address] || 0) + 1;

    // Rollup theo Miền GIAO (Bắc/Trung/Nam) trong nội bộ mỗi nhóm — 1 mạng
    // lấy-hàng-1-miền vẫn có thể giao rải nhiều miền, nên vẫn cần rollup
    // này ngay cả sau khi đã tách nhóm theo miền lấy hàng ở trên.
    if (!destByGroupRegion[groupKey]) destByGroupRegion[groupKey] = {};
    if (!destByGroupRegion[groupKey][deliveryRegion]) destByGroupRegion[groupKey][deliveryRegion] = { count: 0, byType: {} };
    const regionBucket = destByGroupRegion[groupKey][deliveryRegion];
    regionBucket.count++;
    for (const t of vehicleTypesOf(r["vehicle_capacity"])) {
      regionBucket.byType[t] = (regionBucket.byType[t] || 0) + 1;
    }
  });

  const destinationBreakdown = Object.entries(destByGroupProvince)
    .map(([clientName, byProvince]) => {
      const totalOrders = destByGroupTotal[clientName] || 0;
      const provinces = Object.entries(byProvince)
        .map(([province, { count, byType, addressCounts }]) => {
          const topAddressEntry = Object.entries(addressCounts).sort((a, b) => b[1] - a[1])[0];
          return {
            province,
            count,
            pct: totalOrders > 0 ? Math.round((count / totalOrders) * 1000) / 10 : 0,
            byVehicleType: byType,
            topAddress: topAddressEntry ? { address: topAddressEntry[0], count: topAddressEntry[1] } : null,
          };
        })
        .sort((a, b) => b.count - a.count);
      const regions = Object.entries(destByGroupRegion[clientName] || {})
        .map(([region, { count, byType }]) => ({
          region,
          count,
          pct: totalOrders > 0 ? Math.round((count / totalOrders) * 1000) / 10 : 0,
          byVehicleType: byType,
        }))
        .sort((a, b) => REGION_ORDER_DEST.indexOf(a.region) - REGION_ORDER_DEST.indexOf(b.region));
      const meta = destGroupMeta[clientName] || {};
      return { clientName, rawClientName: meta.rawClientName || clientName, pickupRegion: meta.pickupRegion || null, totalOrders, regions, provinces };
    })
    .sort((a, b) => b.totalOrders - a.totalOrders);

  const lastSyncedAt = rawRows && rawRows.length > 0
    ? rawRows.reduce((max, r) => (r["synced_at"] > max ? r["synced_at"] : max), rawRows[0]["synced_at"] || "")
    : null;

  return {
    totalOrders: scopedRows.length,
    statusCounts,
    isAfter8pm,
    runningTodayCount: runningTodayOrders.length,
    runningTodayByClient,
    runningTodayVehicleTypes,
    runningTodayOrders: runningTodayOrders.slice(0, 300).map((r) => ({
      orderCode: r["order_code"] || "",
      clientName: r["client_name"] || "",
      createdDate: r["created_date"] || "",
      status: r["status"] || "",
      tripStatus: translateTripStatus(r["trip_status"]),
      plate: r["plate"] || "",
      driver: r["driver"] || "",
      vehicleCapacity: r["vehicle_capacity"] || "",
      requestedVehicleType: r["requested_vehicle_type"] || "",
      pickupAddress: r["pickup_address"] || "",
      deliveryAddress: r["delivery_address"] || "",
    })),
    overdueCount: overdueList.length,
    overdueOrders: overdueList.slice(0, 200).map((r) => ({
      orderCode: r["order_code"] || "",
      clientName: r["client_name"] || "",
      createdDate: r["created_date"] || "",
      status: r["status"] || "",
      tripStatus: translateTripStatus(r["trip_status"]),
      plate: r["plate"] || "",
      driver: r["driver"] || "",
      vehicleCapacity: r["vehicle_capacity"] || "",
      deliveryAddress: r["delivery_address"] || "",
    })),
    orders: orders.slice(0, 1000),
    unassignedCount: unassignedOrders.length,
    unassignedOrders: unassignedOrders.slice(0, 300),
    stalledAssignedCount: stalledAssignedOrders.length,
    stalledAssignedOrders: stalledAssignedOrders.slice(0, 300),
    allClients,
    vehicleTypes,
    clientVehicleMatrix,
    dailyVehicleStats,
    dailyVehicleStatsByProvince,
    dailyVehicleStatsByRegion,
    dailyVehicleStatsOverall,
    dailyVehicleTypes,
    totalDaysInRange,
    destinationBreakdown,
    lastSyncedAt,
  };
}
