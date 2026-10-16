export default {
  name: "ActionSolutions",
  description: "Improvement solution records (Google Sheet tab)",
  uniqueKey: "id",
  timestamp: "base_start",
  source: "Dashboard /api/trials (manager/sd3)",
  owner: "SD3 Manager",
  required: ["id", "name", "status"],
  optional: [
    "clients", "base_start", "base_end", "description", "problem", "action",
    "primary_metric", "primary_target", "secondary_metrics", "guardrails",
    "owner", "review_date", "metric_note",
  ],
  types: {
    id: "string",
    name: "string",
    base_start: "date",
    base_end: "date",
    review_date: "date",
    primary_target: "number",
  },
  enums: {
    status: ["active", "draft", "completed", "paused", "archived"],
  },
};
