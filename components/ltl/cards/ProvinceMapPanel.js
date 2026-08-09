import React, { useState, useMemo, useCallback, useEffect } from "react";
import VietnamMap from "../../VietnamMap";
import { fmt, fmtWeight, getOntimeColor, getOntimeBadge } from "../utils";

export default function ProvinceMapPanel({
  provinceStats, routeStats, provinceDetailsMap = {},
  originStats = [], selectedOrigin = null, onOriginChange,
  projectSummaries = {}, overallData = {}, singleProjectMode, projectName, onProvinceClick,
}) {
  const [activeProv, setActiveProv] = useState(null);
  const [viewMode, setViewMode] = useState("orders"); // 'orders' | 'weight' | 'ontime' | 'damage'

  useEffect(() => {
    setActiveProv(null);
  }, [projectName, singleProjectMode, selectedOrigin]);

  const sortedProvinces = useMemo(() => {
    return [...(provinceStats || [])].sort((a, b) => {
      const aDet = provinceDetailsMap[a.name] || a.details;
      const bDet = provinceDetailsMap[b.name] || b.details;
      if (viewMode === "weight") return (bDet?.totalWeight || a.weight || 0) - (aDet?.totalWeight || b.weight || 0);
      if (viewMode === "ontime") return (aDet?.ontimePct ?? 100) - (bDet?.ontimePct ?? 100);
      if (viewMode === "damage") return (bDet?.damageCount || 0) - (aDet?.damageCount || 0);
      return b.orders - a.orders;
    });
  }, [provinceStats, provinceDetailsMap, viewMode]);

  const colorMap = useMemo(() => {
    const stats = provinceStats || [];
    const maxOrders = Math.max(...stats.map((p) => p.orders), 1);
    const maxWeight = Math.max(...stats.map((p) => (provinceDetailsMap[p.name]?.totalWeight || p.weight || 1)), 1);
    const map = {};
    stats.forEach((p) => {
      const pDet = provinceDetailsMap[p.name];
      if (viewMode === "weight") {
        const w = pDet?.totalWeight || p.weight || 0;
        const intensity = Math.min(1, w / maxWeight);
        map[p.name] = `rgba(13, 148, 136, ${(0.25 + intensity * 0.7).toFixed(2)})`;
      } else if (viewMode === "ontime") {
        const ontime = pDet ? pDet.ontimePct : 100;
        map[p.name] = getOntimeColor(ontime);
      } else if (viewMode === "damage") {
        const dmg = pDet ? pDet.damageCount : 0;
        map[p.name] = dmg > 0 ? "var(--amber)" : "var(--map-unhighlighted)";
      } else {
        const intensity = Math.min(1, p.orders / maxOrders);
        map[p.name] = `rgba(var(--brand-rgb), ${(0.2 + intensity * 0.75).toFixed(2)})`;
      }
    });
    return map;
  }, [provinceStats, provinceDetailsMap, viewMode]);

  const topProvinces = useMemo(() => sortedProvinces.slice(0, 8), [sortedProvinces]);
  const highlightProvinces = useMemo(
    () => (singleProjectMode ? [] : sortedProvinces.slice(0, 5).map((p) => p.name)),
    [singleProjectMode, sortedProvinces]
  );

  const routeLines = useMemo(() => (
    singleProjectMode
      ? (routeStats || []).slice(0, 25).map((r) => ({ from: r.from, to: r.to, weight: r.orders, color: "#33D6C0" }))
      : []
  ), [singleProjectMode, routeStats]);

  const handleProvinceHover = useCallback((prov) => setActiveProv(prov), []);
  const handleProvinceClick = useCallback(
    (prov) => (onProvinceClick ? onProvinceClick(prov) : setActiveProv(prov)),
    [onProvinceClick]
  );

  if (!provinceStats || provinceStats.length === 0) {
    return (
      <div className="chart-panel" style={{ width: "100%" }}>
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)" }}>
          Không có dữ liệu tỉnh giao trong khoảng lọc hiện tại.
        </div>
      </div>
    );
  }

  const inspectData = activeProv ? (provinceDetailsMap[activeProv] || provinceStats.find(p => p.name === activeProv)?.details) : null;
  const projectOverview = singleProjectMode ? projectSummaries[projectName] : null;

  return (
    <div className="chart-panel" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          Bản đồ phân bố giao hàng theo tỉnh{singleProjectMode ? ` — Dự án ${projectName}` : ""}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--input-bg)", padding: 3, borderRadius: 8, border: "1px solid var(--border)", flexWrap: "wrap" }}>
          <button
            onClick={() => setViewMode("orders")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "orders" ? "var(--cyan)" : "transparent",
              color: viewMode === "orders" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            📦 Theo Số Đơn
          </button>
          <button
            onClick={() => setViewMode("weight")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "weight" ? "var(--cyan)" : "transparent",
              color: viewMode === "weight" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            ⚖️ Theo Tải Trọng (Tấn)
          </button>
          <button
            onClick={() => setViewMode("ontime")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "ontime" ? "var(--cyan)" : "transparent",
              color: viewMode === "ontime" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            ⏱️ Tỷ Lệ Ontime
          </button>
          <button
            onClick={() => setViewMode("damage")}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: viewMode === "damage" ? "var(--amber)" : "transparent",
              color: viewMode === "damage" ? "#0f172a" : "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            💥 Ca Hư Hỏng
          </button>
        </div>
      </div>

      <div className="province-map-grid">
        <div style={{ position: "sticky", top: 80, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <VietnamMap
            colorMap={colorMap}
            highlightProvinces={highlightProvinces}
            routeLines={routeLines}
            provinceDetailsMap={provinceDetailsMap}
            viewMode={viewMode}
            onProvinceHover={handleProvinceHover}
            onProvinceClick={handleProvinceClick}
          />
          {singleProjectMode && (
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, textAlign: "center" }}>
              Nét càng dày = số lượng đơn giao càng lớn.
            </p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {inspectData ? (
            <div style={{
              background: "var(--panel-bg-strong)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "16px 20px",
              backdropFilter: "blur(8px)",
              minHeight: 310,
              transition: "all 0.2s ease-out",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                  📍 Chi tiết khu vực: {inspectData.name}
                  {(() => {
                    const badge = getOntimeBadge(inspectData.ontimePct);
                    return (
                      <span style={{ fontSize: 11, background: badge.bg, color: badge.color, border: `1px solid ${badge.color}`, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </span>
                <span className="badge bg-cyan" style={{ fontSize: 12 }}>
                  {fmt(inspectData.totalOrders)} đơn · {fmtWeight(inspectData.totalWeight)}
                </span>
              </div>

              <div className="grid-4" style={{ gap: 10, marginBottom: 14 }}>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tỷ lệ Ontime</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: getOntimeColor(inspectData.ontimePct) }}>
                    {inspectData.ontimePct}%
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Điểm lấy hàng chính</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {inspectData.topOrigins && inspectData.topOrigins.length > 0
                      ? `${inspectData.topOrigins[0].name} (${inspectData.topOrigins[0].pct}%)`
                      : "—"}
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đơn Ontime / Late</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    <span style={{ color: "var(--green)" }}>{inspectData.ontimeCount}</span> / <span style={{ color: "var(--red)" }}>{inspectData.lateCount}</span>
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Ca Hư Hỏng</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: inspectData.damageCount > 0 ? "var(--amber)" : "var(--text-secondary)" }}>
                    {inspectData.damageCount || 0} ca {inspectData.damageCount > 0 && "💥"}
                  </div>
                </div>
              </div>

              {inspectData.clientDetails && inspectData.clientDetails.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    🏢 Khách Hàng & Tuyến Lấy Hàng Giao Khu Vực {inspectData.name}:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
                    {inspectData.clientDetails.map((c) => {
                      const badge = getOntimeBadge(c.ontimePct);
                      const hasDamage = c.damageCount > 0;
                      return (
                        <div
                          key={c.name}
                          style={{
                            background: "var(--panel-bg)",
                            border: `1px solid ${c.ontimePct < 80 ? "var(--red)" : c.ontimePct < 90 ? "var(--amber)" : "var(--border)"}`,
                            padding: "8px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "var(--text-primary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>KH {c.name}</span>
                            <span style={{ color: "var(--cyan)", fontWeight: 700 }}>{fmt(c.orders)} đơn</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                            • Lấy tại: <b style={{ color: "var(--text-secondary)" }}>{c.mainOrigin}</b>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                            • Tải trọng: <b style={{ color: "var(--text-secondary)" }}>{fmtWeight(c.weight)}</b>
                          </div>
                          <div style={{ fontSize: 11, color: badge.color, marginTop: 2, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                            <span>• Tỷ lệ Ontime: <b>{c.ontimePct}%</b></span>
                            {c.ontimePct < 90 && (
                              <span style={{ fontSize: 10, background: badge.bg, padding: "1px 4px", borderRadius: 3, color: badge.color }}>
                                {c.ontimePct < 80 ? "🚨 Low" : "⚠️ Mid"}
                              </span>
                            )}
                          </div>
                          {hasDamage && (
                            <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 2, fontWeight: 600 }}>
                              • Hư hỏng: <b>{c.damageCount} ca 💥</b>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{
              background: "var(--panel-bg-strong)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "16px 20px",
              backdropFilter: "blur(8px)",
              minHeight: 310,
              transition: "all 0.2s ease-out",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cyan)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  🏢 {singleProjectMode ? `Góc Nhìn Tổng Quan Khách Hàng: ${projectName}` : "Góc Nhìn Tổng Quan Toàn Bộ Dự Án LTL"}
                  {singleProjectMode && selectedOrigin && (
                    <span style={{ fontSize: 11, background: "rgba(var(--brand-rgb),0.15)", color: "var(--cyan)", border: "1px solid var(--cyan)", padding: "2px 8px", borderRadius: 4, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                      🏬 Lấy tại: {selectedOrigin}
                      <span onClick={() => onOriginChange?.(null)} style={{ cursor: "pointer", opacity: 0.8 }} title="Bỏ lọc">✕</span>
                    </span>
                  )}
                  {(() => {
                    const pct = singleProjectMode ? (projectOverview?.ontimePct ?? 100) : (overallData?.ontimePct ?? 100);
                    const badge = getOntimeBadge(pct);
                    return (
                      <span style={{ fontSize: 11, background: badge.bg, color: badge.color, border: `1px solid ${badge.color}`, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </span>
                <span className="badge bg-cyan" style={{ fontSize: 12 }}>
                  {singleProjectMode
                    ? `${fmt(projectOverview?.totalOrders || 0)} đơn · ${fmtWeight(projectOverview?.totalWeight || 0)}`
                    : `${fmt(overallData?.totalOrders || 0)} đơn · ${fmtWeight(overallData?.totalWeight || 0)}`}
                </span>
              </div>

              <div className="grid-4" style={{ gap: 10, marginBottom: 14 }}>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tỷ Lệ Ontime Tổng</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: getOntimeColor(singleProjectMode ? projectOverview?.ontimePct : overallData?.ontimePct) }}>
                    {singleProjectMode ? projectOverview?.ontimePct : overallData?.ontimePct}%
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tổng Tải Trọng</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {fmtWeight(singleProjectMode ? projectOverview?.totalWeight : overallData?.totalWeight)}
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đơn Ontime / Late</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    <span style={{ color: "var(--green)" }}>{singleProjectMode ? projectOverview?.ontimeCount : overallData?.ontimeCount}</span> / <span style={{ color: "var(--red)" }}>{singleProjectMode ? projectOverview?.lateCount : overallData?.lateCount}</span>
                  </div>
                </div>
                <div style={{ background: "var(--panel-bg)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Số Ca Bể Vỡ / Hư Hỏng</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: (singleProjectMode ? projectOverview?.damageCount : overallData?.damageCount) > 0 ? "var(--amber)" : "var(--text-secondary)" }}>
                    {(singleProjectMode ? projectOverview?.damageCount : overallData?.damageCount) || 0} ca {(singleProjectMode ? projectOverview?.damageCount : overallData?.damageCount) > 0 && "💥"}
                  </div>
                </div>
              </div>

              {singleProjectMode && projectOverview && (
                <div className="grid-2" style={{ gap: 12 }}>
                  <div style={{ background: "var(--panel-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase" }}>
                      🏬 Điểm Lấy Hàng Chính Của {projectName} (bấm để lọc):
                    </div>
                    {originStats && originStats.length > 0 ? (
                      originStats.slice(0, 5).map((o) => {
                        const oDet = o.details;
                        const isSel = selectedOrigin === o.name;
                        return (
                          <div
                            key={o.name}
                            onClick={() => onOriginChange?.(isSel ? null : o.name)}
                            style={{
                              display: "flex", justifyContent: "space-between", alignItems: "center",
                              fontSize: 11.5, marginBottom: 3, padding: "3px 6px", borderRadius: 4,
                              cursor: "pointer",
                              background: isSel ? "rgba(var(--brand-rgb),0.15)" : "transparent",
                              border: isSel ? "1px solid var(--cyan)" : "1px solid transparent",
                            }}
                          >
                            <span style={{ color: "var(--text-primary)" }}>{isSel ? "🎯" : "•"} {o.name}</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <b style={{ color: "var(--cyan)" }}>{o.orders} đơn</b>
                              {oDet && (
                                <span style={{ color: getOntimeColor(oDet.ontimePct), fontSize: 10.5, fontWeight: 600 }}>
                                  {oDet.ontimePct}%
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Chưa ghi nhận điểm lấy</div>
                    )}
                  </div>

                  <div style={{ background: "var(--panel-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase" }}>
                      🚚 Top Tỉnh Giao Hàng Lớn Nhất{selectedOrigin ? ` (từ ${selectedOrigin})` : ""}:
                    </div>
                    {projectOverview.topProvinces && projectOverview.topProvinces.length > 0 ? (
                      projectOverview.topProvinces.slice(0, 3).map((p) => (
                        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                          <span style={{ color: "var(--text-primary)" }}>• {p.name}</span>
                          <b style={{ color: "var(--cyan)" }}>{p.count} đơn ({p.pct}%)</b>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Chưa ghi nhận tỉnh giao</div>
                    )}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, fontStyle: "italic" }}>
                💡 Rà chuột vào 1 tỉnh bất kỳ trên bản đồ để soi chi tiết từng tuyến lấy/giao & khách hàng tại tỉnh đó.
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              💡 Top 8 Tỉnh ({viewMode === "weight" ? "Xếp theo Tải trọng Tấn" : viewMode === "ontime" ? "Cảnh báo Ontime thấp trước" : viewMode === "damage" ? "Xếp theo Ca Bể Vỡ" : "Xếp theo Số đơn"})
            </div>
            <div className="grid-2" style={{ gap: 8 }}>
              {topProvinces.map((p) => {
                const isSelected = activeProv === p.name;
                const pDet = provinceDetailsMap[p.name] || p.details;
                const pOntime = pDet ? pDet.ontimePct : 100;
                const pColor = getOntimeColor(pOntime);
                const pWeight = pDet?.totalWeight || p.weight || 0;

                return (
                  <div
                    key={p.name}
                    onMouseEnter={() => setActiveProv(p.name)}
                    onMouseLeave={() => setActiveProv(null)}
                    onClick={() => onProvinceClick ? onProvinceClick(p.name) : setActiveProv(p.name)}
                    style={{
                      background: isSelected ? "rgba(var(--brand-rgb),0.12)" : "var(--panel-bg)",
                      border: isSelected ? "1px solid var(--cyan)" : `1px solid ${pOntime < 80 ? "var(--red)" : pOntime < 90 ? "var(--amber)" : "var(--border)"}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5, color: pColor, display: "flex", alignItems: "center", gap: 4 }}>
                        {p.name}
                        {pOntime < 80 ? <span style={{ fontSize: 10 }}>🚨</span> : pOntime < 90 ? <span style={{ fontSize: 10 }}>⚠️</span> : null}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--cyan)", fontWeight: 700 }}>
                        {fmt(p.orders)} đơn ({pWeight >= 1000 ? (pWeight/1000).toFixed(1).replace(".0","") + " tấn" : pWeight + " kg"})
                      </span>
                    </div>
                    {p.topClient && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Top: {p.topClient.name} ({p.topClient.pct}%)
                        {pDet && ` · Ontime: ${pDet.ontimePct}%`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
