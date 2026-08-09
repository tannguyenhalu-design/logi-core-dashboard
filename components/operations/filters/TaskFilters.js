import React from 'react';
import { PIC_NAMES } from '../utils';

export default function TaskFilters({ taskPicFilter, setTaskPicFilter, taskStatusFilter, setTaskStatusFilter }) {
  return (
    <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", padding: "10px 14px", borderRadius: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Lọc theo PIC:</label>
        <select
          value={taskPicFilter}
          onChange={(e) => setTaskPicFilter(e.target.value)}
          style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
        >
          <option value="all">Tất cả PIC</option>
          {Object.entries(PIC_NAMES).map(([email, name]) => (
            <option key={email} value={email}>{name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Trạng thái:</label>
        <select
          value={taskStatusFilter}
          onChange={(e) => setTaskStatusFilter(e.target.value)}
          style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="in_progress">🟡 Đang thực hiện</option>
          <option value="done_ontime">🟢 Xong đúng hạn</option>
          <option value="done_late">🟠 Xong trễ hạn</option>
          <option value="overdue_open">🔴 Quá hạn, chưa xong</option>
        </select>
      </div>
    </div>
  );
}
