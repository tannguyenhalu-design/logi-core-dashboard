export default {
  name: "AuditLog",
  description: "Append-only audit trail (Google Sheet tab)",
  uniqueKey: null,
  timestamp: "Timestamp",
  source: "lib/audit-log.js (called from admin-users, ai-memory)",
  owner: "System (append-only)",
  required: ["Timestamp", "Actor", "Action"],
  optional: ["Target", "Details"],
  types: {
    Timestamp: "datetime",
    Actor: "string",
    Action: "string",
    Target: "string",
  },
  enums: {},
};
