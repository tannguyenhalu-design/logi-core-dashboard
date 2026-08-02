/**
 * lib/csv-export.js
 * Client-side CSV export — no server round-trip, no new dependency.
 * UTF-8 BOM so Excel on Windows renders Vietnamese diacritics correctly.
 */
function csvEscape(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCSV(filename, columns, rows) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => csvEscape(typeof c.value === "function" ? c.value(row) : row[c.value])).join(","))
    .join("\n");
  const csv = "﻿" + header + "\n" + body;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
