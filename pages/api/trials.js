/**
 * pages/api/trials.js — "Sổ tay Cải tiến & Đo lường Giải pháp" with PHASES
 * (KẾ HOẠCH B, 28/09). Manager + SD3 only; deletes = Manager.
 *   GET                         → { solutions (with phases, verdict per phase, alerts), version, … }
 *   GET ?options=1              → form pickers: client → kho lấy / kho giao / tỉnh giao
 *   GET ?solution=<id>          → full solution report (comparison, weekly series, monitoring, per-phase impact)
 *       &format=xlsx | docx     → Excel / Word of the same report
 *   GET ?impact=<phaseId>       → one phase (against the solution baseline); &format=xlsx → its file
 *   GET ?image=<path>           → a phase photo (private Blob)
 *   POST { action: "saveSolution", solution, firstPhase?, adoptPhaseIds?, adoptLabels? }
 *   POST { action: "savePhase", solutionId, phase }
 *   POST { action: "deletePhase" | "deleteSolution", id }            (Manager)
 *   POST { action: "uploadImage", phaseId, dataUrl, caption }
 *   POST { action: "captionImage", phaseId, path, caption }
 *   POST { action: "deleteImage", phaseId, path }                     (Manager)
 * `v` = version the browser last saved → fresh sheet read. Every write → audit log.
 */
import { getSession } from "../../lib/auth";
import { loadLtlBase } from "../../lib/ltl-snapshot";
import { vnToday } from "../../lib/ltl-dashboard";
import { logAction } from "../../lib/audit-log";
import { scopeOptions, computeTrialImpact, fmt } from "../../lib/trials";
import {
  readSolutions, saveSolution, savePhase, deletePhase, deleteSolution, setPhaseImages, validateSolution, validatePhase,
  computeSolutionReport, phaseTrial, SOLUTION_STATUSES, PHASE_STATUSES, MAX_IMAGES,
} from "../../lib/solutions";
import { uploadPhaseImage, readPhaseImage, deletePhaseImage, isImagePath } from "../../lib/trial-images";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const strs = (a) => (Array.isArray(a) ? [...new Set(a.map((x) => String(x).trim()).filter(Boolean))] : []);
const scopeText = (p) => [p.khoLay.length ? `kho lấy: ${p.khoLay.join(", ")}` : "", p.khoGiao.length ? `kho giao: ${p.khoGiao.length} kho` : "", p.provinces.length ? `tỉnh: ${p.provinces.join(", ")}` : ""].filter(Boolean).join(" · ") || "toàn bộ đơn của khách";
const cleanPhase = (p = {}) => ({
  id: p.id ? String(p.id).trim() : "", label: String(p.label || "").trim().slice(0, 80),
  khoLay: strs(p.khoLay), khoGiao: strs(p.khoGiao), provinces: strs(p.provinces),
  startDate: p.startDate, endDate: p.endDate || "", status: p.status, description: String(p.description || "").slice(0, 5000),
});
const fileName = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  const role = session.user.role;
  if (!["manager", "sd3"].includes(role)) return res.status(403).json({ error: "Chỉ Manager và SD3 được dùng Sổ tay cải tiến" });
  const actor = session.user.name || session.user.email;
  const minVersion = String(req.query.v || "");
  const isManager = role === "manager";
  const findSolution = async (id) => (await readSolutions({ minVersion })).solutions.find((s) => s.id === id);

  try {
    if (req.method === "GET") {
      if (req.query.image) {
        const path = String(req.query.image);
        if (!isImagePath(path)) return res.status(400).json({ error: "Đường dẫn ảnh không hợp lệ" });
        const img = await readPhaseImage(path);
        if (!img) return res.status(404).json({ error: "Không tìm thấy ảnh" });
        res.setHeader("Content-Type", img.contentType);
        return res.status(200).send(img.buf);
      }
      if (req.query.options) {
        const base = await loadLtlBase();
        return res.status(200).json({ ok: true, options: scopeOptions(base) });
      }
      if (req.query.solution) {
        const [base, sol] = await Promise.all([loadLtlBase(), findSolution(String(req.query.solution))]);
        if (!sol) return res.status(404).json({ error: "Không tìm thấy giải pháp (có thể đã bị xoá)" });
        const report = computeSolutionReport(base, sol, vnToday());
        const fmtQ = req.query.format;
        if (fmtQ === "xlsx" || fmtQ === "docx") {
          let buf, type, ext;
          if (fmtQ === "xlsx") {
            const { buildSolutionWorkbook } = await import("../../lib/trial-xlsx");
            buf = Buffer.from(await buildSolutionWorkbook(sol, report, { exportedBy: actor }));
            type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; ext = "xlsx";
          } else {
            const { buildSolutionDocx } = await import("../../lib/trial-docx");
            const images = new Map();
            for (const p of sol.phases) {
              const list = [];
              for (const im of p.images || []) { try { const got = await readPhaseImage(im.path); if (got) list.push({ buf: got.buf, caption: im.caption || "" }); } catch { /* skip a broken photo */ } }
              images.set(p.id, list);
            }
            buf = await buildSolutionDocx(sol, report, images, { exportedBy: actor });
            type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; ext = "docx";
          }
          logAction({ actor, action: "trial.export", target: sol.name, details: { id: sol.id, format: ext } }).catch(() => {});
          res.setHeader("Content-Type", type);
          res.setHeader("Content-Disposition", `attachment; filename="Bao-cao-giai-phap-${fileName(sol.name) || sol.id}.${ext}"`);
          return res.status(200).send(buf);
        }
        return res.status(200).json({ ok: true, solution: sol, report });
      }
      if (req.query.impact) {
        const [base, { solutions }] = await Promise.all([loadLtlBase(), readSolutions({ minVersion })]);
        const pid = String(req.query.impact);
        const sol = solutions.find((s) => s.phases.some((p) => p.id === pid));
        if (!sol) return res.status(404).json({ error: "Không tìm thấy giai đoạn (có thể đã bị xoá)" });
        const trial = phaseTrial(sol, sol.phases.find((p) => p.id === pid));
        const impact = computeTrialImpact(base, trial, vnToday());
        if (req.query.format === "xlsx") {
          const { buildTrialWorkbook } = await import("../../lib/trial-xlsx");
          const buf = await buildTrialWorkbook(trial, impact, { exportedBy: actor });
          logAction({ actor, action: "trial.export", target: trial.name, details: { id: pid, verdict: impact.verdict.label } }).catch(() => {});
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition", `attachment; filename="Danh-gia-${pid}.xlsx"`);
          return res.status(200).send(Buffer.from(buf));
        }
        return res.status(200).json({ ok: true, trial, impact });
      }
      // List: every solution with its phases' verdicts and monitoring alerts (for the outer table).
      const [base, { solutions, version }] = await Promise.all([loadLtlBase(), readSolutions({ minVersion })]);
      const today = vnToday();
      const rows = solutions.map((s) => {
        const r = computeSolutionReport(base, s, today);
        return { ...s, phases: s.phases.map((p, i) => ({ ...p, verdict: r.phases[i].impact.verdict.label, verdictLevel: r.phases[i].impact.verdict.level, monitored: !!r.phases[i].monitor })), alerts: r.alerts };
      });
      return res.status(200).json({ ok: true, solutions: rows, version, canEdit: true, canDelete: isManager, statuses: { solution: SOLUTION_STATUSES, phase: PHASE_STATUSES } });
    }

    if (req.method !== "POST") return res.status(405).end();
    const b = req.body || {};
    const action = b.action;

    if (action === "saveSolution") {
      const s = b.solution || {};
      const input = { id: s.id && !String(s.id).startsWith("legacy:") ? String(s.id).trim() : "", name: String(s.name || "").slice(0, 300), clients: strs(s.clients), baseStart: s.baseStart, baseEnd: s.baseEnd, status: s.status, description: String(s.description || "").slice(0, 5000) };
      const err = validateSolution(input);
      if (err) return res.status(400).json({ error: err });
      let firstPhase = null;
      if (!input.id && b.firstPhase) {
        firstPhase = cleanPhase(b.firstPhase);
        const e2 = validatePhase(firstPhase, input);
        if (e2) return res.status(400).json({ error: e2 });
      }
      const adopt = strs(b.adoptPhaseIds);
      if (!input.id && !firstPhase && !adopt.length) return res.status(400).json({ error: "Giải pháp mới cần giai đoạn đầu tiên" });
      if (adopt.length) {
        const { solutions } = await readSolutions({ minVersion });
        for (const pid of adopt) {
          const p = solutions.flatMap((x) => x.phases).find((x) => x.id === pid);
          if (!p) return res.status(400).json({ error: `Không tìm thấy giai đoạn ${pid}` });
          if (p.startDate <= input.baseEnd) return res.status(400).json({ error: `${p.label} bắt đầu ${fmt(p.startDate)} — phải sau Baseline chung (kết thúc ${fmt(input.baseEnd)})` });
        }
      }
      const out = await saveSolution(input, actor, { firstPhase, adoptPhaseIds: adopt, adoptLabels: Array.isArray(b.adoptLabels) ? b.adoptLabels.map(String) : [] });
      const changes = [];
      if (out.before) {
        const x = out.before;
        if (x.name !== input.name) changes.push(`tên: ${x.name} → ${input.name}`);
        if (x.status !== input.status) changes.push(`trạng thái: ${x.status} → ${input.status}`);
        if (x.baseStart !== input.baseStart || x.baseEnd !== input.baseEnd) changes.push(`baseline: ${fmt(input.baseStart)} – ${fmt(input.baseEnd)}`);
        if (x.clients.join("|") !== input.clients.join("|")) changes.push(`khách: ${input.clients.join(", ")}`);
        if (x.description !== input.description) changes.push("sửa mô tả");
      }
      if (adopt.length) changes.push(`gộp ${adopt.length} giai đoạn: ${adopt.join(", ")}`);
      await logAction({ actor, action: out.created ? "solution.create" : "solution.update", target: input.name, details: { id: out.solution.id, changes, firstPhase: out.phaseId || undefined } }).catch(() => {});
      return res.status(200).json({ ok: true, solution: out.solution, version: out.version, created: out.created, phaseId: out.phaseId });
    }

    if (action === "savePhase") {
      const sol = await findSolution(String(b.solutionId || ""));
      if (!sol || sol.legacy) return res.status(400).json({ error: "Không tìm thấy giải pháp của giai đoạn (giải pháp cũ: bấm Sửa để lưu thành giải pháp trước)" });
      const phase = cleanPhase(b.phase);
      if (phase.id && !sol.phases.some((p) => p.id === phase.id)) return res.status(400).json({ error: "Giai đoạn không thuộc giải pháp này" });
      const err = validatePhase(phase, sol);
      if (err) return res.status(400).json({ error: err });
      const out = await savePhase(phase, actor, sol);
      const changes = [];
      if (out.before) {
        const x = out.before;
        if (x.status !== phase.status) changes.push(`trạng thái: ${x.status} → ${phase.status}`);
        if (x.label !== phase.label) changes.push(`tên: ${x.label} → ${phase.label}`);
        if (scopeText(x) !== scopeText(phase)) changes.push(`phạm vi: ${scopeText(phase)}`);
        if (x.startDate !== phase.startDate || x.endDate !== phase.endDate) changes.push(`thời gian: ${fmt(phase.startDate)} → ${phase.endDate ? fmt(phase.endDate) : "Ongoing"}`);
        if (x.description !== phase.description) changes.push("sửa mô tả");
      }
      await logAction({ actor, action: out.created ? "phase.create" : "phase.update", target: `${sol.name} — ${phase.label}`, details: { id: out.phase.id, solutionId: sol.id, scope: out.created ? scopeText(phase) : undefined, changes } }).catch(() => {});
      return res.status(200).json({ ok: true, phase: out.phase, version: out.version, created: out.created });
    }

    if (action === "deletePhase" || action === "deleteSolution") {
      if (!isManager) return res.status(403).json({ error: "Chỉ Manager được xoá" });
      const id = String(b.id || "").trim();
      if (!id) return res.status(400).json({ error: "Thiếu id" });
      const legacyId = id.startsWith("legacy:") ? id.slice(7) : null;
      const out = action === "deleteSolution" && !legacyId ? await deleteSolution(id, actor) : await deletePhase(legacyId || id, actor);
      await logAction({ actor, action: action === "deleteSolution" ? "solution.delete" : "phase.delete", target: out.name, details: { id } }).catch(() => {});
      return res.status(200).json({ ok: true, version: out.version });
    }

    if (action === "uploadImage" || action === "captionImage" || action === "deleteImage") {
      if (action === "deleteImage" && !isManager) return res.status(403).json({ error: "Chỉ Manager được xoá ảnh" });
      const { solutions } = await readSolutions({ minVersion });
      const phase = solutions.flatMap((s) => s.phases).find((p) => p.id === String(b.phaseId || ""));
      if (!phase) return res.status(404).json({ error: "Không tìm thấy giai đoạn" });
      let images = [...(phase.images || [])];
      const caption = String(b.caption || "").trim().slice(0, 300);
      if (action === "uploadImage") {
        if (images.length >= MAX_IMAGES) return res.status(400).json({ error: `Mỗi giai đoạn tối đa ${MAX_IMAGES} ảnh` });
        const up = await uploadPhaseImage(phase.id, b.dataUrl);
        images.push({ path: up.path, caption, at: new Date().toISOString(), by: actor, bytes: up.bytes });
      } else {
        const path = String(b.path || "");
        if (!images.some((im) => im.path === path)) return res.status(404).json({ error: "Không tìm thấy ảnh" });
        if (action === "captionImage") images = images.map((im) => (im.path === path ? { ...im, caption } : im));
        else { images = images.filter((im) => im.path !== path); await deletePhaseImage(path); }
      }
      const out = await setPhaseImages(phase.id, images, actor);
      await logAction({ actor, action: `phase.${action}`, target: phase.label, details: { phaseId: phase.id, count: images.length } }).catch(() => {});
      return res.status(200).json({ ok: true, images, version: out.version });
    }

    return res.status(400).json({ error: "action không hợp lệ" });
  } catch (err) {
    console.error("[/api/trials] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
