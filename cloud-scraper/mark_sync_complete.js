// mark_sync_complete.js — writes completed_at = now to the ftl_sync_control
// sheet after check_and_run_sync.sh finishes a manually-triggered sync, so
// check_sync_trigger.js stops reporting the request as pending.
const { google } = require('googleapis');

async function main() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'ftl_sync_control'!C2`,
        valueInputOption: 'RAW',
        requestBody: { values: [[new Date().toISOString()]] },
    });
    console.log('Marked FTL sync complete.');
}

main().catch((e) => {
    console.error('mark_sync_complete error:', e.message);
    process.exit(1);
});
