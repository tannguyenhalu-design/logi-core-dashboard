/**
 * pages/login.js — GHN SSO v2 (OpenID Connect) login, plus a TEMPORARY
 * passwordless email fallback (pages/api/auth.js) while GHN SSO
 * client_id/secret aren't set up yet. Remove the fallback form once
 * SSO is live — see lib/users.js resolvePasswordlessUser for context.
 */
import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import ThemeToggle from "../components/ThemeToggle";

export async function getServerSideProps({ query }) {
  return { props: { errorMessage: typeof query.error === "string" ? query.error : null } };
}

export default function LoginPage({ errorMessage: ssoError }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Đăng nhập thất bại. Vui lòng thử lại.");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      setFormError("Lỗi kết nối. Vui lòng thử lại.");
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

          {formError && (
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
              ⚠️ {formError}
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
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}
            </button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Sắp có</span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>

          {ssoError && (
            <div style={{
              background: "rgba(244,63,94,0.1)",
              border: "1px solid var(--red)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 13,
              color: "var(--red)",
              lineHeight: 1.5,
            }}>
              ⚠️ {ssoError}
            </div>
          )}

          <a
            href="/api/auth/sso-login"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "12px 20px",
              background: "var(--input-bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              color: "var(--text-muted)",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "inherit",
              textDecoration: "none",
              boxSizing: "border-box",
            }}
          >
            Đăng nhập bằng GHN SSO
          </a>

          <p style={{ textAlign: "center", marginTop: 20, fontSize: 11.5, color: "var(--text-muted)", opacity: 0.6 }}>
            Bằng cách đăng nhập, bạn đồng ý với điều khoản sử dụng nội bộ GHN.
          </p>
        </div>
        </div>
      </div>
    </>
  );
}
