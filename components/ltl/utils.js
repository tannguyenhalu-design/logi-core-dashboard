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
  if (pct >= 90) return { label: "Tốt (≥90%)", color: "var(--green)", bg: "var(--green-glow)" };
  if (pct >= 80) return { label: "⚠️ Trung bình (80-90%)", color: "var(--amber)", bg: "var(--amber-glow)" };
  return { label: "🚨 CẢNH BÁO LOW (<80%)", color: "var(--red)", bg: "var(--red-glow)" };
}
