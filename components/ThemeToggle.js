/**
 * components/ThemeToggle.js
 * Light/dark theme switch. Persists to localStorage; pages/_document.js
 * applies the stored value before hydration to avoid a flash of the
 * wrong theme.
 */
import { useEffect, useState } from "react";

export function getStoredTheme() {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem("theme") || "dark";
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem("theme", theme);
}

export default function ThemeToggle({ style }) {
  const [theme, setThemeState] = useState("dark");

  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setThemeState(next);
    applyTheme(next);
  };

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 13, color: "var(--text-muted)", background: "none",
        border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit",
        padding: "8px 10px", borderRadius: 6, transition: "all 0.2s", width: "100%",
        ...style,
      }}
      onMouseOver={(e) => (e.currentTarget.style.color = "var(--cyan)")}
      onMouseOut={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
    >
      {theme === "dark" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      )}
      {theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
    </button>
  );
}
