/**
 * components/RootCauseDrawer.js — Root Cause Investigation Drawer (Phase 3).
 *
 * Shows deterministic contribution analysis + AI narrative for a given anomaly.
 * Opened from AlertSurface's "🔍 Phân Tích Nguyên Nhân" button.
 *
 * Props:
 *   anomaly   — the anomaly object from /api/anomalies
 *   onClose   — close handler
 */
import { useState, useEffect } from "react";

const EV_CONFIG = {
  STRONG:         { color: "#10b981", label: "MẠNH" },
  MODERATE:       { color: "#3b82f6", label: "TRUNG BÌNH" },
  WEAK:           { color: "#f59e0b", label: "YẾU" },
  CIRCUMSTANTIAL: { color: "#6b7280", label: "PHỎNG ĐOÁN" },
};

const SEV_COLOR = {
  CRITICAL: "#D93025",
  HIGH:     "#F57C00",
  MEDIUM:   "#F9A825",
  LOW:      "#388E3C",
};

function EvidenceBadge({ level }) {
  const cfg = EV_CONFIG[level] || EV_CONFIG.CIRCUMSTANTIAL;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
      background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}55`,
      letterSpacing: 0.4,
    }}>
      {cfg.label}
    </span>
  );
}

function CandidateCauseCard({ cause, index }) {
  const [detailOpen, setDetailOpen] = useState(index === 0);
  return (
    <div style={{
      borderRadius: 8, border: "1px solid var(--border)",
      background: "var(--bg-panel)", overflow: "hidden", marginBottom: 8,
    }}>
      <button
        onClick={() => setDetailOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", background: "none", border: "none", cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: "var(--text-primary)" }}>
          {index + 1}. {cause.title}
        </span>
        <EvidenceBadge level={cause.evidence_level} />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points={detailOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
        </svg>
      </button>

      {detailOpen && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-secondary)" }}>
          <p style={{ marginTop: 8, lineHeight: 1.6 }}>{cause.description}</p>

          {cause.supporting_evidence?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#10b981", marginBottom: 4 }}>✓ Bằng chứng ủng hộ:</div>
              {cause.supporting_evidence.map((e, i) => (
                <div key={i} style={{ padding: "2px 0 2px 10px", borderLeft: "2px solid #10b98155" }}>• {e}</div>
              ))}
            </div>
          )}

          {cause.contradicting_evidence?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", marginBottom: 4 }}>⚠ Bằng chứng phản bác:</div>
              {cause.contradicting_evidence.map((e, i) => (
                <div key={i} style={{ padding: "2px 0 2px 10px", borderLeft: "2px solid #f59e0b55" }}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContributionTable({ contribution }) {
  if (!contribution?.top_contributors?.length) return <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Không đủ dữ liệu phân tách.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "4px 6px", textAlign: "left" }}>{contribution.breakdown_dimension === "province" ? "Tỉnh" : "Khách hàng"}</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>Hiện tại</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>Baseline</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>Δ</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>% đóng góp</th>
          </tr>
        </thead>
        <tbody>
          {contribution.top_contributors.map((c, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: i === 0 ? "rgba(99,102,241,0.04)" : "transparent" }}>
              <td style={{ padding: "5px 6px", fontWeight: i === 0 ? 600 : 400, color: "var(--text-primary)" }}>{c.entity}</td>
              <td style={{ padding: "5px 6px", textAlign: "right", color: c.current_value < 85 ? "#F57C00" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                {c.current_value !== null ? `${c.current_value}%` : "—"}
              </td>
              <td style={{ padding: "5px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {c.baseline_value !== null ? `${c.baseline_value}%` : "—"}
              </td>
              <td style={{ padding: "5px 6px", textAlign: "right", color: (c.delta || 0) < 0 ? "#D93025" : "#10b981", fontVariantNumeric: "tabular-nums" }}>
                {c.delta !== null ? `${c.delta > 0 ? "+" : ""}${c.delta}` : "—"}
              </td>
              <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, color: Math.abs(c.share_of_delta_pct || 0) > 40 ? "#F57C00" : "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {c.share_of_delta_pct !== null ? `${c.share_of_delta_pct}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeerRow({ peer, isEntity }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "4px 0", borderBottom: "1px solid var(--border)",
      background: isEntity ? "rgba(99,102,241,0.06)" : "transparent",
      paddingLeft: isEntity ? 6 : 0, borderRadius: isEntity ? 4 : 0,
    }}>
      <span style={{ fontSize: 11, fontWeight: isEntity ? 700 : 400, color: isEntity ? "#6366f1" : "var(--text-secondary)" }}>
        {isEntity ? "★ " : ""}{peer.client}
      </span>
      <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: peer.ot < 85 ? "#F57C00" : "var(--text-secondary)" }}>
        {peer.ot}%
      </span>
    </div>
  );
}

function MarkdownNarrative({ text }) {
  if (!text) return null;
  const rendered = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/## (.+)/g, "<h3 style='font-size:13px;font-weight:700;margin:14px 0 6px;color:var(--text-primary)'>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code style='background:rgba(99,102,241,0.15);padding:1px 5px;border-radius:4px;font-size:11px'>$1</code>")
    .replace(/^> (.+)$/gm, "<blockquote style='margin:8px 0;padding:6px 10px;border-left:3px solid #6366f1;color:var(--text-muted);font-size:11px'>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li style='margin:2px 0'>$1</li>")
    .replace(/⚠️/g, "<span>⚠️</span>")
    .replace(/\n/g, "<br/>");
  return <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: rendered }} />;
}

export default function RootCauseDrawer({ anomaly, onClose }) {
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [activeTab, setActiveTab] = useState("ai");

  useEffect(() => {
    if (!anomaly?.anomaly_id) return;
    setState("loading");
    setResult(null);
    setErrorMsg(null);

    fetch("/api/root-cause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anomaly_id: anomaly.anomaly_id, anomaly }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) { setState("done"); setResult(json); }
        else { setState("error"); setErrorMsg(json.error || "Lỗi phân tích"); }
      })
      .catch((e) => { setState("error"); setErrorMsg(e.message); });
  }, [anomaly?.anomaly_id]);

  const analysis = result?.analysis;
  const sevColor = SEV_CONFIG[anomaly?.severity] || "#888";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000,
        }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(600px, 100vw)",
        background: "var(--bg)", zIndex: 10001,
        boxShadow: "-8px 0 32px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: SEV_COLOR[anomaly?.severity] || "#888", color: "#fff" }}>
                  {anomaly?.severity}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Phân Tích Nguyên Nhân</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.4 }}>
                {anomaly?.title || anomaly?.entity_id}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {anomaly?.evidence?.window_label || ""} · {anomaly?.detection_rule}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20, padding: 4 }}
            >✕</button>
          </div>

          {/* Confidence badge */}
          {analysis && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: analysis.confidence_score >= 70 ? "rgba(16,185,129,0.12)" : analysis.confidence_score >= 50 ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
                color: analysis.confidence_score >= 70 ? "#10b981" : analysis.confidence_score >= 50 ? "#f59e0b" : "#ef4444",
                border: `1px solid ${analysis.confidence_score >= 70 ? "#10b98133" : analysis.confidence_score >= 50 ? "#f59e0b33" : "#ef444433"}`,
              }}>
                Độ tin cậy phân tích: {analysis.confidence_score}%
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {analysis.candidate_causes?.length} ứng viên nguyên nhân
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
          {[
            { id: "ai",           label: "🤖 Giải thích AI" },
            { id: "candidates",   label: "🧩 Ứng viên" },
            { id: "contribution", label: "📊 Đóng góp" },
            { id: "peers",        label: "👥 So sánh nhóm" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                flex: 1, padding: "8px 4px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
                background: activeTab === t.id ? "var(--bg)" : "transparent",
                color: activeTab === t.id ? "#6366f1" : "var(--text-muted)",
                borderBottom: activeTab === t.id ? "2px solid #6366f1" : "2px solid transparent",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {state === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", paddingTop: 40, color: "var(--text-muted)" }}>
              <div style={{ fontSize: 24 }}>⏳</div>
              <div style={{ fontSize: 13 }}>Đang phân tích nguyên nhân...</div>
              <div style={{ fontSize: 11 }}>Tính toán định lượng → Suy luận AI</div>
            </div>
          )}

          {state === "error" && (
            <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 13, color: "#ef4444" }}>
              ⚠️ {errorMsg}
            </div>
          )}

          {state === "done" && analysis && (
            <>
              {/* Tab: AI Narrative */}
              {activeTab === "ai" && (
                <div>
                  {result.ai_narrative
                    ? <MarkdownNarrative text={result.ai_narrative} />
                    : (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>
                        AI không thể tạo giải thích lúc này. Xem tab "Ứng viên" để đọc phân tích thô.
                      </div>
                    )
                  }
                </div>
              )}

              {/* Tab: Candidate Causes */}
              {activeTab === "candidates" && (
                <div>
                  {analysis.candidate_causes?.length === 0
                    ? <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Không tìm được ứng viên nguyên nhân.</p>
                    : analysis.candidate_causes.map((c, i) => <CandidateCauseCard key={c.cause_id} cause={c} index={i} />)
                  }

                  {analysis.recommended_actions?.length > 0 && (
                    <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 8, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6366f1", marginBottom: 8 }}>HÀNH ĐỘNG ĐỀ XUẤT</div>
                      {analysis.recommended_actions.map((a, i) => (
                        <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "3px 0" }}>
                          {i + 1}. {a}
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.missing_data_points?.length > 0 && (
                    <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>⚠ DỮ LIỆU CÒN THIẾU</div>
                      {analysis.missing_data_points.map((m, i) => (
                        <div key={i} style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 0" }}>• {m}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Contribution Analysis */}
              {activeTab === "contribution" && (
                <div>
                  {analysis.contribution_analysis
                    ? (
                      <>
                        <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "var(--bg-panel)", border: "1px solid var(--border)", fontSize: 12 }}>
                          <div style={{ display: "flex", gap: 24 }}>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>On-time hiện tại</div>
                              <div style={{ fontWeight: 700, color: "#F57C00", fontSize: 15 }}>
                                {analysis.contribution_analysis.total_current_value}%
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Baseline (4 tuần)</div>
                              <div style={{ fontWeight: 700, fontSize: 15 }}>
                                {analysis.contribution_analysis.total_baseline_value}%
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Delta tổng</div>
                              <div style={{ fontWeight: 700, color: "#D93025", fontSize: 15 }}>
                                {analysis.contribution_analysis.total_delta}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                          Top tỉnh/khu vực đóng góp vào sụt giảm:
                        </div>
                        <ContributionTable contribution={analysis.contribution_analysis} />
                      </>
                    )
                    : <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Không đủ dữ liệu phân tích đóng góp.</p>
                  }
                </div>
              )}

              {/* Tab: Peer Comparison */}
              {activeTab === "peers" && (
                <div>
                  {analysis.peer_comparison
                    ? (
                      <>
                        <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "var(--bg-panel)", border: "1px solid var(--border)", fontSize: 12 }}>
                          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Median nhóm</div>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{analysis.peer_comparison.peer_median}%</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Xếp hạng</div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#6366f1" }}>
                                {analysis.peer_comparison.entity_rank}/{analysis.peer_comparison.peer_count}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Percentile</div>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{analysis.peer_comparison.entity_percentile}%</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Hệ thống</div>
                              <div style={{ fontWeight: 700, fontSize: 12, color: analysis.peer_comparison.system_wide_drop ? "#F57C00" : "#10b981" }}>
                                {analysis.peer_comparison.system_wide_drop ? "⚠ Diện rộng" : "✓ Cô lập"}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                          Bảng xếp hạng on-time ({analysis.peer_comparison.peer_count} khách hàng đủ mẫu):
                        </div>
                        {analysis.peer_comparison.peers_snapshot?.map((p, i) => (
                          <PeerRow key={i} peer={p} isEntity={p.client === anomaly.entity_id} />
                        ))}
                      </>
                    )
                    : <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Không đủ peer để so sánh.</p>
                  }
                </div>
              )}

              {/* Footer: investigations */}
              {activeTab !== "ai" && analysis.recommended_investigations?.length > 0 && (
                <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 8, background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", marginBottom: 6 }}>BƯỚC ĐIỀU TRA TIẾP THEO</div>
                  {analysis.recommended_investigations.map((step, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "3px 0" }}>
                      {i + 1}. {step}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
