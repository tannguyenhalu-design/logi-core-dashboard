/**
 * components/BiweeklyExport.js — "📊 Xuất báo cáo 2 tuần" (Manager + SD3):
 * pick the report's end week (default: last completed ISO week) and download
 * the company Excel from /api/report/biweekly.
 */
import { useState } from "react";

const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);

function isoWeek(monday) {
  const d = new Date(monday + "T00:00:00Z");
  const thu = new Date(d.getTime() + 3 * DAY);
  const year = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const w1 = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  return { year, week: Math.round((d.getTime() - w1) / (7 * DAY)) + 1 };
}

// Last 10 completed ISO weeks, newest first.
function recentWeeks() {
  const today = new Date(Date.now() + 7 * 3600 * 1000);
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const thisMonday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: 10 }, (_, i) => {
    const mon = ymd(new Date(thisMonday - (i + 1) * 7 * DAY));
    const sun = ymd(new Date(Date.parse(mon) + 6 * DAY));
    const { year, week } = isoWeek(mon);
    const fmt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
    return { value: `${year}-W${String(week).padStart(2, "0")}`, label: `W${week} (${fmt(mon)} – ${fmt(sun)})` };
  });
}

export default function BiweeklyExport() {
  const [open, setOpen] = useState(false);
  const weeks = recentWeeks();
  const [week, setWeek] = useState(weeks[0].value);
  const btn = {
    display: "flex", alignItems: "center", gap: 6, background: "rgba(var(--brand-rgb),0.1)", border: "1px solid rgba(var(--brand-rgb),0.3)",
    color: "var(--cyan)", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  return (
    <span style={{ position: "relative" }}>
      <button style={btn} onClick={() => setOpen((v) => !v)}>📊 Xuất báo cáo 2 tuần</button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, width: 300, background: "var(--bg-panel)",
          border: "1px solid var(--border)", borderRadius: 10, padding: 14, boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Báo cáo chất lượng Điện máy (Excel)</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>
            Tuần kết thúc kỳ → file gồm tháng trước + 3 tuần (Ontime, Hàng hoàn) và 4 tuần (Bể vỡ, FTL để trống). Sheet Insight để trống cho bạn viết.
          </div>
          <select value={week} onChange={(e) => setWeek(e.target.value)} style={{
            width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--input-bg)",
            color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13, marginBottom: 10,
          }}>
            {weeks.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={{ ...btn, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" }} onClick={() => setOpen(false)}>Đóng</button>
            <button style={btn} onClick={() => { window.location.href = `/api/report/biweekly?week=${encodeURIComponent(week)}`; setOpen(false); }}>⬇ Tải Excel</button>
          </div>
        </div>
      )}
    </span>
  );
}
