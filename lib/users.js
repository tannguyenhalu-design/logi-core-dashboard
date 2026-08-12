/**
 * lib/users.js
 * User accounts + role assignment, backed by a "Users" tab in the same
 * Google Sheet used for project tracking (Vercel's filesystem can't
 * durably persist this, so the Sheet is the real database).
 *
 * Identity comes from GHN SSO v2 (OIDC) — "EmployeeId" is the durable
 * key once a person has logged in at least once. Before that, a manager
 * can pre-provision access by typing the person's full name ("Name"
 * column) exactly as GHN SSO reports it (preferred_username); the first
 * SSO login backfills EmployeeId onto that row and links it permanently.
 * "Email" is kept only as optional display metadata since GHN SSO v2's
 * claims don't reliably include a corporate email address.
 */
import { google } from "googleapis";
import { getAuth, getCached, setCached, invalidateCache } from "./sheets";

// Vercel can't durably persist this, so the main Google Sheet is the real database.
// We use the same sheet as the main dashboard data for simplicity.
const getSpreadsheetId = () => process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Users";
const HEADERS = ["Email", "PasswordHash", "Salt", "Role", "PIC Name", "Project", "CreatedAt", "UpdatedAt", "UpdatedBy", "Tabs", "Name", "EmployeeId"];
const LAST_COL = "L"; // keep in sync with HEADERS.length

// Manager always has every tab; role default tabs are just the initial
// value shown when a manager assigns that role — always editable per-person.
const ALL_TABS = ["ltl", "operations", "tachtrip"];
function defaultTabsForRole(role) {
  if (role === "manager") return ALL_TABS;
  if (role === "sd3") return ALL_TABS;
  if (role === "cs") return ["ltl"];
  return [];
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureUsersSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!A1:${LAST_COL}1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [HEADERS] },
    });
    return;
  }

  // Migrate older sheets created before "Tabs"/"Name"/"EmployeeId" existed.
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:${LAST_COL}1000`,
  });
  const allRows = headerResp.data.values || [];
  const currentHeaders = allRows[0] || [];
  const missing = HEADERS.filter((h) => currentHeaders.indexOf(h) === -1);
  if (missing.length > 0) {
    const merged = [...currentHeaders];
    missing.forEach((h) => merged.push(h));
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `'${SHEET_NAME}'!A1:${String.fromCharCode(65 + merged.length - 1)}1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [merged] },
    });
  }

  // Backfill Name = Email for accounts created before "Name" existed
  // (everyone approved pre-SSO) — otherwise their existing row is
  // unreachable by the Name-based lookups every login path now uses,
  // and logging in just creates a fresh duplicate "pending" account.
  const emailIdx = currentHeaders.indexOf("Email");
  const nameIdx = currentHeaders.indexOf("Name");
  if (emailIdx !== -1 && nameIdx !== -1) {
    const colLetter = (idx) => String.fromCharCode(65 + idx);
    const fixups = [];
    allRows.slice(1).forEach((row, i) => {
      const email = String(row[emailIdx] || "").trim();
      const name = String(row[nameIdx] || "").trim();
      if (email && !name) {
        fixups.push({
          range: `'${SHEET_NAME}'!${colLetter(nameIdx)}${i + 2}`,
          values: [[email]],
        });
      }
    });
    if (fixups.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        resource: { valueInputOption: "USER_ENTERED", data: fixups },
      });
    }
  }
}

async function getRows(sheets) {
  const cacheKey = `users:${getSpreadsheetId()}:${SHEET_NAME}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureUsersSheet(sheets);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A1:${LAST_COL}1000`,
  });
  const rows = resp.data.values || [];
  let result;
  if (rows.length < 1) {
    result = { headers: HEADERS, dataRows: [] };
  } else {
    result = { headers: rows[0], dataRows: rows.slice(1) };
  }
  setCached(cacheKey, result, 5 * 60 * 1000);
  return result;
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
    : role === "pending"
    ? []
    : rawTabs
    ? rawTabs.split(",").map((t) => t.trim()).filter(Boolean)
    : defaultTabsForRole(role);
  return {
    email: String(obj["Email"] || "").trim().toLowerCase(),
    name: obj["Name"] || "",
    employeeId: String(obj["EmployeeId"] || "").trim(),
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
  const rawUsers = dataRows.map((row) => rowToUser(headers, row)).filter((u) => u.name || u.employeeId || u.email);

  // Deduplicate by employeeId or normalized name so duplicate rows never show up
  const uniqueMap = new Map();
  rawUsers.forEach((u) => {
    const key = u.employeeId ? `id:${u.employeeId}` : `name:${normalizeName(u.name)}`;
    if (key) uniqueMap.set(key, u);
  });

  return Array.from(uniqueMap.values());
}

export async function deleteUser({ employeeId, name }) {
  const sheets = await getSheetsClient();
  const { headers, dataRows } = await getRows(sheets);
  const employeeIdx = headers.indexOf("EmployeeId");
  const nameIdx = headers.indexOf("Name");

  const targetEmployeeId = String(employeeId || "").trim();
  const targetName = normalizeName(name);

  const rowIdx = dataRows.findIndex((row) =>
    targetEmployeeId
      ? String(row[employeeIdx] || "").trim() === targetEmployeeId
      : normalizeName(row[nameIdx]) === targetName
  );

  if (rowIdx === -1) throw new Error("Không tìm thấy tài khoản để xóa");
  const rowNumber = rowIdx + 2;

  await sheets.spreadsheets.values.clear({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A${rowNumber}:${LAST_COL}${rowNumber}`,
  });

  invalidateCache(`users:${getSpreadsheetId()}:${SHEET_NAME}`);
}

export async function findUserByEmployeeId(employeeId) {
  const target = String(employeeId || "").trim();
  if (!target) return null;
  const users = await getAllUsers();
  return users.find((u) => u.employeeId && u.employeeId === target) || null;
}

export async function findUserByName(name) {
  const target = normalizeName(name);
  if (!target) return null;
  const users = await getAllUsers();
  return users.find((u) => normalizeName(u.name) === target) || null;
}

/**
 * First-ever SSO login for this person: no row keyed by EmployeeId yet.
 * If a manager already pre-provisioned access by name, link that row to
 * this EmployeeId permanently and return it; otherwise create a fresh
 * "pending" row awaiting manager approval.
 */
export async function resolveSSOUser({ employeeId, name, email }) {
  const existingById = await findUserByEmployeeId(employeeId);
  if (existingById) return existingById;

  const sheets = await getSheetsClient();
  const { headers, dataRows } = await getRows(sheets);
  const nameIdx = headers.indexOf("Name");
  const employeeIdx = headers.indexOf("EmployeeId");
  const emailIdx = headers.indexOf("Email");
  const target = normalizeName(name);

  const provisionedRowIdx = dataRows.findIndex(
    (row) => !String(row[employeeIdx] || "").trim() && normalizeName(row[nameIdx]) === target && target
  );

  if (provisionedRowIdx !== -1) {
    const rowNumber = provisionedRowIdx + 2;
    const colLetter = (idx) => String.fromCharCode(65 + idx);
    const updates = [[employeeIdx, employeeId]];
    if (email && emailIdx !== -1 && !String(dataRows[provisionedRowIdx][emailIdx] || "").trim()) {
      updates.push([emailIdx, String(email).trim().toLowerCase()]);
    }
    await Promise.all(
      updates.map(([idx, val]) =>
        sheets.spreadsheets.values.update({
          spreadsheetId: getSpreadsheetId(),
          range: `'${SHEET_NAME}'!${colLetter(idx)}${rowNumber}`,
          valueInputOption: "USER_ENTERED",
          resource: { values: [[val]] },
        })
      )
    );
    invalidateCache(`users:${getSpreadsheetId()}:${SHEET_NAME}`);
    return findUserByEmployeeId(employeeId);
  }

  const now = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A:${LAST_COL}`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[
        email ? String(email).trim().toLowerCase() : "", // Email
        "", // PasswordHash (unused, SSO-only login)
        "", // Salt
        "pending", // Role
        "", // PIC Name
        "", // Project
        now, // CreatedAt
        now, // UpdatedAt
        "sso-signup", // UpdatedBy
        "", // Tabs
        name || "", // Name
        String(employeeId), // EmployeeId
      ]],
    },
  });
  invalidateCache(`users:${getSpreadsheetId()}:${SHEET_NAME}`);
  return findUserByEmployeeId(employeeId);
}

/**
 * Manager-initiated pre-provisioning: grant a role to a colleague by
 * their full name before they've ever logged in. EmployeeId is filled
 * in automatically on their first GHN SSO login (see resolveSSOUser).
 */
export async function createUserWithRole(name, { employeeId, role, pic, project, tabs, updatedBy }) {
  const sheets = await getSheetsClient();
  await ensureUsersSheet(sheets);
  const now = new Date().toISOString();
  const tabsValue = (tabs && tabs.length ? tabs : defaultTabsForRole(role)).join(",");
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `'${SHEET_NAME}'!A:${LAST_COL}`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [["", "", "", role, pic || "", project || "", now, now, updatedBy || "", tabsValue, String(name || "").trim(), String(employeeId || "").trim()]],
    },
  });
  invalidateCache(`users:${getSpreadsheetId()}:${SHEET_NAME}`);
}

/**
 * identifier: { employeeId } once linked, or { name } for a
 * not-yet-logged-in provisioned row.
 */
export async function updateUserRole({ employeeId, name }, { role, pic, project, tabs, updatedBy }) {
  const sheets = await getSheetsClient();
  const { headers, dataRows } = await getRows(sheets);
  const employeeIdx = headers.indexOf("EmployeeId");
  const nameIdx = headers.indexOf("Name");
  const roleIdx = headers.indexOf("Role");
  const picIdx = headers.indexOf("PIC Name");
  const projectIdx = headers.indexOf("Project");
  const updatedAtIdx = headers.indexOf("UpdatedAt");
  const updatedByIdx = headers.indexOf("UpdatedBy");
  const tabsIdx = headers.indexOf("Tabs");

  const targetEmployeeId = String(employeeId || "").trim();
  const targetName = normalizeName(name);
  const rowIdx = dataRows.findIndex((row) =>
    targetEmployeeId
      ? String(row[employeeIdx] || "").trim() === targetEmployeeId
      : !String(row[employeeIdx] || "").trim() && normalizeName(row[nameIdx]) === targetName
  );
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
            spreadsheetId: getSpreadsheetId(),
            range: `'${SHEET_NAME}'!${colLetter(idx)}${rowNumber}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[val]] },
          })
        : Promise.resolve()
    )
  );
  invalidateCache(`users:${getSpreadsheetId()}:${SHEET_NAME}`);
}
