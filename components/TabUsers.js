/**
 * components/TabUsers.js — Manager-only: approve accounts & assign roles.
 * Backed by /api/admin-users (Users tab in the projects Google Sheet).
 */
import { useState, useEffect } from "react";
import TruckLoader from "./TruckLoader";

const ROLE_LABELS = {
  pending: "Chờ duyệt",
  manager: "Quản trị",
  sd3: "Chuyên viên SD",
  cs: "CS",
};

const TAB_OPTIONS = [
  { value: "ltl", label: "LTL Dashboard" },
  { value: "operations", label: "Vận hành SD3" },
  { value: "tachtrip", label: "Tách Chuyến" },
];

function defaultTabsForRole(role) {
  if (role === "manager") return ["ltl", "operations", "tachtrip"];
  if (role === "sd3") return ["ltl", "operations", "tachtrip"];
  if (role === "cs") return ["ltl"];
  return [];
}

function TabCheckboxes({ tabs, disabled, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {TAB_OPTIONS.map((opt) => (
        <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: disabled ? "var(--text-muted)" : "var(--text-secondary)", cursor: disabled ? "not-allowed" : "pointer" }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={tabs.includes(opt.value)}
            onChange={(e) => {
              const next = e.target.checked ? [...tabs, opt.value] : tabs.filter((t) => t !== opt.value);
              onChange(next);
            }}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function RoleBadge({ role }) {
  const color = role === "pending" ? "var(--amber)" : role === "manager" ? "var(--cyan)" : role === "sd3" ? "var(--blue)" : role === "cs" ? "var(--green)" : "var(--purple)";
  const bg = role === "pending" ? "rgba(245,158,11,0.15)" : role === "manager" ? "rgba(20,224,196,0.15)" : role === "sd3" ? "rgba(59,130,246,0.15)" : role === "cs" ? "rgba(16,185,129,0.15)" : "rgba(139,92,246,0.15)";
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("manager");
  const [newPic, setNewPic] = useState("");
  const [newProject, setNewProject] = useState("");
  const [newTabs, setNewTabs] = useState(defaultTabsForRole("manager"));
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

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
        nextDrafts[u.email] = { role: u.role, pic: u.pic || "", project: u.project || "", tabs: u.tabs || [] };
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
        body: JSON.stringify({ email, role: draft.role, pic: draft.pic, project: draft.project, tabs: draft.tabs }),
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

  const handleAddUser = async (e) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email.endsWith("@ghn.vn")) {
      setAddError("Chỉ chấp nhận email @ghn.vn");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: newRole, pic: newPic, project: newProject, tabs: newTabs }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Thêm thất bại");
      setShowAddModal(false);
      setNewEmail("");
      setNewRole("manager");
      setNewPic("");
      setNewProject("");
      setNewTabs(defaultTabsForRole("manager"));
      await fetchUsers();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <TruckLoader />;

  const pendingCount = (users || []).filter((u) => u.role === "pending").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Quản lý người dùng</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Mọi email @ghn.vn có thể tự đăng ký, nhưng chỉ xem được dữ liệu sau khi được duyệt và gán vai trò ở đây.
            {pendingCount > 0 && (
              <span style={{ color: "var(--amber)", fontWeight: 600 }}> Đang có {pendingCount} tài khoản chờ duyệt.</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{ background: "var(--cyan)", color: "#04211d", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
        >
          + Thêm người dùng
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
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Email</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Vai trò</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Xem được tab</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Tên (khớp mapping SD/CS)</th>
              <th style={{ textAlign: "center", padding: "12px 8px" }}>Tác vụ</th>
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => {
              const draft = drafts[u.email] || { role: u.role, pic: "", project: "", tabs: u.tabs || [] };
              const draftTabs = draft.tabs || [];
              const origTabs = u.tabs || [];
              const tabsChanged = draftTabs.length !== origTabs.length || draftTabs.some((t) => !origTabs.includes(t));
              const dirty =
                draft.role !== u.role || (draft.pic || "") !== (u.pic || "") || (draft.project || "") !== (u.project || "") || tabsChanged;
              return (
                <tr key={u.email} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "12px 8px", fontWeight: 600 }}>
                    {u.email} {u.role === "pending" && <RoleBadge role="pending" />}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <select
                      value={draft.role}
                      onChange={(e) => updateDraft(u.email, { role: e.target.value, tabs: defaultTabsForRole(e.target.value) })}
                      style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="pending">Chờ duyệt</option>
                      <option value="manager">Quản trị</option>
                      <option value="sd3">Chuyên viên SD</option>
                      <option value="cs">CS</option>
                    </select>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <TabCheckboxes
                      tabs={draft.role === "manager" ? ["ltl", "operations"] : draftTabs}
                      disabled={draft.role === "manager"}
                      onChange={(next) => updateDraft(u.email, { tabs: next })}
                    />
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <input
                      type="text"
                      value={draft.pic}
                      disabled={draft.role === "pending"}
                      onChange={(e) => updateDraft(u.email, { pic: e.target.value })}
                      placeholder="Ví dụ: Duy Tú"
                      style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 6, fontSize: 12, width: 140 }}
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

      {showAddModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--input-bg)", border: "1px solid var(--border)", padding: 24, borderRadius: 16, width: "90%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>➕ Thêm người dùng</h4>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>&times;</button>
            </div>

            {addError && (
              <div style={{ background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--red)" }}>
                {addError}
              </div>
            )}

            <form onSubmit={handleAddUser} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Email @ghn.vn *</label>
                <input
                  type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="vd: tutd@ghn.vn"
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Vai trò</label>
                <select
                  value={newRole}
                  onChange={(e) => { setNewRole(e.target.value); setNewTabs(defaultTabsForRole(e.target.value)); }}
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                >
                  <option value="manager">Quản trị</option>
                  <option value="sd3">Chuyên viên SD</option>
                  <option value="cs">CS</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Xem được tab</label>
                <TabCheckboxes
                  tabs={newRole === "manager" ? ["ltl", "operations"] : newTabs}
                  disabled={newRole === "manager"}
                  onChange={setNewTabs}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Tên (khớp sheet mapping SD/CS)</label>
                <input
                  type="text" value={newPic} onChange={(e) => setNewPic(e.target.value)}
                  placeholder="Ví dụ: Duy Tú"
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)" }}>
                Người này sẽ tự đặt mật khẩu ở lần đăng nhập đầu tiên bằng chính email trên.
              </p>

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  type="button" onClick={() => setShowAddModal(false)}
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit" disabled={adding}
                  style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 24px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                >
                  {adding ? "Đang thêm..." : "Thêm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
