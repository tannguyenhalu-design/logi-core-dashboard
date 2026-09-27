/**
 * components/VietnamMap.js — Interactive Vietnam province map (SVG).
 *
 * Performance notes: the 63 province paths live in a memoized layer that
 * never re-renders on hover — hover only redraws a single outline overlay
 * and the info badge. One delegated pointer handler on the layer (via
 * data-name) replaces 63 per-path closures, and paths have no CSS
 * transitions, so hovering stays at full frame rate.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import PROV_PATHS from "../lib/prov-paths.json";
import CENTROIDS from "../lib/centroids.json";

const PATHS = PROV_PATHS.province_paths;
const PATH_ENTRIES = Object.entries(PATHS);
const ROUTE_COLOR = "#33D6C0";

// Theme-aware fills (CSS vars) so the light theme gets its calmer shades.
function fillFor(name, { colorMap, provinceDetailsMap, viewMode, highlightSet }) {
  if (colorMap[name]) return colorMap[name];
  const d = provinceDetailsMap[name];
  if (d && d.totalOrders > 0) {
    if (viewMode === "ontime") return d.ontimePct >= 90 ? "var(--green)" : d.ontimePct >= 80 ? "var(--amber)" : "var(--red)";
    if (viewMode === "damage") return d.damageCount > 0 ? "var(--amber)" : "var(--green)";
    if (d.ontimePct < 80) return "var(--red)";
    if (d.ontimePct < 90) return "var(--amber)";
    return "rgba(var(--brand-rgb),0.55)";
  }
  if (highlightSet.has(name)) return "var(--cyan)";
  return "var(--map-unhighlighted)";
}

const ProvinceLayer = memo(function ProvinceLayer({ colorMap, provinceDetailsMap, viewMode, highlightProvinces, onOver, onLeave, onClick }) {
  const highlightSet = new Set(highlightProvinces);
  const ctx = { colorMap, provinceDetailsMap, viewMode, highlightSet };
  return (
    <g onMouseOver={onOver} onMouseLeave={onLeave} onClick={onClick} style={{ cursor: "pointer" }}>
      {PATH_ENTRIES.map(([name, d]) => {
        const det = provinceDetailsMap[name];
        const isWarning = det && det.totalOrders > 0 && det.ontimePct < 90;
        const isHighlight = highlightSet.has(name) || colorMap[name] || isWarning;
        return (
          <path
            key={name}
            data-name={name}
            d={d}
            fill={fillFor(name, ctx)}
            stroke={isWarning ? "var(--red)" : "var(--map-stroke)"}
            strokeWidth={isWarning ? 1.2 : 0.5}
            opacity={isHighlight ? 0.9 : 0.6}
          />
        );
      })}
    </g>
  );
});

function VietnamMap({
  highlightProvinces = [],
  colorMap = {},
  onProvinceClick,
  onProvinceHover,
  routeLines = [],
  provinceDetailsMap = {},
  viewMode = "orders", // 'orders' | 'weight' | 'ontime' | 'damage'
  selectedProvince = null, // pinned outline (e.g. from "Top 5 điểm nóng"); its own overlay, never re-renders the 63-path layer
  style = {},
}) {
  const [hoveredProv, setHoveredProv] = useState(null);
  const hoveredRef = useRef(null);
  const leaveTimer = useRef(null);
  // Hover is applied at most once per animation frame (2026-09-27): sweeping
  // the mouse across several provinces fires many mouseover events per frame,
  // only the last one is rendered.
  const frame = useRef(0);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  const onOver = useCallback((e) => {
    const name = e.target?.dataset?.name;
    if (!name) return;
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    if (hoveredRef.current === name) return;
    hoveredRef.current = name;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const current = hoveredRef.current;
      setHoveredProv(current);
      if (onProvinceHover) onProvinceHover(current);
    });
  }, [onProvinceHover]);

  const onLeave = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      hoveredRef.current = null;
      setHoveredProv(null);
      if (onProvinceHover) onProvinceHover(null);
    }, 35);
  }, [onProvinceHover]);

  const onClick = useCallback((e) => {
    const name = e.target?.dataset?.name;
    if (name && onProvinceClick) onProvinceClick(name);
  }, [onProvinceClick]);

  const maxRouteWeight = routeLines.length ? Math.max(...routeLines.map((r) => r.weight || 1)) : 1;
  const hoverDetail = hoveredProv ? provinceDetailsMap[hoveredProv] : null;
  const hoverWarn = hoverDetail && hoverDetail.ontimePct < 90;
  const arrowColors = [...new Set(routeLines.map((r) => r.color || ROUTE_COLOR))];

  return (
    <div style={{ position: "relative", width: "100%", overflow: "hidden", borderRadius: 10, ...style }}>
      <svg
        viewBox="0 0 560 1000"
        style={{
          width: "100%", height: "auto", maxHeight: 440, display: "block",
          background: "var(--map-ocean)", borderRadius: 10, border: "1px solid var(--border)",
        }}
      >
        <defs>
          {arrowColors.map((c) => (
            <marker key={c} id={`arrow-${c.replace("#", "")}`} markerWidth="8" markerHeight="8" refX="10" refY="4" orient="auto">
              <polygon points="0 0, 8 4, 0 8" fill={c} opacity="0.9" />
            </marker>
          ))}
        </defs>

        <ProvinceLayer
          colorMap={colorMap}
          provinceDetailsMap={provinceDetailsMap}
          viewMode={viewMode}
          highlightProvinces={highlightProvinces}
          onOver={onOver}
          onLeave={onLeave}
          onClick={onClick}
        />

        {selectedProvince && PATHS[selectedProvince] && (
          <g pointerEvents="none">
            <path d={PATHS[selectedProvince]} fill="rgba(244,63,94,0.35)" stroke="var(--red)" strokeWidth={2.4} />
            {CENTROIDS[selectedProvince] && (
              <circle cx={CENTROIDS[selectedProvince][0]} cy={CENTROIDS[selectedProvince][1]} r="9" fill="none" stroke="var(--red)" strokeWidth="2.5" />
            )}
          </g>
        )}

        {hoveredProv && PATHS[hoveredProv] && (
          <g pointerEvents="none">
            <path d={PATHS[hoveredProv]} fill="var(--cyan)" stroke="var(--cyan)" strokeWidth={1.6} />
            {CENTROIDS[hoveredProv] && (
              <circle cx={CENTROIDS[hoveredProv][0]} cy={CENTROIDS[hoveredProv][1]} r="6" fill="var(--cyan)" stroke="var(--map-ocean)" strokeWidth="1.5" />
            )}
          </g>
        )}

        {/* Route lines (single-project view): pickup province → delivery province */}
        <g pointerEvents="none">
          {routeLines.map((r, i) => {
            const from = CENTROIDS[r.from];
            const to = CENTROIDS[r.to];
            if (!from || !to) return null;
            const color = r.color || ROUTE_COLOR;
            const w = 1 + ((r.weight || 1) / maxRouteWeight) * 3;
            return (
              <g key={`route-${i}`}>
                <path
                  d={`M${from[0].toFixed(1)},${from[1].toFixed(1)}L${to[0].toFixed(1)},${to[1].toFixed(1)}`}
                  fill="none" stroke={color} strokeWidth={w} opacity="0.75"
                  markerEnd={`url(#arrow-${color.replace("#", "")})`}
                />
                <circle cx={from[0]} cy={from[1]} r="2.5" fill="var(--map-ocean)" stroke={color} strokeWidth="1.2" />
                <circle cx={to[0]} cy={to[1]} r="3.5" fill={color} stroke="var(--map-stroke)" strokeWidth="0.8" />
              </g>
            );
          })}
        </g>
      </svg>

      {hoveredProv && (
        <div
          style={{
            position: "absolute", bottom: 8, left: 8, right: 8, pointerEvents: "none", zIndex: 100,
            background: "#0f172a", border: `1px solid ${hoverWarn ? "rgba(244,63,94,0.6)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 11,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12, color: hoverWarn ? "#f43f5e" : "#fb923c", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
            <span>{hoveredProv}</span>
            {hoverDetail && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#e2e8f0" }}>
                {hoverDetail.totalOrders} đơn · {(hoverDetail.totalWeight / 1000).toFixed(1)} tấn
              </span>
            )}
          </div>
          {hoverDetail ? (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#94a3b8" }}>
              <span>Ontime: <b style={{ color: hoverWarn ? "#f43f5e" : "#10b981" }}>{hoverDetail.ontimePct}%</b></span>
              {hoverDetail.topOrigins?.length > 0 && (
                <span>Lấy từ: <b style={{ color: "#f1f5f9" }}>{hoverDetail.topOrigins[0].name}</b></span>
              )}
            </div>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 10 }}>Chưa có đơn phát sinh trong bộ lọc</div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(VietnamMap);
