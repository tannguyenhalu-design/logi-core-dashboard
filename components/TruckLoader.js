/**
 * components/TruckLoader.js
 * Brand loading indicator — Full-size GHN truck blueprint illustration + animated progress bar.
 */
export default function TruckLoader({ size = 64, label = "Đang đồng bộ dữ liệu vận hành SD3..." }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px 28px",
        margin: "24px auto",
        width: "100%",
        maxWidth: 920,
        background: "var(--panel-bg-strong)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Brand Loader Illustration — FULL SIZE */}
      <div style={{ position: "relative", marginBottom: 20, width: "100%", display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden", borderRadius: 12 }}>
        <img
          src="/loading_brand.png"
          alt="SD3 Loading..."
          style={{
            width: "100%",
            maxHeight: 480,
            objectFit: "contain",
            borderRadius: 12,
            filter: "brightness(1.02) contrast(1.05)",
          }}
          onError={(e) => {
            e.target.style.display = "none";
          }}
        />
      </div>

      {/* Animated Glowing Road & Loader */}
      <div style={{ width: "60%", maxWidth: 360, position: "relative", margin: "8px 0 16px" }}>
        <div style={{ width: "100%", height: 4, background: "var(--border)", position: "relative", overflow: "hidden", borderRadius: 4 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: "45%",
              background: "linear-gradient(90deg, transparent, var(--cyan), transparent)",
              animation: "truck-road-anim 1.2s infinite linear",
            }}
          />
        </div>
      </div>

      {/* Animated Label Text */}
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", textAlign: "center", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "var(--cyan)", animation: "blink-dot 1.2s infinite" }} />
        {label}
      </div>

      <style jsx>{`
        @keyframes truck-road-anim {
          0% { left: -45%; }
          100% { left: 100%; }
        }
        @keyframes blink-dot {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
