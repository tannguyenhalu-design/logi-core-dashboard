/**
 * pages/api/notifications/gtalk-dispatch.js — Proactive GTalk card notifications.
 *
 * POST /api/notifications/gtalk-dispatch
 *   Auth: x-snapshot-secret (internal cron only)
 *
 * On call:
 *   1. Scan anomalies via scanAnomalies(base, { minSeverity: "HIGH" })
 *   2. Load cooldown state from Vercel Blob
 *   3. Skip anomalies sent within last 4h (cooldown)
 *   4. Group remaining by entity_id/project
 *   5. Send Google Chat Card V2 to GTALK_OA_WEBHOOK_URL
 *   6. Save updated cooldown
 *
 * Returns: { ok, dispatched, skipped, anomalies }
 */
import { loadLtlBase } from "../../../lib/ltl-snapshot";
import { scanAnomalies } from "../../../lib/anomaly-detector";
import { get, put } from "@vercel/blob";

const COOLDOWN_MS  = 4 * 60 * 60 * 1000; // 4h
const COOLDOWN_PATH = "alerts/gtalk-cooldown.json";
const MAX_CARDS_PER_DISPATCH = 10;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const snapshotSecret = process.env.SNAPSHOT_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers["x-snapshot-secret"] || req.headers.authorization?.replace("Bearer ", "");
  if (!snapshotSecret && !cronSecret) {
    return res.status(503).json({ error: "GTalk dispatch not configured" });
  }
  const authorized = (snapshotSecret && auth === snapshotSecret) || (cronSecret && auth === cronSecret);
  if (!authorized) return res.status(401).json({ error: "Unauthorized" });

  const webhookUrl = process.env.GTALK_OA_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(200).json({ ok: true, dispatched: 0, skipped: 0, reason: "GTALK_OA_WEBHOOK_URL not configured" });
  }

  try {
    const [base, cooldown] = await Promise.all([
      loadLtlBase().catch(() => null),
      loadCooldown(),
    ]);

    const allAnomalies = scanAnomalies(base, { minSeverity: "HIGH" });
    const now = Date.now();

    const toSend = [];
    const skippedIds = [];

    for (const a of allAnomalies) {
      const lastSent = cooldown[a.anomaly_id];
      if (lastSent && now - lastSent < COOLDOWN_MS) {
        skippedIds.push(a.anomaly_id);
      } else {
        toSend.push(a);
      }
    }

    if (toSend.length === 0) {
      return res.status(200).json({ ok: true, dispatched: 0, skipped: skippedIds.length, anomalies: [] });
    }

    // Group by entity_id for card grouping
    const grouped = groupByProject(toSend.slice(0, MAX_CARDS_PER_DISPATCH));
    const card = buildCardV2(grouped, base?.builtAt);

    const gtalkRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!gtalkRes.ok) {
      const errText = await gtalkRes.text().catch(() => "");
      console.error("[gtalk-dispatch] webhook failed:", gtalkRes.status, errText.slice(0, 200));
      return res.status(502).json({ ok: false, error: `GTalk webhook error ${gtalkRes.status}` });
    }

    // Update cooldown
    for (const a of toSend) {
      cooldown[a.anomaly_id] = now;
    }
    // Prune old entries
    for (const [id, ts] of Object.entries(cooldown)) {
      if (now - ts > 7 * 24 * 3600_000) delete cooldown[id];
    }
    await saveCooldown(cooldown);

    return res.status(200).json({
      ok: true,
      dispatched: toSend.length,
      skipped: skippedIds.length,
      anomalies: toSend.map((a) => ({ anomaly_id: a.anomaly_id, severity: a.severity, title: a.title })),
    });
  } catch (err) {
    console.error("[gtalk-dispatch] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── Cooldown persistence ────────────────────────────────────────────────────
async function loadCooldown() {
  try {
    const res = await get(COOLDOWN_PATH, { access: "private", useCache: false });
    if (!res) return {};
    const text = await new Response(res.stream).text();
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveCooldown(cd) {
  await put(COOLDOWN_PATH, JSON.stringify(cd), { access: "private", addRandomSuffix: false });
}

// ─── Card builders ────────────────────────────────────────────────────────────
function groupByProject(anomalies) {
  const groups = new Map();
  for (const a of anomalies) {
    const key = a.entity_type === "system" ? "system" : a.entity_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return groups;
}

const SEV_EMOJI = { CRITICAL: "🚨", HIGH: "⚠️", MEDIUM: "🟡", LOW: "🟢", INFO: "ℹ️" };
const SEV_COLOR = { CRITICAL: "#D93025", HIGH: "#F57C00", MEDIUM: "#F9A825", LOW: "#388E3C", INFO: "#1A73E8" };

function formatVal(metric, val) {
  if (val === null || val === undefined) return "N/A";
  if (metric === "ontime_rate") return `${val}%`;
  if (metric === "damage_rate") return `${val}‰`;
  if (metric === "comp_rate" || metric === "comp_per_order") return `${Number(val).toLocaleString("vi-VN")} VND`;
  return String(val);
}

function buildCardV2(grouped, builtAt) {
  const vnTime = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const dataLabel = builtAt
    ? `Data tính đến: ${new Date(builtAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`
    : "Dữ liệu mới nhất";

  const sections = [];

  for (const [project, anomalies] of grouped) {
    const headerEmoji = anomalies.some((a) => a.severity === "CRITICAL") ? "🚨" : "⚠️";
    const widgets = anomalies.map((a) => ({
      decoratedText: {
        topLabel: `${SEV_EMOJI[a.severity]} ${a.severity}`,
        text: `<b>${a.title}</b>`,
        bottomLabel: `${formatVal(a.metric, a.current_value)} → ${a.baseline_value !== null ? formatVal(a.metric, a.baseline_value) : ""} | ${a.evidence?.window_label || a.detection_rule}`,
        wrapText: true,
      },
    }));

    // Add recommended action
    const firstA = anomalies[0];
    if (firstA?.recommendedAction) {
      widgets.push({
        textParagraph: { text: `💡 <i>${firstA.recommendedAction}</i>` },
      });
    }

    sections.push({ header: `${headerEmoji} ${project}`, widgets });
  }

  // Footer
  sections.push({
    widgets: [{
      textParagraph: {
        text: `<font color="#888888"><i>${dataLabel} | SD3 Command Tower</i></font>`,
      },
    }],
  });

  return {
    cardsV2: [{
      cardId: `sd3-anomaly-${Date.now()}`,
      card: {
        header: {
          title: `${SEV_EMOJI["CRITICAL"]} SD3 Cảnh báo bất thường`,
          subtitle: vnTime,
          imageUrl: "https://fonts.gstatic.com/s/i/googlematerialicons/warning/v11/24px.svg",
          imageType: "CIRCLE",
        },
        sections,
      },
    }],
  };
}
