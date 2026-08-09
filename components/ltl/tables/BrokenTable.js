import React from "react";

export default function BrokenTable({ brokenByType, totalBroken, brokenCompensated, brokenResolved, brokenPending, selectedType, onSelectType, topProvince }) {
  const types = Object.keys(brokenByType);
  return (
    <div style={{ overflowX: "auto" }}>
      {topProvince && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          📍 Tỉnh nhiều ca nhất: <strong style={{ color: "var(--text-primary)" }}>{topProvince.name}</strong>{" "}
          <span className="text-red" style={{ fontWeight: 600 }}>({topProvince.count} ca)</span>
        </div>
      )}
      {/* Summary badges */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <span
          className={`badge bg-red`}
          style={{ cursor: "pointer", opacity: !selectedType ? 1 : 0.6, border: !selectedType ? "1px solid #fff" : "none" }}
          onClick={() => onSelectType(null)}
        >
          Tất cả: {totalBroken}
        </span>
        <span className="badge bg-amber">Đền bù: {brokenCompensated}</span>
        <span className="badge bg-cyan">Đã xử lý: {brokenResolved}</span>
        <span className="badge" style={{ background: "rgba(100,116,139,0.15)", color: "var(--text-muted)" }}>Chưa xử lý: {brokenPending}</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Loại hư hỏng (Click dòng để lọc)</th>
            <th style={{ textAlign: "right" }}>Đền bù</th>
            <th style={{ textAlign: "right" }}>Đã xử lý</th>
            <th style={{ textAlign: "right" }}>Chưa xử lý</th>
            <th style={{ textAlign: "right" }}>Tổng</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => {
            const row = brokenByType[t];
            const total = (row["Đền bù"] || 0) + (row["Đã xử lý (không đền bù)"] || 0) + (row["Chưa xử lý"] || 0);
            const isSelected = selectedType === t;
            return (
              <tr 
                key={t} 
                onClick={() => onSelectType(isSelected ? null : t)}
                style={{ 
                  cursor: "pointer", 
                  background: isSelected ? "rgba(var(--brand-rgb), 0.15)" : "transparent",
                  borderLeft: isSelected ? "3px solid var(--cyan)" : "none"
                }}
              >
                <td style={{ fontWeight: isSelected ? 600 : 400 }}>{t} {isSelected && "🎯"}</td>
                <td style={{ textAlign: "right", color: "var(--amber)" }}>{row["Đền bù"] || 0}</td>
                <td style={{ textAlign: "right", color: "var(--cyan)" }}>{row["Đã xử lý (không đền bù)"] || 0}</td>
                <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{row["Chưa xử lý"] || 0}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
