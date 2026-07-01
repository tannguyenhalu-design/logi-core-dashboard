/**
 * pages/login.js — Google OAuth Login
 */
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Head from "next/head";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const errorParam = router.query.error;

  // Nếu đã đăng nhập → vào dashboard
  useEffect(() => {
    if (status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status, router]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    await signIn("google", { callbackUrl: "/dashboard" });
  };

  const errorMessage =
    errorParam === "AccessDenied"
      ? "Tài khoản này không được phép truy cập. Vui lòng dùng email @ghn.vn."
      : errorParam
      ? "Đăng nhập thất bại. Vui lòng thử lại."
      : null;

  if (status === "loading") return null;

  return (
    <>
      <Head>
        <title>Đăng nhập — LogiCore Dashboard</title>
      </Head>
      <div className="login-page">
        <div className="login-card">
          {/* Logo + Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "rgba(59,130,246,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <h1>LogiCore Dashboard</h1>
              <p style={{ margin: 0 }}>Hệ thống theo dõi vận hành</p>
            </div>
          </div>

          {/* Divider với label */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 6px" }}>
              Đăng nhập bằng tài khoản GHN của bạn
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0, opacity: 0.7 }}>
              Chỉ chấp nhận email <span style={{ color: "var(--blue)", fontWeight: 600 }}>@ghn.vn</span>
            </p>
          </div>

          {/* Error message */}
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

          {/* Google Sign In button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "12px 20px",
              background: loading ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
              color: "#EAF0F8",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              opacity: loading ? 0.7 : 1,
            }}
            onMouseOver={(e) => { if (!loading) e.currentTarget.style.background = "rgba(255,255,255,0.13)"; }}
            onMouseOut={(e)  => { if (!loading) e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
          >
            {/* Google logo SVG */}
            {!loading ? (
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            ) : (
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.3)",
                borderTop: "2px solid #EAF0F8",
                animation: "spin 0.8s linear infinite",
              }} />
            )}
            {loading ? "Đang kết nối..." : "Đăng nhập với Google"}
          </button>

          <p style={{ textAlign: "center", marginTop: 20, fontSize: 11.5, color: "var(--text-muted)", opacity: 0.6 }}>
            Bằng cách đăng nhập, bạn đồng ý với điều khoản sử dụng nội bộ GHN.
          </p>
        </div>
      </div>
    </>
  );
}
