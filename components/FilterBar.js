/**
 * components/FilterBar.js
 * Filter bar: Ngày lấy / Ngày giao, months, projects, and a từ → đến date
 * range typed/shown as dd/mm/yyyy (quick presets removed 28/09).
 * When role='client', project filter is locked to user's assigned project.
 */
import { useState, useRef, useEffect } from "react";

const MONTHS = [
  { value: 1, label: "Tháng 1" }, { value: 2, label: "Tháng 2" },
  { value: 3, label: "Tháng 3" }, { value: 4, label: "Tháng 4" },
  { value: 5, label: "Tháng 5" }, { value: 6, label: "Tháng 6" },
  { value: 7, label: "Tháng 7" }, { value: 8, label: "Tháng 8" },
  { value: 9, label: "Tháng 9" }, { value: 10, label: "Tháng 10" },
  { value: 11, label: "Tháng 11" }, { value: 12, label: "Tháng 12" },
];

function MultiSelect({ label, options, selected, onChange, locked, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (val) => {
    if (locked) return;
    if (selected.includes(val)) {
      onChange(selected.filter((v) => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const selectAll = () => {
    if (locked) return;
    onChange(options.map((o) => o.value));
  };

  const clearAll = () => {
    if (locked) return;
    onChange([]);
  };

  const displayText =
    selected.length === 0
      ? placeholder
      : selected.length === options.length
      ? `Tất cả (${options.length})`
      : selected.length <= 3
      ? options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(", ")
      : `${selected.length} được chọn`;

  return (
    <div className="ms-wrapper" ref={ref}>
      <div
        className={`ms-trigger${locked ? " locked" : ""}`}
        onClick={() => !locked && setOpen(!open)}
        title={locked ? "Bị khoá theo vai trò" : ""}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, marginRight: 6 }}>{label}:</span>
          {displayText}
        </span>
        {!locked && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
        {locked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        )}
      </div>

      {open && !locked && (
        <div className="ms-dropdown">
          {/* Select all / Clear controls */}
          <div style={{ display: "flex", gap: 8, padding: "8px 16px 4px", borderBottom: "1px solid var(--border)" }}>
            <button onClick={selectAll} style={{ background: "none", border: "none", color: "var(--cyan)", fontSize: 12, cursor: "pointer", padding: 0 }}>
              Chọn tất cả
            </button>
            <span style={{ color: "var(--border)", fontSize: 12 }}>|</span>
            <button onClick={clearAll} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", padding: 0 }}>
              Bỏ chọn
            </button>
          </div>
          {options.map((opt) => (
            <div className="ms-option" key={opt.value} onClick={() => toggle(opt.value)}>
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => {}}
                onClick={(e) => e.stopPropagation()}
              />
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Date input shown as dd/mm/yyyy whatever the browser language (the native
// <input type="date"> showed mm/dd/yyyy — user 28/09). Type "14/09/2026" (or
// 14/9/26) and press Enter / leave the box, or click 📅 to open the calendar.
// value / onChange use yyyy-mm-dd, like the API.
const toDMY = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
function parseDMY(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]), d = Number(m[1]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
function DateField({ value, onChange, placeholder, label }) {
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
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
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

export default function FilterBar({
  selectedMonths, onMonthsChange,
  selectedProjects, onProjectsChange,
  availableProjects, userRole, userProject,
  filterMode, onFilterModeChange,
  dateFrom, dateTo, onDateChange,
}) {
  const projectOptions = availableProjects.map((p) => ({ value: p, label: p }));
  const isClientLocked = userRole === "client";

  return (
    <div className="filter-bar">
      {/* Filter mode toggle */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        background: "var(--panel-glow)", borderRadius: 8,
        border: "1px solid var(--border)", overflow: "hidden", flexShrink: 0,
      }}>
        {[
          { value: "pickup",    label: "Ngày lấy" },
          { value: "delivered", label: "Ngày giao" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => onFilterModeChange(opt.value)}
            style={{
              padding: "6px 10px", fontSize: 12, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontWeight: filterMode === opt.value ? 600 : 400,
              background: filterMode === opt.value
                ? (opt.value === "delivered" ? "rgba(16,185,129,0.2)" : "rgba(var(--brand-rgb),0.2)")
                : "transparent",
              color: filterMode === opt.value
                ? (opt.value === "delivered" ? "var(--green)" : "var(--cyan)")
                : "var(--text-muted)",
              transition: "all 0.15s",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <MultiSelect
        label="Tháng"
        options={MONTHS}
        selected={selectedMonths}
        onChange={onMonthsChange}
        locked={false}
        placeholder="Tất cả tháng"
      />
      <MultiSelect
        label="Dự án"
        options={projectOptions}
        selected={selectedProjects}
        onChange={onProjectsChange}
        locked={isClientLocked}
        placeholder="Tất cả dự án"
      />

      {/* Date range (user 28/09: only "từ ngày → đến ngày" in ngày/tháng/năm; the
          Hôm nay / 3 ngày / 7 ngày / Tháng này / Tất cả buttons were removed) */}
      {onDateChange && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--panel-glow)", padding: "2px", borderRadius: 8, border: "1px solid var(--border)" }}>
          <DateField label="Từ ngày" placeholder="Từ ngày" value={dateFrom || ""} onChange={(v) => onDateChange(v, dateTo || "")} />
          <span style={{ color: "var(--border)", fontSize: 11, fontWeight: 700 }}>→</span>
          <DateField label="Đến ngày" placeholder="Đến ngày" value={dateTo || ""} onChange={(v) => onDateChange(dateFrom || "", v)} />
          {(dateFrom || dateTo) && (
            <button type="button" onClick={() => onDateChange("", "")} title="Xoá khoảng ngày" aria-label="Xoá khoảng ngày"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "2px 6px" }}>✕</button>
          )}
        </div>
      )}

      {isClientLocked && (
        <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
          🔒 Giới hạn: {userProject}
        </span>
      )}
    </div>
  );
}
