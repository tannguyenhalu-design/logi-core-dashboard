// IMPORTANT: this merges into existing raw_ontime data by order_code instead
// of blindly replacing it. GHN's source raw_ontime sheet only ever shows a
// recent rolling window of orders (older ones fall off as new ones arrive),
// so a naive clear+replace silently deletes historical rows every run —
// that's exactly what corrupted period-over-period comparisons before this
// fix. Rows whose order_code no longer appears in the fresh export are kept
// as-is; rows present in both use the fresher data from the new export.
//
// Also uses an atomic staging+swap instead of clear-then-append — see
// cloud-scraper/sync_to_db.js for the production incident that motivated
// this (append after clear aborted mid-request, leaving the sheet empty).
const fs = require('fs');
const { google } = require('googleapis');

// Load environment variables
const env = fs.readFileSync('.env.local', 'utf8');
env.split('\n').forEach(l => {
    const m = l.match(/^(.*?)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
});

const SHEET_NAME = 'raw_ontime';
const STAGING_SHEET_NAME = 'raw_ontime_staging';
const ORDER_CODE_COL = 1; // column B

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
    try {
        const key = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, 'utf8'));
        const auth = new google.auth.GoogleAuth({
            credentials: key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        console.log("Reading dump_0.csv...");
        const csvContent = fs.readFileSync('scripts/dump_0.csv', 'utf8');
        const freshRows = csvContent.split('\n').filter(r => r.trim() !== '').map(r => r.split(','));

        if (freshRows.length < 2) {
            console.error("Fresh CSV has no data rows — aborting without touching raw_ontime to avoid data loss.");
            process.exit(1);
        }

        const header = freshRows[0];
        const freshDataRows = freshRows.slice(1);
        console.log(`Found ${freshDataRows.length} data rows in fresh export.`);

        console.log("Reading existing raw_ontime data (if any)...");
        let existingDataRows = [];
        const liveSheetId = await getSheetId(sheets, spreadsheetId, SHEET_NAME);
        if (liveSheetId !== null) {
            const existingRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: "'raw_ontime'!A:AV",
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
            if (!code) continue;
            if (merged.has(code)) updatedCount++; else newCount++;
            merged.set(code, row);
        }

        const mergedRows = Array.from(merged.values());
        const preservedCount = mergedRows.length - newCount - updatedCount;
        console.log(`Merge result: ${mergedRows.length} total rows (${newCount} new, ${updatedCount} refreshed, ${preservedCount} preserved from history that fell out of the source's rolling window).`);

        console.log('Preparing staging sheet...');
        await deleteSheetIfExists(sheets, spreadsheetId, STAGING_SHEET_NAME);
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title: STAGING_SHEET_NAME } } }] },
        });

        const allRows = [header, ...mergedRows];
        const chunkSize = 5000;
        let totalInserted = 0;
        for (let i = 0; i < allRows.length; i += chunkSize) {
            const chunk = allRows.slice(i, i + chunkSize);
            await withRetry(
                // RAW, not USER_ENTERED — see cloud-scraper/sync_to_db.js for why.
                () => sheets.spreadsheets.values.append({
                    spreadsheetId,
                    range: `'${STAGING_SHEET_NAME}'!A1`,
                    valueInputOption: "RAW",
                    resource: { values: chunk }
                }),
                `Append chunk ${Math.floor(i / chunkSize) + 1}`
            );
            totalInserted += chunk.length;
            console.log(`Staged ${totalInserted}/${allRows.length} rows...`);
        }

        console.log('Swapping staging sheet in as the live raw_ontime...');
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

        console.log(`Successfully synced ${totalInserted} rows (merged, history preserved, atomic swap) to DB sheet!`);
    } catch (e) {
        console.error("Error syncing to DB:", e);
        process.exit(1);
    }
}

main();
