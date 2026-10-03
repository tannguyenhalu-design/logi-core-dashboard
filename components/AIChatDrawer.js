import { useState, useRef, useEffect } from "react";

// ─── Helpers ───────────────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code style='background:rgba(139,92,246,0.2);padding:1px 5px;border-radius:4px;font-size:11px'>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul style='margin:6px 0;padding-left:16px'>$1</ul>")
    .replace(/\n/g, "<br/>");
}

const SS_KEY = "td_chat_v2";
function loadFromSession() {
  try { const d = sessionStorage.getItem(SS_KEY); return d ? JSON.parse(d) : null; } catch { return null; }
}
function saveToSession(msgs) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(msgs.slice(-30))); } catch { /* quota */ }
}

const INIT_MSG = { sender: "ai", text: "Dạ, Tiểu Đệ SD3 xin bái chào Đại Ca! 🙇‍♂️ Đại Ca muốn hỏi gì về vận hành LTL ạ?", ts: null };

// ─── Source chip ───────────────────────────────────────────────────────────────
function SourceChip({ s }) {
  const stale = s.stale;
  return (
    <span title={[s.scope, s.dataAt ? `Dữ liệu: ${s.dataAt}` : ""].filter(Boolean).join(" · ")} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: stale ? "rgba(251,191,36,0.12)" : "rgba(99,102,241,0.12)",
      border: `1px solid ${stale ? "rgba(251,191,36,0.3)" : "rgba(99,102,241,0.3)"}`,
      borderRadius: 5, padding: "2px 7px", fontSize: 10, color: stale ? "#fbbf24" : "#a5b4fc",
      cursor: "default", whiteSpace: "nowrap",
    }}>
      {stale ? "⚠" : "📌"} {s.name}
    </span>
  );
}

// ─── Steps accordion ──────────────────────────────────────────────────────────
function StepsPanel({ steps }) {
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        background: "none", border: "none", color: "#6366f1", fontSize: 10.5, cursor: "pointer", padding: 0, fontWeight: 600,
      }}>
        {open ? "▾" : "▸"} Các bước Tiểu Đệ đã làm ({steps.length})
      </button>
      {open && (
        <ol style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AIChatDrawer({ role }) {
  const isManager = role === "manager";
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => loadFromSession() || [INIT_MSG]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(null); // msgIndex being approved
  const messagesEndRef = useRef(null);
  const prevContextRef = useRef(null); // ngữ cảnh từ câu trả lời trước

  // Restore from sessionStorage on open
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const addMsg = (m) => setMessages((prev) => {
    const next = [...prev, m];
    saveToSession(next);
    return next;
  });

  const handleSend = async (textToSend) => {
    const q = (textToSend || input).trim();
    if (!q || loading) return;
    if (!textToSend) setInput("");

    const newUser = { sender: "user", text: q };
    setMessages((prev) => { const n = [...prev, newUser]; saveToSession(n); return n; });
    setLoading(true);

    try {
      const history = messages
        .filter((m) => m.sender === "user" || (m.sender === "ai" && !m.isInit))
        .slice(-12)
        .map((m) => ({ role: m.sender === "user" ? "user" : "model", text: m.text }));

      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history, context: prevContextRef.current }),
      });
      const json = await res.json();

      if (json.ok) {
        prevContextRef.current = json.context || null;
        const aiMsg = {
          sender: "ai",
          text: json.reply,
          sources: json.sources || [],
          steps: json.steps || [],
          canApprove: json.canApprove && isManager,
          questionText: q,
          timing: json.timing,
        };
        setMessages((prev) => { const n = [...prev, aiMsg]; saveToSession(n); return n; });
      } else {
        addMsg({ sender: "ai", text: "⚠️ " + (json.error || "Có lỗi xảy ra.") });
      }
    } catch {
      addMsg({ sender: "ai", text: "⚠️ Không thể kết nối máy chủ AI." });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (msgIndex) => {
    const msg = messages[msgIndex];
    if (!msg?.canApprove || approving === msgIndex) return;
    setApproving(msgIndex);
    try {
      const res = await fetch("/api/ai-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approveReply: true, reply: msg.text, message: msg.questionText || "" }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessages((prev) => {
          const next = prev.map((m, i) => i === msgIndex ? { ...m, approved: true, canApprove: false } : m);
          saveToSession(next);
          return next;
        });
      }
    } catch { /* silent */ }
    finally { setApproving(null); }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
          color: "#fff", border: "none", borderRadius: 30, padding: "12px 20px",
          fontWeight: 700, fontSize: 13.5, cursor: "pointer",
          boxShadow: "0 8px 24px rgba(139,92,246,0.4)",
          display: "flex", alignItems: "center", gap: 8, transition: "transform 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <span>🙇‍♂️</span>
        <span>{isOpen ? "Đóng Tiểu Đệ" : "Gọi Tiểu Đệ SD3"}</span>
        {messages.length > 1 && !isOpen && (
          <span style={{
            background: "#6366f1", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700,
          }}>
            {messages.filter((m) => m.sender === "user").length}
          </span>
        )}
      </button>

      {/* Chat window */}
      {isOpen && (
        <div style={{
          position: "fixed", bottom: 84, right: 24,
          width: 420, height: 580, maxHeight: "calc(100vh - 110px)", zIndex: 9999,
          background: "#0f172a", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 16,
          boxShadow: "0 20px 40px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "12px 16px", background: "rgba(139,92,246,0.12)",
            borderBottom: "1px solid rgba(139,92,246,0.2)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10, background: "rgba(139,92,246,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
              }}>🙇‍♂️</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>Tiểu Đệ SD3</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Trợ lý vận hành LTL · đa tác tử</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => { setMessages([INIT_MSG]); saveToSession([INIT_MSG]); prevContextRef.current = null; }}
                title="Xoá lịch sử chat"
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}
              >🗑</button>
              <button
                onClick={() => setIsOpen(false)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}
              >✕</button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, padding: 14, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((m, idx) => (
              <div key={idx} style={{ alignSelf: m.sender === "user" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
                <div style={{
                  background: m.sender === "user"
                    ? "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)"
                    : "rgba(255,255,255,0.05)",
                  border: m.sender === "user" ? "none" : "1px solid rgba(255,255,255,0.1)",
                  color: "var(--text-primary)", padding: "10px 14px",
                  borderRadius: m.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                  fontSize: 12.5, lineHeight: 1.6,
                }}>
                  {m.sender === "ai"
                    ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                    : m.text
                  }
                </div>

                {/* Thẻ nguồn + steps + approve — chỉ cho AI messages */}
                {m.sender === "ai" && (m.sources?.length > 0 || m.steps?.length > 0 || m.canApprove || m.approved) && (
                  <div style={{ marginTop: 5, paddingLeft: 4 }}>
                    {m.sources?.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                        {m.sources.map((s, si) => <SourceChip key={si} s={s} />)}
                      </div>
                    )}
                    <StepsPanel steps={m.steps} />
                    {m.canApprove && (
                      <button
                        onClick={() => handleApprove(idx)}
                        disabled={approving === idx}
                        style={{
                          marginTop: 6, background: "rgba(16,185,129,0.15)", color: "#10b981",
                          border: "1px solid rgba(16,185,129,0.35)", borderRadius: 6,
                          padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        {approving === idx ? "Đang duyệt..." : "✓ Duyệt câu trả lời này"}
                      </button>
                    )}
                    {m.approved && (
                      <span style={{ marginTop: 6, display: "inline-block", fontSize: 11, color: "#10b981" }}>
                        ✓ Đã duyệt vào Bộ Não
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{
                alignSelf: "flex-start", background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)", color: "#a78bfa",
                padding: "10px 14px", borderRadius: "14px 14px 14px 2px", fontSize: 12, fontStyle: "italic",
              }}>
                ⏳ Tiểu Đệ đang truy vấn dữ liệu...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick suggestions */}
          {messages.filter((m) => m.sender === "user").length === 0 && (
            <div style={{ padding: "0 12px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
              {[
                "Tỷ lệ on-time tháng này thế nào?",
                "Kho nào đang nhiều ca hư hỏng nhất?",
                "Khách nào đang giảm đơn so tháng trước?",
              ].map((sq, i) => (
                <button key={i} onClick={() => handleSend(sq)} style={{
                  textAlign: "left", background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8,
                  padding: "5px 10px", color: "#a78bfa", fontSize: 11, cursor: "pointer",
                }}>
                  💡 {sq}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: 12, background: "rgba(0,0,0,0.3)",
            borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 8,
          }}>
            <input
              type="text" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleSend()}
              placeholder="Nhập câu hỏi vận hành..."
              style={{
                flex: 1, background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
                padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none",
              }}
            />
            <button
              onClick={() => handleSend()} disabled={loading || !input.trim()}
              style={{
                background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
                color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px",
                fontWeight: 600, fontSize: 12,
                cursor: loading || !input.trim() ? "default" : "pointer",
                opacity: loading || !input.trim() ? 0.5 : 1,
              }}
            >
              Gửi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
