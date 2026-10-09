// province-filter.worker.js — runs in a Web Worker, no DOM access.
// Computes sortedProvinces, scale, colorMap from filteredLTL data.
// CSS variable strings (e.g. "var(--green)") are passed through as-is;
// the browser resolves them when they're applied to DOM elements.

const WEIGHT_RGB = "13, 148, 136";

function getOntimeColor(pct) {
  if (pct == null || pct >= 90) return "var(--green)";
  if (pct >= 80) return "var(--amber)";
  return "var(--red)";
}

function pctFmt(v) { return v.toFixed(2); }

function compute({ provinceStats, provinceDetailsMap, viewMode, mapIndustry, activeProvinceStats, provinceCapUtil }) {
  const stats = provinceStats || [];
  const detailsMap = provinceDetailsMap || {};
  const capUtil = provinceCapUtil || {};

  // scale
  const maxOrders = Math.max(...stats.map((p) => p.orders), 1);
  const maxWeight = Math.max(...stats.map((p) => (detailsMap[p.name]?.totalWeight || p.weight || 1)), 1);
  const scale = { maxOrders, maxWeight };

  // sortedProvinces
  let sortedProvinces;
  if ((mapIndustry === "nhc" || mapIndustry === "sttp") && (activeProvinceStats || []).length > 0) {
    if (viewMode === "ontime") {
      sortedProvinces = [...activeProvinceStats].sort((a, b) => (a.details?.ontimePct ?? 100) - (b.details?.ontimePct ?? 100));
    } else {
      sortedProvinces = [...activeProvinceStats];
    }
  } else {
    sortedProvinces = [...stats].sort((a, b) => {
      const aDet = detailsMap[a.name] || a.details;
      const bDet = detailsMap[b.name] || b.details;
      if (viewMode === "weight") return (bDet?.totalWeight || a.weight || 0) - (aDet?.totalWeight || b.weight || 0);
      if (viewMode === "ontime") return (aDet?.ontimePct ?? 100) - (bDet?.ontimePct ?? 100);
      if (viewMode === "damage") return (bDet?.damageCount || 0) - (aDet?.damageCount || 0);
      return b.orders - a.orders;
    });
  }

  // colorMap — for NHC/STTP use activeProvinceStats so the map shows that industry's data.
  const colorMap = {};
  const hasCapUtil = Object.keys(capUtil).length > 0;
  const isIndustrySub = (mapIndustry === "nhc" || mapIndustry === "sttp") && (activeProvinceStats || []).length > 0;
  const colorSrc = isIndustrySub ? activeProvinceStats : stats;
  colorSrc.forEach((p) => {
    if (mapIndustry === "all" && hasCapUtil) {
      const u = capUtil[p.name];
      if (!u || u.cap === 0) { colorMap[p.name] = "var(--map-unhighlighted)"; return; }
      const pct = u.actual / u.cap;
      colorMap[p.name] =
        pct >= 1.0 ? "rgba(239,68,68,0.8)"  :
        pct >= 0.8 ? "rgba(245,158,11,0.8)" :
        pct >= 0.5 ? "rgba(34,197,94,0.75)" :
                     "rgba(59,130,246,0.7)";
      return;
    }
    const pDet = isIndustrySub ? p.details : detailsMap[p.name];
    if (viewMode === "weight") {
      const w = pDet?.totalWeight || p.weight || 0;
      const intensity = Math.min(1, w / maxWeight);
      colorMap[p.name] = `rgba(${WEIGHT_RGB}, ${pctFmt(0.25 + intensity * 0.7)})`;
    } else if (viewMode === "ontime") {
      // Recompute from raw counts so pending/return/cancel orders never inflate
      // the denominator and a null/undefined ontimePct never becomes red.
      const nOntime = pDet?.ontimeCount ?? 0;
      const nLate   = pDet?.lateCount   ?? 0;
      const nEval   = nOntime + nLate;
      const pct = nEval > 0 ? Math.round((nOntime / nEval) * 100) : null;
      colorMap[p.name] = getOntimeColor(pct); // null → "var(--green)" (no SLA data yet)
    } else if (viewMode === "damage") {
      colorMap[p.name] = (pDet?.damageCount ?? 0) > 0 ? "var(--amber)" : "var(--map-unhighlighted)";
    } else {
      const intensity = Math.min(1, p.orders / maxOrders);
      colorMap[p.name] = `rgba(var(--brand-rgb), ${pctFmt(0.2 + intensity * 0.75)})`;
    }
  });

  return { sortedProvinces, scale, colorMap };
}

self.onmessage = (e) => {
  try {
    const result = compute(e.data);
    self.postMessage({ ok: true, ...result });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
