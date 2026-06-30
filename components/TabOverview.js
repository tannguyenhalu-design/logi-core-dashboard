/**
 * components/TabOverview.js — Overview tab: always shows all-time data
 */
import KpiCard from "./KpiCard";

function fmt(n, d = 0) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("vi-VN", { maximumFractionDigits: d });
}

export default function TabOverview({ overview }) {
  if (!overview) return <div className="spinner" />;
  const { ltl, ftl } = overview;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          LTL — Giao Hàng Lẻ (Toàn kỳ)
        </p>
        <div className="grid-4">
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/></svg>}
            label="Tổng Đơn LTL"
            value={fmt(ltl?.totalOrders)}
            sub={`${fmt(ltl?.totalWeight)} KG`}
            colorClass="text-cyan"
          />
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg>}
            label="Ontime Overall"
            value={(ltl?.ontimePct || 0) + "%"}
            colorClass="text-green"
          />
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>}
            label="Ca Hư Hỏng"
            value={fmt(ltl?.totalBroken)}
            colorClass="text-amber"
          />
        </div>
      </div>

      <div>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          FTL — Giao Hàng Nguyên Chuyến (Toàn kỳ)
        </p>
        <div className="grid-4">
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/></svg>}
            label="Tổng Chuyến FTL"
            value={fmt(ftl?.totalTrips)}
            colorClass="text-purple"
          />
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/></svg>}
            label="Tổng Đơn FTL"
            value={fmt(ftl?.totalOrders)}
            colorClass="text-cyan"
          />
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/></svg>}
            label="Khối Lượng FTL"
            value={fmt(ftl?.totalWeight) + " KG"}
            colorClass="text-green"
          />
        </div>
      </div>

      <div className="chart-panel" style={{ padding: 20 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          💡 <strong style={{ color: "var(--text-secondary)" }}>Ghi chú:</strong> Tab Tổng quan luôn hiển thị toàn bộ dữ liệu, không phụ thuộc vào filter tháng/dự án đang chọn. Dùng các tab LTL / FTL để xem theo bộ lọc chi tiết.
        </p>
      </div>
    </div>
  );
}
