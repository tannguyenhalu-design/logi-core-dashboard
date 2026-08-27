// Cloud version of scripts/sync_to_db.js — reads the service account key from
// the GOOGLE_SERVICE_ACCOUNT_KEY env var (raw JSON string, same convention
// the main app already uses on Vercel) instead of a local key file, since
// there's no .env.local on the container. Everything else is unchanged.
//
// IMPORTANT: this merges into existing raw_ontime data by order_code instead
// of blindly replacing it. GHN's source raw_ontime sheet only ever shows a
// recent rolling window of orders (older ones fall off as new ones arrive),
// so a naive clear+replace silently deletes historical rows every run —
// that's exactly what corrupted period-over-period comparisons before this
// fix. Rows whose order_code no longer appears in the fresh export are kept
// as-is; rows present in both use the fresher data from the new export.
//
// Also uses an atomic staging+swap instead of clear-then-append: the FTL
// sync (same pattern, see cloud-scraper/sync_ftl_to_db.js) hit a real
// production incident where the append() after clear() aborted mid-request,
// leaving the sheet completely empty until the next run. Writing into a
// fresh staging sheet and only swapping it in once fully written means the
// live sheet is never touched unless the new data is 100% ready.
const fs = require('fs');
const { google } = require('googleapis');

const SHEET_NAME = 'raw_ontime';
const STAGING_SHEET_NAME = 'raw_ontime_staging';
const ORDER_CODE_COL = 1; // column B

function getAuth() {
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
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
    try {
        const auth = getAuth();
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        console.log("Reading dump_0.csv...");
        const csvContent = fs.readFileSync('/app/dump_0.csv', 'utf8');
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
                // RAW, not USER_ENTERED — order_code is an 18-digit numeric
                // string; USER_ENTERED lets Sheets auto-detect it as a number
                // and re-render it in scientific notation (1.2E+17),
                // permanently losing the exact digits (confirmed happening
                // on the FTL sync, same append pattern). The app reads this
                // sheet with UNFORMATTED_VALUE/FORMATTED_STRING and parses
                // dates itself, so it never relied on Sheets' native type
                // detection anyway.
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
