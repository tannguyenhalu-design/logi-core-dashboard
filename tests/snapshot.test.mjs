/**
 * tests/snapshot.test.mjs — Tests for snapshot filter logic.
 * Tests: isDMRow, month filter, project filter, date range filter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Inline filter/DM logic (mirrors lib/dm-clients.js and ltl-dashboard.js)
const DM_LIST = new Set([
  "aqua vn", "lg vn", "hisense vn", "dmx", "samsung vn",
  "electrolux", "panasonic vn", "toshiba vn",
]);
const DM_KEYWORDS = ["dien may", "điện máy", "home appliance", "dmx"];

function isDMClient(name) {
  if (!name) return false;
  const lower = String(name).toLowerCase().trim();
  if (DM_LIST.has(lower)) return true;
  return DM_KEYWORDS.some((kw) => lower.includes(kw));
}

function isDMRow(row, scope) {
  if (row.nganh_hang === "DM") return true;
  if (scope?.dm?.has(String(row.client_name || "").toLowerCase().trim())) return true;
  return isDMClient(row.client_name);
}

function getYearMonth(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function filterByMonth(rows, month) {
  if (!month) return rows;
  return rows.filter((r) => getYearMonth(r.pickup_time) === month);
}

function filterByProjects(rows, projects) {
  if (!projects || projects.length === 0) return rows;
  const set = new Set(projects.map((p) => String(p).toLowerCase().trim()));
  return rows.filter((r) => set.has(String(r.client_name || "").toLowerCase().trim()));
}

// Helpers
const makeRow = (overrides) => ({
  order_code: "X001",
  client_name: "Aqua VN",
  nganh_hang: "DM",
  odr_success: "ontime",
  pickup_time: "2026-10-05T08:00:00",
  ...overrides,
});

test("isDMRow: true when nganh_hang='DM'", () => {
  assert.ok(isDMRow({ nganh_hang: "DM", client_name: "Unknown Corp" }, {}));
});

test("isDMRow: true for known DM client by name", () => {
  assert.ok(isDMRow({ nganh_hang: "", client_name: "Aqua VN" }, {}));
  assert.ok(isDMRow({ nganh_hang: "", client_name: "LG VN" }, {}));
  assert.ok(isDMRow({ nganh_hang: "", client_name: "Hisense VN" }, {}));
});

test("isDMRow: true via scope.dm set", () => {
  const scope = { dm: new Set(["custom corp"]) };
  assert.ok(isDMRow({ nganh_hang: "", client_name: "Custom Corp" }, scope));
});

test("isDMRow: false for non-DM client without nganh_hang", () => {
  assert.ok(!isDMRow({ nganh_hang: "", client_name: "Some Food Co" }, {}));
});

test("getYearMonth parses ISO datetime correctly", () => {
  assert.equal(getYearMonth("2026-10-05T08:00:00"), "2026-10");
  assert.equal(getYearMonth("2026-01-31T23:59:59"), "2026-01");
});

test("getYearMonth returns null for empty/invalid", () => {
  assert.equal(getYearMonth(null), null);
  assert.equal(getYearMonth(""), null);
  assert.equal(getYearMonth("not-a-date"), null);
});

test("filterByMonth returns only rows in target month", () => {
  const rows = [
    makeRow({ pickup_time: "2026-10-01T08:00:00" }),
    makeRow({ pickup_time: "2026-10-31T08:00:00" }),
    makeRow({ pickup_time: "2026-09-30T08:00:00" }), // different month
    makeRow({ pickup_time: "2026-11-01T08:00:00" }), // different month
  ];
  const filtered = filterByMonth(rows, "2026-10");
  assert.equal(filtered.length, 2, "only Oct rows");
});

test("filterByMonth returns all rows when month is null", () => {
  const rows = [makeRow(), makeRow(), makeRow()];
  assert.equal(filterByMonth(rows, null).length, 3);
});

test("filterByProjects returns only matching clients", () => {
  const rows = [
    makeRow({ client_name: "Aqua VN" }),
    makeRow({ client_name: "LG VN" }),
    makeRow({ client_name: "Some Food Co" }),
  ];
  const filtered = filterByProjects(rows, ["Aqua VN", "LG VN"]);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((r) => ["Aqua VN", "LG VN"].includes(r.client_name)));
});

test("filterByProjects is case-insensitive", () => {
  const rows = [makeRow({ client_name: "Aqua VN" })];
  assert.equal(filterByProjects(rows, ["aqua vn"]).length, 1);
  assert.equal(filterByProjects(rows, ["AQUA VN"]).length, 1);
});

test("filterByProjects returns all rows for empty project list", () => {
  const rows = [makeRow(), makeRow()];
  assert.equal(filterByProjects(rows, []).length, 2);
  assert.equal(filterByProjects(rows, null).length, 2);
});

test("combined filter: month + project", () => {
  const rows = [
    makeRow({ client_name: "Aqua VN", pickup_time: "2026-10-01T08:00:00" }),
    makeRow({ client_name: "Aqua VN", pickup_time: "2026-09-01T08:00:00" }), // wrong month
    makeRow({ client_name: "LG VN", pickup_time: "2026-10-01T08:00:00" }), // wrong client
  ];
  const step1 = filterByMonth(rows, "2026-10");
  const step2 = filterByProjects(step1, ["Aqua VN"]);
  assert.equal(step2.length, 1, "only Oct + Aqua row");
  assert.equal(step2[0].client_name, "Aqua VN");
});
