/**
 * hooks/useFilterWorker.js — offloads sortedProvinces / scale / colorMap
 * computation from the main React thread into a Web Worker.
 *
 * Falls back to synchronous computation during SSR or if Worker fails to load.
 * Returns the last successfully computed result while a new computation is
 * pending, so the UI never flickers to an empty/stale state.
 */
import { useRef, useEffect, useState, useMemo } from "react";

const WEIGHT_RGB = "13, 148, 136";

function getOntimeColorSync(pct) {
  if (pct == null || pct >= 90) return "var(--green)";
  if (pct >= 80) return "var(--amber)";
  return "var(--red)";
}

// Synchronous fallback — mirrors the Worker's compute() exactly.
function computeSync({ provinceStats, provinceDetailsMap, viewMode, mapIndustry, activeProvinceStats, provinceCapUtil }) {
  const stats = provinceStats || [];
  const detailsMap = provinceDetailsMap || {};
  const capUtil = provinceCapUtil || {};

  const maxOrders = Math.max(...stats.map((p) => p.orders), 1);
  const maxWeight = Math.max(...stats.map((p) => (detailsMap[p.name]?.totalWeight || p.weight || 1)), 1);
  const scale = { maxOrders, maxWeight };

  let sortedProvinces;
  if ((mapIndustry === "nhc" || mapIndustry === "sttp") && (activeProvinceStats || []).length > 0) {
    sortedProvinces = viewMode === "ontime"
      ? [...activeProvinceStats].sort((a, b) => (a.details?.ontimePct ?? 100) - (b.details?.ontimePct ?? 100))
      : [...activeProvinceStats];
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
      colorMap[p.name] = `rgba(${WEIGHT_RGB}, ${(0.25 + intensity * 0.7).toFixed(2)})`;
    } else if (viewMode === "ontime") {
      colorMap[p.name] = getOntimeColorSync(pDet ? pDet.ontimePct : 100);
    } else if (viewMode === "damage") {
      colorMap[p.name] = (pDet?.damageCount ?? 0) > 0 ? "var(--amber)" : "var(--map-unhighlighted)";
    } else {
      const intensity = Math.min(1, p.orders / maxOrders);
      colorMap[p.name] = `rgba(var(--brand-rgb), ${(0.2 + intensity * 0.75).toFixed(2)})`;
    }
  });

  return { sortedProvinces, scale, colorMap };
}

export function useFilterWorker(inputs) {
  const workerRef = useRef(null);
  const seqRef = useRef(0);
  const [result, setResult] = useState(() => computeSync(inputs));

  // Keep a stable inputs snapshot to avoid posting on every render.
  const {
    provinceStats, provinceDetailsMap, viewMode,
    mapIndustry, activeProvinceStats, provinceCapUtil,
  } = inputs;

  // Initialise worker once on the client side.
  useEffect(() => {
    if (typeof window === "undefined" || typeof Worker === "undefined") return;
    let w;
    try {
      w = new Worker(new URL("../workers/province-filter.worker.js", import.meta.url));
      workerRef.current = w;
    } catch {
      // Worker failed to load; keep using sync fallback.
    }
    return () => {
      w?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Post message whenever relevant inputs change.
  useEffect(() => {
    const w = workerRef.current;
    const seq = ++seqRef.current;

    if (!w) {
      // No worker available — compute synchronously and update state.
      setResult(computeSync({ provinceStats, provinceDetailsMap, viewMode, mapIndustry, activeProvinceStats, provinceCapUtil }));
      return;
    }

    const onMessage = (e) => {
      // Ignore stale responses from previous filter changes.
      if (e.data._seq !== seq) return;
      if (e.data.ok) {
        setResult({ sortedProvinces: e.data.sortedProvinces, scale: e.data.scale, colorMap: e.data.colorMap });
      } else {
        // Worker error — fall back to sync for this tick.
        setResult(computeSync({ provinceStats, provinceDetailsMap, viewMode, mapIndustry, activeProvinceStats, provinceCapUtil }));
      }
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ provinceStats, provinceDetailsMap, viewMode, mapIndustry, activeProvinceStats, provinceCapUtil, _seq: seq });
    return () => w.removeEventListener("message", onMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinceStats, provinceDetailsMap, viewMode, mapIndustry, activeProvinceStats, provinceCapUtil]);

  return result;
}
