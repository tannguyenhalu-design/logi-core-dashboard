/**
 * components/TabTachTrip.js — Bản đồ & Tách Chuyến LTL
 * Port từ dashboard_31.html — bao gồm:
 *   - Tầng 1: Bảng tuyến cố định (LANE_DATA, 81 lane)
 *   - Tầng 2: Bản đồ SVG Việt Nam tương tác + 3 Góc nhìn
 *     - Lens 4 (default): Tỉnh giao & đề xuất gom 2 ngày
 *     - Lens 3: Trục tuyến đường (multi-drop bin-packing)
 *     - Lens 2: Thành phố, gộp đa điểm
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import VietnamMap from "./VietnamMap";

// ── Static data (map paths — still static, not from GSheet) ─────────────────
import LANE_DATA from "../lib/lane-data.json";
// NOTE: tc-data.json removed — now using live GSheet data via tcData prop

// ── Constants (from dashboard_31.html) ──────────────────────────────────────
const TRUCK_5T = 5000000;
const MAX_STOPS = 3;
const DIRECT_THRESHOLD = 0.80;
const MIN_GROUP_PCT = 40;
const FTL_CLIENTS = new Set(["Aqua B2B", "LG Pantos"]);
const LENS3_COLORS = ["#33D6C0", "#5B8CFF", "#FFB23E", "#FF5D5D", "#9B7BFF", "#4ED98C"];

const ROUTES3 = {
  "Tây Nam Bộ": { order: ["Long An","Tiền Giang","Vĩnh Long","Cần Thơ","Hậu Giang","Sóc Trăng","Bạc Liêu","Cà Mau","Đồng Tháp","An Giang","Kiên Giang","Bến Tre","Trà Vinh"], hub: "Kho B2B Long An" },
  "Duyên hải Nam Trung Bộ": { order: ["Quảng Nam","Quảng Ngãi"], hub: "Kho GXT Đà Nẵng (Liên Chiểu)", note: "Đã loại Bình Định/Phú Yên/Khánh Hòa/Ninh Thuận/Bình Thuận — mỗi tỉnh <1% tải/ngày, quá xa để ghép chung" },
  "Bắc Trung Bộ": { order: ["Thừa Thiên Huế"], hub: "Kho GXT Đà Nẵng (Liên Chiểu)", note: "Huế đủ tải đi thẳng (52%); đã loại Quảng Trị/Quảng Bình/Hà Tĩnh/Nghệ An/Thanh Hóa" },
  "Đông Nam Bộ - Tây Nguyên": { order: ["Đồng Nai","Bình Dương","Bà Rịa - Vũng Tàu","Tây Ninh","Bình Phước","Đắk Nông","Đắk Lắk","Gia Lai","Kon Tum","Lâm Đồng"], hub: "Kho B2B Long An" },
  "Đông Bắc": { order: ["Hải Dương","Hải Phòng","Quảng Ninh","Bắc Ninh","Bắc Giang","Thái Bình","Nam Định","Ninh Bình","Hà Nam"], hub: "Kho B2B Hà Nội" },
  "Tây Bắc": { order: ["Vĩnh Phúc","Phú Thọ","Tuyên Quang","Yên Bái","Lào Cai","Hà Giang","Sơn La","Hòa Bình","Thái Nguyên","Lạng Sơn","Cao Bằng","Bắc Kạn","Lai Châu","Điện Biên"], hub: "Kho B2B Hà Nội" },
};

const HUB_TO_CITY = {
  "Kho B2B Long An": "Hồ Chí Minh",
  "Kho B2B Hà Nội": "Hà Nội",
  "Kho GXT Đà Nẵng (Liên Chiểu)": "Đà Nẵng",
};

// ── Utility ──────────────────────────────────────────────────────────────────
const fmt = (n) => Math.round(n).toLocaleString("vi-VN");
const fmtKg = (n) => (n / 1000000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " tấn";

// ── TC Data helpers — nhận tcData làm tham số ────────────────────────────────
function tcEpoch(tcData) {
  return new Date(tcData.epoch + "T00:00:00");
}

function tcMaxDay(tcData) {
  if (!tcData?.rows?.day?.length) return 0;
  return Math.max(...tcData.rows.day);
}

function tcFilteredIdx(tcData, windowDays, hubFilter) {
  if (!tcData?.rows?.day) return [];
  const maxDay = tcMaxDay(tcData);
  const start = maxDay - (windowDays - 1);
  const { day, hub } = tcData.rows;
  const idxs = [];
  for (let i = 0; i < day.length; i++) {
    if (day[i] < start || day[i] > maxDay) continue;
    if (hubFilter !== "__ALL__" && tcData.hubs[hub[i]] !== hubFilter) continue;
    idxs.push(i);
  }
  return idxs;
}

function tcAvgByProvince(tcData, idxs, windowDays) {
  const rows = tcData.rows;
  const sumByProv = {}, clientByProv = {}, pickByProv = {};
  idxs.forEach((i) => {
    const pv = tcData.provinces[rows.pv[i]];
    sumByProv[pv] = (sumByProv[pv] || 0) + rows.w[i];
    const cl = tcData.clients[rows.c[i]];
    clientByProv[pv] = clientByProv[pv] || {};
    clientByProv[pv][cl] = (clientByProv[pv][cl] || 0) + rows.w[i];
    const fp = tcData.fprovinces[rows.fp[i]];
    pickByProv[pv] = pickByProv[pv] || {};
    pickByProv[pv][fp] = (pickByProv[pv][fp] || 0) + rows.w[i];
  });
  const avg = {}, clients = {}, picks = {}, clientKg = {};
  Object.keys(sumByProv).forEach((pv) => {
    avg[pv] = sumByProv[pv] / windowDays;
    const ct = clientByProv[pv];
    const total = Object.values(ct).reduce((a, b) => a + b, 0);
    clients[pv] = Object.entries(ct).sort((a, b) => b[1] - a[1]).map(([name, w]) => ({ name, pct: total ? (w / total) * 100 : 0 }));
    const pt = pickByProv[pv];
    const ptotal = Object.values(pt).reduce((a, b) => a + b, 0);
    picks[pv] = Object.entries(pt).sort((a, b) => b[1] - a[1]).map(([name, w]) => ({ name, pct: ptotal ? (w / ptotal) * 100 : 0 }));
    clientKg[pv] = clientByProv[pv];
  });
  return { avg, clients, picks, clientKg };
}

function tcAvgByWarehouse(tcData, idxs, province, windowDays) {
  const rows = tcData.rows;
  const excludeWh = new Set(["Key Account Warehouse Ho Chi Minh", "Key Account Warehouse Ha Noi"]);
  const sumByWh = {}, daysSeenByWh = {};
  idxs.forEach((i) => {
    const pv = tcData.provinces[rows.pv[i]];
    if (pv !== province) return;
    const wh = tcData.warehouses[rows.wh[i]];
    if (!wh || excludeWh.has(wh) || wh.includes("TESTING")) return;
    sumByWh[wh] = (sumByWh[wh] || 0) + rows.w[i];
    daysSeenByWh[wh] = daysSeenByWh[wh] || new Set();
    daysSeenByWh[wh].add(rows.day[i]);
  });
  const minDaysSample = Math.max(3, Math.floor(windowDays * 0.15));
  return Object.keys(sumByWh)
    .filter((wh) => daysSeenByWh[wh].size >= minDaysSample)
    .map((wh) => [wh, sumByWh[wh] / windowDays])
    .sort((a, b) => b[1] - a[1]);
}

function multidrop(orderedItems, maxStops) {
  const direct = [], bundle = [];
  orderedItems.forEach(([name, w]) => {
    if (w / TRUCK_5T >= DIRECT_THRESHOLD) direct.push({ name, avg_kg_day: w, pct: (w / TRUCK_5T) * 100 });
    else bundle.push([name, w]);
  });
  const groups = [];
  let cur = [], curSum = 0;
  bundle.forEach(([name, w]) => {
    if (cur.length && (cur.length >= maxStops || curSum + w > TRUCK_5T * 1.05)) {
      groups.push(cur); cur = []; curSum = 0;
    }
    cur.push([name, w]); curSum += w;
  });
  if (cur.length) groups.push(cur);
  const md = groups.map((grp) => {
    let cum = 0;
    const stops = grp.map(([name, w]) => {
      cum += w;
      return { name, drop_kg: w, drop_pct: (w / TRUCK_5T) * 100, cumulative_pct: (cum / TRUCK_5T) * 100 };
    });
    return { stops, total_pct: (cum / TRUCK_5T) * 100 };
  });
  const mdFiltered = md.filter((g) => g.total_pct >= MIN_GROUP_PCT);
  return { direct, groups: mdFiltered, hiddenLowValueCount: md.length - mdFiltered.length };
}

// ── Priority Badge ────────────────────────────────────────────────────────────
function PriorityBadge({ priority }) {
  if (priority === "Pilot FTL thường xuyên")
    return <span title="Đủ tải để chạy riêng 1 xe tải mỗi ngày, không cần ghép hàng với tuyến khác" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(51,214,192,.15)", color: "#33D6C0", fontWeight: 600, cursor: "help" }}>Pilot FTL</span>;
  if (priority === "Lên lịch gom chuyến")
    return <span title="Chưa đủ tải mỗi ngày — nên gom nhiều ngày lại thành 1 chuyến để tiết kiệm chi phí" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(255,178,62,.15)", color: "#FFB23E", fontWeight: 600, cursor: "help" }}>Gom chuyến</span>;
  return <span title="Sản lượng còn thấp — chưa đủ cơ sở để đề xuất, tiếp tục theo dõi thêm" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(140,153,174,.15)", color: "#8C99AE", fontWeight: 600, cursor: "help" }}>Theo dõi</span>;
}

// ── Client chips ──────────────────────────────────────────────────────────────
function ClientChips({ clients, limit = 5 }) {
  if (!clients || !clients.length) return <span style={{ color: "#5A6478" }}>—</span>;
  return (
    <>
      {clients.slice(0, limit).map((c) => (
        <span key={c.name} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: "rgba(91,140,255,.12)", color: "#5B8CFF", marginRight: 4, display: "inline-block", marginBottom: 2 }}>
          {c.name} {c.pct.toFixed(0)}%
        </span>
      ))}
    </>
  );
}


// ── Multidrop Group Card ──────────────────────────────────────────────────────
function MultidropGroup({ group, idx, label = "Xe multi-drop" }) {
  const pct = group.total_pct;
  const pctColor = pct >= 90 ? "#33D6C0" : pct >= 60 ? "#FFB23E" : "#8C99AE";
  return (
    <div style={{ marginBottom: 14, padding: "12px 14px", background: "#1B2436", borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#8C99AE", marginBottom: 8 }}>
        {label} #{idx} — tổng tải <b style={{ color: pctColor }}>{pct.toFixed(0)}%</b>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {group.stops.map((s, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ background: "#0E1420", border: "1px solid #293345", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
              <b style={{ color: "#EAF0F8" }}>{s.name}</b><br />
              <span style={{ color: "#FFB23E", fontFamily: "monospace" }}>hạ {fmt(s.drop_kg)}g ({s.drop_pct.toFixed(0)}%)</span><br />
              <span style={{ color: "#8C99AE", fontSize: 10.5, fontFamily: "monospace" }}>luỹ kế {s.cumulative_pct.toFixed(0)}%</span>
            </div>
            {i < group.stops.length - 1 && <span style={{ color: "#8C99AE", fontSize: 16 }}>→</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── LENS 4: Tỉnh giao & đề xuất gom 2 ngày ───────────────────────────────────
function Lens4({ tcData, idxs, windowDays, hub }) {
  const [filterVal, setFilterVal] = useState("__ALL__");
  const [highlightProv, setHighlightProv] = useState(null);
  const [hoveredProv, setHoveredProv] = useState(null);
  const tableRef = useRef(null);

  const provStats = useMemo(() => tcAvgByProvince(tcData, idxs, windowDays), [tcData, idxs, windowDays]);

  const rows = useMemo(() => {
    let r = Object.entries(provStats.avg).map(([p, avgW]) => {
      const pct1 = (avgW / TRUCK_5T) * 100;
      const pct2 = (avgW * 2 / TRUCK_5T) * 100;
      let recommend;
      if (pct1 >= 60) recommend = "Đã đủ tải mỗi ngày";
      else if (pct1 < 60 && pct2 >= 70 && pct2 <= 130) recommend = "Nên gom 2 ngày & tách";
      else recommend = "Vẫn chưa đủ dù gom 2 ngày";
      const pickTop = (provStats.picks[p] || []).slice(0, 2);
      return { province: p, avgW, pct1, pct2, recommend, clients: provStats.clients[p] || [], pick: pickTop };
    });
    if (filterVal !== "__ALL__") r = r.filter((x) => x.recommend === filterVal);
    const order = { "Đã đủ tải mỗi ngày": 0, "Nên gom 2 ngày & tách": 1, "Vẫn chưa đủ dù gom 2 ngày": 2 };
    r.sort((a, b) => (order[a.recommend] - order[b.recommend]) || b.pct1 - a.pct1);
    return r;
  }, [provStats, filterVal]);

  const colorMap = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      if (r.province === hoveredProv) {
        m[r.province] = "var(--cyan)"; // Glow cyan on hover
      } else if (r.province === highlightProv) {
        m[r.province] = "#ffffff"; // Highlight selected in white
      } else if (r.recommend === "Nên gom 2 ngày & tách") {
        m[r.province] = "#33D6C0";
      } else if (r.recommend === "Đã đủ tải mỗi ngày") {
        m[r.province] = "#5B8CFF";
      } else {
        m[r.province] = "#3A4458";
      }
    });
    return m;
  }, [rows, hoveredProv, highlightProv]);

  const hubLabel = hub === "__ALL__" ? "Tất cả 3 kho" : hub;

  const handleProvinceClick = (name) => {
    setHighlightProv(name);
    const el = tableRef.current?.querySelector(`[data-prov="${name}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.background = "rgba(51,214,192,.18)";
      setTimeout(() => { el.style.background = ""; }, 1500);
    }
  };

  const RecommendBadge = ({ rec }) => {
    if (rec === "Nên gom 2 ngày & tách")
      return <span title="Mỗi ngày chưa đủ 1 xe, nhưng gom 2 ngày lại thì vừa đủ tải" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(51,214,192,.15)", color: "#33D6C0", whiteSpace: "nowrap", cursor: "help" }}>Gom 2 ngày & tách</span>;
    if (rec === "Đã đủ tải mỗi ngày")
      return <span title="Tỉnh này đã đủ hàng để chạy xe riêng mỗi ngày, không cần gom" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(91,140,255,.15)", color: "#5B8CFF", whiteSpace: "nowrap", cursor: "help" }}>Đủ tải — đi thẳng</span>;
    return <span title="Dù gom 2 ngày cũng chưa đủ tải — cần gom lâu hơn hoặc ghép chung với tuyến khác" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(140,153,174,.15)", color: "#8C99AE", whiteSpace: "nowrap", cursor: "help" }}>Chưa đủ dù gom 2 ngày</span>;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 18, alignItems: "start" }}>
      {/* Left: map + legend */}
      <div style={{ position: "sticky", top: 80, alignSelf: "start" }}>
        <VietnamMap colorMap={colorMap} onProvinceClick={handleProvinceClick} />
        <div style={{ marginTop: 10, fontSize: 11.5, color: "#8C99AE", lineHeight: 1.6, padding: 10, background: "#1B2436", borderRadius: 8 }}>
          <b style={{ color: "#33D6C0" }}>🟢 Gom 2 ngày & tách</b> — 70-130% tải<br />
          <b style={{ color: "#5B8CFF" }}>🔵 Đủ tải mỗi ngày</b> — đi thẳng ngay<br />
          <b style={{ color: "#5A6478" }}>⚪ Chưa đủ</b> — gom lâu hơn hoặc ghép LTL<br />
          <span style={{ fontSize: 10.5 }}>Bấm vào tỉnh trên bản đồ → nhảy tới dòng tương ứng</span>
        </div>
      </div>
      {/* Right: filter + table */}
      <div>
        <p style={{ fontSize: 12, color: "#8C99AE", marginBottom: 12 }}>
          Kho xuất phát: <b style={{ color: "#33D6C0" }}>{hubLabel}</b> · TB kg/ngày <b>{windowDays} ngày gần nhất</b> · chỉ đơn GTC · đã loại Aqua B2B + LG Pantos.
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#8C99AE", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 5 }}>Lọc đề xuất</label>
          <select
            value={filterVal}
            onChange={(e) => setFilterVal(e.target.value)}
            style={{ background: "#0E1420", border: "1px solid #293345", color: "#EAF0F8", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" }}
          >
            <option value="__ALL__">Tất cả tỉnh</option>
            <option value="Nên gom 2 ngày & tách">🟢 Nên gom 2 ngày & tách</option>
            <option value="Đã đủ tải mỗi ngày">🔵 Đã đủ tải mỗi ngày</option>
            <option value="Vẫn chưa đủ dù gom 2 ngày">⚪ Vẫn chưa đủ dù gom 2 ngày</option>
          </select>
        </div>
        <div style={{ maxHeight: 600, overflowY: "auto" }} ref={tableRef}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["Kho xuất phát", "Tỉnh giao", "Khách hàng chính", "% tải/ngày", "% nếu gom 2 ngày", "Đề xuất"].map((h) => (
                  <th key={h} style={{ textAlign: "left", color: "#8C99AE", fontWeight: 500, padding: "8px 10px", borderBottom: "1px solid #293345", textTransform: "uppercase", fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const originText = r.pick.map((p) => `${p.name} ${p.pct.toFixed(0)}%`).join(", ") || hubLabel;
                const show2day = r.recommend === "Đã đủ tải mỗi ngày"
                  ? <span style={{ color: "#5A6478" }}>— đã đủ tải</span>
                  : `${r.pct2.toFixed(0)}%`;
                const isHovered = hoveredProv === r.province;
                const isSelected = highlightProv === r.province;
                return (
                  <tr
                    key={r.province}
                    data-prov={r.province}
                    style={{
                      transition: "background 0.2s, color 0.2s",
                      cursor: "pointer",
                      background: isHovered ? "rgba(6, 182, 212, 0.08)" : isSelected ? "rgba(255,255,255,0.04)" : "",
                      borderLeft: isHovered ? "2px solid var(--cyan)" : isSelected ? "2px solid #ffffff" : "2px solid transparent",
                    }}
                    onMouseEnter={() => setHoveredProv(r.province)}
                    onMouseLeave={() => setHoveredProv(null)}
                    onClick={() => handleProvinceClick(r.province)}
                  >
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #293345", fontSize: 11.5, color: "#8C99AE" }}>{originText}</td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #293345" }}><b>{r.province}</b></td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #293345", maxWidth: 200 }}><ClientChips clients={r.clients} limit={3} /></td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #293345", fontFamily: "monospace" }}>{r.pct1.toFixed(0)}%</td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #293345", fontFamily: "monospace" }}>{show2day}</td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #293345" }}><RecommendBadge rec={r.recommend} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, padding: "10px 14px", fontSize: 12, background: "linear-gradient(135deg, rgba(91,140,255,.08), rgba(51,214,192,.05))", border: "1px solid #1B6E64", borderRadius: 10 }}>
          🟢 = gom 2 ngày đạt 70-130% tải → tách chuyến riêng cứ 2 ngày/lần.<br />
          🔵 = bản thân đã đủ/vượt tải mỗi ngày → đi thẳng ngay.<br />
          ⚪ = dù gom 2 ngày cũng chưa đủ tải → gom lâu hơn hoặc tiếp tục ghép LTL.
        </div>
      </div>
    </div>
  );
}

// ── LENS 3: Trục tuyến đường ──────────────────────────────────────────────────
function Lens3({ tcData, idxs, windowDays, hub }) {
  const [corridorFilter, setCorridorFilter] = useState("__ALL__");
  const [hoveredCorridor, setHoveredCorridor] = useState(null);

  const provStats = useMemo(() => tcAvgByProvince(tcData, idxs, windowDays, null), [tcData, idxs, windowDays]);

  const corridorResults = useMemo(() => {
    const results = {};
    let colorIdx = 0;
    for (const [name, info] of Object.entries(ROUTES3)) {
      if (hub !== "__ALL__" && info.hub !== hub) { colorIdx++; continue; }
      const items = info.order.map((p) => [p, provStats.avg[p] || 0]);
      const md = multidrop(items, MAX_STOPS);
      results[name] = { ...md, hub: info.hub, note: info.note, color: LENS3_COLORS[colorIdx % LENS3_COLORS.length], provStats };
      colorIdx++;
    }
    return results;
  }, [provStats, hub]);

  const corridorGroups = useMemo(() => {
    const cg = {};
    for (const [name, res] of Object.entries(corridorResults)) {
      if (corridorFilter !== "__ALL__" && name !== corridorFilter) continue;
      cg[name] = { direct: res.direct, groups: res.groups, hub: res.hub, color: res.color };
    }
    return cg;
  }, [corridorResults, corridorFilter]);

  const visibleCorridors = useMemo(() => {
    return Object.entries(ROUTES3).filter(([name, info]) => {
      if (hub !== "__ALL__" && info.hub !== hub) return false;
      if (corridorFilter !== "__ALL__" && name !== corridorFilter) return false;
      return corridorResults[name];
    });
  }, [corridorResults, hub, corridorFilter]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 18, alignItems: "start" }}>
      <div style={{ position: "sticky", top: 80, alignSelf: "start" }}>
        <VietnamMap corridorGroups={corridorGroups} hoveredCorridor={hoveredCorridor} />
      </div>
      <div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#8C99AE", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Lọc theo trục</label>
          <select value={corridorFilter} onChange={(e) => setCorridorFilter(e.target.value)}
            style={{ background: "#0E1420", border: "1px solid #293345", color: "#EAF0F8", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" }}>
            <option value="__ALL__">Tất cả 6 trục</option>
            {Object.keys(ROUTES3).map((c) => <option key={c} value={c}>Trục {c}</option>)}
          </select>
        </div>
        {visibleCorridors.map(([name, info]) => {
          const res = corridorResults[name];
          if (!res) return null;
          const { direct, groups, hiddenLowValueCount } = res;
          const clientAgg = {};
          info.order.forEach((p) => {
            const m = provStats.clientKg?.[p] || {};
            Object.entries(m).forEach(([cl, kg]) => { clientAgg[cl] = (clientAgg[cl] || 0) + kg; });
          });
          const clientTop = Object.entries(clientAgg).sort((a, b) => b[1] - a[1]).slice(0, 5);
          const clientTotal = Object.values(clientAgg).reduce((a, b) => a + b, 0) || 1;

          return (
            <div key={name} style={{ marginBottom: 18 }}
              onMouseEnter={() => setHoveredCorridor(name)}
              onMouseLeave={() => setHoveredCorridor(null)}>
              <h4 style={{ fontSize: 13, color: "#9B7BFF", margin: "0 0 8px" }}>
                Trục {name} <span style={{ color: "#8C99AE", fontWeight: 400 }}>(xuất phát {info.hub})</span>
              </h4>
              {clientTop.length > 0 && (
                <p style={{ fontSize: 11.5, color: "#8C99AE", margin: "0 0 10px" }}>
                  Khách hàng chính:{" "}
                  <ClientChips clients={clientTop.map(([n, kg]) => ({ name: n, pct: (kg / clientTotal) * 100 }))} limit={5} />
                </p>
              )}
              {direct.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "#8C99AE" }}>Tỉnh đủ tải, đi thẳng riêng (≥80%):</span><br />
                  {direct.map((d) => (
                    <span key={d.name} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(91,140,255,.15)", color: "#5B8CFF", marginRight: 4, marginTop: 4, display: "inline-block" }}>
                      {d.name}: {d.pct.toFixed(0)}%
                    </span>
                  ))}
                </div>
              )}
              {groups.map((g, i) => <MultidropGroup key={i} group={g} idx={i + 1} label="Xe multi-drop" />)}
              {hiddenLowValueCount > 0 && (
                <p style={{ fontSize: 11, color: "#5A6478", margin: "0 0 10px" }}>
                  (Đã ẩn {hiddenLowValueCount} cụm dưới 40% tải vì chưa đủ ý nghĩa để đề xuất tách)
                </p>
              )}
              {info.note && (
                <p style={{ fontSize: 11.5, color: "#5A6478", background: "rgba(255,255,255,.04)", padding: "8px 10px", borderRadius: 6, marginBottom: 10 }}>
                  ℹ️ {info.note}
                </p>
              )}
              {!direct.length && !groups.length && (
                <p style={{ color: "#5A6478", fontSize: 12 }}>Không đủ dữ liệu trong {windowDays} ngày gần nhất.</p>
              )}
            </div>
          );
        })}
        <p style={{ fontSize: 11.5, color: "#5A6478", borderTop: "1px solid #293345", paddingTop: 10 }}>
          ⚠️ TB kg/ngày tính theo {windowDays} ngày gần nhất · di chuột vào 1 trục để bản đồ highlight đúng trục đó.
        </p>
      </div>
    </div>
  );
}

// ── LENS 2: Thành phố, gộp đa điểm ───────────────────────────────────────────
function Lens2({ tcData, idxs, windowDays, hub }) {
  const [cityFilter, setCityFilter] = useState("__ALL__");
  const cities = ["Hồ Chí Minh", "Hà Nội", "Đà Nẵng"];

  const visibleCities = useMemo(() => {
    if (cityFilter !== "__ALL__") return [cityFilter];
    if (hub !== "__ALL__") return [HUB_TO_CITY[hub]].filter(Boolean);
    return cities;
  }, [cityFilter, hub]);

  const provStats = useMemo(() => tcAvgByProvince(tcData, idxs, windowDays), [tcData, idxs, windowDays]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 18, alignItems: "start" }}>
      <div style={{ position: "sticky", top: 80, alignSelf: "start" }}>
        <VietnamMap highlightProvinces={visibleCities} />
      </div>
      <div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#8C99AE", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Lọc theo thành phố</label>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}
            style={{ background: "#0E1420", border: "1px solid #293345", color: "#EAF0F8", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" }}>
            <option value="__ALL__">Tất cả thành phố</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <p style={{ fontSize: 12, color: "#8C99AE", marginBottom: 16 }}>
          Kho sort: <b style={{ color: "#33D6C0" }}>{hub === "__ALL__" ? "Tất cả 3 kho" : hub}</b> · TB kg/ngày <b>{windowDays} ngày</b> · kho ≥80% tải đi thẳng riêng, còn lại ghép multi-drop tối đa 3 điểm.
        </p>
        {visibleCities.map((city) => {
          const items = tcAvgByWarehouse(tcData, idxs, city, windowDays);
          const { direct, groups } = multidrop(items, MAX_STOPS);
          const cityClients = provStats.clients[city] || [];
          return (
            <div key={city} style={{ marginBottom: 24 }}>
              <h4 style={{ fontSize: 13, color: "#33D6C0", margin: "0 0 10px" }}>{city}</h4>
              <p style={{ fontSize: 11.5, color: "#8C99AE", margin: "0 0 10px" }}>
                Khách hàng chính: <ClientChips clients={cityClients} limit={5} />
              </p>
              {direct.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "#8C99AE" }}>Kho đủ tải, đi thẳng riêng:</span><br />
                  {direct.map((d) => (
                    <span key={d.name} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(91,140,255,.15)", color: "#5B8CFF", marginRight: 4, marginTop: 4, display: "inline-block" }}>
                      {d.name}: {d.pct.toFixed(0)}%
                    </span>
                  ))}
                </div>
              )}
              {groups.map((g, i) => <MultidropGroup key={i} group={g} idx={i + 1} label="Xe multi-drop" />)}
              {!direct.length && !groups.length && (
                <p style={{ color: "#5A6478", fontSize: 12 }}>Không đủ dữ liệu trong {windowDays} ngày gần nhất.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TabTachTrip({ tcData }) {
  if (!tcData || !tcData.rows?.day?.length) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#5A6478" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
        <div style={{ fontSize: 14 }}>Đang tải dữ liệu Tách chuyến từ Google Sheets...</div>
      </div>
    );
  }
  const [lanePriorityFilter, setLanePriorityFilter] = useState("__ALL__");
  const [hub, setHub] = useState("__ALL__");
  const [lens, setLens] = useState("lens4");
  const [windowDays, setWindowDays] = useState(30);
  const [volumeMultiplier, setVolumeMultiplier] = useState(1.0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLaneTable, setShowLaneTable] = useState(false);

  const HUBS = [
    { value: "__ALL__", label: "🏭 Tất cả 3 kho" },
    { value: "Kho B2B Long An", label: "🟠 Kho B2B Long An" },
    { value: "Kho B2B Hà Nội", label: "🔵 Kho B2B Hà Nội" },
    { value: "Kho GXT Đà Nẵng (Liên Chiểu)", label: "🟢 Kho GXT Đà Nẵng" },
  ];

  const LENSES = [
    { value: "lens4", label: "Theo Tỉnh — đề xuất gom 2 ngày" },
    { value: "lens3", label: "Theo Tuyến — ghép nhiều điểm dừng" },
    { value: "lens2", label: "Theo Thành Phố — gộp đa điểm" },
  ];

  // Giả lập dữ liệu dựa trên hệ số sản lượng (What-If Simulation)
  const activeTcData = useMemo(() => {
    if (!tcData) return null;
    if (volumeMultiplier === 1.0) return tcData;

    // Nhân khối lượng đơn hàng thô
    const simulatedRows = {
      ...tcData.rows,
      w: tcData.rows.w.map((weight) => weight * volumeMultiplier),
    };

    // Recalculate lane metrics (avg_kg_day, peak_kg_day, priorities)
    const THRESHOLD_FTL = 1000000;
    const THRESHOLD_GOM = 500000;
    const MIN_ACTIVE_DAYS = 20;

    const simulatedLaneData = (tcData.laneData || []).map((lane) => {
      const avg_kg_day = Math.round(lane.avg_kg_day * volumeMultiplier);
      const peak_kg_day = Math.round(lane.peak_kg_day * volumeMultiplier);
      const kg30d = Math.round(lane.kg30d * volumeMultiplier);

      let priority;
      if (avg_kg_day >= 1000 && lane.days_active >= MIN_ACTIVE_DAYS) {
        priority = "Pilot FTL thường xuyên";
      } else if (avg_kg_day >= 500) {
        priority = "Lên lịch gom chuyến";
      } else {
        priority = "Theo dõi ngày cao điểm";
      }

      return {
        ...lane,
        kg30d,
        avg_kg_day,
        peak_kg_day,
        priority,
      };
    });

    return {
      ...tcData,
      laneData: simulatedLaneData,
      rows: simulatedRows,
    };
  }, [tcData, volumeMultiplier]);

  // Lane table data — live hoặc simulated
  const liveLanes = activeTcData?.laneData || [];
  const laneRows = useMemo(() => {
    let rows = liveLanes;
    if (lanePriorityFilter !== "__ALL__") rows = rows.filter((r) => r.priority === lanePriorityFilter);
    const order = { "Pilot FTL thường xuyên": 0, "Lên lịch gom chuyến": 1, "Theo dõi ngày cao điểm": 2 };
    return [...rows].sort((a, b) => (order[a.priority] - order[b.priority]) || (b.kg30d - a.kg30d));
  }, [liveLanes, lanePriorityFilter]);

  // TC filtered indices (live từ GSheet hoặc simulated)
  const idxs = useMemo(() => tcFilteredIdx(activeTcData, windowDays, hub), [activeTcData, windowDays, hub]);

  // Plain-language summary for newcomers — no jargon, just the headline numbers.
  const summary = useMemo(() => {
    const pilotCount = liveLanes.filter((r) => r.priority === "Pilot FTL thường xuyên").length;
    const gomCount = liveLanes.filter((r) => r.priority === "Lên lịch gom chuyến").length;
    return { pilotCount, gomCount, provinceCount: tcData.provinces?.length || 0 };
  }, [liveLanes, tcData]);

  const panelStyle = {
    background: "#141C2B",
    border: "1px solid #293345",
    borderRadius: 10,
    padding: "18px 20px",
    marginBottom: 16,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* ── Plain-language summary ── */}
      <div style={{
        ...panelStyle,
        borderLeft: "3px solid var(--green)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
      }}>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Đang giao tới <b style={{ color: "#fff" }}>{summary.provinceCount} tỉnh/thành</b>.{" "}
          <b style={{ color: "var(--cyan)" }}>{summary.pilotCount} tuyến</b> đã đủ tải chạy xe riêng mỗi ngày.{" "}
          <b style={{ color: "var(--amber)" }}>{summary.gomCount} tuyến</b> nên gom lại vài ngày một chuyến để tiết kiệm chi phí.
        </p>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
            background: showAdvanced ? "rgba(20,224,196,0.15)" : "rgba(255,255,255,0.05)",
            border: "1px solid var(--border)", color: showAdvanced ? "var(--cyan)" : "#fff",
            padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          🔧 Tùy chọn nâng cao {showAdvanced ? "▴" : "▾"}
        </button>
      </div>

      {/* ── What-If Simulation Control Panel (advanced only) ── */}
      {showAdvanced && (
      <div style={{
        ...panelStyle,
        borderLeft: "3px solid var(--cyan)",
        background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, rgba(20, 224, 196, 0.02) 100%)",
        boxShadow: "0 8px 32px 0 rgba(6, 182, 212, 0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h3 style={{ fontSize: 14, margin: "0 0 4px", color: "var(--cyan)", display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <span>🔮</span> Giả lập Sản lượng Vận hành (What-If Simulation)
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
              Kéo thanh trượt để tăng/giảm khối lượng hàng LTL. Hệ thống tự động tính toán lại mức gom và điểm hòa vốn FTL.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, background: "rgba(0,0,0,0.2)", padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Sản lượng LTL:</span>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={volumeMultiplier}
              onChange={(e) => setVolumeMultiplier(parseFloat(e.target.value))}
              style={{ width: 140, cursor: "pointer", accentColor: "var(--cyan)" }}
            />
            <span style={{
              fontSize: 13,
              fontFamily: "monospace",
              fontWeight: 700,
              color: volumeMultiplier === 1.0 ? "var(--text-primary)" : volumeMultiplier > 1.0 ? "var(--green)" : "var(--red)"
            }}>
              {Math.round(volumeMultiplier * 100)}% {volumeMultiplier === 1.0 ? "" : volumeMultiplier > 1.0 ? "📈" : "📉"}
            </span>
            {volumeMultiplier !== 1.0 && (
              <button
                onClick={() => setVolumeMultiplier(1.0)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  borderRadius: 4,
                  color: "var(--text-secondary)",
                  fontSize: 11,
                  padding: "4px 8px",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
      )}
      {/* Tang 1: Tuyen co dinh */}
      <div style={{ ...panelStyle, borderLeft: "3px solid #5B8CFF" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 14, margin: "0 0 4px", fontFamily: "'Space Grotesk', sans-serif" }}>
            Chi tiết theo tuyến cố định (kho lấy - kho giao) — 30 ngày gần nhất
          </h3>
          <button
            onClick={() => setShowLaneTable((v) => !v)}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-secondary)",
              padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {showLaneTable ? "Thu gọn" : "Xem bảng chi tiết"}
          </button>
        </div>
        {!showLaneTable && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8, background: "rgba(51,214,192,.12)", color: "#33D6C0" }}>
              {liveLanes.filter(r => r.priority === "Pilot FTL thường xuyên").length} tuyến đủ tải chạy riêng mỗi ngày
            </span>
            <span style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8, background: "rgba(255,178,62,.12)", color: "#FFB23E" }}>
              {liveLanes.filter(r => r.priority === "Lên lịch gom chuyến").length} tuyến nên gom chuyến
            </span>
            <span style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8, background: "rgba(140,153,174,.12)", color: "#8C99AE" }}>
              {liveLanes.filter(r => r.priority === "Theo dõi ngày cao điểm").length} tuyến còn thấp, theo dõi thêm
            </span>
          </div>
        )}
        {showLaneTable && (
        <>
        <p style={{ fontSize: 12, color: "#8C99AE", margin: "0 0 6px" }}>
          Nguồn: <b style={{ color: "#33D6C0" }}>Google Sheets Raw (live)</b> · chỉ tính đơn status=delivered · đã loại Aqua B2B + LG Pantos
          · tổng <b>{liveLanes.length} lane</b> · cập nhật tự động theo data GSheet
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#8C99AE", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 5 }}>Lọc theo mức ưu tiên</label>
          <select value={lanePriorityFilter} onChange={(e) => setLanePriorityFilter(e.target.value)}
            style={{ background: "#0E1420", border: "1px solid #293345", color: "#EAF0F8", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" }}>
            <option value="__ALL__">Tất cả ({liveLanes.length} lane)</option>
            <option value="Pilot FTL thường xuyên">🟢 Pilot FTL thường xuyên ({liveLanes.filter(r=>r.priority==="Pilot FTL thường xuyên").length})</option>
            <option value="Lên lịch gom chuyến">🟡 Lên lịch gom chuyến ({liveLanes.filter(r=>r.priority==="Lên lịch gom chuyến").length})</option>
            <option value="Theo dõi ngày cao điểm">⚪ Theo dõi ngày cao điểm ({liveLanes.filter(r=>r.priority==="Theo dõi ngày cao điểm").length})</option>
          </select>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["Mức ưu tiên","Kho lấy","Kho giao","Tổng kg/30 ngày","TB kg/ngày","Đỉnh 1 ngày (kg)","Ngày FTL ≥1.000kg","Ngày gom ≥500kg","Ngày active","Đơn/30d","Khách hàng chính"].map((h) => (
                  <th key={h} style={{ textAlign:"left", color:"#8C99AE", fontWeight:500, padding:"8px 10px",
                    borderBottom:"1px solid #293345", textTransform:"uppercase", fontSize:11, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {laneRows.map((r, i) => (
                <tr key={i}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#1B2436"}
                  onMouseLeave={(e) => e.currentTarget.style.background = ""}
                  style={{ transition: "background 0.15s" }}>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345" }}><PriorityBadge priority={r.priority} /></td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", maxWidth:200, fontSize:12 }}>{r.pick_wh}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", maxWidth:200, fontSize:12 }}>{r.deliver_wh}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontFamily:"monospace" }}>{fmt(r.kg30d)}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontFamily:"monospace",
                    color: r.avg_kg_day >= 1000 ? "#33D6C0" : r.avg_kg_day >= 500 ? "#FFB23E" : "#8C99AE",
                    fontWeight: r.avg_kg_day >= 500 ? 600 : 400 }}>
                    {fmt(r.avg_kg_day)}
                  </td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontFamily:"monospace", color:"#8C99AE", fontSize:11.5 }}>{fmt(r.peak_kg_day)}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontFamily:"monospace" }}>{r.days_ftl1000}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontFamily:"monospace" }}>{r.days_gom500}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontFamily:"monospace" }}>{r.days_active}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontFamily:"monospace" }}>{r.orders30d}</td>
                  <td style={{ padding:"9px 10px", borderBottom:"1px solid #293345", fontSize:11.5, maxWidth:260 }}>{r.top_clients}</td>
                </tr>
              ))}
              {!laneRows.length && (
                <tr><td colSpan="11" style={{ padding:16, color:"#5A6478", textAlign:"center" }}>Không có lane nào trong mức ưu tiên đang lọc.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>

      {/* ── Tầng 2: Góc nhìn gom tuyến ── */}
      <div style={{ ...panelStyle, borderLeft: "3px solid #9B7BFF" }}>
        <h3 style={{ fontSize: 14, margin: "0 0 4px", fontFamily: "'Space Grotesk', sans-serif" }}>
          🧭 Góc nhìn gom tuyến — chọn cách nhìn phù hợp với cách bạn muốn vận hành
        </h3>
        <p style={{ fontSize: 12, color: "#8C99AE", margin: "0 0 14px" }}>
          Dữ liệu <b>live từ Google Sheets</b> (sheet Raw) · chỉ tính đơn status=delivered · đã loại Aqua B2B + LG Pantos · mỗi chuyến multi-drop tối đa 3 điểm dừng · tự động cập nhật khi data mới được đẩy vào GSheet
        </p>

        {/* Controls */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          {/* Hub selector */}
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8C99AE", marginBottom: 6 }}>📦 Kho xuất phát (B2B Sort Hub)</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {HUBS.map((h) => (
                <button key={h.value} onClick={() => setHub(h.value)}
                  style={{
                    padding: "7px 14px", borderRadius: 6, border: "1px solid",
                    borderColor: hub === h.value ? "#33D6C0" : "#293345",
                    background: hub === h.value ? "rgba(51,214,192,.15)" : "#1B2436",
                    color: hub === h.value ? "#33D6C0" : "#EAF0F8",
                    fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                    transition: "all 0.2s"
                  }}>
                  {h.label}
                </button>
              ))}
            </div>
          </div>
          {/* Lens + window selectors (advanced only) */}
          {showAdvanced && (
          <>
          <div>
            <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8C99AE", display: "block", marginBottom: 5 }}>Cách xem</label>
            <select value={lens} onChange={(e) => setLens(e.target.value)}
              style={{ background: "#0E1420", border: "1px solid #293345", color: "#EAF0F8", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" }}>
              {LENSES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8C99AE", display: "block", marginBottom: 5 }}>Khoảng ngày</label>
            <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}
              style={{ background: "#0E1420", border: "1px solid #293345", color: "#EAF0F8", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" }}>
              <option value={7}>7 ngày</option>
              <option value={14}>14 ngày</option>
              <option value={30}>30 ngày</option>
              <option value={60}>60 ngày</option>
            </select>
          </div>
          </>
          )}
        </div>

        {/* Lens content — always Theo Tỉnh unless Nâng cao chọn cách khác */}
        <div style={{ minHeight: 300 }}>
          {(!showAdvanced || lens === "lens4") && <Lens4 tcData={tcData} idxs={idxs} windowDays={windowDays} hub={hub} />}
          {showAdvanced && lens === "lens3" && <Lens3 tcData={tcData} idxs={idxs} windowDays={windowDays} hub={hub} />}
          {showAdvanced && lens === "lens2" && <Lens2 tcData={tcData} idxs={idxs} windowDays={windowDays} hub={hub} />}
        </div>
      </div>
    </div>
  );
}
