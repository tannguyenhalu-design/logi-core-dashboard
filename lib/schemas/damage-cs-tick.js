export default {
  name: "raw_damage_cs_tick",
  description: "CS-confirmed damage ticks from Rillnet (rillnet_scraper.py --cs)",
  uniqueKey: "order_code",
  timestamp: "synced_at",
  source: "Rillnet CS module via cloud-scraper",
  owner: "SD3 Operations",
  required: ["order_code"],
  optional: ["tick_date", "cs_name", "comp_amount", "synced_at", "counted"],
  types: {
    order_code: "string",
    tick_date: "datetime",
    synced_at: "datetime",
    comp_amount: "number",
    counted: "boolean",
  },
  enums: {},
  knownIssue: "Missing 489 historical cases before 2026-10-04 (pre-Phase1)",
};
