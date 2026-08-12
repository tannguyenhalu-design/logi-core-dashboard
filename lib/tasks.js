/**
 * lib/tasks.js
 * SD3 operations task/deadline tracker, backed by a "Tasks" tab in the
 * Projects spreadsheet. Previously this lived only in localStorage, which
 * meant tasks were never actually visible to anyone but the browser that
 * created them — this is the fix, so "giao task cho team" actually works.
 */
import { google } from "googleapis";
import { getAuth } from "./sheets";
import { createTaskEvent, updateTaskEvent, deleteTaskEvent } from "./calendar";

function getSpreadsheetId() {
  return (
    process.env.GOOGLE_SHEET_ID_PROJECTS ||
    process.env.SHEET_ID_PROJECTS ||
    process.env.GOOGLE_SHEET_ID ||
    "19IrefOKKtejbQOKhJ1SM1mi2p5yKOMXwdt9OyKsZDVA"
  );
}
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
  const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
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
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:O1`,
  });
  const currentHeaders = (headerResp.data.values && headerResp.data.values[0]) || [];
  const headersMatch = HEADERS.every((h, i) => currentHeaders[i] === h);
  if (!headersMatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
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
    spreadsheetId: getSpreadsheetId(),
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
    spreadsheetId: getSpreadsheetId(),
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
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:P5000`,
  });
  const rows = resp.data.values || [];
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
  if (rowIdx === -1) throw new Error("Task not found");
  const rowNumber = rowIdx + 1;
  const now = new Date().toISOString();
  const completionNote = note !== undefined ? note : (rows[rowIdx][15] || "");
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
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

// Title/Project/Deadline/Notes are shared across every row in a group (the
// same task assigned to several people) — editing them updates every row
// sharing that groupId in one batch, so the group doesn't end up showing a
// different deadline to different assignees. Status/CompletionNote are
// deliberately untouched for rows that stay in the group; those stay
// per-person via updateTaskStatus.
//
// `pics` is optional — when provided (manager-only at the API layer), it's
// the FULL desired assignee list for the group: rows for people missing
// from it get deleted (their calendar event too), rows for people newly
// added get created fresh (status back to in_progress — there's no prior
// progress to preserve for someone who wasn't on the task before), and
// rows for people still present just get their shared fields updated like
// normal. Omitting `pics` entirely leaves the assignee set untouched.
export async function updateTaskDetails(groupId, { title, project, deadline, notes, pics }, actor) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:P5000`,
  });
  const rows = resp.data.values || [];
  const matches = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i > 0 && r[0] && (r[14] || r[0]) === groupId);
  if (matches.length === 0) throw new Error("Task not found");

  const now = new Date().toISOString();
  const finalTitle = title !== undefined ? title : matches[0].r[1];
  const finalProject = project !== undefined ? project : matches[0].r[4];
  const finalDeadline = deadline !== undefined ? deadline : matches[0].r[5];
  const finalNotes = notes !== undefined ? notes : matches[0].r[7];

  const keep = pics === undefined
    ? matches
    : matches.filter(({ r }) => pics.some((p) => p.pic === r[2]));
  const toRemove = pics === undefined
    ? []
    : matches.filter(({ r }) => !pics.some((p) => p.pic === r[2]));
  const toAdd = pics === undefined
    ? []
    : pics.filter((p) => !matches.some(({ r }) => r[2] === p.pic));

  if (toRemove.length > 0) {
    await Promise.all(toRemove.map(({ r }) => (r[12] ? deleteTaskEvent(r[12]) : null)));
    const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
    const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME).properties.sheetId;
    // Deletions shift every row below them up by one — process highest
    // index first so earlier-computed row numbers stay valid.
    const requests = toRemove
      .map(({ i }) => i)
      .sort((a, b) => b - a)
      .map((rowIdx) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }));
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: getSpreadsheetId(), resource: { requests } });
  }

  if (keep.length > 0) {
    const cellWrites = [];
    keep.forEach(({ r, i }) => {
      const rowNumber = i + 1;
      if (title !== undefined) cellWrites.push({ range: `'${SHEET_NAME}'!B${rowNumber}`, values: [[title]] });
      if (project !== undefined) cellWrites.push({ range: `'${SHEET_NAME}'!E${rowNumber}`, values: [[project]] });
      if (deadline !== undefined) cellWrites.push({ range: `'${SHEET_NAME}'!F${rowNumber}`, values: [[deadline]] });
      if (notes !== undefined) cellWrites.push({ range: `'${SHEET_NAME}'!H${rowNumber}`, values: [[notes]] });
      cellWrites.push({ range: `'${SHEET_NAME}'!K${rowNumber}`, values: [[now]] });
      cellWrites.push({ range: `'${SHEET_NAME}'!L${rowNumber}`, values: [[actor || ""]] });
    });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      resource: { valueInputOption: "USER_ENTERED", data: cellWrites },
    });
    await Promise.all(keep.map(async ({ r }) => {
      if (!r[12]) return;
      await updateTaskEvent(r[12], { title: finalTitle, deadline: finalDeadline, pic: r[2], picName: r[3], project: finalProject, notes: finalNotes });
    }));
  }

  if (toAdd.length > 0) {
    const withEvents = await Promise.all(toAdd.map(async (p) => {
      const event = await createTaskEvent({ title: finalTitle, deadline: finalDeadline, pic: p.pic, picName: p.picName || p.pic, project: finalProject, notes: finalNotes });
      return { ...p, event };
    }));
    const newRows = withEvents.map((p, idx) => [
      `task-${Date.now()}-${idx}`, finalTitle, p.pic, p.picName || p.pic, finalProject, finalDeadline,
      "in_progress", finalNotes, now, actor || "", now, actor || "",
      p.event?.eventId || "", p.event?.htmlLink || "", groupId, "",
    ]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!A:P`,
      valueInputOption: "USER_ENTERED",
      resource: { values: newRows },
    });
  }

  if (toRemove.length === 0 && toAdd.length === 0) {
    return keep.map(({ r, i }) => rowToTask([
      r[0], finalTitle, r[2], r[3], finalProject, finalDeadline, r[6], finalNotes,
      r[8], r[9], now, actor || "", r[12], r[13], r[14], r[15],
    ]));
  }

  // Assignee set changed (rows deleted/inserted) — row indices from the
  // earlier read are no longer trustworthy, so re-fetch for the real result.
  const finalResp = await sheets.spreadsheets.values.get({ spreadsheetId: getSpreadsheetId(), range: `'${SHEET_NAME}'!A1:P5000` });
  const finalRows = finalResp.data.values || [];
  return finalRows.slice(1).filter((r) => r[0] && (r[14] || r[0]) === groupId).map(rowToTask);
}

export async function deleteTask(id) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:P5000`,
  });
  const rows = resp.data.values || [];
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
  if (rowIdx === -1) return;
  const calendarEventId = rows[rowIdx][12];
  if (calendarEventId) await deleteTaskEvent(calendarEventId);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME).properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    resource: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 },
        },
      }],
    },
  });
}
