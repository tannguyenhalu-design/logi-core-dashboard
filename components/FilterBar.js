/**
 * components/FilterBar.js
 * Multi-select filter bar for months and projects.
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

export default function FilterBar({
  selectedMonths, onMonthsChange,
  selectedProjects, onProjectsChange,
  availableProjects, userRole, userProject,
  filterMode, onFilterModeChange,
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
          { value: "pickup",    label: "Ngày lấy hàng" },
          { value: "delivered", label: "Ngày giao" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => onFilterModeChange(opt.value)}
            style={{
              padding: "6px 12px", fontSize: 12, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontWeight: filterMode === opt.value ? 600 : 400,
              background: filterMode === opt.value
                ? (opt.value === "delivered" ? "rgba(16,185,129,0.2)" : "rgba(20, 224, 196,0.2)")
                : "transparent",
              color: filterMode === opt.value
                ? (opt.value === "delivered" ? "var(--green)" : "var(--blue)")
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
      {isClientLocked && (
        <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
          🔒 Giới hạn: {userProject}
        </span>
      )}
    </div>
  );
}
