/**
 * pages/api/trials.js — "Sổ tay Cải tiến & Đo lường Giải pháp" (28/09).
 * Manager + SD3 only.
 *   GET                 → { trials, version, canEdit, canDelete, statuses }
 *   GET ?options=1      → form pickers: client → kho lấy / kho giao / tỉnh giao
 *   GET ?impact=<id>    → Baseline vs Post-Trial, with the control group
 *   POST { action: "save", trial }   → create / update (Manager + SD3)
 *   POST { action: "delete", id }    → soft delete (Manager only)
 * `v` = version the browser last saved: forces a fresh sheet read on an
 * instance that has not seen it yet. Every write goes to the audit log.
 */
import { getSession } from "../../lib/auth";
import { loadLtlBase } from "../../lib/ltl-snapshot";
import { vnToday } from "../../lib/ltl-dashboard";
import { logAction } from "../../lib/audit-log";
import { readTrials, saveTrial, deleteTrial, validateTrial, scopeOptions, computeTrialImpact, STATUSES, fmt } from "../../lib/trials";

const scopeText = (t) => [
  t.clients.join(", "),
  t.khoLay.length ? `kho lấy: ${t.khoLay.join(", ")}` : "",
  t.khoGiao.length ? `kho giao: ${t.khoGiao.join(", ")}` : "",
  t.provinces.length ? `tỉnh giao: ${t.provinces.join(", ")}` : "",
].filter(Boolean).join(" · ");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  const role = session.user.role;
  if (!["manager", "sd3"].includes(role)) return res.status(403).json({ error: "Chỉ Manager và SD3 được dùng Sổ tay cải tiến" });
  const actor = session.user.name || session.user.email;
  const minVersion = String(req.query.v || "");

  try {
    if (req.method === "GET") {
      if (req.query.options) {
        const base = await loadLtlBase();
        return res.status(200).json({ ok: true, options: scopeOptions(base), statuses: STATUSES });
      }
      if (req.query.impact) {
        const [base, { trials }] = await Promise.all([loadLtlBase(), readTrials({ minVersion })]);
        const trial = trials.find((t) => t.id === String(req.query.impact));
        if (!trial) return res.status(404).json({ error: "Không tìm thấy giải pháp (có thể đã bị xoá)" });
        return res.status(200).json({ ok: true, trial, impact: computeTrialImpact(base, trial, vnToday()) });
      }
      const { trials, version } = await readTrials({ minVersion });
      return res.status(200).json({ ok: true, trials, version, canEdit: true, canDelete: role === "manager", statuses: STATUSES });
    }

    if (req.method !== "POST") return res.status(405).end();
    const { action } = req.body || {};

    if (action === "delete") {
      if (role !== "manager") return res.status(403).json({ error: "Chỉ Manager được xoá giải pháp" });
      const id = String(req.body.id || "").trim();
      if (!id) return res.status(400).json({ error: "Thiếu id" });
      const out = await deleteTrial(id, actor);
      await logAction({ actor, action: "trial.delete", target: out.name, details: { id } }).catch(() => {});
      return res.status(200).json({ ok: true, version: out.version });
    }

    if (action === "save") {
      const t = req.body.trial || {};
      const input = {
        id: t.id ? String(t.id).trim() : "",
        name: String(t.name || "").slice(0, 300),
        clients: Array.isArray(t.clients) ? [...new Set(t.clients.map(String))] : [],
        khoLay: Array.isArray(t.khoLay) ? [...new Set(t.khoLay.map(String))] : [],
        khoGiao: Array.isArray(t.khoGiao) ? [...new Set(t.khoGiao.map(String))] : [],
        provinces: Array.isArray(t.provinces) ? [...new Set(t.provinces.map(String))] : [],
        baseStart: t.baseStart, baseEnd: t.baseEnd, startDate: t.startDate, endDate: t.endDate || "",
        status: t.status,
        description: String(t.description || "").slice(0, 5000),
      };
      const err = validateTrial(input);
      if (err) return res.status(400).json({ error: err });
      const out = await saveTrial(input, actor);
      const tr = out.trial;
      const changes = [];
      if (out.before) {
        const b = out.before;
        if (b.status !== tr.status) changes.push(`trạng thái: ${b.status} → ${tr.status}`);
        if (b.name !== tr.name) changes.push(`tên: ${b.name} → ${tr.name}`);
        if (scopeText(b) !== scopeText(tr)) changes.push(`phạm vi: ${scopeText(tr)}`);
        if (b.startDate !== tr.startDate || b.endDate !== tr.endDate) changes.push(`thời gian: ${fmt(tr.startDate)} → ${tr.endDate ? fmt(tr.endDate) : "Ongoing"}`);
        if (b.baseStart !== tr.baseStart || b.baseEnd !== tr.baseEnd) changes.push(`baseline: ${fmt(tr.baseStart)} – ${fmt(tr.baseEnd)}`);
        if (b.description !== tr.description) changes.push("sửa mô tả");
      }
      await logAction({
        actor, action: out.created ? "trial.create" : "trial.update", target: tr.name,
        details: out.created ? { id: tr.id, scope: scopeText(tr), start: tr.startDate, end: tr.endDate || "Ongoing", status: tr.status } : { id: tr.id, changes },
      }).catch(() => {});
      return res.status(200).json({ ok: true, trial: tr, version: out.version, created: out.created });
    }

    return res.status(400).json({ error: "action không hợp lệ" });
  } catch (err) {
    console.error("[/api/trials] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
