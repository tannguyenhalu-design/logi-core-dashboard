import React, { useState } from 'react';
import { PIC_NAMES, blankTaskRow } from '../utils';

export default function AddTaskModal({ onClose, onSuccess }) {
  const [newTaskRows, setNewTaskRows] = useState([blankTaskRow()]);
  const [taskSaving, setTaskSaving] = useState(false);

  const updateTaskRow = (idx, patch) => {
    setNewTaskRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const toggleTaskRowPic = (idx, email) => {
    setNewTaskRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const pics = r.pics.includes(email) ? r.pics.filter((p) => p !== email) : [...r.pics, email];
      return { ...r, pics };
    }));
  };
  const addTaskRow = () => setNewTaskRows((prev) => [...prev, blankTaskRow()]);
  const removeTaskRow = (idx) => setNewTaskRows((prev) => prev.filter((_, i) => i !== idx));

  const validTaskRows = newTaskRows.filter((r) => r.title.trim() && r.deadline && r.pics.length > 0);
  const totalNewTaskCount = validTaskRows.reduce((sum, r) => sum + r.pics.length, 0);

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (validTaskRows.length === 0) return;

    setTaskSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: validTaskRows.map((r) => ({
            title: r.title.trim(),
            pics: r.pics.map((email) => ({ pic: email, picName: PIC_NAMES[email] || email })),
            project: r.project,
            deadline: r.deadline,
            notes: r.notes.trim(),
          })),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        const distinctPics = [...new Set(json.tasks.flatMap((t) => (t.pic || "").split(",").map(p => p.trim()).filter(Boolean)))];
        onSuccess(json.tasks, distinctPics);
      } else {
        alert(json.error || "Không thể tạo task.");
      }
    } catch (e) {
      alert("Lỗi kết nối, vui lòng thử lại.");
    } finally {
      setTaskSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: 520, maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <h3 style={{ margin: "0 0 4px 0", color: "var(--text-primary)", fontSize: 16 }}>+ Tạo Task & Gán Deadline</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: 12, color: "var(--text-muted)" }}>
          Thêm nhiều dòng để giao nhiều task khác nhau cùng lúc — mỗi dòng lưu 1 lần bấm.
        </p>
        <form onSubmit={handleAddTask} style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", paddingRight: 4 }}>
          {newTaskRows.map((row, idx) => (
            <div key={idx} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "var(--panel-glow)", display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Task {idx + 1}</span>
                {newTaskRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTaskRow(idx)}
                    title="Xoá task này"
                    style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 13, padding: 2 }}
                  >
                    🗑️
                  </button>
                )}
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Tên Công Việc / Task:</label>
                <input
                  type="text"
                  value={row.title}
                  onChange={(e) => updateTaskRow(idx, { title: e.target.value })}
                  placeholder="Ví dụ: Báo cáo ODR tuần 31 cho Director..."
                  style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 13, marginTop: 4 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
                  Người Đảm Nhiệm — chọn nhiều người để giao cùng task này cho cả nhóm:
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  {Object.entries(PIC_NAMES).map(([email, name]) => {
                    const checked = row.pics.includes(email);
                    return (
                      <label
                        key={email}
                        style={{
                          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                          background: checked ? "rgba(var(--brand-rgb),0.15)" : "var(--input-bg)",
                          border: `1px solid ${checked ? "var(--cyan)" : "var(--border)"}`,
                          color: checked ? "var(--cyan)" : "var(--text-secondary)",
                          padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                        }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleTaskRowPic(idx, email)} style={{ margin: 0 }} />
                        {name}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Hạn Chót:</label>
                  <input
                    type="date"
                    value={row.deadline}
                    onChange={(e) => updateTaskRow(idx, { deadline: e.target.value })}
                    style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Dự Án / Mảng Việc:</label>
                  <input
                    type="text"
                    value={row.project}
                    onChange={(e) => updateTaskRow(idx, { project: e.target.value })}
                    placeholder="Casper, Aqua B2C..."
                    style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Ghi Chú / Yêu Cầu Kết Quả:</label>
                <textarea
                  rows={2}
                  value={row.notes}
                  onChange={(e) => updateTaskRow(idx, { notes: e.target.value })}
                  placeholder="Nhập ghi chú chi tiết hoặc dán link kết quả..."
                  style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4, resize: "none" }}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addTaskRow}
            style={{ background: "var(--input-bg)", border: "1px dashed var(--border)", color: "var(--cyan)", padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            + Thêm task khác
          </button>

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
              disabled={taskSaving || validTaskRows.length === 0}
              style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: taskSaving ? "not-allowed" : "pointer", opacity: taskSaving || validTaskRows.length === 0 ? 0.6 : 1 }}
            >
              {taskSaving
                ? "Đang lưu..."
                : validTaskRows.length > 1
                ? `Lưu ${validTaskRows.length} Task${totalNewTaskCount > validTaskRows.length ? ` (${totalNewTaskCount} lượt giao)` : ""}`
                : totalNewTaskCount > 1
                ? `Lưu Task (giao ${totalNewTaskCount} người)`
                : "Lưu Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
