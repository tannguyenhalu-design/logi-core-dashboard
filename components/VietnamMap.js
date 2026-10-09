/**
 * components/VietnamMap.js — Interactive Vietnam province map (SVG).
 *
 * Performance notes: the 63 province paths live in a memoized layer that
 * never re-renders on hover or zoom — hover only redraws a single outline
 * overlay, and zoom/pan only changes the SVG viewBox (paths use
 * non-scaling strokes, so their attributes never change). One delegated
 * pointer handler on the layer (via data-name) replaces 63 per-path
 * closures, and paths have no CSS transitions, so hovering stays at full
 * frame rate.
 *
 * Zoom / pan (Kế hoạch D · Phần 1, 29/09): + − ⟲ buttons, mouse wheel
 * (around the cursor), drag to move, two-finger pinch on touch screens,
 * `focusProvince` flies to a province. The view is { cx, cy, k } — centre in
 * map units + zoom factor — and the viewBox is derived from the container's
 * pixel size so it never letterboxes. Province names appear from LABEL_K up.
 *
 * Warehouse layer (Kế hoạch D · 2a, 29/09): `warehouses` = dots at their real
 * position (lat/lng projected in lib/warehouse-layer.js), radius in SCREEN
 * pixels so zooming in separates nearby warehouses instead of inflating the
 * dots. `provinceMuted` greys the 63 provinces and makes them click-through
 * (layer "Kho" only).
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import PROV_PATHS from "../lib/prov-paths.json";
import CENTROIDS from "../lib/centroids.json";

const PATHS = PROV_PATHS.province_paths;
const PATH_ENTRIES = Object.entries(PATHS);
const ROUTE_COLOR = "#33D6C0";

// Extent of all province paths (absolute M/L/Z only): x 20–540, y 20–980.
const PAD = 8;
const BOUNDS = { x: 20 - PAD, y: 20 - PAD, w: 520 + 2 * PAD, h: 960 + 2 * PAD };
const DEFAULT_VIEW = { cx: BOUNDS.x + BOUNDS.w / 2, cy: BOUNDS.y + BOUNDS.h / 2, k: 1 };
const K_MIN = 1;
const K_MAX = 12;
const K_STEP = 1.6;
const LABEL_K = 2.2; // province names show from this zoom level up
const LABEL_NAMES = Object.keys(CENTROIDS).filter((n) => PATHS[n]);
const WH_LABEL_K = 4; // warehouse names show from this zoom level up
// Outer ring = total GTC delivery load (from KhoGiaoTongTai); inner dot =
// Điện máy share. --text-secondary shows on both dark and light maps.
const WH_RING_STROKE = "var(--text-secondary)";
const WH_DOT_FILL = "rgba(var(--brand-rgb), 0.82)"; // brand orange

const boxCache = {};
function provinceBox(name) {
  if (boxCache[name]) return boxCache[name];
  const d = PATHS[name];
  if (!d) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
    const x = +m[1], y = +m[2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return (boxCache[name] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

// Pixels per map unit at zoom 1 (whole country fits the container).
const basePpu = (W, H) => Math.min(W / BOUNDS.w, H / BOUNDS.h);

function viewBoxOf(v, W, H) {
  if (!W || !H) return [BOUNDS.x, BOUNDS.y, BOUNDS.w, BOUNDS.h];
  const ppu = basePpu(W, H) * v.k;
  const vw = W / ppu, vh = H / ppu;
  return [v.cx - vw / 2, v.cy - vh / 2, vw, vh];
}

// Keep the zoom in range and the country inside the frame (no panning it away).
function clampView(v, W, H) {
  const k = Math.min(K_MAX, Math.max(K_MIN, v.k));
  if (!W || !H) return { ...DEFAULT_VIEW, k };
  const ppu = basePpu(W, H) * k;
  const vw = W / ppu, vh = H / ppu;
  const cx = vw >= BOUNDS.w ? DEFAULT_VIEW.cx : Math.min(BOUNDS.x + BOUNDS.w - vw / 2, Math.max(BOUNDS.x + vw / 2, v.cx));
  const cy = vh >= BOUNDS.h ? DEFAULT_VIEW.cy : Math.min(BOUNDS.y + BOUNDS.h - vh / 2, Math.max(BOUNDS.y + vh / 2, v.cy));
  return { cx, cy, k };
}

// Zoom by `factor` keeping the map point under (px, py) — container pixels — fixed.
function zoomAt(v, factor, px, py, W, H) {
  const [vx, vy, vw, vh] = viewBoxOf(v, W, H);
  const mx = vx + (px / W) * vw, my = vy + (py / H) * vh;
  const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor));
  const f = k / v.k;
  const vw2 = vw / f, vh2 = vh / f;
  return clampView({ cx: mx - (px / W) * vw2 + vw2 / 2, cy: my - (py / H) * vh2 + vh2 / 2, k }, W, H);
}

// Theme-aware fills (CSS vars) so the light theme gets its calmer shades.
function fillFor(name, { colorMap, provinceDetailsMap, viewMode, highlightSet }) {
  if (colorMap[name]) return colorMap[name];
  const d = provinceDetailsMap[name];
  // Guard: only enter if the province has at least one evaluated (ontime/late) order.
  const evalCount = (d?.ontimeCount ?? 0) + (d?.lateCount ?? 0);
  if (d && evalCount > 0) {
    if (viewMode === "ontime") {
      // Recompute from counts (not pre-cached ontimePct) so null/NaN never maps to red.
      const pct = Math.round(((d.ontimeCount ?? 0) / evalCount) * 100);
      return pct >= 90 ? "var(--green)" : pct >= 80 ? "var(--amber)" : "var(--red)";
    }
    if (viewMode === "damage") return (d.damageCount ?? 0) > 0 ? "var(--amber)" : "var(--green)";
    const otp = d.ontimePct ?? 100; // null-safe for orders/weight fallback tint
    if (otp < 80) return "var(--red)";
    if (otp < 90) return "var(--amber)";
    return "rgba(var(--brand-rgb),0.55)";
  }
  if (highlightSet.has(name)) return "var(--cyan)";
  return "var(--map-unhighlighted)";
}

const ProvinceLayer = memo(function ProvinceLayer({ colorMap, provinceDetailsMap, viewMode, highlightProvinces, muted, onOver, onLeave, onClick }) {
  const highlightSet = new Set(highlightProvinces);
  const ctx = { colorMap, provinceDetailsMap, viewMode, highlightSet };
  if (muted) {
    return (
      <g pointerEvents="none">
        {PATH_ENTRIES.map(([name, d]) => (
          <path key={name} d={d} fill="var(--map-unhighlighted)" stroke="var(--map-stroke)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" opacity={0.6} />
        ))}
      </g>
    );
  }
  return (
    <g onMouseOver={onOver} onMouseLeave={onLeave} onClick={onClick} style={{ cursor: "pointer" }}>
      {PATH_ENTRIES.map(([name, d]) => {
        const det = provinceDetailsMap[name];
        const detEval = (det?.ontimeCount ?? 0) + (det?.lateCount ?? 0);
        const detOtp = detEval > 0 ? Math.round(((det?.ontimeCount ?? 0) / detEval) * 100) : 100;
        const isWarning = det && detEval > 0 && detOtp < 90;
        const isHighlight = highlightSet.has(name) || colorMap[name] || isWarning;
        return (
          <path
            key={name}
            data-name={name}
            d={d}
            fill={fillFor(name, ctx)}
            stroke={isWarning ? "var(--red)" : "var(--map-stroke)"}
            strokeWidth={isWarning ? 1.2 : 0.6}
            vectorEffect="non-scaling-stroke"
            opacity={isHighlight ? 0.9 : 0.6}
          />
        );
      })}
    </g>
  );
});

const LabelLayer = memo(function LabelLayer({ vb, ppu }) {
  const [vx, vy, vw, vh] = vb;
  const fs = 11 / ppu;
  return (
    <g pointerEvents="none" style={{ fontFamily: "inherit" }}>
      {LABEL_NAMES.map((name) => {
        const [x, y] = CENTROIDS[name];
        if (x < vx || x > vx + vw || y < vy || y > vy + vh) return null;
        return (
          <text
            key={name} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize={fs} fontWeight={600} fill="var(--text-primary)"
            stroke="var(--map-ocean)" strokeWidth={3 / ppu} strokeLinejoin="round" paintOrder="stroke"
          >
            {name}
          </text>
        );
      })}
    </g>
  );
});

const CTRL_BTN = {
  width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--panel-bg)", color: "var(--text-primary)", cursor: "pointer",
  display: "grid", placeItems: "center", fontSize: 17, fontWeight: 700, lineHeight: 1,
  fontFamily: "inherit", padding: 0, boxShadow: "0 2px 8px var(--shadow-soft)",
};

function VietnamMap({
  highlightProvinces = [],
  colorMap = {},
  onProvinceClick,
  onProvinceHover,
  routeLines = [],
  provinceDetailsMap = {},
  viewMode = "orders", // 'orders' | 'weight' | 'ontime' | 'damage'
  selectedProvince = null, // pinned outline (hotspot / clicked province); its own overlay, never re-renders the 63-path layer
  focusProvince = null, // { name, n } — fly to `name` whenever `n` changes; or { x, y, k, n } — fly to a point
  legend = null, // node drawn in the bottom-left corner
  onToggleFullscreen = null, // shows the ⤢ button when given
  isFullscreen = false,
  provinceMuted = false, // layer "Kho": grey, click-through provinces
  warehouses = null, // [{ id, x, y, rOuter, rInner (px), dashed, label, chip }] — biggest first
  selectedWarehouse = null,
  onWarehouseHover,
  onWarehouseClick,
  className = "",
  style = {},
}) {
  const [hoveredProv, setHoveredProv] = useState(null);
  const [hoveredWh, setHoveredWh] = useState(null);
  const hoveredRef = useRef(null);
  const leaveTimer = useRef(null);
  // Hover is applied at most once per animation frame (2026-09-27): sweeping
  // the mouse across several provinces fires many mouseover events per frame,
  // only the last one is rendered.
  const frame = useRef(0);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  // ── Zoom / pan state ──
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ W: 0, H: 0 });
  const sizeRef = useRef(size);
  const [view, setViewState] = useState(DEFAULT_VIEW);
  const viewRef = useRef(view);
  const anim = useRef(0);
  const setView = useCallback((v) => { viewRef.current = v; setViewState(v); }, []);
  const stopAnim = () => { if (anim.current) { cancelAnimationFrame(anim.current); anim.current = 0; } };
  useEffect(() => () => stopAnim(), []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const next = { W: Math.round(width), H: Math.round(height) };
      if (next.W === sizeRef.current.W && next.H === sizeRef.current.H) return;
      sizeRef.current = next;
      setSize(next);
      setView(clampView(viewRef.current, next.W, next.H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setView]);

  const flyTo = useCallback((target) => {
    stopAnim();
    const { W, H } = sizeRef.current;
    const to = clampView(target, W, H);
    const from = viewRef.current;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !W) { setView(to); return; }
    const t0 = performance.now(), dur = 380;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setView({
        cx: from.cx + (to.cx - from.cx) * e,
        cy: from.cy + (to.cy - from.cy) * e,
        k: from.k * Math.pow(to.k / from.k, e),
      });
      anim.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    anim.current = requestAnimationFrame(step);
  }, [setView]);

  const zoomBy = useCallback((factor) => {
    stopAnim();
    const { W, H } = sizeRef.current;
    if (!W) return;
    setView(zoomAt(viewRef.current, factor, W / 2, H / 2, W, H));
  }, [setView]);

  const resetView = useCallback(() => flyTo(DEFAULT_VIEW), [flyTo]);

  // Fly to a province (hotspot / Top 8 click): its box fills about half the frame.
  useEffect(() => {
    // A point (warehouse) instead of a province: { x, y, k, n }.
    if (focusProvince && Number.isFinite(focusProvince.x) && sizeRef.current.W) {
      flyTo({ cx: focusProvince.x, cy: focusProvince.y, k: focusProvince.k || 6 });
      return;
    }
    if (!focusProvince?.name) return;
    const b = provinceBox(focusProvince.name);
    const { W, H } = sizeRef.current;
    if (!b || !W) return;
    const ppu1 = basePpu(W, H);
    const k = Math.min(8, Math.max(2.5, Math.min((0.5 * W) / (Math.max(b.w, 8) * ppu1), (0.5 * H) / (Math.max(b.h, 8) * ppu1))));
    flyTo({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, k });
  }, [focusProvince, flyTo]);

  // Wheel zoom around the cursor. Non-passive so the page does not scroll
  // meanwhile — except zooming out at the minimum, which lets the page scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const { W, H } = sizeRef.current;
      if (!W) return;
      if (e.deltaY > 0 && viewRef.current.k <= K_MIN + 1e-6) return;
      e.preventDefault();
      stopAnim();
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
      const factor = Math.exp(Math.max(-0.5, Math.min(0.5, -e.deltaY * unit)));
      const r = el.getBoundingClientRect();
      setView(zoomAt(viewRef.current, factor, e.clientX - r.left, e.clientY - r.top, W, H));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView]);

  // Drag to pan (mouse / one finger), pinch to zoom (two fingers). Pointer
  // capture starts only after a real move, so a plain click still lands on
  // the province path.
  const pointers = useRef(new Map());
  const drag = useRef(null);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    stopAnim();
    if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, view: viewRef.current, active: false, id: e.pointerId };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { W, H } = sizeRef.current;
    if (!W) return;
    const svg = svgRef.current;
    if (drag.current.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const r = svg.getBoundingClientRect();
      const ppu = basePpu(W, H) * viewRef.current.k;
      let v = viewRef.current;
      v = { ...v, cx: v.cx - (mx - drag.current.mx) / ppu, cy: v.cy - (my - drag.current.my) / ppu };
      v = zoomAt(v, dist / (drag.current.dist || dist), mx - r.left, my - r.top, W, H);
      drag.current = { ...drag.current, dist, mx, my };
      moved.current = true;
      setView(v);
      return;
    }
    const d = drag.current;
    if (d.pinch) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.hypot(dx, dy) < 4) return;
      d.active = true;
      moved.current = true;
      setDragging(true);
      try { svg.setPointerCapture(e.pointerId); } catch {}
    }
    const ppu = basePpu(W, H) * d.view.k;
    setView(clampView({ cx: d.view.cx - dx / ppu, cy: d.view.cy - dy / ppu, k: d.view.k }, W, H));
  }, [setView]);

  const onPointerEnd = useCallback((e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) { drag.current = null; setDragging(false); }
    else if (pointers.current.size === 1) {
      // Pinch → one finger left: continue as a drag from here.
      const [[id, p]] = [...pointers.current.entries()];
      drag.current = { x: p.x, y: p.y, view: viewRef.current, active: true, id };
    }
  }, []);

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
    if (moved.current) { moved.current = false; return; } // end of a drag, not a click
    const name = e.target?.dataset?.name;
    if (name && onProvinceClick) onProvinceClick(name);
  }, [onProvinceClick]);

  const onWhOver = useCallback((e) => {
    const id = e.target?.dataset?.wid;
    if (!id) return;
    setHoveredWh(id);
    if (onWarehouseHover) onWarehouseHover(id);
  }, [onWarehouseHover]);
  const onWhLeave = useCallback(() => {
    setHoveredWh(null);
    if (onWarehouseHover) onWarehouseHover(null);
  }, [onWarehouseHover]);
  const onWhClick = useCallback((e) => {
    if (moved.current) { moved.current = false; return; }
    const id = e.target?.dataset?.wid;
    if (id && onWarehouseClick) onWarehouseClick(id);
  }, [onWarehouseClick]);

  const { W, H } = size;
  const vb = viewBoxOf(view, W, H);
  const ppu = W ? basePpu(W, H) * view.k : 1;
  const px = (n) => n / ppu; // screen pixels → map units

  const maxRouteWeight = routeLines.length ? Math.max(...routeLines.map((r) => r.weight || 1)) : 1;
  const hoverDetail = hoveredProv ? provinceDetailsMap[hoveredProv] : null;
  const hoverWarn = hoverDetail && hoverDetail.ontimePct < 90;
  const arrowColors = [...new Set(routeLines.map((r) => r.color || ROUTE_COLOR))];
  const zoomed = view.k > K_MIN + 1e-6;

  return (
    <div ref={boxRef} className={className} style={{ position: "relative", width: "100%", overflow: "hidden", borderRadius: 10, ...style }}>
      <svg
        ref={svgRef}
        viewBox={vb.map((n) => n.toFixed(2)).join(" ")}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{
          width: "100%", height: "100%", display: "block",
          background: "var(--map-ocean)", borderRadius: 10, border: "1px solid var(--border)",
          touchAction: zoomed ? "none" : "pan-y", userSelect: "none",
          cursor: dragging ? "grabbing" : zoomed ? "grab" : "default",
        }}
      >
        <defs>
          {arrowColors.map((c) => (
            <marker
              key={c} id={`arrow-${c.replace("#", "")}`} viewBox="0 0 8 8" markerUnits="userSpaceOnUse"
              markerWidth={px(9)} markerHeight={px(9)} refX="10" refY="4" orient="auto"
            >
              <polygon points="0 0, 8 4, 0 8" fill={c} opacity="0.9" />
            </marker>
          ))}
        </defs>

        <ProvinceLayer
          colorMap={colorMap}
          provinceDetailsMap={provinceDetailsMap}
          viewMode={viewMode}
          highlightProvinces={highlightProvinces}
          muted={provinceMuted}
          onOver={onOver}
          onLeave={onLeave}
          onClick={onClick}
        />

        {selectedProvince && PATHS[selectedProvince] && (
          <g pointerEvents="none">
            <path d={PATHS[selectedProvince]} fill="rgba(244,63,94,0.35)" stroke="var(--red)" strokeWidth={2.4} vectorEffect="non-scaling-stroke" />
            {CENTROIDS[selectedProvince] && (
              <circle cx={CENTROIDS[selectedProvince][0]} cy={CENTROIDS[selectedProvince][1]} r={px(8)} fill="none" stroke="var(--red)" strokeWidth={px(2.5)} />
            )}
          </g>
        )}

        {hoveredProv && PATHS[hoveredProv] && (
          <g pointerEvents="none">
            <path d={PATHS[hoveredProv]} fill="var(--cyan)" stroke="var(--cyan)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
            {CENTROIDS[hoveredProv] && (
              <circle cx={CENTROIDS[hoveredProv][0]} cy={CENTROIDS[hoveredProv][1]} r={px(5)} fill="var(--cyan)" stroke="var(--map-ocean)" strokeWidth={px(1.5)} />
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
            const w = 0.8 + ((r.weight || 1) / maxRouteWeight) * 2.6;
            return (
              <g key={`route-${i}`}>
                <path
                  d={`M${from[0].toFixed(1)},${from[1].toFixed(1)}L${to[0].toFixed(1)},${to[1].toFixed(1)}`}
                  fill="none" stroke={color} strokeWidth={px(w)} opacity="0.75"
                  markerEnd={`url(#arrow-${color.replace("#", "")})`}
                />
                <circle cx={from[0]} cy={from[1]} r={px(2.5)} fill="var(--map-ocean)" stroke={color} strokeWidth={px(1.2)} />
                <circle cx={to[0]} cy={to[1]} r={px(3.2)} fill={color} stroke="var(--map-stroke)" strokeWidth={px(0.8)} />
              </g>
            );
          })}
        </g>

        {view.k >= LABEL_K && W > 0 && <LabelLayer vb={vb} ppu={ppu} />}

        {warehouses && warehouses.length > 0 && (
          <g onMouseOver={onWhOver} onMouseLeave={onWhLeave} onClick={onWhClick} style={{ cursor: "pointer" }}>
            {/* Invisible, larger hit areas (easy to tap) all BELOW the dots, so
                a small dot's hit area never steals a click on a bigger dot. */}
            <g>
              {warehouses.map((w) => (
                <circle key={w.id} data-wid={w.id} cx={w.x} cy={w.y} r={px(Math.max(w.rOuter || 0, w.rInner, 3) + 6)} fill="transparent" />
              ))}
            </g>
            {warehouses.map((w) => {
              const on = w.id === selectedWarehouse, hov = w.id === hoveredWh;
              const rO = w.rOuter || 0, rI = w.rInner;
              const accentStroke = on || hov ? "var(--cyan)" : WH_RING_STROKE;
              return (
                <g key={w.id}>
                  {/* Outer ring = total GTC load (only when KhoGiaoTongTai data present) */}
                  {rO > 0 && (
                    <circle
                      data-wid={w.id} cx={w.x} cy={w.y} r={px(rO)}
                      fill="none"
                      stroke={accentStroke}
                      strokeOpacity={on || hov ? 1 : 0.68}
                      strokeWidth={px(on ? 2.2 : hov ? 1.8 : 1.2)}
                      strokeDasharray={w.dashed ? `${px(3)} ${px(2.2)}` : undefined}
                    />
                  )}
                  {/* Inner dot = Điện máy share (or all-industry share when dotFill is set) */}
                  <circle
                    data-wid={w.id} cx={w.x} cy={w.y} r={px(rI)}
                    fill={on ? (w.dotFill || "rgba(var(--brand-rgb),0.95)") : (w.dotFill || WH_DOT_FILL)}
                    fillOpacity={on || hov ? 1 : 0.78}
                    stroke={rO > 0 ? "none" : accentStroke}
                    strokeOpacity={rO > 0 ? 0 : (on || hov ? 1 : 0.68)}
                    strokeWidth={rO > 0 ? 0 : px(on ? 2.2 : hov ? 1.8 : w.dashed ? 1.4 : 1.1)}
                    strokeDasharray={rO === 0 && w.dashed ? `${px(3)} ${px(2.2)}` : undefined}
                  />
                  {w.unstable && (
                    <circle
                      className="wh-unstable-ring" cx={w.x} cy={w.y} r={px(Math.max(rO, rI) + 3.5)}
                      fill="none" stroke="var(--red)" strokeWidth={px(2.2)} pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </g>
        )}
        {warehouses && view.k >= WH_LABEL_K && W > 0 && (() => {
          // Greedy, biggest dot first (the array order): a name that would
          // overlap one already placed is skipped — zoom in further to see it.
          const placed = [];
          const shown = warehouses.filter((w) => {
            if (w.x < vb[0] || w.x > vb[0] + vb[2] || w.y < vb[1] || w.y > vb[1] + vb[3]) return false;
            const sx = (w.x - vb[0]) * ppu + Math.max(w.rOuter || 0, w.rInner) + 4, sy = (w.y - vb[1]) * ppu;
            const box = { x0: sx, x1: sx + w.label.length * 6.2, y0: sy - 8, y1: sy + 8 };
            if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return false;
            placed.push(box);
            return true;
          });
          return (
            <g pointerEvents="none">
              {shown.map((w) => (
                <text
                  key={w.id} x={w.x + px(Math.max(w.rOuter || 0, w.rInner) + 4)} y={w.y} dominantBaseline="middle"
                  fontSize={px(10.5)} fontWeight={600} fill="var(--text-primary)"
                  stroke="var(--map-ocean)" strokeWidth={px(3)} strokeLinejoin="round" paintOrder="stroke"
                >
                  {w.label}
                </text>
              ))}
            </g>
          );
        })()}
      </svg>

      {/* Small name chip instead of the old floating box that covered the map;
          full numbers are in the detail panel beside the map. */}
      {hoveredWh && warehouses && (() => {
        const w = warehouses.find((x) => x.id === hoveredWh);
        return w ? (
          <div style={{
            position: "absolute", top: 10, left: 10, maxWidth: "calc(100% - 64px)", pointerEvents: "none", zIndex: 2,
            background: "var(--panel-bg)", border: "1px solid var(--cyan)",
            borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "var(--text-secondary)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxShadow: "0 2px 8px var(--shadow-soft)",
          }}>
            🏭 <b style={{ color: "var(--text-primary)" }}>{w.label}</b>{w.chip ? ` · ${w.chip}` : ""}
          </div>
        ) : null;
      })()}
      {hoveredProv && !hoveredWh && (
        <div
          style={{
            position: "absolute", top: 10, left: 10, maxWidth: "calc(100% - 64px)", pointerEvents: "none", zIndex: 2,
            background: "var(--panel-bg)", border: `1px solid ${hoverWarn ? "var(--red)" : "var(--border)"}`,
            borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "var(--text-secondary)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxShadow: "0 2px 8px var(--shadow-soft)",
          }}
        >
          <b style={{ color: "var(--text-primary)" }}>{hoveredProv}</b>
          {hoverDetail ? (
            <> · {hoverDetail.totalOrders.toLocaleString("vi-VN")} đơn · on-time <b style={{ color: hoverWarn ? "var(--red)" : "var(--green)" }}>{hoverDetail.ontimePct}%</b></>
          ) : " · chưa có đơn trong bộ lọc"}
        </div>
      )}

      <div style={{ position: "absolute", top: 10, right: 10, display: "flex", flexDirection: "column", gap: 6, zIndex: 3 }}>
        <button type="button" style={{ ...CTRL_BTN, opacity: view.k >= K_MAX ? 0.45 : 1 }} onClick={() => zoomBy(K_STEP)} disabled={view.k >= K_MAX} title="Phóng to" aria-label="Phóng to">+</button>
        <button type="button" style={{ ...CTRL_BTN, opacity: zoomed ? 1 : 0.45 }} onClick={() => zoomBy(1 / K_STEP)} disabled={!zoomed} title="Thu nhỏ" aria-label="Thu nhỏ">−</button>
        <button type="button" style={{ ...CTRL_BTN, fontSize: 15 }} onClick={resetView} title="Về toàn quốc" aria-label="Về toàn quốc">⟲</button>
        {onToggleFullscreen && (
          <button type="button" style={{ ...CTRL_BTN, fontSize: 15 }} onClick={onToggleFullscreen}
            title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"} aria-label={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}>
            {isFullscreen ? "⤡" : "⤢"}
          </button>
        )}
      </div>

      {legend && (
        <div style={{ position: "absolute", left: 10, bottom: 10, zIndex: 2, maxWidth: "calc(100% - 20px)" }}>{legend}</div>
      )}
      <div className="map-hint" style={{ position: "absolute", right: 10, bottom: 8, fontSize: 10.5, color: "var(--text-muted)", pointerEvents: "none", zIndex: 1 }}>
        {view.k >= LABEL_K ? "" : "Phóng to để hiện tên tỉnh · "}Cuộn chuột: phóng · kéo: di chuyển
      </div>
    </div>
  );
}

export default memo(VietnamMap);
