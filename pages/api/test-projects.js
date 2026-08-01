import { getAuth } from "../../lib/sheets";
import { google } from "googleapis";
import fs from "fs";
import path from "path";

const PIC_MAILS = ["tutd@ghn.vn", "diennk@giaohangnhanh.vn", "datnt2@ghn.vn"];

export default async function handler(req, res) {
  const storePath = path.join(process.cwd(), "lib", "projects-store.json");

  // Read local store overrides
  let store = { projects: {} };
  try {
    if (fs.existsSync(storePath)) {
      const content = fs.readFileSync(storePath, "utf8");
      if (content.trim()) {
        store = JSON.parse(content);
      }
    }
  } catch (err) {
    console.error("Failed to read projects-store.json", err);
  }

  const ltlProjectsId = "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Fetch spreadsheet data with GridData to extract embedded hyperlinks
    const response = await sheets.spreadsheets.get({
      spreadsheetId: ltlProjectsId,
      ranges: ["'Data dự án'!A1:Z100"],
      includeGridData: true,
    });

    const sheet = response.data.sheets[0];
    const rowData = sheet.data[0].rowData || [];
    if (rowData.length === 0) {
      return res.status(200).json({ ok: true, projects: [], message: "rowData empty" });
    }

    const headers = (rowData[0].values || []).map(v => String(v.formattedValue || "").trim());

    let volumeIdx = headers.indexOf("Dự kiến Volume");
    if (volumeIdx === -1) {
      volumeIdx = headers.indexOf("Dự kiến Vollume");
    }
    if (volumeIdx === -1) {
      const col12Idx = headers.indexOf("Cột 12");
      if (col12Idx !== -1) {
        try {
          await sheets.spreadsheets.values.update({
            spreadsheetId: ltlProjectsId,
            range: "'Data dự án'!L1",
            valueInputOption: "USER_ENTERED",
            resource: { values: [["Dự kiến Volume"]] },
          });
          volumeIdx = col12Idx;
          headers[volumeIdx] = "Dự kiến Volume";
        } catch (renameErr) {
          console.warn("Could not rename cell L1:", renameErr.message);
        }
      }
    }

    const sheetProjects = rowData.slice(1).map(row => {
      const obj = {};
      const vals = row.values || [];
      headers.forEach((h, idx) => {
        const cell = vals[idx] || {};
        const text = cell.formattedValue || "";
        const link = cell.hyperlink || "";
        
        if (h === "LINK SOP") {
          obj[h] = link || text;
        } else {
          obj[h] = text;
        }
      });
      return obj;
    }).filter(p => p["TÊN DỰ ÁN"] && p["TÊN DỰ ÁN"].trim().length > 0);

    const mergedProjects = sheetProjects.map(p => {
      const name = String(p["TÊN DỰ ÁN"] || "").trim();
      const local = store.projects[name] || {};

      const sheetStatus = String(p["TRẠNG THÁI"] || "").trim();
      const sheetSopLink = String(p["LINK SOP"] || "").trim();

      let defaultRecapStatus = "Chưa thực hiện";
      let defaultSopStatus = "Chưa thực hiện";
      let defaultKickoffStatus = "Chưa thực hiện";

      if (sheetStatus === "Done") {
        defaultRecapStatus = "Done";
        defaultSopStatus = "Done";
        defaultKickoffStatus = "Done";
      } else if (p["CÔNG VIỆC"] === "Viết SOP" || sheetSopLink) {
        defaultRecapStatus = "Done";
        defaultSopStatus = "Đang thực hiện";
      }

      return {
        name,
        clientId:            p["Clinet ID"] || "",
        checklist:           local.notes !== undefined ? local.notes : (p["CHECK LIST CÔNG VIỆC"] || ""),
        pic:                 local.pic !== undefined ? local.pic : (p["ĐẢM NHIỆM"] || ""),
        status:              local.status !== undefined ? local.status : (p["TRẠNG THÁI"] || "Đang thực hiện"),
        job:                 local.job !== undefined ? local.job : (p["CÔNG VIỆC"] || ""),
        expectedOb:          local.expectedOb !== undefined ? local.expectedOb : (p["Dự kiến OB "] || p["Dự kiến OB"] || ""),
        revenue:             local.revenue !== undefined ? local.revenue : (p["Doanh Thu dự kiến"] || ""),
        sopLink:             local.sopLink !== undefined ? local.sopLink : sheetSopLink,
        model:               local.model !== undefined ? local.model : (p["MÔ HÌNH VẬN HÀNH"] || ""),
        slaLogic:            p["Logic SLA"] || "",
        volume:              local.volume !== undefined ? local.volume : (p["Dự kiến Volume"] || p["Dự kiến Vollume"] || p["Cột 12"] || ""),
        
        recapStatus:         local.recapStatus || defaultRecapStatus,
        recapLink:           local.recapLink || "",
        sopStatus:           local.sopStatus || defaultSopStatus,
        kickoffStatus:       local.kickoffStatus || defaultKickoffStatus,

        notes:               local.notes !== undefined ? local.notes : (p["CHECK LIST CÔNG VIỆC"] || ""),
        updatedAt:           local.updatedAt || null,
        updatedBy:           local.updatedBy || null,
      };
    });

    return res.status(200).json({ 
      ok: true, 
      projects: mergedProjects,
      user: {
        role: "manager",
        email: "test@example.com",
        name: "Test User",
        pic: null
      }
    });
  } catch (err) {
    console.error("[/api/test-projects] error:", err);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
