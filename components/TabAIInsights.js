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
    warning:  { bg: "rgba(245,158,11,0.12)", border: "var(--amber)",      text: "var(--amber)",      label: "🟡 Gần ngưỡng tách" },
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
  const color = pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--green)";
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
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 3 }}>
                {r.route}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {r.damaged}/{r.total} đơn bể vỡ
                {r.vsAvg > 1.5 && (
                  <span style={{ marginLeft: 6, color: "var(--amber)", fontWeight: 600 }}>
                    (cao hơn TB {r.vsAvg}x)
                  </span>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{
                fontSize: 18, fontWeight: 700, color: r.rate > 5 ? "var(--red)" : "var(--amber)",
              }}>
                {r.rate}%
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>bể vỡ</div>
            </div>
          </div>
          <div style={{
            marginTop: 8, fontSize: 11, color: r.rate > 5 ? "var(--red)" : "var(--amber)",
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

// Used directly inside LTLDashboard.js — "Tầng 1" (per-route breakage rate)
// plus an AI narrative call, same on-demand pattern as PeriodComparisonSection's.
export function BreakageAlertSection({ routes = [], avgDmgRate = 0, totalOrders = 0, damageCauses = null, damageTrend = null, recentCases = [] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <AINarrativePanel
        insights={{
          totalOrders,
          avgDmgRate,
          breakageRoutes: routes.map((r) => ({
            route: r.route, damaged: r.damaged, total: r.total, rate: r.rate, vsAvg: r.vsAvg,
          })),
          ...(damageCauses && damageCauses.totalCases > 0 ? {
            damageRootCauses: {
              totalCases: damageCauses.totalCases,
              byLeg: damageCauses.byLeg,
              byClient: damageCauses.byClient,
            },
          } : {}),
          // So kỳ này với kỳ trước (cùng khoảng, tháng trước) — cho AI biết
          // xu hướng đang xấu đi/tốt lên, không chỉ 1 con số tĩnh.
          ...(damageTrend ? { damageTrend } : {}),
          // Khi số ca ít (≤8), rate/tuyến không đủ ý nghĩa thống kê — đưa
          // thẳng danh sách ca cụ thể để AI phân tích theo từng đơn thay vì
          // theo tỷ lệ trên mẫu quá nhỏ.
          ...(recentCases.length > 0 ? { recentCases } : {}),
        }}
      />
      {damageCauses && damageCauses.totalCases > 0 && (
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 14px",
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--text-primary)", marginBottom: 10 }}>
            🔍 Nguyên nhân bể vỡ theo chặng (Rillnet, {damageCauses.totalCases} ca)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {damageCauses.byLeg.map((l) => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 200, fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>{l.label}</div>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${l.pct}%`, height: "100%", background: "var(--red)", borderRadius: 4 }} />
                </div>
                <div style={{ width: 70, fontSize: 12, fontWeight: 600, color: "var(--text-primary)", textAlign: "right" }}>{l.count} ({l.pct}%)</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <BreakageSection routes={routes} avgDmgRate={avgDmgRate} />
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
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
              {r.route}
            </div>
            <LevelBadge level={r.level} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            {fmtN(r.pendingWeight)} kg chưa xuất • {r.pendingOrders} đơn
            {r.nearestDeadline && (
              <span style={{ marginLeft: 6, color: "var(--amber)" }}>
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
  // The underlying breakdown (transform-ltl.js) no longer caps this itself
  // — that cap used to apply BEFORE the AI narrative/damageByProject ever
  // saw the data, silently dropping high-damage clients whose ontime% was
  // stable (Aqua B2C, LG LTL). Cap only here, for the card grid's own
  // display — narrative-derived lists elsewhere read the full `items`.
  const sortedItems = [...items].sort((a, b) => {
    if (a.warning !== b.warning) return a.warning ? -1 : 1;
    return (a.ontimeDeltaPoints ?? 0) - (b.ontimeDeltaPoints ?? 0);
  }).slice(0, 30);

  return (
    <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 2 }}>
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
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "8px 16px", minWidth: 110, textAlign: "center",
          }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, marginBottom: 3 }}>Hư hỏng</div>
            <DeltaBadge value={overall.damageDeltaPct} unit="%" invert isNew={overall.damageIsNew} />
          </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
          <AINarrativePanel
            insights={{
              currentRangeLabel,
              previousRangeLabel,
              overall,
              breakdownBy: groupLabel,
              decliningClients: compact ? [] : declineAlerts.map((a) => ({
                client: a.client,
                totalDeclinePct: a.totalDeclinePct,
                weeksDeclining: a.weeksDeclining,
              })),
              warningItems: warningItems.map((c) => ({
                name: c.name,
                ordersDeltaPct: c.ordersDeltaPct,
                weightDeltaPct: c.weightDeltaPct,
                ontimeDeltaPoints: c.ontimeDeltaPoints,
              })),
              // Kỳ trước không có đơn (hoặc rất ít), kỳ này có đơn trở lại —
              // không phân biệt được "khách hoàn toàn mới" hay "khách cũ vắng
              // 1 kỳ rồi quay lại" chỉ từ 2 kỳ liền kề, nên mô tả trung tính.
              newOrReturningClients: items
                .filter((c) => c.ordersIsNew && c.cur?.orders > 0)
                .map((c) => ({ name: c.name, orders: c.cur.orders })),
              // Established clients (not "new", not on the warning list)
              // growing hard — these get buried today because the prompt
              // only had room for problems. Threshold at +30% so this
              // doesn't just repeat routine month-start noise.
              growingClients: items
                .filter((c) => !c.ordersIsNew && !c.warning && (c.ordersDeltaPct ?? 0) >= 30)
                .sort((a, b) => (b.ordersDeltaPct ?? 0) - (a.ordersDeltaPct ?? 0))
                .slice(0, 5)
                .map((c) => ({ name: c.name, ordersDeltaPct: c.ordersDeltaPct, ontimeDeltaPoints: c.ontimeDeltaPoints })),
              // Had real breakage last period, zero this period — an actual
              // operational win worth naming, not just "no bullet to write".
              damageResolvedClients: items
                .filter((c) => (c.prev?.damageCount ?? 0) > 0 && (c.cur?.damageCount ?? 0) === 0)
                .map((c) => ({ name: c.name, prevDamageCount: c.prev.damageCount })),
              // Per-client damage counts already existed on `items` (shown
              // in the client cards below) but were never passed into the
              // narrative — so "which project is breakage concentrated in"
              // never made it into the AI write-up even though the data was
              // right there. Ranked by current-period case count.
              damageByProject: items
                .filter((c) => (c.cur?.damageCount ?? 0) > 0)
                .sort((a, b) => (b.cur.damageCount ?? 0) - (a.cur.damageCount ?? 0))
                .slice(0, 8)
                .map((c) => ({ name: c.name, damageCount: c.cur.damageCount, prevDamageCount: c.prev?.damageCount ?? 0, damageDeltaPct: c.damageDeltaPct })),
            }}
          />
        </div>




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
                <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-primary)" }}>
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
              {(c.cur.damageCount > 0 || c.prev.damageCount > 0) && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3 }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    Hư hỏng: {c.prev.damageCount} ca → {c.cur.damageCount} ca
                  </span>
                  <DeltaBadge value={c.damageDeltaPct} unit="%" invert isNew={c.damageIsNew} />
                </div>
              )}
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

// Bullets always start with "- " + a leading emoji signaling severity (see
// SYSTEM_PROMPT in lib/ai-narrative.js) — rendered as flat pre-line text
// before, so every bullet ran together with no visual separation and no
// hint of which lines were warnings vs good news. Split into individual
// rows with a left accent colored by the leading emoji instead.
const NARRATIVE_EMOJI_COLOR = [
  ["🔴", "var(--red)"],
  ["⚠️", "var(--amber)"],
  ["📉", "var(--red)"],
  ["🆕", "var(--blue)"],
  ["📈", "var(--green)"],
  ["🎉", "var(--green)"],
  ["✅", "var(--green)"],
];
function narrativeLineColor(line) {
  const hit = NARRATIVE_EMOJI_COLOR.find(([emoji]) => line.startsWith(emoji));
  return hit ? hit[1] : "var(--border)";
}

function NarrativeText({ text }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bulletLines = lines.filter((l) => l.startsWith("- "));
  // Fallback text (all providers down) is sometimes a single paragraph,
  // not bulleted — show it plain rather than as 1 oddly-bordered row.
  if (bulletLines.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, whiteSpace: "pre-line" }}>
        {text}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.map((line, i) => {
        const content = line.replace(/^-\s*/, "");
        return (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "8px 10px", borderRadius: 8,
            background: "rgba(255,255,255,0.03)",
            borderLeft: `3px solid ${narrativeLineColor(content)}`,
            fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5,
          }}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ── AI narrative (real Claude call, on-demand) ──
export function AINarrativePanel({ insights }) {
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insights }),
      });
      const json = await res.json();
      if (json.ok) {
        setNarrative(json.narrative);
      } else {
        const rawErr = typeof json.error === "string" ? json.error : JSON.stringify(json.error);
        if (rawErr.includes("429") || rawErr.includes("quota") || rawErr.includes("Quota")) {
          setError("⚠️ Hệ thống Gemini AI đang quá tải giới hạn lượt gọi (Rate Limit). Vui lòng thử lại sau ít phút.");
        } else {
          setError("⚠️ Chưa thể tạo nhận định AI lúc này. Vui lòng thử lại.");
        }
      }
    } catch (e) {
      setError("Lỗi kết nối, vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.25)",
      borderRadius: 14, padding: "16px 20px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: narrative || error ? 10 : 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text-primary)" }}>
          🤖 Nhận định AI
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            background: "rgba(139,92,246,0.15)", color: "var(--purple)", border: "1px solid rgba(139,92,246,0.35)",
            padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: loading ? "default" : "pointer", whiteSpace: "nowrap",
          }}
        >
          {loading ? "Đang phân tích..." : narrative ? "↺ Phân tích lại" : "✨ Tạo nhận định"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--red)" }}>{error}</div>}
      {narrative && <NarrativeText text={narrative} />}
    </div>
  );
}

// ── Khách hàng mới/trở lại — pulled up to its own headline card instead of
// staying buried inside the "So sánh cùng kỳ" client grid further down,
// which is exactly why it kept getting missed (user had to spot the small
// 🆕 badge among a dozen other client cards, twice, before it registered).
export function NewClientsBanner({ clients = [] }) {
  const newClients = clients
    .filter((c) => c.ordersIsNew && c.cur?.orders > 0)
    .sort((a, b) => b.cur.orders - a.cur.orders);

  if (newClients.length === 0) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
        borderRadius: 14, padding: "12px 18px",
        display: "flex", alignItems: "center", gap: 10,
        fontSize: 13, color: "var(--text-muted)",
      }}>
        <span style={{ fontSize: 16 }}>🆕</span>
        Không có khách hàng mới/có đơn trở lại trong kỳ so sánh hiện tại.
      </div>
    );
  }

  return (
    <div style={{
      background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.3)",
      borderRadius: 14, padding: "14px 18px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>🆕</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>
          {newClients.length} khách hàng mới/có đơn trở lại trong kỳ
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {newClients.map((c) => (
          <div key={c.name} style={{
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(59,130,246,0.25)",
            borderRadius: 20, padding: "5px 12px",
            fontSize: 12.5, color: "var(--text-primary)", fontWeight: 600,
          }}>
            {c.name} <span style={{ color: "var(--blue)", fontWeight: 700 }}>· {c.cur.orders} đơn</span>
          </div>
        ))}
      </div>
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
            <span style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>AI Insights</span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
              background: "rgba(139,92,246,0.2)", color: "var(--purple)", border: "1px solid rgba(139,92,246,0.3)",
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

      <NewClientsBanner clients={periodComparison?.clients || []} />

      <AINarrativePanel insights={{ breakageRoutes, capacityRoutes, avgDmgRate, totalOrders, periodComparison }} />

      {/* 2-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Tầng 1 */}
        <div style={{
          background: "var(--panel-glow)", border: "1px solid var(--border)",
          borderRadius: 14, padding: 16,
        }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 2 }}>
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
          background: "var(--panel-glow)", border: "1px solid var(--border)",
          borderRadius: 14, padding: 16,
        }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 2 }}>
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
