/**
 * components/TabUsers.js — Manager-only: approve accounts & assign roles.
 * Backed by /api/admin-users (Users tab in the projects Google Sheet).
 */
import { useState, useEffect } from "react";
import TruckLoader from "./TruckLoader";

const ROLE_LABELS = {
  pending: "Chờ duyệt",
  manager: "Quản lý",
  pic: "Chuyên viên vận hành (PIC)",
  client: "Khách hàng",
};

function RoleBadge({ role }) {
  const color = role === "pending" ? "var(--amber)" : role === "manager" ? "var(--cyan)" : role === "pic" ? "var(--green)" : "var(--purple)";
  const bg = role === "pending" ? "rgba(245,158,11,0.15)" : role === "manager" ? "rgba(20,224,196,0.15)" : role === "pic" ? "rgba(16,185,129,0.15)" : "rgba(139,92,246,0.15)";
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: bg, color }}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

export default function TabUsers() {
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({}); // email -> { role, pic, project }
  const [savingEmail, setSavingEmail] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-users");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi tải danh sách");
      setUsers(json.users);
      const nextDrafts = {};
      json.users.forEach((u) => {
        nextDrafts[u.email] = { role: u.role, pic: u.pic || "", project: u.project || "" };
      });
      setDrafts(nextDrafts);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const updateDraft = (email, patch) => {
    setDrafts((prev) => ({ ...prev, [email]: { ...prev[email], ...patch } }));
  };

  const saveUser = async (email) => {
    const draft = drafts[email];
    setSavingEmail(email);
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: draft.role, pic: draft.pic, project: draft.project }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lưu thất bại");
      await fetchUsers();
    } catch (e) {
      alert("Lỗi lưu: " + e.message);
    } finally {
      setSavingEmail(null);
    }
  };

  if (loading) return <TruckLoader />;

  const pendingCount = (users || []).filter((u) => u.role === "pending").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Quản lý người dùng</h3>
        <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
          Mọi email @ghn.vn có thể tự đăng ký, nhưng chỉ xem được dữ liệu sau khi được duyệt và gán vai trò ở đây.
          {pendingCount > 0 && (
            <span style={{ color: "var(--amber)", fontWeight: 600 }}> Đang có {pendingCount} tài khoản chờ duyệt.</span>
          )}
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", borderRadius: 10, padding: 16, color: "var(--red)" }}>
          Lỗi: {error}
        </div>
      )}

      <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Email</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Vai trò</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Tên PIC (nếu là PIC)</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Dự án (nếu là Khách hàng)</th>
              <th style={{ textAlign: "center", padding: "12px 8px" }}>Tác vụ</th>
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => {
              const draft = drafts[u.email] || { role: u.role, pic: "", project: "" };
              const dirty =
                draft.role !== u.role || (draft.pic || "") !== (u.pic || "") || (draft.project || "") !== (u.project || "");
              return (
                <tr key={u.email} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "12px 8px", fontWeight: 600 }}>
                    {u.email} {u.role === "pending" && <RoleBadge role="pending" />}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <select
                      value={draft.role}
                      onChange={(e) => updateDraft(u.email, { role: e.target.value })}
                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="pending">Chờ duyệt</option>
                      <option value="manager">Quản lý</option>
                      <option value="pic">Chuyên viên vận hành (PIC)</option>
                      <option value="client">Khách hàng</option>
                    </select>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <input
                      type="text"
                      value={draft.pic}
                      disabled={draft.role !== "pic"}
                      onChange={(e) => updateDraft(u.email, { pic: e.target.value })}
                      placeholder="Ví dụ: Duy Tú"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 6, fontSize: 12, width: 140 }}
                    />
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <input
                      type="text"
                      value={draft.project}
                      disabled={draft.role !== "client"}
                      onChange={(e) => updateDraft(u.email, { project: e.target.value })}
                      placeholder="Ví dụ: Samsung"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 6, fontSize: 12, width: 140 }}
                    />
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "center" }}>
                    <button
                      onClick={() => saveUser(u.email)}
                      disabled={!dirty || savingEmail === u.email}
                      style={{
                        background: dirty ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                        color: dirty ? "var(--green)" : "var(--text-muted)",
                        border: `1px solid ${dirty ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)"}`,
                        padding: "6px 14px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: dirty ? "pointer" : "not-allowed",
                      }}
                    >
                      {savingEmail === u.email ? "Đang lưu..." : "Lưu"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {(!users || users.length === 0) && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>
            Chưa có tài khoản nào đăng ký.
          </div>
        )}
      </div>
    </div>
  );
}
