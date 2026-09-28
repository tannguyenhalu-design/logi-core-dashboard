/**
 * components/DateField.js — date box shown / typed as dd/mm/yyyy (28/09),
 * shared by the filter bar and the Sổ tay forms.
 */
import { useEffect, useRef, useState } from "react";

// Date input shown as dd/mm/yyyy whatever the browser language (the native
// <input type="date"> showed mm/dd/yyyy — user 28/09). Type "14/09/2026" (or
// 14/9/26) and press Enter / leave the box, or click 📅 to open the calendar.
// value / onChange use yyyy-mm-dd, like the API.
export const toDMY = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
export function parseDMY(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]), d = Number(m[1]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
export default function DateField({ value, onChange, placeholder, label, inputStyle = null, wrapStyle = null }) {
  const [text, setText] = useState(toDMY(value));
  const [bad, setBad] = useState(false);
  const picker = useRef(null);
  useEffect(() => { setText(toDMY(value)); setBad(false); }, [value]);
  const commit = () => {
    if (!text.trim()) { setBad(false); if (value) onChange(""); return; }
    const iso = parseDMY(text);
    if (!iso) { setBad(true); return; }
    setBad(false);
    if (iso !== value) onChange(iso);
    else setText(toDMY(iso));
  };
  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try { if (el.showPicker) el.showPicker(); else el.click(); } catch { el.focus(); }
  };
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", ...(wrapStyle || {}) }}>
      <input
        type="text" inputMode="numeric" aria-label={label} placeholder={placeholder} value={text}
        title={bad ? "Nhập dạng ngày/tháng/năm, vd 14/09/2026" : label}
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        style={{
          background: value ? "rgba(var(--brand-rgb),0.1)" : "transparent",
          border: bad ? "1px solid var(--red)" : "1px solid transparent",
          color: value ? "var(--cyan)" : "var(--text-secondary)",
          borderRadius: 6, padding: "4px 22px 4px 6px",
          fontSize: 11.5, outline: "none", fontFamily: "inherit", width: 100,
          ...(inputStyle || {}),
        }}
      />
      <button type="button" onClick={openPicker} aria-label={`Chọn ${label} trên lịch`} title="Chọn trên lịch"
        style={{ position: "absolute", right: 2, background: "none", border: "none", cursor: "pointer", padding: 2, fontSize: 11, lineHeight: 1, color: "var(--text-muted)" }}>📅</button>
      {/* hidden native picker, only used for its calendar popup */}
      <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none", border: 0, padding: 0 }} />
    </span>
  );
}

