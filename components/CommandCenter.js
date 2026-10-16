/**
 * components/CommandCenter.js — Phase 4: Operations Command Center master screen.
 *
 * Answers 5 operational questions at a glance:
 *   1. Vận hành đang khỏe không?   (health badge + counts)
 *   2. Có gì thay đổi?              (anomaly delta list)
 *   3. Điều gì cần chú ý ngay?     (CRITICAL/HIGH cards)
 *   4. Tại sao?                    (detection rule + recommended action)
 *   5. Làm gì tiếp theo?           (quick-action buttons per anomaly)
 *
 * Props: role, onGoTab(id), dashData (optional, for future enhancements)
 */
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

const AITrialPrefill = dynamic(() => import("./AITrialPrefill"), { ssr: false });

function healthLevel(anomalies) {
  if (!anomalies || anomalies.length === 0) return "green";
  if (anomalies.some((a) => a.severity === "CRITICAL")) return "red";
  if (anomalies.some((a) => a.severity === "HIGH")) return "yellow";
  return "green";
}

const HEALTH_CFG = {
  green:  { color: "#22c55e", bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.25)",  label: "Ổn định",    icon: "✅" },
  yellow: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.25)", label: "Cần chú ý", icon: "⚠️" },
  red:    { color: "#ef4444", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.25)",  label: "Nghiêm trọng", icon: "🚨" },
};

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEV_COLOR = { CRITICAL: "#ef4444", HIGH: "#f59e0b", MEDIUM: "#f9a825", LOW: "#22c55e" };

function fmtVal(metric, val) {
  if (val === null || val === undefined) return "N/A";
  if (metric?.includes("ontime") || metric?.includes("rate")) return `${val}%`;
  if (metric?.includes("comp") || metric?.includes("per_order")) return `${Number(val).toLocaleString("vi-VN")} ₫`;
  if (metric?.includes("damage")) return `${val}‰`;
  return String(val);
}

function GroupLabel({ icon, text }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase",
      letterSpacing: "0.08em", padding: "14px 0 6px", opacity: 0.6,
    }}>{icon} {text}</div>
  );
}

function AnomalyIssueCard({ anomaly, onCreateTrial, onGoTab }) {
  const scolor = SEV_COLOR[anomaly.severity] || "var(--text-secondary)";
  const sbg = anomaly.severity === "CRITICAL" ? "rgba(239,68,68,0.06)"
    : anomaly.severity === "HIGH" ? "rgba(245,158,11,0.06)" : "var(--bg)";
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8, background: sbg,
      border: `1px solid ${scolor}40`, display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: scolor, marginRight: 6 }}>
            {anomaly.severity}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{anomaly.entity_id}</span>
        </div>
        <div style={{ fontSize: 11, color: scolor, fontWeight: 700, whiteSpace: "nowrap" }}>
          {fmtVal(anomaly.metric, anomaly.current_value)}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{anomaly.title}</div>
      {anomaly.recommendedAction && (
        <div style={{
          fontSize: 11, color: "var(--text-muted)", padding: "4px 8px",
          background: "var(--bg)", borderRadius: 5, borderLeft: `2px solid ${scolor}60`,
        }}>💡 {anomaly.recommendedAction}</div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <button onClick={() => onCreateTrial(anomaly)} style={{
          padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
          background: "rgba(99,102,241,0.1)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.3)",
          fontFamily: "inherit",
        }}>📋 Tạo TN</button>
        <button onClick={() => onGoTab("decision")} style={{
          padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
          background: "transparent", color: "var(--cyan)", border: "1px solid rgba(var(--brand-rgb),0.3)",
          fontFamily: "inherit",
        }}>🔍 Quyết định</button>
      </div>
    </div>
  );
}

export default function CommandCenter({ role, onGoTab }) {
  const [anomalies, setAnomalies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trialAnomaly, setTrialAnomaly] = useState(null);

  const loadAnomalies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/anomalies?limit=20");
      if (!res.ok) { setAnomalies([]); return; }
      const json = await res.json();
      setAnomalies(json.anomalies || []);
    } catch { setAnomalies([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (role !== "manager" && role !== "sd3") return;
    loadAnomalies();
    const iv = setInterval(loadAnomalies, 30 * 60_000);
    return () => clearInterval(iv);
  }, [role, loadAnomalies]);

  if (role !== "manager" && role !== "sd3") return null;

  const sorted = anomalies ? [...anomalies].sort((a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4)) : [];
  const critical = sorted.filter((a) => a.severity === "CRITICAL");
  const high     = sorted.filter((a) => a.severity === "HIGH");
  const watchlist = sorted.filter((a) => a.severity === "MEDIUM" || a.severity === "LOW");
  const urgent = [...critical, ...high];
  const level  = healthLevel(anomalies);
  const health = HEALTH_CFG[level];

  return (
    <>
      {trialAnomaly && (
        <AITrialPrefill
          anomaly={trialAnomaly}
          onClose={() => setTrialAnomaly(null)}
          onGoTrials={() => { setTrialAnomaly(null); onGoTab("trials"); }}
        />
      )}

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>
        {/* ── Header row ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>🎛️ Trung Tâm Điều Hành</h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Tổng quan vận hành SD3 — Điện Máy
            </div>
          </div>
          {!loading && anomalies && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 18px",
              borderRadius: 20, background: health.bg, border: `1px solid ${health.border}`,
              color: health.color, fontWeight: 700, fontSize: 13,
            }}>
              {health.icon} {health.label}
            </div>
          )}
        </div>

        {/* ── Loading skeleton ── */}
        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            {[200, 180, 180, 160, 220].map((h, i) => (
              <div key={i} className="skeleton" style={{ height: h, borderRadius: 10 }} />
            ))}
          </div>
        )}

        {/* ── 5-question grid ── */}
        {!loading && anomalies && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>

            {/* Q1 — Sức khỏe vận hành */}
            <div className="chart-panel" style={{ padding: "16px 20px" }}>
              <GroupLabel icon="1️⃣" text="Vận hành đang khỏe không?" />
              <div style={{ display: "flex", gap: 0 }}>
                {[
                  { count: critical.length, label: "NGHIÊM TRỌNG", color: critical.length > 0 ? "#ef4444" : "var(--text-muted)" },
                  { count: high.length,     label: "CAO",           color: high.length     > 0 ? "#f59e0b" : "var(--text-muted)" },
                  { count: watchlist.length, label: "THEO DÕI",     color: watchlist.length > 0 ? "#f9a825" : "var(--text-muted)" },
                ].map(({ count, label, color }, i) => (
                  <div key={i} style={{
                    flex: 1, textAlign: "center", padding: "10px 0",
                    borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                  }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color }}>{count}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2, letterSpacing: "0.04em" }}>{label}</div>
                  </div>
                ))}
              </div>
              {anomalies.length === 0 && (
                <div style={{ textAlign: "center", color: "#22c55e", fontSize: 13, fontWeight: 600, paddingTop: 8 }}>
                  ✅ Không có bất thường
                </div>
              )}
            </div>

            {/* Q2 — Có gì thay đổi? */}
            <div className="chart-panel" style={{ padding: "16px 20px" }}>
              <GroupLabel icon="2️⃣" text="Có gì thay đổi?" />
              {sorted.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Không có thay đổi đáng kể</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {sorted.slice(0, 5).map((a) => {
                    const isDown = a.delta < 0;
                    const sc = SEV_COLOR[a.severity] || "var(--text-secondary)";
                    return (
                      <div key={a.anomaly_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <span style={{ color: sc, fontWeight: 700, width: 10, textAlign: "center" }}>{isDown ? "▼" : "▲"}</span>
                        <span style={{ flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.entity_id}</span>
                        <span style={{ color: sc, fontWeight: 700, whiteSpace: "nowrap" }}>
                          {fmtVal(a.metric, a.current_value)}
                        </span>
                      </div>
                    );
                  })}
                  {sorted.length > 5 && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>+{sorted.length - 5} thay đổi khác</div>
                  )}
                </div>
              )}
            </div>

            {/* Q3 — Cần chú ý ngay? */}
            <div className="chart-panel" style={{ padding: "16px 20px" }}>
              <GroupLabel icon="3️⃣" text="Cần chú ý ngay?" />
              {urgent.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Không có vấn đề khẩn cấp</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {urgent.slice(0, 3).map((a) => {
                    const sc = SEV_COLOR[a.severity];
                    return (
                      <div key={a.anomaly_id} style={{ padding: "7px 10px", borderRadius: 7, background: `${sc}0d`, border: `1px solid ${sc}40`, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: sc, marginBottom: 2 }}>{a.entity_id}</div>
                        <div style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}>{a.title}</div>
                      </div>
                    );
                  })}
                  {urgent.length > 3 && (
                    <button onClick={() => onGoTab("decision")} style={{ fontSize: 11, color: "var(--cyan)", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, fontFamily: "inherit" }}>
                      Xem thêm {urgent.length - 3} vấn đề →
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Q4 — Tại sao? */}
            <div className="chart-panel" style={{ padding: "16px 20px" }}>
              <GroupLabel icon="4️⃣" text="Tại sao?" />
              {urgent.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Không có nguyên nhân cần phân tích</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {urgent.slice(0, 2).map((a) => (
                    <div key={a.anomaly_id} style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>{a.entity_id}</div>
                      <div style={{ color: "var(--text-muted)", marginBottom: 4, fontSize: 11 }}>Quy tắc: {a.detection_rule}</div>
                      {a.recommendedAction && (
                        <div style={{ color: "var(--text-secondary)", padding: "4px 8px", background: "var(--bg)", borderRadius: 5, borderLeft: "2px solid rgba(var(--brand-rgb),0.4)", lineHeight: 1.4 }}>
                          {a.recommendedAction}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Q5 — Làm gì tiếp theo? */}
            <div className="chart-panel" style={{ padding: "16px 20px", gridColumn: urgent.length > 0 ? "span 2" : undefined }}>
              <GroupLabel icon="5️⃣" text="Làm gì tiếp theo?" />
              {urgent.length === 0 && watchlist.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Không có hành động khẩn cấp — tiếp tục theo dõi định kỳ.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {urgent.slice(0, 3).map((a) => (
                    <AnomalyIssueCard
                      key={a.anomaly_id}
                      anomaly={a}
                      onCreateTrial={setTrialAnomaly}
                      onGoTab={onGoTab}
                    />
                  ))}
                  {urgent.length === 0 && watchlist.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Có {watchlist.length} mục đang theo dõi —&nbsp;
                      <button onClick={() => onGoTab("decision")} style={{ fontSize: 12, color: "var(--cyan)", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>xem chi tiết →</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Quick navigation ── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            Điều hướng nhanh
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { id: "decision",   label: "⚡ Quyết định hôm nay",  desc: "CRITICAL + HIGH alerts" },
              { id: "ltl",        label: "📦 Tổng quan LTL",        desc: "KPI & on-time rate" },
              { id: "damage",     label: "⚠️ Hư hỏng & Rủi ro",    desc: "Damage analysis" },
              { id: "trials",     label: "🧪 Sổ tay cải tiến",      desc: "Thử nghiệm đang chạy" },
              { id: "sop",        label: "📚 Sổ tay SOP",           desc: "Quy trình vận hành" },
              { id: "report",     label: "📊 Báo cáo công ty",       desc: "Báo cáo tổng hợp" },
            ].map(({ id, label, desc }) => (
              <button
                key={id}
                onClick={() => onGoTab(id)}
                style={{
                  padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: "var(--bg-panel)", border: "1px solid var(--border)",
                  color: "var(--text-primary)", fontFamily: "inherit", textAlign: "left",
                  transition: "all 0.15s",
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = "rgba(var(--brand-rgb),0.08)"; e.currentTarget.style.borderColor = "rgba(var(--brand-rgb),0.3)"; }}
                onMouseOut={(e)  => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <div>{label}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, fontWeight: 400 }}>{desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
