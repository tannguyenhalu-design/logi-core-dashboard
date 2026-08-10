/**
 * components/TabAIInsights.js
 * Tab AI Insights — Tầng 1: Bể vỡ theo tuyến, Tầng 2: Đề xuất tách chuyến
 */
import { useState, Fragment } from "react";

// ── Helpers ──
const fmtN = n => Number(n).toLocaleString("vi-VN");
const fmtKg = (kg) => {
  const n = Number(kg) || 0;
  return n >= 1000 ? `${(n / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tấn` : `${n.toLocaleString("vi-VN")} kg`;
};

function LevelBadge({ level }) {
  const cfg = {
    critical: { bg: "rgba(239,68,68,0.15)",  border: "var(--red)",   text: "var(--red)",   label: "🔴 Nên tách ngay" },
    warning:  { bg: "rgba(245,158,11,0.12)", border: "#f59e0b",      text: "#f59e0b",      label: "🟡 Gần ngưỡng tách" },
    ok:       { bg: "rgba(34,197,94,0.10)",  border: "var(--green)",  text: "var(--green)", label: "🟢 Ổn" },
  };
  const c = cfg[level] || cfg.ok;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    }}>
      {c.label}
    </span>
  );
}

function CapacityBar({ pct }) {
  const color = pct >= 90 ? "var(--red)" : pct >= 70 ? "#f59e0b" : "var(--green)";
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--text-muted)", marginBottom:3 }}>
        <span>{pct}% xe 5T</span>
        <span style={{ color }}>{pct >= 90 ? "⚠️ Vượt ngưỡng" : pct >= 70 ? "Sắp đầy" : "Bình thường"}</span>
      </div>
      <div style={{ height:6, background:"rgba(255,255,255,0.08)", borderRadius:3, overflow:"hidden" }}>
        <div style={{
          height:"100%", width: `${Math.min(pct, 100)}%`,
          background: color, borderRadius:3, transition:"width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

// ── Tầng 1: Breakage ──
function BreakageSection({ routes, avgDmgRate }) {
  if (!routes || routes.length === 0) {
    return (
      <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        ✅ Không phát hiện tuyến nào có tỷ lệ bể vỡ bất thường
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
        Trung bình hệ thống: <strong style={{ color: "var(--text-secondary)" }}>{avgDmgRate}%</strong>
      </div>
      {routes.map((r, i) => (
        <div key={i} style={{
          background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 10, padding: "12px 14px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#EAF0F8", marginBottom: 3 }}>
                {r.route}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {r.damaged}/{r.total} đơn bể vỡ
                {r.vsAvg > 1.5 && (
                  <span style={{ marginLeft: 6, color: "#f59e0b", fontWeight: 600 }}>
                    (cao hơn TB {r.vsAvg}x)
                  </span>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{
                fontSize: 18, fontWeight: 700, color: r.rate > 5 ? "var(--red)" : "#f59e0b",
              }}>
                {r.rate}%
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>bể vỡ</div>
            </div>
          </div>
          <div style={{
            marginTop: 8, fontSize: 11, color: r.rate > 5 ? "var(--red)" : "#f59e0b",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span>→</span>
            <span>{r.suggestion}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tầng 2: Capacity ──
function CapacitySection({ routes }) {
  if (!routes || routes.length === 0) {
    return (
      <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        ✅ Không có hàng chưa xuất đáng chú ý
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {routes.map((r, i) => (
        <div key={i} style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 14px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#EAF0F8" }}>
              {r.route}
            </div>
            <LevelBadge level={r.level} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            {fmtN(r.pendingWeight)} kg chưa xuất • {r.pendingOrders} đơn
            {r.nearestDeadline && (
              <span style={{ marginLeft: 6, color: "#f59e0b" }}>
                • deadline gần nhất: {r.nearestDeadline}
              </span>
            )}
          </div>
          <CapacityBar pct={r.capacityPct} />
          {r.suggestedTrips > 1 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--blue)" }}>
              → Đề xuất tách {r.suggestedTrips} chuyến
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tầng 3: So sánh cùng kỳ ── (also used inline in TabLTL.js, near the ontime trend chart)
export function DeltaBadge({ value, unit, invert, isNew }) {
  // prev = 0, cur > 0 — "mới phát sinh", không phải "chưa đủ dữ liệu so
  // sánh". % tăng lúc này là vô cực (chia 0), nên hiện nhãn riêng thay vì
  // gộp chung với trường hợp thật sự không có gì để so.
  if (isNew) return <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green)" }}>🆕 Mới</span>;
  if (value == null) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>;
  const good = invert ? value <= 0 : value >= 0;
  const color = value === 0 ? "var(--text-muted)" : good ? "var(--green)" : "var(--red)";
  const arrow = value === 0 ? "→" : value > 0 ? "▲" : "▼";
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color }}>
      {arrow} {value > 0 ? "+" : ""}{value}{unit}
    </span>
  );
}

export function PeriodComparisonSection({ comparison, declineAlerts = [], compact = false, periodWeeks = "mtd", onPeriodWeeksChange }) {
  if (!comparison) return null;
  const { currentRangeLabel, previousRangeLabel, overall, clients, warehouses } = comparison;
  // Filtered to 1 project, the client breakdown is just that 1 project again
  // (no new info) — the warehouse breakdown is what actually explains *why*
  // that project's numbers moved, so swap to it instead of going empty.
  const items = compact ? (warehouses || []) : (clients || []);
  const groupLabel = compact ? "kho giao hàng" : "khách hàng";
  const warningItems = items.filter((c) => c.warning);
  const isMtd = periodWeeks === "mtd";
  // Cards needing attention (⚠️) grouped together first instead of scattered
  // among the healthy ones — the backend order (worst ontime delta first)
  // still applies within each group, just warning status now wins first.
  const sortedItems = [...items].sort((a, b) => {
    if (a.warning !== b.warning) return a.warning ? -1 : 1;
    return (a.ontimeDeltaPoints ?? 0) - (b.ontimeDeltaPoints ?? 0);
  });

  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#EAF0F8", marginBottom: 2 }}>
            📈 So sánh cùng kỳ
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {currentRangeLabel} so với {previousRangeLabel} (
            {isMtd
              ? "đầu tháng → đúng hôm nay, đơn chưa giao thì chưa tính vào % ontime"
              : "chỉ so 2 khối tuần đã khép, lùi 2 ngày đệm để đơn kịp có kết quả"})
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {onPeriodWeeksChange && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Kỳ:</span>
              <select
                value={periodWeeks}
                onChange={(e) => {
                  const v = e.target.value;
                  onPeriodWeeksChange(v === "mtd" ? "mtd" : Number(v));
                }}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "5px 8px", borderRadius: 6,
                  background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                <option value="mtd">Mặc định (đầu tháng)</option>
                <option value={1}>1 tuần</option>
                <option value={2}>2 tuần</option>
                <option value={3}>3 tuần</option>
              </select>
            </div>
          )}
          <div style={{ display: "flex", gap: 24 }}>
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "8px 16px", minWidth: 110, textAlign: "center",
          }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, marginBottom: 3 }}>Số đơn</div>
            <DeltaBadge value={overall.ordersDeltaPct} unit="%" isNew={overall.ordersIsNew} />
          </div>
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "8px 16px", minWidth: 110, textAlign: "center",
          }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, marginBottom: 3 }}>Trọng lượng</div>
            <DeltaBadge value={overall.weightDeltaPct} unit="%" isNew={overall.weightIsNew} />
          </div>
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "8px 16px", minWidth: 110, textAlign: "center",
          }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, marginBottom: 3 }}>Ontime</div>
            <DeltaBadge value={overall.ontimeDeltaPoints} unit=" điểm" />
          </div>
          </div>
        </div>
      </div>

      {!compact && declineAlerts.length > 0 && (
        <div style={{
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 10, padding: "12px 14px", marginBottom: 14,
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--red)", marginBottom: 8 }}>
            🚨 {declineAlerts.length} khách hàng giảm số đơn liên tục {declineAlerts[0].weeksDeclining} tuần gần nhất — ưu tiên kiểm tra vận hành
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {declineAlerts.map((a) => (
              <div key={a.client} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ color: "#EAF0F8", fontWeight: 600, fontSize: 12.5 }}>{a.client}</span>
                  <span style={{ color: "var(--red)", fontWeight: 700, fontSize: 12.5 }}>{a.totalDeclinePct}% qua {a.weeklyBreakdown.length} tuần</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {a.weeklyBreakdown.map((w, i) => (
                    <Fragment key={w.label}>
                      {i > 0 && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>}
                      <div style={{ textAlign: "center", flex: 1, background: "rgba(0,0,0,0.15)", borderRadius: 6, padding: "4px 6px" }}>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{w.label}</div>
                        <div style={{
                          fontSize: 13, fontWeight: 700,
                          color: i === a.weeklyBreakdown.length - 1 ? "var(--red)" : "#EAF0F8",
                        }}>
                          {w.count} đơn
                        </div>
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sortedItems.length === 0 ? (
        <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          Chưa đủ dữ liệu để so sánh.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {sortedItems.map((c) => (
            <div key={c.name} style={{
              background: c.warning ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${c.warning ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
              borderRadius: 10, padding: "10px 12px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5, color: "#EAF0F8" }}>
                  {c.warning && "⚠️ "}{c.name}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "var(--text-muted)" }}>
                  Đơn: {c.prev.orders} → {c.cur.orders}
                </span>
                <DeltaBadge value={c.ordersDeltaPct} unit="%" isNew={c.ordersIsNew} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3 }}>
                <span style={{ color: "var(--text-muted)" }}>
                  KL: {fmtKg(c.prev.weight)} → {fmtKg(c.cur.weight)}
                </span>
                <DeltaBadge value={c.weightDeltaPct} unit="%" isNew={c.weightIsNew} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3 }}>
                <span style={{ color: "var(--text-muted)" }}>
                  Ontime: {c.prev.ontimePct ?? "—"}% → {c.cur.ontimePct ?? "—"}%
                </span>
                <DeltaBadge value={c.ontimeDeltaPoints} unit=" điểm" />
              </div>
            </div>
          ))}
        </div>
      )}

      {warningItems.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--red)" }}>
          ⚠️ {warningItems.length} {groupLabel} giảm rõ rệt so với kỳ trước — ưu tiên kiểm tra trước.
        </div>
      )}
    </div>
  );
}

// ── Main component ──
export default function TabAIInsights({ data }) {
  const [refreshed] = useState(new Date().toLocaleTimeString("vi-VN"));

  const insights = data?.aiInsights;
  if (!insights) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        Đang tải AI Insights...
      </div>
    );
  }

  const { breakageRoutes, capacityRoutes, avgDmgRate, totalOrders, periodComparison } = insights;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(var(--brand-rgb),0.08) 100%)",
        border: "1px solid rgba(139,92,246,0.25)",
        borderRadius: 14, padding: "16px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>💡</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: "#EAF0F8" }}>AI Insights</span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
              background: "rgba(139,92,246,0.2)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)",
            }}>BETA</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Phân tích từ <strong style={{ color: "var(--text-secondary)" }}>{fmtN(totalOrders)}</strong> đơn hàng trong hệ thống
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>
          Cập nhật lúc<br />
          <span style={{ color: "var(--text-secondary)" }}>{refreshed}</span>
        </div>
      </div>

      {/* 2-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Tầng 1 */}
        <div style={{
          background: "var(--card-bg)", border: "1px solid var(--border)",
          borderRadius: 14, padding: 16,
        }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#EAF0F8", marginBottom: 2 }}>
              🔴 Tầng 1 — Cảnh báo bể vỡ
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Tuyến có tỷ lệ hư hỏng cao hơn trung bình
            </div>
          </div>
          <BreakageSection routes={breakageRoutes} avgDmgRate={avgDmgRate} />
        </div>

        {/* Tầng 2 */}
        <div style={{
          background: "var(--card-bg)", border: "1px solid var(--border)",
          borderRadius: 14, padding: 16,
        }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#EAF0F8", marginBottom: 2 }}>
              📦 Tầng 2 — Đề xuất tách chuyến
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Hàng chưa xuất — so với sức chứa xe 5T (5,000kg)
            </div>
          </div>
          <CapacitySection routes={capacityRoutes} />
        </div>
      </div>

      {/* Tầng 3 */}
      <PeriodComparisonSection comparison={periodComparison} />
    </div>
  );
}
