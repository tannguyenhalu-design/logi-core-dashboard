import { google } from "googleapis";
import fs from "fs";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const spreadsheetId = "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
    const keyFile = "C:\\Users\\TanNguyen\\Downloads\\dienmaysd3-7656e6d355df.json";
    const credentials = JSON.parse(fs.readFileSync(keyFile, "utf8"));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    
    // Fetch Data dự án tab
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Data dự án !A1:Z100",
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return res.status(200).json({ ok: true, projects: [] });
    }

    const headers = rows[0].map(h => String(h || "").trim());
    const projects = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx] || "";
      });
      return obj;
    }).filter(p => p["TÊN DỰ ÁN"] && p["TÊN DỰ ÁN"].trim().length > 0);

    return res.status(200).json({ ok: true, projects });
  } catch (err) {
    console.error("[/api/projects] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
