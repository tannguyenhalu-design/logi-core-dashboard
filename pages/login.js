/**
 * pages/login.js — Username/Password Login
 */
import { useRouter } from "next/router";
import { useState } from "react";
import Head from "next/head";
import ThemeToggle from "../components/ThemeToggle";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Đăng nhập thất bại. Vui lòng thử lại.");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      setErrorMessage("Lỗi kết nối. Vui lòng thử lại.");
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Đăng nhập — SD3-Điện Máy</title>
      </Head>
      <div className="login-page">
        <div className="login-hero">
          <div className="login-hero-content">
            <div className="tagline">Your loads. Our roads.</div>
            <h2>Giao Hàng Nặng<br />Kênh Bán Lẻ Toàn Quốc</h2>
          </div>
        </div>
        <div className="login-form-panel">
        <div className="login-card" style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: 16, right: 16, width: "auto" }}>
            <ThemeToggle style={{ width: "auto", padding: "6px 10px" }} />
          </div>
          {/* Logo + Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "var(--cyan-glow)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <h1>SD3-Điện Máy</h1>
              <p style={{ margin: 0 }}>Hệ thống theo dõi vận hành</p>
            </div>
          </div>

          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              Đăng nhập bằng tài khoản nội bộ @ghn.vn
            </p>
          </div>

          {errorMessage && (
            <div style={{
              background: "rgba(244,63,94,0.1)",
              border: "1px solid var(--red)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 18,
              fontSize: 13,
              color: "var(--red)",
              lineHeight: 1.5,
            }}>
              ⚠️ {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Email @ghn.vn"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              style={{
                width: "100%",
                padding: "12px 14px",
                marginBottom: 12,
                background: "var(--input-bg)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            <input
              type="password"
              placeholder="Mật khẩu"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: "100%",
                padding: "12px 14px",
                marginBottom: 18,
                background: "var(--input-bg)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: "12px 20px",
                background: "var(--cyan)",
                border: "1px solid var(--cyan)",
                borderRadius: 10,
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? (
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTop: "2px solid #fff",
                  animation: "spin 0.8s linear infinite",
                }} />
              ) : "Đăng nhập"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: 20, fontSize: 11.5, color: "var(--text-muted)", opacity: 0.6 }}>
            Bằng cách đăng nhập, bạn đồng ý với điều khoản sử dụng nội bộ GHN.
          </p>
        </div>
        </div>
      </div>
    </>
  );
}
