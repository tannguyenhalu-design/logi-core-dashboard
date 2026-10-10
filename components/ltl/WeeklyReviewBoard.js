/**
 * components/ltl/WeeklyReviewBoard.js
 * Bàn Review Tuần dành cho Manager — 3 phần:
 *   1. Biến động sản lượng KH W_prev vs W_curr + nhãn Tiềm năng
 *   2. Truy vết bể vỡ theo Khâu (Bốc xếp / Chèn lót FTL / Hub / Lastmile)
 *   3. Ghi chú & Chỉ đạo Ops tuần — lưu localStorage
 */
import { useState, useMemo } from "react";

function getISOWeek(utcDate) {
  // utcDate phải được tạo bằng Date.UTC để tránh lệch múi giờ
  const d = new Date(utcDate.getTime());
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getKhau(c) {
  const txt = [c.damage_details, c.suspected_leg, c.damage_type].filter(Boolean).join(" ").toLowerCase();
  if (/bốc xếp|boc xep|loading/.test(txt)) return "Bốc xếp";
  if (/chèn lót|chen lot|ftl|packing/.test(txt)) return "Chèn lót FTL";
  if (/hub|trung chuy[eê]n|transit/.test(txt)) return "Hub";
  if (/last.?mile|lastmile|giao cuối|d2d/.test(txt)) return "Lastmile";
  return "Khác";
}

const KHAU_LIST = ["Bốc xếp", "Chèn lót FTL", "Hub", "Lastmile", "Khác"];
const KHAU_COLOR = {
  "Bốc xếp": "var(--red)",
  "Chèn lót FTL": "var(--amber)",
  "Hub": "var(--cyan)",
  "Lastmile": "#3b82f6",
  "Khác": "var(--text-muted)",
};

const panelStyle = {
  background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", marginBottom: 16,
};
const h3Style = {
  fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5,
};

export default function WeeklyReviewBoard({ ordersByProjectAndWeek, ordersByMonth, damageCases = [] }) {
  // Lấy ngày VN qua ISO string để tránh double-shift (vnNow là UTC+7 nhưng getFullYear() lại dùng local TZ)
  const vnDateStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const [vy, vm, vd] = vnDateStr.split("-").map(Number);
  const weekNum = getISOWeek(new Date(Date.UTC(vy, vm - 1, vd)));
  const LS_KEY = `ops_directives_W${weekNum}_${vy}`;

  const [directives, setDirectives] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || ""; } catch { return ""; }
  });
  const [savedMsg, setSavedMsg] = useState(false);

  const saveDirectives = () => {
    try { localStorage.setItem(LS_KEY, directives); } catch {}
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  // ── Part 1: W_prev vs W_curr ─────────────────────────────────────────────
  const weeks = useMemo(
    () => Object.keys(ordersByMonth || {}).map(Number).sort((a, b) => a - b),
    [ordersByMonth],
  );
  const wCurr = weeks[weeks.length - 1];
  const wPrev = weeks[weeks.length - 2];

  const clients = useMemo(() => {
    return Object.entries(ordersByProjectAndWeek || {})
      .map(([name, byWeek]) => ({
        name,
        prev: byWeek[wPrev] || 0,
        curr: byWeek[wCurr] || 0,
        delta: (byWeek[wCurr] || 0) - (byWeek[wPrev] || 0),
      }))
      .filter((c) => c.prev > 0 || c.curr > 0)
      .sort((a, b) => b.curr - a.curr);
  }, [ordersByProjectAndWeek, wPrev, wCurr]);

  // "Tiềm năng" = tăng > 10 đơn và > 15% so tuần trước
  const tiemNangSet = useMemo(
    () => new Set(clients.filter(c => c.delta > 10 && c.prev > 0 && c.delta / c.prev > 0.15).map(c => c.name)),
    [clients],
  );
  const topGains = [...clients].sort((a, b) => b.delta - a.delta).filter(c => c.delta > 0).slice(0, 5);
  const topDrops = [...clients].sort((a, b) => a.delta - b.delta).filter(c => c.delta < 0).slice(0, 5);

  // ── Part 2: Bể vỡ theo Khâu ─────────────────────────────────────────────
  const khauCounts = useMemo(() => {
    const map = Object.fromEntries(KHAU_LIST.map(k => [k, 0]));
    for (const c of damageCases) map[getKhau(c)] = (map[getKhau(c)] || 0) + 1;
    return map;
  }, [damageCases]);
  const totalCases = damageCases.length;

  if (!wCurr || !wPrev) {
    return (
      <div style={{ ...panelStyle, color: "var(--text-muted)", fontSize: 13 }}>
        Chưa đủ dữ liệu 2 tuần để so sánh sản lượng KH.
      </div>
    );
  }

  return (
    <div>
      {/* ── Part 1: Biến động sản lượng KH ─────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <span style={h3Style}>Biến động sản lượng KH</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Tuần {wPrev} → Tuần {wCurr}</span>
        </div>

        {(topGains.length > 0 || topDrops.length > 0) && (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14, padding: "10px 12px", background: "var(--bg-card, rgba(255,255,255,0.03))", borderRadius: 8, border: "1px solid var(--border)" }}>
            {topGains.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 700, marginBottom: 6 }}>📈 Top tăng (T{wPrev}→T{wCurr})</div>
                {topGains.map(c => (
                  <div key={c.name} style={{ fontSize: 12, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--green)", fontWeight: 700, minWidth: 30 }}>+{c.delta}</span>
                    <span style={{ color: "var(--text-primary)" }}>{c.name}</span>
                    {tiemNangSet.has(c.name) && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "rgba(16,185,129,0.15)", color: "var(--green)", border: "1px solid var(--green)", whiteSpace: "nowrap" }}>⭐ Tiềm năng</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {topDrops.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 700, marginBottom: 6 }}>📉 Top giảm (T{wPrev}→T{wCurr})</div>
                {topDrops.map(c => (
                  <div key={c.name} style={{ fontSize: 12, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--red)", fontWeight: 700, minWidth: 30 }}>{c.delta}</span>
                    <span style={{ color: "var(--text-primary)" }}>{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, fontSize: 11.5 }}>Khách hàng</th>
                <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 11.5 }}>Tuần {wPrev}</th>
                <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 11.5 }}>Tuần {wCurr}</th>
                <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 11.5 }}>Δ</th>
                <th style={{ padding: "7px 10px", fontWeight: 700, fontSize: 11.5 }}></th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => {
                const isUp = c.delta > 0;
                const isDown = c.delta < 0;
                return (
                  <tr key={c.name} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--text-secondary)" }}>{c.prev}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{c.curr}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: isUp ? "var(--green)" : isDown ? "var(--red)" : "var(--text-muted)" }}>
                      {c.delta > 0 ? `+${c.delta}` : c.delta || "—"}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {tiemNangSet.has(c.name) && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "rgba(16,185,129,0.15)", color: "var(--green)", border: "1px solid var(--green)", whiteSpace: "nowrap" }}>⭐ Tiềm năng</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {clients.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 13 }}>Chưa có dữ liệu sản lượng KH.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Part 2: Bể vỡ theo Khâu ─────────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <span style={h3Style}>Truy vết bể vỡ theo Khâu</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{totalCases} ca · kỳ đang lọc</span>
        </div>
        {totalCases === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Không có ca bể vỡ trong kỳ lọc.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {KHAU_LIST.map(khau => {
              const count = khauCounts[khau] || 0;
              if (!count) return null;
              const pct = Math.round((count / totalCases) * 100);
              const color = KHAU_COLOR[khau];
              return (
                <div key={khau}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{khau}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{count} ca ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {totalCases > 0 && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-muted)" }}>
            Phân loại dựa trên trường <em>damage_details</em> / <em>suspected_leg</em>. Cập nhật thủ công nếu phân loại chưa chính xác.
          </div>
        )}
      </div>

      {/* ── Part 3: Chỉ đạo Ops tuần ────────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <span style={h3Style}>Ghi chú & Chỉ đạo Ops — Tuần W{weekNum}</span>
          <button onClick={saveDirectives} style={{
            padding: "5px 16px", background: savedMsg ? "rgba(16,185,129,0.15)" : "rgba(6,182,212,0.12)",
            border: `1px solid ${savedMsg ? "var(--green)" : "var(--cyan)"}`,
            color: savedMsg ? "var(--green)" : "var(--cyan)",
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
          }}>
            {savedMsg ? "✓ Đã lưu" : "Lưu"}
          </button>
        </div>
        <textarea
          value={directives}
          onChange={(e) => setDirectives(e.target.value)}
          rows={6}
          placeholder={`Nhập chỉ đạo vận hành tuần W${weekNum}...\nVD:\n- Kho HAN01 tỷ lệ bể vỡ cao — theo dõi sát\n- Follow up dự án [X] về đơn treo\n- Ưu tiên KH tiềm năng đang tăng trưởng`}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: 13,
            background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
            borderRadius: 8, padding: "10px 12px", lineHeight: 1.7,
          }}
        />
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          Lưu trên trình duyệt này · Tuần W{weekNum} · {vy}
        </div>
      </div>
    </div>
  );
}
