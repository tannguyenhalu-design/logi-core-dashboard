/**
 * components/TabAuditLog.js — Manager-only: change history.
 * Backed by /api/audit-log (AuditLog tab in the projects Google Sheet).
 */
import { useState, useEffect } from "react";
import TruckLoader from "./TruckLoader";

const ACTION_LABELS = {
  "project.create": "Tạo dự án",
  "project.update": "Sửa dự án",
  "user.create": "Thêm người dùng",
  "user.role_update": "Đổi vai trò",
};

function ActionBadge({ action }) {
  const isUser = action.startsWith("user.");
  const color = isUser ? "var(--purple)" : "var(--cyan)";
  const bg = isUser ? "rgba(139,92,246,0.15)" : "rgba(20,224,196,0.15)";
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: bg, color, whiteSpace: "nowrap" }}>
      {ACTION_LABELS[action] || action}
    </span>
  );
}

function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDetails(detailsStr) {
  if (!detailsStr) return "—";
  try {
    const obj = JSON.parse(detailsStr);
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(",") : v}`)
      .join(" · ");
  } catch {
    return detailsStr;
  }
}

export default function TabAuditLog() {
  const [logs, setLogs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audit-log");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi tải nhật ký");
      setLogs(json.logs);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  if (loading) return <TruckLoader />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Nhật Ký Hoạt Động</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Lịch sử thay đổi dự án và phân quyền người dùng — ai sửa gì, lúc nào.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
        >
          🔄 Tải Lại
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", borderRadius: 10, padding: 16, color: "var(--red)" }}>
          Lỗi: {error}
        </div>
      )}

      <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Thời gian</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Người thực hiện</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Hành động</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Đối tượng</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {(logs || []).map((l, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "10px 8px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{formatTimestamp(l.timestamp)}</td>
                <td style={{ padding: "10px 8px", fontWeight: 600 }}>{l.actor}</td>
                <td style={{ padding: "10px 8px" }}><ActionBadge action={l.action} /></td>
                <td style={{ padding: "10px 8px", color: "var(--cyan)" }}>{l.target}</td>
                <td style={{ padding: "10px 8px", color: "var(--text-muted)", fontSize: 12 }}>{formatDetails(l.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {(!logs || logs.length === 0) && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>
            Chưa có hoạt động nào được ghi nhận.
          </div>
        )}
      </div>
    </div>
  );
}
