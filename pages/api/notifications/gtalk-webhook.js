/**
 * POST /api/notifications/gtalk-webhook
 * Nhận message từ GTalk OA group → tìm SOP → reply tóm tắt
 *
 * Setup: GTalk Back Office → Official Account → tab Webhook
 *   → webhookURL = https://logicore-app.vercel.app/api/notifications/gtalk-webhook
 *   → webhookSecret = giá trị GTALK_WEBHOOK_SECRET (env var)
 *
 * Env:
 *   GTALK_OA_ID          — OA ID
 *   GTALK_OA_TOKEN       — username:password
 *   GTALK_WEBHOOK_SECRET — (optional) để verify signature
 */
import crypto from "crypto";
import { get } from "@vercel/blob";

const GTALK_BASE     = "https://mbff.ghn.vn";
const KB_PATH        = "sops-knowledge.json";
const NOTES_PATH     = "sop-delivery-notes.json";
const CANONICAL_BASE = "https://logicore-app.vercel.app";

function toPublicImageUrl(url) {
  if (!url) return url;
  if (url.includes("blob.vercel-storage.com")) {
    return `${CANONICAL_BASE}/api/sop/image?b=${encodeURIComponent(url)}`;
  }
  // URL proxy cũ (deployment-specific) → extract inner blob URL và rebuild
  if (url.includes("/api/sop/image?b=")) {
    try {
      const inner = decodeURIComponent(new URL(url).searchParams.get("b") || "");
      if (inner) return `${CANONICAL_BASE}/api/sop/image?b=${encodeURIComponent(inner)}`;
    } catch {}
  }
  return url;
}

// ── HMAC verify ───────────────────────────────────────────────────────────────

function verifySignature(req, rawBody, secret) {
  const header = req.headers["x-gtalk-event-signature"] || "";
  const { oaId, timestamp } = JSON.parse(rawBody);
  const input = oaId + rawBody + timestamp + secret;
  const expected = "mac=" + crypto.createHash("sha256").update(input).digest("hex");
  if (header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// ── Blob helpers ──────────────────────────────────────────────────────────────

async function readBlob(path) {
  try {
    const res = await get(path, { access: "private", useCache: false });
    if (!res) return null;
    const text = await new Response(res.stream).text();
    return JSON.parse(text);
  } catch { return null; }
}

// ── SOP lookup ────────────────────────────────────────────────────────────────

function extractClientId(content) {
  // Lấy tất cả client IDs từ KB content (hỗ trợ nhiều ID cách nhau bởi |)
  const matches = [...(content || "").matchAll(/Client\s*ID[:\s]+(\d+)/gi)];
  return matches.map(m => m[1]);
}

function findSOP(query, entries) {
  const q = query.trim().toLowerCase();

  // 1. Khớp chính xác client ID (chuỗi số)
  if (/^\d+$/.test(q)) {
    const hit = entries.find(e => extractClientId(e.content).includes(q));
    if (hit) return hit;
  }

  // 2. Khớp tiêu đề (contains)
  const byTitle = entries.filter(e => e.title.toLowerCase().includes(q));
  if (byTitle.length === 1) return byTitle[0];

  // 3. Khớp tags
  const byTag = entries.filter(e =>
    (e.tags || []).some(t => t.toLowerCase().includes(q))
  );
  if (byTag.length === 1) return byTag[0];

  // Nếu nhiều kết quả → trả list để user chọn
  const candidates = [...new Set([...byTitle, ...byTag])];
  return candidates.length > 0 ? { _multiple: candidates } : null;
}

// ── Format reply ──────────────────────────────────────────────────────────────

const PICKUP_KW   = ["check-in", "tiếp nhận hàng", "kiểm đếm", "ngoại quan",
                     "tem seal", "seal", "mút eva", "nẹp góc", "thùng", "móp",
                     "rách", "băng keo", "nguyên vẹn", "nhận hàng", "ccdc",
                     "cut-off", "cổng kho", "chất xếp"];
const LINEHAUL_KW = ["xe 1t9", "xe 5t", "xe 8t", "cbm", "điều xe", "tài xế",
                     "bks", "cccd", "áo phản quang", "ftl", "ltl", "ghép chuyến",
                     "xếp tầng", "stacking", "chèn lót", "vách ngăn",
                     "trung chuyển", "xe tải", "lộ trình"];
const DELIVERY_KW = ["điểm giao", "booking giờ", "tttm", "siêu thị", "điện máy xanh",
                     "đmx", "cao phong", "nguyễn kim", "đồng kiểm", "ký nhận",
                     "cổng giao", "hầm b2", "hầm", "dock", "bốc dỡ"];
const EPOD_KW     = ["epod", "pod ", "phiếu xuất", "hóa đơn", "vat", "biên bản",
                     "chứng từ", "thu hồi", "lệnh xuất", "phiếu serial",
                     "upload ảnh", "upload pod", "chữ ký", "thủ kho",
                     "phiếu giao nhận"];

function scoreKw(line, kw) {
  const l = line.toLowerCase();
  return kw.filter(k => l.includes(k)).length;
}

function parseSections(content) {
  const lines = content.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 15 && !/^#{1,3}\s/.test(l))
    .map(l => l.replace(/^\d+\.\s*/, "").replace(/^[-*•]\s*/, ""));

  const pickup = [], linehaul = [], delivery = [], epod_docs = [];
  for (const line of lines) {
    const ps = scoreKw(line, PICKUP_KW);
    const ls = scoreKw(line, LINEHAUL_KW);
    const ds = scoreKw(line, DELIVERY_KW);
    const es = scoreKw(line, EPOD_KW);
    const best = Math.max(ps, ls, ds, es);
    if (best === 0) continue;
    if (es === best && epod_docs.length < 4) epod_docs.push(line);
    else if (ds === best && delivery.length < 4) delivery.push(line);
    else if (ls === best && linehaul.length < 4) linehaul.push(line);
    else if (ps === best && pickup.length  < 4) pickup.push(line);
  }
  return { pickup, linehaul, delivery, epod_docs };
}

// Detect khâu chính từ query để gắn vào deep-link
function detectStep(query) {
  const q = query.toLowerCase();
  const d = DELIVERY_KW.filter(k => q.includes(k)).length;
  const l = LINEHAUL_KW.filter(k => q.includes(k)).length;
  const p = PICKUP_KW.filter(k => q.includes(k)).length;
  const e = EPOD_KW.filter(k => q.includes(k)).length;
  const best = Math.max(d, l, p, e);
  if (best === 0) return null;
  if (d === best) return "delivery";
  if (l === best) return "linehaul";
  if (p === best) return "pickup";
  return "epod";
}

function formatSOPReply(entry, notes, queryStep) {
  const parsed = parseSections(entry.content || "");
  const clientIds = extractClientId(entry.content);
  const note = notes || {};
  const imgs = note.image_urls || {};

  const lines = [];
  lines.push(`📋 *${entry.title}*`);
  if (clientIds.length > 0) lines.push(`Client ID: ${clientIds.join(" | ")}`);
  lines.push("");

  const sections = [
    { key: "pickup",    icon: "📦", label: "Lấy Hàng:",      imgKey: "pickup"    },
    { key: "linehaul",  icon: "🚛", label: "Trung Chuyển:",   imgKey: "linehaul"  },
    { key: "delivery",  icon: "📍", label: "Giao Hàng:",      imgKey: "delivery"  },
    { key: "epod_docs", icon: "📄", label: "EPOD & Chứng Từ:", imgKey: "epod_docs" },
  ];

  for (const { key, icon, label, imgKey } of sections) {
    // Backward compat: old keys for manual notes
    const manualNote = note[key] || note[{ pickup: "kho_nguon", linehaul: "van_tai", delivery: "diem_giao" }[key]] || "";
    const autoLines  = parsed[key] || [];
    const sectionImgs = imgs[imgKey] || imgs[{ pickup: "kho_nguon", linehaul: "van_tai", delivery: "diem_giao" }[imgKey]] || [];

    if (!manualNote && autoLines.length === 0 && sectionImgs.length === 0) continue;

    lines.push(`${icon} *${label}*`);
    if (manualNote) {
      manualNote.split("\n").filter(Boolean).forEach(l => lines.push(l));
    } else {
      autoLines.slice(0, 3).forEach(l => lines.push(`• ${l}`));
    }
    if (sectionImgs.length > 0) {
      sectionImgs.slice(0, 2).forEach((url, i) => lines.push(`[Ảnh ${i + 1}](${toPublicImageUrl(url)})`));
    }
    lines.push("");
  }

  lines.push("⚠️ _Quay video khi giao + upload POD ngay sau GTC._");

  // Deep-link về Sổ tay SOP
  const step    = queryStep || "delivery";
  const clientQ = clientIds.length > 0 ? `&client=${clientIds[0]}` : "";
  const deepUrl = `${CANONICAL_BASE}/dashboard?step=${step}${clientQ}`;
  lines.push("");
  lines.push(`[ 📱 Xem hướng dẫn riêng khâu này ](${deepUrl})`);

  return lines.join("\n");
}

function formatMultipleReply(candidates) {
  const lines = ["🔍 Tìm thấy nhiều kết quả, gõ chính xác hơn:"];
  candidates.slice(0, 5).forEach(e => {
    const ids = extractClientId(e.content);
    lines.push(`• ${e.title}${ids.length ? ` (ID: ${ids[0]})` : ""}`);
  });
  return lines.join("\n");
}

// ── GTalk send ────────────────────────────────────────────────────────────────

async function sendReply(oaToken, channelId, text) {
  const res = await fetch(`${GTALK_BASE}/api/gtalk/send-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId,
      clientMsgId: String(Date.now()),
      content: { text, parseMode: "MARKDOWN" },
      oaToken,
    }),
  });
  const json = await res.json();
  if (json.errorCode !== "success") {
    throw new Error(`GTalk send error: ${json.error?.errorMessage}`);
  }
  return json.data;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  // GTalk webhook verification: GET với challenge token → trả lại challenge
  if (req.method === "GET") {
    const challenge = req.query.challenge || req.query.hub_challenge || req.query.token || "ok";
    return res.status(200).send(challenge);
  }

  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await getRawBody(req);

  // Verify HMAC nếu có secret
  const secret = process.env.GTALK_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySignature(req, rawBody, secret)) {
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }
  }

  console.log("[gtalk-webhook] raw body:", rawBody?.slice(0, 500));

  let payload;
  try { payload = JSON.parse(rawBody || "{}"); } catch {
    // GTalk test payload không phải JSON → trả 200 để pass verification
    console.log("[gtalk-webhook] non-JSON body, returning 200");
    return res.status(200).json({ ok: true, skipped: "non-json" });
  }

  // Chỉ xử lý text message (contentType 0), bỏ qua attachment, system messages
  if (payload.contentType !== 0) return res.status(200).json({ ok: true, skipped: true });

  const query   = (payload.content || "").trim();
  const chanId  = payload.channelId;
  const oaToken = process.env.GTALK_OA_TOKEN;

  // GTalk gửi test request với channelId "0" / senderId rỗng khi save config → trả 200 luôn
  if (!chanId || chanId === "0" || !payload.senderId) {
    console.log("[gtalk-webhook] GTalk test request detected, returning 200");
    return res.status(200).json({ ok: true, skipped: "validation-test" });
  }

  if (!oaToken) return res.status(503).json({ ok: false, error: "GTALK_OA_TOKEN chưa cấu hình" });
  if (!query || query.length < 2) return res.status(200).json({ ok: true, skipped: "too short" });

  // Bỏ qua tin nhắn từ chính OA (tránh loop)
  const oaId = process.env.GTALK_OA_ID;
  if (payload.senderId === oaId) return res.status(200).json({ ok: true, skipped: "self" });

  const [kb, notes] = await Promise.all([readBlob(KB_PATH), readBlob(NOTES_PATH)]);
  const entries  = Array.isArray(kb) ? kb : [];
  const notesMap = (notes && typeof notes === "object") ? notes : {};

  const result = findSOP(query, entries);
  let replyText;

  const queryStep = detectStep(query);

  if (!result) {
    replyText = `❓ Không tìm thấy SOP cho "${query}".\nGõ tên khách hàng (Aqua, LG, Smartlink...) hoặc Client ID.`;
  } else if (result._multiple) {
    replyText = formatMultipleReply(result._multiple);
  } else {
    replyText = formatSOPReply(result, notesMap[result.id], queryStep);
  }

  // ?test=1 → skip GTalk send, trả preview để kiểm tra format
  if (req.query.test === "1") {
    return res.status(200).json({ ok: true, dry_run: true, preview: replyText });
  }

  try {
    await sendReply(oaToken, chanId, replyText);
    return res.status(200).json({ ok: true, matched: !!result && !result._multiple, preview: replyText });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
}
