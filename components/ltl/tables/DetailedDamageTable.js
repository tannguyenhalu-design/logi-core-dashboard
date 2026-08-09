import React, { useState, useEffect } from "react";

const CLAIM_STATUSES = ["Mới", "Đang xử lý", "Chờ đền bù", "Hoàn tất"];

export default function DetailedDamageTable({ cases, filter, showClaimsWorkflow = true }) {
  const [claims, setClaims] = useState({});
  const [savingCode, setSavingCode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!showClaimsWorkflow) return;
    fetch("/api/damage-claims")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setClaims(json.claims || {}); })
      .catch(() => {});
  }, [showClaimsWorkflow]);

  const uniqueProjects = [...new Set(cases.map(c => c.client_name).filter(Boolean))].sort();
  const uniqueTypes = [...new Set(cases.map(c => c.damage_type).filter(Boolean))].sort();
  const uniqueWarehouses = [...new Set(cases.map(c => c.warehouse_giao).filter(Boolean))].sort();

  const saveClaim = async (orderCode, patch) => {
    const current = claims[orderCode] || { status: "Mới", assignee: "", notes: "" };
    const next = { ...current, ...patch };
    setClaims((prev) => ({ ...prev, [orderCode]: next }));
    setSavingCode(orderCode);
    try {
      const res = await fetch("/api/damage-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCode, status: next.status, assignee: next.assignee, notes: next.notes }),
      });
      const json = await res.json();
      if (json.ok) setClaims((prev) => ({ ...prev, [orderCode]: json.claim }));
    } catch (e) {
      // leave optimistic value in place
    } finally {
      setSavingCode(null);
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredCases = cases.filter(c => {
    if (filter) {
      if (filter.type === 'type' && String(c.damage_type || "").trim().toLowerCase() !== String(filter.value || "").trim().toLowerCase()) return false;
      if (filter.type === 'province' && c.to_province !== filter.value) return false;
      if (filter.type === 'warehouse' && c.warehouse_giao !== filter.value) return false;
    }
    if (projectFilter !== "all" && c.client_name !== projectFilter) return false;
    if (typeFilter !== "all" && c.damage_type !== typeFilter) return false;
    if (warehouseFilter !== "all" && c.warehouse_giao !== warehouseFilter) return false;
    if (statusFilter !== "all" && c.handling !== statusFilter) return false;
    if (q) {
      const haystack = `${c.order_code} ${c.client_name} ${c.to_province} ${c.warehouse_giao} ${c.damage_details} ${c.offence_place}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const hasLocalFilters = q || projectFilter !== "all" || typeFilter !== "all" || warehouseFilter !== "all" || statusFilter !== "all";
  const clearLocalFilters = () => {
    setSearchQuery(""); setProjectFilter("all"); setTypeFilter("all"); setWarehouseFilter("all"); setStatusFilter("all");
  };

  const selectStyle = {
    background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 6, fontSize: 12, padding: "6px 8px", fontFamily: "inherit", cursor: "pointer",
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 Tìm mã đơn, dự án, kho, mô tả..."
          style={{
            background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
            borderRadius: 6, fontSize: 12, padding: "6px 10px", fontFamily: "inherit", minWidth: 220, flex: 1,
          }}
        />
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả dự án</option>
          {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả loại lỗi</option>
          {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả kho</option>
          {uniqueWarehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả trạng thái</option>
          <option value="Đền bù">Đền bù</option>
          <option value="Đã xử lý (không đền bù)">Đã xử lý (không đền bù)</option>
          <option value="Chưa xử lý">Chưa xử lý</option>
        </select>
        {hasLocalFilters && (
          <button
            onClick={clearLocalFilters}
            style={{ background: "rgba(244,63,94,0.15)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 11, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
          >
            Xóa lọc x
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {filteredCases.length} / {cases.length} ca
        </span>
      </div>

      <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>Dự án</th>
            <th>Tỉnh nhận</th>
            <th>Kho giao</th>
            <th>Loại lỗi</th>
            <th>Mô tả chi tiết hư hỏng</th>
            <th>Nơi phát hiện</th>
            <th style={{ textAlign: "right" }}>Số tiền</th>
            <th>Hướng xử lý</th>
            {showClaimsWorkflow && <th>Trạng thái xử lý (nội bộ)</th>}
            {showClaimsWorkflow && <th>Người phụ trách</th>}
          </tr>
        </thead>
        <tbody>
          {filteredCases.map((c, i) => {
            const claim = claims[c.order_code] || { status: "Mới", assignee: "" };
            return (
            <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "var(--cyan)" }}>{c.order_code}</td>
              <td style={{ fontSize: 12 }}>{c.client_name}</td>
              <td style={{ fontSize: 12 }}>{c.to_province}</td>
              <td style={{ fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.warehouse_giao}>{c.warehouse_giao}</td>
              <td><span className="badge bg-red" style={{ fontSize: 10, padding: "2px 6px" }}>{c.damage_type}</span></td>
              <td style={{ fontSize: 12, maxWidth: 320, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4, padding: "8px 12px" }}>{c.damage_details || "—"}</td>
              <td style={{ fontSize: 12 }}>{c.offence_place || "—"}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace", color: "var(--amber)", fontSize: 12, fontWeight: 600 }}>
                {c.amount > 0 ? c.amount.toLocaleString("vi-VN") + " đ" : "—"}
              </td>
              <td>
                <span className={`badge ${c.handling === "Đền bù" ? "bg-amber" : c.handling === "Đã xử lý (không đền bù)" ? "bg-cyan" : "bg-muted"}`} style={{ fontSize: 10 }}>
                  {c.handling}
                </span>
              </td>
              {showClaimsWorkflow && (
                <td>
                  {c.order_code ? (
                    <select
                      value={claim.status}
                      onChange={(e) => saveClaim(c.order_code, { status: e.target.value })}
                      disabled={savingCode === c.order_code}
                      style={{
                        background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
                        borderRadius: 4, fontSize: 11, padding: "3px 6px", fontFamily: "inherit",
                      }}
                    >
                      {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : "—"}
                </td>
              )}
              {showClaimsWorkflow && (
                <td>
                  {c.order_code ? (
                    <input
                      type="text"
                      defaultValue={claim.assignee}
                      placeholder="Chưa gán"
                      onBlur={(e) => {
                        if (e.target.value !== claim.assignee) saveClaim(c.order_code, { assignee: e.target.value });
                      }}
                      style={{
                        background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
                        borderRadius: 4, fontSize: 11, padding: "3px 6px", fontFamily: "inherit", width: 100,
                      }}
                    />
                  ) : "—"}
                </td>
              )}
            </tr>
            );
          })}
          {filteredCases.length === 0 && (
            <tr>
              <td colSpan={showClaimsWorkflow ? 11 : 9} style={{ textAlign: "center", color: "var(--text-muted)", padding: 30 }}>
                {cases.length === 0 ? "Không có dữ liệu ca hư hỏng chi tiết." : "Không có ca nào khớp bộ lọc hiện tại."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
