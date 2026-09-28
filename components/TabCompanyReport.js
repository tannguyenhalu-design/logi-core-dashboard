/**
 * components/TabCompanyReport.js — "Báo cáo công ty" (Manager + SD3).
 * Pick the cadence (Tuần / 2 tuần / Tháng), the period and the clients, see
 * the three tables on screen exactly as they go into the Excel file, then
 * download or lock ("Chốt số") them — /api/report/biweekly.
 *
 * Client selection (user decision 2026-09-27): the company only looks at one
 * or a few key accounts, so every table can be limited to the chosen clients
 * and its total row ("Tổng khách đã chọn") adds up only them. "Mẫu đầy đủ"
 * keeps the original report layout. One lock per period; it stores the
 * selection it was made with, and the tab lists what changed since.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClientChannelSettings from "./ClientChannelSettings";

const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const TYPES = [["week", "Tuần"], ["biweekly", "2 tuần"], ["month", "Tháng"]];
const TYPE_LABEL = Object.fromEntries(TYPES);
const PICK_KEY = "companyReport.pickedClients";
const vnTime = (iso) => (iso
  ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—");
const label = (c) => (c === "DigiWorld" ? "Digiworld" : c);

function isoWeek(monday) {
  const d = new Date(monday + "T00:00:00Z");
  const thu = new Date(d.getTime() + 3 * DAY);
  const year = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const w1 = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  return { year, week: Math.round((d.getTime() - w1) / (7 * DAY)) + 1 };
}
function thisMonday() {
  const today = new Date(Date.now() + 7 * 3600 * 1000);
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
}
const fmtDM = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
// "2026-W39" → Monday "2026-09-21"
function mondayOfWeekKey(key) {
  const m = String(key).match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  return ymd(new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + (+m[2] - 1) * 7 * DAY));
}
// A "2 tuần" period is named after both of its weeks and the week it is
// reported in (user 27/09: reports go out in EVEN weeks and cover the two
// weeks before — "báo cáo tuần 40 = số tuần 38 - 39 (14/09 - 27/09)"),
// so a period always ends on an odd week: "Báo cáo W40 · W38–W39 (14/09 – 27/09)".
function twoWeekName(mon, withDates) {
  const prev = ymd(new Date(Date.parse(mon) - 7 * DAY));
  const report = isoWeek(ymd(new Date(Date.parse(mon) + 7 * DAY))).week;
  const name = `Báo cáo W${report} · W${isoWeek(prev).week}–W${isoWeek(mon).week}`;
  return withDates ? `${name} (${fmtDM(prev)} – ${fmtDM(ymd(new Date(Date.parse(mon) + 6 * DAY)))})` : name;
}
// Last completed ISO weeks, newest first (10 weeks, or the last 6
// odd-ending 2-week periods).
function recentWeeks(twoWeeks = false) {
  const base = thisMonday();
  const out = [];
  for (let i = 1; out.length < (twoWeeks ? 6 : 10); i++) {
    const mon = ymd(new Date(base - i * 7 * DAY));
    const { year, week } = isoWeek(mon);
    if (twoWeeks && week % 2 === 0) continue;
    if (twoWeeks && ymd(new Date(Date.parse(mon) - 7 * DAY)) < "2026-06-29") break; // before the data (07/2026)
    const value = `${year}-W${String(week).padStart(2, "0")}`;
    out.push({ value, label: twoWeeks ? twoWeekName(mon, true) : `W${week} (${fmtDM(mon)} – ${fmtDM(ymd(new Date(Date.parse(mon) + 6 * DAY)))})` });
  }
  return out;
}
// Months whose Monday-weeks have all ended (a month = weeks with Monday in it).
function recentMonths() {
  const lastDone = ymd(new Date(thisMonday() - 7 * DAY));
  const next = ymd(new Date(Date.parse(lastDone) + 7 * DAY));
  let key = next.slice(0, 7) !== lastDone.slice(0, 7) ? lastDone.slice(0, 7) : null;
  if (!key) { const d = new Date(lastDone + "T00:00:00Z"); key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); }
  const [y, m] = key.split("-").map(Number);
  return Array.from({ length: 6 }, (_, i) => {
    const k = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    return { value: k, label: `Tháng ${k.slice(5, 7)}/${k.slice(0, 4)}` };
  }).filter((o) => o.value >= "2026-07");
}
// The period still running today (user 27/09: "giữa tuần sếp bất chợt kêu
// báo cáo thì sao?") — listed first, numbers so far. Week: this week.
// 2 tuần: the odd-ending period that contains this week. Tháng: the month of
// this week's Monday (a month = the weeks whose Monday falls in it).
function liveOption(type) {
  const base = thisMonday();
  const mon = ymd(new Date(base));
  const key = (m) => { const { year, week } = isoWeek(m); return `${year}-W${String(week).padStart(2, "0")}`; };
  if (type === "month") { const k = mon.slice(0, 7); return { value: k, label: `Tháng ${k.slice(5, 7)}/${k.slice(0, 4)} · đang diễn ra`, live: true }; }
  if (type === "biweekly") {
    const end = isoWeek(mon).week % 2 === 1 ? mon : ymd(new Date(base + 7 * DAY));
    return { value: key(end), label: `${twoWeekName(end, true)} · đang diễn ra`, live: true };
  }
  return { value: key(mon), label: `W${isoWeek(mon).week} (${fmtDM(mon)} – ${fmtDM(ymd(new Date(base + 6 * DAY)))}) · đang diễn ra`, live: true };
}
const optionsFor = (type) => {
  const live = liveOption(type);
  const done = (type === "month" ? recentMonths() : recentWeeks(type === "biweekly")).filter((o) => o.value !== live.value);
  return [live, ...done];
};
// The usual report is the last finished period — the running one is opt-in.
const defaultPeriodFor = (type) => { const o = optionsFor(type); return (o.find((x) => !x.live) || o[0]).value; };
const isLive = (type, period) => liveOption(type).value === period;
const periodLabel = (type, period) => {
  const live = isLive(type, period) ? " · đang diễn ra" : "";
  if (type === "month") return `Tháng ${period.slice(5, 7)}/${period.slice(0, 4)}${live}`;
  const mon = mondayOfWeekKey(period);
  if (!mon) return period;
  return (type === "biweekly" ? twoWeekName(mon, true) : `W${isoWeek(mon).week}`) + live;
};

function readPicked() {
  try { const v = JSON.parse(localStorage.getItem(PICK_KEY) || "null"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function savePicked(list) {
  try { localStorage.setItem(PICK_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

const sameList = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const apiUrl = (type, period, clients, extra = "") =>
  `/api/report/biweekly?type=${type}&period=${encodeURIComponent(period)}${clients && clients.length ? `&clients=${encodeURIComponent(clients.join("|"))}` : ""}${extra}`;

const fmtPct = (v) => (v == null || v === "" ? "" : `${(v * 100).toFixed(1)}%`);
const fmtNum = (v) => (v === "" || v == null ? "" : Number(v).toLocaleString("vi-VN"));

// Same Δ as the Excel file: counts as % change, rates in percentage points.
function deltas(r, delta) {
  if (!delta) return null;
  const [a, b] = delta;
  const ca = Number(r.counts[a]), cb = Number(r.counts[b]);
  const ra = r.rates[a], rb = r.rates[b];
  return {
    count: !ca ? null : (cb - ca) / ca,
    rate: ra == null || rb == null ? null : (rb - ra) * 100,
  };
}

// Bể vỡ extras (user 27/09): every % shows its "cases/GTC" underneath (a
// small GTC makes one case look huge), and case counts are clickable to list
// the orders behind them (onPick(row, col | null) — null = whole row).
function ReportTable({ title, countTitle, rateTitle, sec, higherIsBetter, onPick, picked, pickHint, children }) {
  // Denominator row under each %: # đơn LTC (by pickup week, user 28/09); locks taken before 28/09 carry GTC.
  const denKey = sec.rows.some((r) => Array.isArray(r.ltc)) ? "ltc" : "gtc";
  const denName = denKey === "ltc" ? "LTC" : "GTC";
  const showGtc = sec.rows.some((r) => Array.isArray(r[denKey]));
  const cols = sec.cols;
  const hasDelta = !!sec.delta;
  const colLabel = (c) => (c.mature === false ? `${c.label}*` : c.label);
  // Biweekly two-week totals ("2 tuần trước" / "Kỳ này", user 28/09): name on
  // top, weeks below, a thin divider before the first one, "Kỳ này" bold.
  const firstSpan = cols.findIndex((c) => c.kind === "span");
  const head = (c) => (c.kind === "span"
    ? <>{c.sub}<div style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.85 }}>{colLabel(c)}</div></>
    : colLabel(c));
  const deltaHead = hasDelta ? (cols[sec.delta[0]].kind === "span" ? "± vs 2 tuần trước" : `± vs ${cols[sec.delta[0]].label}`) : "";
  const th = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12 };
  const td = { padding: "7px 10px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5, borderBottom: "1px solid var(--panel-border-soft)" };
  const sep = { borderLeft: "2px solid var(--border)" };
  const thin = { borderLeft: "1px dashed var(--border)" };
  const colStyle = (i) => ({ ...(i === 0 ? sep : i === firstSpan ? thin : {}), ...(cols[i].kind === "span" && cols[i].sub === "Kỳ này" ? { fontWeight: 700 } : {}) });
  return (
    <div className="glass" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--text-primary)" }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(15,124,123,0.9)", color: "#fff" }}>
              <th style={{ ...th, textAlign: "left" }} rowSpan={2}>Khách</th>
              <th style={{ ...th, textAlign: "center", ...sep }} colSpan={cols.length + (hasDelta ? 1 : 0)}>{countTitle}</th>
              <th style={{ ...th, textAlign: "center", ...sep }} colSpan={cols.length + (hasDelta ? 1 : 0)}>{rateTitle}</th>
            </tr>
            <tr style={{ background: "rgba(15,124,123,0.75)", color: "#fff" }}>
              {cols.map((c, i) => <th key={"c" + c.key} style={{ ...th, ...colStyle(i) }} title={c.range || ""}>{head(c)}</th>)}
              {hasDelta && <th style={th}>{deltaHead}</th>}
              {cols.map((c, i) => <th key={"r" + c.key} style={{ ...th, ...colStyle(i) }} title={c.range || ""}>{head(c)}</th>)}
              {hasDelta && <th style={th}>{deltaHead.replace("±", "± điểm")}</th>}
            </tr>
          </thead>
          <tbody>
            {sec.rows.map((r, k) => {
              const d = deltas(r, sec.delta);
              const tot = r.total ? { background: "rgba(15,124,123,0.18)", fontWeight: 700 } : {};
              const rateColor = d && d.rate != null && Math.abs(d.rate) >= 0.05 && !r.total
                ? ((d.rate > 0) === higherIsBetter ? "var(--green)" : "var(--red)") : "inherit";
              return (
                <tr key={k} style={tot}>
                  <td style={{ ...td, textAlign: "left", ...(onPick ? { cursor: "pointer", textDecoration: "underline dotted" } : {}), ...(picked && picked.row === k && picked.col == null ? { color: "var(--cyan)" } : {}) }}
                    onClick={onPick ? () => onPick(k, null) : undefined} title={onPick ? "Xem các ca của dòng này" : undefined}>{r.name}</td>
                  {r.counts.map((v, i) => {
                    const on = picked && picked.row === k && picked.col === i;
                    const clickable = onPick && Number(v) > 0;
                    return (
                      <td key={"c" + i} onClick={clickable ? () => onPick(k, i) : undefined} title={clickable ? pickHint || "Bấm để xem mã đơn" : undefined}
                        style={{ ...td, ...colStyle(i), ...(clickable ? { cursor: "pointer", color: "var(--cyan)", fontWeight: 700, textDecoration: "underline" } : {}), ...(on ? { background: "rgba(var(--brand-rgb),0.22)" } : {}) }}>
                        {fmtNum(v)}
                      </td>
                    );
                  })}
                  {hasDelta && <td style={td}>{d.count == null ? "" : `${d.count > 0 ? "+" : ""}${Math.round(d.count * 100)}%`}</td>}
                  {r.rates.map((v, i) => {
                    const g = showGtc && r[denKey] ? r[denKey][i] : null;
                    const small = g != null && g > 0 && g < 50;
                    return (
                      <td key={"r" + i} style={{ ...td, ...colStyle(i), ...(small ? { color: "var(--text-muted)" } : {}) }}
                        title={g != null ? `${fmtNum(r.counts[i])} ca / ${fmtNum(g)} ${denKey === "ltc" ? "đơn lấy thành công (LTC)" : "đơn giao thành công"}${small ? " — mẫu số nhỏ, % dao động mạnh" : ""}` : undefined}>
                        {fmtPct(v)}
                        {g != null && <div style={{ fontSize: 10.5, opacity: 0.75, fontWeight: 400 }}>{fmtNum(r.counts[i])}/{fmtNum(g)}{small && Number(r.counts[i]) > 0 ? " ⚠" : ""}</div>}
                      </td>
                    );
                  })}
                  {hasDelta && <td style={{ ...td, color: rateColor, fontWeight: rateColor === "inherit" ? undefined : 700 }}>
                    {d.rate == null ? "" : `${d.rate > 0 ? "+" : ""}${d.rate.toFixed(1)} đ`}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showGtc && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Dưới mỗi % là ca / {denName} ({denKey === "ltc" ? "đơn lấy thành công, theo ngày lấy" : "đơn giao thành công"}). ⚠ = {denName} dưới 50 đơn, 1 ca đã ra % cao. Bấm số ca để xem mã đơn.</div>}
      {!showGtc && onPick && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{pickHint}. Bấm tên khách để xem mọi tuần.</div>}
      {children}
    </div>
  );
}

// Cases behind one Bể vỡ cell (or a whole row / the total row).
function casesFor(report, rowIdx, colIdx) {
  if (!report) return [];
  const sec = report.damage;
  const row = sec.rows[rowIdx];
  if (!row) return [];
  const all = [...(report.details.damageCases || []), ...(report.details.damageCasesMonthOnly || [])];
  // Older locks have no `mondays` / `monday`: fall back to the case's week
  // label, or for a month column to the month of its detection-week Monday.
  const mondayOfCase = (c) => {
    if (c.monday) return c.monday;
    const m = String(c.case_date || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return "";
    const t = Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  };
  const inCol = (c, i) => {
    const col = sec.cols[i];
    if (col.mondays) return col.mondays.includes(mondayOfCase(c));
    return col.kind === "month" ? mondayOfCase(c).slice(0, 7) === col.key : c.week === col.label;
  };
  const nameOf = (c) => (c.client === "DigiWorld" ? "Digiworld" : c.client);
  const cols = colIdx == null ? sec.cols.map((_, i) => i) : [colIdx];
  const seen = new Set();
  return all.filter((c) => {
    if (!row.total && nameOf(c) !== row.name) return false;
    if (!cols.some((i) => inCol(c, i))) return false;
    if (seen.has(c.order_code)) return false;
    seen.add(c.order_code);
    return true;
  });
}

const shortWh = (s) => String(s || "").replace(/^Kho Giao Hàng Nặng - /, "").replace(/^Key Account Warehouse /, "KA WH ").trim();
function topOf(list, fn, n = 2) {
  const m = new Map();
  list.forEach((x) => { const k = fn(x); if (k) m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
const NL = String.fromCharCode(10);
const smallBtn = { fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" };

function CasePanel({ title, cases, expected, onClose }) {
  const [copied, setCopied] = useState(false);
  const n = cases.length;
  const hasRoute = cases.some((c) => c.kho_lay !== undefined);
  const created = topOf(cases, (c) => c.created_week || c.pickup_week, 4);
  const from = topOf(cases, (c) => shortWh(c.kho_lay), 2);
  const legs = topOf(cases, (c) => c.leg, 1);
  const returned = cases.filter((c) => /return/i.test(c.order_status || "")).length;
  const chip = { fontSize: 11.5, padding: "3px 9px", borderRadius: 12, background: "rgba(var(--brand-rgb),0.12)", color: "var(--text-secondary)" };
  const copy = () => {
    try { navigator.clipboard.writeText(cases.map((c) => c.order_code).join(NL)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  return (
    <div style={{ marginTop: 12, border: "1px solid rgba(var(--brand-rgb),0.35)", borderRadius: 10, padding: 12, background: "rgba(var(--brand-rgb),0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title} · {n} ca</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={copy} style={smallBtn}>{copied ? "✓ Đã copy" : "📋 Copy mã đơn"}</button>
          <button onClick={onClose} style={smallBtn}>✕ Đóng</button>
        </div>
      </div>
      {n > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {created.length > 0 && <span style={chip}>Đơn tạo: {created.map(([w, k]) => `${k} ca ${w}`).join(", ")}</span>}
          {hasRoute && from.length > 0 && <span style={chip}>Kho lấy: {from.map(([w, k]) => `${w} ${k}/${n}`).join(", ")}</span>}
          {legs.length > 0 && <span style={chip}>Chặng: {legs[0][0]} {legs[0][1]}/{n}</span>}
          {returned > 0 && <span style={chip}>{returned}/{n} đơn đã hoàn</span>}
        </div>
      )}
      <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead><tr>
            <th>Mã đơn</th><th>Khách</th><th>Phát hiện</th><th>Tạo</th><th>Giao</th><th>Trạng thái</th>
            <th>Tuyến (kho lấy → kho giao)</th><th>Chặng nghi vấn</th><th>Kho phát hiện</th><th>Kg</th><th>Đền bù / truy thu</th>
          </tr></thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.order_code}>
                <td style={{ fontWeight: 700 }}>{c.order_code}</td>
                <td>{c.client === "DigiWorld" ? "Digiworld" : c.client}</td>
                <td>{c.case_date} <span style={{ opacity: 0.6 }}>{c.week}</span></td>
                <td>{c.created_date ? c.created_date.split("-").reverse().join("/") : "—"} <span style={{ opacity: 0.6 }}>{c.created_week || c.pickup_week || ""}</span></td>
                <td>{c.delivered_week || "—"}</td>
                <td>{c.order_status || ""}</td>
                <td>{hasRoute ? <>{shortWh(c.kho_lay) || "?"}{c.from_province ? <span style={{ opacity: 0.6 }}> ({c.from_province})</span> : null} → {shortWh(c.kho_giao) || "?"}{c.to_province ? <span style={{ opacity: 0.6 }}> ({c.to_province})</span> : null}</> : "—"}</td>
                <td>{c.leg}</td>
                <td>{shortWh(c.warehouse)}</td>
                <td>{c.weight_kg ?? "—"}</td>
                <td>{c.compensated ? "Đã chốt đền" : "—"} · {c.truy_thu === "co" ? `Truy thu ${fmtNum(c.truy_thu_amount)}đ` : c.truy_thu === "khong" ? "Không truy thu" : "Chờ chốt"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {expected != null && n < expected && (
        <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 6 }}>
          Bảng ghi {expected} ca nhưng bản này chỉ lưu danh sách {n} ca (bản chốt cũ không lưu ca của cột tháng trước) — xem "Số mới nhất" để có đủ.
        </div>
      )}
      {n > 0 && !hasRoute && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Bản chốt này tạo trước khi có dữ liệu tuyến / ngày tạo — chốt lại để có đủ cột.</div>}
    </div>
  );
}

// Draft insight block (Bể vỡ / Ontime / Hàng hoàn) — same text as the
// Insight sheet of the Excel file.
function InsightBox({ ins, title, noneLabel = "Không phát sinh" }) {
  const [copied, setCopied] = useState(false);
  if (!ins || !(ins.clients.length || ins.total)) return null;
  const none = ins.none || [];
  const text = [ins.total, ins.pending, ...ins.clients.flatMap((c) => ["• " + c.lines[0], ...c.lines.slice(1).map((l) => "   " + l)]),
    ...(none.length ? [`${noneLabel}: ${none.join(", ")}.`] : [])].filter(Boolean).join(NL);
  const copy = () => { try { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };
  const tone = (l) => (l.startsWith("⚠") || l.startsWith("⏳") ? "var(--amber)" : "var(--text-secondary)");
  return (
    <div className="glass" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Gợi ý insight {title} · {ins.span}{ins.prevSpan ? ` so với ${ins.prevSpan}` : ""}</div>
        <button onClick={copy} style={{ ...smallBtn, border: "1px solid rgba(var(--brand-rgb),0.3)", background: "rgba(var(--brand-rgb),0.1)", color: "var(--cyan)", fontWeight: 600 }}>{copied ? "✓ Đã copy" : "📋 Copy gợi ý"}</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
        Hệ thống tự viết từ số liệu theo mẫu câu cố định (không dùng AI). Đã điền sẵn vào sheet Insight của file Excel — kiểm tra và sửa trước khi gửi.
        {ins.note ? ` ${ins.note}` : ""}{ins.routeRule ? ` Tuyến trễ nổi bật = ${ins.routeRule}.` : ""}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        {ins.total && <div style={{ fontWeight: 700, marginBottom: ins.pending ? 2 : 8 }}>{ins.total}</div>}
        {ins.pending && <div style={{ color: "var(--amber)", marginBottom: 8 }}>{ins.pending}</div>}
        {ins.clients.map((c) => (
          <div key={c.client} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>• {c.lines[0]}</div>
            {c.lines.slice(1).map((l, i) => <div key={i} style={{ paddingLeft: 16, color: tone(l) }}>{l}</div>)}
          </div>
        ))}
        {none.length > 0 && <div style={{ color: "var(--text-muted)" }}>{noneLabel}: {none.join(", ")}.</div>}
      </div>
    </div>
  );
}

// Orders behind an Ontime / Hàng hoàn cell. Only the report's week columns
// carry order lists (an earlier-month column would be thousands of orders) —
// `available` tells the panel to say so instead of showing an empty list.
function flowFor(report, key, rowIdx, colIdx) {
  const sec = report[key];
  const row = sec && sec.rows[rowIdx];
  if (!row) return { available: false, reason: "old", orders: [] };
  if (!row.clients || !sec.cols.every((c) => c.mondays)) return { available: false, reason: "old", orders: [] };
  const weekMondays = new Set(sec.cols.filter((c) => c.kind === "week").flatMap((c) => c.mondays));
  const cols = colIdx == null ? sec.cols.map((_, i) => i).filter((i) => sec.cols[i].kind === "week") : [colIdx];
  if (!cols.every((i) => sec.cols[i].mondays.every((m) => weekMondays.has(m)))) return { available: false, reason: "month", orders: [] };
  const mondays = new Set(cols.flatMap((i) => sec.cols[i].mondays));
  const clients = new Set(row.clients);
  const list = key === "ontime" ? report.details.lateOrders || [] : report.details.fdOrders || [];
  const orders = list.filter((o) => clients.has(o.client) && mondays.has(o.monday));
  let routes = null;
  if (key === "ontime") {
    const m = new Map();
    for (const c of clients) for (const mon of mondays) for (const [k, v] of Object.entries(((report.details.ontimeRoutes || {})[c] || {})[mon] || {})) {
      const o = m.get(k) || { n: 0, late: 0 }; o.n += v[0]; o.late += v[1]; m.set(k, o);
    }
    routes = [...m.entries()].map(([k, o]) => ({ route: k, ...o, rate: o.n ? (o.n - o.late) / o.n : null }));
  }
  return { available: true, orders, routes };
}

const LATE_ROUTE_MIN = 3, LATE_ROUTE_GAP = 0.05; // user rule 27/09 (same as the insight)
const shortRoute = (k) => String(k).split(" → ").map(shortWh).join(" → ");

function OrdersPanel({ kind, title, data, expected, onClose }) {
  const [copied, setCopied] = useState(false);
  const orders = data.orders;
  const n = orders.length;
  const copy = () => { try { navigator.clipboard.writeText(orders.map((o) => o.order_code).join(NL)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };
  const chip = { fontSize: 11.5, padding: "3px 9px", borderRadius: 12, background: "rgba(var(--brand-rgb),0.12)", color: "var(--text-secondary)" };
  const box = { marginTop: 12, border: "1px solid rgba(var(--brand-rgb),0.35)", borderRadius: 10, padding: 12, background: "rgba(var(--brand-rgb),0.04)" };
  if (!data.available) {
    return (
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={smallBtn}>✕ Đóng</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
          {data.reason === "month"
            ? "Cột tháng trước không lưu danh sách đơn (quá nhiều đơn). Muốn xem, chọn loại Tháng và kỳ tháng đó."
            : "Bản chốt này tạo trước khi có dữ liệu chi tiết — xem \"Số mới nhất\" hoặc chốt lại."}
        </div>
      </div>
    );
  }
  let routeRows = [], rowRate = null, buckets = null;
  if (kind === "ontime") {
    const ev = data.routes.reduce((a, r) => a + r.n, 0), lt = data.routes.reduce((a, r) => a + r.late, 0);
    rowRate = ev ? (ev - lt) / ev : null;
    routeRows = data.routes.filter((r) => r.late > 0).sort((a, b) => b.late - a.late || a.rate - b.rate)
      .map((r) => ({ ...r, hot: r.late >= LATE_ROUTE_MIN && rowRate != null && r.rate <= rowRate - LATE_ROUTE_GAP }));
    buckets = [orders.filter((o) => o.days_late === 1).length, orders.filter((o) => o.days_late === 2).length, orders.filter((o) => o.days_late >= 3).length];
  }
  const hubs = kind === "fd" ? topOf(orders, (o) => shortWh(o.kho_giao), 3) : [];
  const withDmg = kind === "fd" ? orders.filter((o) => o.has_damage).length : 0;
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title} · {n} {kind === "ontime" ? "đơn trễ" : "đơn hoàn"}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={copy} style={smallBtn}>{copied ? "✓ Đã copy" : "📋 Copy mã đơn"}</button>
          <button onClick={onClose} style={smallBtn}>✕ Đóng</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {kind === "ontime" && <>
          <span style={chip}>{fmtPct(rowRate)} ontime · {n} trễ / {data.routes.reduce((a, r) => a + r.n, 0)} đơn được tính</span>
          {n > 0 && <span style={chip}>Trễ 1 ngày: {buckets[0]} · 2 ngày: {buckets[1]} · từ 3 ngày: {buckets[2]}</span>}
        </>}
        {kind === "fd" && n > 0 && <>
          <span style={chip}>Kho giao: {hubs.map(([h, k]) => `${h} ${k}`).join(", ")}</span>
          <span style={chip}>{withDmg}/{n} đơn có ca bể Rillnet</span>
        </>}
      </div>
      {kind === "ontime" && routeRows.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Tuyến có đơn trễ <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>— tô đỏ: ≥ {LATE_ROUTE_MIN} đơn trễ và thấp hơn {fmtPct(rowRate)} của dòng này ≥ 5 điểm</span></div>
          <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto" }}>
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead><tr><th>Tuyến (kho lấy → kho giao)</th><th style={{ textAlign: "right" }}>Đơn được tính</th><th style={{ textAlign: "right" }}>Trễ</th><th style={{ textAlign: "right" }}>% ontime</th></tr></thead>
              <tbody>
                {routeRows.map((r) => (
                  <tr key={r.route} style={r.hot ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                    <td>{shortRoute(r.route)}</td><td style={{ textAlign: "right" }}>{fmtNum(r.n)}</td><td style={{ textAlign: "right" }}>{fmtNum(r.late)}</td><td style={{ textAlign: "right" }}>{fmtPct(r.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {n > 0 && (
        <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead><tr>
              <th>Mã đơn</th><th>Khách</th><th>Ngày lấy</th>
              {kind === "ontime" ? <><th>Hạn giao</th><th>Ngày giao</th><th style={{ textAlign: "right" }}>Trễ</th></> : <th>Trạng thái</th>}
              <th>Tuyến (kho lấy → kho giao)</th><th>Tỉnh giao</th><th style={{ textAlign: "right" }}>Kg</th>
              {kind === "fd" && <th>Ca bể</th>}
            </tr></thead>
            <tbody>
              {[...orders].sort((a, b) => (kind === "ontime" ? (b.days_late ?? -1) - (a.days_late ?? -1) : 0) || a.order_code.localeCompare(b.order_code)).map((o) => (
                <tr key={o.order_code}>
                  <td style={{ fontWeight: 700 }}>{o.order_code}</td>
                  <td>{o.client === "DigiWorld" ? "Digiworld" : o.client}</td>
                  <td>{String(o.pickup_date || o.pickup_time || "").slice(0, 10).split("-").reverse().join("/")} <span style={{ opacity: 0.6 }}>{o.week}</span></td>
                  {kind === "ontime"
                    ? <><td>{String(o.deadline || "").split("-").reverse().join("/")}</td><td>{o.delivered_date ? String(o.delivered_date).split("-").reverse().join("/") : <span style={{ color: "var(--amber)" }}>{o.late_kind || "—"}</span>}</td>
                      <td style={{ textAlign: "right", ...(o.days_late >= 3 ? { color: "var(--red)", fontWeight: 700 } : {}) }}>{o.days_late == null ? "—" : `${o.days_late} ngày`}</td></>
                    : <td>{o.status}</td>}
                  <td>{shortWh(o.kho_lay) || "?"} → {shortWh(o.kho_giao) || "?"}</td>
                  <td>{o.to_province || ""}</td>
                  <td style={{ textAlign: "right" }}>{o.weight_kg ?? "—"}</td>
                  {kind === "fd" && <td>{o.has_damage ? "Có" : ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {expected != null && n !== expected && (
        <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 6 }}>Bảng ghi {expected} nhưng danh sách có {n} — báo lại để kiểm tra.</div>
      )}
    </div>
  );
}

// Cells whose value moved between the locked numbers and the latest ones.
function diffReports(locked, live) {
  const out = [];
  if (!locked || !live) return out;
  for (const [key, name] of [["ontime", "Ontime"], ["damage", "Bể vỡ"], ["fd", "Hàng hoàn"]]) {
    const a = locked[key], b = live[key];
    if (!a || !b) continue;
    a.rows.forEach((ra, idx) => {
      const rb = b.rows.find((x, j) => x.name === ra.name && (x.name !== "Khác" || j === idx)) || b.rows[idx];
      if (!rb) return;
      // Match columns by key, not position: a lock taken before the biweekly
      // layout changed (28/09: month column → 2-week totals) has other columns.
      a.cols.forEach((c, i) => {
        const j = c.key != null ? b.cols.findIndex((x) => x.key === c.key) : i;
        if (j < 0) return;
        const ca = ra.counts[i], cb = rb.counts[j];
        const pa = fmtPct(ra.rates[i]), pb = fmtPct(rb.rates[j]);
        if (ca !== cb || pa !== pb) {
          out.push({ section: name, client: ra.name, col: c.label, from: `${fmtNum(ca)}${pa ? ` · ${pa}` : ""}`, to: `${fmtNum(cb)}${pb ? ` · ${pb}` : ""}` });
        }
      });
    });
  }
  return out;
}

export default function TabCompanyReport() {
  const [type, setType] = useState("biweekly");
  const [period, setPeriod] = useState(() => defaultPeriodFor("biweekly"));
  const [mode, setMode] = useState("full"); // "full" = original layout | "pick" = chosen key accounts
  const [picked, setPicked] = useState([]);
  const [view, setView] = useState("live");
  const [live, setLive] = useState(null);
  const [saved, setSaved] = useState(null); // { report, lock } for this period
  const [lockLive, setLockLive] = useState(null); // latest numbers with the lock's selection
  const [locks, setLocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState("");
  const reqId = useRef(0);
  // Version of the channel config just saved here: sent as &cv= so whichever
  // server instance answers re-reads the config instead of a cached copy.
  const [cv, setCv] = useState("");
  const cvParam = cv ? `&cv=${encodeURIComponent(cv)}` : "";

  useEffect(() => { const p = readPicked(); if (p.length) setPicked(p); }, []);
  const clients = mode === "pick" ? picked : null;
  // A locked period older than the dropdown's range still has to be selectable.
  const base = optionsFor(type);
  const options = base.some((o) => o.value === period) ? base : [...base, { value: period, label: periodLabel(type, period) }];

  const loadLocks = useCallback(() => fetch("/api/report/biweekly?list=1").then((r) => r.json()).then((j) => { if (j.ok) setLocks(j.locks); }).catch(() => {}), []);
  useEffect(() => { loadLocks(); }, [loadLocks]);

  // Latest numbers for the current selection (debounced while ticking clients).
  useEffect(() => {
    if (mode === "pick" && picked.length === 0) { setLive(null); return; }
    const id = ++reqId.current;
    setLoading(true); setErr(null);
    const t = setTimeout(() => {
      fetch(apiUrl(type, period, clients, `&format=json${cvParam}`))
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => { if (id !== reqId.current) return; if (!ok || !j.ok) throw new Error(j.error || "Không tải được báo cáo"); setLive(j.report); })
        .catch((e) => { if (id === reqId.current) setErr(e.message); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    }, mode === "pick" ? 450 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, period, mode, JSON.stringify(picked), cv]);

  // The locked version of this period (if any) + latest numbers with ITS selection.
  const isLocked = locks.some((l) => l.type === type && l.period === period);
  useEffect(() => {
    setSaved(null); setLockLive(null);
    if (!isLocked) { setView("live"); return; }
    let cancel = false;
    fetch(apiUrl(type, period, null, "&version=locked&format=json")).then((r) => r.json()).then((j) => {
      if (cancel || !j.ok) return;
      setSaved({ report: j.report, lock: j.lock });
      return fetch(apiUrl(type, period, j.report.selection, `&format=json${cvParam}`)).then((r) => r.json()).then((k) => { if (!cancel && k.ok) setLockLive(k.report); });
    }).catch(() => {});
    return () => { cancel = true; };
  }, [type, period, isLocked, cv]);

  // Any Điện máy client in the window; the full list comes with every report.
  const clientOptions = useMemo(() => {
    const src = live?.clientOptions || lockLive?.clientOptions || saved?.report?.clientOptions || [];
    const known = new Set(src.map((o) => o.name));
    return [...src, ...picked.filter((c) => !known.has(c)).map((c) => ({ name: c, label: label(c), orders: 0 }))];
  }, [live, lockLive, saved, picked]);
  const shownOptions = clientOptions.filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()));

  const toggle = (name) => {
    const next = picked.includes(name) ? picked.filter((c) => c !== name) : [...picked, name];
    setPicked(next); savePicked(next); setMsg(null);
  };
  const setAll = (list) => { setPicked(list); savePicked(list); setMsg(null); };
  const changeType = (t) => { setType(t); setPeriod(defaultPeriodFor(t)); setMsg(null); };

  const changes = useMemo(() => diffReports(saved?.report, lockLive), [saved, lockLive]);
  const lockSel = saved?.report?.selection || null;
  const selDiffers = saved && !sameList(lockSel, clients);
  const shown = view === "locked" && saved ? saved.report : live;
  // Clicked Bể vỡ cell ({row, col}; col null = whole row). Tied to the report
  // it was clicked on: another report (other period / type / view) renders
  // with no selection instead of an index that may not exist there.
  const [pickState, setPickState] = useState(null);
  const pick = pickState && pickState.report === shown ? pickState : null;
  const setPick = (p) => setPickState(p ? { ...p, report: shown } : null);
  // One open panel at a time, across the three tables ({sec, row, col}).
  const pickOf = (sec) => (pick && pick.sec === sec ? pick : null);
  const togglePick = (sec) => (row, col) => setPick(pick && pick.sec === sec && pick.row === row && pick.col === col ? null : { sec, row, col });

  const doLock = async () => {
    const who = clients ? `khách: ${clients.map(label).join(", ")}` : "mẫu đầy đủ";
    const text = saved
      ? `Kỳ này đã chốt lúc ${vnTime(saved.lock.lockedAt)} (${lockSel ? `khách: ${lockSel.map(label).join(", ")}` : "mẫu đầy đủ"}).\nChốt lại sẽ GHI ĐÈ bằng số hiện tại, ${who}. Tiếp tục?`
      : `Chốt số ${periodLabel(type, period)} (${who})? Số hiện tại sẽ được lưu để tải lại đúng như vậy về sau.${isLive(type, period) ? `${NL}${NL}Lưu ý: kỳ này CHƯA KẾT THÚC — bản chốt chỉ có số đến thời điểm này.` : ""}`;
    if (!confirm(text)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(apiUrl(type, period, clients), { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Không chốt được");
      setMsg(`✓ Đã chốt số lúc ${vnTime(j.lock.lockedAt)}`);
      await loadLocks();
      setSaved(null);
      const k = await fetch(apiUrl(type, period, null, "&version=locked&format=json")).then((x) => x.json());
      if (k.ok) { setSaved({ report: k.report, lock: k.lock }); setLockLive(live); }
    } catch (e) {
      setMsg(`⚠ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const btn = {
    display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(var(--brand-rgb),0.1)", border: "1px solid rgba(var(--brand-rgb),0.3)",
    color: "var(--cyan)", padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const ghost = { ...btn, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" };
  const seg = (active) => ({
    flex: 1, padding: "7px 0", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
    background: active ? "rgba(var(--brand-rgb),0.18)" : "transparent", color: active ? "var(--cyan)" : "var(--text-muted)",
  });
  const select = { padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13 };
  const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Controls ── */}
      <div className="glass" style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: "1 1 260px", maxWidth: 340 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Kỳ báo cáo</div>
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {TYPES.map(([k, l]) => <button key={k} onClick={() => changeType(k)} style={seg(type === k)}>{l}</button>)}
          </div>
          <select value={period} onChange={(e) => { setPeriod(e.target.value); setMsg(null); }} style={select}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}{locks.some((l) => l.type === type && l.period === o.value) ? " · 🔒 đã chốt" : ""}</option>
            ))}
          </select>
          <div style={small}>
            {type === "week" && "4 tuần gần nhất (tuần chọn là tuần cuối) + cột ± so với tuần trước."}
            {type === "biweekly" && "Báo cáo gửi ở tuần chẵn, gồm số 2 tuần liền trước (vd báo cáo W40 = W38–W39). Bảng: 4 tuần + “2 tuần trước” và “Kỳ này” (cộng 2 tuần, % tính lại trên tổng) + cột ± kỳ này so với 2 tuần trước (số: % thay đổi; %: điểm)."}
            {type === "month" && "3 tháng gần nhất + các tuần của tháng chọn + cột ± so với tháng trước."}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, flex: "999 1 320px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Khách trong báo cáo</div>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", flex: "1 1 280px", maxWidth: 380 }}>
              <button onClick={() => { setMode("full"); setMsg(null); }} style={seg(mode === "full")}>Mẫu đầy đủ</button>
              <button onClick={() => { setMode("pick"); setMsg(null); }} style={seg(mode === "pick")}>Chọn khách key account</button>
            </div>
          </div>
          {mode === "full" ? (
            <div style={small}>
              Giống báo cáo gốc: các khách chính + nhóm "Khác", tổng B2B / B2C / Điện máy cho Ontime và Hàng hoàn.
              Bảng Bể vỡ gồm 7 khách của báo cáo gốc; dòng tổng chỉ cộng đúng các khách đó.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm khách…" style={{ ...select, width: 180 }} />
                <button style={ghost} onClick={() => setAll(clientOptions.map((o) => o.name))}>Chọn hết</button>
                <button style={ghost} onClick={() => setAll([])}>Bỏ hết</button>
                <span style={small}>Đã chọn {picked.length} khách · mọi bảng chỉ hiện các khách này, dòng "Tổng khách đã chọn" chỉ cộng họ.</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 140, overflowY: "auto" }}>
                {shownOptions.map((o) => {
                  const on = picked.includes(o.name);
                  return (
                    <button key={o.name} onClick={() => toggle(o.name)} style={{
                      padding: "5px 10px", borderRadius: 16, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      border: on ? "1px solid var(--cyan)" : "1px solid var(--border)",
                      background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", color: on ? "var(--cyan)" : "var(--text-secondary)",
                    }}>
                      {on ? "✓ " : ""}{o.label} <span style={{ opacity: 0.6 }}>{o.orders.toLocaleString("vi-VN")}</span>
                    </button>
                  );
                })}
                {!shownOptions.length && <span style={small}>{clientOptions.length ? "Không có khách khớp." : "Đang tải danh sách khách…"}</span>}
              </div>
              <div style={small}>Số cạnh tên = số đơn lấy trong các cột của kỳ.</div>
            </>
          )}
        </div>
      </div>

      <ClientChannelSettings onSaved={(v) => { setCv(v); setMsg(null); }} />

      {/* ── Lock status + actions ── */}
      <div className="glass" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
            <b>{TYPE_LABEL[type]} · {periodLabel(type, period)}</b>{" "}
            {saved
              ? <span style={{ color: "var(--green)" }}>🔒 Đã chốt lúc {vnTime(saved.lock.lockedAt)}{saved.lock.lockedBy ? ` bởi ${saved.lock.lockedBy}` : ""} · {lockSel ? `khách: ${lockSel.map(label).join(", ")}` : "mẫu đầy đủ"}</span>
              : isLocked ? <span style={small}>đang tải bản đã chốt…</span>
              : <span style={{ color: "var(--text-muted)" }}>· chưa chốt số</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn} disabled={mode === "pick" && !picked.length} onClick={() => { window.location.href = apiUrl(type, period, clients); }}>⬇ Tải Excel (số mới nhất)</button>
            {saved && <button style={btn} onClick={() => { window.location.href = apiUrl(type, period, null, "&version=locked"); }}>⬇ Tải bản đã chốt</button>}
            <button style={ghost} disabled={busy || (mode === "pick" && !picked.length)} onClick={doLock}>{busy ? "Đang chốt…" : saved ? "🔒 Chốt lại" : "🔒 Chốt số kỳ này"}</button>
          </div>
        </div>
        {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
        {saved && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={small}>Đang xem:</span>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", flex: "0 1 300px" }}>
              <button onClick={() => setView("live")} style={seg(view === "live")}>Số mới nhất</button>
              <button onClick={() => setView("locked")} style={seg(view === "locked")}>Bản đã chốt</button>
            </div>
            {selDiffers && view === "live" && <span style={{ ...small, color: "var(--amber)" }}>Bộ khách đang chọn khác bộ khách của bản đã chốt.</span>}
          </div>
        )}
        {saved && (
          <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: changes.length ? "var(--amber)" : "var(--green)", marginBottom: 6 }}>
              {!lockLive ? "Đang so với số mới nhất…"
                : changes.length ? `Số đã đổi kể từ lúc chốt: ${changes.length} ô (cùng bộ khách với bản chốt)`
                : "✓ Số mới nhất vẫn giống hệt bản đã chốt"}
            </div>
            {changes.length > 0 && (
              <div style={{ maxHeight: 180, overflowY: "auto" }}>
                <table className="data-table" style={{ fontSize: 12 }}>
                  <thead><tr><th>Bảng</th><th>Khách</th><th>Cột</th><th>Bản chốt</th><th>Mới nhất</th></tr></thead>
                  <tbody>
                    {changes.slice(0, 60).map((c, i) => (
                      <tr key={i}><td>{c.section}</td><td>{c.client}</td><td>{c.col}</td><td>{c.from}</td><td style={{ fontWeight: 700 }}>{c.to}</td></tr>
                    ))}
                  </tbody>
                </table>
                {changes.length > 60 && <div style={small}>… và {changes.length - 60} ô khác.</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tables ── */}
      {err && <div className="glass" style={{ padding: 16, color: "var(--red)" }}>⚠ {err}</div>}
      {mode === "pick" && !picked.length && view === "live" && (
        <div className="glass" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>Chọn ít nhất 1 khách để xem báo cáo.</div>
      )}
      {!shown && loading && <div className="skeleton" style={{ height: 320, borderRadius: 12 }} />}
      {shown && (
        <div style={{ opacity: loading && view === "live" ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <div style={{ ...small, marginBottom: 8 }}>
            {shown.periodLabel} · dữ liệu tính đến {vnTime(shown.dataAsOf)}
            {view === "locked" ? " · BẢN ĐÃ CHỐT" : " · số mới nhất (chưa chốt)"}
            {" · "}* = tuần/tháng chưa đủ 7 ngày sau khi kết thúc, số còn có thể đổi.
          </div>
          <ReportTable title="Ontime LTL" countTitle="# đơn LTC" rateTitle="% ontime" sec={shown.ontime} higherIsBetter
            picked={pickOf("ontime")} onPick={togglePick("ontime")} pickHint="Bấm số đơn để xem đơn trễ và tuyến trễ">
            {pickOf("ontime") && (
              <OrdersPanel kind="ontime"
                title={`Ontime · ${shown.ontime.rows[pick.row].name} · ${pick.col == null ? "các tuần của kỳ" : shown.ontime.cols[pick.col].label}`}
                data={flowFor(shown, "ontime", pick.row, pick.col)}
                expected={pick.col == null || !shown.ontime.rows[pick.row].late ? null : shown.ontime.rows[pick.row].late[pick.col]}
                onClose={() => setPick(null)} />
            )}
          </ReportTable>
          <InsightBox ins={shown.insights && shown.insights.ontime} title="Ontime" />
          <ReportTable title="Bể vỡ và đền bù" countTitle="# case bể và đền (theo ngày phát hiện)" rateTitle={shown.damage.rows.some((r) => Array.isArray(r.ltc)) ? "% bể đền / LTC" : "% bể đền / GTC"} sec={shown.damage} higherIsBetter={false}
            picked={pickOf("damage")} onPick={togglePick("damage")}>
            {pickOf("damage") && shown.damage.rows[pick.row] && (
              <CasePanel
                title={`${shown.damage.rows[pick.row].name} · ${pick.col == null ? "tất cả các cột" : shown.damage.cols[pick.col].label}`}
                cases={casesFor(shown, pick.row, pick.col)}
                expected={pick.col == null ? null : Number(shown.damage.rows[pick.row].counts[pick.col]) || 0}
                onClose={() => setPick(null)}
              />
            )}
          </ReportTable>
          <InsightBox ins={shown.insights && shown.insights.damage} title="Bể vỡ" noneLabel="Không phát sinh ca" />
          <ReportTable title="Hàng hoàn" countTitle="# đơn FD" rateTitle="% FD" sec={shown.fd} higherIsBetter={false}
            picked={pickOf("fd")} onPick={togglePick("fd")} pickHint="Bấm số đơn hoàn để xem mã đơn">
            {pickOf("fd") && (
              <OrdersPanel kind="fd"
                title={`Hàng hoàn · ${shown.fd.rows[pick.row].name} · ${pick.col == null ? "các tuần của kỳ" : shown.fd.cols[pick.col].label}`}
                data={flowFor(shown, "fd", pick.row, pick.col)}
                expected={pick.col == null ? null : shown.fd.rows[pick.row].counts[pick.col]}
                onClose={() => setPick(null)} />
            )}
          </ReportTable>
          <InsightBox ins={shown.insights && shown.insights.fd} title="Hàng hoàn" noneLabel="Không có đơn hoàn" />
          <div style={{ ...small, marginTop: -4 }}>
            % bể đền của mỗi khách = ca bể (theo ngày phát hiện) / đơn LTC của chính khách đó (theo ngày lấy). Dòng tổng chỉ cộng các khách trong bảng.
            # đơn LTC theo ngày lấy, ca bể theo ngày phát hiện (chi tiết trong file Excel). On-time = đơn LTC có cờ ontime / (đơn LTC − đơn chưa giao còn trong hạn); đơn chưa giao quá hạn và đơn hoàn/huỷ tính là trễ.
            FTL và Insight điền tay trong file Excel.
          </div>
        </div>
      )}

      {/* ── Locked periods ── */}
      <div className="glass" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Các kỳ đã chốt</div>
        {locks.length === 0 ? <div style={small}>Chưa có kỳ nào được chốt.</div> : (
          <table className="data-table">
            <thead><tr><th>Loại</th><th>Kỳ</th><th>Chốt lúc</th><th></th></tr></thead>
            <tbody>
              {locks.map((l) => (
                <tr key={l.type + l.period}>
                  <td>{TYPE_LABEL[l.type] || l.type}</td>
                  <td>{periodLabel(l.type, l.period)}</td>
                  <td>{vnTime(l.lockedAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button style={{ ...ghost, padding: "4px 10px" }} onClick={() => { setType(l.type); setPeriod(l.period); setView("locked"); setMsg(null); }}>Xem</button>{" "}
                    <button style={{ ...btn, padding: "4px 10px" }} onClick={() => { window.location.href = apiUrl(l.type, l.period, null, "&version=locked"); }}>⬇ Tải</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
