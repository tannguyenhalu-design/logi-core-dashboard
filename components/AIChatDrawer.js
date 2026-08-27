import { useState, useRef, useEffect } from "react";

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code style='background:rgba(139,92,246,0.2);padding:1px 5px;border-radius:4px;font-size:11px'>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul style='margin:6px 0;padding-left:16px'>$1</ul>")
    .replace(/\n/g, "<br/>");
}

// ─── Alert banner sub-component ───────────────────────────────────────────────
function AlertBanner({ alerts, recommendations, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const critical = alerts.filter((a) => a.level === "critical");
  const warning = alerts.filter((a) => a.level === "warning");
  if (alerts.length === 0) return null;

  return (
    <div style={{
      margin: "8px 12px 0",
      background: critical.length > 0
        ? "rgba(244,63,94,0.12)"
        : "rgba(251,191,36,0.1)",
      border: `1px solid ${critical.length > 0 ? "rgba(244,63,94,0.3)" : "rgba(251,191,36,0.3)"}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Banner header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {critical.length > 0 ? "🔴" : "⚠️"}{" "}
          {critical.length > 0
            ? `${critical.length} dự án NGUY HIỂM cần xử lý ngay!`
            : `${warning.length} dự án đang chậm KPI`}
        </span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          {expanded ? "▲ Thu gọn" : "▼ Xem chi tiết"}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.slice(0, 5).map((a, i) => (
            <div
              key={i}
              style={{ fontSize: 11.5, color: "var(--text-primary)" }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(a.msg) }}
            />
          ))}
          {recommendations.length > 0 && (
            <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", marginBottom: 6 }}>
                💡 Gợi ý action:
              </div>
              {recommendations.slice(0, 3).map((r, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div
                    style={{ fontSize: 11, color: "var(--text-primary)" }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(r.action) }}
                  />
                  <button
                    onClick={() => onAction(`Tạo task nhắc ${r.pic} follow dự án ${r.project}`)}
                    style={{
                      marginTop: 4,
                      background: "rgba(139,92,246,0.2)",
                      border: "1px solid rgba(139,92,246,0.4)",
                      borderRadius: 6,
                      padding: "3px 8px",
                      color: "#a78bfa",
                      fontSize: 10.5,
                      cursor: "pointer",
                    }}
                  >
                    ➡️ Tạo Task cho {r.pic}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Month comparison tab ──────────────────────────────────────────────────────
function ComparisonPanel({ comparisons, meta }) {
  if (!comparisons || comparisons.length === 0) return null;
  const sorted = [...comparisons]
    .filter((c) => c.thisMo !== "0đ" || c.lastMo !== "0đ")
    .sort((a, b) => Math.abs(b.momChangePct) - Math.abs(a.momChangePct))
    .slice(0, 8);

  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: "#a78bfa",
        marginBottom: 8,
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span>📈 So sánh tháng trước vs tháng này</span>
        <span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>
          Tiến độ tháng: {meta?.monthProgressPct}%
        </span>
      </div>
      {sorted.map((c, i) => (
        <div key={i} style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "5px 0",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          fontSize: 11,
        }}>
          <div style={{ flex: 1, color: "var(--text-primary)", fontWeight: 600, fontSize: 11 }}>
            {c.trendEmoji} {c.name.length > 20 ? c.name.slice(0, 20) + "…" : c.name}
          </div>
          <div style={{ textAlign: "right", color: "rgba(255,255,255,0.6)", minWidth: 90 }}>
            <span style={{ color: c.momChangePct > 5 ? "#10b981" : c.momChangePct < -5 ? "#f43f5e" : "#fbbf24" }}>
              {c.trend}{Math.abs(c.momChangePct)}%
            </span>
            {" · "}
            {c.kpiPct !== null ? (
              <span style={{ color: c.kpiPct >= 100 ? "#10b981" : c.kpiPct >= 60 ? "#fbbf24" : "#f43f5e" }}>
                KPI {c.kpiPct}%
              </span>
            ) : "N/A"}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main chat drawer ──────────────────────────────────────────────────────────
export default function AIChatDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chat"); // "chat" | "compare"
  const [messages, setMessages] = useState([
    {
      sender: "ai",
      text: "Dạ, Tiểu Đệ SD3 xin bái chào Đại Ca! 🙇‍♂️ Đang scan hệ thống để báo cáo tình hình mới nhất...",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertData, setAlertData] = useState(null);
  const [alertLoaded, setAlertLoaded] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  // Auto proactive alert scan when chat opens
  useEffect(() => {
    if (!isOpen || alertLoaded) return;
    setAlertLoaded(true);

    fetch("/api/ai-alert")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) return;
        setAlertData(data);
        if (data.summary) {
          setMessages([{ sender: "ai", text: data.summary }]);
        }
      })
      .catch(() => {
        setMessages([{
          sender: "ai",
          text: "Dạ Đại Ca, Tiểu Đệ đã sẵn sàng! 🙇‍♂️ Đại Ca muốn hỏi gì ạ?",
        }]);
      });
  }, [isOpen, alertLoaded]);

  const handleSend = async (textToSend) => {
    const q = textToSend || input;
    if (!q || !q.trim() || loading) return;

    const userMsg = { sender: "user", text: q };
    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          history: messages.slice(-6).map((m) => ({
            role: m.sender === "user" ? "user" : "model",
            text: m.text,
          })),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessages((prev) => [...prev, { sender: "ai", text: json.reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "ai", text: "⚠️ " + (json.error || "Có lỗi xảy ra.") },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: "⚠️ Không thể kết nối máy chủ AI." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const tabStyle = (tab) => ({
    flex: 1,
    padding: "8px 0",
    background: activeTab === tab ? "rgba(139,92,246,0.2)" : "transparent",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid #8b5cf6" : "2px solid transparent",
    color: activeTab === tab ? "#a78bfa" : "rgba(255,255,255,0.4)",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  });

  return (
    <>
      {/* Floating Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
          color: "#fff",
          border: "none",
          borderRadius: 30,
          padding: "12px 20px",
          fontWeight: 700,
          fontSize: 13.5,
          cursor: "pointer",
          boxShadow: "0 8px 24px rgba(139, 92, 246, 0.4)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <span>🙇‍♂️</span>
        <span>{isOpen ? "Đóng Tiểu Đệ" : "Gọi Tiểu Đệ SD3"}</span>
        {/* Red dot if alerts */}
        {!isOpen && alertData?.meta?.criticalCount > 0 && (
          <span style={{
            position: "absolute",
            top: -4,
            right: -4,
            width: 16,
            height: 16,
            background: "#f43f5e",
            borderRadius: "50%",
            fontSize: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            color: "#fff",
          }}>
            {alertData.meta.criticalCount}
          </span>
        )}
      </button>

      {/* Floating Chat Window */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 84,
            right: 24,
            width: 400,
            height: 560,
            maxHeight: "calc(100vh - 110px)",
            zIndex: 9999,
            background: "#0f172a",
            border: "1px solid rgba(139, 92, 246, 0.3)",
            borderRadius: 16,
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(139, 92, 246, 0.12)",
              borderBottom: "1px solid rgba(139, 92, 246, 0.2)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: "rgba(139, 92, 246, 0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
              }}>
                🙇‍♂️
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>Tiểu Đệ SD3</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {alertData?.meta
                    ? `${alertData.meta.criticalCount} nguy hiểm · ${alertData.meta.warningCount} cảnh báo · ${alertData.meta.goodCount} tốt`
                    : "Đang scan hệ thống..."}
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <button style={tabStyle("chat")} onClick={() => setActiveTab("chat")}>
              💬 Chat
            </button>
            <button style={tabStyle("compare")} onClick={() => setActiveTab("compare")}>
              📈 So sánh tháng
            </button>
          </div>

          {activeTab === "chat" && (
            <>
              {/* Alert banner */}
              {alertData && alertData.alerts.length > 0 && (
                <AlertBanner
                  alerts={alertData.alerts}
                  recommendations={alertData.recommendations}
                  onAction={(msg) => {
                    setActiveTab("chat");
                    handleSend(msg);
                  }}
                />
              )}

              {/* Chat Messages */}
              <div style={{ flex: 1, padding: 14, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                      maxWidth: "88%",
                      background:
                        m.sender === "user"
                          ? "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)"
                          : "rgba(255, 255, 255, 0.05)",
                      border: m.sender === "user" ? "none" : "1px solid rgba(255, 255, 255, 0.1)",
                      color: "var(--text-primary)",
                      padding: "10px 14px",
                      borderRadius: m.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                      fontSize: 12.5,
                      lineHeight: 1.6,
                    }}
                  >
                    {m.sender === "ai" ? (
                      <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                    ) : (
                      m.text
                    )}
                  </div>
                ))}

                {loading && (
                  <div style={{
                    alignSelf: "flex-start",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#a78bfa",
                    padding: "10px 14px",
                    borderRadius: "14px 14px 14px 2px",
                    fontSize: 12,
                    fontStyle: "italic",
                  }}>
                    ⏳ Đang truy vấn dữ liệu...
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Suggestions */}
              {messages.length < 3 && (
                <div style={{ padding: "0 12px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
                  {[
                    "Doanh thu tháng này ra sao?",
                    "Dự án nào đang nguy hiểm nhất?",
                    "So sánh tháng trước và tháng này",
                  ].map((sq, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(sq)}
                      style={{
                        textAlign: "left",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 8,
                        padding: "5px 10px",
                        color: "#a78bfa",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      💡 {sq}
                    </button>
                  ))}
                </div>
              )}

              {/* Input Bar */}
              <div style={{
                padding: 12,
                background: "rgba(0,0,0,0.3)",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                gap: 8,
              }}>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Nhập câu hỏi vận hành..."
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "#fff",
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={loading || !input.trim()}
                  style={{
                    background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: loading || !input.trim() ? "default" : "pointer",
                    opacity: loading || !input.trim() ? 0.5 : 1,
                  }}
                >
                  Gửi
                </button>
              </div>
            </>
          )}

          {activeTab === "compare" && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {alertData?.comparisons ? (
                <ComparisonPanel
                  comparisons={alertData.comparisons}
                  meta={alertData.meta}
                />
              ) : (
                <div style={{ padding: 20, color: "rgba(255,255,255,0.4)", fontSize: 12, textAlign: "center" }}>
                  ⏳ Đang tải dữ liệu so sánh...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
