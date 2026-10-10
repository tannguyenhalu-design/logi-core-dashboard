/**
 * lib/data-health.js — field-level data quality scan for LTL rows.
 * Checks: formula errors (#N/A, #VALUE!), zero/missing weight, empty
 * warehouse fields, missing order codes, and missing project names.
 * Called once per snapshot by snapshotFacts() in lib/system-health.js.
 */

const SHEET_ERRORS = ["#N/A", "#VALUE!", "#REF!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!"];
const SCAN_FIELDS = ["order_code", "client_name", "kho_lay", "kho_giao", "from_province_name", "to_province_name", "status", "pickup_time"];

function hasError(v) {
  const s = String(v ?? "");
  return SHEET_ERRORS.some((e) => s.startsWith(e));
}

export function scanDataHealth(ltlRows) {
  let errorCells = 0;
  let zeroWeight = 0;
  let emptyKhoLay = 0;
  let emptyKhoGiao = 0;
  let emptyOrderCode = 0;
  let nullPickupTimes = 0;
  let emptyProject = 0;
  const codeCounts = new Map();

  for (const r of ltlRows) {
    for (const f of SCAN_FIELDS) {
      if (hasError(r[f])) errorCells++;
    }

    if (!Number(r.weight || 0)) zeroWeight++;
    if (!String(r.kho_lay || "").trim()) emptyKhoLay++;
    if (!String(r.kho_giao || "").trim()) emptyKhoGiao++;
    if (!String(r.pickup_time || "").trim()) nullPickupTimes++;
    if (!String(r.client_name || "").trim()) emptyProject++;

    const code = String(r.order_code || "").trim();
    if (!code) emptyOrderCode++;
    else codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
  }

  const duplicateOrderCodes = [...codeCounts.values()].filter((n) => n > 1).length;

  return {
    errorCells,
    zeroWeight,
    emptyKhoLay,
    emptyKhoGiao,
    emptyOrderCode,
    nullPickupTimes,
    duplicateOrderCodes,
    emptyProject,
    total: ltlRows.length,
  };
}
