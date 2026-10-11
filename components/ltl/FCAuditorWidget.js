"use client";
import { useState } from "react";

const REASON_TYPES = [
  { value: "pause", label: "Khách tạm dừng kinh doanh" },
  { value: "explain", label: "Giải thích / ghi chú" },
];

function ScoreRing({ score }) {
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const r = 18, cx = 22, cy = 22, stroke = 4;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <svg width="44" height="44" viewBox="0 0 44 44" style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(150,150,150,0.2)" strokeWidth={stroke} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ * 0.25}
          strokeLinecap="round" style={{ transition: "stroke-dasharray 0.5s ease" }} />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="11" fontWeight="700" fontFamily="inherit">{score}</text>
      </svg>
      <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.2 }}>/ 100</span>
    </div>
  );
}

function AlertRow({ alert, eventDate, onAnnotationSaved, onAnnotationDeleted }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(alert.annotation?.reason || "");
  const [reasonType, setReasonType] = useState(alert.annotation?.reasonType || "pause");
  const [scope, setScope] = useState(alert.annotation?.scope || "event");
  const [saving, setSaving] = useState(false);

  const badge =
    alert.type === "red"
      ? { bg: "#fef2f2", border: "#fca5a5", text: "#b91c1c", label: "RED" }
      : { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", label: "YELLOW" };

  async function handleSave() {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/fc-annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: alert.client, reason: reason.trim(), reasonType, scope, eventDate }),
      });
      const data = await res.json();
      if (data.ok) onAnnotationSaved(data.annotation);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  async function handleDelete() {
    if (!alert.annotation?.id) return;
    await fetch(`/api/fc-annotations?id=${alert.annotation.id}`, { method: "DELETE" });
    onAnnotationDeleted(alert.annotation.id);
  }

  return (
    <div style={{ marginBottom: 8, borderRadius: 6, border: `1px solid ${badge.border}`, background: badge.bg, padding: "8px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 11, color: badge.text, background: "white", border: `1px solid ${badge.border}`, borderRadius: 4, padding: "1px 6px" }}>{badge.label}</span>
          <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alert.client}</span>
          <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
            FC {alert.fcOrders} đơn → thực tế {alert.actualOrders} đơn
            {alert.type === "yellow" && ` (lệch ${alert.deviation}%)`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {alert.annotated && (
            <span style={{ fontSize: 11, color: "#16a34a", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 4, padding: "1px 6px" }}>✓ Đã ghi nhận</span>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}
          >
            {open ? "Đóng" : alert.annotated ? "Sửa" : "Ghi nhận"}
          </button>
          {alert.annotated && (
            <button
              onClick={handleDelete}
              style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", cursor: "pointer" }}
            >
              Xóa
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${badge.border}` }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <select
              value={reasonType}
              onChange={(e) => setReasonType(e.target.value)}
              style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #d1d5db" }}
            >
              {REASON_TYPES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #d1d5db" }}
            >
              <option value="event">Chỉ event này</option>
              <option value="global">Toàn cục / Các event tương lai</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lý do cụ thể..."
              style={{ flex: 1, fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #d1d5db" }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !reason.trim()}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "none", background: saving ? "#9ca3af" : "#2563eb", color: "white", cursor: saving ? "default" : "pointer" }}
            >
              {saving ? "..." : "Lưu"}
            </button>
          </div>
          {alert.annotation && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
              Ghi nhận bởi {alert.annotation.createdBy} lúc {new Date(alert.annotation.timestamp).toLocaleString("vi-VN")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FCAuditorWidget({ auditResult, eventDate, onAnnotationSaved, onAnnotationDeleted }) {
  const [collapsed, setCollapsed] = useState(!auditResult || auditResult.alerts.filter((a) => a.type === "red" && !a.annotated).length === 0);

  if (!auditResult) return null;

  const { alerts, score, commentary } = auditResult;
  const hasRed = alerts.some((a) => a.type === "red" && !a.annotated);

  return (
    <div style={{
      margin: "12px 0 16px",
      borderRadius: 12,
      border: `1.5px solid ${hasRed ? "#fca5a5" : "#e5e7eb"}`,
      background: hasRed ? "#fff8f8" : "#f9fafb",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>🔍 AI FC Auditor</span>
          {alerts.length > 0 && (
            <span style={{ fontSize: 11.5, padding: "2px 9px", borderRadius: 10, fontWeight: 600, background: hasRed ? "#fee2e2" : "#fef3c7", color: hasRed ? "#b91c1c" : "#92400e", border: `1px solid ${hasRed ? "#fca5a5" : "#fcd34d"}` }}>
              {alerts.filter((a) => !a.annotated).length} cảnh báo
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ScoreRing score={score} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{collapsed ? "▼" : "▲"}</span>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: "0 14px 14px" }}>
          {commentary.map((c, i) => (
            <p key={i} style={{ margin: "0 0 6px", fontSize: 12, color: "#374151" }}>{c}</p>
          ))}

          {alerts.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {alerts.map((alert) => (
                <AlertRow
                  key={`${alert.client}-${alert.type}`}
                  alert={alert}
                  eventDate={eventDate}
                  onAnnotationSaved={onAnnotationSaved}
                  onAnnotationDeleted={onAnnotationDeleted}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
