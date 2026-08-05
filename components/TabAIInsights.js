/**
 * components/TabAIInsights.js
 * Tab AI Insights — Tầng 1: Bể vỡ theo tuyến, Tầng 2: Đề xuất tách chuyến
 */
import { useState } from "react";

// ── Helpers ──
const fmtN = n => Number(n).toLocaleString("vi-VN");

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
export function DeltaBadge({ value, unit, invert }) {
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

export function PeriodComparisonSection({ comparison, compact = false }) {
  if (!comparison) return null;
  const { currentRangeLabel, previousRangeLabel, overall, clients } = comparison;
  const warningClients = clients.filter((c) => c.warning);

  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: compact ? 0 : 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#EAF0F8", marginBottom: 2 }}>
            📈 So sánh cùng kỳ
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {currentRangeLabel} so với {previousRangeLabel} (7 ngày, lùi 2 ngày đệm để đơn kịp có kết quả)
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10 }}>Số đơn</div>
            <DeltaBadge value={overall.ordersDeltaPct} unit="%" />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10 }}>Ontime</div>
            <DeltaBadge value={overall.ontimeDeltaPoints} unit=" điểm" />
          </div>
        </div>
      </div>

      {compact ? null : clients.length === 0 ? (
        <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          Chưa đủ dữ liệu để so sánh.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {clients.map((c) => (
            <div key={c.client} style={{
              background: c.warning ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${c.warning ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
              borderRadius: 10, padding: "10px 12px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5, color: "#EAF0F8" }}>
                  {c.warning && "⚠️ "}{c.client}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "var(--text-muted)" }}>
                  Đơn: {c.prev.orders} → {c.cur.orders}
                </span>
                <DeltaBadge value={c.ordersDeltaPct} unit="%" />
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

      {!compact && warningClients.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--red)" }}>
          ⚠️ {warningClients.length} khách hàng giảm rõ rệt so với kỳ trước — ưu tiên kiểm tra trước.
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
        background: "linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(20, 224, 196,0.08) 100%)",
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
