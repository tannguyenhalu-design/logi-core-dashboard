import React from 'react';
import TruckLoader from '../../TruckLoader';
import { PIC_NAMES, formatRevenue } from '../utils';

export default function ProjectTable({ filteredProjects, loading, canSeeRevenue, currentUser, isManager, onEditProject }) {
  return (
    <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", overflowX: "auto" }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <TruckLoader />
        </div>
      ) : (
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Tên Dự Án</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Client ID</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Đảm Nhiệm (PIC)</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Mô Hình Vận Hành</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Công Việc</th>
              <th style={{ textAlign: "left", padding: "12px 8px" }}>Dự Kiến OB</th>
              {canSeeRevenue && <th style={{ textAlign: "right", padding: "12px 8px" }}>Doanh Thu Dự Kiến</th>}
              {canSeeRevenue && <th style={{ textAlign: "right", padding: "12px 8px" }}>Last Mo. NSR</th>}
              {canSeeRevenue && <th style={{ textAlign: "right", padding: "12px 8px" }} title="Doanh thu thực tế tháng này (từ KPI Portal)">RR/NSR</th>}
              <th style={{ textAlign: "center", padding: "12px 8px" }}>Trạng Thái</th>
              <th style={{ textAlign: "center", padding: "12px 8px" }}>Tác vụ</th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((p, pIdx) => {
              const picName = PIC_NAMES[p.pic] || p.pic || "Chưa phân công";
              
              let statusColor = "rgba(100,116,139,0.15)";
              if (p.status === "Đang thực hiện") statusColor = "rgba(245,158,11,0.2)";
              if (p.status === "Done") statusColor = "rgba(16,185,129,0.2)";

              const isAssignedPic = p.pic && p.pic === currentUser.pic;
              const canEdit = isManager || isAssignedPic;
              const hasNoSop = !p.sopLink;

              return (
                <tr
                  key={`${p.clientId || ""}__${p.name}__${p.pic || ""}__${pIdx}`}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    background: hasNoSop ? "rgba(244,63,94,0.05)" : "transparent",
                  }}
                  className="hover-row"
                >
                  <td style={{ padding: "14px 8px", fontWeight: 600, color: "var(--text-primary)" }}>
                    📂 {p.name}
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--text-secondary)", fontSize: 12 }}>
                    {p.clientId || "—"}
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--cyan)" }}>
                    👤 {picName}
                  </td>
                  <td style={{ padding: "14px 8px" }}>
                    <span style={{ fontSize: 11, background: "var(--panel-glow)", padding: "4px 8px", borderRadius: 4, color: "var(--text-secondary)" }}>
                      {p.model}
                    </span>
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                    {p.job}
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                    {p.expectedOb}
                  </td>
                  {canSeeRevenue && (
                    <td style={{ padding: "14px 8px", textAlign: "right", fontWeight: 600 }}>
                      {formatRevenue(p.revenue)}
                    </td>
                  )}
                  {canSeeRevenue && (
                    <td style={{ padding: "14px 8px", textAlign: "right", color: "var(--text-secondary)" }}>
                      {p.lastMoNsr ? formatRevenue(p.lastMoNsr) : "—"}
                    </td>
                  )}
                  {canSeeRevenue && (
                    <td style={{ padding: "14px 8px", textAlign: "right", fontWeight: 600, color: "var(--cyan)" }}>
                      {p.rrNsr ? formatRevenue(p.rrNsr) : "—"}
                    </td>
                  )}
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
                  <td style={{ padding: "14px 8px", textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      {/^https?:\/\//i.test(p.sopLink || "") ? (
                        <a
                          href={p.sopLink}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            background: "rgba(var(--brand-rgb),0.15)",
                            color: "var(--cyan)",
                            padding: "5px 10px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            textDecoration: "none",
                            border: "1px solid rgba(var(--brand-rgb),0.2)"
                          }}
                        >
                          Mở SOP 🔗
                        </a>
                      ) : p.sopLink ? (
                        <span
                          title="Ô LINK SOP trên Sheet chỉ có tên/nhãn, không có URL thật — mở Sheet, bấm chuột phải vào ô này > Insert link để gắn lại link đầy đủ."
                          style={{ color: "var(--amber)", fontSize: 11, padding: "5px 10px", cursor: "help" }}
                        >
                          ⚠️ {p.sopLink} (chưa có link)
                        </span>
                      ) : (
                        <span style={{
                          color: "var(--red)", fontSize: 11, fontWeight: 600, padding: "5px 10px",
                          borderRadius: 6, background: "rgba(244,63,94,0.12)", border: "1px solid rgba(244,63,94,0.25)",
                        }}>
                          🔴 Chưa có SOP
                        </span>
                      )}
                      <button
                        onClick={() => onEditProject(p)}
                        style={{
                          background: canEdit ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                          color: canEdit ? "var(--green)" : "var(--text-muted)",
                          border: `1px solid ${canEdit ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)"}`,
                          padding: "5px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                      >
                        {canEdit ? "Chỉnh Sửa ✏️" : "Xem Chi Tiết 🔍"}
                      </button>
                    </div>
                  </td>
                </tr>
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
  );
}
