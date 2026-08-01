import { useState, useEffect } from "react";

const PIC_NAMES = {
  "tutd@ghn.vn": "Duy Tú",
  "diennk@giaohangnhanh.vn": "Kim Diện",
  "datnt2@ghn.vn": "Nguyễn Tiến Đạt"
};

function formatRevenue(val) {
  if (!val) return "—";
  const numStr = String(val).replace(/[^\d]/g, "");
  if (!numStr) return val;
  const num = parseInt(numStr);
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(1).replace(".0", "") + " Tỷđ";
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(0) + " Trđ";
  }
  return num.toLocaleString("vi-VN") + "đ";
}

export default function TabOperations({ rawData }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [picFilter, setPicFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // User session state returned from API
  const [currentUser, setCurrentUser] = useState({ role: "manager", pic: null });

  // Expandable row project name state
  const [expandedId, setExpandedId] = useState(null);

  // Buffer state for edits of each project (grouped by project name)
  const [editPic, setEditPic] = useState({});
  const [editStatus, setEditStatus] = useState({});
  const [editJob, setEditJob] = useState({});
  const [editExpectedOb, setEditExpectedOb] = useState({});
  const [editRevenue, setEditRevenue] = useState({});
  const [editSopLink, setEditSopLink] = useState({});
  const [editModel, setEditModel] = useState({});
  const [editRecapStatus, setEditRecapStatus] = useState({});
  const [editRecapLink, setEditRecapLink] = useState({});
  const [editSopStatus, setEditSopStatus] = useState({});
  const [editKickoffStatus, setEditKickoffStatus] = useState({});
  const [editNotes, setEditNotes] = useState({});
  const [savingName, setSavingName] = useState(null);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const json = await res.json();
      if (json.ok) {
        setProjects(json.projects || []);
        if (json.user) {
          setCurrentUser(json.user);
        }
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

  // Sync default filter for PICs
  useEffect(() => {
    if (currentUser.role === "pic" && currentUser.pic) {
      setPicFilter(currentUser.pic);
    }
  }, [currentUser]);

  // Unique list of PIC emails/names in sheet
  const uniquePics = [...new Set(projects.map(p => p.pic).filter(Boolean))].sort();

  // Unique list of Operating Models
  const uniqueModels = [...new Set(projects.map(p => p.model).filter(Boolean))].sort();

  // Unique list of Statuses
  const uniqueStatuses = [...new Set(projects.map(p => p.status).filter(Boolean))].sort();

  // Filter projects list
  const filteredProjects = projects.filter(p => {
    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const name = String(p.name || "").toLowerCase();
      const checklist = String(p.checklist || "").toLowerCase();
      const notes = String(p.notes || "").toLowerCase();
      const sla = String(p.slaLogic || "").toLowerCase();
      if (!name.includes(q) && !checklist.includes(q) && !notes.includes(q) && !sla.includes(q)) return false;
    }

    // 2. PIC filter
    if (picFilter !== "all" && p.pic !== picFilter) return false;

    // 3. Model filter
    if (modelFilter !== "all" && p.model !== modelFilter) return false;

    // 4. Status filter
    if (statusFilter !== "all" && p.status !== statusFilter) return false;

    return true;
  });

  // Calculate dynamic stats
  const totalCount = filteredProjects.length;
  const inProgressCount = filteredProjects.filter(p => p.status === "Đang thực hiện").length;
  const doneCount = filteredProjects.filter(p => p.status === "Done").length;
  
  // Calculate total expected revenue
  const totalRevenue = filteredProjects.reduce((sum, p) => {
    const revStr = String(p.revenue || "").replace(/[^\d]/g, "");
    if (!revStr) return sum;
    return sum + parseInt(revStr);
  }, 0);

  // Submit update for a project
  const handleSaveProject = async (projName) => {
    const p = projects.find(proj => proj.name === projName);
    if (!p) return;

    setSavingName(projName);

    const payload = {
      name:          projName,
      pic:           editPic[projName] !== undefined ? editPic[projName] : p.pic,
      status:        editStatus[projName] !== undefined ? editStatus[projName] : p.status,
      job:           editJob[projName] !== undefined ? editJob[projName] : p.job,
      expectedOb:    editExpectedOb[projName] !== undefined ? editExpectedOb[projName] : p.expectedOb,
      revenue:       editRevenue[projName] !== undefined ? editRevenue[projName] : p.revenue,
      sopLink:       editSopLink[projName] !== undefined ? editSopLink[projName] : p.sopLink,
      model:         editModel[projName] !== undefined ? editModel[projName] : p.model,
      recapStatus:   editRecapStatus[projName] !== undefined ? editRecapStatus[projName] : p.recapStatus,
      recapLink:     editRecapLink[projName] !== undefined ? editRecapLink[projName] : p.recapLink,
      sopStatus:     editSopStatus[projName] !== undefined ? editSopStatus[projName] : p.sopStatus,
      kickoffStatus: editKickoffStatus[projName] !== undefined ? editKickoffStatus[projName] : p.kickoffStatus,
      notes:         editNotes[projName] !== undefined ? editNotes[projName] : p.notes,
    };

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) {
        // Success: reload fresh merged state
        await fetchProjects();
        // Clear local buffer edits for this project
        const cleanBuffer = (state, setState) => {
          const s = { ...state };
          delete s[projName];
          setState(s);
        };
        cleanBuffer(editPic, setEditPic);
        cleanBuffer(editStatus, setEditStatus);
        cleanBuffer(editJob, setEditJob);
        cleanBuffer(editExpectedOb, setEditExpectedOb);
        cleanBuffer(editRevenue, setEditRevenue);
        cleanBuffer(editSopLink, setEditSopLink);
        cleanBuffer(editModel, setEditModel);
        cleanBuffer(editRecapStatus, setEditRecapStatus);
        cleanBuffer(editRecapLink, setEditRecapLink);
        cleanBuffer(editSopStatus, setEditSopStatus);
        cleanBuffer(editKickoffStatus, setEditKickoffStatus);
        cleanBuffer(editNotes, setEditNotes);
      }
    } catch (err) {
      alert("Lỗi lưu dự án: " + err.message);
    } finally {
      setSavingName(null);
    }
  };

  const isManager = currentUser.role === "manager";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Panel */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Team Vận Hành SD3 — Theo Dõi Dự Án Mới</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Bảng quản trị tiến độ và phân quyền onboard dự án của team Solution Điện Máy.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button 
            onClick={fetchProjects}
            disabled={loading}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "#fff", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
          >
            🔄 Tải Lại Dữ Liệu
          </button>
          <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
            👤 Vai trò: <strong style={{ color: "var(--cyan)" }}>{isManager ? "Manager (Xem toàn bộ)" : "PIC Vận Hành"}</strong>
            {currentUser.pic && <span> | Tên: <strong style={{ color: "var(--green)" }}>{PIC_NAMES[currentUser.pic] || currentUser.pic}</strong></span>}
          </div>
        </div>
      </div>

      {/* Info Notice about Google Sheet Write Permission */}
      <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", padding: "12px 16px", borderRadius: 8, fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 10 }}>
        <span>💡</span>
        <div>
          <strong>Chia sẻ quyền chỉnh sửa Google Sheet:</strong> Để đồng bộ trực tiếp các cập nhật từ bảng này về lại Google Sheet của bạn, hãy chia sẻ quyền <strong>Editor (Người chỉnh sửa)</strong> trên file sheet cho địa chỉ email dịch vụ: <code style={{ color: "var(--cyan)", background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>dienmaysd3@dienmaysd3.iam.gserviceaccount.com</code>. Hiện tại, mọi cập nhật sẽ được lưu an toàn trên hệ thống dashboard.
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid-4">
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng Dự Án</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--text-primary)" }}>{totalCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đang theo dõi trong danh sách</div>
        </div>
        <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đang Thực Hiện</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--amber)" }}>{inProgressCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đang viết SOP/Onsite</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đã Hoàn Thành (Done)</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--green)" }}>{doneCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đã bàn giao và chạy ổn định</div>
        </div>
        <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Doanh Thu Dự Kiến</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--cyan)" }}>
            {totalRevenue > 0 ? (totalRevenue / 1000000000).toFixed(1).replace(".0", "") + " Tỷđ" : "0đ"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tổng quy mô doanh thu ước tính</div>
        </div>
      </div>

      {/* Filter Row */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Tìm kiếm dự án</label>
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên dự án, checklist, logic SLA..."
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
          />
        </div>

        {/* Filter PIC */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Lọc theo PIC</label>
          <select 
            value={picFilter} 
            onChange={(e) => setPicFilter(e.target.value)}
            disabled={currentUser.role === "pic"}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, cursor: currentUser.role === "pic" ? "not-allowed" : "pointer" }}
          >
            <option value="all">Tất cả PIC</option>
            {uniquePics.map(email => (
              <option key={email} value={email}>{PIC_NAMES[email] || email}</option>
            ))}
          </select>
        </div>

        {/* Filter Model */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Mô Hình Vận Hành</label>
          <select 
            value={modelFilter} 
            onChange={(e) => setModelFilter(e.target.value)}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả mô hình</option>
            {uniqueModels.map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>

        {/* Filter Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Trạng Thái</label>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả trạng thái</option>
            {uniqueStatuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Projects Table Container */}
      <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", overflowX: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
            <div className="spinner" />
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Tên Dự Án</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Đảm Nhiệm (PIC)</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Mô Hình Vận Hành</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Công Việc</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Dự Kiến OB</th>
                <th style={{ textAlign: "right", padding: "12px 8px" }}>Doanh Thu Dự Kiến</th>
                <th style={{ textAlign: "center", padding: "12px 8px" }}>Trạng Thái</th>
                <th style={{ textAlign: "center", padding: "12px 8px" }}>SOP Link</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                const isExpanded = expandedId === p.name;
                const picName = PIC_NAMES[p.pic] || p.pic || "Chưa phân công";
                
                let statusColor = "rgba(100,116,139,0.15)";
                if (p.status === "Đang thực hiện") statusColor = "rgba(245,158,11,0.2)";
                if (p.status === "Done") statusColor = "rgba(16,185,129,0.2)";

                // Resolve edit values from local buffer or original object
                const currentPic = editPic[p.name] !== undefined ? editPic[p.name] : p.pic;
                const currentStatus = editStatus[p.name] !== undefined ? editStatus[p.name] : p.status;
                const currentJob = editJob[p.name] !== undefined ? editJob[p.name] : p.job;
                const currentExpectedOb = editExpectedOb[p.name] !== undefined ? editExpectedOb[p.name] : p.expectedOb;
                const currentRevenue = editRevenue[p.name] !== undefined ? editRevenue[p.name] : p.revenue;
                const currentSopLink = editSopLink[p.name] !== undefined ? editSopLink[p.name] : p.sopLink;
                const currentModel = editModel[p.name] !== undefined ? editModel[p.name] : p.model;
                const currentRecapStatus = editRecapStatus[p.name] !== undefined ? editRecapStatus[p.name] : p.recapStatus;
                const currentRecapLink = editRecapLink[p.name] !== undefined ? editRecapLink[p.name] : p.recapLink;
                const currentSopStatus = editSopStatus[p.name] !== undefined ? editSopStatus[p.name] : p.sopStatus;
                const currentKickoffStatus = editKickoffStatus[p.name] !== undefined ? editKickoffStatus[p.name] : p.kickoffStatus;
                const currentNotes = editNotes[p.name] !== undefined ? editNotes[p.name] : p.notes;

                const isAssignedPic = p.pic && p.pic === currentUser.pic;
                const canEdit = isManager || isAssignedPic;

                return (
                  <>
                    {/* Main Row */}
                    <tr 
                      key={p.name}
                      onClick={() => setExpandedId(isExpanded ? null : p.name)}
                      style={{ 
                        borderBottom: "1px solid rgba(255,255,255,0.05)", 
                        cursor: "pointer", 
                        background: isExpanded ? "rgba(59, 130, 246, 0.05)" : "transparent",
                        transition: "all 0.2s"
                      }}
                      className="hover-row"
                    >
                      <td style={{ padding: "14px 8px", fontWeight: 600, color: "var(--text-primary)" }}>
                        📂 {p.name} {isExpanded ? "▲" : "▼"}
                      </td>
                      <td style={{ padding: "14px 8px", color: "var(--cyan)" }}>
                        👤 {picName}
                      </td>
                      <td style={{ padding: "14px 8px" }}>
                        <span style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: 4, color: "var(--text-secondary)" }}>
                          {p.model}
                        </span>
                      </td>
                      <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                        {p.job}
                      </td>
                      <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                        {p.expectedOb}
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "right", fontWeight: 600 }}>
                        {formatRevenue(p.revenue)}
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "center" }}>
                        <span style={{ 
                          fontSize: 11, 
                          fontWeight: 600, 
                          padding: "4px 8px", 
                          borderRadius: 20, 
                          background: statusColor, 
                          color: p.status === "Done" ? "var(--green)" : "var(--amber)"
                        }}>
                          {p.status}
                        </span>
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        {p.sopLink ? (
                          <a 
                            href={p.sopLink.startsWith("http") ? p.sopLink : `https://docs.google.com/document/d/`}
                            target="_blank" 
                            rel="noreferrer" 
                            style={{ 
                              background: "rgba(59,130,246,0.15)", 
                              color: "var(--cyan)", 
                              padding: "4px 10px", 
                              borderRadius: 6, 
                              fontSize: 11,
                              fontWeight: 600,
                              textDecoration: "none",
                              border: "1px solid rgba(59,130,246,0.2)"
                            }}
                          >
                            Mở SOP 🔗
                          </a>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Chưa có</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable Project Editor Pipeline & SLA details */}
                    {isExpanded && (
                      <tr style={{ background: "rgba(0,0,0,0.25)" }}>
                        <td colSpan={8} style={{ padding: "20px 24px" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            
                            {/* SD3 PIPELINE PROGRESS BOX */}
                            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                <h5 style={{ margin: 0, fontSize: 13, color: "var(--cyan)", fontWeight: 600 }}>🚩 TIẾN ĐỘ THỰC HIỆN CỦA CHUYÊN VIÊN (SD3 PIPELINE)</h5>
                                {!canEdit && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>🔒 Chỉ PIC phụ trách hoặc Manager mới có quyền chỉnh sửa</span>}
                              </div>

                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                                {/* Step 1: Recap Onsite */}
                                <div style={{ background: "rgba(0,0,0,0.15)", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.02)" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                    <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-primary)" }}>Bước 1: Recap Onsite</span>
                                    {currentRecapLink && <a href={currentRecapLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--cyan)", textDecoration: "underline" }}>Mở Link 🔗</a>}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <select
                                      value={currentRecapStatus}
                                      disabled={!canEdit}
                                      onChange={(e) => setEditRecapStatus({ ...editRecapStatus, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    >
                                      <option value="Chưa thực hiện">Chưa thực hiện</option>
                                      <option value="Đang thực hiện">Đang thực hiện</option>
                                      <option value="Done">Done</option>
                                    </select>
                                    <input
                                      type="url"
                                      value={currentRecapLink}
                                      disabled={!canEdit}
                                      onChange={(e) => setEditRecapLink({ ...editRecapLink, [p.name]: e.target.value })}
                                      placeholder="Link báo cáo onsite..."
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    />
                                  </div>
                                </div>

                                {/* Step 2: Viết SOP */}
                                <div style={{ background: "rgba(0,0,0,0.15)", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.02)" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                    <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-primary)" }}>Bước 2: Viết SOP</span>
                                    {currentSopLink && <a href={currentSopLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--cyan)", textDecoration: "underline" }}>Mở Link 🔗</a>}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <select
                                      value={currentSopStatus}
                                      disabled={!canEdit}
                                      onChange={(e) => setEditSopStatus({ ...editSopStatus, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    >
                                      <option value="Chưa thực hiện">Chưa thực hiện</option>
                                      <option value="Đang thực hiện">Đang thực hiện</option>
                                      <option value="Done">Done</option>
                                    </select>
                                    <input
                                      type="url"
                                      value={currentSopLink}
                                      disabled={!canEdit}
                                      onChange={(e) => setEditSopLink({ ...editSopLink, [p.name]: e.target.value })}
                                      placeholder="Link tài liệu SOP..."
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    />
                                  </div>
                                </div>

                                {/* Step 3: Kick OFF Onboard */}
                                <div style={{ background: "rgba(0,0,0,0.15)", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.02)" }}>
                                  <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-primary)", display: "block", marginBottom: 6 }}>Bước 3: Kick OFF Onboard</span>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <select
                                      value={currentKickoffStatus}
                                      disabled={!canEdit}
                                      onChange={(e) => setEditKickoffStatus({ ...editKickoffStatus, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    >
                                      <option value="Chưa thực hiện">Chưa thực hiện</option>
                                      <option value="Đang thực hiện">Đang thực hiện</option>
                                      <option value="Done">Done</option>
                                    </select>
                                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Chọn "Done" sẽ tự động Go-Live dự án.</span>
                                  </div>
                                </div>
                              </div>

                              {/* Progress checklist/Notes */}
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
                                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Nhật ký tiến độ / Checklist Công Việc (Do PIC nhập)</label>
                                <textarea
                                  rows={2}
                                  value={currentNotes}
                                  disabled={!canEdit}
                                  onChange={(e) => setEditNotes({ ...editNotes, [p.name]: e.target.value })}
                                  placeholder="Ghi nhận cụ thể tiến trình viết SOP hoặc đi onsite khảo sát..."
                                  style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 12, resize: "none" }}
                                />
                              </div>
                            </div>

                            {/* MANAGER SETTINGS & SLA DETAILS */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                              {/* Manager Setup panel */}
                              <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", padding: 14, borderRadius: 10 }}>
                                <h5 style={{ margin: "0 0 10px 0", fontSize: 12, color: "var(--cyan)", textTransform: "uppercase" }}>⚙️ THIẾT LẬP DỰ ÁN (Chỉ Manager)</h5>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Phân Công PIC</label>
                                    <select
                                      value={currentPic}
                                      disabled={!isManager}
                                      onChange={(e) => setEditPic({ ...editPic, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    >
                                      <option value="">-- Chưa gán --</option>
                                      <option value="tutd@ghn.vn">Duy Tú</option>
                                      <option value="diennk@giaohangnhanh.vn">Kim Diện</option>
                                      <option value="datnt2@ghn.vn">Nguyễn Tiến Đạt</option>
                                    </select>
                                  </div>

                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Trạng Thái Dự Án</label>
                                    <select
                                      value={currentStatus}
                                      disabled={!isManager}
                                      onChange={(e) => setEditStatus({ ...editStatus, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    >
                                      <option value="Đang thực hiện">Đang thực hiện</option>
                                      <option value="Done">Done</option>
                                    </select>
                                  </div>

                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Công việc hiện tại</label>
                                    <input
                                      type="text"
                                      value={currentJob}
                                      disabled={!isManager}
                                      onChange={(e) => setEditJob({ ...editJob, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    />
                                  </div>

                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Mô hình vận hành</label>
                                    <input
                                      type="text"
                                      value={currentModel}
                                      disabled={!isManager}
                                      onChange={(e) => setEditModel({ ...editModel, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    />
                                  </div>

                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Doanh thu dự kiến</label>
                                    <input
                                      type="text"
                                      value={currentRevenue}
                                      disabled={!isManager}
                                      onChange={(e) => setEditRevenue({ ...editRevenue, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    />
                                  </div>

                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự kiến OB</label>
                                    <input
                                      type="text"
                                      value={currentExpectedOb}
                                      disabled={!isManager}
                                      onChange={(e) => setEditExpectedOb({ ...editExpectedOb, [p.name]: e.target.value })}
                                      style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* SLA details panel */}
                              <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", padding: 14, borderRadius: 10, display: "flex", flexDirection: "column" }}>
                                <h5 style={{ margin: "0 0 6px 0", fontSize: 12, color: "var(--text-secondary)", textTransform: "uppercase" }}>⚙️ Logic SLA gốc (Google Sheet)</h5>
                                <div style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: "1.4", flex: 1, overflowY: "auto", maxH: 120 }}>
                                  {p.slaLogic || "Không có logic SLA riêng cho dự án này."}
                                </div>
                              </div>
                            </div>

                            {/* Submit Save Button */}
                            {canEdit && (
                              <button
                                onClick={() => handleSaveProject(p.name)}
                                disabled={savingName === p.name}
                                style={{
                                  background: "var(--cyan)",
                                  color: "#fff",
                                  border: "none",
                                  padding: "10px 20px",
                                  borderRadius: 6,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontSize: 13,
                                  alignSelf: "flex-end"
                                }}
                              >
                                {savingName === p.name ? "Đang lưu thay đổi..." : "Lưu Cập Nhật"}
                              </button>
                            )}

                            {/* Audit footer logs */}
                            {p.updatedAt && (
                              <div style={{ borderTop: "1px dashed rgba(255,255,255,0.05)", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
                                <span>Audit ID: {p.clientId || "Không có ID"}</span>
                                <span>Ghi nhận sửa đổi bởi: <strong style={{ color: "var(--cyan)" }}>{p.updatedBy}</strong> ({new Date(p.updatedAt).toLocaleString("vi-VN")})</span>
                              </div>
                            )}

                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}

        {!loading && filteredProjects.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>
            ✨ Không tìm thấy dự án nào khớp với điều kiện lọc!
          </div>
        )}
      </div>
    </div>
  );
}
