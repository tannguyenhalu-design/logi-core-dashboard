import { useState, useRef, useEffect } from "react";

export default function AIChatDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: "ai",
      text: "Dạ, Đầy tớ xin kính chào Chủ nhân! 🙇‍♂️ Hôm nay Chủ nhân muốn Đầy tớ soi số liệu vận hành, báo cáo dự án hay sai bảo việc gì ạ?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

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
          { sender: "ai", text: "⚠️ " + (json.error || "Có lỗi xảy ra khi truy vấn dữ liệu.") },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: "⚠️ Không thể kết nối với máy chủ AI. Vui lòng thử lại." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const sampleQuestions = [
    "Khu vực Hồ Chí Minh hiện tại đang giao bao nhiêu đơn điện máy 1 ngày?",
    "Tổng sản lượng vận chuyển tháng này là bao nhiêu tấn?",
    "Tỷ lệ giao hàng đúng giờ (Ontime) hệ thống hiện đạt bao nhiêu %?",
  ];

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
          transition: "transform 0.2s ease, boxShadow 0.2s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <span>🙇‍♂️</span>
        <span>{isOpen ? "Đóng Đầy Tớ" : "Gọi Đầy Tớ"}</span>
      </button>

      {/* Floating Chat Window */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 84,
            right: 24,
            width: 380,
            height: 520,
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
              padding: "14px 18px",
              background: "rgba(139, 92, 246, 0.12)",
              borderBottom: "1px solid rgba(139, 92, 246, 0.2)",
              display: "flex",
              justify: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "rgba(139, 92, 246, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                }}
              >
                🙇‍♂️
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#EAF0F8" }}>
                  Đầy Tớ LogiCore
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Sẵn sàng phục vụ Chủ nhân 24/7
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          {/* Chat Messages */}
          <div
            style={{
              flex: 1,
              padding: 16,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background:
                    m.sender === "user"
                      ? "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)"
                      : "rgba(255, 255, 255, 0.05)",
                  border:
                    m.sender === "user"
                      ? "none"
                      : "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#EAF0F8",
                  padding: "10px 14px",
                  borderRadius: m.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                {m.text}
              </div>
            ))}

            {loading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#a78bfa",
                  padding: "10px 14px",
                  borderRadius: "14px 14px 14px 2px",
                  fontSize: 12,
                  fontStyle: "italic",
                }}
              >
                ⏳ Đang truy vấn dữ liệu...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions */}
          {messages.length < 3 && (
            <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
              {sampleQuestions.map((sq, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(sq)}
                  style={{
                    textAlign: "left",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    color: "#a78bfa",
                    fontSize: 11,
                    cursor: "pointer",
                    transition: "background 0.2s",
                  }}
                >
                  💡 {sq}
                </button>
              ))}
            </div>
          )}

          {/* Input Bar */}
          <div
            style={{
              padding: 12,
              background: "rgba(0, 0, 0, 0.3)",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              gap: 8,
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Nhập câu hỏi vận hành..."
              style={{
                flex: 1,
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
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
        </div>
      )}
    </>
  );
}
