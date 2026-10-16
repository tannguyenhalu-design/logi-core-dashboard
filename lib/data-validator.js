/**
 * lib/data-validator.js — Centralized row-level validation for all datasets.
 *
 * Default mode: LOG-only (record warnings, compute quality score, never block).
 * STRICT_MODE=true env var: throws DataValidationError when invalid rows found.
 *
 * Usage:
 *   import { validateRows } from "./data-validator.js";
 *   const result = validateRows("raw_ontime", rows);
 *   // { valid, errors, warnings, tallies, strict }
 */
import { SCHEMA_MAP } from "./schemas/index.js";

export class DataValidationError extends Error {
  constructor(schemaName, tallies) {
    super(
      `[data-validator] STRICT: ${schemaName} — ${tallies.invalid} invalid rows out of ${tallies.total}`
    );
    this.name = "DataValidationError";
    this.schemaName = schemaName;
    this.tallies = tallies;
  }
}

/**
 * Validate an array of rows against a named schema.
 * @param {string} schemaName — key in SCHEMA_MAP (e.g. "raw_ontime")
 * @param {object[]} rows
 * @param {{ strict?: boolean }} opts — override STRICT_MODE for this call
 * @returns {{ valid: boolean, errors: object[], warnings: object[], tallies: object, strict: boolean }}
 */
export function validateRows(schemaName, rows, opts = {}) {
  const schema = SCHEMA_MAP[schemaName];
  if (!schema) {
    console.warn(`[data-validator] Unknown schema: "${schemaName}" — skipping`);
    return { valid: true, errors: [], warnings: [], tallies: { total: rows.length, valid: rows.length, invalid: 0 }, strict: false };
  }

  const strict = opts.strict ?? (process.env.STRICT_MODE === "true");
  const errors = [];
  const warnings = [];
  let invalidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const result = _validateRow(schema, rows[i], i);
    if (result.errors.length > 0) {
      invalidCount++;
      if (errors.length < 200) errors.push(...result.errors);
    }
    if (warnings.length < 200) warnings.push(...result.warnings);
  }

  const tallies = {
    total: rows.length,
    valid: rows.length - invalidCount,
    invalid: invalidCount,
    errorCount: errors.length,
    warningCount: warnings.length,
  };

  if (invalidCount > 0 || warnings.length > 0) {
    const label = strict ? "STRICT BLOCK" : "LOG";
    console.warn(
      `[data-validator][${label}] ${schemaName}: ${invalidCount} invalid rows, ${warnings.length} warnings (${rows.length} total)`
    );
  }

  if (strict && invalidCount > 0) {
    throw new DataValidationError(schemaName, tallies);
  }

  return { valid: invalidCount === 0, errors, warnings, tallies, strict };
}

function _validateRow(schema, row, rowIndex) {
  const errors = [];
  const warnings = [];

  for (const field of schema.required || []) {
    const val = row[field];
    if (val === null || val === undefined || String(val).trim() === "") {
      errors.push({ row: rowIndex, field, rule: "required", message: `Required field '${field}' missing` });
    }
  }

  for (const [field, expectedType] of Object.entries(schema.types || {})) {
    const val = row[field];
    if (val === null || val === undefined || String(val).trim() === "") continue;

    if (expectedType === "number") {
      const n = Number(val);
      if (isNaN(n)) {
        warnings.push({ row: rowIndex, field, rule: "type:number", message: `'${field}' should be number, got "${val}"` });
      }
    } else if (expectedType === "datetime") {
      const s = String(val).trim();
      const isExcelSerial = /^\d{4,6}(\.\d+)?$/.test(s);
      if (!isExcelSerial) {
        const d = new Date(s);
        if (isNaN(d.getTime())) {
          warnings.push({ row: rowIndex, field, rule: "type:datetime", message: `'${field}' invalid datetime: "${s}"` });
        }
      }
    }
  }

  for (const [field, allowedValues] of Object.entries(schema.enums || {})) {
    const val = String(row[field] || "").trim();
    if (val === "") continue;
    if (!allowedValues.includes(val)) {
      warnings.push({
        row: rowIndex,
        field,
        rule: "enum",
        message: `'${field}' value "${val}" not in [${allowedValues.join(", ")}]`,
      });
    }
  }

  return { errors, warnings };
}
