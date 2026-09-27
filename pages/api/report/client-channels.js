/**
 * pages/api/report/client-channels.js — "Cài đặt kênh khách hàng" (27/09).
 * GET  → every Điện máy client with its effective channel / own-row flags,
 *        where the setting comes from (saved | default | auto = chưa cấu
 *        hình), its order count and is_B2C share (mixed flags flagged).
 *        Manager + SD3.
 * POST { rows: [{ client, channel: "B2B"|"B2C", ownOntime, ownFd, order }] }
 *        → replaces the saved config. Manager only; written to the audit log.
 */
import { getSession } from "../../../lib/auth";
import { loadLtlBase } from "../../../lib/ltl-snapshot";
import { readClientChannels, saveClientChannels, resolveChannels } from "../../../lib/client-channels";
import { clearReportCache } from "../../../lib/report-cache";
import { logAction } from "../../../lib/audit-log";

function clientStats(base) {
  const stats = {};
  for (const r of base.ltlRows || []) {
    if (!String(r.pickup_time || "").trim()) continue;
    const s = (stats[r.client_name] = stats[r.client_name] || { orders: 0, b2c: 0 });
    s.orders++;
    if (String(r.is_B2C ?? "").trim() === "1") s.b2c++;
  }
  return stats;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  const role = session.user.role;
  if (!["manager", "sd3"].includes(role)) return res.status(403).json({ error: "Chỉ Manager và SD3 được xem cài đặt kênh" });
  const actor = session.user.name || session.user.email;

  try {
    if (req.method === "GET") {
      const [base, { config, version }] = await Promise.all([loadLtlBase(), readClientChannels({ minVersion: String(req.query.cv || "") })]);
      const resolved = resolveChannels(config, clientStats(base));
      const rows = Object.entries(resolved).map(([client, v]) => ({ client, ...v }))
        .sort((a, b) => (a.channel === b.channel ? 0 : a.channel === "B2B" ? -1 : 1) || (b.ownOntime || b.ownFd) - (a.ownOntime || a.ownFd) || a.order - b.order || b.orders - a.orders);
      return res.status(200).json({ ok: true, rows, version, canEdit: role === "manager" });
    }
    if (req.method !== "POST") return res.status(405).end();
    if (role !== "manager") return res.status(403).json({ error: "Chỉ Manager được lưu cài đặt kênh" });

    const input = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!input || !input.length) return res.status(400).json({ error: "Thiếu danh sách khách" });
    const seen = new Set();
    const rows = [];
    for (const r of input) {
      const client = String(r.client || "").trim();
      if (!client || seen.has(client)) continue;
      if (!["B2B", "B2C"].includes(r.channel)) return res.status(400).json({ error: `Kênh của "${client}" phải là B2B hoặc B2C` });
      seen.add(client);
      rows.push({ client, channel: r.channel, ownOntime: !!r.ownOntime, ownFd: !!r.ownFd, order: Number(r.order) || 999 });
    }
    // Compare with what was in effect (saved → default → data majority), not
    // only with saved rows — on the first save nothing is saved yet.
    const [base, { config }] = await Promise.all([loadLtlBase(), readClientChannels()]);
    const before = resolveChannels(config, clientStats(base));
    const saved = await saveClientChannels(rows, actor);
    clearReportCache();
    // What changed, for the audit log (only clients whose setting moved).
    const changes = rows.filter((r) => {
      const b = before[r.client];
      return !b || b.channel !== r.channel || b.ownOntime !== r.ownOntime || b.ownFd !== r.ownFd || b.order !== r.order;
    }).map((r) => `${r.client}: ${r.channel}${r.ownOntime ? " · dòng riêng Ontime" : ""}${r.ownFd ? " · dòng riêng Hàng hoàn" : ""} · thứ tự ${r.order}`);
    await logAction({ actor, action: "report.channels", target: `${rows.length} khách`, details: { changes: changes.slice(0, 50), version: saved.version } }).catch(() => {});
    return res.status(200).json({ ok: true, version: saved.version, count: saved.count, changed: changes.length });
  } catch (err) {
    console.error("[/api/report/client-channels] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
