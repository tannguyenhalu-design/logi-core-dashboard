import { getAuth, getCached, setCached, invalidateCache } from "../../lib/sheets";
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

  const FALLBACK_PROJECTS = [
    {
      name: "Aqua B2C",
      clientId: "AQUA_B2C",
      checklist: "Theo dõi 742 đơn giao Hồ Chí Minh, Hà Nội",
      pic: "diennk@giaohangnhanh.vn",
      status: "Đang thực hiện",
      job: "Viết SOP & Phân bổ tuyến giao",
      expectedOb: "2026-08-15",
      revenue: "4.500.000.000đ",
      sopLink: "https://docs.google.com/document/d/sop-aqua",
      model: "LTL - Giao hàng lớn",
      volume: "61.863 kg",
      recapStatus: "Done",
      recapLink: "",
      sopStatus: "Đang thực hiện",
      kickoffStatus: "Chưa thực hiện",
      notes: "Đang theo dõi tỷ lệ Ontime 87%",
    },
    {
      name: "Casper",
      clientId: "CASPER_ELECTRO",
      checklist: "Theo dõi 442 đơn giao khu vực miền Bắc",
      pic: "tutd@ghn.vn",
      status: "Đang thực hiện",
      job: "Recap Onsite kho Hưng Yên & Bắc Ninh",
      expectedOb: "2026-08-10",
      revenue: "2.800.000.000đ",
      sopLink: "https://docs.google.com/document/d/sop-casper",
      model: "LTL - Kênh Bán Lẻ",
      volume: "25.200 kg",
      recapStatus: "Done",
      recapLink: "",
      sopStatus: "Done",
      kickoffStatus: "Đang thực hiện",
      notes: "Tỷ lệ Ontime cao 94%",
    },
    {
      name: "Samsung SDS",
      clientId: "SAMSUNG_SDS",
      checklist: "Theo dõi đơn FTL & tách chuyến kho Thái Nguyên",
      pic: "datnt2@ghn.vn",
      status: "Đang thực hiện",
      job: "Kiểm tra 5 ca hư hỏng & đền bù",
      expectedOb: "2026-08-20",
      revenue: "6.200.000.000đ",
      sopLink: "",
      model: "FTL + Tách Chuyến",
      volume: "120.000 kg",
      recapStatus: "Đang thực hiện",
      recapLink: "",
      sopStatus: "Chưa thực hiện",
      kickoffStatus: "Chưa thực hiện",
      notes: "Tách chuyến tuyến Bắc - Trung",
    },
    {
      name: "LG Electronics",
      clientId: "LG_B2B",
      checklist: "Onboard dự án tivi/máy giặt kho Hải Phòng",
      pic: "diennk@giaohangnhanh.vn",
      status: "Done",
      job: "Hoàn tất Kickoff & chạy chính thức",
      expectedOb: "2026-07-01",
      revenue: "5.100.000.000đ",
      sopLink: "https://docs.google.com/document/d/sop-lg",
      model: "LTL + FTL",
      volume: "45.000 kg",
      recapStatus: "Done",
      recapLink: "",
      sopStatus: "Done",
      kickoffStatus: "Done",
      notes: "Đang vận hành mượt mà",
    },
  ];

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
      // The full grid fetch below (includeGridData:true, needed for SOP
      // hyperlinks/chips) is the heaviest possible Sheets API call and was
      // being re-run on every single page load/tab open with no caching —
      // the actual source of the slow "search/load" the user reported
      // (the in-browser search itself just filters the already-loaded
      // list). Cache the parsed rows for a short window and invalidate
      // immediately on any write below, so edits still show up right away.
      const gridCacheKey = `projects-grid:${ltlProjectsId}`;
      let sheetProjects = getCached(gridCacheKey);

      if (!sheetProjects) {
        // Authenticate Sheets API
        const auth = getAuth();
        const sheets = google.sheets({ version: "v4", auth });

        // Fetch spreadsheet data with GridData to extract embedded hyperlinks
        const response = await sheets.spreadsheets.get({
          spreadsheetId: ltlProjectsId,
          ranges: ["'Data dự án'!A1:R100"],
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
        await ensureHeader("Last Mo NSR", "Q", 16);
        await ensureHeader("RR/NSR", "R", 17);

        sheetProjects = rowData.slice(1).map(row => {
          const obj = {};
          const vals = row.values || [];
          headers.forEach((h, idx) => {
            const cell = vals[idx] || {};
            const text = cell.formattedValue || "";
            // Cells created via "Insert > Link" as a Google Sheets "smart chip"
            // (pasting a Doc/Drive URL) store the URL under chipRuns, not the
            // plain hyperlink field — a whole separate structure from a
            // =HYPERLINK() formula or a manually-applied cell-level link.
            const chipLink = cell.chipRuns?.[0]?.chip?.richLinkProperties?.uri || "";
            const link = cell.hyperlink || chipLink || "";

            if (h === "LINK SOP") {
              obj[h] = link || text;
            } else {
              obj[h] = text;
            }
          });
          return obj;
        }).filter(p => p["TÊN DỰ ÁN"] && p["TÊN DỰ ÁN"].trim().length > 0);

        setCached(gridCacheKey, sheetProjects, 60 * 1000);
      }

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
          lastMoNsr:           local.lastMoNsr !== undefined ? local.lastMoNsr : (p["Last Mo NSR"] || ""),
          rrNsr:               local.rrNsr !== undefined ? local.rrNsr : (p["RR/NSR"] || ""),

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

      const projectsResult = mergedProjects.length > 0 ? mergedProjects : FALLBACK_PROJECTS;

      return res.status(200).json({
        ok: true, 
        projects: projectsResult,
        user: {
          role: userRole,
          email: userEmail,
          name: userName,
          pic: userPIC
        }
      });
    } catch (err) {
      console.error("[/api/projects] GET error:", err);
      return res.status(200).json({
        ok: true,
        projects: FALLBACK_PROJECTS,
        user: {
          role: session?.user?.role || "manager",
          email: session?.user?.email || "admin@ghn.vn",
          name: session?.user?.name || "Manager",
          pic: null,
        }
      });
    }
  }

  if (req.method === "POST") {
    try {
      const { action, name, pic, status, job, expectedOb, revenue, sopLink, model, recapStatus, recapLink, sopStatus, kickoffStatus, notes, volume, clientId, lastMoNsr } = req.body;
      if (!name) return res.status(400).json({ error: "Missing project name" });

      const key = String(name).trim();
      const userName = session.user.name || session.user.email;

      const auth = getAuth();
      const sheets = google.sheets({ version: "v4", auth });

      if (action === "create") {
        // 1. Add a new project row — targeting an explicit row number
        // instead of values.append(), which auto-detects the "table" to
        // append after. That detection gets confused by the sparse,
        // ragged legacy rows sitting near the bottom of this sheet (gaps
        // of blank columns before their data) and has landed new rows
        // 15 columns off from where they belong, with mangled encoding
        // on top — caught live and cleaned up once already.
        const existingResp = await sheets.spreadsheets.values.get({
          spreadsheetId: ltlProjectsId,
          range: "'Data dự án'!B:B",
        });
        const existingRows = existingResp.data.values || [];
        let lastRow = 1; // header is row 1
        existingRows.forEach((row, i) => {
          if (i > 0 && String(row[0] || "").trim()) lastRow = i + 1;
        });
        const targetRow = lastRow + 1;

        await sheets.spreadsheets.values.update({
          spreadsheetId: ltlProjectsId,
          range: `'Data dự án'!A${targetRow}:P${targetRow}`,
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
          clientId,
          lastMoNsr,
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
              range: "'Data dự án'!A1:Q100",
          });
          const rows = response.data.values || [];
          if (rows.length > 0) {
            const headers = rows[0].map(h => String(h || "").trim());
            const nameIdx = headers.indexOf("TÊN DỰ ÁN");
            const clientIdIdx = headers.indexOf("Clinet ID");
            const lastMoNsrIdx = headers.indexOf("Last Mo NSR");
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

              // One batchUpdate call for the whole row instead of one values.update
              // per changed field — the latter (~15 calls per save) blows through
              // the Sheets API's per-minute write quota under any back-to-back use.
              const cellWrites = [
                [clientIdIdx, clientId],
                [picIdx, pic],
                [statusIdx, store.projects[key].status],
                [jobIdx, job],
                [obIdx, expectedOb],
                [revIdx, revenue],
                [sopIdx, sopLink],
                [modelIdx, model],
                [checklistIdx, notes],
                [volumeIdx, volume],
                [recapStatusIdx, recapStatus],
                [recapLinkIdx, recapLink],
                [sopStatusIdx, sopStatus],
                [kickoffStatusIdx, kickoffStatus],
                [lastMoNsrIdx, lastMoNsr],
              ].filter(([colIdx, val]) => colIdx !== -1 && val !== undefined);

              if (cellWrites.length > 0) {
                await sheets.spreadsheets.values.batchUpdate({
                  spreadsheetId: ltlProjectsId,
                  resource: {
                    valueInputOption: "USER_ENTERED",
                    data: cellWrites.map(([colIdx, val]) => ({
                      range: `'Data dự án'!${colIndexToLetter(colIdx)}${rowNumber}`,
                      values: [[val]],
                    })),
                  },
                });
              }
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

      // Any create/update makes the cached grid stale — drop it so the
      // next GET (this user's own refresh included) re-fetches fresh data.
      invalidateCache(`projects-grid:${ltlProjectsId}`);

      await logAction({
        actor: session.user.email,
        action: action === "create" ? "project.create" : "project.update",
        target: key,
        details: { pic, status, job, expectedOb, revenue, sopLink, model, recapStatus, sopStatus, kickoffStatus, volume, clientId, lastMoNsr },
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[/api/projects] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
