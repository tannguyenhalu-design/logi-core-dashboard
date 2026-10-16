export default {
  name: "ActionTrials",
  description: "Trial phases under improvement solutions (Google Sheet tab)",
  uniqueKey: "id",
  timestamp: "start_date",
  source: "Dashboard /api/trials (manager/sd3)",
  owner: "SD3 Manager",
  required: ["id", "name", "status"],
  optional: [
    "clients", "kho_lay", "kho_giao", "to_province", "solution_id",
    "start_date", "end_date", "live_date", "description", "images",
    "phase_no", "phase_label", "control_mode",
  ],
  types: {
    id: "string",
    name: "string",
    phase_no: "number",
    start_date: "date",
    end_date: "date",
    live_date: "date",
  },
  enums: {
    status: ["active", "draft", "completed", "paused", "archived"],
    control_mode: ["ab_test", "before_after", "manual"],
    // Phase 5 — 8-state experiment lifecycle (experiment_status column)
    experiment_status: [
      "DRAFT", "APPROVED", "RUNNING", "MEASURING", "COMPLETED",
      "CONFIRMED", "REJECTED", "INCONCLUSIVE",
      // Legacy states kept for backward compatibility
      "PROPOSED", "ANALYZING",
    ],
  },
};
