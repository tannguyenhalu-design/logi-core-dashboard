/**
 * components/VietnamMap.js — Sleek & Clean Interactive Vietnam SVG map.
 * Renders heatmaps, route lines, and clean province highlights without visual clutter.
 */
import { memo, useRef, useState } from "react";
import PROV_PATHS from "../lib/prov-paths.json";
import CENTROIDS from "../lib/centroids.json";

// Memoized — this renders ~63 SVG province paths, and the parent
// (ProvinceMapPanel) re-renders on every hover over the "Top 8 Tỉnh" list.
// Without this, that hover-only state change forced a full map re-render
// every mouse move (visible as stutter/lag); now it only re-renders when
// its own props actually change.
function VietnamMap({
  highlightProvinces = [],
  colorMap = {},
  onProvinceClick,
  onProvinceHover,
  hoveredCorridor = null,
  corridorGroups = {},
  routeLines = [],
  provinceDetailsMap = {},
  viewMode = "orders", // 'orders' | 'weight' | 'ontime' | 'damage'
  style = {},
}) {
  const svgRef = useRef(null);
  const [hoveredProv, setHoveredProv] = useState(null);
  const hoverTimerRef = useRef(null);

  const handleMouseEnter = (name) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredProv(name);
    if (onProvinceHover) onProvinceHover(name);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredProv(null);
      if (onProvinceHover) onProvinceHover(null);
    }, 35);
  };

  const getColor = (name) => {
    if (hoveredProv === name) return "#38bdf8"; // bright sky blue on hover
    if (colorMap[name]) return colorMap[name];

    const pDetail = provinceDetailsMap[name];
    if (pDetail && pDetail.totalOrders > 0) {
      if (viewMode === "ontime") {
        if (pDetail.ontimePct >= 90) return "#10b981";
        if (pDetail.ontimePct >= 80) return "#f59e0b";
        return "#f43f5e";
      }
      if (viewMode === "damage") {
        return pDetail.damageCount > 0 ? "#f59e0b" : "#10b981";
      }
      if (pDetail.ontimePct < 80) return "rgba(244, 63, 94, 0.75)"; // Red (<80%)
      if (pDetail.ontimePct < 90) return "rgba(245, 158, 11, 0.75)"; // Yellow/Amber (80-90%)
      return "rgba(var(--brand-rgb),0.55)"; // Green/Cyan (>=90%)
    }

    if (highlightProvinces.includes(name)) return "#33D6C0";
    return "var(--map-unhighlighted, #2A3344)";
  };

  const maxRouteWeight = routeLines.length ? Math.max(...routeLines.map((r) => r.weight || 1)) : 1;
  const hoverDetail = hoveredProv ? provinceDetailsMap[hoveredProv] : null;

  // Extract unique colors for arrow markers
  const arrowColors = [...new Set([
    ...routeLines.map((r) => r.color || "#33D6C0"),
    ...Object.values(corridorGroups).map((g) => g.color || "#38bdf8")
  ])];

  return (
    <div style={{ position: "relative", width: "100%", overflow: "hidden", borderRadius: 12, ...style }}>
      <svg
        ref={svgRef}
        viewBox="0 0 560 1000"
        style={{
          width: "100%",
          height: "auto",
          maxHeight: 440,
          background: "var(--map-ocean, #0E1420)",
          borderRadius: 12,
          display: "block",
          border: "1px solid var(--border)",
          boxShadow: "0 4px 20px var(--shadow-soft)",
          transition: "background 0.3s ease",
        }}
      >
        <defs>
          {arrowColors.map(c => (
            <marker key={c} id={`arrow-${c.replace("#", "")}`} markerWidth="8" markerHeight="8" refX="10" refY="4" orient="auto">
              <polygon points="0 0, 8 4, 0 8" fill={c} opacity="0.9" />
            </marker>
          ))}
        </defs>

        {/* Other paths (seas, islands, borders) */}
        {PROV_PATHS.other_paths &&
          PROV_PATHS.other_paths.map((d, i) => (
            <path
              key={`other-${i}`}
              d={d}
              fill="var(--map-land, #1A2230)"
              stroke="var(--map-stroke, #0E1420)"
              strokeWidth="0.5"
            />
          ))}

        {/* Province paths — Clean & uncluttered */}
        {Object.entries(PROV_PATHS.province_paths).map(([name, d]) => {
          const pDetail = provinceDetailsMap[name];
          const isWarning = pDetail && pDetail.totalOrders > 0 && pDetail.ontimePct < 90;
          const color = getColor(name);
          const isHighlight = highlightProvinces.includes(name) || colorMap[name] || isWarning;
          const isHovered = hoveredProv === name;

          return (
            <path
              key={name}
              d={d}
              fill={color}
              stroke={isHovered ? "#38bdf8" : isWarning ? "#f43f5e" : "var(--map-stroke, #0E1420)"}
              strokeWidth={isHovered ? "1.6" : isWarning ? "1.2" : "0.5"}
              opacity={isHovered ? 1 : isHighlight ? 0.9 : 0.6}
              style={{
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={() => handleMouseEnter(name)}
              onMouseLeave={handleMouseLeave}
              onClick={() => onProvinceClick && onProvinceClick(name)}
            >
              <title>{`${name}${pDetail ? ` - ${pDetail.totalOrders} đơn | Ontime: ${pDetail.ontimePct}%` : ""}`}</title>
            </path>
          );
        })}

        {/* Single clean dot marker for hovered province */}
        {hoveredProv && CENTROIDS[hoveredProv] && (
          <g key="hover-dot">
            <circle cx={CENTROIDS[hoveredProv][0]} cy={CENTROIDS[hoveredProv][1]} r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
          </g>
        )}

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
                    <path
                      d={`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`}
                      fill="none"
                      stroke={color}
                      strokeWidth="2.2"
                      opacity="0.95"
                      markerEnd={`url(#arrow-${(color || "#38bdf8").replace("#", "")})`}
                    />
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
                markerEnd={`url(#arrow-${(r.color || "#33D6C0").replace("#", "")})`}
              />
              <circle cx={from[0]} cy={from[1]} r="2.5" fill="var(--map-ocean, #0E1420)" stroke={r.color || "#33D6C0"} strokeWidth="1.2" />
              <circle cx={to[0]} cy={to[1]} r="3.5" fill={r.color || "#33D6C0"} stroke="#0E1420" strokeWidth="0.8" />
            </g>
          );
        })}
      </svg>

      {/* In-Map Hover Inspector Badge — Clean, pinned at bottom of map container (0% overlap) */}
      {hoveredProv && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            right: 8,
            pointerEvents: "none",
            zIndex: 100,
            background: "rgba(15, 23, 42, 0.94)",
            backdropFilter: "blur(14px)",
            border: hoverDetail && hoverDetail.ontimePct < 90 ? "1px solid rgba(244,63,94,0.6)" : "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            color: "#fff",
            fontSize: 11,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12, color: hoverDetail && hoverDetail.ontimePct < 90 ? "#f43f5e" : "var(--cyan)", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
            <span>📍 {hoveredProv}</span>
            {hoverDetail && (
              <span style={{ fontSize: 10.5, background: hoverDetail.ontimePct < 90 ? "rgba(244,63,94,0.2)" : "rgba(var(--brand-rgb),0.15)", padding: "1px 6px", borderRadius: 4, color: hoverDetail.ontimePct < 90 ? "#f43f5e" : "var(--cyan)" }}>
                {hoverDetail.totalOrders} đơn · {(hoverDetail.totalWeight / 1000).toFixed(1)} tấn
              </span>
            )}
          </div>

          {hoverDetail ? (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#94a3b8" }}>
              <span>Ontime: <b style={{ color: hoverDetail.ontimePct >= 90 ? "#10b981" : "#f43f5e", fontWeight: 700 }}>{hoverDetail.ontimePct}% {hoverDetail.ontimePct < 90 && "⚠️"}</b></span>
              {hoverDetail.topOrigins && hoverDetail.topOrigins.length > 0 && (
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
