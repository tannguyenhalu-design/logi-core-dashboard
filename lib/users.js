/**
 * lib/users.js
 * User accounts + role assignment, backed by a "Users" tab in the same
 * Google Sheet used for project tracking (Vercel's filesystem can't
 * durably persist this, so the Sheet is the real database).
 */
import { google } from "googleapis";
import crypto from "crypto";
import { getAuth } from "./sheets";

const SPREADSHEET_ID = "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
const SHEET_NAME = "Users";
const HEADERS = ["Email", "PasswordHash", "Salt", "Role", "PIC Name", "Project", "CreatedAt", "UpdatedAt", "UpdatedBy", "Tabs"];

// Manager always has every tab; role default tabs are just the initial
// value shown when a manager assigns that role — always editable per-person.
const ALL_TABS = ["ltl", "operations", "tachtrip"];
function defaultTabsForRole(role) {
  if (role === "manager") return ALL_TABS;
  if (role === "sd3") return ALL_TABS;
  if (role === "cs") return ["ltl"];
  return [];
}

function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const { hash: computed } = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureUsersSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1:J1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
    return;
  }

  // Migrate older sheets created before the "Tabs" column existed.
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:J1`,
  });
  const currentHeaders = (headerResp.data.values && headerResp.data.values[0]) || [];
  if (currentHeaders.indexOf("Tabs") === -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!J1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [["Tabs"]] },
    });
  }
}

async function getRows(sheets) {
  await ensureUsersSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:J1000`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 1) return { headers: HEADERS, dataRows: [] };
  return { headers: rows[0], dataRows: rows.slice(1) };
}

function rowToUser(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] !== undefined ? row[i] : "";
  });
  const role = obj["Role"] || "pending";
  const rawTabs = String(obj["Tabs"] || "").trim();
  const tabs = role === "manager"
    ? ALL_TABS
    : rawTabs
    ? rawTabs.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  return {
    email: String(obj["Email"] || "").trim().toLowerCase(),
    passwordHash: obj["PasswordHash"] || "",
    salt: obj["Salt"] || "",
    role,
    pic: obj["PIC Name"] || "",
    project: obj["Project"] || "",
    tabs,
    createdAt: obj["CreatedAt"] || "",
    updatedAt: obj["UpdatedAt"] || "",
    updatedBy: obj["UpdatedBy"] || "",
  };
}

export async function getAllUsers() {
  const sheets = await getSheetsClient();
  const { headers, dataRows } = await getRows(sheets);
  return dataRows.map((row) => rowToUser(headers, row)).filter((u) => u.email);
}

export async function findUserByEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  const users = await getAllUsers();
  return users.find((u) => u.email === target) || null;
}

export async function createPendingUser(email, password) {
  const sheets = await getSheetsClient();
  await ensureUsersSheet(sheets);
  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();
  const emailLower = String(email).trim().toLowerCase();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:J`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[emailLower, hash, salt, "pending", "", "", now, now, "self-signup", ""]],
    },
  });
}

/**
 * Manager-initiated account creation: the row exists with a role already
 * assigned, but no password yet — the real person sets their own password
 * the first time they log in with this email (see setUserPassword below).
 */
export async function createUserWithRole(email, { role, pic, project, tabs, updatedBy }) {
  const sheets = await getSheetsClient();
  await ensureUsersSheet(sheets);
  const now = new Date().toISOString();
  const tabsValue = (tabs && tabs.length ? tabs : defaultTabsForRole(role)).join(",");
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:J`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[String(email).trim().toLowerCase(), "", "", role, pic || "", project || "", now, now, updatedBy || "", tabsValue]],
    },
  });
}

export async function setUserPassword(email, password) {
  const sheets = await getSheetsClient();
  const { headers, dataRows } = await getRows(sheets);
  const emailIdx = headers.indexOf("Email");
  const hashIdx = headers.indexOf("PasswordHash");
  const saltIdx = headers.indexOf("Salt");

  const target = String(email).trim().toLowerCase();
  const rowIdx = dataRows.findIndex((row) => String(row[emailIdx] || "").trim().toLowerCase() === target);
  if (rowIdx === -1) throw new Error("Không tìm thấy tài khoản này");
  const rowNumber = rowIdx + 2;

  const { hash, salt } = hashPassword(password);
  const colLetter = (idx) => String.fromCharCode(65 + idx);
  await Promise.all([
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!${colLetter(hashIdx)}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[hash]] },
    }),
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!${colLetter(saltIdx)}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[salt]] },
    }),
  ]);
}

export function checkPassword(user, password) {
  return verifyPassword(password, user.passwordHash, user.salt);
}

export async function updateUserRole(email, { role, pic, project, tabs, updatedBy }) {
  const sheets = await getSheetsClient();
  const { headers, dataRows } = await getRows(sheets);
  const emailIdx = headers.indexOf("Email");
  const roleIdx = headers.indexOf("Role");
  const picIdx = headers.indexOf("PIC Name");
  const projectIdx = headers.indexOf("Project");
  const updatedAtIdx = headers.indexOf("UpdatedAt");
  const updatedByIdx = headers.indexOf("UpdatedBy");
  const tabsIdx = headers.indexOf("Tabs");

  const target = String(email).trim().toLowerCase();
  const rowIdx = dataRows.findIndex((row) => String(row[emailIdx] || "").trim().toLowerCase() === target);
  if (rowIdx === -1) throw new Error("Không tìm thấy tài khoản này");
  const rowNumber = rowIdx + 2; // 1 for header row, 1 to convert to 1-indexed sheet row

  const tabsValue = (tabs && tabs.length ? tabs : defaultTabsForRole(role)).join(",");
  const colLetter = (idx) => String.fromCharCode(65 + idx);
  const updates = [
    [roleIdx, role],
    [picIdx, pic || ""],
    [projectIdx, project || ""],
    [updatedAtIdx, new Date().toISOString()],
    [updatedByIdx, updatedBy || ""],
    [tabsIdx, tabsValue],
  ];

  await Promise.all(
    updates.map(([idx, val]) =>
      idx !== -1
        ? sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!${colLetter(idx)}${rowNumber}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[val]] },
          })
        : Promise.resolve()
    )
  );
}
