/**
 * pages/api/trials/create-from-ai.js
 * POST — AI proposes a new A/B experiment trial (experiment_status = PROPOSED).
 * Manager only (aiPermissions.execute).
 *
 * Body: { anomaly_type, suggested_hypothesis, suggested_treatment, suggested_control, primary_metric }
 * Returns: { ok, trialId, trial, version }
 */
import { getSession, aiPermissions } from "../../../lib/auth";
import { createDraftTrial } from "../../../lib/trials";
import { logAction } from "../../../lib/audit-log";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).end();

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  const perms = aiPermissions(session.user.role);
  if (!perms.execute) return res.status(403).json({ error: "Chỉ Manager được tạo thử nghiệm từ AI" });

  const { anomaly_type, suggested_hypothesis, suggested_treatment, suggested_control, primary_metric } = req.body || {};

  if (!suggested_hypothesis || typeof suggested_hypothesis !== "string") {
    return res.status(400).json({ error: "Thiếu suggested_hypothesis" });
  }
  if (!Array.isArray(suggested_treatment) || !suggested_treatment.length) {
    return res.status(400).json({ error: "suggested_treatment phải là mảng tên khách hàng (≥1 phần tử)" });
  }
  if (!Array.isArray(suggested_control) || !suggested_control.length) {
    return res.status(400).json({ error: "suggested_control phải là mảng tên khách hàng (≥1 phần tử)" });
  }

  const actor = session.user.name || session.user.email;

  try {
    const result = await createDraftTrial({
      hypothesis: suggested_hypothesis,
      treatmentGroup: suggested_treatment,
      controlGroup: suggested_control,
      primaryMetric: primary_metric || "ontime_rate",
      suggestedBy: actor,
      anomalyType: anomaly_type || "",
    });

    await logAction({
      actor,
      action: "trial.ai-create",
      target: result.trial.name,
      details: {
        id: result.trial.id,
        anomalyType: anomaly_type || "",
        treatmentCount: suggested_treatment.length,
        controlCount: suggested_control.length,
        primaryMetric: primary_metric || "ontime_rate",
      },
    }).catch(() => {});

    return res.status(200).json({ ok: true, trialId: result.trial.id, trial: result.trial, version: result.version });
  } catch (err) {
    console.error("[/api/trials/create-from-ai] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
