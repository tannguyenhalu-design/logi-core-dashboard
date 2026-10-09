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
import { useFilterWorker } from "../../../hooks/useFilterWorker";
import { computeWarehouseSaturation } from "../../../lib/warehouse-health";

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
function MapLegend({ viewMode, maxOrders, maxWeight, singleProjectMode, showWh = false, whMaxTotal = 0, mapIndustry = "dm" }) {
  const [open, setOpen] = useState(false);
  const provTitle = mapIndustry === "all"
    ? "Năng lực kho giao (% tải / GTC cap)"
    : { orders: "Số đơn giao", weight: "Tải trọng giao", ontime: "Tỷ lệ on-time", damage: "Ca hư hỏng (Rillnet)" }[viewMode];
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
          {mapIndustry === "all" ? (
            <>
              {row(<span style={sw("rgba(239,68,68,0.8)")} />, "≥ 100%: Quá tải")}
              {row(<span style={sw("rgba(245,158,11,0.8)")} />, "80–100%: Gần đầy")}
              {row(<span style={sw("rgba(34,197,94,0.75)")} />, "50–80%: Lành mạnh")}
              {row(<span style={sw("rgba(59,130,246,0.7)")} />, "< 50%: Còn nhiều dư")}
              {row(<span style={sw("var(--map-unhighlighted)", { opacity: 0.6 })} />, "Không có dữ liệu kho")}
            </>
          ) : (
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
        </>
      )}
      {open && showWh && (
        <>
          <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
          {whMaxTotal > 0 ? (
            <>
              {row(
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", border: "1.5px solid var(--text-secondary)", display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(34,197,94,0.85)" }} />
                  </span>
                </span>,
                `Vòng xám = tổng tải kho TB (GTC/ng) · lớn nhất ${fmt(whMaxTotal)} GTC`
              )}
              {row(<span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(34,197,94,0.85)", flexShrink: 0 }} />, "Chấm xanh = % tải < 70%")}
              {row(<span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(245,158,11,0.85)", flexShrink: 0 }} />, "Chấm vàng = 70–90%")}
              {row(<span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(239,68,68,0.85)", flexShrink: 0 }} />, "Chấm đỏ = ≥ 90% tải")}
            </>
          ) : row(
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: "1.5px solid var(--text-secondary)", display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background:
                  mapIndustry === "nhc"  ? "rgba(139,92,246,0.85)" :
                  mapIndustry === "sttp" ? "rgba(6,182,212,0.85)"  :
                  mapIndustry === "all"  ? "rgba(29,158,117,0.85)" :
                  "rgba(var(--brand-rgb),0.82)"
                }} />
              </span>
            </span>,
            `Vòng xám = tổng tải kho giao TB lịch sử (GTC/ngày) · ${
              mapIndustry === "nhc"  ? "chấm tím = NHC" :
              mapIndustry === "sttp" ? "chấm xanh = STTP" :
              mapIndustry === "all"  ? "chấm xanh lá = tổng 4 ngành" :
              "chấm cam = Điện máy"
            }`
          )}
          {row(dot(12, { border: "1.5px dashed var(--text-primary)", background: "transparent" }), `Viền đứt: vị trí ước lượng · Chỉ có chấm màu = chưa có số tổng tải`)}
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

function WarehouseDetail({ site, period, dateBasis, pinned, onUnpin, mapIndustry = "dm" }) {
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

      {mapIndustry === "all" ? (
        <div style={{ fontSize: 11.5, color: "var(--cyan)", border: "1px solid var(--cyan)", borderRadius: 6, padding: "4px 8px", marginBottom: 10 }}>
          Tổng 4 ngành: DM + STTP + NHC + ECOM — so với TB lịch sử ở bảng trên
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 6, padding: "4px 8px", marginBottom: 10 }}>
          ⚠ Số bên dưới chỉ là phần {mapIndustry === "nhc" ? "NH Chung (NHC)" : mapIndustry === "sttp" ? "STTP" : "Điện máy"} — chưa phải tổng tải của kho
        </div>
      )}

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

// ── AI per-tab panel ──
// Aggregates province/warehouse data for the active industry tab and renders
// AINarrativePanel (reused from TabAIInsights) with a map-specific prompt.
function MapTabAIPanel({ mapIndustry, provinceStats, provinceStatsNhc, provinceStatsSttp, provinceStatsEcom, provinceDetailsMap, nearCapWarehouses, lowOntimeProvsInsight, nearCapProvsInsight }) {
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset narrative when user switches industry tab
  useEffect(() => { setNarrative(null); setError(null); }, [mapIndustry]);

  const industryLabel = mapIndustry === "nhc" ? "NHC" : mapIndustry === "sttp" ? "STTP" : mapIndustry === "ecom" ? "ECOM" : mapIndustry === "all" ? "Tổng 4 ngành" : "Điện Máy";

  const buildPayload = () => {
    const topN = (arr, n, key, asc = false) =>
      [...(arr || [])].sort((a, b) => asc ? (a[key] ?? 0) - (b[key] ?? 0) : (b[key] ?? 0) - (a[key] ?? 0)).slice(0, n);

    const stats = mapIndustry === "nhc" ? (provinceStatsNhc || [])
      : mapIndustry === "sttp" ? (provinceStatsSttp || [])
      : mapIndustry === "ecom" ? (provinceStatsEcom || [])
      : (provinceStats || []);

    const topProvinces = topN(stats, 5, "orders").map((p) => ({
      name: p.name,
      orders: p.orders,
      ontimePct: (mapIndustry === "nhc" || mapIndustry === "sttp" || mapIndustry === "ecom") ? p.details?.ontimePct : (provinceDetailsMap[p.name]?.ontimePct ?? null),
    }));

    const lowOntimeProvinces = (mapIndustry === "nhc" || mapIndustry === "sttp" || mapIndustry === "ecom")
      ? [...(stats)].filter((p) => (p.details?.ontimePct ?? 100) < 90 && (p.details?.evalCount ?? 0) >= 2)
          .sort((a, b) => (a.details?.ontimePct ?? 100) - (b.details?.ontimePct ?? 100))
          .slice(0, 5)
          .map((p) => ({ name: p.name, ontimePct: p.details.ontimePct, orders: p.orders }))
      : lowOntimeProvsInsight.map((p) => ({ name: p.name, ontimePct: p.ontimePct, orders: p.orders }));

    const totalOrders = stats.reduce((s, p) => s + (p.orders || 0), 0);
    const evalOrders = (mapIndustry === "nhc" || mapIndustry === "sttp" || mapIndustry === "ecom")
      ? stats.reduce((s, p) => s + ((p.details?.evalCount ?? 0) >= 1 ? p.orders : 0), 0)
      : null;

    // Overall ontime for active industry (weighted avg across provinces with eval data)
    const allEval = stats.filter((p) => (p.details?.evalCount ?? 0) > 0);
    const sumOntime = allEval.reduce((s, p) => s + (p.details.ontimeCount || 0), 0);
    const sumEval   = allEval.reduce((s, p) => s + (p.details.evalCount  || 0), 0);
    const overallOntimePct = sumEval > 0 ? Math.round((sumOntime / sumEval) * 100) : null;

    const payload = { mapIndustry, industryLabel, totalOrders, overallOntimePct, topProvinces, lowOntimeProvinces };

    if (nearCapWarehouses?.length > 0) {
      payload.nearCapWarehouses = nearCapWarehouses.map((d) => ({ label: d.label, utilPct: d.utilPct }));
    }

    if (mapIndustry === "sttp" && (provinceStats || []).length > 0 && (provinceStatsSttp || []).length > 0) {
      const dmOntimes = (provinceStats).filter((p) => provinceDetailsMap[p.name]?.evalCount >= 3)
        .map((p) => provinceDetailsMap[p.name]?.ontimePct ?? null).filter((v) => v != null);
      const sttpOntimes = (provinceStatsSttp).filter((p) => (p.details?.evalCount ?? 0) >= 2)
        .map((p) => p.details?.ontimePct ?? null).filter((v) => v != null);
      const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
      payload.comparison = { ontimeDmAvg: avg(dmOntimes), ontimeSttpAvg: avg(sttpOntimes) };
      const dmProvinces = new Set((provinceStats).map((p) => p.name));
      const sttpProvinces = new Set((provinceStatsSttp).map((p) => p.name));
      const gap = [...dmProvinces].filter((n) => !sttpProvinces.has(n)).slice(0, 6).map((name) => {
        const p = provinceStats.find((x) => x.name === name);
        return { name, dmOrders: p?.orders ?? 0 };
      }).sort((a, b) => b.dmOrders - a.dmOrders).slice(0, 5);
      if (gap.length > 0) payload.coverageGap = gap;
    }

    if (mapIndustry === "all" && nearCapProvsInsight?.length > 0) {
      payload.nearCapProvinces = nearCapProvsInsight.map((p) => ({ name: p.name, pct: p.pct }));
    }

    if (mapIndustry === "all" && (provinceStats || []).length > 0) {
      const industries = [];
      if (provinceStats?.length)      industries.push({ industry: "DM",   provinces: provinceStats.length,    topOrders: provinceStats[0]?.orders ?? 0 });
      if (provinceStatsNhc?.length)   industries.push({ industry: "NHC",  provinces: provinceStatsNhc.length, topOrders: provinceStatsNhc[0]?.orders ?? 0 });
      if (provinceStatsSttp?.length)  industries.push({ industry: "STTP", provinces: provinceStatsSttp.length, topOrders: provinceStatsSttp[0]?.orders ?? 0 });
      if (provinceStatsEcom?.length)  industries.push({ industry: "ECOM", provinces: provinceStatsEcom.length, topOrders: provinceStatsEcom[0]?.orders ?? 0 });
      payload.industryRanking = industries;
    }

    if (evalOrders != null) payload.evalOrders = evalOrders;

    return payload;
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-map-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapIndustry, data: buildPayload() }),
      });
      const json = await res.json();
      if (json.ok) {
        setNarrative(json.narrative);
      } else {
        const rawErr = typeof json.error === "string" ? json.error : JSON.stringify(json.error);
        if (rawErr.includes("429") || rawErr.includes("quota") || rawErr.includes("Quota")) {
          setError("⚠️ Hệ thống AI đang quá tải. Vui lòng thử lại sau ít phút.");
        } else {
          setError("⚠️ Chưa thể tạo nhận định AI lúc này. Vui lòng thử lại.");
        }
      }
    } catch {
      setError("Lỗi kết nối, vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.25)",
      borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: narrative || error ? 10 : 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--text-primary)" }}>
          🤖 Phân tích AI — {industryLabel}
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            background: "rgba(139,92,246,0.15)", color: "var(--purple)", border: "1px solid rgba(139,92,246,0.35)",
            padding: "5px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 600,
            cursor: loading ? "default" : "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
          }}
        >
          {loading ? "Đang phân tích..." : narrative ? "↺ Phân tích lại" : "✨ Phân tích"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--red)" }}>{error}</div>}
      {narrative && <NarrativeLines text={narrative} />}
    </div>
  );
}

// Bullet renderer (mirrors NarrativeText in TabAIInsights but as a local copy
// to avoid circular import issues with the full AINarrativePanel).
const MAP_EMOJI_COLOR = [
  ["🔴", "var(--red)"],
  ["⚠️", "var(--amber)"],
  ["📊", "var(--blue)"],
  ["📍", "var(--amber)"],
  ["📈", "var(--green)"],
  ["🎯", "var(--cyan)"],
  ["✅", "var(--green)"],
];
function narrativeLineColorMap(line) {
  const hit = MAP_EMOJI_COLOR.find(([emoji]) => line.startsWith(emoji));
  return hit ? hit[1] : "var(--border)";
}
function NarrativeLines({ text }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bulletLines = lines.filter((l) => l.startsWith("- "));
  if (bulletLines.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-line" }}>{text}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {lines.map((line, i) => {
        const content = line.replace(/^-\s*/, "");
        return (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 7, padding: "6px 8px", borderRadius: 6,
            background: "rgba(255,255,255,0.03)", borderLeft: `3px solid ${narrativeLineColorMap(content)}`,
            fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5,
          }}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function ProvinceMapPanel({
  provinceStats, routeStats, provinceDetailsMap = {},
  originStats = [], selectedOrigin = null, onOriginChange,
  projectSummaries = {}, overallData = {}, singleProjectMode, projectName, onProvinceClick,
  hotspots = [], hotspotRule = null,
  provinceRisk = [], damageAvgRate = 0,
  warehouseLayer = null,
  warehouseLayerAll = null,
  warehouseLayerNhc = null,
  warehouseLayerSttp = null,
  warehouseLayerEcom = null,
  provinceStatsNhc = null,
  provinceStatsSttp = null,
  provinceStatsEcom = null,
  periodComparison = null,
}) {
  const [activeProv, setActiveProv] = useState(null);
  const [pinnedProv, setPinnedProv] = useState(null); // selected: map click, hotspot or Top 8
  const [focus, setFocus] = useState(null); // { name, n } → map flies there
  const [viewMode, setViewMode] = useState("ontime"); // 'ontime' | 'orders' | 'weight' | 'damage'
  // Kho layer — checkbox "Hiện kho" (Kế hoạch D · 2a, refactored)
  const [showWhState, setShowWh] = useState(true);
  const [mapIndustry, setMapIndustry] = useState("dm"); // "dm" | "nhc" | "sttp" | "ecom" | "all"
  const [whSearch, setWhSearch] = useState("");
  const [activeWh, setActiveWh] = useState(null);
  const [pinnedWh, setPinnedWh] = useState(null);
  const [showAllUnstable, setShowAllUnstable] = useState(false);
  const activeLayer =
    mapIndustry === "nhc"  ? (warehouseLayerNhc?.sites?.length  ? warehouseLayerNhc  : null) :
    mapIndustry === "sttp" ? (warehouseLayerSttp?.sites?.length ? warehouseLayerSttp : null) :
    mapIndustry === "ecom" ? (warehouseLayerEcom?.sites?.length ? warehouseLayerEcom : null) :
    mapIndustry === "all"  ? (warehouseLayerAll?.sites?.length  ? warehouseLayerAll  : warehouseLayer) :
    warehouseLayer;
  const hasWh = !!(warehouseLayer?.sites?.length || warehouseLayerAll?.sites?.length || warehouseLayerNhc?.sites?.length || warehouseLayerSttp?.sites?.length || warehouseLayerEcom?.sites?.length);
  // Show industry selector when any non-DM industry has province ontime OR warehouse data.
  const hasMultiIndustry = !!(
    warehouseLayerNhc?.sites?.length || provinceStatsNhc?.length ||
    warehouseLayerSttp?.sites?.length || provinceStatsSttp?.length ||
    warehouseLayerEcom?.sites?.length || provinceStatsEcom?.length ||
    warehouseLayerAll?.sites?.length
  );
  const showWh = !!activeLayer?.sites?.length && showWhState; // guards activeLayer.totals / .period accesses
  const showProv = true;

  useEffect(() => {
    setActiveProv(null);
    setPinnedProv(null);
    setActiveWh(null);
    setPinnedWh(null);
    setMapIndustry("dm");
  }, [projectName, singleProjectMode, selectedOrigin]);
  // Reset to DM when the selected industry tab loses its data (e.g. filter change removes NHC rows).
  useEffect(() => {
    if (!hasMultiIndustry && mapIndustry !== "dm") setMapIndustry("dm");
    else if (mapIndustry === "nhc"  && !provinceStatsNhc?.length  && !warehouseLayerNhc?.sites?.length)  setMapIndustry("dm");
    else if (mapIndustry === "sttp" && !provinceStatsSttp?.length && !warehouseLayerSttp?.sites?.length) setMapIndustry("dm");
    else if (mapIndustry === "ecom" && !provinceStatsEcom?.length && !warehouseLayerEcom?.sites?.length) setMapIndustry("dm");
  }, [hasMultiIndustry, mapIndustry, provinceStatsNhc, provinceStatsSttp, provinceStatsEcom, warehouseLayerNhc, warehouseLayerSttp, warehouseLayerEcom]);
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

  // Province stats for the selected industry (NHC/STTP have simpler shape)
  const activeProvinceStats = useMemo(() => {
    if (mapIndustry === "nhc"  && provinceStatsNhc?.length)  return provinceStatsNhc;
    if (mapIndustry === "sttp" && provinceStatsSttp?.length) return provinceStatsSttp;
    if (mapIndustry === "ecom" && provinceStatsEcom?.length) return provinceStatsEcom;
    return provinceStats || [];
  }, [mapIndustry, provinceStats, provinceStatsNhc, provinceStatsSttp, provinceStatsEcom]);

  // Hotspots derived from industry-specific province stats for NHC/STTP/ECOM
  const activeHotspots = useMemo(() => {
    if (mapIndustry === "dm" || mapIndustry === "all" || !hotspotRule) return hotspots;
    const src = mapIndustry === "nhc" ? provinceStatsNhc : mapIndustry === "ecom" ? provinceStatsEcom : provinceStatsSttp;
    if (!src?.length) return hotspots;
    return src
      .filter((p) => p.details?.evalCount >= (hotspotRule.minEval || 5) && p.details?.ontimePct < (hotspotRule.ontimePct || 80))
      .map((p) => ({ name: p.name, ontimePct: p.details.ontimePct, orders: p.orders, late: p.details.lateCount, lateHot: true, damageHot: false }))
      .sort((a, b) => a.ontimePct - b.ontimePct)
      .slice(0, 5);
  }, [mapIndustry, hotspots, hotspotRule, provinceStatsNhc, provinceStatsSttp, provinceStatsEcom]);

  // For "Tổng 4" mode: aggregate warehouseLayerAll.sites by province →
  // capacity utilization = (sum actual giao/day) / (sum GTC cap/day).
  // Stays on the main thread — lightweight, and the Worker needs it as input.
  const provinceCapUtil = useMemo(() => {
    if (!warehouseLayerAll?.sites?.length) return {};
    const agg = {};
    for (const w of warehouseLayerAll.sites) {
      const prov = w.names[0]?.province;
      if (!prov) continue;
      if (!agg[prov]) agg[prov] = { actual: 0, cap: 0 };
      agg[prov].actual += w.giao?.ordersPerDay?.avg ?? 0;
      agg[prov].cap += w.names.reduce((s, n) => s + (n.total?.avgOrdersGtc ?? 0), 0);
    }
    return agg;
  }, [warehouseLayerAll]);

  // sortedProvinces / scale / colorMap — computed in a Web Worker to keep
  // the main thread free during filter changes (Nhóm 1). The hook returns
  // the last successful result while a new computation is in flight, so
  // the map never flickers to an empty state.
  const { sortedProvinces, scale, colorMap } = useFilterWorker({
    provinceStats,
    provinceDetailsMap,
    viewMode,
    mapIndustry,
    activeProvinceStats,
    provinceCapUtil,
  });

  // Smart Hotspots (Nhóm 2a): compute risk scores for DM/all mode using data
  // already available in the snapshot (no server rebuild required).
  // Falls back to server-supplied provinceRisk[] if present, else derives
  // from provinceStats + provinceDetailsMap + damageAvgRate.
  const computedProvinceRisk = useMemo(() => {
    if (provinceRisk.length > 0) return provinceRisk;
    const stats = activeProvinceStats;
    if (!stats.length) return [];
    const isDmAll = mapIndustry === "dm" || mapIndustry === "all";
    // For DM/all use server-supplied avgRate; for NHC/STTP compute from province data
    const totalOrders = stats.reduce((s, p) => s + (p.orders || 0), 0);
    const totalDamage = stats.reduce((s, p) => s + (isDmAll ? 0 : (p.details?.damageCount || 0)), 0);
    const computedAvgRate = totalOrders > 0 ? (totalDamage / totalOrders) * 100 : 0;
    const avgRate = isDmAll ? (damageAvgRate || 0) : computedAvgRate;
    // w3: tải trọng — tỉnh nào nhận > 150% trung bình tỉnh thì tăng risk
    const provWithWeight = stats.filter((p) => (p.details?.totalWeight || 0) > 0);
    const totalWeightAll = provWithWeight.reduce((s, p) => s + p.details.totalWeight, 0);
    const avgWeightPerProv = provWithWeight.length > 0 ? totalWeightAll / provWithWeight.length : 0;
    return stats.map((p) => {
      const det = isDmAll ? (provinceDetailsMap[p.name] || p.details) : (p.details || {});
      const evalCount = (det?.ontimeCount ?? 0) + (det?.lateCount ?? 0);
      const ontimePct = evalCount > 0 ? (det.ontimePct ?? null) : null;
      const damageCount = det?.damageCount ?? 0;
      const damageRate = p.orders > 0 ? (damageCount / p.orders) * 100 : 0;
      const w1 = ontimePct !== null ? Math.max(0, 90 - ontimePct) : 0;
      const w2 = avgRate > 0 ? (damageRate / avgRate) * 10 : 0;
      const provWeight = det?.totalWeight || 0;
      const wRatio = avgWeightPerProv > 0 ? provWeight / avgWeightPerProv : 0;
      const w3 = Math.max(0, (wRatio - 1.5) * 3);
      const riskScore = w1 + w2 + w3;
      const tiers = [];
      if (evalCount >= 10 && ontimePct !== null && ontimePct < 80) tiers.push("sla");
      if (damageCount >= 1 && damageRate >= avgRate) tiers.push("damage");
      if (p.orders >= 100 && evalCount >= 10 && ontimePct !== null && ontimePct >= 95) tiers.push("star");
      if (tiers.length === 0 && evalCount >= 10 && ontimePct !== null && ontimePct < 90) tiers.push("watchlist");
      if (provWeight > 0 && wRatio > 1.5) tiers.push("heavy");
      return { name: p.name, orders: p.orders, evalCount, ontimePct, damaged: damageCount, damageRate, riskScore, tiers, totalWeight: provWeight, wRatio };
    }).sort((a, b) => b.riskScore - a.riskScore || b.orders - a.orders);
  }, [provinceRisk, activeProvinceStats, provinceDetailsMap, damageAvgRate, mapIndustry]);

  const topProvinces = useMemo(() => {
    if (!singleProjectMode && computedProvinceRisk.length > 0) {
      const riskMap = new Map(computedProvinceRisk.map((r) => [r.name, r]));
      return [...activeProvinceStats]
        .map((p) => {
          const rr = riskMap.get(p.name);
          return { ...p, riskScore: rr?.riskScore ?? 0, tiers: rr?.tiers ?? [] };
        })
        .sort((a, b) => b.riskScore - a.riskScore || b.orders - a.orders)
        .slice(0, 8);
    }
    return sortedProvinces.slice(0, 8);
  }, [singleProjectMode, computedProvinceRisk, activeProvinceStats, sortedProvinces]);
  const highlightProvinces = useMemo(
    () => (singleProjectMode ? [] : sortedProvinces.slice(0, 5).map((p) => p.name)),
    [singleProjectMode, sortedProvinces]
  );

  const routeLines = useMemo(() => (
    singleProjectMode
      ? (routeStats || []).slice(0, 25).map((r) => ({ from: r.from, to: r.to, weight: r.orders, color: ROUTE_COLOR }))
      : []
  ), [singleProjectMode, routeStats]);

  // Warehouse health — Clear-Time logic (Sheet Anh Tân, 2026-10-09)
  const saturationData = useMemo(
    () => computeWarehouseSaturation(warehouseLayerAll),
    [warehouseLayerAll]
  );
  const satMap = useMemo(
    () => new Map(saturationData.sites.map((s) => [s.id, s])),
    [saturationData]
  );
  const unstableSites = useMemo(() => {
    const byId = new Map((warehouseLayerAll?.healthSites || warehouseLayerAll?.sites || []).map((w) => [w.id, w]));
    return saturationData.sites
      .filter((s) => s.unstable && byId.has(s.id))
      .map((s) => {
        const w = byId.get(s.id);
        return { ...s, x: w.x, y: w.y, label: siteLabel(w) };
      })
      .sort((a, b) => b.est_clear_hien_tai - a.est_clear_hien_tai);
  }, [saturationData, warehouseLayerAll]);

  // Warehouse dots — outer ring (grey) = total GTC delivery load (KhoGiaoTongTai),
  // inner dot (orange) = Điện máy giao share. Both scale on the same √ axis so
  // the ratio is visually meaningful. Biggest drawn first (small ones on top).
  const whSites = activeLayer?.sites || null;
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
        const innerLabel = mapIndustry === "nhc" ? "NHC" : mapIndustry === "sttp" ? "STTP" : mapIndustry === "all" ? "4 ngành" : "ĐM";
        const utilPct = totGtc > 0 ? dmG / totGtc : null;
        const dotFill = utilPct != null
          ? (utilPct >= 0.9 ? "rgba(239,68,68,0.85)"
           : utilPct >= 0.7 ? "rgba(245,158,11,0.85)"
           :                  "rgba(34,197,94,0.85)")
          : (mapIndustry === "nhc"  ? "rgba(139,92,246,0.85)"
           : mapIndustry === "sttp" ? "rgba(6,182,212,0.85)"
           : mapIndustry === "all"  ? "rgba(29,158,117,0.85)"
           : null);
        const chipSuffix = mapIndustry === "all" ? "tổng 4 ngành" : mapIndustry === "nhc" ? "NH Chung" : mapIndustry === "sttp" ? "STTP" : "Điện máy";
        const satInfo = satMap.get(w.id);
        const satWarning = satInfo?.unstable
          ? ` · 🔴 ${satInfo.headline} (xả ${satInfo.est_clear_hien_tai?.toFixed(1)}ng · peak ×${satInfo.peak_ratio?.toFixed(2)})`
          : satInfo?.hasData && !satInfo.unstable
            ? ` · ✅ ổn (${satInfo.est_clear_hien_tai?.toFixed(1)}ng)`
            : "";
        return {
          id: w.id, x: w.x, y: w.y, dashed: w.estimated,
          unstable: !!satInfo?.unstable,
          label: siteLabel(w),
          rOuter: rOf(totGtc),
          rInner: Math.max(1.5, rOf(dmG)),
          dotFill,
          totGtc, dmG,
          chip: totGtc > 0
            ? `${fmt(totGtc)} GTC/ng · ${fmt(dmG, 1)} ${innerLabel}/ng · ${Math.round(utilPct * 100)}% tải${satWarning}`
            : `${fmt(dmG, 1)} đơn/ng (${chipSuffix})${satWarning}`,
        };
      });
    const maxTotal = Math.max(0, ...whSites.map(totalGtcOf));
    return { dots, maxTotal };
  }, [whSites, mapIndustry, satMap]);
  // Re-sort by industry volume (dmG) when not in DM mode
  const topWarehouses = useMemo(() => {
    if (mapIndustry !== "dm") return [...whDots.dots].sort((a, b) => b.dmG - a.dmG).slice(0, 8);
    return whDots.dots.slice(0, 8);
  }, [whDots, mapIndustry]);

  // InsightPanel data — kho gần vượt tải
  const nearCapWarehouses = useMemo(() => {
    if (!whDots.dots.length) return [];
    return whDots.dots
      .filter((d) => d.totGtc > 0 && d.dmG > 0)
      .map((d) => ({ ...d, utilPct: Math.round((d.dmG / d.totGtc) * 100) }))
      .sort((a, b) => b.utilPct - a.utilPct)
      .slice(0, 3);
  }, [whDots.dots]);

  // InsightPanel data — tỉnh ontime thấp (DM reference)
  const lowOntimeProvsInsight = useMemo(() => {
    return (provinceStats || [])
      .map((p) => {
        const det = provinceDetailsMap[p.name] || p.details;
        return (det && det.evalCount >= 3) ? { name: p.name, ontimePct: det.ontimePct, orders: p.orders } : null;
      })
      .filter(Boolean)
      .filter((p) => p.ontimePct < 90)
      .sort((a, b) => a.ontimePct - b.ontimePct)
      .slice(0, 3);
  }, [provinceStats, provinceDetailsMap]);

  // InsightPanel data — tỉnh gần vượt năng lực kho (chỉ Tổng 4)
  const nearCapProvsInsight = useMemo(() => {
    if (mapIndustry !== "all") return [];
    return Object.entries(provinceCapUtil)
      .map(([name, { actual, cap }]) => (cap > 0 ? { name, pct: Math.round((actual / cap) * 100) } : null))
      .filter(Boolean)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
  }, [mapIndustry, provinceCapUtil]);

  const whSearchResults = useMemo(() => {
    const q = whSearch.trim().toLowerCase();
    if (!q || !showWh) return [];
    return whDots.dots.filter((d) => d.label.toLowerCase().includes(q)).slice(0, 6);
  }, [whSearch, whDots.dots, showWh]);

  const legend = useMemo(
    () => (
      <MapLegend
        viewMode={viewMode} maxOrders={scale.maxOrders} maxWeight={scale.maxWeight} singleProjectMode={singleProjectMode}
        showWh={showWh} whMaxTotal={whDots.maxTotal} mapIndustry={mapIndustry}
      />
    ),
    [viewMode, scale, singleProjectMode, showWh, whDots.maxTotal, mapIndustry]
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
  const inspectData = useMemo(() => {
    if (!shownProv) return null;
    if (mapIndustry === "nhc") {
      const d = provinceStatsNhc?.find((p) => p.name === shownProv)?.details;
      return d ? { ...d, name: shownProv } : null;
    }
    if (mapIndustry === "sttp") {
      const d = provinceStatsSttp?.find((p) => p.name === shownProv)?.details;
      return d ? { ...d, name: shownProv } : null;
    }
    if (mapIndustry === "ecom") {
      const d = provinceStatsEcom?.find((p) => p.name === shownProv)?.details;
      return d ? { ...d, name: shownProv } : null;
    }
    return provinceDetailsMap[shownProv] || provinceStats.find((p) => p.name === shownProv)?.details || null;
  }, [shownProv, mapIndustry, provinceDetailsMap, provinceStats, provinceStatsNhc, provinceStatsSttp, provinceStatsEcom]);
  const projectOverview = singleProjectMode ? projectSummaries[projectName] : null;

  // KPI aggregated from the active industry's province stats (NHC/STTP/All).
  // "All" uses DM overallData as base + supplements with NHC/STTP totals.
  const industryOverallData = useMemo(() => {
    if (singleProjectMode) return null;
    const sumStats = (stats) => {
      if (!stats?.length) return null;
      let orders = 0, ontime = 0, late = 0, weight = 0, damage = 0;
      for (const p of stats) {
        orders += p.orders || 0;
        ontime += p.details?.ontimeCount || 0;
        late   += p.details?.lateCount   || 0;
        weight += p.details?.totalWeight || 0;
        damage += p.details?.damageCount || 0;
      }
      const evalCount = ontime + late;
      return { totalOrders: orders, ontimePct: evalCount > 0 ? Math.round((ontime / evalCount) * 100) : null, ontimeCount: ontime, lateCount: late, totalWeight: weight, damageCount: damage };
    };
    if (mapIndustry === "nhc")  return sumStats(provinceStatsNhc)  || overallData;
    if (mapIndustry === "sttp") return sumStats(provinceStatsSttp) || overallData;
    if (mapIndustry === "ecom") {
      // ECOM không quản lý qua Rillnet → damageCount luôn null (N/A)
      const base = sumStats(provinceStatsEcom);
      return base ? { ...base, damageCount: null } : overallData;
    }
    if (mapIndustry === "all") {
      // Sum across DM + NHC + STTP
      let orders = 0, ontime = 0, late = 0, weight = 0;
      for (const src of [provinceStats, provinceStatsNhc, provinceStatsSttp]) {
        if (!src?.length) continue;
        for (const p of src) {
          orders += p.orders || 0;
          ontime += p.details?.ontimeCount || 0;
          late   += p.details?.lateCount   || 0;
          weight += p.details?.totalWeight || 0;
        }
      }
      const evalCount = ontime + late;
      // Damage: DM từ overallData (authoritative) + NHC + STTP từ province details
      let nhcDmg = 0, sttpDmg = 0;
      for (const p of provinceStatsNhc  || []) nhcDmg  += p.details?.damageCount || 0;
      for (const p of provinceStatsSttp || []) sttpDmg += p.details?.damageCount || 0;
      const totalDmg = (overallData?.damageCount || 0) + nhcDmg + sttpDmg;
      return { totalOrders: orders, ontimePct: evalCount > 0 ? Math.round((ontime / evalCount) * 100) : overallData?.ontimePct, ontimeCount: ontime, lateCount: late, totalWeight: weight, damageCount: totalDmg };
    }
    return null; // DM: use overallData as-is
  }, [singleProjectMode, mapIndustry, provinceStats, provinceStatsNhc, provinceStatsSttp, provinceStatsEcom, overallData]);

  const ov = (singleProjectMode ? projectOverview : (industryOverallData || overallData)) || {};
  const ovBadge = getOntimeBadge(singleProjectMode ? (projectOverview?.ontimePct ?? 100) : (ov?.ontimePct ?? 100));

  const pcProject = singleProjectMode && periodComparison
    ? (periodComparison.clients?.find((c) => c.client === projectName) ?? null)
    : null;

  const provForOntime = useMemo(() => {
    if (!singleProjectMode) return { best: EMPTY, worst: EMPTY };
    const qualified = (provinceStats || [])
      .map((p) => {
        const det = provinceDetailsMap[p.name] || p.details;
        return (det && det.evalCount >= 3) ? { name: p.name, ontimePct: det.ontimePct } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.ontimePct - a.ontimePct);
    return { best: qualified.slice(0, 3), worst: [...qualified].reverse().slice(0, 3) };
  }, [singleProjectMode, provinceStats, provinceDetailsMap]);

  const dmgProvinces = useMemo(() => {
    if (!singleProjectMode || !projectOverview?.damageCount) return EMPTY;
    return (provinceStats || [])
      .filter((p) => ((provinceDetailsMap[p.name] || p.details)?.damageCount || 0) > 0)
      .map((p) => ({ name: p.name, count: (provinceDetailsMap[p.name] || p.details).damageCount }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [singleProjectMode, projectOverview, provinceStats, provinceDetailsMap]);

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
          {hasMultiIndustry && (
            <Seg
              items={[
                { id: "dm",  label: "🟠 ĐM" },
                ...((warehouseLayerNhc?.sites?.length  || provinceStatsNhc?.length)  ? [{ id: "nhc",  label: "🟣 NHC" }]  : []),
                ...((warehouseLayerSttp?.sites?.length || provinceStatsSttp?.length) ? [{ id: "sttp", label: "🔵 STTP" }] : []),
                ...((warehouseLayerEcom?.sites?.length || provinceStatsEcom?.length) ? [{ id: "ecom", label: "🟤 ECOM" }] : []),
                ...((warehouseLayerAll?.sites?.length  || provinceStatsNhc?.length || provinceStatsSttp?.length || provinceStatsEcom?.length) ? [{ id: "all",  label: "🟢 Tổng 4" }] : []),
              ]}
              value={mapIndustry}
              onChange={setMapIndustry}
              activeBg={
                mapIndustry === "nhc"  ? "rgba(139,92,246,0.8)" :
                mapIndustry === "sttp" ? "rgba(6,182,212,0.8)"  :
                mapIndustry === "ecom" ? "rgba(139,90,43,0.8)"  :
                mapIndustry === "all"  ? "var(--cyan)"          :
                "rgba(249,115,22,0.8)"
              }
            />
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
        <Kpi label="Số ca bể vỡ / hư hỏng (Rillnet)" color={mapIndustry === "ecom" ? "var(--text-muted)" : ov.damageCount > 0 ? "var(--amber)" : "var(--text-secondary)"}>
          {mapIndustry === "ecom" ? "N/A" : ov.damageCount == null ? "—" : `${ov.damageCount} ca`}{ov.damageCount > 0 && mapIndustry !== "ecom" && " 💥"}
        </Kpi>
      </div>

      {showWh && (() => {
        const t = activeLayer.totals, pd = activeLayer.period;
        const pct = (x) => (x.orders ? fmt((x.placed / x.orders) * 100, 1) : "0");
        const nNames = activeLayer.sites.reduce((a, w) => a + w.names.length, 0);
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", fontSize: 12, color: "var(--text-secondary)", margin: "-2px 0 12px" }}>
            <span>🏭 <b style={{ color: "var(--text-primary)" }}>{fmt(activeLayer.sites.length)}</b> điểm kho ({fmt(nNames)} tên)</span>
            <span>Đơn có vị trí: giao <b style={{ color: "var(--text-primary)" }}>{pct(t.giao)}%</b> · lấy <b style={{ color: "var(--text-primary)" }}>{pct(t.lay)}%</b></span>
            <span>Theo {activeLayer.dateField === "delivered_time" ? "ngày giao" : "ngày lấy hàng"} {dm(pd.from)}–{dm(pd.to)} ({fmt(pd.days)} ngày)</span>
            <span style={{ color: "var(--text-muted)" }}>
              {mapIndustry === "nhc"  ? "Vòng xám = tổng tải TB lịch sử · chấm tím = NHC" :
               mapIndustry === "sttp" ? "Vòng xám = tổng tải TB lịch sử · chấm xanh = STTP" :
               mapIndustry === "all"  ? "Vòng xám = GTC cap · chấm xanh lá = tổng 4 ngành · màu tỉnh = % tải / cap" :
               "Vòng xám = tổng tải kho giao · chấm cam = phần Điện máy"}
            </span>
          </div>
        );
      })()}

      {unstableSites.length > 0 && (
        <div className="wh-unstable-card" style={{ border: "1px solid rgba(239,68,68,0.55)", background: "rgba(239,68,68,0.06)", borderRadius: 12, padding: "12px 14px", margin: "0 0 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--red)" }}>🔴 {unstableSites.length} kho bất ổn — cần chú ý</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Cần &gt; 1,5 ngày mới giao hết tồn và tồn &gt; 1,2 lần ngày giao cao nhất 7 ngày · Sheet Anh Tân</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 8 }}>
            {(showAllUnstable ? unstableSites : unstableSites.slice(0, 4)).map((s) => (
              <button key={s.id} type="button" onClick={() => selectWhAndFly(s)} title="Bấm để phóng tới kho trên bản đồ" style={{
                textAlign: "left", cursor: "pointer", fontFamily: "inherit", borderRadius: 8, padding: "8px 10px",
                border: `1px solid ${pinnedWh === s.id ? "var(--red)" : "var(--border)"}`, background: "var(--panel-bg)", color: "inherit",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>📍 {s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", whiteSpace: "nowrap" }}>
                    {s.est_clear_hien_tai.toFixed(2).replace(".", ",")} ngày{s.peak_ratio != null ? ` · ×${s.peak_ratio.toFixed(2).replace(".", ",")}` : ""}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)", margin: "3px 0 4px" }}>{s.headline}</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                  {s.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </button>
            ))}
          </div>
          {unstableSites.length > 4 && (
            <button type="button" onClick={() => setShowAllUnstable((v) => !v)} style={{
              marginTop: 8, background: "transparent", border: "none", color: "var(--red)", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, padding: 0,
            }}>
              {showAllUnstable ? "Thu gọn" : `Xem thêm ${unstableSites.length - 4} kho`}
            </button>
          )}
        </div>
      )}

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
          {!singleProjectMode && (
            computedProvinceRisk.length > 0 ? (() => {
              const danger  = computedProvinceRisk.filter(p => p.tiers.includes("sla") || p.tiers.includes("damage")).slice(0, 5);
              const caution = computedProvinceRisk.filter(p => !p.tiers.includes("sla") && !p.tiers.includes("damage") && p.tiers.includes("watchlist")).slice(0, 4);
              const heavy   = computedProvinceRisk.filter(p => p.tiers.includes("heavy") && !p.tiers.includes("sla") && !p.tiers.includes("damage")).slice(0, 3);
              const stars   = computedProvinceRisk.filter(p => p.tiers.includes("star")).slice(0, 3);
              const groups  = [
                { key: "danger",  label: "🔴 Nguy hiểm",           tip: "→ Can thiệp ngay",    color: "var(--red)",    bg: "rgba(239,68,68,0.08)",    items: danger },
                { key: "heavy",   label: "⚖️ Tải trọng cao",        tip: "→ Kiểm tra năng lực bãi", color: "var(--amber)", bg: "rgba(245,158,11,0.08)", items: heavy },
                { key: "caution", label: "⚡ Chú ý",                tip: "→ Theo dõi xu hướng", color: "#60a5fa",       bg: "rgba(96,165,250,0.08)",   items: caution },
                { key: "star",    label: "⭐ Điểm sáng Benchmark",  tip: "→ Nhân rộng mô hình", color: "var(--green)",  bg: "rgba(34,197,94,0.08)",    items: stars },
              ].filter(g => g.items.length > 0);
              return (
                <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                      🎯 Smart Hotspots {mapIndustry === "nhc" ? "🟣 NHC" : mapIndustry === "sttp" ? "🔵 STTP" : mapIndustry === "all" ? "🟢 Tổng 4" : "🟠 ĐM"}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Risk Score · bấm để phóng</span>
                  </div>
                  {groups.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--green)" }}>✅ Tất cả tỉnh trong ngưỡng an toàn.</div>
                  ) : groups.map(g => (
                    <div key={g.key} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: g.color }}>{g.label}</span>
                        <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{g.tip}</span>
                      </div>
                      {g.items.map(p => {
                        const on = pinnedProv === p.name;
                        const desc = g.key === "danger"
                          ? [p.tiers.includes("sla") ? `⏱ Ontime ${p.ontimePct ?? "—"}%` : null, p.tiers.includes("damage") ? `💥 ${p.damaged} ca hỏng (${p.damageRate.toFixed(1)}%)` : null].filter(Boolean).join(" · ")
                          : g.key === "heavy"
                          ? `⚖️ ${(p.totalWeight / 1000).toFixed(1)}T · ${Math.round(p.wRatio * 100)}% TB · Ontime ${p.ontimePct ?? "—"}%`
                          : `Ontime ${p.ontimePct ?? "—"}%${p.damaged > 0 ? ` · 💥 ${p.damaged} ca` : ""}`;
                        return (
                          <button key={p.name} onClick={() => (on ? setPinnedProv(null) : selectAndFly(p.name))} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                            width: "100%", padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                            fontFamily: "inherit", textAlign: "left", flexWrap: "wrap", marginBottom: 3,
                            border: `1px solid ${on ? g.color : "var(--border)"}`,
                            background: on ? g.bg : "var(--panel-bg)",
                          }}>
                            <span style={{ fontWeight: 700, fontSize: 12.5, color: g.color, minWidth: 80 }}>{p.name}</span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)", flex: 1 }}>{desc}</span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmt(p.orders)} đơn</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })() : hotspotRule ? (
              <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", borderLeft: "3px solid var(--red)", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    🔥 Top 5 điểm nóng cần chú ý
                    {(mapIndustry === "nhc" || mapIndustry === "sttp") && (
                      <span style={{ fontSize: 11, color: "var(--amber)", background: "rgba(245,158,11,0.1)", border: "1px solid var(--amber)", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
                        {mapIndustry === "nhc" ? "🟣 NHC" : "🔵 STTP"}
                      </span>
                    )}
                    {mapIndustry === "all" && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>tham chiếu ĐM</span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Trễ: on-time &lt; {hotspotRule.ontimePct}% (≥ {hotspotRule.minEval} đơn đã đánh giá){mapIndustry === "dm" ? " · Bể vỡ: ≥ 2× TB và ≥ 2 ca" : ""} · bấm để phóng tới
                  </span>
                </div>
                {activeHotspots.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Không có tỉnh nào vượt ngưỡng trong bộ lọc hiện tại.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {activeHotspots.map((h, i) => {
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
            ) : null
          )}

          {/* Province detail — replaces the floating box that used to cover the map */}
          <div style={{ background: "var(--panel-bg-strong)", border: `1px solid ${whPinnedShown ? "var(--cyan)" : !shownWh && isPinnedShown ? "var(--red)" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px", minHeight: 260 }}>
            {shownWh ? (
              <WarehouseDetail
                site={shownWh} period={activeLayer.period}
                dateBasis={activeLayer.dateField === "delivered_time" ? "ngày giao" : "ngày lấy hàng"}
                pinned={whPinnedShown} onUnpin={() => setPinnedWh(null)}
                mapIndustry={mapIndustry}
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
                  <MiniStat label="Đơn giao" color="var(--cyan)">{fmt(
                    mapIndustry === "all"
                      ? (provinceStats.find((p) => p.name === shownProv)?.orders || 0) +
                        (provinceStatsNhc?.find((p) => p.name === shownProv)?.orders || 0) +
                        (provinceStatsSttp?.find((p) => p.name === shownProv)?.orders || 0) +
                        (provinceStatsEcom?.find((p) => p.name === shownProv)?.orders || 0)
                      : (inspectData.totalOrders ?? inspectData.evalCount)
                  )}</MiniStat>
                  {inspectData.totalWeight != null && (
                    <MiniStat label="Tải trọng">{fmtWeight(inspectData.totalWeight)}</MiniStat>
                  )}
                  <MiniStat label="Tỷ lệ Ontime" color={getOntimeColor(inspectData.ontimePct)}>{inspectData.ontimePct}%</MiniStat>
                  <MiniStat label="Đơn Ontime / Late">
                    <span style={{ color: "var(--green)" }}>{fmt(inspectData.ontimeCount)}</span> / <span style={{ color: "var(--red)" }}>{fmt(inspectData.lateCount)}</span>
                  </MiniStat>
                  {inspectData.damageCount != null && (
                    <MiniStat label="Ca hư hỏng" color={inspectData.damageCount > 0 ? "var(--amber)" : "var(--text-secondary)"}>
                      {inspectData.damageCount || 0} ca {inspectData.damageCount > 0 && "💥"}
                    </MiniStat>
                  )}
                  {inspectData.topOrigins?.length > 0 && (
                    <MiniStat label="Điểm lấy hàng chính">
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {inspectData.topOrigins[0].name} ({inspectData.topOrigins[0].pct}%)
                      </span>
                    </MiniStat>
                  )}
                </div>

                {mapIndustry === "all" && (() => {
                  const dmD   = provinceDetailsMap[shownProv] || provinceStats.find((p) => p.name === shownProv)?.details;
                  const nhcD  = provinceStatsNhc?.find((p) => p.name === shownProv)?.details;
                  const sttpD = provinceStatsSttp?.find((p) => p.name === shownProv)?.details;
                  const ecomD = provinceStatsEcom?.find((p) => p.name === shownProv)?.details;
                  const rows = [
                    { label: "🟠 ĐM",   color: "var(--amber)",       orders: dmD?.totalOrders,   weight: dmD?.totalWeight,   ontime: dmD?.ontimePct,   damage: dmD?.damageCount },
                    { label: "🟣 NHC",  color: "#a78bfa",             orders: nhcD?.evalCount,    weight: nhcD?.totalWeight,  ontime: nhcD?.ontimePct,  damage: nhcD?.damageCount ?? null },
                    { label: "🔵 STTP", color: "#38bdf8",             orders: sttpD?.evalCount,   weight: sttpD?.totalWeight, ontime: sttpD?.ontimePct, damage: sttpD?.damageCount ?? null },
                    { label: "🟤 ECOM", color: "rgba(139,90,43,0.9)", orders: ecomD?.evalCount,   weight: ecomD?.totalWeight, ontime: ecomD?.ontimePct, damage: null, ecomRow: true },
                  ].filter((r) => r.orders != null && r.orders > 0);
                  if (!rows.length) return null;
                  const total = rows.reduce((s, r) => s + r.orders, 0);
                  const totalWeight = rows.reduce((s, r) => s + (r.weight || 0), 0);
                  return (
                    <div style={{ marginTop: 12 }}>
                      <div style={SECTION_LABEL}>📊 Breakdown theo ngành</div>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                        <table className="data-table" style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th style={{ padding: "5px 8px" }}>Ngành</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>Đơn</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>% Đơn</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>Tải trọng</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>% Tải</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>Ontime</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>Bể vỡ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.label}>
                                <td style={{ padding: "5px 8px", fontWeight: 700, color: r.color }}>{r.label}</td>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--cyan)", fontWeight: 700 }}>{fmt(r.orders)}</td>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{Math.round((r.orders / total) * 100)}%</td>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--text-secondary)" }}>
                                  {r.weight != null && r.weight > 0 ? shortWeight(r.weight) : (r.ecomRow ? "N/A" : "—")}
                                </td>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--text-muted)" }}>
                                  {totalWeight > 0 && r.weight > 0 ? `${Math.round((r.weight / totalWeight) * 100)}%` : "—"}
                                </td>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: getOntimeColor(r.ontime), fontWeight: 600 }}>
                                  {r.ontime != null ? `${r.ontime}%${r.ontime < 80 ? " 🚨" : r.ontime < 90 ? " ⚠️" : ""}` : "—"}
                                </td>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: r.ecomRow ? "var(--text-muted)" : r.damage > 0 ? "var(--amber)" : "var(--text-muted)", fontWeight: r.ecomRow ? 400 : r.damage > 0 ? 700 : 400 }}>
                                  {r.ecomRow ? "N/A" : r.damage > 0 ? `${r.damage} ca` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

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

                {/* Client breakdown — per-industry (DM has damage col, NHC/STTP don't) */}
                {(() => {
                  const clientSections = [];
                  if (mapIndustry === "all") {
                    // Multi-section: one per industry with data in this province
                    const dmClients   = (provinceDetailsMap[shownProv] || provinceStats.find((p) => p.name === shownProv)?.details)?.clientDetails;
                    const nhcClients  = provinceStatsNhc?.find((p) => p.name === shownProv)?.details?.clientDetails;
                    const sttpClients = provinceStatsSttp?.find((p) => p.name === shownProv)?.details?.clientDetails;
                    const ecomClients = provinceStatsEcom?.find((p) => p.name === shownProv)?.details?.clientDetails;
                    if (dmClients?.length)   clientSections.push({ label: "🟠 Khách ĐM",   color: "var(--amber)",       clients: dmClients,   showDmg: true });
                    if (nhcClients?.length)  clientSections.push({ label: "🟣 Khách NHC",  color: "#a78bfa",             clients: nhcClients,  showDmg: false });
                    if (sttpClients?.length) clientSections.push({ label: "🔵 Khách STTP", color: "#38bdf8",             clients: sttpClients, showDmg: false });
                    if (ecomClients?.length) clientSections.push({ label: "🟤 Khách ECOM", color: "rgba(139,90,43,0.9)", clients: ecomClients, showDmg: false });
                  } else if (inspectData.clientDetails?.length) {
                    const isDm = mapIndustry === "dm";
                    clientSections.push({ label: `🏢 Khách hàng giao khu vực ${inspectData.name} (${inspectData.clientDetails.length})`, color: null, clients: inspectData.clientDetails, showDmg: isDm });
                  }
                  if (!clientSections.length) return null;
                  return (
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      {clientSections.map((sec) => (
                        <div key={sec.label}>
                          <div style={{ ...SECTION_LABEL, color: sec.color || undefined }}>{sec.label}</div>
                          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                            <table className="data-table" style={{ fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th style={{ padding: "5px 8px" }}>Khách</th>
                                  <th style={{ padding: "5px 8px", textAlign: "right" }}>Đơn</th>
                                  <th style={{ padding: "5px 8px", textAlign: "right" }}>Ontime</th>
                                  {sec.showDmg && <th style={{ padding: "5px 8px", textAlign: "right" }}>Hỏng</th>}
                                  <th style={{ padding: "5px 8px" }}>Lấy tại</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sec.clients.map((c) => (
                                  <tr key={c.name}>
                                    <td style={{ padding: "4px 8px", fontWeight: 600 }}>{c.name}</td>
                                    <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--cyan)", fontWeight: 700 }}>{fmt(c.orders)}</td>
                                    <td style={{ padding: "4px 8px", textAlign: "right", color: getOntimeColor(c.ontimePct), fontWeight: 600 }}>
                                      {c.ontimePct}%{c.ontimePct < 80 ? " 🚨" : c.ontimePct < 90 ? " ⚠️" : ""}
                                    </td>
                                    {sec.showDmg && (
                                      <td style={{ padding: "4px 8px", textAlign: "right", color: c.damageCount > 0 ? "var(--amber)" : "var(--text-muted)", fontWeight: c.damageCount > 0 ? 700 : 400 }}>
                                        {c.damageCount > 0 ? `${c.damageCount} ca` : "—"}
                                      </td>
                                    )}
                                    <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 11 }}>{c.mainOrigin}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

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
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{showWh ? "🔍 Chi tiết tỉnh / kho" : "🔍 Chi tiết tỉnh"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: singleProjectMode ? 12 : 10 }}>
                  💡 Rê vào tỉnh hoặc kho để xem nhanh; bấm để giữ chi tiết — có đơn, on-time, tuyến lấy, khách hàng và nút xem danh sách.
                </div>

                {/* InsightPanel — điểm yếu vận hành (chỉ hiện cho chế độ toàn dự án) */}
                {!singleProjectMode && (nearCapWarehouses.length > 0 || lowOntimeProvsInsight.length > 0 || nearCapProvsInsight.length > 0) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                    {showWh && nearCapWarehouses.length > 0 && (
                      <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--amber)", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={SECTION_LABEL}>⚡ Kho {mapIndustry === "nhc" ? "NHC" : mapIndustry === "sttp" ? "STTP" : mapIndustry === "all" ? "tổng 4 ngành" : "ĐM"} gần vượt GTC cap</div>
                        {nearCapWarehouses.map((d) => (
                          <button key={d.id} onClick={() => selectWhAndFly(d)} style={{
                            display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, marginBottom: 3,
                            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "1px 0",
                          }}>
                            <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0, textAlign: "left" }}>• {d.label}</span>
                            <span style={{ fontWeight: 700, marginLeft: 8, whiteSpace: "nowrap",
                              color: d.utilPct >= 100 ? "var(--red)" : d.utilPct >= 80 ? "var(--amber)" : "var(--text-primary)" }}>
                              {d.utilPct}% tải
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {lowOntimeProvsInsight.length > 0 && (
                      <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--red)", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={SECTION_LABEL}>🚨 Tỉnh ontime thấp — ĐM{mapIndustry !== "dm" ? " (tham chiếu)" : ""}</div>
                        {lowOntimeProvsInsight.map((p) => (
                          <button key={p.name} onClick={() => selectAndFly(p.name)} style={{
                            display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, marginBottom: 3,
                            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "1px 0",
                          }}>
                            <span style={{ color: "var(--text-secondary)", textAlign: "left" }}>• {p.name}</span>
                            <span style={{ fontWeight: 700, color: getOntimeColor(p.ontimePct) }}>{p.ontimePct}%</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {mapIndustry === "all" && nearCapProvsInsight.length > 0 && (
                      <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--red)", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={SECTION_LABEL}>📊 Tỉnh gần vượt năng lực kho (tổng 4 ngành)</div>
                        {nearCapProvsInsight.map((p) => (
                          <button key={p.name} onClick={() => selectAndFly(p.name)} style={{
                            display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, marginBottom: 3,
                            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "1px 0",
                          }}>
                            <span style={{ color: "var(--text-secondary)", textAlign: "left" }}>• {p.name}</span>
                            <span style={{ fontWeight: 700,
                              color: p.pct >= 100 ? "var(--red)" : p.pct >= 80 ? "var(--amber)" : "var(--text-primary)" }}>
                              {p.pct}%
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {showWh && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    🏭 Rê hoặc bấm chấm kho để xem tổng tải + phần {mapIndustry === "nhc" ? "NHC (chấm tím)" : mapIndustry === "sttp" ? "STTP (chấm xanh)" : mapIndustry === "all" ? "tổng 4 ngành (chấm xanh lá)" : "Điện máy (chấm cam)"}. Phóng to để tách kho gần nhau.
                  </div>
                )}

                {/* AI per-tab analysis — only in full-project view */}
                {!singleProjectMode && (
                  <MapTabAIPanel
                    mapIndustry={mapIndustry}
                    provinceStats={provinceStats}
                    provinceStatsNhc={provinceStatsNhc}
                    provinceStatsSttp={provinceStatsSttp}
                    provinceStatsEcom={provinceStatsEcom}
                    provinceDetailsMap={provinceDetailsMap}
                    nearCapWarehouses={nearCapWarehouses}
                    lowOntimeProvsInsight={lowOntimeProvsInsight}
                    nearCapProvsInsight={nearCapProvsInsight}
                  />
                )}

                {singleProjectMode && projectOverview && (
                  <>
                    {/* ② So sánh cùng kỳ */}
                    {pcProject && (pcProject.ordersDeltaPct != null || pcProject.ontimeDeltaPoints != null) && (
                      <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                        <div style={SECTION_LABEL}>📊 So sánh cùng kỳ ({periodComparison?.periodMode === "mtd" ? "MTD" : "tuần"})</div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                          {pcProject.ordersDeltaPct != null && (
                            <div>
                              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Sản lượng đơn</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: pcProject.ordersDeltaPct > 5 ? "var(--green)" : pcProject.ordersDeltaPct < -5 ? "var(--red)" : "var(--amber)" }}>
                                {pcProject.ordersDeltaPct > 0 ? "▲" : "▼"} {Math.abs(pcProject.ordersDeltaPct).toFixed(1)}%
                              </div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{fmt(pcProject.prev?.orders || 0)} → {fmt(pcProject.cur?.orders || 0)}</div>
                            </div>
                          )}
                          {pcProject.ontimeDeltaPoints != null && (
                            <div>
                              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Ontime</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: pcProject.ontimeDeltaPoints >= 0 ? "var(--green)" : pcProject.ontimeDeltaPoints < -5 ? "var(--red)" : "var(--amber)" }}>
                                {pcProject.ontimeDeltaPoints >= 0 ? "▲" : "▼"} {Math.abs(pcProject.ontimeDeltaPoints).toFixed(1)} điểm
                              </div>
                            </div>
                          )}
                          {pcProject.damageDeltaPct != null && pcProject.damageDeltaPct !== 0 && (
                            <div>
                              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Bể vỡ</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: pcProject.damageDeltaPct > 0 ? "var(--red)" : "var(--green)" }}>
                                {pcProject.damageDeltaPct > 0 ? "▲" : "▼"} {Math.abs(pcProject.damageDeltaPct).toFixed(0)}%
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ③ Ontime tốt / tệ */}
                    {(provForOntime.best.length > 0 || provForOntime.worst.length > 0) && (
                      <div className="grid-2" style={{ gap: 8, marginBottom: 10 }}>
                        {provForOntime.best.length > 0 && (
                          <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--green)", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={SECTION_LABEL}>✅ Tỉnh ontime tốt nhất</div>
                            {provForOntime.best.map((p) => (
                              <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 2 }}>
                                <span style={{ color: "var(--text-secondary)" }}>• {p.name}</span>
                                <b style={{ color: "var(--green)" }}>{p.ontimePct}%</b>
                              </div>
                            ))}
                          </div>
                        )}
                        {provForOntime.worst.length > 0 && (
                          <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--red)", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={SECTION_LABEL}>🚨 Cần cải thiện</div>
                            {provForOntime.worst.map((p) => (
                              <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 2 }}>
                                <span style={{ color: "var(--text-secondary)" }}>• {p.name}</span>
                                <b style={{ color: getOntimeColor(p.ontimePct) }}>{p.ontimePct}%</b>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ④ Bể vỡ */}
                    {dmgProvinces.length > 0 && (
                      <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--amber)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                        <div style={SECTION_LABEL}>💥 Tỉnh có bể vỡ ({projectOverview.damageCount} ca tổng)</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {dmgProvinces.map((p) => (
                            <span key={p.name} style={{ fontSize: 11, background: "rgba(245,158,11,0.12)", border: "1px solid var(--amber)", borderRadius: 4, padding: "2px 7px", color: "var(--amber)", fontWeight: 600 }}>
                              {p.name}: {p.count} ca
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ⑤ Điểm lấy hàng + top tỉnh (existing) */}
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

                    {/* ⑥ Project Trend Insight */}
                    {(pcProject || provForOntime.worst.length > 0 || dmgProvinces.length > 0) && (
                      <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--cyan)", borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
                        <div style={SECTION_LABEL}>📊 Nhận định nhanh dự án</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                          {pcProject?.ontimeDeltaPoints != null && (
                            <div style={{ fontSize: 11.5 }}>
                              <span style={{ fontWeight: 600, color: pcProject.ontimeDeltaPoints >= 0 ? "var(--green)" : "var(--red)" }}>
                                {pcProject.ontimeDeltaPoints >= 0 ? "▲" : "▼"} On-time {pcProject.ontimeDeltaPoints >= 0 ? "tăng" : "giảm"} {Math.abs(pcProject.ontimeDeltaPoints).toFixed(1)} điểm
                              </span>
                              {pcProject.cur?.ontimePct != null && pcProject.prev?.ontimePct != null && (
                                <span style={{ color: "var(--text-muted)" }}> ({pcProject.prev.ontimePct}% → {pcProject.cur.ontimePct}%)</span>
                              )}
                              <span style={{ color: "var(--text-muted)", fontSize: 10.5 }}>
                                {pcProject.ontimeDeltaPoints >= 2 ? " → Đang cải thiện tốt" : pcProject.ontimeDeltaPoints < -3 ? " → Cần xem lại vận hành" : " → Ổn định"}
                              </span>
                            </div>
                          )}
                          {dmgProvinces.length > 0 && (
                            <div style={{ fontSize: 11.5, color: "var(--amber)" }}>
                              💥 {dmgProvinces.length} tỉnh có bể vỡ · nặng nhất: <b>{dmgProvinces[0].name}</b> ({dmgProvinces[0].count} ca)
                              {pcProject?.damageDeltaPct != null && pcProject.damageDeltaPct > 0 && (
                                <span style={{ color: "var(--red)" }}> ▲ +{pcProject.damageDeltaPct.toFixed(0)}% so cùng kỳ</span>
                              )}
                            </div>
                          )}
                          {provForOntime.worst.length > 0 && (
                            <div style={{ fontSize: 11.5 }}>
                              <span style={{ color: "var(--text-muted)" }}>🚨 Tỉnh cần can thiệp: </span>
                              {provForOntime.worst.map((p, i) => (
                                <span key={p.name}>
                                  {i > 0 && <span style={{ color: "var(--text-muted)" }}> · </span>}
                                  <span
                                    onClick={() => selectAndFly(p.name)}
                                    style={{ cursor: "pointer", color: getOntimeColor(p.ontimePct), fontWeight: 600 }}
                                  >
                                    {p.name} ({p.ontimePct}%)
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {showWh && !singleProjectMode && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                🏭 Top 8 kho — {mapIndustry === "nhc" ? "NHC" : mapIndustry === "sttp" ? "STTP" : mapIndustry === "all" ? "4 ngành" : "ĐM"}/ng cao nhất · bấm để phóng tới
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
                          {fmt(d.dmG, 1)}
                          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 2 }}>
                            {mapIndustry === "nhc" ? "NHC" : mapIndustry === "sttp" ? "STTP" : mapIndustry === "all" ? "4ng" : "ĐM"}/ng
                          </span>
                          {d.totGtc > 0 && <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>({fmt(d.totGtc)} GTC)</span>}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showWh && !singleProjectMode && <UnplacedPanel layer={activeLayer} />}
        </div>
      </div>
    </div>
  );
}
export default React.memo(ProvinceMapPanel);
