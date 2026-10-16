export default {
  name: "health/scraper-status",
  description: "Scraper heartbeat history stored in Vercel Blob",
  uniqueKey: null,
  timestamp: "updatedAt",
  source: "cloud-scraper via /api/scraper-heartbeat",
  owner: "System (auto-written by scraper)",
  required: ["updatedAt"],
  optional: ["steps", "history"],
  types: {
    updatedAt: "datetime",
    steps: "object",
    history: "array",
  },
  enums: {
    "steps.*.last.status": ["ok", "error", "session_expired", "not_run"],
  },
};
