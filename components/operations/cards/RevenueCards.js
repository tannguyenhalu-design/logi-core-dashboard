import React from 'react';
import { formatRevenue } from '../utils';

export default function RevenueCards({ totalRevenue, totalRrNsr, kpiSyncStatus, revenueByPic, revenueByStatus, ontimeByPic = {} }) {
  return (
    <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 13, color: "var(--text-primary)" }}>💰 KPI theo PIC — Doanh Thu (Dự kiến vs Thực đạt) & Tỷ Lệ Ontime</h4>
        {kpiSyncStatus && (() => {
          const { status, hoursAgo, lastSyncAt } = kpiSyncStatus;
          const color = status === "ok" ? "var(--green)" : status === "stale" ? "var(--amber)" : "var(--red)";
          const bg = status === "ok" ? "rgba(16,185,129,0.12)" : status === "stale" ? "rgba(245,158,11,0.12)" : "rgba(244,63,94,0.12)";
          const label = status === "never"
            ? "Chưa từng đồng bộ KPI"
            : hoursAgo < 1
            ? "Đồng bộ KPI: vừa xong"
            : hoursAgo < 24
            ? `Đồng bộ KPI: ${Math.round(hoursAgo)}h trước`
            : `Đồng bộ KPI: ${Math.round(hoursAgo / 24)} ngày trước`;
          return (
            <span
              title={lastSyncAt ? new Date(lastSyncAt).toLocaleString("vi-VN") : "Chưa có lần đồng bộ nào"}
              style={{ fontSize: 11, fontWeight: 600, color, background: bg, padding: "4px 10px", borderRadius: 20 }}
            >
              {status !== "ok" && "⚠️ "}{label}
            </span>
          );
        })()}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Theo PIC</div>
          {Object.entries(revenueByPic).sort((a, b) => b[1].revenue - a[1].revenue).map(([pic, v]) => {
            const pct = v.revenue > 0 ? Math.round((v.rrNsr / v.revenue) * 100) : null;
            const ot = ontimeByPic[pic];
            const otTotal = ot ? ot.ontime + ot.late : 0;
            const otPct = otTotal > 0 ? Math.round((ot.ontime / otTotal) * 100) : null;
            return (
              <div key={pic} style={{ padding: "6px 0", borderBottom: "1px solid var(--panel-border-soft)", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>{pic} <span style={{ color: "var(--text-muted)", fontSize: 11 }}>({v.count} dự án)</span></span>
                  <b style={{ color: "var(--cyan)" }}>{formatRevenue(v.revenue)}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Thực đạt:</span>
                  <b style={{ fontSize: 12, color: "var(--green)" }}>{formatRevenue(v.rrNsr)}</b>
                  {pct !== null && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: pct >= 100 ? "var(--green)" : pct >= 70 ? "var(--amber)" : "var(--red)" }}>
                      ({pct}%)
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>📦 Ontime:</span>
                  {otPct !== null ? (
                    <>
                      <b style={{ fontSize: 12, color: otPct >= 90 ? "var(--green)" : otPct >= 75 ? "var(--amber)" : "var(--red)" }}>
                        {otPct}%
                      </b>
                      <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>({otTotal} đơn, {ot.projectsWithData}/{v.count} dự án có dữ liệu)</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>chưa có dữ liệu LTL</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Theo trạng thái</div>
          {Object.entries(revenueByStatus).sort((a, b) => b[1].revenue - a[1].revenue).map(([status, v]) => {
            const pct = v.revenue > 0 ? Math.round((v.rrNsr / v.revenue) * 100) : null;
            return (
              <div key={status} style={{ padding: "6px 0", borderBottom: "1px solid var(--panel-border-soft)", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>{status} <span style={{ color: "var(--text-muted)", fontSize: 11 }}>({v.count} dự án)</span></span>
                  <b style={{ color: "var(--cyan)" }}>{formatRevenue(v.revenue)}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Thực đạt:</span>
                  <b style={{ fontSize: 12, color: "var(--green)" }}>{formatRevenue(v.rrNsr)}</b>
                  {pct !== null && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: pct >= 100 ? "var(--green)" : pct >= 70 ? "var(--amber)" : "var(--red)" }}>
                      ({pct}%)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
