/**
 * tests/data-validator.test.mjs — Tests for row-level validation rules.
 * Tests: required fields, type checks, enum checks, LOG-only vs STRICT mode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Inline validation logic (mirrors lib/data-validator.js)
class DataValidationError extends Error {
  constructor(schemaName, tallies) {
    super(`STRICT: ${schemaName} — ${tallies.invalid} invalid rows`);
    this.name = "DataValidationError";
    this.tallies = tallies;
  }
}

const RAW_ONTIME_SCHEMA = {
  name: "raw_ontime",
  required: ["order_code", "client_name", "status", "pickup_time"],
  types: { weight: "number", pickup_time: "datetime" },
  enums: {
    odr_success: ["ontime", "late", "return", "cancel"],
    nganh_hang: ["DM", "STTP", "NHC", "ECOM"],
  },
};

function _validateRow(schema, row, rowIndex) {
  const errors = [], warnings = [];
  for (const field of schema.required || []) {
    const val = row[field];
    if (val === null || val === undefined || String(val).trim() === "") {
      errors.push({ row: rowIndex, field, rule: "required" });
    }
  }
  for (const [field, expectedType] of Object.entries(schema.types || {})) {
    const val = row[field];
    if (val === null || val === undefined || String(val).trim() === "") continue;
    if (expectedType === "number" && isNaN(Number(val))) {
      warnings.push({ row: rowIndex, field, rule: "type:number" });
    } else if (expectedType === "datetime") {
      const s = String(val).trim();
      const isExcelSerial = /^\d{4,6}(\.\d+)?$/.test(s);
      if (!isExcelSerial && isNaN(new Date(s).getTime())) {
        warnings.push({ row: rowIndex, field, rule: "type:datetime" });
      }
    }
  }
  for (const [field, allowed] of Object.entries(schema.enums || {})) {
    const val = String(row[field] || "").trim();
    if (val === "") continue;
    if (!allowed.includes(val)) {
      warnings.push({ row: rowIndex, field, rule: "enum" });
    }
  }
  return { errors, warnings };
}

function validateRows(schema, rows, opts = {}) {
  const strict = opts.strict ?? false;
  const errors = [], warnings = [];
  let invalidCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const result = _validateRow(schema, rows[i], i);
    if (result.errors.length > 0) invalidCount++;
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  const tallies = { total: rows.length, valid: rows.length - invalidCount, invalid: invalidCount, errorCount: errors.length, warningCount: warnings.length };
  if (strict && invalidCount > 0) throw new DataValidationError(schema.name, tallies);
  return { valid: invalidCount === 0, errors, warnings, tallies };
}

const goodRow = {
  order_code: "GHN123456",
  client_name: "Aqua VN",
  status: "delivered",
  pickup_time: "2026-10-01T08:00:00",
  weight: 5.5,
  odr_success: "ontime",
  nganh_hang: "DM",
};

test("valid row produces no errors or warnings", () => {
  const result = validateRows(RAW_ONTIME_SCHEMA, [goodRow]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.valid, true);
});

test("missing required field produces error", () => {
  const row = { ...goodRow, order_code: "" };
  const result = validateRows(RAW_ONTIME_SCHEMA, [row]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "order_code" && e.rule === "required"));
});

test("null pickup_time produces required error", () => {
  const row = { ...goodRow, pickup_time: null };
  const result = validateRows(RAW_ONTIME_SCHEMA, [row]);
  assert.ok(result.errors.some((e) => e.field === "pickup_time"));
});

test("non-numeric weight produces warning (not error)", () => {
  const row = { ...goodRow, weight: "heavy" };
  const result = validateRows(RAW_ONTIME_SCHEMA, [row]);
  assert.equal(result.valid, true, "type mismatch is warning not error");
  assert.ok(result.warnings.some((w) => w.field === "weight" && w.rule === "type:number"));
});

test("invalid enum value produces warning", () => {
  const row = { ...goodRow, odr_success: "UNKNOWN_STATUS" };
  const result = validateRows(RAW_ONTIME_SCHEMA, [row]);
  assert.ok(result.warnings.some((w) => w.field === "odr_success" && w.rule === "enum"));
});

test("valid enum values do not produce warnings", () => {
  for (const val of ["ontime", "late", "return", "cancel"]) {
    const row = { ...goodRow, odr_success: val };
    const result = validateRows(RAW_ONTIME_SCHEMA, [row]);
    assert.ok(!result.warnings.some((w) => w.field === "odr_success"), `${val} should be valid`);
  }
});

test("LOG mode (strict=false): invalid rows do not throw", () => {
  const badRow = { client_name: "Aqua", status: "ok", pickup_time: "2026-01-01" }; // missing order_code
  assert.doesNotThrow(() => validateRows(RAW_ONTIME_SCHEMA, [badRow], { strict: false }));
});

test("STRICT mode throws DataValidationError on invalid rows", () => {
  const badRow = { client_name: "Aqua", status: "ok", pickup_time: "2026-01-01" }; // missing order_code
  assert.throws(
    () => validateRows(RAW_ONTIME_SCHEMA, [badRow], { strict: true }),
    DataValidationError
  );
});

test("tallies.valid + tallies.invalid == tallies.total", () => {
  const rows = [
    goodRow,
    { ...goodRow, order_code: "" }, // invalid
    { ...goodRow, order_code: "X2" },
  ];
  const { tallies } = validateRows(RAW_ONTIME_SCHEMA, rows);
  assert.equal(tallies.valid + tallies.invalid, tallies.total);
});

test("Excel serial datetime does not trigger datetime warning", () => {
  const row = { ...goodRow, pickup_time: "45000" }; // Excel serial
  const result = validateRows(RAW_ONTIME_SCHEMA, [row]);
  assert.ok(!result.warnings.some((w) => w.field === "pickup_time" && w.rule === "type:datetime"));
});

test("empty rows array returns valid with zero tallies", () => {
  const result = validateRows(RAW_ONTIME_SCHEMA, []);
  assert.equal(result.valid, true);
  assert.equal(result.tallies.total, 0);
  assert.equal(result.tallies.invalid, 0);
});
