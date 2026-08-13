import { useState } from "react";
import KpiCard from "../../components/KpiCard";
import TruckLoader from "../../components/TruckLoader";
import { downloadCSV } from "../../lib/csv-export";
import { PeriodComparisonSection, BreakageAlertSection } from "../../components/TabAIInsights";
import { useTheme } from "./charts/chartUtils";
import { fmt } from "./utils";

import OntimeMonthChart from "./charts/OntimeMonthChart";
import OntimeProjChart from "./charts/OntimeProjChart";
import OrdersProjChart from "./charts/OrdersProjChart";
import WeightProjChart from "./charts/WeightProjChart";
import WarehouseRiskChart from "./charts/WarehouseRiskChart";

import ProvinceMapPanel from "./cards/ProvinceMapPanel";
import DetailedDamageTable from "./tables/DetailedDamageTable";

export default function LTLDashboard({ data, rawData, aiInsights, selectedProjects = [], userRole, periodWeeks = "mtd", onPeriodWeeksChange, selectedOrigin = null, onOriginChange }) {
  const [damageFilter, setDamageFilter] = useState(null); // { type: 'type' | 'province' | 'warehouse', value: string }
  const [selectedProvinceOrders, setSelectedProvinceOrders] = useState(null);
  const theme = useTheme();

  if (!data) return <TruckLoader />;

  const rawLtl = data.filteredRows || [];

  const isClient = userRole === "client";
  const singleProjectMode = selectedProjects.length === 1;

  const selectedDamageType = damageFilter?.type === "type" ? damageFilter.value : null;

  const exportSummaryCSV = () => {
    const projects = Object.values(data.projectSummaries || {}).sort((a, b) => b.totalOrders - a.totalOrders);
    downloadCSV(
      `SD3- Dashboard Điện Máy - ${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { label: "Dự án", value: "name" },
        { label: "Số đơn", value: "totalOrders" },
        { label: "Tổng tải trọng (kg)", value: (r) => Math.round(r.totalWeight) },
        { label: "Đơn ontime", value: "ontimeCount" },
        { label: "Đơn late", value: "lateCount" },
        { label: "% Ontime", value: (r) => (r.evalCount > 0 ? ((r.ontimeCount / r.evalCount) * 100).toFixed(1) : "") },
        { label: "Ca hư hỏng", value: (r) => r.damageCount || 0 },
      ],
      projects
    );
  };

  const closeProvModal = () => setSelectedProvinceOrders(null);
  const provOrdersList = selectedProvinceOrders ? rawLtl.filter(r => 
    String(r.from_province_name || "").trim() === selectedProvinceOrders || 
    String(r.to_province_name || "").trim() === selectedProvinceOrders
  ) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI Cards */}
      {!isClient && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={exportSummaryCSV}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "var(--panel-glow)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", padding: "6px 12px", borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Xuất báo cáo CSV
          </button>
        </div>
      )}
      <div className="grid-4">
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>}
          label={data.filterMode === "delivered" ? "GTC (ngày giao)" : "Tổng Đơn (lấy hàng)"}
          value={fmt(data.totalOrders)}
          sub="Tính theo số lượng đơn"
          colorClass="text-cyan"
        />
        {data.filterMode !== "delivered" && (
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            label="GTC trong kỳ"
            value={fmt(data.deliveredThisMonthCount)}
            sub="Tính theo ngày giao thực tế"
            colorClass="text-green"
          />
        )}

        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
          label="Đơn Late"
          value={fmt(data.lateCount)}
          sub={`${data.evalCount > 0 ? (100 - data.ontimePct).toFixed(1) : 0}% tỷ lệ late`}
          colorClass="text-red"
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
          label="Ca Hư Hỏng"
          value={fmt(data.totalBroken)}
          sub={`${data.brokenCompensated} đền bù · ${data.brokenPending} chưa xử lý`}
          colorClass="text-amber"
        />
      </div>

      <ProvinceMapPanel
        provinceStats={data.provinceStats}
        routeStats={data.routeStats}
        provinceDetailsMap={data.provinceDetailsMap || {}}
        originStats={data.originStats || []}
        projectSummaries={data.projectSummaries || {}}
        overallData={{
          totalOrders: data.totalOrders,
          totalWeight: data.totalWeight,
          ontimePct: data.ontimePct,
          ontimeCount: data.ontimeCount,
          lateCount: data.lateCount,
          damageCount: data.totalBroken,
        }}
        singleProjectMode={singleProjectMode}
        projectName={singleProjectMode ? selectedProjects[0] : ""}
        selectedOrigin={selectedOrigin}
        onOriginChange={onOriginChange}
        onProvinceClick={(prov) => setSelectedProvinceOrders(prov)}
      />

      <div className="chart-panel" style={{ width: "100%" }}>
        <div className="chart-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Xu hướng Ontime / Late theo {data.isWeekly ? "tuần" : "tháng"}
        </div>
        <div style={{ height: 320 }}>
          <OntimeMonthChart ontimeByMonth={data.ontimeByMonth} isWeekly={data.isWeekly} theme={theme} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
          ⓘ Cột tháng/tuần gần nhất còn đang chạy — nhiều đơn chưa kịp giao nên % ontime sẽ còn thay đổi. Xem "So sánh cùng kỳ" bên dưới để có góc nhìn ổn định hơn.
        </div>
      </div>

      <PeriodComparisonSection
        comparison={data.periodComparison}
        declineAlerts={data.declineAlerts}
        compact={singleProjectMode}
        periodWeeks={periodWeeks}
        onPeriodWeeksChange={onPeriodWeeksChange}
      />

      {!singleProjectMode && (
        <>
          <div className="grid-2" style={{ gap: 20 }}>
            <div className="chart-panel">
              <div className="chart-panel-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                📦 Tỷ trọng Số Đơn theo Dự Án
              </div>
              <div style={{ height: 260 }}>
                <OrdersProjChart ordersByProject={data.ordersByProject} theme={theme} />
              </div>
            </div>

            <div className="chart-panel">
              <div className="chart-panel-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"/></svg>
                ⚖️ Tỷ trọng Tải Trọng (Tấn/Kg) theo Dự Án
              </div>
              <div style={{ height: 260 }}>
                <WeightProjChart weightByProject={data.weightByProject || {}} theme={theme} />
              </div>
            </div>
          </div>

          <div className="chart-panel" style={{ width: "100%" }}>
            <div className="chart-panel-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              % Ontime theo Dự Án
            </div>
            <div style={{ height: 240 }}>
              <OntimeProjChart ontimeByProject={data.ontimeByProject} theme={theme} />
            </div>
          </div>
        </>
      )}

      {!isClient && (
        <div className="chart-panel" style={{ width: "100%" }}>
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            Top 10 Kho Rủi Ro Cao — Chi Tiết Hư Hỏng
          </div>
          <div style={{ height: 240 }}>
            <WarehouseRiskChart
              warehouseAlerts={data.warehouseAlerts}
              selectedWarehouse={damageFilter?.type === "warehouse" ? damageFilter.value : null}
              onSelectWarehouse={(wh) => setDamageFilter(wh ? { type: "warehouse", value: wh } : null)}
              theme={theme}
            />
          </div>
        </div>
      )}

      {!isClient && aiInsights && (
        <div className="chart-panel" style={{ width: "100%" }}>
          <div className="chart-panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            Cảnh Báo Bể Vỡ Theo Tuyến
          </div>
          <BreakageAlertSection
            routes={aiInsights.breakageRoutes}
            avgDmgRate={aiInsights.avgDmgRate}
            totalOrders={aiInsights.totalOrders}
          />
        </div>
      )}



      <div className="chart-panel">
        <div className="chart-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Chi Tiết Ca Hư Hỏng {damageFilter ? `— Lọc theo ${damageFilter.type === "type" ? "Loại: " : damageFilter.type === "province" ? "Tỉnh: " : "Kho: "}${damageFilter.value}` : ""}
          </span>
          {damageFilter && (
            <button 
              onClick={() => setDamageFilter(null)}
              style={{ background: "rgba(244,63,94,0.15)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}
            >
              Hủy lọc x
            </button>
          )}
        </div>
        <DetailedDamageTable
          cases={data.detailedDamageCases || []}
          filter={damageFilter}
          showClaimsWorkflow={!isClient}
        />
      </div>
      {selectedProvinceOrders && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999
        }} onClick={closeProvModal}>
          <div style={{
            background: "var(--bg-panel)", border: "1px solid var(--border)",
            borderRadius: 12, padding: 24, width: "90%", maxWidth: 800,
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>
                  📍 Chi tiết đơn hàng: <span style={{ color: "var(--cyan)" }}>{selectedProvinceOrders}</span>
                </h2>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                  Tổng cộng: {provOrdersList.length} đơn hàng trong bộ lọc hiện tại
                </div>
              </div>
              <button onClick={closeProvModal} style={{
                background: "none", border: "none", color: "var(--text-muted)",
                fontSize: 24, cursor: "pointer", lineHeight: 1
              }}>✕</button>
            </div>
            
            <div style={{ overflowY: "auto", flex: 1, borderRadius: 8, border: "1px solid var(--border)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--bg-panel)", zIndex: 1 }}>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Mã Đơn</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Dự Án</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Tuyến Đường</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Trọng Lượng</th>
                    <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>Trạng Thái</th>
                  </tr>
                </thead>
                <tbody>
                  {provOrdersList.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Không có đơn hàng nào</td></tr>
                  ) : (
                    provOrdersList.map((odr, idx) => {
                      const isLate = String(odr.odr_success || "").toLowerCase().includes("late");
                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--border)", background: idx % 2 === 0 ? "transparent" : "var(--panel-glow)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--text-primary)" }}>{odr.order_code || "N/A"}</td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>{odr.client_name}</td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>
                            <span style={{ color: odr.from_province_name === selectedProvinceOrders ? "var(--cyan)" : "inherit" }}>{odr.from_province_name || "?"}</span>
                            {" → "}
                            <span style={{ color: odr.to_province_name === selectedProvinceOrders ? "var(--cyan)" : "inherit" }}>{odr.to_province_name || "?"}</span>
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>
                            {odr.weight ? `${(parseFloat(odr.weight) / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} kg` : "-"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {isLate ? (
                              <span style={{ background: "rgba(244,63,94,0.15)", color: "var(--red)", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Late</span>
                            ) : (
                              <span style={{ background: "rgba(16,185,129,0.15)", color: "var(--green)", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Ontime</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
