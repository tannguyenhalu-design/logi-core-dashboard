/**
 * lib/data-layer/index.js — Data Layer public API
 *
 * Ba tầng dữ liệu của SD3 Control Tower:
 *
 *   Raw Layer        → thu thập dữ liệu thô từ Google Sheets / Scraper
 *   Operational Layer → transform + lưu vào Vercel Blob (Snapshot)
 *   Analytics Layer  → time-series buffer + anomaly history
 *
 * Import từ đây thay vì import trực tiếp từng file để dễ refactor sau này.
 */

export * as raw        from "./raw-layer";
export * as operational from "./operational-layer";
export * as analytics  from "./analytics-layer";
