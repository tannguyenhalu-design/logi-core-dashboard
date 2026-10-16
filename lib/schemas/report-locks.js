export default {
  name: "report-locks",
  description: "Locked (chốt số) biweekly report blobs (report-locks/{period}.json)",
  uniqueKey: "period",
  timestamp: "lockedAt",
  source: "Dashboard /api/report/biweekly POST (manager/sd3)",
  owner: "SD3 Manager",
  required: ["period", "lockedBy"],
  optional: ["lockedAt", "data", "note"],
  types: {
    period: "string",
    lockedBy: "string",
    lockedAt: "datetime",
  },
  enums: {},
};
