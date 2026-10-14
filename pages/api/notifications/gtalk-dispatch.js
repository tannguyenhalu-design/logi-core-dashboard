/**
 * POST /api/notifications/gtalk-dispatch
 * Nhận event đơn hàng → map client_id → SOP → format cảnh báo → bắn DM GTalk đến NVGH
 *
 * Payload:
 *   { order_code, client_id, delivery_staff_gtalk_id, status }
 *
 * Env required:
 *   GTALK_OA_ID    — Official Account ID của hệ thống
 *   GTALK_OA_TOKEN — "{username}:{password}" (GTalk OA credentials)
 */
import { getSession } from "../../../lib/auth";
import { get } from "@vercel/blob";

const KB_PATH    = "sops-knowledge.json";
const NOTES_PATH = "sop-delivery-notes.json";
const GTALK_BASE = "https://mbff.ghn.vn";

const KHO_KW  = ["check-in", "tiếp nhận hàng", "chất xếp", "niêm phong", "ngoại quan",
                  "tem seal", "mút eva", "nẹp góc", "quay video", "seal", "thùng",
                  "móp", "rách", "băng keo", "nguyên vẹn", "nhận hàng", "kiểm đếm"];
const VT_KW   = ["xe 1t9", "xe 5t", "xe 8t", "cbm", "cut-off", "điều xe", "tài xế",
                  "bks", "cccd", "áo phản quang", "ftl", "ltl", "ghép chuyến",
                  "xếp tầng", "trung chuyển", "xe tải"];
const GIAO_KW = ["điểm giao", "booking giờ", "tttm", "siêu thị", "điện máy xanh", "đmx",
                  "cao phong", "nguyễn kim", "epod", "pod ", "ký nhận", "đồng kiểm",
                  "biên bản", "thu hồi chứng từ", "lệnh xuất", "phiếu xuất", "hóa đơn",
                  "chứng từ", "hoàn tất", "upload ảnh"];

function scoreKw(line, kw) {
  const l = line.toLowerCase();
  return kw.filter(k => l.includes(k)).length;
}

function parseGiaoLines(content) {
  return content.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 15 && !/^#{1,3}\s/.test(l))
    .map(l => l.replace(/^\d+\.\s*/, "").replace(/^[-*•]\s*/, ""))
    .filter(l => scoreKw(l, GIAO_KW) > 0)
    .slice(0, 4);
}

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

// ── GTalk API helpers ──────────────────────────────────────────────────────────

async function gtalkRequest(path, body) {
  const res = await fetch(`${GTALK_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GTalk HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errorCode !== "success") {
    throw new Error(`GTalk API error [${json.errorCode}]: ${json.error?.errorMessage || json.errorCode}`);
  }
  return json.data;
}

async function getDMChannelId(oaId, oaToken, employeeId) {
  const data = await gtalkRequest("/api/gtalk/create-server-direct-channel", {
    oaId,
    oaToken,
    identity: {
      identityChannel: 1,
      identityId: String(employeeId),
    },
  });
  return data.channelId;
}

async function sendGtalkMessage(oaToken, channelId, text) {
  return gtalkRequest("/api/gtalk/send-message", {
    channelId,
    clientMsgId: String(Date.now()),
    content: { text, parseMode: "MARKDOWN" },
    oaToken,
  });
}

// ── Message builder ────────────────────────────────────────────────────────────

function buildMessage(entry, manualNote, orderCode, imageUrls) {
  const giaoLines = parseGiaoLines(entry.content || "");
  const overrideNote = manualNote?.diem_giao || "";

  const lines = [];
  lines.push(`🚛 **Đơn ${orderCode}** — ${entry.title}`);
  lines.push("");
  lines.push("📋 **Lưu ý điểm giao:**");

  if (overrideNote) {
    lines.push(overrideNote);
  } else if (giaoLines.length > 0) {
    giaoLines.forEach(l => lines.push(`• ${l}`));
  } else {
    lines.push("(Chưa có ghi chú điểm giao cho khách hàng này)");
  }

  if (imageUrls && imageUrls.length > 0) {
    lines.push("");
    lines.push("🖼 **Ảnh hướng dẫn điểm giao:**");
    imageUrls.slice(0, 4).forEach((url, i) => lines.push(`[Ảnh ${i + 1}](${url})`));
  }

  lines.push("");
  lines.push("⚠️ _BẮT BUỘC quay video khi giao + upload POD ngay sau GTC._");

  return lines.join("\n");
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  // delivery_staff_id: mã nhân viên GHN (identityId trong GTalk)
  const { order_code, client_id, delivery_staff_id, status } = req.body || {};

  if (!order_code || !client_id) {
    return res.status(400).json({ ok: false, error: "Thiếu order_code hoặc client_id" });
  }

  if (status !== "delivering") {
    return res.status(200).json({ ok: true, skipped: true, reason: "status không phải delivering" });
  }

  const oaId    = process.env.GTALK_OA_ID;
  const oaToken = process.env.GTALK_OA_TOKEN;
  if (!oaId || !oaToken) {
    return res.status(503).json({ ok: false, error: "GTALK_OA_ID hoặc GTALK_OA_TOKEN chưa được cấu hình" });
  }

  if (!delivery_staff_id) {
    return res.status(400).json({ ok: false, error: "Thiếu delivery_staff_id (mã nhân viên GHN)" });
  }

  const [kb, notes] = await Promise.all([readBlob(KB_PATH), readBlob(NOTES_PATH)]);
  const entries  = Array.isArray(kb) ? kb : [];
  const notesMap = (notes && typeof notes === "object") ? notes : {};

  const match = entries.find(e => {
    const m = (e.content || "").match(/Client\s*ID[:\s]+(\d+)/i);
    return m && m[1] === String(client_id);
  });

  let msgText;
  if (!match) {
    msgText = `🚛 **Đơn ${order_code}** — Đang giao\n⚠️ Không tìm thấy SOP cho client ID ${client_id}. Vui lòng liên hệ CS kiểm tra.`;
  } else {
    const entryNotes  = notesMap[match.id] || {};
    const giaoImgUrls = entryNotes.image_urls?.diem_giao || [];
    msgText = buildMessage(match, entryNotes, order_code, giaoImgUrls);
  }

  try {
    const channelId = await getDMChannelId(oaId, oaToken, delivery_staff_id);
    const gtalkData = await sendGtalkMessage(oaToken, channelId, msgText);

    return res.status(200).json({
      ok: true,
      matched: !!match,
      sop_id: match?.id || null,
      gtalk_channel_id: channelId,
      gtalk_msg_id: gtalkData?.globalMsgId || null,
      message_preview: msgText.slice(0, 200),
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: `GTalk dispatch thất bại: ${err.message}`,
      order_code,
      client_id,
      delivery_staff_id,
    });
  }
}
