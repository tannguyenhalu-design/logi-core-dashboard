/**
 * components/AITrialPrefill.js — Phase 4: AI-guided trial creation modal.
 *
 * Pre-fills a new trial from an anomaly object so the user only needs to
 * review and confirm rather than type everything from scratch.
 *
 * Props:
 *   anomaly    — the anomaly object from /api/anomalies
 *   onClose    — called when the modal is dismissed
 *   onGoTrials — called after a successful save, to navigate to the trials tab
 */
import { useState, useEffect } from "react";

const METRIC_MAP = {
  ontime_rate: "ontime_pct",
  damage_rate: "damage_pct",
  comp_per_order: "comp_per1k",
};

function canonicMetric(m) {
  return METRIC_MAP[m] || m || "ontime_pct";
}

function fmtVal(metric, val) {
  if (val === null || val === undefined) return "N/A";
  if (metric?.includes("ontime") || metric?.includes("rate")) return `${val}%`;
  if (metric?.includes("comp") || metric?.includes("per_order")) return `${Number(val).toLocaleString("vi-VN")} ₫`;
  if (metric?.includes("damage")) return `${val}‰`;
  return String(val);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function AITrialPrefill({ anomaly, onClose, onGoTrials }) {
  const today = new Date().toISOString().slice(0, 10);

  const initHypothesis = `Bất thường phát hiện: ${anomaly.title}. `
    + `Hiện tại ${fmtVal(anomaly.metric, anomaly.current_value)}, cơ sở ${fmtVal(anomaly.metric, anomaly.baseline_value)}. `
    + (anomaly.recommendedAction ? anomaly.recommendedAction : "Cần điều tra nguyên nhân và triển khai biện pháp khắc phục.");

  const [name, setName]             = useState(`Cải thiện ${anomaly.entity_id} — ${anomaly.metric || "on-time"}`);
  const [metric, setMetric]         = useState(canonicMetric(anomaly.metric));
  const [baseStart, setBaseStart]   = useState(daysAgo(30));
  const [baseEnd, setBaseEnd]       = useState(today);
  const [targetText, setTargetText] = useState(
    anomaly.baseline_value != null
      ? `Phục hồi về ≥ ${anomaly.baseline_value}${anomaly.metric?.includes("rate") || anomaly.metric?.includes("ontime") ? "%" : ""} trong 30 ngày tới`
      : "Cải thiện chỉ số về mức cơ sở trong 30 ngày tới"
  );
  const [hypothesis, setHypothesis] = useState(initHypothesis);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const solution = {
        name: name.trim(),
        clients: [anomaly.entity_id].filter(Boolean),
        metric,
        baseStart,
        baseEnd,
        targetText: targetText.trim(),
        hypothesis: hypothesis.trim(),
        status: "active",
      };
      const res = await fetch("/api/trials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSolution", solution }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onGoTrials();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = {
    padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)",
    background: "var(--bg)", color: "var(--text-primary)", fontSize: 13,
    fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box",
  };
  const labelStyle = {
    display: "flex", flexDirection: "column", gap: 4,
  };
  const capStyle = {
    fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
    textTransform: "uppercase", letterSpacing: "0.06em",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: 14, width: "min(560px, 94vw)", maxHeight: "88vh", overflowY: "auto",
          padding: "24px 28px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>📋 Tạo Thử Nghiệm từ Bất Thường</h3>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>AI đã điền trước — kiểm tra và điều chỉnh nếu cần</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        {/* Anomaly context banner */}
        <div style={{
          padding: "10px 12px", borderRadius: 8, marginBottom: 16,
          background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, color: "#ef4444", marginBottom: 3 }}>
            🚨 Bất thường nguồn: {anomaly.severity}
          </div>
          <div style={{ color: "var(--text-secondary)" }}>{anomaly.title}</div>
          <div style={{ color: "var(--text-muted)", marginTop: 3, fontSize: 11 }}>
            Hiện tại <strong>{fmtVal(anomaly.metric, anomaly.current_value)}</strong>
            {anomaly.baseline_value != null && <> → cơ sở <strong>{fmtVal(anomaly.metric, anomaly.baseline_value)}</strong></>}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={labelStyle}>
            <span style={capStyle}>Tên thử nghiệm</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required style={fieldStyle} />
          </label>

          <label style={labelStyle}>
            <span style={capStyle}>Chỉ số chính</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value)} style={fieldStyle}>
              <option value="ontime_pct">% on-time</option>
              <option value="damage_pct">% bể vỡ</option>
              <option value="lead_days">Thời gian giao TB (ngày)</option>
              <option value="return_pct">% đơn hoàn</option>
              <option value="comp_per1k">Tiền đền / 1.000 đơn</option>
              <option value="external">Ngoài hệ thống (tự ghi cách đo)</option>
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={labelStyle}>
              <span style={capStyle}>Baseline từ</span>
              <input type="date" value={baseStart} onChange={(e) => setBaseStart(e.target.value)} required style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              <span style={capStyle}>Baseline đến</span>
              <input type="date" value={baseEnd} onChange={(e) => setBaseEnd(e.target.value)} required style={fieldStyle} />
            </label>
          </div>

          <label style={labelStyle}>
            <span style={capStyle}>Mục tiêu đo lường</span>
            <input value={targetText} onChange={(e) => setTargetText(e.target.value)} required style={fieldStyle} placeholder="VD: Đạt ≥ 95% on-time trong 30 ngày tới" />
          </label>

          <label style={labelStyle}>
            <span style={capStyle}>Giả thuyết (hypothesis)</span>
            <textarea
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              rows={4}
              style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </label>

          {error && (
            <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 12 }}>
              Lỗi: {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "inherit" }}>
              Hủy
            </button>
            <button type="submit" disabled={saving} style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              background: "rgba(var(--brand-rgb),0.15)", border: "1px solid rgba(var(--brand-rgb),0.3)",
              color: "var(--cyan)", fontFamily: "inherit",
            }}>
              {saving ? "Đang tạo…" : "✅ Tạo thử nghiệm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
