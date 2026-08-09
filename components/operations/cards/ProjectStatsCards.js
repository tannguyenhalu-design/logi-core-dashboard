import React from 'react';

export default function ProjectStatsCards({ totalCount, inProgressCount, doneCount, canSeeRevenue, totalRevenue, totalRrNsr }) {
  return (
    <div className="grid-4" style={canSeeRevenue ? { gridTemplateColumns: "repeat(5, 1fr)" } : undefined}>
      <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng Dự Án</div>
        <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--text-primary)" }}>{totalCount}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đang theo dõi trong danh sách</div>
      </div>
      <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", padding: 16, borderRadius: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đang Thực Hiện</div>
        <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--amber)" }}>{inProgressCount}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đang viết SOP/Onsite</div>
      </div>
      <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", padding: 16, borderRadius: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đã Hoàn Thành (Done)</div>
        <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--green)" }}>{doneCount}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đã bàn giao và chạy ổn định</div>
      </div>
      {canSeeRevenue && (
        <div style={{ background: "rgba(var(--brand-rgb),0.05)", border: "1px solid rgba(var(--brand-rgb),0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Doanh Thu Dự Kiến</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--cyan)" }}>
            {totalRevenue > 0 ? (totalRevenue / 1000000000).toFixed(1).replace(".0", "") + " Tỷđ" : "0đ"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tổng quy mô doanh thu ước tính</div>
        </div>
      )}
      {canSeeRevenue && (
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Doanh Thu Thực Đạt</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--green)" }}>
            {totalRrNsr > 0 ? (totalRrNsr / 1000000000).toFixed(1).replace(".0", "") + " Tỷđ" : "0đ"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            RR/NSR tháng này{totalRevenue > 0 ? ` — đạt ${((totalRrNsr / totalRevenue) * 100).toFixed(0)}% kế hoạch` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
