/**
 * lib/data-layer/analytics-layer.js — Analytics Data Layer
 *
 * Tầng phân tích: lưu trữ chuỗi thời gian (time-series) phục vụ
 * Anomaly Detection và Trend Forecasting.
 *
 * Current: in-memory buffer (resets on Vercel cold start, tối đa 1000 điểm/metric).
 * Future: PostgreSQL/Supabase time-series với TimescaleDB extension.
 *
 * Các thuật toán hiện dùng time-series từ snapshot trực tiếp (không qua layer này).
 * Layer này là điểm migration khi cần lưu trữ lịch sử cross-deployment.
 */

// ─── In-memory time-series buffer ─────────────────────────────────────────────
const BUFFER_MAX = 1000; // điểm tối đa mỗi metric (FIFO)
const _buffer = new Map(); // metric → [{ value, timestamp, meta }]

/**
 * Ghi một điểm dữ liệu time-series.
 * @param {string} name  Tên metric, ví dụ "damage_rate.HCM", "ontime.GTC", "comp_cost.LG"
 * @param {number} value Giá trị
 * @param {object} [meta] Metadata tùy ý (project, province, v.v.)
 */
export function recordMetric(name, value, meta = {}) {
  const timestamp = new Date().toISOString();
  const series = _buffer.get(name) || [];
  series.push({ value, timestamp, meta });
  if (series.length > BUFFER_MAX) series.shift(); // evict oldest
  _buffer.set(name, series);
  return { name, value, timestamp };
}

/**
 * Truy vấn time-series trong khoảng [from, to] (ISO strings).
 * Nếu không truyền from/to → trả toàn bộ buffer.
 */
export function queryMetric(name, from, to) {
  const series = _buffer.get(name) || [];
  if (!from && !to) return [...series];
  return series.filter((p) => {
    if (from && p.timestamp < from) return false;
    if (to && p.timestamp > to) return false;
    return true;
  });
}

/** Lấy điểm mới nhất của một metric. */
export function getLatestMetric(name) {
  const series = _buffer.get(name);
  return series && series.length > 0 ? series[series.length - 1] : null;
}

/** Danh sách tất cả metric đang có trong buffer. */
export function listMetrics() {
  return [..._buffer.keys()];
}

/** Xóa toàn bộ buffer (dùng trong tests). */
export function clearMetrics() {
  _buffer.clear();
}

/** Số điểm hiện có trong buffer (để monitoring). */
export function getBufferStats() {
  let total = 0;
  const metrics = {};
  for (const [name, series] of _buffer.entries()) {
    metrics[name] = series.length;
    total += series.length;
  }
  return { total, metricCount: _buffer.size, metrics };
}

// ─── Anomaly history ───────────────────────────────────────────────────────────
// Lưu lịch sử anomalies đã phát hiện (in-memory; future: PostgreSQL).
const _anomalyHistory = [];
const ANOMALY_HISTORY_MAX = 500;

/**
 * Ghi 1 anomaly vào lịch sử sau khi detectDailyAnomalies() phát hiện.
 * @param {object} anomaly Anomaly object từ anomaly-detector.js
 */
export function recordAnomaly(anomaly) {
  _anomalyHistory.push({ ...anomaly, recordedAt: new Date().toISOString() });
  if (_anomalyHistory.length > ANOMALY_HISTORY_MAX) _anomalyHistory.shift();
}

/** Trả về lịch sử anomalies, mới nhất trước. */
export function getAnomalyHistory(limit = 50) {
  return [..._anomalyHistory].reverse().slice(0, limit);
}

// ─── Storage config ────────────────────────────────────────────────────────────
export const ANALYTICS_STORAGE = {
  current: "in-memory (Vercel serverless instance)",
  limitation: "Mất dữ liệu khi cold start; không share giữa các instances",
  future: "PostgreSQL + TimescaleDB (khi có SUPABASE_URL)",
  metrics: [
    "damage_rate.<province>",
    "ontime_rate.<project>",
    "comp_cost.<project>",
    "snapshot.build_duration_ms",
    "ai_chat.latency_ms",
  ],
};
