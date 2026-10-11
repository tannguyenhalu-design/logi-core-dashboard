/**
 * components/ltl/VehicleCapacityPanel.js — "🚛 Ghép chuyến" tab (v1)
 * Ước lượng nhu cầu xe theo tấn FC và so sánh với sức chứa đội xe GHN (KhoGiaoTongTai).
 * Cảnh báo đỏ nếu thiếu hụt > 15%.
 */
import { useState, useEffect, useMemo } from "react";

const n = (v, d = 0) => v == null ? "—" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d });
const ton = (t, d = 1) => t > 0 ? `${Number(t).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d })} tấn` : "—";

const TRUCK_TYPES = [
  { key: "1.9T",   label: "Xe 1.9T",    payload: 1.5,  note: "Giao đô thị" },
  { key: "3.5T",   label: "Xe 3.5T",    payload: 3.0,  note: "Tuyến ngắn" },
  { key: "5T",     label: "Xe 5T",      payload: 4.5,  note: "Tuyến trung" },
  { key: "8T",     label: "Xe 8T",      payload: 7.0,  note: "Tuyến dài" },
  { key: "cont",   label: "Cont 40ft",  payload: 24.0, note: "Container" },
];

const DEFICIT_THRESHOLD = 0.15; // 15%

export default function VehicleCapacityPanel() {
  const [fcTon, setFcTon]         = useState(150);
  const [inputVal, setInputVal]   = useState("150");
  const [capacityData, setCapData] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [eventDays, setEventDays] = useState(3);

  useEffect(() => {
    setLoading(true);
    fetch("/api/vehicle-capacity")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setCapData(d); else setError(d.error || "Lỗi API"); })
      .catch(() => setError("Không kết nối được"))
      .finally(() => setLoading(false));
  }, []);

  // Nhận adjusted FC ton từ FCAuditorWidget (qua CustomEvent)
  useEffect(() => {
    const handler = (e) => {
      const ton = e?.detail?.adjustedTon;
      if (ton > 0 && ton <= 10000) {
        setFcTon(ton);
        setInputVal(String(ton));
      }
    };
    window.addEventListener("fc-auditor-update", handler);
    return () => window.removeEventListener("fc-auditor-update", handler);
  }, []);

  const commitInput = () => {
    const v = parseFloat(inputVal.replace(",", "."));
    if (v > 0 && v <= 10000) setFcTon(v);
    else setInputVal(String(fcTon));
  };

  const truckDemand = useMemo(() =>
    TRUCK_TYPES.map((t) => ({
      ...t,
      needed: Math.ceil(fcTon / t.payload),
    })),
  [fcTon]);

  // Tổng xe sẵn có theo dữ liệu KhoGiaoTongTai (trung bình / ngày × số ngày event)
  const totalAvailForEvent = capacityData
    ? Math.round(capacityData.total.avgTrucks * eventDays)
    : null;
  const totalNeeded = Math.ceil(fcTon / TRUCK_TYPES[1].payload); // xe 3.5T làm chuẩn tính
  const deficitPct = totalAvailForEvent != null && totalAvailForEvent > 0
    ? (totalNeeded - totalAvailForEvent) / totalAvailForEvent
    : null;
  const hasDeficit = deficitPct != null && deficitPct > DEFICIT_THRESHOLD;

  const inpS = {
    padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)",
    background: "var(--bg-panel)", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 32 }}>

      {/* Header note */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        Ước lượng số xe cần thiết dựa trên FC tấn sự kiện. Sức chứa đội xe từ dữ liệu kho giao GHN (KhoGiaoTongTai).
      </div>

      {/* FC tấn + số ngày input */}
      <div className="chart-panel">
        <div className="chart-panel-title">📦 Thông số sự kiện</div>
        <div style={{ padding: "0 12px 14px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>FC Tấn (3 ngày)</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" min="1" max="10000" step="1" value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onBlur={commitInput}
                onKeyDown={(e) => e.key === "Enter" && commitInput()}
                style={{ ...inpS, width: 100 }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>tấn</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Số ngày event</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 3, 5].map((d) => (
                <button key={d} onClick={() => setEventDays(d)} style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${eventDays === d ? "var(--cyan)" : "var(--border)"}`,
                  background: eventDays === d ? "rgba(var(--brand-rgb),0.12)" : "transparent",
                  color: eventDays === d ? "var(--cyan)" : "var(--text-muted)",
                  fontWeight: eventDays === d ? 700 : 400,
                }}>{d}</button>
              ))}
            </div>
          </div>
          {capacityData && (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", paddingBottom: 4 }}>
              Đội xe trung bình: <strong style={{ color: "var(--text-primary)" }}>{n(capacityData.total.avgTrucks, 0)}</strong> xe/ngày
              <span style={{ marginLeft: 8 }}>{n(capacityData.total.warehouses)} kho giao</span>
              <span style={{ marginLeft: 8 }}>{ton(capacityData.total.avgTonGtc)}/ngày</span>
            </div>
          )}
        </div>
      </div>

      {/* Bảng quy đổi số lượng xe */}
      <div className="chart-panel">
        <div className="chart-panel-title">🚛 Ước lượng nhu cầu xe · {ton(fcTon, 0)} FC tấn</div>
        <div style={{ overflowX: "auto", padding: "0 0 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 380 }}>
            <thead>
              <tr>
                {["Loại xe", "Tải trọng", "Số xe cần", "Ghi chú"].map((h, i) => (
                  <th key={i} style={{
                    padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
                    borderBottom: "1px solid var(--border)", textAlign: i > 0 ? "right" : "left",
                    ...(i === 2 ? { textAlign: "right", color: "var(--text-primary)" } : {}),
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {truckDemand.map((t) => (
                <tr key={t.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>{t.label}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", color: "var(--text-muted)" }}>{t.payload} tấn</td>
                  <td style={{ padding: "8px 12px", fontSize: 14, fontWeight: 700, textAlign: "right", color: "var(--cyan)" }}>{n(t.needed)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", color: "var(--text-muted)" }}>{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alert thiếu hụt */}
      {hasDeficit && (
        <div style={{
          background: "rgba(244,63,94,0.10)", border: "1px solid var(--red)", borderRadius: 8,
          padding: "10px 14px", fontSize: 12.5, color: "var(--red)", lineHeight: 1.6,
        }}>
          🔴 <strong>Cảnh báo thiếu hụt xe</strong> · Nhu cầu ({n(totalNeeded)} xe 3.5T) vượt đội xe trung bình {eventDays} ngày ({n(totalAvailForEvent)} xe)
          <span style={{ marginLeft: 8, fontWeight: 700 }}>+{(deficitPct * 100).toFixed(0)}%</span>
          <div style={{ color: "var(--text-secondary)", fontSize: 11.5, marginTop: 4 }}>
            Cần bổ sung xe thuê ngoài hoặc điều phối lại tuyến.
          </div>
        </div>
      )}

      {/* Sức chứa theo vùng */}
      <div className="chart-panel">
        <div className="chart-panel-title">📍 Sức chứa đội xe theo vùng</div>
        {loading && (
          <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
            Đang tải dữ liệu kho giao...
          </div>
        )}
        {error && (
          <div style={{ padding: "12px", fontSize: 12.5, color: "var(--red)" }}>⚠ {error}</div>
        )}
        {!loading && !error && capacityData && (
          <div style={{ overflowX: "auto", padding: "0 0 12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
              <thead>
                <tr>
                  {["Vùng", "Kho", "Xe TB/ngày", "Đơn GTC/ngày", "Tấn/ngày"].map((h, i) => (
                    <th key={i} style={{
                      padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
                      borderBottom: "1px solid var(--border)", textAlign: i > 0 ? "right" : "left",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(capacityData.byVung)
                  .sort(([, a], [, b]) => b.avgTrucks - a.avgTrucks)
                  .map(([vung, v]) => (
                    <tr key={vung} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "7px 12px", fontSize: 13, fontWeight: 600 }}>{vung}</td>
                      <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "var(--text-muted)" }}>{v.warehouses}</td>
                      <td style={{ padding: "7px 12px", fontSize: 13, fontWeight: 700, textAlign: "right", color: "var(--cyan)" }}>{n(v.avgTrucks, 1)}</td>
                      <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right" }}>{n(v.avgOrdersGtc)}</td>
                      <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "var(--text-muted)" }}>{ton(v.avgTonGtc)}</td>
                    </tr>
                  ))}
                {/* Total row */}
                <tr style={{ borderTop: "2px solid var(--border)", background: "rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 800 }}>Tổng cộng</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", fontWeight: 700 }}>{capacityData.total.warehouses}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontWeight: 800, color: "var(--cyan)" }}>{n(capacityData.total.avgTrucks, 1)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", fontWeight: 700 }}>{n(capacityData.total.avgOrdersGtc)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", fontWeight: 700, color: "var(--text-muted)" }}>{ton(capacityData.total.avgTonGtc)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
        * Số xe TB/ngày từ tab KhoGiaoTongTai (dữ liệu lịch sử GHN). Chưa chia theo loại xe — sẽ nâng cấp khi có dữ liệu chi tiết.
        Bộ lọc tuyến và cảnh báo tự động sẽ được bổ sung giai đoạn sau.
      </div>
    </div>
  );
}
