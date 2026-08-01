import { getAuth } from "../../lib/sheets";
import { getSession } from "../../lib/auth";
import { logAction } from "../../lib/audit-log";
import { google } from "googleapis";
import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("operations")) {
    return res.status(403).json({ error: "Bạn không có quyền xem Vận hành SD3" });
  }

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
      // Authenticate Sheets API
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
        return res.status(200).json({ ok: true, projects: [] });
      }

      // First row contains headers
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

      // Claim (or create) dedicated columns for the SD3 pipeline fields so they
      // persist in the Sheet instead of the ephemeral local store (which is wiped
      // on every Vercel deployment/cold start).
      const ensureHeader = async (targetName, colLetter, colIdx) => {
        if (headers[colIdx] === targetName) return colIdx;
        if (!headers[colIdx] || /^Cột \d+$/.test(headers[colIdx])) {
          try {
            await sheets.spreadsheets.values.update({
              spreadsheetId: ltlProjectsId,
              range: `'Data dự án'!${colLetter}1`,
              valueInputOption: "USER_ENTERED",
              resource: { values: [[targetName]] },
            });
            headers[colIdx] = targetName;
            return colIdx;
          } catch (renameErr) {
            console.warn(`Could not set header ${colLetter}1:`, renameErr.message);
          }
        }
        return headers.indexOf(targetName);
      };

      await ensureHeader("RECAP STATUS", "M", 12);
      await ensureHeader("RECAP LINK", "N", 13);
      await ensureHeader("SOP STATUS", "O", 14);
      await ensureHeader("KICKOFF STATUS", "P", 15);

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

      // Merge Google Sheet row data with local dashboard overrides
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
          
          recapStatus:         local.recapStatus !== undefined ? local.recapStatus : ((p["RECAP STATUS"] || "").trim() || defaultRecapStatus),
          recapLink:           local.recapLink !== undefined ? local.recapLink : (p["RECAP LINK"] || "").trim(),
          sopStatus:           local.sopStatus !== undefined ? local.sopStatus : ((p["SOP STATUS"] || "").trim() || defaultSopStatus),
          kickoffStatus:       local.kickoffStatus !== undefined ? local.kickoffStatus : ((p["KICKOFF STATUS"] || "").trim() || defaultKickoffStatus),

          notes:               local.notes !== undefined ? local.notes : (p["CHECK LIST CÔNG VIỆC"] || ""),
          updatedAt:           local.updatedAt || null,
          updatedBy:           local.updatedBy || null,
        };
      });

      // Role/PIC are authoritative from the session (set at login from the
      // Users sheet, assigned by a manager via /api/admin-users).
      const userEmail = String(session.user.email || "").toLowerCase();
      const userName = userEmail;
      const userRole = session.user.role || "manager";
      const userPIC = session.user.pic || null;

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
      const { action, name, pic, status, job, expectedOb, revenue, sopLink, model, recapStatus, recapLink, sopStatus, kickoffStatus, notes, volume } = req.body;
      if (!name) return res.status(400).json({ error: "Missing project name" });

      const key = String(name).trim();
      const userName = session.user.name || session.user.email;

      const auth = getAuth();
      const sheets = google.sheets({ version: "v4", auth });

      if (action === "create") {
        // 1. Append a new project row to Google Sheets
        await sheets.spreadsheets.values.append({
          spreadsheetId: ltlProjectsId,
          range: "'Data dự án'!A:P",
          valueInputOption: "USER_ENTERED",
          resource: {
            values: [[
              "", // Client ID
              key, // TÊN DỰ ÁN
              notes || "", // CHECK LIST CÔNG VIỆC
              pic || "", // ĐẢM NHIỆM
              status || "Đang thực hiện", // TRẠNG THÁI
              job || "Recap onsite", // CÔNG VIỆC
              expectedOb || "", // Dự kiến OB
              revenue || "", // Doanh Thu dự kiến
              sopLink || "", // LINK SOP
              model || "", // MÔ HÌNH VẬN HÀNH
              "", // Logic SLA (K)
              volume || "", // Dự kiến Volume (L)
              "Chưa thực hiện", // RECAP STATUS (M)
              "", // RECAP LINK (N)
              "Chưa thực hiện", // SOP STATUS (O)
              "Chưa thực hiện", // KICKOFF STATUS (P)
            ]]
          }
        });

        // 2. Cache in local store
        store.projects[key] = {
          pic: pic || "",
          status: status || "Đang thực hiện",
          job: job || "Recap onsite",
          expectedOb: expectedOb || "",
          revenue: revenue || "",
          sopLink: sopLink || "",
          model: model || "",
          recapStatus: "Chưa thực hiện",
          recapLink: "",
          sopStatus: "Chưa thực hiện",
          kickoffStatus: "Chưa thực hiện",
          notes: notes || "",
          volume: volume || "",
          updatedAt: new Date().toISOString(),
          updatedBy: userName,
        };
      } else {
        // Update Action
        if (!store.projects[key]) {
          store.projects[key] = {};
        }

        // Merge updates
        store.projects[key] = {
          ...store.projects[key],
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
          volume,
          updatedAt: new Date().toISOString(),
          updatedBy: userName,
        };

        if (kickoffStatus === "Done") {
          store.projects[key].status = "Done";
        }

        // WRITE BACK TO GOOGLE SHEET ROW
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: ltlProjectsId,
              range: "'Data dự án'!A1:P100",
          });
          const rows = response.data.values || [];
          if (rows.length > 0) {
            const headers = rows[0].map(h => String(h || "").trim());
            const nameIdx = headers.indexOf("TÊN DỰ ÁN");
            const picIdx = headers.indexOf("ĐẢM NHIỆM");
            const statusIdx = headers.indexOf("TRẠNG THÁI");
            const jobIdx = headers.indexOf("CÔNG VIỆC");
            const obIdx = headers.indexOf("Dự kiến OB"); // Trimmed version
            const revIdx = headers.indexOf("Doanh Thu dự kiến");
            const sopIdx = headers.indexOf("LINK SOP");
            const modelIdx = headers.indexOf("MÔ HÌNH VẬN HÀNH");
            const checklistIdx = headers.indexOf("CHECK LIST CÔNG VIỆC");
            const recapStatusIdx = headers.indexOf("RECAP STATUS");
            const recapLinkIdx = headers.indexOf("RECAP LINK");
            const sopStatusIdx = headers.indexOf("SOP STATUS");
            const kickoffStatusIdx = headers.indexOf("KICKOFF STATUS");

            let volumeIdx = headers.indexOf("Dự kiến Volume");
            if (volumeIdx === -1) {
              volumeIdx = headers.indexOf("Dự kiến Vollume");
            }
            if (volumeIdx === -1) {
              volumeIdx = headers.indexOf("Cột 12");
            }

            const rowIdx = rows.findIndex((row, i) => i > 0 && String(row[nameIdx] || "").trim() === key);
            if (rowIdx !== -1) {
              const rowNumber = rowIdx + 1;
              const colIndexToLetter = (idx) => String.fromCharCode(65 + idx);

              const updateCell = async (colIdx, val) => {
                if (colIdx !== -1 && val !== undefined) {
                  await sheets.spreadsheets.values.update({
                    spreadsheetId: ltlProjectsId,
                    range: `'Data dự án'!${colIndexToLetter(colIdx)}${rowNumber}`,
                    valueInputOption: "USER_ENTERED",
                    resource: { values: [[val]] },
                  });
                }
              };

              await Promise.all([
                updateCell(picIdx, pic),
                updateCell(statusIdx, store.projects[key].status),
                updateCell(jobIdx, job),
                updateCell(obIdx, expectedOb),
                updateCell(revIdx, revenue),
                updateCell(sopIdx, sopLink),
                updateCell(modelIdx, model),
                updateCell(checklistIdx, notes),
                updateCell(volumeIdx, volume),
                updateCell(recapStatusIdx, recapStatus),
                updateCell(recapLinkIdx, recapLink),
                updateCell(sopStatusIdx, sopStatus),
                updateCell(kickoffStatusIdx, kickoffStatus),
              ]);
            }
          }
        } catch (sheetWriteErr) {
          console.warn("Write back to Google Sheet failed:", sheetWriteErr.message);
        }
      }

      // Best-effort local cache — the Sheet write above is the real persistence.
      // On Vercel the filesystem is read-only, so this is expected to fail there;
      // it must not turn a successful Sheet write into a 500 for the client.
      try {
        fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
      } catch (fsErr) {
        console.warn("Could not write local projects-store.json cache:", fsErr.message);
      }

      await logAction({
        actor: session.user.email,
        action: action === "create" ? "project.create" : "project.update",
        target: key,
        details: { pic, status, job, expectedOb, revenue, sopLink, model, recapStatus, sopStatus, kickoffStatus, volume },
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/projects] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
