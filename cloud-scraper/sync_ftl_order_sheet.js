// sync_ftl_order_sheet.js — reads the "FTL_order" tab of the xlsx export that
// GHN's tech team provides (a periodically-synced Google Sheet, downloaded by
// hand via File > Download) and merges it into "raw_ftl_orders", the same
// tab lib/transform-ftl-live.js already reads for the FTL dashboard tab.
//
// Replaces cloud-scraper/ftl_scraper.py + sync_ftl_to_db.js (CDP-scraped
// portal.ghn.vn "Quản lý đơn hàng" export) AND update_ftl_vehicle_info.js /
// ftl_enrich_vehicle.py (CDP-scraped per-trip vehicle info) — per user
// instruction 2026-08-27, no more CDP access to portal.ghn.vn for FTL data.
// This one source already carries what both of those pipelines used to
// piece together separately: order status, trip status, AND vehicle
// plate/type — the two old fields it genuinely lacks (driver name,
// requested_vehicle_type) are preserved from whatever's already on the live
// sheet, and will just stay blank for orders that never had CDP enrichment.
//
// Usage:
//   node sync_ftl_order_sheet.js <path-to-xlsx>              # dry run (default) — prints mapping summary, writes nothing
//   node sync_ftl_order_sheet.js <path-to-xlsx> --live         # actually merges into raw_ftl_orders
//
// Same merge-by-order_code + atomic staging+swap safety as sync_ftl_to_db.js
// (see that file's header comment for why: a naive clear+append that aborts
// mid-write has actually happened in production and emptied the live sheet).
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { google } = require('googleapis');

const SHEET_NAME = 'raw_ftl_orders';
const STAGING_SHEET_NAME = 'raw_ftl_orders_staging';
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
const DRIVER_COL = HEADERS.indexOf('driver');
const REQUESTED_VEHICLE_TYPE_COL = HEADERS.indexOf('requested_vehicle_type');
const LAST_COL = String.fromCharCode(65 + HEADERS.length - 1);

// order_status vocabulary confirmed 2026-08-27 against a real 7,113-row
// FTL_order export — exactly the same 11 distinct values
// lib/transform-ftl-live.js's own header comment says it confirmed against
// the OLD portal-scraped raw_ftl_orders on 2026-08-16 ("Full status
// vocabulary confirmed... 11 distinct values seen") — same vocabulary, this
// is GHN's own backend enum surfacing through both paths. Translated to the
// exact Vietnamese strings that file's DONE_STATUSES/ISSUE_STATUSES/
// CREATED_STATUS already key off, so transform-ftl-live.js needs NO changes.
const ORDER_STATUS_VI = {
    CREATED: 'Đã tạo',
    PICKED: 'Lấy thành công',
    IN_TRANSIT: 'Đang vận chuyển',
    PARTIALLY_DELIVERED: 'Đã giao một phần',
    DELIVERED: 'Giao thành công',
    COMPLETED: 'Hoàn thành',
    CANCELLED: 'Hủy đơn',
    DELIVERY_EXCEPTION: 'Giao thất bại',
    PICKUP_EXCEPTION: 'Lấy thất bại',
    RETURNED: 'Trả hàng',
    DAMAGED: 'Hư hỏng',
};

// trip_status here is already PLANNED/ASSIGNED/IN_TRANSIT/COMPLETED/CANCELLED
// — the exact same English enum lib/transform-ftl-live.js's TRIP_STATUS_VI
// already translates for display, and isTripCompleted() already checks
// String(trip_completed).toLowerCase()==="true" — pass through unchanged.
function mapTripCompleted(tripStatus) {
    return String(tripStatus || '').trim() === 'COMPLETED' ? 'true' : '';
}

// vehicle_capacity_value is a raw payload figure in KG (1900/2000/5000/8000/
// ...) — no vehicle_type breakdown by class in this source (vehicle_type is
// just the literal string "truck"). The existing dashboard code only needs a
// short label like "1.9T"/"5T"/"8T" (vehicleTypesOf() in
// lib/transform-ftl-live.js splits on "+" and sorts by parseFloat) — this is
// a straight unit conversion, not a lookup table, so it stays correct even
// if GHN's fleet mix changes.
function mapVehicleCapacity(valueKg) {
    const n = Number(valueKg);
    if (!n || n <= 0) return '';
    const tons = Math.round((n / 1000) * 10) / 10;
    return `${tons}T`;
}

// created_at/updated_at arrive as "YYYY-MM-DD HH:MM:SS.ffffff" — the rest of
// raw_ftl_orders (parseVNDate in lib/transform-ftl-live.js) expects
// "DD/MM/YYYY", so convert here rather than touching that already
// heavily-tuned file.
function toDDMMYYYY(isoLike) {
    const s = String(isoLike || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y}`;
}

function countDeliveryStops(stopPointsRaw) {
    const s = String(stopPointsRaw || '').trim();
    if (!s) return '';
    try {
        const stops = JSON.parse(s);
        if (!Array.isArray(stops)) return '';
        return String(stops.filter((st) => String(st.stop_type || '').toUpperCase() === 'DELIVERY').length);
    } catch {
        return '';
    }
}

function readFtlOrderSheet(xlsxPath) {
    const wb = XLSX.readFile(xlsxPath);
    const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'ftl_order');
    if (!sheetName) {
        throw new Error(`Không tìm thấy tab "FTL_order" trong file. Các tab có: ${wb.SheetNames.join(', ')}`);
    }
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
}

function mapRow(r, now) {
    const orderStatusRaw = String(r['order_status'] || '').trim().toUpperCase();
    const statusVi = ORDER_STATUS_VI[orderStatusRaw];
    const tripStatus = String(r['trip_status'] || '').trim();
    const row = HEADERS.map(() => '');
    row[HEADERS.indexOf('created_date')] = toDDMMYYYY(r['created_at']);
    row[ORDER_CODE_COL] = String(r['order_number'] || '').trim();
    row[HEADERS.indexOf('custom_order_code')] = String(r['shipment_number'] || '').trim();
    row[HEADERS.indexOf('status')] = statusVi || orderStatusRaw; // unknown code -> keep raw so it's visible, not silently blank
    row[HEADERS.indexOf('client_id')] = String(r['client_id'] || '').trim();
    row[HEADERS.indexOf('client_name')] = String(r['client_name'] || '').trim();
    row[HEADERS.indexOf('pickup_province')] = String(r['ship_from_province'] || '').trim();
    row[HEADERS.indexOf('pickup_address')] = String(r['ship_from_full_address'] || '').trim();
    row[HEADERS.indexOf('delivery_point_count')] = countDeliveryStops(r['stop_points']);
    row[HEADERS.indexOf('delivery_province')] = String(r['ship_to_province'] || '').trim();
    row[HEADERS.indexOf('delivery_address')] = String(r['ship_to_full_address'] || '').trim();
    row[HEADERS.indexOf('plate')] = String(r['license_plate'] || '').trim();
    row[HEADERS.indexOf('vehicle_capacity')] = mapVehicleCapacity(r['vehicle_capacity_value']);
    row[HEADERS.indexOf('trip_count')] = String(r['trip_code'] || '').trim() ? '1' : '0';
    row[HEADERS.indexOf('trip_status')] = tripStatus;
    row[HEADERS.indexOf('trip_completed')] = mapTripCompleted(tripStatus);
    row[HEADERS.indexOf('synced_at')] = now;
    return row;
}

function getAuth() {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    if (keyFile) return new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY(_FILE) env var');
    return new google.auth.GoogleAuth({ credentials: JSON.parse(keyJson), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function withRetry(fn, label, attempts = 4) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); } catch (e) {
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
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId } }] } });
}

async function main() {
    const xlsxPath = process.argv[2];
    const live = process.argv.includes('--live');
    if (!xlsxPath || !fs.existsSync(xlsxPath)) {
        console.error('Usage: node sync_ftl_order_sheet.js <path-to-xlsx> [--live]');
        process.exit(1);
    }

    console.log(`Reading "FTL_order" tab from ${path.basename(xlsxPath)} ...`);
    const rawRows = readFtlOrderSheet(xlsxPath);
    console.log(`Found ${rawRows.length} rows.`);

    const now = new Date().toISOString();
    const unknownStatuses = new Set();
    const freshRows = rawRows
        .map((r) => {
            const orderStatusRaw = String(r['order_status'] || '').trim().toUpperCase();
            if (orderStatusRaw && !ORDER_STATUS_VI[orderStatusRaw]) unknownStatuses.add(orderStatusRaw);
            return mapRow(r, now);
        })
        .filter((row) => row[ORDER_CODE_COL]);

    // ── Mapping summary — always printed, dry-run or live ──
    const statusCounts = {};
    freshRows.forEach((row) => { const s = row[HEADERS.indexOf('status')]; statusCounts[s] = (statusCounts[s] || 0) + 1; });
    console.log('\nMapped status counts:', JSON.stringify(statusCounts, null, 2));
    if (unknownStatuses.size > 0) {
        console.log(`⚠️ Unknown order_status codes (kept as raw uppercase, not translated): ${[...unknownStatuses].join(', ')}`);
    }
    console.log('\nSample mapped rows (first 3):');
    freshRows.slice(0, 3).forEach((row) => {
        const obj = {};
        HEADERS.forEach((h, i) => { obj[h] = row[i]; });
        console.log(JSON.stringify(obj, null, 2));
    });

    if (!live) {
        console.log('\n[DRY RUN] Nothing written. Re-run with --live to merge into raw_ftl_orders.');
        return;
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const auth = getAuth();
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log('\nReading existing raw_ftl_orders data (if any)...');
    let existingDataRows = [];
    const liveSheetId = await getSheetId(sheets, spreadsheetId, SHEET_NAME);
    if (liveSheetId !== null) {
        const existingRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SHEET_NAME}'!A:${LAST_COL}` });
        const existingRows = existingRes.data.values || [];
        existingDataRows = existingRows.length > 0 ? existingRows.slice(1) : [];
    }
    console.log(`Found ${existingDataRows.length} existing data rows.`);

    const merged = new Map();
    for (const row of existingDataRows) {
        const code = row[ORDER_CODE_COL];
        if (code) merged.set(code, row);
    }
    let newCount = 0, updatedCount = 0;
    for (const row of freshRows) {
        const code = row[ORDER_CODE_COL];
        const existing = merged.get(code);
        if (existing) {
            // driver / requested_vehicle_type aren't in this source at all —
            // keep whatever the old CDP-enrichment pipeline already captured
            // rather than blanking it out. Everything else (status, plate,
            // vehicle_capacity, trip_status, trip_completed) comes fresh from
            // FTL_order now, since it's the authoritative source going
            // forward — no reason to prefer stale scraped data over it.
            if (existing.length >= HEADERS.length) {
                row[DRIVER_COL] = existing[DRIVER_COL] || '';
                row[REQUESTED_VEHICLE_TYPE_COL] = existing[REQUESTED_VEHICLE_TYPE_COL] || '';
            }
            updatedCount++;
        } else {
            newCount++;
        }
        merged.set(code, row);
    }
    const mergedRows = Array.from(merged.values());
    console.log(`Merge result: ${mergedRows.length} total rows (${newCount} new, ${updatedCount} refreshed, ${mergedRows.length - newCount - updatedCount} preserved outside this export).`);

    console.log('Preparing staging sheet...');
    await deleteSheetIfExists(sheets, spreadsheetId, STAGING_SHEET_NAME);
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: STAGING_SHEET_NAME } } }] } });

    const allRows = [HEADERS, ...mergedRows];
    const chunkSize = 2000;
    let totalInserted = 0;
    for (let i = 0; i < allRows.length; i += chunkSize) {
        const chunk = allRows.slice(i, i + chunkSize);
        await withRetry(
            () => sheets.spreadsheets.values.append({ spreadsheetId, range: `'${STAGING_SHEET_NAME}'!A1`, valueInputOption: 'RAW', requestBody: { values: chunk } }),
            `Append chunk ${Math.floor(i / chunkSize) + 1}`
        );
        totalInserted += chunk.length;
        console.log(`Staged ${totalInserted}/${allRows.length} rows...`);
    }

    console.log('Swapping staging sheet in as the live raw_ftl_orders...');
    const stagingSheetId = await getSheetId(sheets, spreadsheetId, STAGING_SHEET_NAME);
    const swapRequests = [];
    if (liveSheetId !== null) swapRequests.push({ deleteSheet: { sheetId: liveSheetId } });
    swapRequests.push({ updateSheetProperties: { properties: { sheetId: stagingSheetId, title: SHEET_NAME }, fields: 'title' } });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: swapRequests } });

    console.log(`\n✅ Successfully synced ${totalInserted} FTL order rows into raw_ftl_orders.`);
}

main().catch((e) => {
    console.error('Error syncing FTL_order sheet:', e);
    process.exit(1);
});
