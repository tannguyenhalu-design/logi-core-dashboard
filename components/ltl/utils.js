export function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("vi-VN", { maximumFractionDigits: decimals });
}

export function fmtWeight(kg) {
  if (!kg || kg <= 0) return "0 kg";
  if (kg >= 1000) {
    const ton = (kg / 1000).toFixed(1).replace(".0", "");
    return `${kg.toLocaleString("vi-VN")} kg (${ton} tấn)`;
  }
  return `${kg.toLocaleString("vi-VN")} kg`;
}

export function getOntimeColor(pct) {
  if (pct === null || pct === undefined) return "var(--green)";
  if (pct >= 90) return "var(--green)";
  if (pct >= 80) return "var(--amber)";
  return "var(--red)";
}

export function getOntimeBadge(pct) {
  if (pct >= 90) return { label: "Tốt (≥90%)", color: "var(--green)", bg: "rgba(16,185,129,0.15)" };
  if (pct >= 80) return { label: "⚠️ Trung bình (80-90%)", color: "var(--amber)", bg: "rgba(245,158,11,0.15)" };
  return { label: "🚨 CẢNH BÁO LOW (<80%)", color: "var(--red)", bg: "rgba(244,63,94,0.18)" };
}
