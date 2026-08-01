import { google } from 'googleapis';
import fs from 'fs';

// Load service account key from .env.production.local
const envContent = fs.readFileSync('.env.production.local', 'utf8');
const match = envContent.match(/GOOGLE_SERVICE_ACCOUNT_KEY=(.+)/);
if (!match) {
  console.error('No GOOGLE_SERVICE_ACCOUNT_KEY found');
  process.exit(1);
}
const keyJson = JSON.parse(match[1].trim());

const auth = new google.auth.GoogleAuth({
  credentials: keyJson,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

const SHEET_ID = '161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ';

console.log('=== Testing with exact sheet name: Data dự án ===');
try {
  const r = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    ranges: ["'Data dự án'!A1:Z5"],
    includeGridData: true,
  });
  const rows = r.data.sheets[0].data[0].rowData || [];
  console.log('SUCCESS! Row count:', rows.length);
  const headers = (rows[0]?.values || []).map(v => v.formattedValue || '');
  console.log('Headers:', headers);
  if (rows.length > 1) {
    const row1 = (rows[1]?.values || []).map(v => v.formattedValue || '');
    console.log('Row 2 (first data):', row1);
  }
} catch (e) {
  console.error('FAILED:', e.message);
}

console.log('\n=== Also checking actual sheet tab names ===');
try {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tabs = meta.data.sheets.map(s => `"${s.properties.title}"`);
  console.log('Sheet tabs:', tabs.join(', '));
} catch (e) {
  console.error('Meta failed:', e.message);
}
