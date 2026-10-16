export default {
  name: "sops-knowledge",
  description: "SOP knowledge-base entries stored in Vercel Blob (sops-knowledge.json)",
  uniqueKey: "id",
  timestamp: null,
  source: "Dashboard /api/sops-knowledge (manager/sd3)",
  owner: "SD3 Manager",
  required: ["id", "title"],
  optional: ["content", "tags", "customSteps", "clientId", "updatedAt"],
  types: {
    id: "string",
    title: "string",
    content: "string",
    tags: "array",
    customSteps: "array",
    updatedAt: "datetime",
  },
  enums: {},
};
