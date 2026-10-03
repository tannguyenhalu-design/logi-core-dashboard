/**
 * "Bản đồ tỉnh thành" view — layout A (Kế hoạch D · Phần 1, 29/09):
 * the 4 overview numbers as a thin strip on top; the map on the left (~60%,
 * screen-high, sticky) with zoom/pan, legend and fullscreen; on the right the
 * Top 5 hotspots, a detail panel for the hovered/selected province (with the
 * "Xem danh sách đơn" button → the on-demand orders modal) and the Top 8.
 * Display only — every number comes straight from the props as before.
 *
 * Layer "Tỉnh / Kho / Cả hai" (Kế hoạch D · 2a, 29/09): warehouses as grey
 * dots sized by their Điện máy load per day (`warehouseLayer`, computed in
 * lib/warehouse-layer.js), dashed = estimated position; hover/click → the
 * right-hand detail panel shows the warehouse instead of the province. Only
 * the Điện máy share of a warehouse's load — no capacity colours yet (2b).
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import VietnamMap from "../../VietnamMap";
import { fmt, fmtWeight, getOntimeColor, getOntimeBadge } from "../utils";

const MODES = [
  { id: "orders", label: "📦 Theo Số Đơn", on: "var(--cyan)" },
  { id: "weight", label: "⚖️ Theo Tải Trọng (Tấn)", on: "var(--cyan)" },
  { id: "ontime", label: "⏱️ Tỷ Lệ Ontime", on: "var(--cyan)" },
  { id: "damage", label: "💥 Ca Hư Hỏng", on: "var(--amber)" },
];
const ROUTE_COLOR = "#33D6C0";
const WEIGHT_RGB = "13, 148, 136";

const UNPLACED_LABEL = {
  buuCuc: "Bưu cục — chưa nối",
  noLocation: "Chưa có vị trí",
  newName: "Tên kho mới — chưa nối",
  ignored: "Bỏ qua (kho test)",
};
const WH_R_MIN = 3.5; // px
const WH_R_MAX = 17; // px
const shortWh = (name) => String(name || "")
  .replace(/^Kho Giao Hàng Nặng\s*-\s*/i, "KGHN ")
  .replace(/^Key Account Warehouse\s+/i, "KA WH ")
  .replace(/^Kho B2B\s*-\s*/i, "B2B ");
const siteLabel = (site) => shortWh(site.names[0]?.name) + (site.names.length > 1 ? ` +${site.names.length - 1}` : "");
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

const EMPTY = [];
const shortWeight = (kg) => (kg >= 1000 ? (kg / 1000).toFixed(1).replace(".0", "") + " tấn" : (kg || 0) + " kg");
const sw = (bg, extra = {}) => ({ width: 12, height: 12, borderRadius: 3, background: bg, opacity: 0.9, flexShrink: 0, ...extra });

function Seg({ items, value, onChange, disabled = false, activeBg = "var(--cyan)" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--input-bg)", padding: 3, borderRadius: 8, border: "1px solid var(--border)", flexWrap: "wrap", opacity: disabled ? 0.5 : 1 }}>
      {items.map((m) => (
        <button
          key={m.id} type="button" disabled={disabled} aria-pressed={value === m.id}
          onClick={() => onChange(m.id)}
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: disabled ? "not-allowed" : "pointer",
            background: value === m.id ? activeBg : "transparent",
            color: value === m.id ? "#0f172a" : "var(--text-muted)", fontFamily: "inherit",
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// Legend in the map corner — mirrors the fills built in `colorMap` below and
// `ProvinceLayer` in VietnamMap (thresholds must stay in sync with them), and
// the warehouse dots (WH_R_MIN/MAX, grey, dashed = estimated).
function MapLegend({ viewMode, maxOrders, maxWeight, singleProjectMode, showWh = false, whMaxTotal = 0 }) {
  const [open, setOpen] = useState(false);
  const provTitle = { orders: "Số đơn giao", weight: "Tải trọng giao", ontime: "Tỷ lệ on-time", damage: "Ca hư hỏng (Rillnet)" }[viewMode];
  const title = showWh ? `${provTitle} + kho` : provTitle;
  const dot = (d, extra = {}) => (
    <span style={{ width: d, height: d, borderRadius: "50%", background: "var(--text-secondary)", opacity: 0.75, border: "1px solid var(--text-primary)", flexShrink: 0, boxSizing: "border-box", ...extra }} />
  );
  const row = (swatch, text) => (
    <div style={{ display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>{swatch}<span>{text}</span></div>
  );
  const ramp = (from, to, lo, hi) => (
    <div>
      <div style={{ height: 9, width: 150, borderRadius: 4, background: `linear-gradient(90deg, ${from}, ${to})`, opacity: 0.9 }} />
      <div style={{ display: "flex", justifyContent: "space-between", width: 150, marginTop: 2 }}><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
  return (
    <div style={{
      background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 8,
      padding: open ? "7px 10px 8px" : "4px 10px", fontSize: 11, color: "var(--text-secondary)",
      display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 2px 8px var(--shadow-soft)",
    }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{
        all: "unset", cursor: "pointer", fontWeight: 700, fontSize: 11.5, color: "var(--text-primary)", display: "flex", gap: 6, alignItems: "center",
      }}>
        Chú giải: {title} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          {viewMode === "orders" && ramp("rgba(var(--brand-rgb),0.2)", "rgba(var(--brand-rgb),0.95)", "ít", `${fmt(maxOrders)} đơn`)}
          {viewMode === "weight" && ramp(`rgba(${WEIGHT_RGB},0.25)`, `rgba(${WEIGHT_RGB},0.95)`, "ít", `${fmt(maxWeight / 1000, 1)} tấn`)}
          {viewMode === "ontime" && (
            <>
              {row(<span style={sw("var(--green)")} />, "≥ 90%")}
              {row(<span style={sw("var(--amber)")} />, "80% – dưới 90%")}
              {row(<span style={sw("var(--red)")} />, "dưới 80%")}
            </>
          )}
          {viewMode === "damage" && row(<span style={sw("var(--amber)")} />, "Có ca hư hỏng")}
          {row(<span style={sw("var(--map-unhighlighted)", { opacity: 0.6 })} />, viewMode === "damage" ? "Không có ca / không có đơn" : "Không có đơn trong bộ lọc")}
          {row(<span style={sw("transparent", { border: "1.5px solid var(--red)", opacity: 1 })} />, "Viền đỏ: on-time < 90%")}
          {row(<span style={sw("rgba(244,63,94,0.35)", { border: "2px solid var(--red)", opacity: 1 })} />, "Tỉnh đang chọn")}
          {singleProjectMode && row(<span style={{ width: 16, height: 3, borderRadius: 2, background: ROUTE_COLOR, flexShrink: 0 }} />, "Tuyến lấy → giao (nét dày = nhiều đơn)")}
        </>
      )}
      {open && showWh && (
        <>
          <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
          {row(
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: "1.5px solid var(--text-secondary)", display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(var(--brand-rgb),0.82)" }} />
              </span>
            </span>,
            `Vòng xám = tổng tải kho giao (GTC/ngày) · chấm cam = phần Điện máy${whMaxTotal > 0 ? ` · lớn nhất ${fmt(whMaxTotal)} GTC` : ""}`
          )}
          {row(dot(12, { border: "1.5px dashed var(--text-primary)", background: "transparent" }), "Viền đứt: vị trí ước lượng · Chỉ chấm cam = chưa có số tổng tải")}
          {row(dot(12, { background: "rgba(var(--brand-rgb),0.9)", border: "2px solid var(--cyan)", opacity: 1 }), "Kho đang chọn · Nhiều tên cùng vị trí = 1 chấm")}
        </>
      )}
    </div>
  );
}

function Kpi({ label, children, color = "var(--text-primary)" }) {
  return (
    <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</div>
    </div>
  );
}

function MiniStat({ label, children, color = "var(--text-primary)" }) {
  return (
    <div style={{ background: "var(--panel-bg)", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</div>
    </div>
  );
}

const SECTION_LABEL = { fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" };

// One role (kho giao / kho lấy) of a warehouse: per-day orders and tons.
function WhRoleBlock({ title, st, routeLabel }) {
  if (!st) {
    return (
      <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
        <b style={{ color: "var(--text-secondary)" }}>{title}</b> · không có đơn trong bộ lọc
      </div>
    );
  }
  const o = st.ordersPerDay, t = st.tonsPerDay;
  const cell = { padding: "4px 8px", textAlign: "right" };
  return (
    <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <b style={{ fontSize: 12.5, color: "var(--text-primary)" }}>{title}</b>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{fmt(st.orders)} đơn · {fmt(st.tons, 1)} tấn</span>
      </div>
      <table className="data-table" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: "4px 8px" }}></th>
            <th style={cell}>TB/ngày</th>
            <th style={cell} title="9/10 ngày có tải thấp hơn mức này">P90</th>
            <th style={cell}>Ngày cao nhất</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>Đơn</td>
            <td style={{ ...cell, fontWeight: 700, color: "var(--cyan)" }}>{fmt(o.avg, 1)}</td>
            <td style={{ ...cell, fontWeight: 700 }}>{fmt(o.p90)}</td>
            <td style={cell}>{fmt(o.max)} <span style={{ color: "var(--text-muted)" }}>({dm(o.maxDate)})</span></td>
          </tr>
          <tr>
            <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>Tấn</td>
            <td style={{ ...cell, fontWeight: 700, color: "var(--cyan)" }}>{fmt(t.avg, 2)}</td>
            <td style={{ ...cell, fontWeight: 700 }}>{fmt(t.p90, 2)}</td>
            <td style={cell}>{fmt(t.max, 2)} <span style={{ color: "var(--text-muted)" }}>({dm(t.maxDate)})</span></td>
          </tr>
        </tbody>
      </table>
      {(st.topClients?.length > 0 || st.topRoutes?.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, fontSize: 11.5, color: "var(--text-secondary)" }}>
          {st.topClients?.length > 0 && (
            <div><span style={{ color: "var(--text-muted)" }}>Khách chính: </span>{st.topClients.map((c) => `${c.name} (${fmt(c.orders)})`).join(" · ")}</div>
          )}
          {st.topRoutes?.length > 0 && (
            <div><span style={{ color: "var(--text-muted)" }}>{routeLabel}: </span>{st.topRoutes.map((r) => `${shortWh(r.name)} (${fmt(r.orders)})`).join(" · ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR = { "chắc chắn": "var(--green)", "user xác nhận": "var(--green)", "ước lượng": "var(--amber)" };

function WarehouseDetail({ site, period, dateBasis, pinned, onUnpin }) {
  const multi = site.names.length > 1;
  const nameOrders = (role, name) => site[role]?.byName?.find((x) => x.name === name)?.orders || 0;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          🏭 {multi ? `Cụm ${site.names.length} kho cùng vị trí` : site.names[0].name}
          {site.types.map((t) => (
            <span key={t} style={{ fontSize: 11, border: "1px solid var(--border)", color: "var(--text-secondary)", padding: "1px 7px", borderRadius: 4, fontWeight: 600 }}>{t}</span>
          ))}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          {pinned ? "Đã chọn" : "Đang rê chuột"}
          {pinned && (
            <button type="button" onClick={onUnpin} title="Bỏ chọn" style={{
              border: "1px solid var(--border)", background: "var(--panel-bg)", color: "var(--text-secondary)",
              borderRadius: 6, padding: "1px 7px", cursor: "pointer", fontSize: 11, fontFamily: "inherit",
            }}>✕ Bỏ chọn</button>
          )}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {site.names.map((n) => (
          <div key={n.name} style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexWrap: "wrap", gap: "2px 8px", alignItems: "baseline" }}>
            {multi && <b style={{ color: "var(--text-primary)" }}>• {n.name}</b>}
            <span style={{ color: STATUS_COLOR[n.status] || "var(--text-muted)", fontWeight: 600 }}>
              📍 {n.status === "ước lượng" ? "vị trí ước lượng" : `vị trí ${n.status}`}
            </span>
            {multi && <span style={{ color: "var(--text-muted)" }}>giao {fmt(nameOrders("giao", n.name))} · lấy {fmt(nameOrders("lay", n.name))} đơn</span>}
            {(n.address || n.province) && <span style={{ color: "var(--text-muted)", width: "100%" }}>{[n.address, n.district, n.province].filter(Boolean).join(", ")}</span>}
            {n.status === "ước lượng" && n.note && <span style={{ color: "var(--text-muted)", width: "100%" }}>{n.note}</span>}
          </div>
        ))}
      </div>

      {site.names.some((n) => n.total) && (
        <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <b style={{ fontSize: 12.5, color: "var(--text-primary)" }}>📊 Tổng tải kho giao (mọi loại hàng)</b>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>nguồn: danh sách kho giao (user)</span>
          </div>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                {multi && <th style={{ padding: "4px 8px" }}>Kho</th>}
                <th style={{ padding: "4px 8px" }}>Vùng</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>Đơn GTC/ngày (TB)</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>kg GTC/ngày (TB)</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>Số xe/ngày (TB)</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>Đơn GTC/xe</th>
              </tr>
            </thead>
            <tbody>
              {site.names.filter((n) => n.total).map((n) => (
                <tr key={n.name}>
                  {multi && <td style={{ padding: "4px 8px" }}>{shortWh(n.name)}</td>}
                  <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>{n.total.region || "—"}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700 }}>{fmt(n.total.avgOrdersGtc)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(n.total.kgGtc)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(n.total.avgTrucks)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(n.total.avgOrdersPerTruck)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 6, padding: "4px 8px", marginBottom: 10 }}>
        ⚠ Số bên dưới chỉ là phần Điện máy — chưa phải tổng tải của kho (chưa so capacity)
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <WhRoleBlock title="Kho giao (giao đến khách)" st={site.giao} routeLabel="Nhận từ kho lấy" />
        <WhRoleBlock title="Kho lấy (lấy hàng / sorting)" st={site.lay} routeLabel="Giao đi tỉnh" />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
        Đơn theo {dateBasis}, {dm(period?.from)}–{dm(period?.to)} ({fmt(period?.days)} ngày, tính cả ngày 0 đơn): TB = tổng ÷ số ngày · P90 = 9/10 ngày thấp hơn mức này.
      </div>
    </>
  );
}

// What the Kho layer cannot show yet (post offices not linked, names without
// a position…), so the user knows the missing share.
function UnplacedPanel({ layer }) {
  const [open, setOpen] = useState(false);
  const t = layer.totals;
  const all = t.giao.orders + t.lay.orders;
  const blank = t.giao.blank + t.lay.blank;
  const miss = t.giao.unplaced + t.lay.unplaced + blank;
  const groups = Object.entries(layer.unplaced.groups || {});
  const chip = { fontSize: 11.5, background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", color: "var(--text-secondary)" };
  return (
    <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between", width: "100%", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)" }}>📭 Kho chưa hiển thị trên bản đồ {open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {fmt(miss)} / {fmt(all)} lượt đơn ({all ? fmt((miss / all) * 100, 1) : 0}%) · {fmt(layer.unplaced.count)} tên kho
        </span>
      </button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {groups.map(([kind, g]) => (
          <span key={kind} style={chip}>
            {UNPLACED_LABEL[kind] || kind}: <b style={{ color: "var(--text-primary)" }}>{fmt(g.names)}</b> tên · {fmt(g.giao + g.lay)} lượt
          </span>
        ))}
        {blank > 0 && <span style={chip}>Đơn trống tên kho: {fmt(blank)} lượt</span>}
      </div>
      {open && (
        <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: "5px 8px" }}>Tên kho trong dữ liệu đơn</th>
                <th style={{ padding: "5px 8px" }}>Lý do</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Giao</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Lấy</th>
              </tr>
            </thead>
            <tbody>
              {layer.unplaced.list.map((u) => (
                <tr key={u.name}>
                  <td style={{ padding: "4px 8px" }}>{u.name}</td>
                  <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>{UNPLACED_LABEL[u.kind] || u.kind}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(u.giao)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(u.lay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {layer.unplaced.count > layer.unplaced.list.length && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 8px" }}>… và {fmt(layer.unplaced.count - layer.unplaced.list.length)} tên nhỏ khác</div>
          )}
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
        Lượt = số đơn có kho đó làm kho giao + làm kho lấy. Thêm vị trí: sửa tab WarehouseAlias (hoặc nhắn Claude &quot;cập nhật kho&quot;).
      </div>
    </div>
  );
}

export default function ProvinceMapPanel({
  provinceStats, routeStats, provinceDetailsMap = {},
  originStats = [], selectedOrigin = null, onOriginChange,
  projectSummaries = {}, overallData = {}, singleProjectMode, projectName, onProvinceClick,
  hotspots = [], hotspotRule = null,
  warehouseLayer = null,
}) {
  const [activeProv, setActiveProv] = useState(null);
  const [pinnedProv, setPinnedProv] = useState(null); // selected: map click, hotspot or Top 8
  const [focus, setFocus] = useState(null); // { name, n } → map flies there
  const [viewMode, setViewMode] = useState("ontime"); // 'ontime' | 'orders' | 'weight' | 'damage'
  // Kho layer — checkbox "Hiện kho" (Kế hoạch D · 2a, refactored)
  const [showWhState, setShowWh] = useState(true);
  const [whSearch, setWhSearch] = useState("");
  const [activeWh, setActiveWh] = useState(null);
  const [pinnedWh, setPinnedWh] = useState(null);
  const hasWh = !!warehouseLayer?.sites?.length;
  const showWh = hasWh && showWhState;
  const showProv = true;

  useEffect(() => {
    setActiveProv(null);
    setPinnedProv(null);
    setActiveWh(null);
    setPinnedWh(null);
  }, [projectName, singleProjectMode, selectedOrigin]);
  // ── Fullscreen (whole panel, so the detail column stays visible) ──
  const panelRef = useRef(null);
  const [isFs, setIsFs] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);
  const [fsNote, setFsNote] = useState("");
  const noteTimer = useRef(null);
  const whSearchRef = useRef(null);
  useEffect(() => {
    if (!whSearch) return;
    const onDown = (e) => { if (whSearchRef.current && !whSearchRef.current.contains(e.target)) setWhSearch(""); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [whSearch]);
  useEffect(() => {
    const d = document;
    setFsSupported(!!(d.fullscreenEnabled || d.webkitFullscreenEnabled));
    const onChange = () => setIsFs(!!panelRef.current && (d.fullscreenElement || d.webkitFullscreenElement) === panelRef.current);
    d.addEventListener("fullscreenchange", onChange);
    d.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      d.removeEventListener("fullscreenchange", onChange);
      d.removeEventListener("webkitfullscreenchange", onChange);
      clearTimeout(noteTimer.current);
    };
  }, []);
  const exitFullscreen = () => {
    const d = document;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) return;
    try {
      const p = (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      if (p && p.catch) p.catch(() => {});
    } catch {}
  };
  const toggleFullscreen = useCallback(() => {
    const d = document;
    const fail = () => {
      setFsNote("Trình duyệt không cho phép chế độ toàn màn hình.");
      clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => setFsNote(""), 4000);
    };
    if (d.fullscreenElement || d.webkitFullscreenElement) return exitFullscreen();
    const el = panelRef.current;
    const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    if (!req) return fail();
    try {
      const p = req.call(el);
      if (p && p.catch) p.catch(fail);
    } catch { fail(); }
  }, []);

  const sortedProvinces = useMemo(() => {
    return [...(provinceStats || [])].sort((a, b) => {
      const aDet = provinceDetailsMap[a.name] || a.details;
      const bDet = provinceDetailsMap[b.name] || b.details;
      if (viewMode === "weight") return (bDet?.totalWeight || a.weight || 0) - (aDet?.totalWeight || b.weight || 0);
      if (viewMode === "ontime") return (aDet?.ontimePct ?? 100) - (bDet?.ontimePct ?? 100);
      if (viewMode === "damage") return (bDet?.damageCount || 0) - (aDet?.damageCount || 0);
      return b.orders - a.orders;
    });
  }, [provinceStats, provinceDetailsMap, viewMode]);

  // Scale ends — shared by the fills and the legend.
  const scale = useMemo(() => {
    const stats = provinceStats || [];
    return {
      maxOrders: Math.max(...stats.map((p) => p.orders), 1),
      maxWeight: Math.max(...stats.map((p) => (provinceDetailsMap[p.name]?.totalWeight || p.weight || 1)), 1),
    };
  }, [provinceStats, provinceDetailsMap]);

  const colorMap = useMemo(() => {
    const stats = provinceStats || [];
    const { maxOrders, maxWeight } = scale;
    const map = {};
    stats.forEach((p) => {
      const pDet = provinceDetailsMap[p.name];
      if (viewMode === "weight") {
        const w = pDet?.totalWeight || p.weight || 0;
        const intensity = Math.min(1, w / maxWeight);
        map[p.name] = `rgba(${WEIGHT_RGB}, ${(0.25 + intensity * 0.7).toFixed(2)})`;
      } else if (viewMode === "ontime") {
        const ontime = pDet ? pDet.ontimePct : 100;
        map[p.name] = getOntimeColor(ontime);
      } else if (viewMode === "damage") {
        const dmg = pDet ? pDet.damageCount : 0;
        map[p.name] = dmg > 0 ? "var(--amber)" : "var(--map-unhighlighted)";
      } else {
        const intensity = Math.min(1, p.orders / maxOrders);
        map[p.name] = `rgba(var(--brand-rgb), ${(0.2 + intensity * 0.75).toFixed(2)})`;
      }
    });
    return map;
  }, [provinceStats, provinceDetailsMap, viewMode, scale]);

  const topProvinces = useMemo(() => sortedProvinces.slice(0, 8), [sortedProvinces]);
  const highlightProvinces = useMemo(
    () => (singleProjectMode ? [] : sortedProvinces.slice(0, 5).map((p) => p.name)),
    [singleProjectMode, sortedProvinces]
  );

  const routeLines = useMemo(() => (
    singleProjectMode
      ? (routeStats || []).slice(0, 25).map((r) => ({ from: r.from, to: r.to, weight: r.orders, color: ROUTE_COLOR }))
      : []
  ), [singleProjectMode, routeStats]);

  // Warehouse dots — outer ring (grey) = total GTC delivery load (KhoGiaoTongTai),
  // inner dot (orange) = Điện máy giao share. Both scale on the same √ axis so
  // the ratio is visually meaningful. Biggest drawn first (small ones on top).
  const whSites = warehouseLayer?.sites || null;
  const whById = useMemo(() => new Map((whSites || []).map((w) => [w.id, w])), [whSites]);
  const whDots = useMemo(() => {
    if (!whSites) return { dots: [], maxTotal: 0 };
    const totalGtcOf = (w) => w.names.reduce((s, n) => s + (n.total?.avgOrdersGtc ?? 0), 0);
    const dmGiaoOf = (w) => w.giao?.ordersPerDay?.avg ?? 0;
    const maxVal = Math.max(1, ...whSites.map(totalGtcOf), ...whSites.map(dmGiaoOf));
    const rOf = (v) => v > 0 ? WH_R_MIN + (WH_R_MAX - WH_R_MIN) * Math.sqrt(v / maxVal) : 0;
    const dots = [...whSites]
      .sort((a, b) => Math.max(totalGtcOf(b), dmGiaoOf(b)) - Math.max(totalGtcOf(a), dmGiaoOf(a)))
      .map((w) => {
        const totGtc = totalGtcOf(w);
        const dmG = dmGiaoOf(w);
        return {
          id: w.id, x: w.x, y: w.y, dashed: w.estimated,
          label: siteLabel(w),
          rOuter: rOf(totGtc),
          rInner: Math.max(1.5, rOf(dmG)),
          totGtc, dmG,
          chip: totGtc > 0
            ? `${fmt(totGtc)} GTC/ng (tổng tải) · ${fmt(dmG, 1)} ĐM/ng`
            : `${fmt(dmG, 1)} đơn/ng (Điện máy)`,
        };
      });
    const maxTotal = Math.max(0, ...whSites.map(totalGtcOf));
    return { dots, maxTotal };
  }, [whSites]);
  const topWarehouses = useMemo(() => whDots.dots.slice(0, 8), [whDots]);
  const whSearchResults = useMemo(() => {
    const q = whSearch.trim().toLowerCase();
    if (!q || !showWh) return [];
    return whDots.dots.filter((d) => d.label.toLowerCase().includes(q)).slice(0, 6);
  }, [whSearch, whDots.dots, showWh]);

  const legend = useMemo(
    () => (
      <MapLegend
        viewMode={viewMode} maxOrders={scale.maxOrders} maxWeight={scale.maxWeight} singleProjectMode={singleProjectMode}
        showWh={showWh} whMaxTotal={whDots.maxTotal}
      />
    ),
    [viewMode, scale, singleProjectMode, showWh, whDots.maxTotal]
  );

  const handleProvinceHover = useCallback((prov) => setActiveProv(prov), []);
  // Map click selects (click again to clear); the orders list opens from the detail panel.
  const handleProvinceClick = useCallback((prov) => {
    setPinnedWh(null);
    setPinnedProv((cur) => (cur === prov ? null : prov));
  }, []);
  const selectAndFly = useCallback((name) => {
    setPinnedWh(null);
    setPinnedProv(name);
    setFocus({ name, n: Date.now() });
  }, []);
  const handleWhHover = useCallback((id) => setActiveWh(id), []);
  const handleWhClick = useCallback((id) => {
    setPinnedProv(null);
    setPinnedWh((cur) => (cur === id ? null : id));
  }, []);
  const selectWhAndFly = useCallback((dot) => {
    setPinnedProv(null);
    setPinnedWh(dot.id);
    setFocus({ x: dot.x, y: dot.y, k: 6, n: Date.now() });
  }, []);
  const openOrders = (name) => {
    exitFullscreen(); // the modal lives outside this panel
    onProvinceClick?.(name);
  };

  if (!provinceStats || provinceStats.length === 0) {
    return (
      <div className="chart-panel" style={{ width: "100%" }}>
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)" }}>
          Không có dữ liệu tỉnh giao trong khoảng lọc hiện tại.
        </div>
      </div>
    );
  }

  // Hover wins (warehouse, then province); off the map, show what is selected.
  const shownWhId = showWh ? (activeWh || (activeProv ? null : pinnedWh)) : null;
  const shownWh = shownWhId ? whById.get(shownWhId) : null;
  const shownProv = shownWh ? null : (activeProv || pinnedProv);
  const inspectData = shownProv ? (provinceDetailsMap[shownProv] || provinceStats.find(p => p.name === shownProv)?.details) : null;
  const projectOverview = singleProjectMode ? projectSummaries[projectName] : null;
  const ov = (singleProjectMode ? projectOverview : overallData) || {};
  const ovBadge = getOntimeBadge(singleProjectMode ? (projectOverview?.ontimePct ?? 100) : (overallData?.ontimePct ?? 100));
  const isPinnedShown = !!inspectData && shownProv === pinnedProv;
  const whPinnedShown = !!shownWh && shownWh.id === pinnedWh;

  return (
    <div ref={panelRef} className="chart-panel province-map-panel" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          Bản đồ phân bố giao hàng theo tỉnh{singleProjectMode ? ` — Dự án ${projectName}` : ""}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", cursor: "default" }}>
            Tô tỉnh theo
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
              style={{
                fontSize: 12.5, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 6,
                padding: "4px 8px", background: "var(--input-bg)", color: "var(--text-primary)",
                fontFamily: "inherit", cursor: "pointer",
              }}
            >
              <option value="ontime">⏱️ On-time</option>
              <option value="orders">📦 Số đơn</option>
              <option value="weight">⚖️ Tải trọng</option>
              <option value="damage">💥 Ca hư hỏng</option>
            </select>
          </label>
          {hasWh && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: showWh ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox" checked={showWhState} onChange={(e) => setShowWh(e.target.checked)}
                style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--cyan)" }}
              />
              🏭 Hiện kho
            </label>
          )}
          {showWh && (
            <div style={{ position: "relative" }} ref={whSearchRef}>
              <input
                type="text"
                placeholder="🔍 Tìm kho..."
                value={whSearch}
                onChange={(e) => setWhSearch(e.target.value)}
                style={{
                  fontSize: 12.5, border: "1px solid var(--border)", borderRadius: 6,
                  padding: "4px 8px", background: "var(--input-bg)", color: "var(--text-primary)",
                  fontFamily: "inherit", width: 140, outline: "none",
                }}
              />
              {whSearch.trim() && whSearchResults.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, marginTop: 4,
                  background: "var(--panel-bg)", border: "1px solid var(--border)",
                  borderRadius: 8, boxShadow: "0 4px 12px var(--shadow-soft)",
                  zIndex: 10, minWidth: 200, maxWidth: 280,
                }}>
                  {whSearchResults.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => { selectWhAndFly(d); setWhSearch(""); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "7px 12px", fontSize: 12.5, background: "transparent",
                        border: "none", borderBottom: "1px solid var(--border)",
                        color: "var(--text-primary)", cursor: "pointer", fontFamily: "inherit",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-bg-strong)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      🏭 {d.label}
                      {d.totGtc > 0 && <span style={{ color: "var(--cyan)", marginLeft: 6, fontSize: 11 }}>{fmt(d.totGtc)} GTC/ng</span>}
                    </button>
                  ))}
                </div>
              )}
              {whSearch.trim() && whSearchResults.length === 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, marginTop: 4,
                  background: "var(--panel-bg)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "8px 12px", fontSize: 12.5,
                  color: "var(--text-muted)", zIndex: 10, whiteSpace: "nowrap",
                }}>
                  Không tìm thấy kho
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Overview strip — same 4 numbers as the old "Góc nhìn tổng quan" block */}
      <div className="province-kpi-strip">
        <div className="province-kpi-title">
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cyan)" }}>
            🏢 {singleProjectMode ? `Khách hàng: ${projectName}` : "Toàn bộ dự án LTL"}
          </span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, background: ovBadge.bg, color: ovBadge.color, border: `1px solid ${ovBadge.color}`, padding: "1px 7px", borderRadius: 4, fontWeight: 600 }}>
              {ovBadge.label}
            </span>
            <span className="badge bg-cyan" style={{ fontSize: 11.5 }}>
              {fmt(ov.totalOrders || 0)} đơn
            </span>
            {singleProjectMode && selectedOrigin && (
              <span style={{ fontSize: 11, background: "rgba(var(--brand-rgb),0.15)", color: "var(--cyan)", border: "1px solid var(--cyan)", padding: "1px 7px", borderRadius: 4, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                🏬 Lấy tại: {selectedOrigin}
                <span onClick={() => onOriginChange?.(null)} style={{ cursor: "pointer", opacity: 0.8 }} title="Bỏ lọc">✕</span>
              </span>
            )}
          </span>
        </div>
        <Kpi label="Tỷ lệ Ontime tổng" color={getOntimeColor(ov.ontimePct)}>{ov.ontimePct ?? "—"}%</Kpi>
        <Kpi label="Tổng tải trọng">{fmtWeight(ov.totalWeight)}</Kpi>
        <Kpi label="Đơn Ontime / Late">
          <span style={{ color: "var(--green)" }}>{fmt(ov.ontimeCount)}</span> / <span style={{ color: "var(--red)" }}>{fmt(ov.lateCount)}</span>
        </Kpi>
        <Kpi label="Số ca bể vỡ / hư hỏng (Rillnet)" color={ov.damageCount > 0 ? "var(--amber)" : "var(--text-secondary)"}>
          {ov.damageCount || 0} ca {ov.damageCount > 0 && "💥"}
        </Kpi>
      </div>

      {showWh && (() => {
        const t = warehouseLayer.totals, pd = warehouseLayer.period;
        const pct = (x) => (x.orders ? fmt((x.placed / x.orders) * 100, 1) : "0");
        const nNames = warehouseLayer.sites.reduce((a, w) => a + w.names.length, 0);
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", fontSize: 12, color: "var(--text-secondary)", margin: "-2px 0 12px" }}>
            <span>🏭 <b style={{ color: "var(--text-primary)" }}>{fmt(warehouseLayer.sites.length)}</b> điểm kho ({fmt(nNames)} tên)</span>
            <span>Đơn có vị trí: giao <b style={{ color: "var(--text-primary)" }}>{pct(t.giao)}%</b> · lấy <b style={{ color: "var(--text-primary)" }}>{pct(t.lay)}%</b></span>
            <span>Theo {warehouseLayer.dateField === "delivered_time" ? "ngày giao" : "ngày lấy hàng"} {dm(pd.from)}–{dm(pd.to)} ({fmt(pd.days)} ngày)</span>
            <span style={{ color: "var(--text-muted)" }}>Vòng xám = tổng tải kho giao · chấm cam = phần Điện máy</span>
          </div>
        );
      })()}

      <div className="province-map-layout">
        <div className="province-map-sticky">
          <VietnamMap
            className="province-map-canvas"
            colorMap={colorMap}
            highlightProvinces={highlightProvinces}
            routeLines={routeLines}
            provinceDetailsMap={provinceDetailsMap}
            viewMode={viewMode}
            provinceMuted={false}
            warehouses={showWh ? whDots.dots : null}
            selectedWarehouse={showWh ? pinnedWh : null}
            onWarehouseHover={handleWhHover}
            onWarehouseClick={handleWhClick}
            selectedProvince={pinnedProv}
            focusProvince={focus}
            legend={legend}
            onToggleFullscreen={fsSupported ? toggleFullscreen : null}
            isFullscreen={isFs}
            onProvinceHover={handleProvinceHover}
            onProvinceClick={handleProvinceClick}
          />
          {fsNote && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>{fsNote}</div>}
        </div>

        <div className="province-map-side">
          {!singleProjectMode && hotspotRule && (
            <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", borderLeft: "3px solid var(--red)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>🔥 Top 5 điểm nóng cần chú ý</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Trễ: on-time &lt; {hotspotRule.ontimePct}% (≥ {hotspotRule.minEval} đơn đã đánh giá) · Bể vỡ: ≥ 2× TB và ≥ 2 ca · bấm để phóng tới trên bản đồ
                </span>
              </div>
              {hotspots.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Không có tỉnh nào vượt ngưỡng trong bộ lọc hiện tại.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {hotspots.map((h, i) => {
                    const on = pinnedProv === h.name;
                    return (
                      <button key={h.name} onClick={() => (on ? setPinnedProv(null) : selectAndFly(h.name))} style={{
                        display: "flex", alignItems: "center", gap: 10, textAlign: "left", width: "100%", fontFamily: "inherit",
                        padding: "7px 10px", borderRadius: 8, cursor: "pointer", color: "var(--text-primary)", flexWrap: "wrap",
                        border: `1px solid ${on ? "var(--red)" : "var(--border)"}`, background: on ? "var(--red-glow)" : "var(--panel-bg)",
                      }}>
                        <span style={{ fontWeight: 800, color: "var(--red)", width: 14 }}>{i + 1}</span>
                        <span style={{ fontWeight: 700, minWidth: 100 }}>{h.name}</span>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1, minWidth: 160 }}>
                          {h.lateHot && <span style={{ color: getOntimeColor(h.ontimePct), fontWeight: 600 }}>⏱ On-time {h.ontimePct}% · {fmt(h.late)} late</span>}
                          {h.lateHot && h.damageHot && " · "}
                          {h.damageHot && <span style={{ color: "var(--amber)", fontWeight: 600 }}>💥 {fmt(h.damaged)} ca hỏng ({h.damageRate}%)</span>}
                          {!h.lateHot && <span> · on-time {h.ontimePct ?? "—"}%</span>}
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmt(h.orders)} đơn</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Province detail — replaces the floating box that used to cover the map */}
          <div style={{ background: "var(--panel-bg-strong)", border: `1px solid ${whPinnedShown ? "var(--cyan)" : !shownWh && isPinnedShown ? "var(--red)" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px", minHeight: 260 }}>
            {shownWh ? (
              <WarehouseDetail
                site={shownWh} period={warehouseLayer.period}
                dateBasis={warehouseLayer.dateField === "delivered_time" ? "ngày giao" : "ngày lấy hàng"}
                pinned={whPinnedShown} onUnpin={() => setPinnedWh(null)}
              />
            ) : inspectData ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    📍 {inspectData.name}
                    {(() => {
                      const badge = getOntimeBadge(inspectData.ontimePct);
                      return (
                        <span style={{ fontSize: 11, background: badge.bg, color: badge.color, border: `1px solid ${badge.color}`, padding: "1px 7px", borderRadius: 4, fontWeight: 600 }}>
                          {badge.label}
                        </span>
                      );
                    })()}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                    {isPinnedShown ? "Đã chọn" : "Đang rê chuột"}
                    {isPinnedShown && (
                      <button type="button" onClick={() => setPinnedProv(null)} title="Bỏ chọn" style={{
                        border: "1px solid var(--border)", background: "var(--panel-bg)", color: "var(--text-secondary)",
                        borderRadius: 6, padding: "1px 7px", cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                      }}>✕ Bỏ chọn</button>
                    )}
                  </span>
                </div>

                <div className="province-stat-grid">
                  <MiniStat label="Đơn giao" color="var(--cyan)">{fmt(inspectData.totalOrders)}</MiniStat>
                  <MiniStat label="Tải trọng">{fmtWeight(inspectData.totalWeight)}</MiniStat>
                  <MiniStat label="Tỷ lệ Ontime" color={getOntimeColor(inspectData.ontimePct)}>{inspectData.ontimePct}%</MiniStat>
                  <MiniStat label="Đơn Ontime / Late">
                    <span style={{ color: "var(--green)" }}>{fmt(inspectData.ontimeCount)}</span> / <span style={{ color: "var(--red)" }}>{fmt(inspectData.lateCount)}</span>
                  </MiniStat>
                  <MiniStat label="Ca hư hỏng" color={inspectData.damageCount > 0 ? "var(--amber)" : "var(--text-secondary)"}>
                    {inspectData.damageCount || 0} ca {inspectData.damageCount > 0 && "💥"}
                  </MiniStat>
                  <MiniStat label="Điểm lấy hàng chính">
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {inspectData.topOrigins && inspectData.topOrigins.length > 0
                        ? `${inspectData.topOrigins[0].name} (${inspectData.topOrigins[0].pct}%)`
                        : "—"}
                    </span>
                  </MiniStat>
                </div>

                {inspectData.topOrigins && inspectData.topOrigins.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={SECTION_LABEL}>🚚 Tuyến lấy → giao chính</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {inspectData.topOrigins.slice(0, 3).map((o) => (
                        <span key={o.name} style={{ fontSize: 11.5, background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", color: "var(--text-secondary)" }}>
                          {o.name} → {inspectData.name}: <b style={{ color: "var(--text-primary)" }}>{fmt(o.count)} đơn</b> ({o.pct}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {inspectData.clientDetails && inspectData.clientDetails.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={SECTION_LABEL}>🏢 Khách hàng giao khu vực {inspectData.name} ({inspectData.clientDetails.length})</div>
                    <div style={{ maxHeight: 210, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <table className="data-table" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ padding: "6px 10px" }}>Khách</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Đơn</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Tải trọng</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Ontime</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Hỏng</th>
                            <th style={{ padding: "6px 10px" }}>Lấy tại</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectData.clientDetails.map((c) => (
                            <tr key={c.name}>
                              <td style={{ padding: "5px 10px", fontWeight: 600 }}>{c.name}</td>
                              <td style={{ padding: "5px 10px", textAlign: "right", color: "var(--cyan)", fontWeight: 700 }}>{fmt(c.orders)}</td>
                              <td style={{ padding: "5px 10px", textAlign: "right" }}>{shortWeight(c.weight)}</td>
                              <td style={{ padding: "5px 10px", textAlign: "right", color: getOntimeColor(c.ontimePct), fontWeight: 600 }}>
                                {c.ontimePct}%{c.ontimePct < 80 ? " 🚨" : c.ontimePct < 90 ? " ⚠️" : ""}
                              </td>
                              <td style={{ padding: "5px 10px", textAlign: "right", color: c.damageCount > 0 ? "var(--amber)" : "var(--text-muted)", fontWeight: c.damageCount > 0 ? 700 : 400 }}>
                                {c.damageCount > 0 ? `${c.damageCount} ca` : "—"}
                              </td>
                              <td style={{ padding: "5px 10px", color: "var(--text-secondary)" }}>{c.mainOrigin}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {onProvinceClick && (
                  <button type="button" onClick={() => openOrders(inspectData.name)} style={{
                    marginTop: 12, width: "100%", padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    border: "1px solid var(--cyan)", background: "var(--cyan-glow)", color: "var(--cyan)", fontWeight: 700, fontSize: 13,
                  }}>
                    📋 Xem danh sách đơn giao {inspectData.name}
                  </button>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{showWh ? "📍 Chi tiết tỉnh / kho" : "📍 Chi tiết tỉnh"}</div>
                {showWh && (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
                    🏭 Rê hoặc bấm chấm kho để xem tổng tải kho giao (vòng xám) + phần Điện máy (chấm cam): đơn/ngày TB · P90 · max, giao lẫn lấy. Phóng to để tách kho gần nhau và hiện tên.
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: singleProjectMode ? 12 : 0 }}>
                  💡 Rê vào tỉnh để xem nhanh; bấm tỉnh (hoặc điểm nóng / ô Top 8) để giữ — có đơn, on-time, late, ca bể vỡ, tuyến lấy, khách hàng và nút xem danh sách đơn.
                </div>

                {singleProjectMode && projectOverview && (
                  <div className="grid-2" style={{ gap: 12 }}>
                    <div style={{ background: "var(--panel-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                      <div style={SECTION_LABEL}>🏬 Điểm lấy hàng chính của {projectName} (bấm để lọc)</div>
                      {originStats && originStats.length > 0 ? (
                        originStats.slice(0, 5).map((o) => {
                          const oDet = o.details;
                          const isSel = selectedOrigin === o.name;
                          return (
                            <div
                              key={o.name}
                              onClick={() => onOriginChange?.(isSel ? null : o.name)}
                              style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                fontSize: 11.5, marginBottom: 3, padding: "3px 6px", borderRadius: 4,
                                cursor: "pointer",
                                background: isSel ? "rgba(var(--brand-rgb),0.15)" : "transparent",
                                border: isSel ? "1px solid var(--cyan)" : "1px solid transparent",
                              }}
                            >
                              <span style={{ color: "var(--text-primary)" }}>{isSel ? "🎯" : "•"} {o.name}</span>
                              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <b style={{ color: "var(--cyan)" }}>{o.orders} đơn</b>
                                {oDet && (
                                  <span style={{ color: getOntimeColor(oDet.ontimePct), fontSize: 10.5, fontWeight: 600 }}>
                                    {oDet.ontimePct}%
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Chưa ghi nhận điểm lấy</div>
                      )}
                    </div>

                    <div style={{ background: "var(--panel-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                      <div style={SECTION_LABEL}>🚚 Top tỉnh giao hàng lớn nhất{selectedOrigin ? ` (từ ${selectedOrigin})` : ""}</div>
                      {projectOverview.topProvinces && projectOverview.topProvinces.length > 0 ? (
                        projectOverview.topProvinces.slice(0, 3).map((p) => (
                          <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                            <span style={{ color: "var(--text-primary)" }}>• {p.name}</span>
                            <b style={{ color: "var(--cyan)" }}>{p.count} đơn ({p.pct}%)</b>
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Chưa ghi nhận tỉnh giao</div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {showWh && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                🏭 Top 8 kho (tổng tải GTC/ng khi có · ĐM/ng) · bấm để phóng tới
              </div>
              <div className="grid-2" style={{ gap: 8 }}>
                {topWarehouses.map((d) => {
                  const on = pinnedWh === d.id || activeWh === d.id;
                  return (
                    <div
                      key={d.id}
                      onMouseEnter={() => setActiveWh(d.id)}
                      onMouseLeave={() => setActiveWh(null)}
                      onClick={() => selectWhAndFly(d)}
                      title="Bấm để chọn và phóng tới kho này trên bản đồ"
                      style={{
                        background: on ? "rgba(var(--brand-rgb),0.12)" : "var(--panel-bg)",
                        border: `1px ${d.dashed ? "dashed" : "solid"} ${on ? "var(--cyan)" : "var(--border)"}`,
                        borderRadius: 8, padding: "8px 12px", cursor: "pointer", minWidth: 0,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{d.label}</span>
                        <span style={{ fontSize: 12, color: "var(--cyan)", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {d.totGtc > 0 ? fmt(d.totGtc) : fmt(d.dmG, 1)}
                          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 2 }}>{d.totGtc > 0 ? "GTC" : "ĐM"}/ng</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showWh && <UnplacedPanel layer={warehouseLayer} />}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              💡 Top 8 Tỉnh ({viewMode === "weight" ? "Xếp theo Tải trọng Tấn" : viewMode === "ontime" ? "Cảnh báo Ontime thấp trước" : viewMode === "damage" ? "Xếp theo Ca Bể Vỡ" : "Xếp theo Số đơn"})
            </div>
            <div className="grid-2" style={{ gap: 8 }}>
              {topProvinces.map((p) => {
                const isSelected = activeProv === p.name || pinnedProv === p.name;
                const pDet = provinceDetailsMap[p.name] || p.details;
                const pOntime = pDet ? pDet.ontimePct : 100;
                const pColor = getOntimeColor(pOntime);
                const pWeight = pDet?.totalWeight || p.weight || 0;

                return (
                  <div
                    key={p.name}
                    onMouseEnter={() => setActiveProv(p.name)}
                    onMouseLeave={() => setActiveProv(null)}
                    onClick={() => selectAndFly(p.name)}
                    title="Bấm để chọn và phóng tới tỉnh này trên bản đồ"
                    style={{
                      background: isSelected ? "rgba(var(--brand-rgb),0.12)" : "var(--panel-bg)",
                      border: isSelected ? "1px solid var(--cyan)" : `1px solid ${pOntime < 80 ? "var(--red)" : pOntime < 90 ? "var(--amber)" : "var(--border)"}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5, color: pColor, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                        {p.name}
                        {pOntime < 80 ? <span style={{ fontSize: 10 }}>🚨</span> : pOntime < 90 ? <span style={{ fontSize: 10 }}>⚠️</span> : null}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--cyan)", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {fmt(p.orders)} đơn ({shortWeight(pWeight)})
                      </span>
                    </div>
                    {p.topClient && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Top: {p.topClient.name} ({p.topClient.pct}%)
                        {pDet && ` · Ontime: ${pDet.ontimePct}%`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
