import React, { useState } from 'react';
import { getTaskOutcome } from '../utils';

const OUTCOME_BADGE = {
  done_ontime: { background: "rgba(16,185,129,0.15)", color: "var(--green)", border: "1px solid var(--green)", label: "🟢 Xong đúng hạn" },
  done_late: { background: "rgba(245,158,11,0.15)", color: "var(--amber)", border: "1px solid var(--amber)", label: "🟠 Xong trễ hạn" },
  overdue_open: { background: "rgba(244,63,94,0.15)", color: "var(--red)", border: "1px solid var(--red)", label: "🚨 Quá hạn, chưa xong" },
  in_progress: { background: "rgba(245,158,11,0.15)", color: "var(--amber)", border: "1px solid var(--amber)", label: "🟡 Đang làm" },
};

export default function TaskTable({ taskGroups, tasksLoading, currentUser, isManager, handleToggleTaskStatus, handleDeleteTask, onEditTask }) {
  const [completionDrafts, setCompletionDrafts] = useState({});
  const [completingId, setCompletingId] = useState(null);

  const handleCompleteTask = async (id) => {
    const note = (completionDrafts[id] || "").trim();
    setCompletingId(id);
    await handleToggleTaskStatus(id, "done", note);
    setCompletingId(null);
    setCompletionDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
      <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse", fontSize: 12.5, textAlign: "left", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "23%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "20%" }} />
        </colgroup>
        <thead>
          <tr style={{ background: "var(--table-header-bg)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "10px 14px" }}>Tên Task / Công Việc</th>
            <th style={{ padding: "10px 14px" }}>Người Đảm Nhiệm (PIC)</th>
            <th style={{ padding: "10px 14px" }}>Dự Án</th>
            <th style={{ padding: "10px 14px" }}>Hạn Chót (Deadline)</th>
            <th style={{ padding: "10px 14px" }}>Trạng Thái & Đánh Giá</th>
            <th style={{ padding: "10px 14px", textAlign: "right" }}>Thao Tác</th>
          </tr>
        </thead>
        <tbody>
          {tasksLoading ? (
            <tr>
              <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                Đang tải task...
              </td>
            </tr>
          ) : taskGroups.length > 0 ? (
            taskGroups.flatMap((members) => {
              const first = members[0];
              const gid = first.groupId || first.id;
              const isGrouped = members.length > 1;
              return members.map((m, idx) => {
                const outcome = getTaskOutcome(m);
                const badgeStyle = OUTCOME_BADGE[outcome];
                const isOwnRow = m.pic === currentUser.email;
                const canAct = isManager || isOwnRow;
                const isDone = outcome === "done_ontime" || outcome === "done_late";
                const isLastInGroup = idx === members.length - 1;
                const rowIsOverdue = outcome === "overdue_open" || outcome === "done_late";
                const canEditDetails = isManager || members.some((mm) => mm.pic === currentUser.email);
                const sharedCellStyle = {
                  padding: "10px 14px",
                  verticalAlign: "top",
                  borderRight: isGrouped ? "1px solid var(--border)" : "none",
                };
                return (
                  <tr
                    key={m.id}
                    style={{
                      borderBottom: isLastInGroup ? "1px solid var(--border)" : "1px dashed var(--border)",
                      background: rowIsOverdue ? "rgba(244, 63, 94, 0.05)" : "transparent",
                    }}
                  >
                    {idx === 0 && (
                      <td rowSpan={members.length} style={{ ...sharedCellStyle, fontWeight: 600, color: "var(--text-primary)" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                          <span>{first.title}</span>
                          {canEditDetails && onEditTask && (
                            <button
                              onClick={() => onEditTask(members)}
                              title="Sửa nội dung / hạn chót"
                              style={{
                                background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-muted)",
                                width: 20, height: 20, minWidth: 20, borderRadius: 4, cursor: "pointer", fontSize: 11,
                                flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
                              }}
                            >
                              ✏️
                            </button>
                          )}
                        </div>
                        {first.notes && <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginTop: 2 }}>{first.notes}</div>}
                      </td>
                    )}
                    <td style={{ padding: "10px 14px", color: "var(--cyan)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={m.picName}>
                      👤 {m.picName}
                    </td>
                    {idx === 0 && (
                      <td rowSpan={members.length} style={{ ...sharedCellStyle, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={first.project}>
                        {first.project}
                      </td>
                    )}
                    {idx === 0 && (
                      <td rowSpan={members.length} style={{ ...sharedCellStyle, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                        📅 {first.deadline}
                      </td>
                    )}
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, width: "fit-content", padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap", display: "inline-block", ...badgeStyle }}>
                        {badgeStyle.label}
                      </span>
                      {m.completionNote && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, fontStyle: "italic", maxWidth: 260 }}>
                          💬 {m.completionNote}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", marginLeft: "auto", maxWidth: 260 }}>
                        {/* Secondary actions — icon-only so they don't compete visually
                            with the primary "Hoàn thành" action below. */}
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {m.calendarLink ? (
                            <a
                              href={m.calendarLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Đã thêm vào lịch chung SD3-Điện Máy (không tự gửi email cho PIC) — bấm để xem trên Google Calendar"
                              style={{
                                background: "rgba(16,185,129,0.12)", border: "1px solid var(--green)", color: "var(--green)",
                                width: 24, height: 24, borderRadius: 4, textDecoration: "none",
                                display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                              }}
                            >
                              📅
                            </a>
                          ) : (
                            <a
                              href={(() => {
                                const title = encodeURIComponent(`[SD3 Task] ${m.title}`);
                                const dateStr = (m.deadline || "").replace(/-/g, "");
                                const dates = dateStr ? `${dateStr}T090000/${dateStr}T180000` : "";
                                const details = encodeURIComponent(`Nhiệm vụ vận hành SD3 GHN:\n- Tên công việc: ${m.title}\n- Dự án: ${m.project}\n- PIC đảm nhiệm: ${m.picName} (${m.pic})\n- Ghi chú: ${m.notes || "N/A"}`);
                                const add = encodeURIComponent(m.pic || "");
                                return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&add=${add}`;
                              })()}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Chưa tự tạo được lịch — bấm để tự thêm thủ công vào Google Calendar của bạn"
                              style={{
                                background: "rgba(var(--brand-rgb),0.12)", border: "1px solid var(--cyan)", color: "var(--cyan)",
                                width: 24, height: 24, borderRadius: 4, textDecoration: "none",
                                display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                              }}
                            >
                              📅
                            </a>
                          )}
                          {canAct && isDone && (
                            <button
                              onClick={() => handleToggleTaskStatus(m.id, "in_progress")}
                              title="Mở lại task"
                              style={{ background: "rgba(245,158,11,0.15)", border: "1px solid var(--amber)", color: "var(--amber)", width: 24, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                            >
                              ↺
                            </button>
                          )}
                          {isManager && (
                            <button
                              onClick={() => handleDeleteTask(m.id)}
                              title="Xoá task"
                              style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-muted)", width: 24, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                        {canAct && !isDone && (
                          <div style={{ display: "flex", gap: 6, width: "100%" }}>
                            <input
                              type="text"
                              value={completionDrafts[m.id] || ""}
                              onChange={(e) => setCompletionDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                              placeholder="Phản hồi kết quả công việc..."
                              style={{ flex: 1, minWidth: 0, fontSize: 11, padding: "4px 8px", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)" }}
                            />
                            <button
                              onClick={() => handleCompleteTask(m.id)}
                              disabled={completingId === m.id}
                              style={{ background: "rgba(16,185,129,0.15)", border: "1px solid var(--green)", color: "var(--green)", padding: "3px 10px", borderRadius: 4, fontSize: 11, cursor: completingId === m.id ? "default" : "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
                            >
                              {completingId === m.id ? "..." : "✓ Hoàn thành"}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              });
            })
          ) : (
            <tr>
              <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                Chưa có task nào trong danh sách lọc.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
