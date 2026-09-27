/**
 * components/BiweeklyExport.js — "📊 Xuất báo cáo" (Manager + SD3):
 * pick the cadence (Tuần / 2 tuần / Tháng) and period, then download the
 * company Excel with the latest numbers, lock them ("Chốt số"), or
 * re-download a locked version — /api/report/biweekly.
 */
import { useEffect, useState } from "react";

const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const TYPES = [["week", "Tuần"], ["biweekly", "2 tuần"], ["month", "Tháng"]];
const vnTime = (iso) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
// Last 10 completed ISO weeks, newest first.
function recentWeeks() {
  const base = thisMonday();
  const fmt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return Array.from({ length: 10 }, (_, i) => {
    const mon = ymd(new Date(base - (i + 1) * 7 * DAY));
    const { year, week } = isoWeek(mon);
    return { value: `${year}-W${String(week).padStart(2, "0")}`, label: `W${week} (${fmt(mon)} – ${fmt(ymd(new Date(Date.parse(mon) + 6 * DAY)))})` };
  });
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
  });
}

export default function BiweeklyExport() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("biweekly");
  const options = type === "month" ? recentMonths() : recentWeeks();
  const [period, setPeriod] = useState(options[0].value);
  const [locks, setLocks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadLocks = () => fetch("/api/report/biweekly?list=1").then((r) => r.json()).then((j) => { if (j.ok) setLocks(j.locks); }).catch(() => {});
  useEffect(() => { if (open) loadLocks(); }, [open]);
  const changeType = (t) => { setType(t); setPeriod((t === "month" ? recentMonths() : recentWeeks())[0].value); setMsg(null); };
  const lock = locks.find((l) => l.type === type && l.period === period);
  const url = (extra = "") => `/api/report/biweekly?type=${type}&period=${encodeURIComponent(period)}${extra}`;

  const doLock = async () => {
    if (lock && !confirm(`Kỳ này đã chốt lúc ${vnTime(lock.lockedAt)}. Chốt lại sẽ ghi đè bằng số hiện tại — tiếp tục?`)) return;
    if (!lock && !confirm("Chốt số kỳ này? Số liệu hiện tại sẽ được lưu lại để tải lại đúng như vậy về sau.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url(), { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Không chốt được");
      setMsg(`✓ Đã chốt số lúc ${vnTime(j.lock.lockedAt)}`);
      await loadLocks();
    } catch (e) {
      setMsg(`⚠ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const btn = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(var(--brand-rgb),0.1)", border: "1px solid rgba(var(--brand-rgb),0.3)",
    color: "var(--cyan)", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const ghost = { ...btn, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" };
  const select = {
    width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--input-bg)",
    color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13, marginBottom: 10,
  };
  const HINT = {
    week: "4 tuần gần nhất (tuần chọn là tuần cuối) + cột ± so với tuần trước.",
    biweekly: "Tháng trước + 3 tuần (Ontime, Hàng hoàn), 4 tuần (Bể vỡ) — như báo cáo hiện tại.",
    month: "3 tháng gần nhất + các tuần của tháng chọn + cột ± so với tháng trước.",
  };

  return (
    <span style={{ position: "relative" }}>
      <button style={btn} onClick={() => setOpen((v) => !v)}>📊 Xuất báo cáo</button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, width: 330, background: "var(--bg-panel)",
          border: "1px solid var(--border)", borderRadius: 10, padding: 14, boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Báo cáo chất lượng Điện máy (Excel)</div>
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
            {TYPES.map(([k, label]) => (
              <button key={k} onClick={() => changeType(k)} style={{
                flex: 1, padding: "6px 0", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
                background: type === k ? "rgba(var(--brand-rgb),0.18)" : "transparent", color: type === k ? "var(--cyan)" : "var(--text-muted)",
              }}>{label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>{HINT[type]} FTL để trống, sheet Insight để bạn viết.</div>
          <select value={period} onChange={(e) => { setPeriod(e.target.value); setMsg(null); }} style={select}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}{locks.some((l) => l.type === type && l.period === o.value) ? " · 🔒 đã chốt" : ""}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button style={btn} onClick={() => { window.location.href = url(); }}>⬇ Tải số mới nhất</button>
            {lock && (
              <button style={btn} onClick={() => { window.location.href = url("&version=locked"); }}>
                ⬇ Tải bản đã chốt ({vnTime(lock.lockedAt)})
              </button>
            )}
            <button style={ghost} disabled={busy} onClick={doLock}>{busy ? "Đang chốt…" : lock ? "🔒 Chốt lại số kỳ này" : "🔒 Chốt số kỳ này"}</button>
          </div>
          {msg && <div style={{ fontSize: 12, marginTop: 8, color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button style={{ ...ghost, padding: "4px 10px" }} onClick={() => setOpen(false)}>Đóng</button>
          </div>
        </div>
      )}
    </span>
  );
}
