/**
 * pages/_app.js — Load global CSS
 */
import React from "react";
import "../styles/globals.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, fontFamily: "sans-serif", color: "white", background: "#111", minHeight: "100vh" }}>
          <h1 style={{ color: "#ef4444" }}>Đã xảy ra lỗi giao diện (Client Error)</h1>
          <p>Vui lòng chụp màn hình này và gửi cho AI để sửa lỗi:</p>
          <div style={{ background: "#222", padding: 20, borderRadius: 8, marginTop: 20, overflow: "auto" }}>
            <h3 style={{ color: "#fca5a5" }}>{this.state.error && this.state.error.toString()}</h3>
            <pre style={{ color: "#9ca3af", fontSize: 13, marginTop: 10 }}>
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </div>
          <button 
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: "10px 20px", background: "#06b6d4", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            Tải lại trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App({ Component, pageProps }) {
  return (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );
}
