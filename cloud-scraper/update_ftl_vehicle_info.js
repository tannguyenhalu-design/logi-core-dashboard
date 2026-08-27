// update_ftl_vehicle_info.js <path-to-updates.json>
// updates.json: { "<order_code>": { "plate": "...", "driver": "...", "vehicleCapacity": "..." }, ... }
// Merges plate/driver/vehicle_capacity into matching rows of raw_ftl_orders,
// using the same staging+swap pattern as sync_ftl_to_db.js (never clear the
// live sheet before the new version is fully written).
const fs = require('fs');
const { google } = require('googleapis');

const SHEET_NAME = 'raw_ftl_orders';
const STAGING_SHEET_NAME = 'raw_ftl_orders_staging';
const HEADERS = [
    'created_date', 'pickup_success_date', 'delivery_success_date', 'return_success_date',
    'order_code', 'custom_order_code', 'status', 'client_id', 'client_name',
    'pickup_point', 'pickup_province', 'pickup_address',
    'delivery_point', 'delivery_point_count', 'delivery_province', 'delivery_address',
    'plate', 'driver', 'vehicle_capacity', 'trip_count',
    'trip_status', 'trip_completed', // trạng thái CHUYẾN thực tế (mục 5 trang chi tiết) — khác "status" (Trạng thái đơn, mục 1) vốn có thể không bao giờ được GHN cập nhật dù chuyến đã xong
    'requested_vehicle_type', // "Tải trọng" GHN ghi nhận lúc TẠO ĐƠN (mục 1) — có sẵn cả khi chưa gán xe/chuyến thật, khác vehicle_capacity ở trên (chỉ có SAU khi có chuyến)
    'synced_at',
];
const ORDER_CODE_COL = HEADERS.indexOf('order_code');
const PLATE_COL = HEADERS.indexOf('plate');
const DRIVER_COL = HEADERS.indexOf('driver');
const VEHICLE_CAPACITY_COL = HEADERS.indexOf('vehicle_capacity');
const TRIP_COUNT_COL = HEADERS.indexOf('trip_count');
const TRIP_STATUS_COL = HEADERS.indexOf('trip_status');
const TRIP_COMPLETED_COL = HEADERS.indexOf('trip_completed');
const REQUESTED_VEHICLE_TYPE_COL = HEADERS.indexOf('requested_vehicle_type');
const LAST_COL = String.fromCharCode(65 + HEADERS.length - 1);

function getAuth() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(fn, label, attempts = 4) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const wait = 2000 * (i + 1);
            console.warn(`${label} failed (attempt ${i + 1}/${attempts}): ${e.message} — retrying in ${wait}ms`);
            await sleep(wait);
        }
    }
    throw lastErr;
}

async function getSheetId(sheets, spreadsheetId, title) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const s = meta.data.sheets.find((sh) => sh.properties.title === title);
    return s ? s.properties.sheetId : null;
}

async function deleteSheetIfExists(sheets, spreadsheetId, title) {
    const sheetId = await getSheetId(sheets, spreadsheetId, title);
    if (sheetId === null) return;
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId } }] },
    });
}

async function main() {
    const jsonPath = process.argv[2];
    if (!jsonPath || !fs.existsSync(jsonPath)) {
        console.error('Usage: node update_ftl_vehicle_info.js <path-to-updates.json>');
        process.exit(1);
    }
    const updates = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const codes = Object.keys(updates);
    console.log(`Applying vehicle info for ${codes.length} orders...`);

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const auth = getAuth();
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const liveSheetId = await getSheetId(sheets, spreadsheetId, SHEET_NAME);
    if (liveSheetId === null) {
        console.error('raw_ftl_orders does not exist yet — nothing to update.');
        process.exit(1);
    }

    const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAME}'!A:${LAST_COL}`,
    });
    const existingRows = existingRes.data.values || [];
    // Always write back the CURRENT HEADERS constant, never the sheet's own
    // existing header row. Reusing existingRows[0] verbatim was the actual
    // root cause of a real incident (2026-08-16): if this script ran before
    // any sync_ftl_to_db.js bulk sync had migrated the header row to match
    // a HEADERS change, the sheet kept an old, shorter header (labels only
    // up to the old last column) while this script kept writing values at
    // the NEW column positions (e.g. trip_status at index 20) — column
    // labels and column data silently fell out of sync. sync_ftl_to_db.js
    // already does this correctly (writes HEADERS, not existingRows[0]);
    // this script must match.
    const header = HEADERS;
    const dataRows = existingRows.slice(1);

    let appliedCount = 0;
    let skippedShort = 0;
    for (const row of dataRows) {
        const code = row[ORDER_CODE_COL];
        const u = updates[code];
        if (!u) continue;
        // A row shorter than HEADERS.length predates a column-count change
        // (e.g. it hasn't been through a fresh sync_ftl_to_db.js merge
        // since trip_status/trip_completed were added). Blindly padding it
        // with row.push('') would put THIS row's real trailing values (e.g.
        // its old synced_at timestamp) at whatever index the NEW schema
        // happens to assign to a middle column like trip_status — a real
        // incident on 2026-08-16 that corrupted trip_status sheet-wide this
        // way. Skip instead: the next sync_ftl_to_db.js bulk sync rebuilds
        // every row to the full current width from fresh export data, and
        // this order stays in the "needs enrichment" queue until then — no
        // permanent loss, just one extra cycle of delay for this one row.
        if (row.length < HEADERS.length) {
            skippedShort++;
            continue;
        }
        if (u.plate) row[PLATE_COL] = u.plate;
        if (u.driver) row[DRIVER_COL] = u.driver;
        if (u.vehicleCapacity) row[VEHICLE_CAPACITY_COL] = u.vehicleCapacity;
        if (u.tripCount) row[TRIP_COUNT_COL] = String(u.tripCount);
        if (u.tripStatus) row[TRIP_STATUS_COL] = u.tripStatus;
        if (u.tripCompleted !== null && u.tripCompleted !== undefined) row[TRIP_COMPLETED_COL] = u.tripCompleted ? 'true' : 'false';
        if (u.requestedVehicleType) row[REQUESTED_VEHICLE_TYPE_COL] = u.requestedVehicleType;
        appliedCount++;
    }
    console.log(`Matched and updated ${appliedCount}/${codes.length} rows.${skippedShort > 0 ? ` (${skippedShort} skipped — pre-migration row width, will retry after next bulk sync)` : ''}`);

    console.log('Preparing staging sheet...');
    await deleteSheetIfExists(sheets, spreadsheetId, STAGING_SHEET_NAME);
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: STAGING_SHEET_NAME } } }] },
    });

    const allRows = [header, ...dataRows];
    const chunkSize = 2000;
    let totalInserted = 0;
    for (let i = 0; i < allRows.length; i += chunkSize) {
        const chunk = allRows.slice(i, i + chunkSize);
        await withRetry(
            () => sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `'${STAGING_SHEET_NAME}'!A1`,
                valueInputOption: 'RAW', // see sync_ftl_to_db.js — USER_ENTERED corrupts long numeric order_code strings into scientific notation
                requestBody: { values: chunk },
            }),
            `Append chunk ${Math.floor(i / chunkSize) + 1}`
        );
        totalInserted += chunk.length;
    }

    console.log('Swapping staging sheet in as the live raw_ftl_orders...');
    const stagingSheetId = await getSheetId(sheets, spreadsheetId, STAGING_SHEET_NAME);
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                { deleteSheet: { sheetId: liveSheetId } },
                { updateSheetProperties: { properties: { sheetId: stagingSheetId, title: SHEET_NAME }, fields: 'title' } },
            ],
        },
    });

    console.log(`Successfully applied vehicle info to ${appliedCount} orders (atomic swap)!`);

    try { fs.unlinkSync(jsonPath); } catch (_) {}
}

main().catch((e) => {
    console.error('Error updating vehicle info:', e);
    process.exit(1);
});
