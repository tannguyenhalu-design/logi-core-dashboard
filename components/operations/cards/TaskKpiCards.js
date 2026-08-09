import React from 'react';
import { groupTaskStatus } from '../utils';

export default function TaskKpiCards({ taskGroups }) {
  const totalT = taskGroups.length;
  const ontimeT = taskGroups.filter((g) => groupTaskStatus(g) === "done_ontime").length;
  const inProgT = taskGroups.filter((g) => groupTaskStatus(g) === "in_progress").length;
  // "Trễ" gộp cả 2 trường hợp: quá hạn mà chưa xong, và đã xong nhưng trễ hạn.
  const overdueT = taskGroups.filter((g) => ["overdue_open", "done_late"].includes(groupTaskStatus(g))).length;
  const ontimePct = totalT > 0 ? Math.round((ontimeT / totalT) * 100) : 100;

  return (
    <div className="grid-4">
      <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", padding: 14, borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tỷ Lệ Hoàn Thành Đúng Hạn</div>
        <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: ontimePct >= 90 ? "var(--green)" : ontimePct >= 80 ? "var(--amber)" : "var(--red)" }}>
          {ontimePct}%
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>KPI đúng hạn của team SD3</div>
      </div>
      <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)", padding: 14, borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Hoàn Thành Đúng Hạn 🟢</div>
        <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: "var(--green)" }}>{ontimeT} task</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Task làm xong đúng deadline</div>
      </div>
      <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)", padding: 14, borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đang Thực Hiện 🟡</div>
        <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: "var(--amber)" }}>{inProgT} task</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Trong thời hạn làm việc</div>
      </div>
      <div style={{ background: "rgba(244,63,94,0.05)", border: "1px solid rgba(244,63,94,0.2)", padding: 14, borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Trễ Hạn Deadline 🔴</div>
        <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: "var(--red)" }}>{overdueT} task</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Task quá hạn cần xử lý gấp</div>
      </div>
    </div>
  );
}
