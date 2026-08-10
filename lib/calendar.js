/**
 * lib/calendar.js
 * Creates/updates/deletes events on the shared "SD3-Điện Máy Deadlines"
 * Google Calendar when a task is assigned/edited. No `attendees` — a plain
 * service account can't invite guests without Domain-Wide Delegation (needs
 * Workspace admin access, not just GCP project ownership), so this does NOT
 * email the PIC directly; the event just lands on the shared calendar
 * everyone already has access to.
 *
 * Every operation here is best-effort: a failure must never block the
 * underlying task create/edit/delete in the Sheet (same principle as
 * lib/audit-log.js).
 */
import { google } from "googleapis";
import { getAuth as getSheetsAuth } from "./sheets";
import fs from "fs";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

function getCalendarAuth() {
  // Reuses the same service account key as Sheets, just with the
  // Calendar scope instead — getAuth() in lib/sheets.js hardcodes the
  // spreadsheets scope, so credentials are loaded directly here.
  const keyFile = String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || "").trim();
  const key = keyFile
    ? JSON.parse(fs.readFileSync(keyFile, "utf8"))
    : JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
}

export async function createTaskEvent({ title, deadline, pic, picName, project, notes }) {
  if (!CALENDAR_ID) return null;
  try {
    const auth = getCalendarAuth();
    const calendar = google.calendar({ version: "v3", auth });
    // No `attendees` here — a plain service account can't invite guests
    // without Domain-Wide Delegation (needs Workspace admin access, not
    // just GCP project ownership). Pending for later; for now the event
    // just lands on the shared calendar everyone already has access to.
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `[SD3 Task] ${title} — ${picName}`,
        description: `Dự án: ${project || "N/A"}\nPIC đảm nhiệm: ${picName} (${pic})\nGhi chú: ${notes || "N/A"}`,
        start: { date: deadline },
        end: { date: deadline },
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 24 * 60 }],
        },
      },
    });
    return { eventId: res.data.id, htmlLink: res.data.htmlLink };
  } catch (err) {
    console.error("[calendar] failed to create event:", err.message);
    return null;
  }
}

export async function updateTaskEvent(eventId, { title, deadline, pic, picName, project, notes }) {
  if (!CALENDAR_ID || !eventId) return null;
  try {
    const auth = getCalendarAuth();
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      requestBody: {
        summary: `[SD3 Task] ${title} — ${picName}`,
        description: `Dự án: ${project || "N/A"}\nPIC đảm nhiệm: ${picName} (${pic})\nGhi chú: ${notes || "N/A"}`,
        start: { date: deadline },
        end: { date: deadline },
      },
    });
    return { eventId: res.data.id, htmlLink: res.data.htmlLink };
  } catch (err) {
    console.error("[calendar] failed to update event:", err.message);
    return null;
  }
}

export async function deleteTaskEvent(eventId) {
  if (!CALENDAR_ID || !eventId) return;
  try {
    const auth = getCalendarAuth();
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId, sendUpdates: "all" });
  } catch (err) {
    console.error("[calendar] failed to delete event:", err.message);
  }
}
