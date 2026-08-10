import React, { useState, useEffect } from 'react';

export default function EditProjectModal({ editingProject, onClose, onSuccess, isManager, canSeeRevenue }) {
  const [editPic, setEditPic] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editJob, setEditJob] = useState("");
  const [editExpectedOb, setEditExpectedOb] = useState("");
  const [editRevenue, setEditRevenue] = useState("");
  const [editSopLink, setEditSopLink] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editRecapStatus, setEditRecapStatus] = useState("");
  const [editRecapLink, setEditRecapLink] = useState("");
  const [editSopStatus, setEditSopStatus] = useState("");
  const [editKickoffStatus, setEditKickoffStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editVolume, setEditVolume] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingProject) {
      setEditPic(editingProject.pic || "");
      setEditStatus(editingProject.status || "Đang thực hiện");
      setEditJob(editingProject.job || "");
      setEditExpectedOb(editingProject.expectedOb || "");
      setEditRevenue(editingProject.revenue || "");
      setEditSopLink(editingProject.sopLink || "");
      setEditModel(editingProject.model || "");
      setEditRecapStatus(editingProject.recapStatus || "Chưa thực hiện");
      setEditRecapLink(editingProject.recapLink || "");
      setEditSopStatus(editingProject.sopStatus || "Chưa thực hiện");
      setEditKickoffStatus(editingProject.kickoffStatus || "Chưa thực hiện");
      setEditNotes(editingProject.notes || "");
      setEditVolume(editingProject.volume || "");
    }
  }, [editingProject]);

  const handleUpdateProject = async (e) => {
    e.preventDefault();
    if (!editingProject) return;

    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          name:          editingProject.name,
          pic:           editPic,
          status:        editStatus,
          job:           editJob,
          expectedOb:    editExpectedOb,
          revenue:       editRevenue,
          sopLink:       editSopLink,
          model:         editModel,
          recapStatus:   editRecapStatus,
          recapLink:     editRecapLink,
          sopStatus:     editSopStatus,
          kickoffStatus: editKickoffStatus,
          notes:         editNotes,
          volume:        editVolume,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onSuccess();
      }
    } catch (err) {
      alert("Lỗi lưu dự án: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editingProject) return null;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--input-bg)", border: "1px solid var(--border)", padding: 24, borderRadius: 16, width: "90%", maxWidth: 650, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>
            ✏️ Chỉnh Sửa Tiến Độ: <span style={{ color: "var(--cyan)" }}>{editingProject.name}</span>
          </h4>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>&times;</button>
        </div>

        <form onSubmit={handleUpdateProject} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          
          {/* STEP 1, 2, 3 SECTION */}
          <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 14, borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <h5 style={{ margin: 0, fontSize: 12, color: "var(--cyan)", textTransform: "uppercase" }}>🚩 Tiến độ chuyên viên (SD3 Pipeline)</h5>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Step 1 */}
              <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "1px solid rgba(255,255,255,0.02)" }}>
                <label style={{ fontSize: 11, fontWeight: "bold", display: "block", marginBottom: 4 }}>Bước 1: Recap Onsite</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <select 
                    value={editRecapStatus} onChange={(e) => setEditRecapStatus(e.target.value)}
                    style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                  >
                    <option value="Chưa thực hiện">Chưa thực hiện</option>
                    <option value="Đang thực hiện">Đang thực hiện</option>
                    <option value="Done">Done</option>
                  </select>
                  <input 
                    type="url" value={editRecapLink} onChange={(e) => setEditRecapLink(e.target.value)}
                    placeholder="Dán link report onsite..."
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                  />
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "1px solid rgba(255,255,255,0.02)" }}>
                <label style={{ fontSize: 11, fontWeight: "bold", display: "block", marginBottom: 4 }}>Bước 2: Viết SOP</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <select 
                    value={editSopStatus} onChange={(e) => setEditSopStatus(e.target.value)}
                    style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                  >
                    <option value="Chưa thực hiện">Chưa thực hiện</option>
                    <option value="Đang thực hiện">Đang thực hiện</option>
                    <option value="Done">Done</option>
                  </select>
                  <input 
                    type="url" value={editSopLink} onChange={(e) => setEditSopLink(e.target.value)}
                    placeholder="Dán link SOP docs..."
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                  />
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "1px solid rgba(255,255,255,0.02)" }}>
              <label style={{ fontSize: 11, fontWeight: "bold", display: "block", marginBottom: 4 }}>Bước 3: Kick OFF Onboard</label>
              <select 
                value={editKickoffStatus} onChange={(e) => setEditKickoffStatus(e.target.value)}
                style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12, width: "100%" }}
              >
                <option value="Chưa thực hiện">Chưa thực hiện</option>
                <option value="Đang thực hiện">Đang thực hiện</option>
                <option value="Done">Done</option>
              </select>
            </div>
          </div>

          {/* MANAGER ADMIN SETUP SECTION */}
          <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 14, borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <h5 style={{ margin: 0, fontSize: 12, color: "var(--cyan)", textTransform: "uppercase" }}>⚙️ Thiết lập dự án {isManager ? "(Chỉnh sửa)" : "(Chỉ xem)"}</h5>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Phân công PIC</label>
                <select 
                  value={editPic} disabled={!isManager} onChange={(e) => setEditPic(e.target.value)}
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                >
                  <option value="">-- Chưa gán --</option>
                  <option value="tutd@ghn.vn">Duy Tú</option>
                  <option value="diennk@giaohangnhanh.vn">Kim Diện</option>
                  <option value="datnt2@ghn.vn">Nguyễn Thành Đạt</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Trạng Thái Dự Án</label>
                <select 
                  value={editStatus} disabled={!isManager} onChange={(e) => setEditStatus(e.target.value)}
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                >
                  <option value="Đang thực hiện">Đang thực hiện</option>
                  <option value="Done">Done</option>
                </select>
              </div>

              {canSeeRevenue && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Doanh Thu Dự Kiến</label>
                  <input 
                    type="text" value={editRevenue} disabled={!isManager} onChange={(e) => setEditRevenue(e.target.value)}
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                  />
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Dự kiến OB</label>
                <input 
                  type="text" value={editExpectedOb} disabled={!isManager} onChange={(e) => setEditExpectedOb(e.target.value)}
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Mô hình vận hành</label>
                <input 
                  type="text" value={editModel} disabled={!isManager} onChange={(e) => setEditModel(e.target.value)}
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Công việc hiện tại</label>
                <input 
                  type="text" value={editJob} disabled={!isManager} onChange={(e) => setEditJob(e.target.value)}
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Dự kiến Volume</label>
                <input 
                  type="text" value={editVolume} disabled={!isManager} onChange={(e) => setEditVolume(e.target.value)}
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Checklist Công Việc / Ghi chú</label>
            <textarea 
              rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Nhập tiến độ cập nhật chi tiết..."
              style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 12, resize: "none" }}
            />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 10 }}>
            <button 
              type="button" onClick={onClose}
              style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
            >
              Đóng
            </button>
            <button 
              type="submit" disabled={saving}
              style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 24px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
            >
              {saving ? "Đang lưu..." : "Lưu Cập Nhật"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
