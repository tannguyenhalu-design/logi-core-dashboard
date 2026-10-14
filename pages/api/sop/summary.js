/**
 * GET  /api/sop/summary  — parse KB entries thành 4 section có cấu trúc + overlay manual notes
 *                          + expose customSteps[] từ KB entry
 * POST /api/sop/summary  — upsert manual note cho 1 section của 1 client (manager only)
 *   { id: "sop_digiworld_bn", section: "delivery", content: "..." }
 *   section có thể là 4 bước chuẩn HOẶC custom step ID (step_xxx)
 */
import { getSession } from "../../../lib/auth";
import { put, get } from "@vercel/blob";

const KB_PATH    = "sops-knowledge.json";
const NOTES_PATH = "sop-delivery-notes.json";

async function readBlob(path) {
  try {
    const res = await get(path, { access: "private", useCache: false });
    if (!res) return null;
    const text = await new Response(res.stream).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeBlob(path, data) {
  await put(path, JSON.stringify(data, null, 2), {
    access: "private", contentType: "application/json",
    addRandomSuffix: false, allowOverwrite: true,
  });
}

// ── Extract client_id from KB content ──────────────────────────────────────────
function extractClientId(content) {
  const m = content.match(/Client\s*ID[:\s]+(\d+)/i);
  return m ? m[1] : null;
}

// ── Auto-parse KB content into 4 operational sections ─────────────────────────
const PICKUP_KW   = ["check-in", "tiếp nhận hàng", "kiểm đếm", "ngoại quan",
                     "tem seal", "seal", "mút eva", "nẹp góc", "thùng", "móp",
                     "rách", "băng keo", "nguyên vẹn", "nhận hàng", "ccdc",
                     "cut-off", "khung giờ lấy", "cổng kho", "chất xếp"];
const LINEHAUL_KW = ["xe 1t9", "xe 5t", "xe 8t", "cbm", "điều xe", "tài xế",
                     "bks", "cccd", "áo phản quang", "ftl", "ltl", "ghép chuyến",
                     "xếp tầng", "stacking", "chèn lót", "vách ngăn", "bo góc",
                     "trung chuyển", "xe tải", "lộ trình"];
const DELIVERY_KW = ["điểm giao", "booking giờ", "tttm", "siêu thị", "điện máy xanh",
                     "đmx", "cao phong", "nguyễn kim", "đồng kiểm", "ký nhận",
                     "cổng giao", "hầm b2", "hầm", "dock", "bốc dỡ"];
const EPOD_KW     = ["epod", "pod ", "phiếu xuất", "hóa đơn", "vat", "biên bản",
                     "chứng từ", "thu hồi", "lệnh xuất", "phiếu serial",
                     "upload ảnh", "upload pod", "nộp pod", "chữ ký", "thủ kho",
                     "phiếu giao nhận"];

function scoreKeywords(line, kw) {
  const l = line.toLowerCase();
  return kw.filter(k => l.includes(k)).length;
}

function parseKBSections(content) {
  const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 15);
  const pickup = [], linehaul = [], delivery = [], epod_docs = [];

  for (const raw of lines) {
    if (/^#{1,3}\s/.test(raw)) continue;
    const line = raw.replace(/^\d+\.\s*/, "").replace(/^[-*•]\s*/, "");
    const ps = scoreKeywords(line, PICKUP_KW);
    const ls = scoreKeywords(line, LINEHAUL_KW);
    const ds = scoreKeywords(line, DELIVERY_KW);
    const es = scoreKeywords(line, EPOD_KW);
    const best = Math.max(ps, ls, ds, es);
    if (best === 0) continue;

    if (es === best && epod_docs.length < 5) epod_docs.push(line);
    else if (ds === best && delivery.length < 5) delivery.push(line);
    else if (ls === best && linehaul.length < 5) linehaul.push(line);
    else if (ps === best && pickup.length  < 5) pickup.push(line);
  }
  return { pickup, linehaul, delivery, epod_docs };
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (req.method === "GET") {
    const [kb, notes] = await Promise.all([
      readBlob(KB_PATH),
      readBlob(NOTES_PATH),
    ]);
    const entries = Array.isArray(kb) ? kb : [];
    const notesMap = (notes && typeof notes === "object") ? notes : {};

    const summaries = entries.map((e) => {
      const parsed      = parseKBSections(e.content || "");
      const manual      = notesMap[e.id] || {};
      const imgs        = manual.image_urls || {};
      const customSteps = Array.isArray(e.customSteps) ? e.customSteps : [];

      // Build manualNote/imageUrls for default 4 sections + any custom steps
      const manualNote = {
        pickup:    manual.pickup    || manual.kho_nguon || "",
        linehaul:  manual.linehaul  || manual.van_tai   || "",
        delivery:  manual.delivery  || manual.diem_giao || "",
        epod_docs: manual.epod_docs || "",
      };
      const imageUrls = {
        pickup:    imgs.pickup    || imgs.kho_nguon || [],
        linehaul:  imgs.linehaul  || imgs.van_tai   || [],
        delivery:  imgs.delivery  || imgs.diem_giao || [],
        epod_docs: imgs.epod_docs || [],
      };
      for (const step of customSteps) {
        manualNote[step.id] = manual[step.id] || "";
        imageUrls[step.id]  = imgs[step.id]   || [];
      }

      return {
        id:         e.id,
        title:      e.title,
        client_id:  extractClientId(e.content || ""),
        tags:       e.tags || [],
        customSteps,
        pickup:     parsed.pickup,
        linehaul:   parsed.linehaul,
        delivery:   parsed.delivery,
        epod_docs:  parsed.epod_docs,
        manualNote,
        imageUrls,
        updatedAt:  e.updatedAt,
      };
    });

    return res.status(200).json({ ok: true, summaries });
  }

  if (req.method === "POST") {
    if (session.user.role !== "manager") {
      return res.status(403).json({ ok: false, error: "Chỉ Manager được chỉnh sửa" });
    }
    const { id, section, content: noteContent, image_urls } = req.body || {};
    // Allow 4 default sections AND custom step IDs (step_xxx format)
    if (!id || !section || !/^[\w-]{1,100}$/.test(section)) {
      return res.status(400).json({ ok: false, error: "Thiếu id hoặc section không hợp lệ" });
    }
    const notes = (await readBlob(NOTES_PATH)) || {};
    if (!notes[id]) notes[id] = {};
    notes[id][section] = String(noteContent || "").slice(0, 2000);

    if (Array.isArray(image_urls)) {
      const validUrls = image_urls
        .map(u => String(u).trim())
        .filter(u => /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i.test(u) || u.startsWith("https://"))
        .slice(0, 10);
      if (!notes[id].image_urls) notes[id].image_urls = {};
      notes[id].image_urls[section] = validUrls;
    }

    await writeBlob(NOTES_PATH, notes);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
