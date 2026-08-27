// list_ftl_orders_needing_vehicle.js — prints a JSON array of order_codes
// (Điện Máy FTL clients only, per FTL_PORTAL_DM_CLIENTS below — keep this
// list in sync with lib/dm-clients.js's FTL_PORTAL_DM_CLIENTS in the main
// app) for ftl_enrich_vehicle.py to visit one at a time. Only ever prints
// the JSON array to stdout — no other logging — since the Python side
// parses stdout directly as JSON.
//
// A "needs visit" order is one where plate is still empty (never enriched)
// OR trip_completed isn't confirmed 'true' yet AND the order's own
// order-level status isn't terminal either — i.e. keep re-checking until
// either the trip is confirmed done or GHN itself closes the order.
// Without this, an order enriched WHILE its trip was still in progress
// (plate set, trip_completed still false/blank) would never get revisited,
// so trip_status/trip_completed would go stale forever once the trip later
// actually finished — same staleness bug as the order-level "status" field,
// just for the field that's supposed to be the reliable one.
const { google } = require('googleapis');

const SHEET_NAME = 'raw_ftl_orders';
const HEADERS = [
    'created_date', 'pickup_success_date', 'delivery_success_date', 'return_success_date',
    'order_code', 'custom_order_code', 'status', 'client_id', 'client_name',
    'pickup_point', 'pickup_province', 'pickup_address',
    'delivery_point', 'delivery_point_count', 'delivery_province', 'delivery_address',
    'plate', 'driver', 'vehicle_capacity', 'trip_count',
    'trip_status', 'trip_completed',
    'requested_vehicle_type',
    'synced_at',
];
const ORDER_CODE_COL = HEADERS.indexOf('order_code');
const CLIENT_NAME_COL = HEADERS.indexOf('client_name');
const STATUS_COL = HEADERS.indexOf('status');
const PLATE_COL = HEADERS.indexOf('plate');
const TRIP_COMPLETED_COL = HEADERS.indexOf('trip_completed');
const LAST_COL = String.fromCharCode(65 + HEADERS.length - 1);

const TERMINAL_ORDER_STATUSES = new Set([
    'Giao thành công', 'Hoàn thành', 'Hủy đơn', 'Giao thất bại', 'Lấy thất bại', 'Trả hàng', 'Hư hỏng',
]);

const FTL_PORTAL_DM_CLIENTS = new Set([
    'SF | AQUA B2B',
    'CÔNG TY CỔ PHẦN THỢ ĐIỆN MÁY XANH',
    'CÔNG TY TNHH HỒNG ĐẠT',
    'CÔNG TY CỔ PHẦN THẾ GIỚI SỐ',
    'CÔNG TY CỔ PHẦN TẬP ĐOÀN KAROFI',
    'CÔNG TY TNHH KEX EXPRESS (VIỆT NAM ) | HISENSE',
    'CÔNG TY  TNHH LIVOTEC',
    'Công Ty Tnhh LX Pantos Việt Nam',
    // Same alias gap fixed in the main app's lib/dm-clients.js
    // (canonicalFTLPortalClientName, 2026-08-26) — without these, orders
    // labeled with these alt names for the same 2 real accounts never even
    // entered this enrichment queue.
    'AQUA B2B',
    'Pantos | LG FTL',
]);

async function main() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAME}'!A:${LAST_COL}`,
    });
    const rows = (res.data.values || []).slice(1);

    // Never-visited orders (the ones padding out "(chưa rõ)" in the matrix)
    // go first — otherwise they'd compete for queue slots against orders
    // that already have a plate and just need their trip_status re-checked,
    // and "(chưa rõ)" would drain far slower than it needs to.
    const neverVisited = [];
    const needsRecheck = [];
    for (const r of rows) {
        if (!FTL_PORTAL_DM_CLIENTS.has(r[CLIENT_NAME_COL])) continue;
        if (!r[PLATE_COL]) { neverVisited.push(r); continue; }
        if (r[TRIP_COMPLETED_COL] === 'true') continue; // confirmed done, no need to recheck
        if (!TERMINAL_ORDER_STATUSES.has(r[STATUS_COL])) needsRecheck.push(r); // still open on GHN's side -> trip status may still change
    }
    const codes = [...neverVisited, ...needsRecheck]
        .map((r) => r[ORDER_CODE_COL])
        .filter(Boolean);

    process.stdout.write(JSON.stringify(codes));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
