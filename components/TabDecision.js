/**
 * components/TabDecision.js — Executive Decision Center.
 * Hiển thị 3 khối: Health Bar, Critical Issues, AI Recommendations.
 * Dữ liệu từ /api/data?part=decision (anomalies + health summary).
 * Rule-based recommendations — không gọi AI khi load trang.
 * "Phân tích sâu" mới gọi AI khi user click (TODO Phase 3).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { RemixiconReact } from "@remixicon/react";

// ─── Color maps ────────────────────────────────────────────────────────────────
const ANOMALY_COLOR = {
  risk:  { bg: "var(--red-glow)",   text: "var(--red)",   label: "Rủi ro hư hỏng", icon: "ri-fire-line" },
  sla:   { bg: "var(--amber-glow)", text: "var(--amber)", label: "SLA on-time",     icon: "ri-time-line" },
  cost:  { bg: "rgba(var(--brand-rgb),0.1)", text: "var(--cyan)", label: "Chi phí đền bù", icon: "ri-money-dollar-circle-line" },
};

const HEALTH_COLOR = {
  green:   { color: "var(--green)", bg: "var(--green-glow)",   label: "Ổn định" },
  yellow:  { color: "var(--amber)", bg: "var(--amber-glow)",   label: "Cảnh báo" },
  red:     { color: "var(--red)",   bg: "var(--red-glow)",     label: "Cần xử lý" },
  unknown: { color: "var(--text-muted)", bg: "rgba(100,116,139,0.12)", label: "Chưa rõ" },
};

const PROB_COLOR = {
  high:   "var(--red)",
  medium: "var(--amber)",
  low:    "var(--green)",
};

// Tab to navigate to for each anomaly type
const DETAIL_TAB = { risk: "damage", sla: "ltl", cost: "damage" };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

function fmtAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} giờ`;
  return `${Math.round(h / 24)} ngày`;
}

function buildHypothesis(a) {
  if (a.type === "risk")  return `Thử nghiệm giảm tỷ lệ hư hỏng tại ${a.location} thông qua cải thiện quy trình đóng gói và vận chuyển`;
  if (a.type === "sla")   return `Thử nghiệm tăng on-time rate cho ${a.location} bằng cách điều chỉnh lộ trình hoặc tăng cường tuyến`;
  if (a.type === "cost")  return `Thử nghiệm giảm chi phí đền bù của ${a.location} thông qua giám sát chất lượng tăng cường`;
  return a.recommendedAction || "";
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function HealthPill({ label, level }) {
  const c = HEALTH_COLOR[level] || HEALTH_COLOR.unknown;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 90 }}>
      <div style={{ padding: "4px 12px", borderRadius: 20, background: c.bg, color: c.color, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
        {c.label}
      </div>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

function ImpactBar({ score }) {
  const color = score >= 70 ? "var(--red)" : score >= 40 ? "var(--amber)" : "var(--green)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--border)" }}>
        <div style={{ width: `${score}%`, height: "100%", borderRadius: 2, background: color, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 26 }}>{score}</span>
    </div>
  );
}

function AnomalyCard({ anomaly }) {
  const c = ANOMALY_COLOR[anomaly.type] || ANOMALY_COLOR.risk;
  const metricDisplay = () => {
    if (anomaly.metric === "damage_rate") {
      return `${anomaly.curValue} ca/1000 đơn  →  baseline ${anomaly.baseValue}  (+${anomaly.changePercent}%)`;
    }
    if (anomaly.metric === "ontime_rate") {
      return `On-time hiện tại ${anomaly.curValue}%  →  baseline ${anomaly.baseValue}%  (${anomaly.changePts}pp)`;
    }
    if (anomaly.metric === "comp_rate") {
      return `${Number(anomaly.curValue).toLocaleString("vi-VN")} đ/đơn  →  baseline ${Number(anomaly.baseValue).toLocaleString("vi-VN")}  (+${anomaly.changePercent}%)`;
    }
    return "";
  };
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.text}33`, borderRadius: 10, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18, color: c.text }}>
          <i className={c.icon} style={{ fontSize: 18 }}></i>
        </span>
        <span style={{ fontWeight: 700, fontSize: 13, color: c.text }}>{c.label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
          {anomaly.sampleOrders?.toLocaleString("vi-VN")} đơn
        </span>
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)", marginBottom: 4, lineHeight: 1.4 }}>
        {anomaly.title}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
        {metricDisplay()}
      </div>
      <ImpactBar score={anomaly.impactScore} />
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Khả năng nguyên nhân:</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: PROB_COLOR[anomaly.rootCauseProbability] || "var(--text-muted)" }}>
          {{ high: "Cao", medium: "Trung bình", low: "Thấp" }[anomaly.rootCauseProbability] || anomaly.rootCauseProbability}
        </span>
      </div>
    </div>
  );
}

function RecommendCard({ anomaly, onNavigate }) {
  const c = ANOMALY_COLOR[anomaly.type] || ANOMALY_COLOR.risk;
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { trialId, name }
  const [createErr, setCreateErr] = useState(null);

  async function handleCreate() {
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await fetch("/api/trials/create-from-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anomaly_type: anomaly.type,
          suggested_hypothesis: buildHypothesis(anomaly),
          suggested_treatment: [anomaly.location],
          suggested_control: [anomaly.type === "risk" ? "(tỉnh khác)" : "(khách khác)"],
          primary_metric: anomaly.metric,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Tạo thất bại");
      setCreated({ trialId: data.trialId, name: data.trial?.name });
    } catch (e) {
      setCreateErr(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.text, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{anomaly.title}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.55 }}>
        {anomaly.recommendedAction}
      </div>
      {created ? (
        <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
          ✓ Đã tạo thử nghiệm #{created.trialId}{created.name ? ` — ${created.name}` : ""}.{" "}
          <span
            style={{ cursor: "pointer", textDecoration: "underline", color: "var(--cyan)" }}
            onClick={() => onNavigate?.("trials")}
          >
            Xem ngay
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            disabled={creating}
            onClick={handleCreate}
            style={{
              padding: "5px 13px", fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: creating ? "wait" : "pointer",
              background: creating ? "var(--border)" : "rgba(var(--brand-rgb),0.12)",
              border: "1px solid rgba(var(--brand-rgb),0.3)", color: creating ? "var(--text-muted)" : "#FF5200",
              transition: "opacity 0.15s",
            }}
          >
            {creating ? "Đang tạo..." : "TẠO THỬ NGHIỆM"}
          </button>
          <button
            onClick={() => onNavigate?.(DETAIL_TAB[anomaly.type] || "ltl")}
            style={{
              padding: "5px 13px", fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: "pointer",
              background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)",
            }}
          >
            XEM CHI TIẾT
          </button>
          {createErr && <span style={{ fontSize: 11, color: "var(--red)" }}>{createErr}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TabDecision({ role, onNavigate }) {
  const [state, setState] = useState({ loading: true, error: null, anomalies: null, healthSummary: null, generatedAt: null });
  const lastFetchRef = useRef(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("/api/data?part=decision");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      lastFetchRef.current = Date.now();
      setState({ loading: false, error: null, anomalies: data.anomalies || [], healthSummary: data.healthSummary || null, generatedAt: data.generatedAt });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { loading, error, anomalies, healthSummary, generatedAt } = state;

  if (loading) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "#FF5200", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
        Đang phân tích dữ liệu...
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "24px" }}>
        <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--red-glow)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 13 }}>
          Lỗi tải dữ liệu: {error}
        </div>
        <button onClick={load} style={{ marginTop: 12, padding: "6px 16px", borderRadius: 6, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 13 }}>
          Thử lại
        </button>
      </div>
    );
  }

  const noIssues = !anomalies || anomalies.length === 0;

  return (
    <div style={{ padding: "20px 24px", maxWidth: 900 }}>

      {/* ── Tiêu đề + refresh ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>Quyết định hôm nay</h2>
          {generatedAt && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              Cập nhật lúc {fmtTime(generatedAt)} · {fmtAgo(generatedAt)} trước
            </div>
          )}
        </div>
        <button
          onClick={load}
          title="Làm mới"
          style={{ padding: "5px 11px", borderRadius: 6, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
        >
          ↺ Làm mới
        </button>
      </div>

      {/* ── 1. Health Bar ──────────────────────────────────────────────────── */}
      {healthSummary && (
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 10 }}>
            Sức khỏe hệ thống
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "14px 20px", background: "var(--bg-panel)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <HealthPill label="Hệ thống tổng" level={healthSummary.overall} />
            {healthSummary.dataHealth && (
              <HealthPill label="Chất lượng dữ liệu" level={healthSummary.dataHealth.level} />
            )}
            {healthSummary.aiHealth && (
              <HealthPill label="AI / LLM" level={healthSummary.aiHealth.level} />
            )}
            {healthSummary.alertCount > 0 && (
              <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12, color: "var(--amber)", fontWeight: 700 }}>
                {healthSummary.alertCount} nguồn cần chú ý
              </div>
            )}
          </div>
          {healthSummary.dataHealth?.reason && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 }}>
              Dữ liệu: {healthSummary.dataHealth.reason}
            </div>
          )}
        </section>
      )}

      {/* ── 2. Critical Issues ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 10 }}>
          Vấn đề nổi bật · 7 ngày qua
        </div>
        {noIssues ? (
          <div style={{ padding: "20px 16px", borderRadius: 10, background: "var(--green-glow)", border: "1px solid var(--green)", color: "var(--green)", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
            ✓ Không phát hiện bất thường đáng kể — hệ thống hoạt động bình thường
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {anomalies.map((a, i) => <AnomalyCard key={i} anomaly={a} />)}
          </div>
        )}
      </section>

      {/* ── 3. AI Recommendations ──────────────────────────────────────────── */}
      {!noIssues && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 10 }}>
            Đề xuất hành động
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {anomalies.map((a, i) => (
              <RecommendCard key={i} anomaly={a} onNavigate={onNavigate} />
            ))}
          </div>
          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: "rgba(var(--brand-rgb),0.05)", border: "1px solid rgba(var(--brand-rgb),0.15)", fontSize: 11, color: "var(--text-muted)" }}>
            Đề xuất được tạo tự động từ dữ liệu snapshot (rule-based, không gọi AI). Nhấn <strong>"Phân tích sâu"</strong> để gửi bối cảnh đầy đủ đến AI và nhận phân tích chi tiết hơn.
          </div>
        </section>
      )}
    </div>
  );
}
