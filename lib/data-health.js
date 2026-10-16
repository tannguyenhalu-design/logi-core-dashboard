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

/**
 * Deterministic 0-100 quality score from 6 weighted criteria.
 *   completeness(25) + validity(20) + uniqueness(20) +
 *   freshness(15) + volumeAnomaly(10) + referentialConsistency(10)
 *
 * GREEN ≥ 80  |  YELLOW 50-79  |  RED < 50
 *
 * @param {{ ltlRows: object[], builtAt?: string }} base — snapshot object
 * @returns {{ score: number, status: "GREEN"|"YELLOW"|"RED", breakdown: object }}
 */
export function computeQualityScore(base) {
  if (!base?.ltlRows) {
    return {
      score: 0,
      status: "RED",
      breakdown: { reason: "No snapshot available" },
    };
  }

  const dh = scanDataHealth(base.ltlRows);
  const total = Math.max(dh.total, 1);

  // Completeness (25): required fields present
  const missingRequired = dh.emptyOrderCode + dh.emptyProject + dh.nullPickupTimes;
  const missingRate = missingRequired / total;
  const completeness = Math.max(0, Math.round(25 * (1 - Math.min(missingRate * 10, 1))));

  // Validity (20): formula errors across scanned fields
  const maxErrors = total * SCAN_FIELDS.length;
  const errorRate = maxErrors > 0 ? dh.errorCells / maxErrors : 0;
  const validity = Math.max(0, Math.round(20 * (1 - Math.min(errorRate * 20, 1))));

  // Uniqueness (20): duplicate order codes
  const dupRate = dh.duplicateOrderCodes / total;
  const uniqueness = Math.max(0, Math.round(20 * (1 - Math.min(dupRate * 100, 1))));

  // Freshness (15): age of snapshot
  const ageMs = base.builtAt ? Date.now() - new Date(base.builtAt).getTime() : Infinity;
  const ageHrs = ageMs / 3_600_000;
  const freshness = ageHrs < 6 ? 15 : ageHrs < 12 ? 12 : ageHrs < 24 ? 6 : 0;

  // Volume anomaly (10): total rows in plausible range
  const volumeOk = total >= 100 && total <= 600_000;
  const volumeAnomaly = volumeOk ? 10 : 0;

  // Referential consistency (10): warehouse fields populated
  const khoEmptyRate = (dh.emptyKhoLay + dh.emptyKhoGiao) / (total * 2);
  const referentialConsistency = Math.max(0, Math.round(10 * (1 - Math.min(khoEmptyRate * 5, 1))));

  const score = completeness + validity + uniqueness + freshness + volumeAnomaly + referentialConsistency;
  const status = score >= 80 ? "GREEN" : score >= 50 ? "YELLOW" : "RED";

  return {
    score,
    status,
    breakdown: {
      completeness: { score: completeness, max: 25, detail: `${missingRequired} missing required fields (${(missingRate * 100).toFixed(1)}%)` },
      validity: { score: validity, max: 20, detail: `${dh.errorCells} formula errors` },
      uniqueness: { score: uniqueness, max: 20, detail: `${dh.duplicateOrderCodes} duplicate order codes` },
      freshness: { score: freshness, max: 15, detail: `${ageHrs < Infinity ? ageHrs.toFixed(1) + "h" : "unknown"} since snapshot build` },
      volumeAnomaly: { score: volumeAnomaly, max: 10, detail: `${total} rows (${volumeOk ? "normal range" : "ANOMALOUS"})` },
      referentialConsistency: { score: referentialConsistency, max: 10, detail: `${dh.emptyKhoLay} emptyKhoLay + ${dh.emptyKhoGiao} emptyKhoGiao` },
    },
  };
}
