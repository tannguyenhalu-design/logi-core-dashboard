/**
 * components/TabUsers.js — Manager-only: approve accounts & assign roles.
 * Backed by /api/admin-users (Users tab in the projects Google Sheet).
 * Identity is GHN SSO EmployeeId once someone has logged in at least
 * once; before that, a manager can pre-provision access by full name.
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

function rowKey(u) {
  return u.employeeId || `name:${u.name}`;
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
  const bg = role === "pending" ? "rgba(245,158,11,0.15)" : role === "manager" ? "rgba(var(--brand-rgb),0.15)" : role === "sd3" ? "rgba(59,130,246,0.15)" : role === "cs" ? "rgba(16,185,129,0.15)" : "rgba(139,92,246,0.15)";
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
  const [drafts, setDrafts] = useState({}); // rowKey -> { role, pic, project, tabs }
  const [savingKey, setSavingKey] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newName, setNewName] = useState("");
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
        nextDrafts[rowKey(u)] = { role: u.role, pic: u.pic || "", project: u.project || "", tabs: u.tabs || [] };
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

  const updateDraft = (key, patch) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), ...patch },
    }));
  };

  const saveUser = async (u) => {
    const key = rowKey(u);
    const draft = drafts[key];
    if (!draft) return;
    setSavingKey(key);
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: u.employeeId,
          name: u.name,
          role: draft.role,
          pic: draft.pic,
          project: draft.project,
          tabs: draft.tabs,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi lưu");
      await fetchUsers();
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newEmployeeId.trim() && !newName.trim()) {
      setAddError("Vui lòng nhập Mã số nhân viên hoặc Họ tên");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: newEmployeeId.trim(),
          name: newName.trim(),
          role: newRole,
          pic: newPic.trim(),
          project: newProject.trim(),
          tabs: newRole === "manager" ? ["ltl", "operations", "tachtrip"] : newTabs,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi thêm người dùng");
      setNewEmployeeId("");
      setNewName("");
      setNewPic("");
      setNewProject("");
      setNewRole("manager");
      setNewTabs(defaultTabsForRole("manager"));
      setShowAddModal(false);
      await fetchUsers();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <TruckLoader text="Đang tải danh sách người dùng..." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card-bg)", padding: "16px 20px", borderRadius: 12, border: "1px solid var(--border)" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>👥 Phân quyền & Quản lý Người dùng</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            Dành cho Quản trị viên cấp quyền truy cập các Tab và gán tên PIC cho nhân sự.
          </p>
        </div>
        <button
          onClick={() => {
            setNewEmployeeId("");
            setNewName("");
            setNewPic("");
            setNewProject("");
            setAddError(null);
            setShowAddModal(true);
          }}
          style={{ background: "var(--brand-glow)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          ➕ Thêm người dùng
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", borderRadius: 10, padding: 14, color: "var(--red)", fontSize: 13 }}>
          Lỗi: {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: "var(--card-bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
          <thead>
            <tr style={{ background: "var(--panel-glow)", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <th style={{ padding: "12px 14px", width: "10%" }}>Mã NV</th>
              <th style={{ padding: "12px 14px", width: "20%" }}>Tên theo SSO</th>
              <th style={{ padding: "12px 14px", width: "15%" }}>Vai trò</th>
              <th style={{ padding: "12px 14px", width: "25%" }}>Xem được tab nào?</th>
              <th style={{ padding: "12px 14px", width: "18%" }}>Tên thường gọi (PIC)</th>
              <th style={{ padding: "12px 14px", textAlign: "center", width: "12%" }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => {
              const key = rowKey(u);
              const draft = drafts[key] || { role: u.role, pic: u.pic || "", project: u.project || "", tabs: u.tabs || [] };
              const isManager = draft.role === "manager";
              const isPending = draft.role === "pending";

              const dirty =
                draft.role !== u.role ||
                draft.pic !== (u.pic || "") ||
                draft.project !== (u.project || "") ||
                JSON.stringify(draft.tabs.sort()) !== JSON.stringify((u.tabs || []).sort());

              return (
                <tr key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 14px", fontFamily: "monospace", color: "var(--brand-glow)", fontWeight: 600 }}>
                    {u.employeeId || "Chưa tạo"}
                  </td>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-primary)" }}>
                    {u.name || u.email || "Chưa cập nhật"}
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <RoleBadge role={u.role} />
                      <select
                        value={draft.role}
                        onChange={(e) => {
                          const r = e.target.value;
                          updateDraft(key, { role: r, tabs: defaultTabsForRole(r) });
                        }}
                        style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
                      >
                        <option value="pending">Chờ duyệt</option>
                        <option value="manager">Quản trị</option>
                        <option value="sd3">Chuyên viên SD</option>
                        <option value="cs">CS</option>
                      </select>
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    {isManager ? (
                      <span style={{ fontSize: 12, color: "var(--cyan)", fontWeight: 600 }}>Quản trị: Xem tất cả Tab</span>
                    ) : isPending ? (
                      <span style={{ fontSize: 12, color: "var(--amber)" }}>Chờ phê duyệt vai trò</span>
                    ) : (
                      <TabCheckboxes
                        tabs={draft.tabs}
                        disabled={false}
                        onChange={(next) => updateDraft(key, { tabs: next })}
                      />
                    )}
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <input
                      type="text"
                      value={draft.pic}
                      onChange={(e) => updateDraft(key, { pic: e.target.value })}
                      placeholder="Ví dụ: Thủy Vi, Duy Tú"
                      style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 10px", borderRadius: 6, fontSize: 12.5, width: "100%" }}
                    />
                  </td>
                  <td style={{ padding: "12px 14px", textAlign: "center" }}>
                    <button
                      onClick={() => saveUser(u)}
                      disabled={!dirty || savingKey === key}
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
                      {savingKey === key ? "Đang lưu..." : "Lưu"}
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

      {/* Modal Form Add User */}
      {showAddModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--input-bg)", border: "1px solid var(--border)", padding: 24, borderRadius: 16, width: "90%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>➕ Thêm người dùng mới</h4>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>&times;</button>
            </div>

            {addError && (
              <div style={{ background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--red)" }}>
                {addError}
              </div>
            )}

            <form onSubmit={handleAddUser} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Field 1: Mã số nhân viên */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>1. Mã số nhân viên (Employee ID)</label>
                <input
                  type="text"
                  value={newEmployeeId}
                  onChange={(e) => setNewEmployeeId(e.target.value)}
                  placeholder="Ví dụ: 3182352 hoặc 3117379"
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                />
              </div>

              {/* Field 2: Tên theo SSO */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>2. Tên theo GHN SSO (Họ và tên đầy đủ) *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ví dụ: Diệp Thủy Vi hoặc Nguyễn Thành Tân"
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                />
              </div>

              {/* Field 3: Tên thường gọi (PIC) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>3. Tên thường gọi / PIC (khớp với Sheet Mapping)</label>
                <input
                  type="text"
                  value={newPic}
                  onChange={(e) => setNewPic(e.target.value)}
                  placeholder="Ví dụ: Thủy Vi, Duy Tú, Kim Diện"
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                />
              </div>

              {/* Field 4: Vai trò */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>4. Vai trò</label>
                <select
                  value={newRole}
                  onChange={(e) => { setNewRole(e.target.value); setNewTabs(defaultTabsForRole(e.target.value)); }}
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                >
                  <option value="manager">Quản trị (Manager)</option>
                  <option value="sd3">Chuyên viên SD</option>
                  <option value="cs">CS</option>
                </select>
              </div>

              {/* Field 5: Xem được tab nào */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>5. Xem được tab nào?</label>
                <TabCheckboxes
                  tabs={newRole === "manager" ? ["ltl", "operations", "tachtrip"] : newTabs}
                  disabled={newRole === "manager"}
                  onChange={setNewTabs}
                />
              </div>

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
