/**
 * components/AlertSurface.js — Proactive anomaly alert panel.
 *
 * Fetches /api/anomalies and shows CRITICAL/HIGH alerts prominently;
 * MEDIUM/LOW grouped under a collapsible "Watchlist" section.
 *
 * Buttons per card:
 *   🔍 Evidence  — inline evidence panel
 *   🤖 Hỏi AI   — sends anomaly context to AI chat drawer
 *   📋 Tạo Trial — opens Trials tab with pre-filled entity
 *
 * Buttons per card (Phase 3 addition):
 *   🔬 Phân Tích Nguyên Nhân — opens RootCauseDrawer
 *
 * Only rendered for manager and sd3 roles (no fetch for cs/client).
 */
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
const RootCauseDrawer = dynamic(() => import("./RootCauseDrawer"), { ssr: false });

const SEV_CONFIG = {
  CRITICAL: { color: "#D93025", bg: "rgba(217,48,37,0.08)", border: "rgba(217,48,37,0.25)", label: "NGHIÊM TRỌNG", icon: "🚨" },
  HIGH:     { color: "#F57C00", bg: "rgba(245,124,0,0.08)",  border: "rgba(245,124,0,0.25)",  label: "CAO",          icon: "⚠️" },
  MEDIUM:   { color: "#F9A825", bg: "rgba(249,168,37,0.06)", border: "rgba(249,168,37,0.2)",  label: "TRUNG BÌNH",  icon: "🟡" },
  LOW:      { color: "#388E3C", bg: "rgba(56,142,60,0.06)",  border: "rgba(56,142,60,0.2)",   label: "THẤP",         icon: "🟢" },
};

function formatVal(metric, val) {
  if (val === null || val === undefined) return "N/A";
  if (metric?.includes("ontime") || metric?.includes("rate")) return `${val}%`;
  if (metric?.includes("comp") || metric?.includes("per_order")) return `${Number(val).toLocaleString("vi-VN")} ₫`;
  if (metric?.includes("damage")) return `${val}‰`;
  return String(val);
}

function EvidencePanel({ anomaly, onClose }) {
  const ev = anomaly.evidence || {};
  return (
    <div style={{
      marginTop: 8, padding: "12px 14px", borderRadius: 8,
      background: "var(--bg)", border: "1px solid var(--border)",
      fontSize: 12, color: "var(--text-secondary)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ color: "var(--text-primary)" }}>Bằng chứng phát hiện</strong>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div><span style={{ color: "var(--text-muted)" }}>Quy tắc: </span>{anomaly.detection_rule}</div>
        <div><span style={{ color: "var(--text-muted)" }}>Độ tin cậy: </span>{Math.round((anomaly.confidence || 0) * 100)}%</div>
        <div><span style={{ color: "var(--text-muted)" }}>Giá trị hiện tại: </span><strong>{formatVal(anomaly.metric, anomaly.current_value)}</strong></div>
        <div><span style={{ color: "var(--text-muted)" }}>Cơ sở: </span>{formatVal(anomaly.metric, anomaly.baseline_value)}</div>
        <div><span style={{ color: "var(--text-muted)" }}>Thay đổi: </span>{anomaly.delta > 0 ? "+" : ""}{anomaly.delta}</div>
        <div><span style={{ color: "var(--text-muted)" }}>Mẫu: </span>{anomaly.evidence?.sample_size || anomaly.sampleOrders || "N/A"} đơn</div>
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
        <span style={{ color: "var(--text-muted)" }}>Cửa sổ: </span>{ev.window_label || anomaly.periodLabel || "N/A"}
      </div>
      {anomaly.recommendedAction && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "rgba(var(--brand-rgb),0.05)", color: "var(--text-primary)" }}>
          💡 {anomaly.recommendedAction}
        </div>
      )}
    </div>
  );
}

function AnomalyCard({ anomaly, onAskAI, onCreateTrial, onRootCause }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const cfg = SEV_CONFIG[anomaly.severity] || SEV_CONFIG.LOW;

  return (
    <div style={{
      padding: "14px 16px",
      borderRadius: 10,
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
              background: cfg.color, color: "#fff", letterSpacing: 0.5,
            }}>{cfg.icon} {cfg.label}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>{anomaly.entity_type}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: cfg.color, lineHeight: 1.4 }}>{anomaly.title}</div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 2 }}>
          Độ tin cậy: {Math.round((anomaly.confidence || 0) * 100)}%
        </div>
      </div>

      {/* Metric row */}
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Hiện tại: <strong style={{ color: cfg.color }}>{formatVal(anomaly.metric, anomaly.current_value)}</strong>
        {anomaly.baseline_value !== null && anomaly.baseline_value !== undefined && (
          <> &nbsp;↓ Cơ sở: <strong>{formatVal(anomaly.metric, anomaly.baseline_value)}</strong></>
        )}
        {anomaly.delta !== null && anomaly.delta !== undefined && (
          <> &nbsp;({anomaly.delta > 0 ? "+" : ""}{anomaly.delta})</>
        )}
      </div>

      {/* Evidence panel */}
      {showEvidence && <EvidencePanel anomaly={anomaly} onClose={() => setShowEvidence(false)} />}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <button
          onClick={() => setShowEvidence((v) => !v)}
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: showEvidence ? cfg.color : "transparent",
            color: showEvidence ? "#fff" : cfg.color,
            border: `1px solid ${cfg.border}`,
            transition: "all 0.15s",
          }}
        >🔍 Xem Bằng Chứng</button>

        <button
          onClick={() => onAskAI(anomaly)}
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: "transparent", color: "var(--cyan)", border: "1px solid rgba(var(--brand-rgb),0.3)",
            transition: "all 0.15s",
          }}
        >🤖 Hỏi AI Nguyên Nhân</button>

        <button
          onClick={() => onCreateTrial(anomaly)}
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)",
            transition: "all 0.15s",
          }}
        >📋 Tạo Thử Nghiệm</button>

        <button
          onClick={() => onRootCause(anomaly)}
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.3)",
            transition: "all 0.15s",
          }}
        >🔬 Phân Tích Nguyên Nhân</button>
      </div>
    </div>
  );
}

export default function AlertSurface({ role, onAskAI, onGoTrials }) {
  const [anomalies, setAnomalies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [rootCauseAnomaly, setRootCauseAnomaly] = useState(null);

  const loadAnomalies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/anomalies?limit=30");
      if (!res.ok) {
        if (res.status === 403) { setAnomalies([]); setLoading(false); return; }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setAnomalies(json.anomalies || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role !== "manager" && role !== "sd3") return;
    loadAnomalies();
    // Refresh every 30 minutes
    const interval = setInterval(loadAnomalies, 30 * 60_000);
    return () => clearInterval(interval);
  }, [role, loadAnomalies]);

  if (role !== "manager" && role !== "sd3") return null;
  if (loading && !anomalies) return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
      <div className="skeleton" style={{ height: 32, borderRadius: 8 }} />
    </div>
  );
  if (error) return null; // silent fail
  if (!anomalies || anomalies.length === 0) return null;

  const critical = anomalies.filter((a) => a.severity === "CRITICAL");
  const high     = anomalies.filter((a) => a.severity === "HIGH");
  const watchlist = anomalies.filter((a) => a.severity === "MEDIUM" || a.severity === "LOW");
  const urgent = [...critical, ...high];

  if (urgent.length === 0 && watchlist.length === 0) return null;

  const handleAskAI = (anomaly) => {
    const message = `Phân tích nguyên nhân bất thường: "${anomaly.title}". Hiện tại: ${formatVal(anomaly.metric, anomaly.current_value)}, cơ sở: ${formatVal(anomaly.metric, anomaly.baseline_value)}, thay đổi: ${anomaly.delta}. Quy tắc phát hiện: ${anomaly.detection_rule}. ${anomaly.recommendedAction || ""}`;
    // Open AI drawer and pre-fill message (AIChatDrawer listens for this event)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sd3:ai-prefill", { detail: { message } }));
    }
    if (typeof onAskAI === "function") onAskAI(message);
  };

  const handleCreateTrial = (anomaly) => {
    if (typeof onGoTrials === "function") {
      onGoTrials({ prefill: anomaly.entity_id, metric: anomaly.metric });
    }
  };

  const handleRootCause = (anomaly) => setRootCauseAnomaly(anomaly);

  return (
    <>
    {rootCauseAnomaly && (
      <RootCauseDrawer anomaly={rootCauseAnomaly} onClose={() => setRootCauseAnomaly(null)} />
    )}
    <div style={{
      borderBottom: "1px solid var(--border)",
      background: "var(--bg-panel)",
    }}>
      {/* Panel header */}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", background: "none", border: "none", cursor: "pointer",
          color: "var(--text-primary)", fontSize: 13, fontWeight: 600,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          🚨 Cảnh báo &amp; Bất thường hôm nay
          {critical.length > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#D93025", color: "#fff", fontWeight: 700 }}>
              {critical.length} CRITICAL
            </span>
          )}
          {high.length > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "rgba(245,124,0,0.15)", color: "#F57C00", border: "1px solid rgba(245,124,0,0.3)", fontWeight: 700 }}>
              {high.length} HIGH
            </span>
          )}
          {watchlist.length > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "var(--bg)", color: "var(--text-muted)", border: "1px solid var(--border)", fontWeight: 600 }}>
              {watchlist.length} watchlist
            </span>
          )}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points={panelOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
        </svg>
      </button>

      {panelOpen && (
        <div style={{ padding: "0 16px 16px" }}>
          {/* CRITICAL + HIGH */}
          {urgent.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: watchlist.length > 0 ? 12 : 0 }}>
              {urgent.map((a) => (
                <AnomalyCard
                  key={a.anomaly_id}
                  anomaly={a}
                  onAskAI={handleAskAI}
                  onCreateTrial={handleCreateTrial}
                  onRootCause={handleRootCause}
                />
              ))}
            </div>
          )}

          {/* WATCHLIST (MEDIUM + LOW) */}
          {watchlist.length > 0 && (
            <div>
              <button
                onClick={() => setWatchlistOpen((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-muted)", fontSize: 12, fontWeight: 600, padding: "4px 0",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points={watchlistOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                </svg>
                WATCHLIST ({watchlist.length} cảnh báo theo dõi)
              </button>

              {watchlistOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {watchlist.map((a) => (
                    <AnomalyCard
                      key={a.anomaly_id}
                      anomaly={a}
                      onAskAI={handleAskAI}
                      onCreateTrial={handleCreateTrial}
                      onRootCause={handleRootCause}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
