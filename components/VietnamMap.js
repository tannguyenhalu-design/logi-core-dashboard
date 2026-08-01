/**
 * components/VietnamMap.js — Shared interactive Vietnam SVG map.
 * Used by Tách Chuyến (province highlight + corridor routes) and
 * the LTL Dashboard (volume heatmap + per-project route lines).
 */
import { useRef } from "react";
import PROV_PATHS from "../lib/prov-paths.json";
import CENTROIDS from "../lib/centroids.json";

export default function VietnamMap({
  highlightProvinces = [],
  colorMap = {},
  onProvinceClick,
  hoveredCorridor = null,
  corridorGroups = {},
  routeLines = [],
}) {
  const svgRef = useRef(null);

  const getColor = (name) => {
    if (colorMap[name]) return colorMap[name];
    if (highlightProvinces.includes(name)) return "#33D6C0";
    return "#2A3344";
  };

  const maxRouteWeight = routeLines.length ? Math.max(...routeLines.map((r) => r.weight || 1)) : 1;

  return (
    <svg ref={svgRef} viewBox="0 0 560 1000" style={{ width: "100%", height: "auto", background: "#0E1420", borderRadius: 8, display: "block" }}>
      {/* Other paths (seas, borders) */}
      {PROV_PATHS.other_paths && PROV_PATHS.other_paths.map((d, i) => (
        <path key={`other-${i}`} d={d} fill="#1A2230" stroke="#0E1420" strokeWidth="0.5" />
      ))}
      {/* Province paths */}
      {Object.entries(PROV_PATHS.province_paths).map(([name, d]) => {
        const color = getColor(name);
        const isHighlight = highlightProvinces.includes(name) || colorMap[name];
        return (
          <path
            key={name}
            d={d}
            fill={color}
            stroke="#0E1420"
            strokeWidth="0.6"
            opacity={isHighlight ? 1 : 0.6}
            style={{ cursor: onProvinceClick ? "pointer" : "default", transition: "opacity 0.2s, fill 0.2s" }}
            onClick={() => onProvinceClick && onProvinceClick(name)}
          >
            <title>{name}</title>
          </path>
        );
      })}
      {/* Centroid markers for highlighted */}
      {highlightProvinces.map((name) => {
        const pt = CENTROIDS[name];
        if (!pt) return null;
        return (
          <g key={`dot-${name}`}>
            <circle cx={pt[0]} cy={pt[1]} r="7" fill="rgba(51, 214, 192, 0.4)">
              <animate attributeName="r" values="4;11;4" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={pt[0]} cy={pt[1]} r="4" fill="#ffffff" stroke="#33D6C0" strokeWidth="1.5" />
          </g>
        );
      })}
      {/* Corridor route lines (Tách Chuyến — hub to many stops) */}
      {Object.entries(corridorGroups).map(([corridorName, { direct, groups, hub, color }]) => {
        const isDimmed = hoveredCorridor && hoveredCorridor !== corridorName;
        const opacity = isDimmed ? 0.12 : hoveredCorridor === corridorName ? 1 : 0.55;
        return (
          <g key={corridorName} style={{ opacity, transition: "opacity 0.2s" }}>
            {direct.map((d) => {
              const pts = [CENTROIDS[hub], CENTROIDS[d.name]].filter(Boolean);
              if (pts.length !== 2) return null;
              return (
                <g key={d.name}>
                  <path d={`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`} fill="none" stroke={color} strokeWidth="2.2" opacity="0.95" />
                  <circle cx={pts[1][0]} cy={pts[1][1]} r="3" fill={color} stroke="#0E1420" strokeWidth="0.8" />
                </g>
              );
            })}
            {groups.map((g, gi) => {
              const pts = [hub, ...g.stops.map((s) => s.name)].map((p) => CENTROIDS[p]).filter(Boolean);
              if (pts.length < 2) return null;
              const pathD = pts.map((pt, i) => (i === 0 ? "M" : "L") + pt[0].toFixed(1) + "," + pt[1].toFixed(1)).join(" ");
              return (
                <g key={gi}>
                  <path d={pathD} fill="none" stroke={color} strokeWidth="1.8" strokeDasharray="3,2" opacity="0.95" />
                  {pts.map((pt, pi) => (
                    <circle key={pi} cx={pt[0]} cy={pt[1]} r={pi === 0 ? 3.5 : 2.5} fill={pi === 0 ? "#fff" : color} stroke="#0E1420" strokeWidth="0.8" />
                  ))}
                </g>
              );
            })}
          </g>
        );
      })}
      {/* Direct point-to-point route lines (LTL Dashboard — from province to to province) */}
      {routeLines.map((r, i) => {
        const from = CENTROIDS[r.from];
        const to = CENTROIDS[r.to];
        if (!from || !to) return null;
        const w = 1 + ((r.weight || 1) / maxRouteWeight) * 3;
        return (
          <g key={`route-${i}`}>
            <path
              d={`M${from[0].toFixed(1)},${from[1].toFixed(1)} L${to[0].toFixed(1)},${to[1].toFixed(1)}`}
              fill="none"
              stroke={r.color || "#33D6C0"}
              strokeWidth={w}
              opacity="0.75"
            />
            <circle cx={to[0]} cy={to[1]} r="3.5" fill={r.color || "#33D6C0"} stroke="#0E1420" strokeWidth="0.8" />
          </g>
        );
      })}
    </svg>
  );
}
