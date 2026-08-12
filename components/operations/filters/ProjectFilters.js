import React from 'react';
import { PIC_NAMES } from '../utils';

export default function ProjectFilters({ searchQuery, setSearchQuery, picFilter, setPicFilter, modelFilter, setModelFilter, statusFilter, setStatusFilter, currentUser, uniquePics, uniqueModels, uniqueStatuses }) {
  return (
    <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 16, borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      {/* Search */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 200 }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Tìm kiếm dự án</label>
        <input 
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm theo tên dự án, checklist, logic SLA..."
          style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
        />
      </div>

      {/* Filter PIC */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Lọc theo PIC</label>
        <select 
          value={picFilter} 
          onChange={(e) => setPicFilter(e.target.value)}
          style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, cursor: "pointer" }}
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
          style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6 }}
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
          style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6 }}
        >
          <option value="all">Tất cả trạng thái</option>
          {uniqueStatuses.map(status => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
