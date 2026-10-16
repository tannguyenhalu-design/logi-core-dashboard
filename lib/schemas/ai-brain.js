export default {
  name: "AI_Brain",
  description: "AI-generated insights awaiting manager approval (Google Sheet, max 2000 rows)",
  uniqueKey: null,
  timestamp: "Timestamp",
  source: "AI agents via /api/ai-memory",
  owner: "SD3 Manager (approval gate)",
  required: ["Timestamp", "Type", "Topic", "Insight", "Status"],
  optional: ["Confidence", "Source", "VerifiedBy", "VerifiedAt", "DateLabel"],
  types: {
    Timestamp: "datetime",
    Topic: "string",
    Insight: "string",
    Confidence: "number",
    VerifiedAt: "datetime",
  },
  enums: {
    Type: ["insight", "anomaly", "recommendation"],
    Status: ["Đề xuất", "Đã duyệt", "Bỏ"],
    Source: ["ai-agent", "manual"],
  },
  invariant: "Only Status='Đã duyệt' entries are injected into AI context",
};
