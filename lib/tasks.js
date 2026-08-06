/**
 * lib/tasks.js
 * SD3 operations task/deadline tracker, backed by a "Tasks" tab in the
 * Projects spreadsheet. Previously this lived only in localStorage, which
 * meant tasks were never actually visible to anyone but the browser that
 * created them — this is the fix, so "giao task cho team" actually works.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";
import { createTaskEvent, deleteTaskEvent } from "./calendar";

const SPREADSHEET_ID = "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
const SHEET_NAME = "Tasks";
// GroupId ties several rows together when one task is assigned to several
// people at once — each assignee still gets their own row (own status,
// own deadline outcome), but the UI groups them back into a single task.
// CompletionNote is the assignee's own text write-up when they mark their
// row done — separate from Notes (the task description set at creation).
const HEADERS = ["ID", "Title", "PIC", "PICName", "Project", "Deadline", "Status", "Notes", "CreatedAt", "CreatedBy", "UpdatedAt", "UpdatedBy", "CalendarEventId", "CalendarLink", "GroupId", "CompletionNote"];

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1:P1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
    return;
  }

  // Migrate older sheets created before "GroupId" existed. Rewriting the
  // whole header row (not just the missing cell) matters: values.append's
  // table auto-detection follows the header row's contiguous run of
  // non-empty cells, so a gap (e.g. blank CalendarEventId/CalendarLink
  // headers from an earlier migration) makes it misdetect the table width
  // and can write new rows into the wrong columns entirely.
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:O1`,
  });
  const currentHeaders = (headerResp.data.values && headerResp.data.values[0]) || [];
  const headersMatch = HEADERS.every((h, i) => currentHeaders[i] === h);
  if (!headersMatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1:P1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
  }
}

function rowToTask(r) {
  return {
    id: r[0] || "",
    title: r[1] || "",
    pic: r[2] || "",
    picName: r[3] || "",
    project: r[4] || "",
    deadline: r[5] || "",
    status: r[6] || "in_progress",
    notes: r[7] || "",
    createdAt: r[8] || "",
    createdBy: r[9] || "",
    updatedAt: r[10] || "",
    updatedBy: r[11] || "",
    calendarEventId: r[12] || "",
    calendarLink: r[13] || "",
    // Legacy rows created before GroupId existed are their own group of one.
    groupId: r[14] || r[0] || "",
    completionNote: r[15] || "",
  };
}

export async function getAllTasks() {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:P5000`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).filter((r) => r[0]).map(rowToTask).reverse();
}

// tasksInput: [{ title, pic, picName, project, deadline, notes, groupId }, ...]
// One row per entry — used to fan a single "assign to N people" submission
// out into N tracked tasks (own status each) in a single batched append
// call. Entries that share a groupId are the same task assigned to
// several people, and get grouped back together in the UI.
export async function createTasks(tasksInput, actor) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const now = new Date().toISOString();

  // Create the Calendar event for each assignee first (best-effort — a
  // failure here still lets the task itself get tracked in the Sheet).
  const withEvents = await Promise.all(tasksInput.map(async (t) => {
    const event = await createTaskEvent({
      title: t.title,
      deadline: t.deadline,
      pic: t.pic,
      picName: t.picName || t.pic,
      project: t.project,
      notes: t.notes,
    });
    return { ...t, event };
  }));

  const created = withEvents.map((t, i) => ({
    id: `task-${Date.now()}-${i}`,
    title: t.title,
    pic: t.pic,
    picName: t.picName || t.pic,
    project: t.project || "",
    deadline: t.deadline,
    status: "in_progress",
    notes: t.notes || "",
    createdAt: now,
    createdBy: actor || "",
    updatedAt: now,
    updatedBy: actor || "",
    calendarEventId: t.event?.eventId || "",
    calendarLink: t.event?.htmlLink || "",
    groupId: t.groupId || `task-${Date.now()}-${i}`,
    completionNote: "",
  }));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:P`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: created.map((t) => [
        t.id, t.title, t.pic, t.picName, t.project, t.deadline, t.status, t.notes,
        t.createdAt, t.createdBy, t.updatedAt, t.updatedBy, t.calendarEventId, t.calendarLink, t.groupId, t.completionNote,
      ]),
    },
  });

  return created;
}

// note: only passed when the assignee is marking their row done — written
// into CompletionNote. Left undefined on reopen (status back to
// "in_progress") so the prior write-up isn't silently wiped.
export async function updateTaskStatus(id, status, actor, note) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:P5000`,
  });
  const rows = resp.data.values || [];
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
  if (rowIdx === -1) throw new Error("Task not found");
  const rowNumber = rowIdx + 1;
  const now = new Date().toISOString();
  const completionNote = note !== undefined ? note : (rows[rowIdx][15] || "");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!G${rowNumber}:P${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[
        status, rows[rowIdx][7] || "", rows[rowIdx][8] || "", rows[rowIdx][9] || "", now, actor || "",
        rows[rowIdx][12] || "", rows[rowIdx][13] || "", rows[rowIdx][14] || "", completionNote,
      ]],
    },
  });
  return rowToTask([...rows[rowIdx].slice(0, 6), status, rows[rowIdx][7], rows[rowIdx][8], rows[rowIdx][9], now, actor, rows[rowIdx][12], rows[rowIdx][13], rows[rowIdx][14], completionNote]);
}

export async function deleteTask(id) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:P5000`,
  });
  const rows = resp.data.values || [];
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
  if (rowIdx === -1) return;
  const calendarEventId = rows[rowIdx][12];
  if (calendarEventId) await deleteTaskEvent(calendarEventId);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME).properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 },
        },
      }],
    },
  });
}
