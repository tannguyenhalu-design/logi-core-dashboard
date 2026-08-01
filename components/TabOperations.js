import { useState, useEffect } from "react";

const STAGES = [
  { id: 1, label: "1. BD Bàn Giao", color: "var(--blue)" },
  { id: 2, label: "2. Khảo Sát Onsite", color: "var(--purple)" },
  { id: 3, label: "3. Thống Nhất SOP", color: "var(--amber)" },
  { id: 4, label: "4. Go-Live / Onboard", color: "var(--green)" }
];

export default function TabOperations({ rawData }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeStageFilter, setActiveStageFilter] = useState("all");
  const [activePicFilter, setActivePicFilter] = useState("all");

  // Form states for creating a new project (Manager only)
  const [newProjName, setNewProjName] = useState("");
  const [newProjPic, setNewProjPic] = useState("");
  const [newProjBdLink, setNewProjBdLink] = useState("");
  const [newProjNotes, setNewProjNotes] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // Buffer state for edits
  const [editPic, setEditPic] = useState({});
  const [editBdLink, setEditBdLink] = useState({});
  const [editOnsiteLink, setEditOnsiteLink] = useState({});
  const [editSopLink, setEditSopLink] = useState({});
  const [editStage, setEditStage] = useState({});
  const [editNotes, setEditNotes] = useState({});
  const [savingId, setSavingId] = useState(null);

  const { user = {}, picMapping = {} } = rawData || {};
  const isManager = user.role === "manager";

  // List of unique PIC names from mapping tab
  const uniquePics = [...new Set(Object.values(picMapping))].sort();

  // Load projects from API
  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const json = await res.json();
      if (json.ok) {
        setProjects(json.projects || []);
      }
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // Handle adding new project (Manager only)
  const handleAddProject = async (e) => {
    e.preventDefault();
    if (!newProjName.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: newProjName.trim(),
          pic: newProjPic || null,
          bdLink: newProjBdLink.trim(),
          notes: newProjNotes.trim(),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setProjects(json.projects);
        // Clear form
        setNewProjName("");
        setNewProjPic("");
        setNewProjBdLink("");
        setNewProjNotes("");
        setShowAddForm(false);
      }
    } catch (err) {
      alert("Lỗi thêm dự án: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle updating project stages (Manager or assigned PIC)
  const handleUpdateProject = async (projId) => {
    setSavingId(projId);
    try {
      const payload = {
        action: "update",
        id: projId,
        pic: editPic[projId],
        bdLink: editBdLink[projId],
        onsiteLink: editOnsiteLink[projId],
        sopLink: editSopLink[projId],
        stage: editStage[projId] ? parseInt(editStage[projId]) : undefined,
        notes: editNotes[projId],
      };

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) {
        setProjects(json.projects);
        // Clear buffer
        const cleanBuffer = (state, setState) => {
          const s = { ...state };
          delete s[projId];
          setState(s);
        };
        cleanBuffer(editPic, setEditPic);
        cleanBuffer(editBdLink, setEditBdLink);
        cleanBuffer(editOnsiteLink, setEditOnsiteLink);
        cleanBuffer(editSopLink, setEditSopLink);
        cleanBuffer(editStage, setEditStage);
        cleanBuffer(editNotes, setEditNotes);
      }
    } catch (err) {
      alert("Lỗi cập nhật tiến độ: " + err.message);
    } finally {
      setSavingId(null);
    }
  };

  // Handle deleting project (Manager only)
  const handleDeleteProject = async (projId) => {
    if (!confirm("Bạn có chắc chắn muốn xóa dự án này khỏi pipeline?")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: projId }),
      });
      const json = await res.json();
      if (json.ok) {
        setProjects(json.projects);
      }
    } catch (err) {
      alert("Lỗi xóa dự án: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Set default PIC filter for PIC accounts
  useEffect(() => {
    if (user.role === "pic" && user.pic) {
      setActivePicFilter(user.pic);
    }
  }, [user]);

  // Filtering projects
  const filteredProjects = projects.filter(p => {
    if (activePicFilter !== "all" && p.pic !== activePicFilter) return false;
    if (activeStageFilter !== "all" && String(p.stage) !== activeStageFilter) return false;
    return true;
  });

  // Stats
  const totalCount = filteredProjects.length;
  const stage1Count = filteredProjects.filter(p => p.stage === 1).length;
  const stage2Count = filteredProjects.filter(p => p.stage === 2).length;
  const stage3Count = filteredProjects.filter(p => p.stage === 3).length;
  const stage4Count = filteredProjects.filter(p => p.stage === 4).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Panel */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Bảng Theo Dõi Onboarding Dự Án Mới</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Quy trình chuẩn bị launch dự án mới của team SD3 (Solution Điện Máy) trước khi Go-Live.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isManager && (
            <button 
              onClick={() => setShowAddForm(!showAddForm)}
              style={{ background: showAddForm ? "rgba(244,63,94,0.15)" : "var(--cyan)", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
            >
              {showAddForm ? "Đóng Form" : "+ Thêm Dự Án Mới"}
            </button>
          )}
          <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
            👤 Vai trò: <strong style={{ color: "var(--cyan)" }}>{user.role === "pic" ? "PIC Vận Hành" : "Manager (Quản lý)"}</strong>
          </div>
        </div>
      </div>

      {/* Add New Project Form (Manager only) */}
      {isManager && showAddForm && (
        <form onSubmit={handleAddProject} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 20, borderRadius: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 14, color: "var(--text-primary)" }}>Tạo Dự Án Mới vào Pipeline</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Tên Dự Án *</label>
              <input 
                type="text" 
                required
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="Ví dụ: Aqua B2C Expansion..."
                style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Phân công PIC</label>
              <select 
                value={newProjPic}
                onChange={(e) => setNewProjPic(e.target.value)}
                style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              >
                <option value="">-- Chưa phân công --</option>
                {uniquePics.map(pic => (
                  <option key={pic} value={pic}>{pic}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Link tài liệu BD bàn giao</label>
              <input 
                type="url" 
                value={newProjBdLink}
                onChange={(e) => setNewProjBdLink(e.target.value)}
                placeholder="Google Docs Link..."
                style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Ghi chú ban đầu</label>
            <textarea 
              rows={2}
              value={newProjNotes}
              onChange={(e) => setNewProjNotes(e.target.value)}
              placeholder="Nhập thông tin sơ bộ bàn giao từ BD..."
              style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13, resize: "none" }}
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            style={{ alignSelf: "flex-end", background: "var(--green)", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            Tạo Dự Án
          </button>
        </form>
      )}

      {/* Stats row */}
      <div className="grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 12, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>TỔNG DỰ ÁN</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: "var(--text-primary)", marginTop: 4 }}>{totalCount}</div>
        </div>
        <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", padding: 12, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>1. BD BÀN GIAO</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: "var(--blue)", marginTop: 4 }}>{stage1Count}</div>
        </div>
        <div style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)", padding: 12, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>2. ONSITE</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: "var(--purple)", marginTop: 4 }}>{stage2Count}</div>
        </div>
        <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", padding: 12, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>3. DUYỆT SOP</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: "var(--amber)", marginTop: 4 }}>{stage3Count}</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", padding: 12, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>4. READY / GO-LIVE</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: "var(--green)", marginTop: 4 }}>{stage4Count}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 12, borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Lọc theo PIC:</span>
          <select 
            value={activePicFilter} 
            onChange={(e) => setActivePicFilter(e.target.value)}
            disabled={user.role === "pic"}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
          >
            <option value="all">Tất cả PIC</option>
            {uniquePics.map(pic => (
              <option key={pic} value={pic}>{pic}</option>
            ))}
            <option value="">-- Chưa phân công --</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Giai đoạn:</span>
          <select 
            value={activeStageFilter} 
            onChange={(e) => setActiveStageFilter(e.target.value)}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
          >
            <option value="all">Tất cả bước</option>
            <option value="1">1. BD Bàn Giao</option>
            <option value="2">2. Khảo Sát Onsite</option>
            <option value="3">3. Thống Nhất SOP</option>
            <option value="4">4. Go-Live / Onboard</option>
          </select>
        </div>
      </div>

      {/* Projects pipeline listing */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {filteredProjects.map((p) => {
          // Resolve current editable states
          const currentStage = editStage[p.id] !== undefined ? parseInt(editStage[p.id]) : p.stage;
          const currentPic = editPic[p.id] !== undefined ? editPic[p.id] : (p.pic || "");
          const currentBdLink = editBdLink[p.id] !== undefined ? editBdLink[p.id] : p.bdLink;
          const currentOnsiteLink = editOnsiteLink[p.id] !== undefined ? editOnsiteLink[p.id] : p.onsiteLink;
          const currentSopLink = editSopLink[p.id] !== undefined ? editSopLink[p.id] : p.sopLink;
          const currentNotes = editNotes[p.id] !== undefined ? editNotes[p.id] : p.notes;

          const isAssignedPic = p.pic && p.pic === user.pic;
          const canEdit = isManager || isAssignedPic;

          return (
            <div 
              key={p.id}
              style={{ 
                background: "rgba(255,255,255,0.01)", 
                border: "1px solid var(--border)", 
                borderRadius: 12, 
                padding: 20, 
                display: "flex", 
                flexDirection: "column", 
                gap: 16,
                boxShadow: "0 4px 6px rgba(0,0,0,0.05)"
              }}
            >
              {/* Card Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                    🚀 {p.name}
                    {!canEdit && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4, color: "var(--text-muted)" }}>🔒 Chỉ Xem</span>}
                  </h4>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    PIC phụ trách: <strong style={{ color: p.pic ? "var(--cyan)" : "var(--red)" }}>{p.pic || "Chưa phân công"}</strong>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {isManager && (
                    <button 
                      onClick={() => handleDeleteProject(p.id)}
                      style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.2)", color: "var(--red)", padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
                    >
                      Xóa
                    </button>
                  )}
                  {canEdit && (
                    <button 
                      onClick={() => handleUpdateProject(p.id)}
                      disabled={savingId === p.id}
                      style={{ background: "var(--cyan)", border: "none", color: "#fff", padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      {savingId === p.id ? "Đang lưu..." : "Cập Nhật Tiến Độ"}
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Pipeline step bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.15)", padding: "12px 16px", borderRadius: 8, overflowX: "auto", gap: 10 }}>
                {STAGES.map((s, idx) => {
                  const isActive = currentStage >= s.id;
                  const isCurrent = currentStage === s.id;
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                      <div 
                        onClick={() => canEdit && setEditStage({ ...editStage, [p.id]: s.id })}
                        style={{ 
                          width: 24, 
                          height: 24, 
                          borderRadius: "50%", 
                          background: isActive ? s.color : "rgba(255,255,255,0.05)",
                          color: isActive ? "#fff" : "var(--text-muted)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: "bold",
                          cursor: canEdit ? "pointer" : "default",
                          border: isCurrent ? "2px solid #fff" : "none",
                          boxShadow: isCurrent ? `0 0 10px ${s.color}` : "none",
                          transition: "all 0.2s"
                        }}
                      >
                        {isActive ? "✓" : s.id}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? "#fff" : isActive ? "var(--text-primary)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {s.label}
                      </div>
                      {idx < 3 && (
                        <div style={{ flex: 1, height: 2, background: currentStage > s.id ? STAGES[idx+1].color : "rgba(255,255,255,0.05)", minWidth: 20 }} />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Input details & attachments */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                {/* Links area */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Step 1 doc link */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>1. Tài liệu BD Bàn Giao</label>
                      {p.bdLink && <a href={p.bdLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--cyan)", textDecoration: "underline" }}>Mở Link 🔗</a>}
                    </div>
                    <input 
                      type="url"
                      value={currentBdLink}
                      disabled={!canEdit}
                      onChange={(e) => setEditBdLink({ ...editBdLink, [p.id]: e.target.value })}
                      placeholder="Nhập link Docs bàn giao..."
                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
                    />
                  </div>

                  {/* Step 2 doc link */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>2. Báo Cáo Khảo Sát Onsite</label>
                      {p.onsiteLink && <a href={p.onsiteLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--cyan)", textDecoration: "underline" }}>Mở Link 🔗</a>}
                    </div>
                    <input 
                      type="url"
                      value={currentOnsiteLink}
                      disabled={!canEdit || currentStage < 2}
                      onChange={(e) => setEditOnsiteLink({ ...editOnsiteLink, [p.id]: e.target.value })}
                      placeholder={currentStage < 2 ? "Vui lòng hoàn thành bước 1" : "Nhập link Recao onsite..."}
                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
                    />
                  </div>

                  {/* Step 3 doc link */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>3. Tài liệu Quy Trình SOP</label>
                      {p.sopLink && <a href={p.sopLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--cyan)", textDecoration: "underline" }}>Mở Link 🔗</a>}
                    </div>
                    <input 
                      type="url"
                      value={currentSopLink}
                      disabled={!canEdit || currentStage < 3}
                      onChange={(e) => setEditSopLink({ ...editSopLink, [p.id]: e.target.value })}
                      placeholder={currentStage < 3 ? "Vui lòng hoàn thành bước 2" : "Nhập link quy trình SOP..."}
                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
                    />
                  </div>
                </div>

                {/* Notes & Assignment */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Re-assign PIC (Manager only) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Phân Công PIC (Chỉ Manager)</label>
                    <select 
                      value={currentPic}
                      disabled={!isManager}
                      onChange={(e) => setEditPic({ ...editPic, [p.id]: e.target.value })}
                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="">-- Chưa phân công --</option>
                      {uniquePics.map(pic => (
                        <option key={pic} value={pic}>{pic}</option>
                      ))}
                    </select>
                  </div>

                  {/* Notes text */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                    <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Nhật Ký Vận Hành / Ghi Chú</label>
                    <textarea 
                      rows={4}
                      value={currentNotes}
                      disabled={!canEdit}
                      onChange={(e) => setEditNotes({ ...editNotes, [p.id]: e.target.value })}
                      placeholder="Nhập tiến độ cập nhật chi tiết..."
                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 12, flex: 1, resize: "none" }}
                    />
                  </div>
                </div>
              </div>

              {/* History log footer */}
              {p.updatedAt && (
                <div style={{ borderTop: "1px dashed rgba(255,255,255,0.05)", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
                  <span>
                    📅 Khởi tạo ngày: {new Date(p.createdAt).toLocaleDateString("vi-VN")} bởi {p.createdBy}
                  </span>
                  <span>
                    Cập nhật lần cuối: <strong style={{ color: "var(--cyan)" }}>{p.updatedBy}</strong> ({new Date(p.updatedAt).toLocaleString("vi-VN")})
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {filteredProjects.length === 0 && (
          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", borderRadius: 12, padding: "50px 20px", textAlign: "center", color: "var(--text-muted)" }}>
            ✨ Không tìm thấy dự án nào đang trong pipeline với bộ lọc hiện tại!
          </div>
        )}
      </div>
    </div>
  );
}
