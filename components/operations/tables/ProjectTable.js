import React from 'react';
import TruckLoader from '../../TruckLoader';
import { PIC_NAMES, formatRevenue, resolvePicName } from '../utils';

export default function ProjectTable({ filteredProjects, loading, canSeeRevenue, currentUser, isManager, onEditProject }) {
  return (
    <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", overflowX: "auto" }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <TruckLoader />
        </div>
      ) : (
        <table className="data-table" style={{
          width: "100%", minWidth: canSeeRevenue ? 1300 : 950,
          borderCollapse: "collapse", tableLayout: "fixed",
        }}>
          {/* table-layout:fixed + explicit narrow widths — keeps the whole
              table within ~1300px (with revenue) / ~950px (without), so it
              fits without horizontal scrolling on any normal laptop/desktop
              window and the SOP/edit buttons in the last column are simply
              always on-screen already. (An earlier version tried
              position:sticky on the last column instead — table cells don't
              reliably support sticky across browsers/zoom levels, and it
              was overlapping neighboring columns in production — a fixed
              narrow layout is the more robust fix.) */}
          <colgroup>
            <col style={{ width: canSeeRevenue ? "16%" : "22%" }} />
            <col style={{ width: canSeeRevenue ? "7%" : "8%" }} />
            <col style={{ width: canSeeRevenue ? "10%" : "14%" }} />
            <col style={{ width: canSeeRevenue ? "8%" : "11%" }} />
            <col style={{ width: canSeeRevenue ? "9%" : "13%" }} />
            <col style={{ width: canSeeRevenue ? "8%" : "10%" }} />
            {canSeeRevenue && <col style={{ width: "8%" }} />}
            {canSeeRevenue && <col style={{ width: "8%" }} />}
            {canSeeRevenue && <col style={{ width: "8%" }} />}
            <col style={{ width: canSeeRevenue ? "7%" : "8%" }} />
            <col style={{ width: canSeeRevenue ? "11%" : "14%" }} />
          </colgroup>
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
              <th style={{ textAlign: "center", padding: "12px 8px" }}>
                Tác vụ
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((p, pIdx) => {
              const picName = PIC_NAMES[p.pic] || p.pic || "Chưa phân công";

              let statusColor = "rgba(100,116,139,0.15)";
              if (p.status === "Đang thực hiện") statusColor = "rgba(245,158,11,0.2)";
              if (p.status === "Done") statusColor = "rgba(16,185,129,0.2)";

              const isAssignedPic = p.pic && resolvePicName(p.pic) === resolvePicName(currentUser.pic);
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
                  <td style={{ padding: "14px 8px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                    📂 {p.name}
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--text-secondary)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.clientId || "—"}
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--cyan)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={picName}>
                    👤 {picName}
                  </td>
                  <td style={{ padding: "14px 8px", overflow: "hidden" }}>
                    <span style={{ fontSize: 11, background: "var(--panel-glow)", padding: "4px 8px", borderRadius: 4, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      {p.model}
                    </span>
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.job}>
                    {p.job}
                  </td>
                  <td style={{ padding: "14px 8px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.expectedOb}
                  </td>
                  {canSeeRevenue && (
                    <td style={{ padding: "14px 8px", textAlign: "right", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {formatRevenue(p.revenue)}
                    </td>
                  )}
                  {canSeeRevenue && (
                    <td style={{ padding: "14px 8px", textAlign: "right", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.lastMoNsr ? formatRevenue(p.lastMoNsr) : "—"}
                    </td>
                  )}
                  {canSeeRevenue && (
                    <td style={{ padding: "14px 8px", textAlign: "right", fontWeight: 600, color: "var(--cyan)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.rrNsr ? formatRevenue(p.rrNsr) : "—"}
                    </td>
                  )}
                  <td style={{ padding: "14px 8px", textAlign: "center", overflow: "hidden" }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "4px 8px",
                      borderRadius: 20,
                      background: statusColor,
                      color: p.status === "Done" ? "var(--green)" : "var(--amber)",
                      whiteSpace: "nowrap",
                    }}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ padding: "14px 8px", textAlign: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
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
                            border: "1px solid rgba(var(--brand-rgb),0.2)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Mở SOP 🔗
                        </a>
                      ) : p.sopLink ? (
                        <span
                          title={`${p.sopLink} — ô LINK SOP trên Sheet chỉ có tên/nhãn, không có URL thật. Mở Sheet, bấm chuột phải vào ô này > Insert link để gắn lại link đầy đủ.`}
                          style={{
                            color: "var(--amber)", fontSize: 10.5, padding: "4px 8px", cursor: "help",
                            maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          ⚠️ chưa có link
                        </span>
                      ) : (
                        <span style={{
                          color: "var(--red)", fontSize: 11, fontWeight: 600, padding: "5px 10px",
                          borderRadius: 6, background: "rgba(244,63,94,0.12)", border: "1px solid rgba(244,63,94,0.25)",
                          whiteSpace: "nowrap",
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
                          cursor: "pointer",
                          whiteSpace: "nowrap",
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
