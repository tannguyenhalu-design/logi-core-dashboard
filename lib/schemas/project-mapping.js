export default {
  name: "mapping",
  description: "Client-name → project/PIC/industry mapping (manual Google Sheet tab)",
  uniqueKey: "client_name",
  timestamp: null,
  source: "Google Sheet tab 'mapping' (manual)",
  owner: "SD3 Manager",
  required: ["client_name"],
  optional: ["project_code", "pic_name", "industry"],
  types: {
    client_name: "string",
    project_code: "string",
    pic_name: "string",
    industry: "string",
  },
  enums: {
    industry: ["DM", "STTP", "NHC", "ECOM"],
  },
};
