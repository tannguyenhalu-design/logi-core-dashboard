/**
 * pages/api/ai-narrative.js
 * POST { insights } -> { narrative } — client sends the already-computed
 * AI Insights payload it already rendered, server asks Claude to turn it
 * into a short Vietnamese write-up. On-demand (button click), not called
 * automatically, to keep API spend predictable.
 */
import { getSession } from "../../lib/auth";
import { generateInsightNarrative } from "../../lib/ai-narrative";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { insights } = req.body || {};
    if (!insights) return res.status(400).json({ error: "Missing insights" });
    const narrative = await generateInsightNarrative(insights);
    return res.status(200).json({ ok: true, narrative });
  } catch (err) {
    console.error("[/api/ai-narrative] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
