// check_sync_trigger.js — reads the "ftl_sync_control" sheet (a single
// control row: requested_at | requested_by | completed_at | note) that
// pages/api/ftl-sync-now.js writes to when someone clicks "Đồng bộ ngay"
// on the dashboard. Exits 0 (should run) if a request is newer than the
// last completion, exits 1 (nothing to do) otherwise. No public port is
// exposed for this on Railway (the noVNC port already occupies the
// service's one allowed domain), so the trigger works entirely through
// Google Sheets — the one channel both the Vercel app and this container
// already talk to reliably.
const { google } = require('googleapis');

async function main() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'ftl_sync_control'!A2:C2`,
    });
    const row = (res.data.values || [])[0] || [];
    const requestedAt = row[0] || '';
    const completedAt = row[2] || '';

    const pending = requestedAt && (!completedAt || new Date(requestedAt) > new Date(completedAt));
    process.exit(pending ? 0 : 1);
}

main().catch((e) => {
    console.error('check_sync_trigger error:', e.message);
    process.exit(1); // fail closed — a broken check should never force a sync
});
