export { default as rawOntimeSchema } from "./raw-ontime.js";
export { default as damageCausesSchema } from "./damage-causes.js";
export { default as damageCsTickSchema } from "./damage-cs-tick.js";
export { default as projectMappingSchema } from "./project-mapping.js";
export { default as aiBrainSchema } from "./ai-brain.js";
export { default as actionTrialsSchema } from "./action-trials.js";
export { default as solutionsSchema } from "./solutions.js";
export { default as usersSchema } from "./users.js";
export { default as auditLogSchema } from "./audit-log.js";
export { default as sopKnowledgeSchema } from "./sop-knowledge.js";
export { default as healthStatusSchema } from "./health-status.js";
export { default as reportLocksSchema } from "./report-locks.js";

import rawOntimeSchema from "./raw-ontime.js";
import damageCausesSchema from "./damage-causes.js";
import damageCsTickSchema from "./damage-cs-tick.js";
import projectMappingSchema from "./project-mapping.js";
import aiBrainSchema from "./ai-brain.js";
import actionTrialsSchema from "./action-trials.js";
import solutionsSchema from "./solutions.js";
import usersSchema from "./users.js";
import auditLogSchema from "./audit-log.js";
import sopKnowledgeSchema from "./sop-knowledge.js";
import healthStatusSchema from "./health-status.js";
import reportLocksSchema from "./report-locks.js";

export const SCHEMA_MAP = {
  raw_ontime: rawOntimeSchema,
  raw_damage_causes: damageCausesSchema,
  raw_damage_cs_tick: damageCsTickSchema,
  mapping: projectMappingSchema,
  AI_Brain: aiBrainSchema,
  ActionTrials: actionTrialsSchema,
  ActionSolutions: solutionsSchema,
  Users: usersSchema,
  AuditLog: auditLogSchema,
  "sops-knowledge": sopKnowledgeSchema,
  "health/scraper-status": healthStatusSchema,
  "report-locks": reportLocksSchema,
};

export const ALL_SCHEMA_NAMES = Object.keys(SCHEMA_MAP);
