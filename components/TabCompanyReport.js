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
const optionsFor = (type) => (type === "month" ? recentMonths() : recentWeeks(type === "biweekly"));
const periodLabel = (type, period) => {
  if (type === "month") return `Tháng ${period.slice(5, 7)}/${period.slice(0, 4)}`;
  const mon = mondayOfWeekKey(period);
  if (!mon) return period;
  return type === "biweekly" ? twoWeekName(mon, true) : `W${isoWeek(mon).week}`;
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

function ReportTable({ title, countTitle, rateTitle, sec, higherIsBetter }) {
  const cols = sec.cols;
  const hasDelta = !!sec.delta;
  const colLabel = (c) => (c.mature === false ? `${c.label}*` : c.label);
  const th = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12 };
  const td = { padding: "7px 10px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5, borderBottom: "1px solid var(--panel-border-soft)" };
  const sep = { borderLeft: "2px solid var(--border)" };
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
              {cols.map((c, i) => <th key={"c" + c.key} style={{ ...th, ...(i === 0 ? sep : {}) }} title={c.range || ""}>{colLabel(c)}</th>)}
              {hasDelta && <th style={th}>± vs {cols[sec.delta[0]].label}</th>}
              {cols.map((c, i) => <th key={"r" + c.key} style={{ ...th, ...(i === 0 ? sep : {}) }}>{colLabel(c)}</th>)}
              {hasDelta && <th style={th}>± điểm</th>}
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
                  <td style={{ ...td, textAlign: "left" }}>{r.name}</td>
                  {r.counts.map((v, i) => <td key={"c" + i} style={{ ...td, ...(i === 0 ? sep : {}) }}>{fmtNum(v)}</td>)}
                  {hasDelta && <td style={td}>{d.count == null ? "" : `${d.count > 0 ? "+" : ""}${Math.round(d.count * 100)}%`}</td>}
                  {r.rates.map((v, i) => <td key={"r" + i} style={{ ...td, ...(i === 0 ? sep : {}) }}>{fmtPct(v)}</td>)}
                  {hasDelta && <td style={{ ...td, color: rateColor, fontWeight: rateColor === "inherit" ? undefined : 700 }}>
                    {d.rate == null ? "" : `${d.rate > 0 ? "+" : ""}${d.rate.toFixed(1)} đ`}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
      a.cols.forEach((c, i) => {
        const ca = ra.counts[i], cb = rb.counts[i];
        const pa = fmtPct(ra.rates[i]), pb = fmtPct(rb.rates[i]);
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
  const [period, setPeriod] = useState(() => optionsFor("biweekly")[0].value);
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
      fetch(apiUrl(type, period, clients, "&format=json"))
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => { if (id !== reqId.current) return; if (!ok || !j.ok) throw new Error(j.error || "Không tải được báo cáo"); setLive(j.report); })
        .catch((e) => { if (id === reqId.current) setErr(e.message); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    }, mode === "pick" ? 450 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, period, mode, JSON.stringify(picked)]);

  // The locked version of this period (if any) + latest numbers with ITS selection.
  const isLocked = locks.some((l) => l.type === type && l.period === period);
  useEffect(() => {
    setSaved(null); setLockLive(null);
    if (!isLocked) { setView("live"); return; }
    let cancel = false;
    fetch(apiUrl(type, period, null, "&version=locked&format=json")).then((r) => r.json()).then((j) => {
      if (cancel || !j.ok) return;
      setSaved({ report: j.report, lock: j.lock });
      return fetch(apiUrl(type, period, j.report.selection, "&format=json")).then((r) => r.json()).then((k) => { if (!cancel && k.ok) setLockLive(k.report); });
    }).catch(() => {});
    return () => { cancel = true; };
  }, [type, period, isLocked]);

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
  const changeType = (t) => { setType(t); setPeriod(optionsFor(t)[0].value); setMsg(null); };

  const changes = useMemo(() => diffReports(saved?.report, lockLive), [saved, lockLive]);
  const lockSel = saved?.report?.selection || null;
  const selDiffers = saved && !sameList(lockSel, clients);
  const shown = view === "locked" && saved ? saved.report : live;

  const doLock = async () => {
    const who = clients ? `khách: ${clients.map(label).join(", ")}` : "mẫu đầy đủ";
    const text = saved
      ? `Kỳ này đã chốt lúc ${vnTime(saved.lock.lockedAt)} (${lockSel ? `khách: ${lockSel.map(label).join(", ")}` : "mẫu đầy đủ"}).\nChốt lại sẽ GHI ĐÈ bằng số hiện tại, ${who}. Tiếp tục?`
      : `Chốt số ${periodLabel(type, period)} (${who})? Số hiện tại sẽ được lưu để tải lại đúng như vậy về sau.`;
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
            {type === "biweekly" && "Báo cáo gửi ở tuần chẵn, gồm số 2 tuần liền trước (vd báo cáo W40 = W38–W39). Bảng: tháng trước + 3 tuần (Ontime, Hàng hoàn), 4 tuần (Bể vỡ)."}
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
          <ReportTable title="Ontime LTL" countTitle="# đơn LTC" rateTitle="% ontime" sec={shown.ontime} higherIsBetter />
          <ReportTable title="Bể vỡ và đền bù" countTitle="# case bể và đền (theo ngày phát hiện)" rateTitle="% bể đền / GTC" sec={shown.damage} higherIsBetter={false} />
          <ReportTable title="Hàng hoàn" countTitle="# đơn FD" rateTitle="% FD" sec={shown.fd} higherIsBetter={false} />
          <div style={{ ...small, marginTop: -4 }}>
            % bể đền của mỗi khách = ca bể / GTC của chính khách đó. Dòng tổng chỉ cộng các khách trong bảng.
            # đơn LTC theo ngày lấy, GTC theo ngày giao, ca bể theo ngày phát hiện (chi tiết trong file Excel).
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
