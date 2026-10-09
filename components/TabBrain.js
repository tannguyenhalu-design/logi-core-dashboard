/**
 * components/TabBrain.js
 * Bộ Não Tiểu Đệ SD3 — Quản lý kiến thức tích lũy từ các cuộc hội thoại
 */
import { useState, useEffect } from "react";

const TYPE_LABELS = {
  user_preference: { label: "Sở thích Đại Ca", emoji: "📌", color: "#8b5cf6" },
  business_insight: { label: "Insight kinh doanh", emoji: "📊", color: "#06b6d4" },
  correction: { label: "Sửa lỗi AI", emoji: "✏️", color: "var(--amber)" },
  faq: { label: "FAQ hay gặp", emoji: "❓", color: "var(--green)" },
  pattern: { label: "Pattern vận hành", emoji: "🔄", color: "#6366f1" },
};

const STATUS_CFG = {
  "Đề xuất": { color: "var(--amber)", bg: "var(--amber-glow)", label: "Đề xuất" },
  "Đã duyệt": { color: "var(--green)", bg: "var(--green-glow)", label: "✓ Đã duyệt" },
  "Bỏ":       { color: "var(--red)",   bg: "var(--red-glow)",   label: "✕ Bỏ" },
};

function StatusBadge({ status }) {
  const s = STATUS_CFG[status] || STATUS_CFG["Đề xuất"];
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}44`,
      borderRadius: 5, padding: "2px 7px", fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      {s.label}
    </span>
  );
}

function TypeBadge({ type }) {
  const t = TYPE_LABELS[type] || { label: type, emoji: "🧠", color: "#64748b" };
  return (
    <span style={{
      background: `${t.color}22`,
      color: t.color,
      border: `1px solid ${t.color}44`,
      borderRadius: 5,
      padding: "2px 7px",
      fontSize: 10.5,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {t.emoji} {t.label}
    </span>
  );
}

function ConfidenceDot({ val }) {
  const pct = Math.round(val * 100);
  const color = pct >= 80 ? "#10b981" : pct >= 60 ? "#fbbf24" : "#f43f5e";
  return (
    <span style={{
      color,
      fontWeight: 700,
      fontSize: 12,
    }}>
      {pct}%
    </span>
  );
}

export default function TabBrain({ role }) {
  const isManager = role === "manager";
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all"); // "all"|"Đề xuất"|"Đã duyệt"|"Bỏ"
  const [reviewing, setReviewing] = useState(null); // { row, action }
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newInsight, setNewInsight] = useState({
    type: "user_preference", topic: "", insight: "", confidence: 0.8
  });
  const [resetting, setResetting] = useState(false);

  const fetchBrain = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-memory?action=raw");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi tải dữ liệu");
      setEntries(json.entries || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (entry, newStatus) => {
    const key = `${entry.row}-${newStatus}`;
    setReviewing(key);
    try {
      const res = await fetch("/api/ai-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: entry.row, ts: entry.timestamp, status: newStatus }),
      });
      const json = await res.json();
      if (json.ok) {
        setEntries((prev) => prev.map((e) => e.row === entry.row ? { ...e, status: newStatus } : e));
      } else {
        alert("Lỗi: " + (json.error || "Không rõ"));
      }
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setReviewing(null);
    }
  };

  useEffect(() => { fetchBrain(); }, []);

  const handleGenerateSummary = async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/ai-memory?action=summary");
      const json = await res.json();
      if (json.ok) setSummary(json.summary);
    } catch (e) { /* silent */ }
    finally { setSummaryLoading(false); }
  };

  const handleAddInsight = async (e) => {
    e.preventDefault();
    if (!newInsight.insight.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/ai-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newInsight.type,
          topic: newInsight.topic,
          insight: newInsight.insight,
          confidence: parseFloat(newInsight.confidence),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error);
      setNewInsight({ type: "user_preference", topic: "", insight: "", confidence: 0.8 });
      setShowAddForm(false);
      await fetchBrain();
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Đại Ca có chắc chắn muốn XÓA TOÀN BỘ bộ não của Tiểu Đệ không? Hành động này không thể hoàn tác!")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/ai-memory", { method: "DELETE" });
      const json = await res.json();
      if (json.ok) { await fetchBrain(); setSummary(null); }
    } catch (e) { alert("Lỗi: " + e.message); }
    finally { setResetting(false); }
  };

  const filtered = entries
    .filter((e) => filterType === "all" || e.type === filterType)
    .filter((e) => filterStatus === "all" || (e.status || "Đề xuất") === filterStatus);
  const sorted = [...filtered].sort((a, b) => {
    // Đã duyệt lên đầu, Bỏ xuống cuối
    const sA = a.status === "Đã duyệt" ? 0 : a.status === "Bỏ" ? 2 : 1;
    const sB = b.status === "Đã duyệt" ? 0 : b.status === "Bỏ" ? 2 : 1;
    if (sA !== sB) return sA - sB;
    return b.usedCount - a.usedCount || b.confidence - a.confidence;
  });

  const stats = Object.keys(TYPE_LABELS).map((type) => ({
    type,
    count: entries.filter((e) => e.type === type).length,
  }));

  const statusCounts = {
    all: entries.length,
    "Đề xuất": entries.filter((e) => !e.status || e.status === "Đề xuất").length,
    "Đã duyệt": entries.filter((e) => e.status === "Đã duyệt").length,
    "Bỏ": entries.filter((e) => e.status === "Bỏ").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{
        background: "var(--card-bg)",
        borderRadius: 12,
        border: "1px solid var(--border)",
        padding: "18px 22px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
              🧠 Bộ Não Tiểu Đệ SD3
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
              Kiến thức tích lũy từ các cuộc hội thoại — inject ưu tiên mục Đã duyệt mỗi lần chat.
              Hiện có <strong style={{ color: "var(--brand-glow)" }}>{entries.length}</strong> insights
              {" · "}<span style={{ color: "var(--green)" }}>{statusCounts["Đã duyệt"]} đã duyệt</span>
              {statusCounts["Đề xuất"] > 0 && <span style={{ color: "var(--amber)" }}> · {statusCounts["Đề xuất"]} chờ duyệt</span>}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleGenerateSummary}
              disabled={summaryLoading}
              style={{
                background: "rgba(99,102,241,0.15)",
                color: "#6366f1",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {summaryLoading ? "⏳ Đang tổng hợp..." : "📖 Tạo Knowledge Summary"}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                background: "var(--green-glow)",
                color: "var(--green)",
                border: "1px solid var(--green)",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ➕ Thêm insight thủ công
            </button>
            <button
              onClick={handleReset}
              disabled={resetting}
              style={{
                background: "var(--red-glow)",
                color: "var(--red)",
                border: "1px solid var(--red)",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {resetting ? "Đang reset..." : "🗑️ Reset Brain"}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          {stats.map((s) => {
            const t = TYPE_LABELS[s.type];
            return (
              <div
                key={s.type}
                onClick={() => setFilterType(filterType === s.type ? "all" : s.type)}
                style={{
                  background: filterType === s.type ? `${t.color}22` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${filterType === s.type ? t.color + "55" : "var(--border)"}`,
                  borderRadius: 8,
                  padding: "6px 12px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 14 }}>{t.emoji}</span>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{t.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.color }}>{s.count}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Status filter bar */}
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginRight: 4 }}>Trạng thái:</span>
          {[
            { val: "all",    label: "Tất cả",        color: "var(--text-muted)", bg: "var(--panel-glow)"  },
            { val: "Đề xuất", label: "Đề xuất",       color: "var(--amber)",      bg: "var(--amber-glow)" },
            { val: "Đã duyệt", label: "✓ Đã duyệt", color: "var(--green)",      bg: "var(--green-glow)" },
            { val: "Bỏ",     label: "✕ Bỏ",          color: "var(--red)",        bg: "var(--red-glow)"   },
          ].map(({ val, label, color, bg }) => (
            <button
              key={val}
              onClick={() => setFilterStatus(val)}
              style={{
                background: filterStatus === val ? bg : "rgba(255,255,255,0.03)",
                color: filterStatus === val ? color : "var(--text-muted)",
                border: `1px solid ${filterStatus === val ? color : "var(--border)"}`,
                borderRadius: 7, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              {label} ({statusCounts[val] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {/* Weekly Summary */}
      {summary && (
        <div style={{
          background: "rgba(139,92,246,0.08)",
          border: "1px solid rgba(139,92,246,0.3)",
          borderRadius: 12,
          padding: "16px 20px",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa", marginBottom: 10 }}>
            📖 Knowledge Summary — Tổng hợp tuần
          </div>
          <pre style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-primary)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.7,
            fontFamily: "inherit",
          }}>
            {summary}
          </pre>
        </div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "18px 22px",
        }}>
          <h4 style={{ margin: "0 0 16px", fontSize: 14, color: "var(--text-primary)" }}>
            ➕ Thêm Insight Thủ Công
          </h4>
          <form onSubmit={handleAddInsight} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Loại insight</label>
                <select
                  value={newInsight.type}
                  onChange={(e) => setNewInsight((p) => ({ ...p, type: e.target.value }))}
                  style={{
                    width: "100%",
                    background: "var(--panel-glow)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  {Object.entries(TYPE_LABELS).map(([v, t]) => (
                    <option key={v} value={v}>{t.emoji} {t.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Chủ đề (Topic)</label>
                <input
                  type="text"
                  value={newInsight.topic}
                  onChange={(e) => setNewInsight((p) => ({ ...p, topic: e.target.value }))}
                  placeholder="Ví dụ: Casper B2C doanh thu"
                  style={{
                    width: "100%",
                    background: "var(--panel-glow)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ width: 100 }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Độ tin cậy</label>
                <input
                  type="number"
                  min="0.1" max="1.0" step="0.1"
                  value={newInsight.confidence}
                  onChange={(e) => setNewInsight((p) => ({ ...p, confidence: e.target.value }))}
                  style={{
                    width: "100%",
                    background: "var(--panel-glow)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Nội dung insight *</label>
              <textarea
                rows={3}
                value={newInsight.insight}
                onChange={(e) => setNewInsight((p) => ({ ...p, insight: e.target.value }))}
                required
                placeholder="Ví dụ: Đại Ca hay quan tâm đến dự án Casper B2C và thường hỏi theo khu vực HCM"
                style={{
                  width: "100%",
                  background: "var(--panel-glow)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={adding}
                style={{
                  background: "var(--green)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {adding ? "Đang lưu..." : "💾 Lưu vào Bộ Não"}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Hủy
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Brain entries table */}
      {error && (
        <div style={{ background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", borderRadius: 10, padding: 14, color: "var(--red)", fontSize: 13 }}>
          Lỗi: {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 13 }}>
          ⏳ Đang tải bộ não...
        </div>
      ) : sorted.length === 0 ? (
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 40,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🧠</div>
          <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
            Bộ não đang trống. Hãy chat với Tiểu Đệ để nó tự học và tích lũy kiến thức!
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--card-bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--panel-glow)", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", width: "12%" }}>Loại</th>
                <th style={{ padding: "10px 14px", textAlign: "left", width: "11%" }}>Chủ đề</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Nội dung Insight</th>
                <th style={{ padding: "10px 14px", textAlign: "center", width: "9%" }}>Trạng thái</th>
                <th style={{ padding: "10px 14px", textAlign: "center", width: "6%" }}>Tin cậy</th>
                <th style={{ padding: "10px 14px", textAlign: "center", width: "5%" }}>Dùng</th>
                <th style={{ padding: "10px 14px", textAlign: "left", width: "11%" }}>Nguồn</th>
                {isManager && <th style={{ padding: "10px 14px", textAlign: "center", width: "10%" }}>Hành động</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, i) => {
                const rKey = `${e.row}-Đã duyệt`;
                const bKey = `${e.row}-Bỏ`;
                const isApproved = e.status === "Đã duyệt";
                const isRejected = e.status === "Bỏ";
                return (
                  <tr key={i} style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: isRejected ? 0.5 : 1,
                    background: isApproved ? "rgba(16,185,129,0.04)" : "transparent",
                  }}>
                    <td style={{ padding: "10px 14px" }}><TypeBadge type={e.type} /></td>
                    <td style={{ padding: "10px 14px", color: "var(--text-secondary)", fontSize: 12 }}>{e.topic || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "var(--text-primary)", lineHeight: 1.6 }}>{e.insight}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <StatusBadge status={e.status || "Đề xuất"} />
                      {e.verifiedBy && <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{e.verifiedBy}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}><ConfidenceDot val={e.confidence} /></td>
                    <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-muted)" }}>
                      {e.usedCount > 0 ? <span style={{ color: "var(--brand-glow)", fontWeight: 700 }}>{e.usedCount}×</span> : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text-muted)", fontSize: 11 }}>
                      <div>{e.source || "auto"}</div>
                      <div style={{ fontSize: 10, opacity: 0.6 }}>
                        {e.timestamp ? new Date(e.timestamp).toLocaleDateString("vi-VN") : ""}
                      </div>
                    </td>
                    {isManager && (
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {!isApproved && (
                          <button
                            disabled={reviewing === rKey}
                            onClick={() => handleReview(e, "Đã duyệt")}
                            style={{
                              display: "block", width: "100%", marginBottom: 4,
                              background: "var(--green-glow)", color: "var(--green)",
                              border: "1px solid var(--green)", borderRadius: 6,
                              padding: "4px 6px", fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            {reviewing === rKey ? "..." : "✓ Duyệt"}
                          </button>
                        )}
                        {!isRejected && (
                          <button
                            disabled={reviewing === bKey}
                            onClick={() => handleReview(e, "Bỏ")}
                            style={{
                              display: "block", width: "100%",
                              background: "var(--red-glow)", color: "var(--red)",
                              border: "1px solid var(--red)", borderRadius: 6,
                              padding: "4px 6px", fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            {reviewing === bKey ? "..." : "✕ Bỏ"}
                          </button>
                        )}
                        {isApproved && (
                          <button
                            disabled={reviewing === `${e.row}-Đề xuất`}
                            onClick={() => handleReview(e, "Đề xuất")}
                            style={{
                              display: "block", width: "100%",
                              background: "rgba(100,116,139,0.1)", color: "var(--text-muted)",
                              border: "1px solid var(--border)", borderRadius: 6,
                              padding: "4px 6px", fontSize: 10.5, cursor: "pointer",
                            }}
                          >
                            Hoàn tác
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
