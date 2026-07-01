/**
 * pages/login.js — Login page with glassmorphism dark UI
 */
import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Validate @ghn.vn domain
    if (!email.toLowerCase().endsWith("@ghn.vn")) {
      setError("Chỉ chấp nhận email có đuôi @ghn.vn");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email.toLowerCase().trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Đăng nhập thất bại");
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Lỗi kết nối. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Đăng nhập — Logistics Dashboard</title>
      </Head>
      <div className="login-page">
        <div className="login-card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "rgba(59,130,246,0.15)", display: "flex",
              alignItems: "center", justifyContent: "center"
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <h1>LogiCore Dashboard</h1>
              <p style={{ margin: 0 }}>Hệ thống theo dõi vận hành</p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email GHN</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ten@ghn.vn"
                autoComplete="email"
                required
              />
            </div>
            <div className="form-group">
              <label>Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                autoComplete="current-password"
                required
              />
            </div>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}
            </button>
            {error && <p className="error-msg">{error}</p>}
          </form>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps({ req, res }) {
  const { getSession } = await import("../lib/auth");
  const session = await getSession(req, res);
  if (session?.user) {
    return { redirect: { destination: "/dashboard", permanent: false } };
  }
  return { props: {} };
}
