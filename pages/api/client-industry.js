/**
 * pages/api/client-industry.js — Manager-only: decide whether a client counts
 * as "Điện máy" (SYSTEM_SPEC incident #37).
 *   POST { client: "Komex", industry: "DM" | "OTHER" }
 * Written to the `client_industry` tab (source = manual, wins over Rillnet);
 * takes effect at the next snapshot build — the health page triggers one right
 * after (`/api/data?force=true`). Every decision is audit-logged.
 */
import { getSession } from "../../lib/auth";
import { setManualIndustry } from "../../lib/client-industry";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager") return res.status(403).json({ error: "Chỉ Manager mới phân ngành khách hàng" });

  const { client, industry } = req.body || {};
  if (!client || !["DM", "OTHER"].includes(industry)) {
    return res.status(400).json({ error: "Cần client và industry (DM hoặc OTHER)" });
  }
  try {
    const r = await setManualIndustry(client, industry, session.user.name || session.user.email || "");
    await logAction({
      actor: session.user.name || session.user.email || "manager",
      action: "client.industry",
      target: r.client,
      details: { industry: r.industry },
    });
    return res.status(200).json({ ok: true, ...r });
  } catch (err) {
    console.error("[/api/client-industry] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
