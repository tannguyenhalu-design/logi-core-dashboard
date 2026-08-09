import React, { useState } from 'react';

export default function AddProjectModal({ onClose, onSuccess, canSeeRevenue }) {
  const [addName, setAddName] = useState("");
  const [addPic, setAddPic] = useState("");
  const [addRevenue, setAddRevenue] = useState("");
  const [addExpectedOb, setAddExpectedOb] = useState("");
  const [addModel, setAddModel] = useState("");
  const [addJob, setAddJob] = useState("");
  const [addSopLink, setAddSopLink] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addVolume, setAddVolume] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAddProject = async (e) => {
    e.preventDefault();
    if (!addName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: addName.trim(),
          pic: addPic,
          revenue: addRevenue.trim(),
          expectedOb: addExpectedOb.trim(),
          model: addModel.trim(),
          job: addJob.trim() || "Recap onsite",
          sopLink: addSopLink.trim(),
          notes: addNotes.trim(),
          volume: addVolume.trim(),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onSuccess();
      }
    } catch (err) {
      alert("Lỗi tạo dự án: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--input-bg)", border: "1px solid var(--border)", padding: 24, borderRadius: 16, width: "90%", maxWidth: 650, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>➕ Khởi Tạo Dự Án Mới</h4>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>&times;</button>
        </div>

        <form onSubmit={handleAddProject} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Tên Dự Án *</label>
              <input 
                type="text" required value={addName} onChange={(e) => setAddName(e.target.value)}
                placeholder="Nhập tên dự án (ví dụ: Casper B2B...)"
                style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Phân công PIC</label>
              <select 
                value={addPic} onChange={(e) => setAddPic(e.target.value)}
                style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              >
                <option value="">-- Chưa phân công --</option>
                <option value="tutd@ghn.vn">Duy Tú (tutd@ghn.vn)</option>
                <option value="diennk@giaohangnhanh.vn">Kim Diện (diennk@giaohangnhanh.vn)</option>
                <option value="datnt2@ghn.vn">Nguyễn Tiến Đạt (datnt2@ghn.vn)</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {canSeeRevenue && (
              <>
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Doanh Thu Dự Kiến (VND)</label>
                <input 
                  type="text" value={addRevenue} onChange={(e) => setAddRevenue(e.target.value)}
                  placeholder="Ví dụ: 500.000.000"
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                />
              </>
            )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Dự Kiến Onboarding (OB)</label>
              <input 
                type="text" value={addExpectedOb} onChange={(e) => setAddExpectedOb(e.target.value)}
                placeholder="Ví dụ: Tháng 8/2026"
                style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Mô hình vận hành</label>
              <input 
                type="text" value={addModel} onChange={(e) => setAddModel(e.target.value)}
                placeholder="Ví dụ: LTL B2B"
                style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Công việc hiện tại</label>
              <input 
                type="text" value={addJob} onChange={(e) => setAddJob(e.target.value)}
                placeholder="Mặc định: Recap onsite"
                style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Dự Kiến Volume</label>
              <input 
                type="text" value={addVolume} onChange={(e) => setAddVolume(e.target.value)}
                placeholder="Ví dụ: 10.000 đơn/tháng"
                style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Tài Liệu SOP Link</label>
            <input 
              type="url" value={addSopLink} onChange={(e) => setAddSopLink(e.target.value)}
              placeholder="Nhập đường dẫn Google Docs SOP..."
              style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Checklist Công Việc / Ghi chú</label>
            <textarea 
              rows={3} value={addNotes} onChange={(e) => setAddNotes(e.target.value)}
              placeholder="Nhập thông tin các hạng mục công việc cần chuẩn bị..."
              style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13, resize: "none" }}
            />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 10 }}>
            <button 
              type="button" onClick={onClose}
              style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
            >
              Hủy bỏ
            </button>
            <button 
              type="submit" disabled={saving}
              style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 24px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
            >
              {saving ? "Đang tạo..." : "Khởi Tạo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
