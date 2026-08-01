/**
 * components/TruckLoader.js
 * Brand loading indicator — a truck driving forward across the track,
 * in the GHN teal/dark palette, shown wherever the dashboard is fetching data.
 */
export default function TruckLoader({ size = 64, label }) {
  const trackWidth = Math.max(size * 2.6, 170);
  const trackHeight = size * 0.75;

  return (
    <div className="truck-loader" style={{ width: trackWidth, margin: label ? "24px auto" : "40px auto" }}>
      <div className="truck-track" style={{ width: trackWidth, height: trackHeight }}>
        <div className="truck-road" />
        <div className="truck-driving" style={{ width: size, height: size * 0.625 }}>
          <svg
            viewBox="0 0 64 40"
            width={size}
            height={size * 0.625}
            className="truck-loader-svg"
            style={{ overflow: "visible", display: "block" }}
          >
            <g className="truck-motion-lines" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="13" x2="10" y2="13" />
              <line x1="0" y1="20" x2="12" y2="20" />
              <line x1="2" y1="27" x2="9" y2="27" />
            </g>

            <g className="truck-body">
              {/* trailer box */}
              <rect x="14" y="7" width="27" height="21" rx="2" fill="rgba(20,224,196,0.08)" stroke="var(--cyan)" strokeWidth="2" />
              {/* cab */}
              <path d="M41 15 h7 l6 7 v6 h-13 z" fill="rgba(20,224,196,0.15)" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" />
              {/* window */}
              <path d="M44.5 17 h3.5 l3 4.5 h-6.5 z" fill="var(--cyan)" opacity="0.4" />
              {/* wheels */}
              <circle cx="21" cy="29" r="3.5" fill="#0b0f19" stroke="var(--cyan)" strokeWidth="2" />
              <circle cx="49" cy="29" r="3.5" fill="#0b0f19" stroke="var(--cyan)" strokeWidth="2" />
              {/* headlight */}
              <circle cx="55.5" cy="21" r="1.6" fill="var(--cyan)" className="truck-headlight" />
            </g>
          </svg>
        </div>
      </div>
      {label && (
        <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
          {label}
        </div>
      )}
    </div>
  );
}
