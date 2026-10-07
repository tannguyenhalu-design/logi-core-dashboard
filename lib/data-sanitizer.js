/**
 * lib/data-sanitizer.js — PII masking trước khi gửi dữ liệu sang AI (Groq/Gemini).
 * Tuân thủ Quy tắc An toàn AI GHN: customer_name / phone / address không được
 * xuất hiện trong prompt gửi đi.
 *
 * Hai hàm chính:
 *   sanitizeForAI(text)      — quét string, mask SĐT + email
 *   sanitizeObjectForAI(obj) — đệ quy object/array, ẩn các trường PII theo tên
 */

// ─── Phone numbers (Vietnam format) ───────────────────────────────────────────
// Matches: 0xxxxxxxxx, +84xxxxxxxxx, 84xxxxxxxxx (with optional separators)
const PHONE_RE = /(?:\+84|84|0)([0-9]{1,2})[-.\s]?([0-9]{3,4})[-.\s]?([0-9]{3,4})/g;

function maskPhone(match) {
  const digits = match.replace(/\D/g, "");
  // Normalize: strip country code prefix
  const local = digits.startsWith("84") ? "0" + digits.slice(2) : digits;
  if (local.length < 8) return "0**" + "****" + "***";
  // Keep first 3 digits, mask middle, keep last 3
  return `${local.slice(0, 3)}****${local.slice(-3)}`;
}

// ─── Email addresses ───────────────────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// ─── PII field names to suppress in objects ────────────────────────────────────
const PII_KEYS = new Set([
  "customer_name", "receiver_name", "sender_name", "recipient_name", "consignee_name",
  "phone", "phone_number", "mobile", "mobile_phone", "tel", "telephone",
  "customer_phone", "receiver_phone", "sender_phone", "contact_phone",
  "address", "detail_address", "full_address", "shipping_address", "street_address",
  "customer_address", "receiver_address",
  "email", "customer_email", "receiver_email", "contact_email",
  "cmnd", "cccd", "national_id", "id_card", "id_number",
]);

/**
 * Mask PII in a plain string.
 * - SĐT  → 090****123
 * - Email → [email ẩn]
 */
export function sanitizeForAI(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(PHONE_RE, (m) => maskPhone(m))
    .replace(EMAIL_RE, "[email ẩn]");
}

/**
 * Deep-mask PII in an object or array.
 * - Fields in PII_KEYS → value replaced with "[ẩn]"
 * - String values → sanitizeForAI() (catches phones/emails in freetext)
 * - Objects/arrays → recurse
 * - Primitives other than string → pass through unchanged
 */
export function sanitizeObjectForAI(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") return sanitizeForAI(data);
  if (Array.isArray(data)) return data.map(sanitizeObjectForAI);
  if (typeof data === "object") {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[ẩn]" : sanitizeObjectForAI(v);
    }
    return out;
  }
  return data; // number / boolean / symbol
}
