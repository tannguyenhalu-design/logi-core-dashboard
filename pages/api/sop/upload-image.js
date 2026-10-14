/**
 * POST /api/sop/upload-image?filename=photo.jpg
 * Body: raw image bytes, Content-Type: image/*
 * Auth: manager only
 */
import { put } from "@vercel/blob";
import { getSession } from "../../../lib/auth";

export const config = { api: { bodyParser: false } };

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ ok: false });
  if (session.user.role !== "manager") {
    return res.status(403).json({ ok: false, error: "Chỉ Manager được upload" });
  }

  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (!ct.startsWith("image/")) {
    return res.status(400).json({ ok: false, error: "Chỉ chấp nhận file ảnh" });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_SIZE) {
      return res.status(413).json({ ok: false, error: "File vượt quá 5MB" });
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const rawName = (req.query.filename || "image.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  try {
    const blob = await put(`sop-images/${rawName}`, buffer, {
      access: "private",
      contentType: ct,
      addRandomSuffix: true,
    });
    // Trả về raw blob URL — frontend/GTalk tự wrap qua proxy khi hiển thị
    return res.status(200).json({ ok: true, url: blob.url });
  } catch (err) {
    console.error("[upload-image] put() error:", err?.message);
    return res.status(500).json({ ok: false, error: err?.message || "Lỗi upload Blob" });
  }
}
