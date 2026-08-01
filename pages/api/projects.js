import { fetchSheet } from "../../lib/sheets";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";
import fs from "fs";
import path from "path";

const PIC_MAILS = ["tutd@ghn.vn", "diennk@giaohangnhanh.vn", "datnt2@ghn.vn"];

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

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

  if (req.method === "GET") {
    try {
      // Fetch data from live sheet
      const sheetProjects = await fetchSheet("Data dự án ", ltlProjectsId);

      // Merge Google Sheet row data with local dashboard overrides
      const mergedProjects = sheetProjects.map(p => {
        const name = String(p["TÊN DỰ ÁN"] || "").trim();
        const local = store.projects[name] || {};

        // Compute step statuses based on sheet columns if not overridden
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
          checklist:           p["CHECK LIST CÔNG VIỆC"] || "",
          pic:                 local.pic !== undefined ? local.pic : (p["ĐẢM NHIỆM"] || ""),
          status:              local.status !== undefined ? local.status : (p["TRẠNG THÁI"] || "Đang thực hiện"),
          job:                 local.job !== undefined ? local.job : (p["CÔNG VIỆC"] || ""),
          expectedOb:          local.expectedOb !== undefined ? local.expectedOb : (p["Dự kiến OB "] || ""),
          revenue:             local.revenue !== undefined ? local.revenue : (p["Doanh Thu dự kiến"] || ""),
          sopLink:             local.sopLink !== undefined ? local.sopLink : sheetSopLink,
          model:               local.model !== undefined ? local.model : (p["MÔ HÌNH VẬN HÀNH"] || ""),
          slaLogic:            p["Logic SLA"] || "",
          
          // Hybrid detailed steps (Recap -> SOP -> Kickoff)
          recapStatus:         local.recapStatus || defaultRecapStatus,
          recapLink:           local.recapLink || "",
          sopStatus:           local.sopStatus || defaultSopStatus,
          kickoffStatus:       local.kickoffStatus || defaultKickoffStatus,

          notes:               local.notes || p["CHECK LIST CÔNG VIỆC"] || "",
          updatedAt:           local.updatedAt || null,
          updatedBy:           local.updatedBy || null,
        };
      });

      // Detect user role & matched email
      const userEmail = String(session.user.email || "").toLowerCase();
      const userName = String(session.user.name || "").trim();

      let userRole = "manager";
      let userPIC = null;

      const matchedPic = PIC_MAILS.find(email => 
        email.toLowerCase() === userEmail ||
        userName.toLowerCase().includes(email.split("@")[0])
      );

      const isAdmin = userEmail.includes("tannguyen") || userName.toLowerCase().includes("tannguyen") || userEmail === "admin@ghn.vn";

      if (matchedPic && !isAdmin) {
        userRole = "pic";
        userPIC = matchedPic;
      }

      return res.status(200).json({ 
        ok: true, 
        projects: mergedProjects,
        user: {
          role: userRole,
          email: userEmail,
          name: userName,
          pic: userPIC
        }
      });
    } catch (err) {
      console.error("[/api/projects] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { name, pic, status, job, expectedOb, revenue, sopLink, model, recapStatus, recapLink, sopStatus, kickoffStatus, notes } = req.body;
      if (!name) return res.status(400).json({ error: "Missing project name" });

      const key = String(name).trim();
      const userName = session.user.name || session.user.email;

      if (!store.projects) {
        store.projects = {};
      }

      // Merge updates into local store overrides
      store.projects[key] = {
        ...(store.projects[key] || {}),
        pic,
        status,
        job,
        expectedOb,
        revenue,
        sopLink,
        model,
        recapStatus,
        recapLink,
        sopStatus,
        kickoffStatus,
        notes,
        updatedAt: new Date().toISOString(),
        updatedBy: userName,
      };

      // Auto update parent status if kickoff is completed
      if (kickoffStatus === "Done") {
        store.projects[key].status = "Done";
      }

      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");

      // WRITE BACK TO GOOGLE SHEET
      try {
        const { google } = require("googleapis");
        const { getAuth } = require("../../lib/sheets");
        const auth = getAuth();
        const sheets = google.sheets({ version: "v4", auth });

        // 1. Fetch current rows to find correct project index
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: ltlProjectsId,
          range: "Data dự án !A1:J100",
        });
        const rows = response.data.values || [];
        if (rows.length > 0) {
          const headers = rows[0].map(h => String(h || "").trim());
          const nameIdx = headers.indexOf("TÊN DỰ ÁN");
          const picIdx = headers.indexOf("ĐẢM NHIỆM");
          const statusIdx = headers.indexOf("TRẠNG THÁI");
          const jobIdx = headers.indexOf("CÔNG VIỆC");
          const obIdx = headers.indexOf("Dự kiến OB ");
          const revIdx = headers.indexOf("Doanh Thu dự kiến");
          const sopIdx = headers.indexOf("LINK SOP");
          const modelIdx = headers.indexOf("MÔ HÌNH VẬN HÀNH");

          // Find matching row (0-indexed array row number)
          const rowIdx = rows.findIndex((row, i) => i > 0 && String(row[nameIdx] || "").trim() === key);
          if (rowIdx !== -1) {
            const rowNumber = rowIdx + 1; // Google Sheet is 1-indexed

            const colIndexToLetter = (idx) => String.fromCharCode(65 + idx);

            const updateCell = async (colIdx, val) => {
              if (colIdx !== -1 && val !== undefined) {
                await sheets.spreadsheets.values.update({
                  spreadsheetId: ltlProjectsId,
                  range: `Data dự án !${colIndexToLetter(colIdx)}${rowNumber}`,
                  valueInputOption: "USER_ENTERED",
                  resource: { values: [[val]] },
                });
              }
            };

            // Write matching fields to Google Sheets cells
            await Promise.all([
              updateCell(picIdx, pic),
              updateCell(statusIdx, store.projects[key].status), // use auto-computed status
              updateCell(jobIdx, job),
              updateCell(obIdx, expectedOb),
              updateCell(revIdx, revenue),
              updateCell(sopIdx, sopLink),
              updateCell(modelIdx, model),
            ]);
            console.log(`Successfully wrote updates back to Google Sheet row ${rowNumber} for project "${key}"`);
          }
        }
      } catch (sheetWriteErr) {
        console.warn("Could not write update back to Google Sheets directly (might be read-only):", sheetWriteErr.message);
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/projects] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
