// sync_ftl_to_db.js — reads the .xlsx export downloaded by ftl_scraper.py
// (via CDP from portal.ghn.vn's "Xuất dữ liệu" button) and merges it into
// the "raw_ftl_orders" tab, keyed by "Mã đơn GHN" (GHN order code).
//
// Same merge-by-key approach as sync_to_db.js's raw_ontime fix — portal.ghn.vn
// only shows a rolling window of orders (30 days requested here), so a naive
// clear+replace would silently drop older orders that are still open past
// that window. Existing rows not present in the fresh export are kept as-is;
// rows present in both use the fresher data from the new export.
//
// IMPORTANT — atomic staging+swap, not clear-then-append:
// A real production run on 2026-08-16 12:30 hit this exact failure mode —
// the sheet was cleared, then the very first append() call aborted
// (GaxiosError: The operation was aborted, likely a payload-size/timeout
// issue from the long Vietnamese addresses in this data), leaving
// raw_ftl_orders completely EMPTY until the next successful run. Clearing
// the live sheet before the new data is confirmed fully written is
// inherently unsafe. Instead: write the merged data into a fresh
// "raw_ftl_orders_staging" sheet, and only once that fully succeeds, swap
// it in for the live sheet via a single atomic batchUpdate (delete old +
// rename staging). If anything fails before the swap, the live sheet is
// never touched.
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
    'plate', 'driver', 'vehicle_capacity', 'trip_count', // filled in later by ftl_enrich_vehicle.py — not present in the bulk export, so the merge below must preserve these instead of blanking them out
    'trip_status', 'trip_completed', // also filled in later by ftl_enrich_vehicle.py — real per-trip status from mục 5, distinct from "status" (mục 1) which the bulk export overwrites every sync but can stay stale forever on GHN's own side
    'requested_vehicle_type', // also filled in later by ftl_enrich_vehicle.py (order-detail API's vehicle_spec_code) — "Tải trọng" GHN records at order-CREATION time, available even before a real trip/truck exists; also not in the bulk export, preserve on merge like the fields above
    'synced_at',
];
const ORDER_CODE_COL = 4; // index of 'order_code' in HEADERS
const PLATE_COL = HEADERS.indexOf('plate');
const DRIVER_COL = HEADERS.indexOf('driver');
const VEHICLE_CAPACITY_COL = HEADERS.indexOf('vehicle_capacity');
const TRIP_COUNT_COL = HEADERS.indexOf('trip_count');
const TRIP_STATUS_COL = HEADERS.indexOf('trip_status');
const TRIP_COMPLETED_COL = HEADERS.indexOf('trip_completed');
const REQUESTED_VEHICLE_TYPE_COL = HEADERS.indexOf('requested_vehicle_type');
const LAST_COL = String.fromCharCode(65 + HEADERS.length - 1);

const COLUMN_MAP = {
    'Ngày tạo đơn': 'created_date',
    'Ngày lấy thành công': 'pickup_success_date',
    'Ngày giao thành công': 'delivery_success_date',
    'Ngày trả hàng thành công': 'return_success_date',
    'Mã đơn GHN': 'order_code',
    'Mã đơn riêng': 'custom_order_code',
    'Trạng thái': 'status',
    'ID khách hàng': 'client_id',
    'Tên khách hàng': 'client_name',
    'Điểm lấy': 'pickup_point',
    'Tỉnh lấy': 'pickup_province',
    'Địa chỉ lấy': 'pickup_address',
    'Điểm giao': 'delivery_point',
    'Số điểm giao': 'delivery_point_count',
    'Tỉnh giao': 'delivery_province',
    'Địa chỉ giao': 'delivery_address',
};

function getAuth() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY env var');
    const credentials = JSON.parse(keyJson);
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

function readXlsx(filePath) {
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    return rows;
}

async function main() {
    const xlsxPath = process.argv[2];
    if (!xlsxPath || !fs.existsSync(xlsxPath)) {
        console.error('Usage: node sync_ftl_to_db.js <path-to-xlsx>');
        process.exit(1);
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const auth = getAuth();
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log(`Reading ${path.basename(xlsxPath)} ...`);
    const rawRows = readXlsx(xlsxPath);
    console.log(`Found ${rawRows.length} rows in export.`);

    const now = new Date().toISOString();
    const freshDataRows = rawRows
        .map((r) => {
            return HEADERS.map((h) => {
                if (h === 'synced_at') return now;
                const srcKey = Object.keys(COLUMN_MAP).find((k) => COLUMN_MAP[k] === h);
                return srcKey && r[srcKey] !== undefined ? String(r[srcKey]) : '';
            });
        })
        .filter((row) => row[ORDER_CODE_COL]); // drop rows with no order code

    // Live sheet may not exist yet (first-ever run) — that's fine, existing = [].
    console.log('Reading existing raw_ftl_orders data (if any)...');
    let existingDataRows = [];
    const liveSheetId = await getSheetId(sheets, spreadsheetId, SHEET_NAME);
    if (liveSheetId !== null) {
        const existingRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAME}'!A:${LAST_COL}`,
        });
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
    for (const row of freshDataRows) {
        const code = row[ORDER_CODE_COL];
        const existing = merged.get(code);
        if (existing) {
            // Bulk export has no vehicle info — carry over whatever
            // ftl_enrich_vehicle.py already filled in, don't blank it out.
            // Guard: only trust existing[PLATE_COL] etc. if that row actually
            // has enough columns for those indexes to mean what HEADERS says
            // they mean. A shorter row means it predates a HEADERS change
            // (a real incident: an earlier schema migration read a stale
            // row's `synced_at` value into the new `plate` column position,
            // silently marking ~4300 orders as already-enriched with a
            // timestamp masquerading as a plate). Skipping preservation for
            // mismatched rows just means those orders get re-enriched by
            // ftl_enrich_vehicle.py — never a data-loss risk, only extra work.
            if (existing.length >= HEADERS.length) {
                row[PLATE_COL] = existing[PLATE_COL] || '';
                row[DRIVER_COL] = existing[DRIVER_COL] || '';
                row[VEHICLE_CAPACITY_COL] = existing[VEHICLE_CAPACITY_COL] || '';
                row[TRIP_COUNT_COL] = existing[TRIP_COUNT_COL] || '';
                row[TRIP_STATUS_COL] = existing[TRIP_STATUS_COL] || '';
                row[TRIP_COMPLETED_COL] = existing[TRIP_COMPLETED_COL] || '';
                row[REQUESTED_VEHICLE_TYPE_COL] = existing[REQUESTED_VEHICLE_TYPE_COL] || '';
            }
            updatedCount++;
        } else {
            newCount++;
        }
        merged.set(code, row);
    }
    const mergedRows = Array.from(merged.values());
    const preservedCount = mergedRows.length - newCount - updatedCount;
    console.log(`Merge result: ${mergedRows.length} total rows (${newCount} new, ${updatedCount} refreshed, ${preservedCount} preserved outside this run's window).`);

    // ── Write into a fresh staging sheet first — never touch the live one
    // until the new data is fully, successfully written. ──
    console.log('Preparing staging sheet...');
    await deleteSheetIfExists(sheets, spreadsheetId, STAGING_SHEET_NAME);
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: STAGING_SHEET_NAME } } }] },
    });

    const allRows = [HEADERS, ...mergedRows];
    const chunkSize = 2000; // smaller chunks than before — the aborted run above choked on one big request full of long Vietnamese addresses
    let totalInserted = 0;
    for (let i = 0; i < allRows.length; i += chunkSize) {
        const chunk = allRows.slice(i, i + chunkSize);
        await withRetry(
            // RAW, not USER_ENTERED — order_code is an 18-digit numeric
            // string; USER_ENTERED lets Sheets auto-detect it as a number
            // and re-render it in scientific notation (1.2E+17), permanently
            // losing the exact digits. RAW stores the string exactly as given.
            () => sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `'${STAGING_SHEET_NAME}'!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: chunk },
            }),
            `Append chunk ${Math.floor(i / chunkSize) + 1}`
        );
        totalInserted += chunk.length;
        console.log(`Staged ${totalInserted}/${allRows.length} rows...`);
    }

    // ── Staging fully written — now atomically swap it in for the live sheet. ──
    console.log('Swapping staging sheet in as the live raw_ftl_orders...');
    const stagingSheetId = await getSheetId(sheets, spreadsheetId, STAGING_SHEET_NAME);
    const swapRequests = [];
    if (liveSheetId !== null) {
        swapRequests.push({ deleteSheet: { sheetId: liveSheetId } });
    }
    swapRequests.push({
        updateSheetProperties: {
            properties: { sheetId: stagingSheetId, title: SHEET_NAME },
            fields: 'title',
        },
    });
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: swapRequests },
    });

    console.log(`Successfully synced ${totalInserted} FTL order rows (merged, history preserved, atomic swap)!`);

    // Clean up the downloaded file — it's already synced, no need to keep it.
    try { fs.unlinkSync(xlsxPath); } catch (_) {}
}

main().catch((e) => {
    console.error('Error syncing FTL data:', e);
    process.exit(1);
});
