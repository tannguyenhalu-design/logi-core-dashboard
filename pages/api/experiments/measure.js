import { getSession } from "../../../lib/auth";
import { readTrials } from "../../../lib/trials.js";
import { loadLtlBase } from "../../../lib/ltl-snapshot";
import { measureExperiment } from "../../../lib/experiment-measurer.js";

const ALLOWED_ROLES = ["manager", "sd3"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { trial_id, today } = req.body || {};
  if (!trial_id) return res.status(400).json({ error: "trial_id required" });

  const todayStr = today || new Date().toISOString().slice(0, 10);

  const [trialsData, base] = await Promise.all([readTrials(), loadLtlBase()]);

  // Search in solutions and phases
  let trial = null;
  for (const sol of trialsData) {
    if (sol.id === trial_id) { trial = sol; break; }
    if (Array.isArray(sol.phases)) {
      const ph = sol.phases.find((p) => p.id === trial_id);
      if (ph) { trial = { ...sol, ...ph, id: trial_id }; break; }
    }
  }

  if (!trial) return res.status(404).json({ error: `Trial not found: ${trial_id}` });

  const result = measureExperiment(trial, base, todayStr);
  return res.status(200).json({ ok: true, ...result });
}
