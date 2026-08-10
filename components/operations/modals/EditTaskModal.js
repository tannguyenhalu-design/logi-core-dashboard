import React, { useState } from 'react';

export default function EditTaskModal({ members, onClose, onSuccess }) {
  const first = members[0];
  const groupId = first.groupId || first.id;
  const [title, setTitle] = useState(first.title || "");
  const [project, setProject] = useState(first.project || "");
  const [deadline, setDeadline] = useState(first.deadline || "");
  const [notes, setNotes] = useState(first.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const picNames = members.map((m) => m.picName).join(", ");
  const canSave = title.trim() && deadline && !saving;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "editDetails",
          groupId,
          title: title.trim(),
          project,
          deadline,
          notes,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onSuccess(json.tasks);
      } else {
        setError(json.error || "Không thể lưu thay đổi.");
      }
    } catch (e) {
      setError("Lỗi kết nối, vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: 480, maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <h3 style={{ margin: "0 0 4px 0", color: "var(--text-primary)", fontSize: 16 }}>✏️ Sửa Task</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: 12, color: "var(--text-muted)" }}>
          Giao cho: <strong style={{ color: "var(--cyan)" }}>{picNames}</strong> — sửa nội dung/hạn chót áp dụng cho tất cả người trong task này. Muốn đổi người phụ trách thì xoá task cũ và tạo task mới.
        </p>
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", paddingRight: 4 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Tên Công Việc / Task:</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 13, marginTop: 4 }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Hạn Chót:</label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Dự Án / Mảng Việc:</label>
              <input
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="Casper, Aqua B2C..."
                style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4 }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Ghi Chú / Yêu Cầu Kết Quả:</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Nhập ghi chú chi tiết hoặc dán link kết quả..."
              style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4, resize: "none" }}
            />
          </div>

          {error && (
            <div style={{ color: "var(--red)", fontSize: 12, background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.25)", borderRadius: 6, padding: "8px 10px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
            >
              Hủy Bỏ
            </button>
            <button
              type="submit"
              disabled={!canSave}
              style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.6 }}
            >
              {saving ? "Đang lưu..." : "Lưu Thay Đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
