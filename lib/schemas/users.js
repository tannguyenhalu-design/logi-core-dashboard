export default {
  name: "Users",
  description: "Dashboard user accounts (Google Sheet tab)",
  uniqueKey: "Email",
  timestamp: "CreatedAt",
  source: "Dashboard /api/admin-users (manager only)",
  owner: "SD3 Manager",
  required: ["Email", "Role"],
  optional: ["Name", "EmployeeId", "Project", "PIC Name", "Tabs", "CreatedAt", "UpdatedAt", "UpdatedBy", "PasswordHash", "Salt"],
  types: {
    Email: "string",
    Role: "string",
    CreatedAt: "datetime",
    UpdatedAt: "datetime",
  },
  enums: {
    Role: ["manager", "sd3", "cs", "client", "pending"],
  },
};
