/**
 * pages/api/diag-sheets.js — TẠM THỜI, chỉ dùng để chẩn đoán lỗi phân quyền
 * Xóa file này sau khi fix xong.
 * Yêu cầu đăng nhập + role manager.
 */
import { getSession } from "../../lib/auth";
import { getAuth } from "../../lib/sheets";
import { google } from "googleapis";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user || session.user.role !== "manager") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID || "(not set)";

  let saEmail = "(unknown)";
  let writeOk = false;
  let writeError = "";

  try {
    const auth = await getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Đọc thông tin service account từ credentials
    const creds = auth.jsonContent || (auth._options && auth._options.credentials);
    if (creds && creds.client_email) saEmail = creds.client_email;

    // Test write vào AuditLog
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "'AuditLog'!A:E",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [["__DIAG_TEST__", new Date().toISOString(), "diag-sheets", "ok", ""]],
      },
    });
    writeOk = true;

    // Xóa test row
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "'AuditLog'!A:A",
    });
    const rows = resp.data.values || [];
    const idx = rows.findIndex((r) => r[0] === "__DIAG_TEST__");
    if (idx >= 0) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sheetObj = meta.data.sheets.find((s) => s.properties.title === "AuditLog");
      if (sheetObj) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          resource: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId: sheetObj.properties.sheetId,
                  dimension: "ROWS",
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            }],
          },
        });
      }
    }
  } catch (err) {
    writeError = err.message;
  }

  return res.status(200).json({
    sheetId,
    saEmail,
    writeOk,
    writeError: writeError || null,
    env: process.env.NODE_ENV,
  });
}
