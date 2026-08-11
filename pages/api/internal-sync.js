import { google } from "googleapis";
import { getAuth, invalidateCache } from "../../lib/sheets";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb', // Allows large JSON payloads
    },
  },
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const { tabName, data } = req.body;
  if (!tabName || !data || !Array.isArray(data)) {
    return res.status(400).json({ error: "Invalid payload. Expected { tabName, data: [][] }" });
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // First ensure the sheet exists or create it
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some((s) => s.properties.title === tabName);
    
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: [{ addSheet: { properties: { title: tabName } } }] },
      });
    }

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${tabName}'!A:ZZ`,
    });

    // Write new data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: data },
    });

    // Invalidate local Next.js cache
    invalidateCache(`sheet:${spreadsheetId}:${tabName}`);
    invalidateCache(`users:${spreadsheetId}:${tabName}`);

    res.status(200).json({ ok: true, rowsInserted: data.length });
  } catch (error) {
    console.error("[internal-sync] Error syncing data:", error);
    res.status(500).json({ error: error.message });
  }
}
