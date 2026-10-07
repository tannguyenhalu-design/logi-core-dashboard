/**
 * pages/api/ai-map-narrative.js
 * POST { mapIndustry, data } -> { narrative }
 * Province Map per-tab AI analysis (DM / STTP / NHC / all).
 * On-demand (button click), same auth pattern as /api/ai-narrative.
 */
import { getSession } from "../../lib/auth";
import { generateMapNarrative } from "../../lib/ai-narrative";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { mapIndustry, data } = req.body || {};
    if (!mapIndustry || !data) return res.status(400).json({ error: "Missing mapIndustry or data" });
    const narrative = await generateMapNarrative(mapIndustry, data);
    return res.status(200).json({ ok: true, narrative });
  } catch (err) {
    console.error("[/api/ai-map-narrative] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
