/**
 * POST /api/upload-image
 * Body: { dataUrl: "data:image/png;base64,...", filename: "photo.jpg" }
 * Uploads to Vercel Blob at ops-images/<uuid>-<filename>, returns { url }.
 * Auth: manager + sd3 only.
 */
import { getSession } from "../../lib/auth";
import { put } from "@vercel/blob";

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

const ALLOWED_ROLES = ["manager", "sd3"];
const ALLOWED_MIME  = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/bmp"]);

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!ALLOWED_ROLES.includes(session.user.role)) return res.status(403).json({ error: "Forbidden" });

  const { dataUrl, filename } = req.body || {};
  if (!dataUrl || typeof dataUrl !== "string") return res.status(400).json({ error: "dataUrl required" });

  // Parse data URL — format: "data:<mime>;base64,<data>"
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Invalid dataUrl format" });

  const contentType = match[1];
  if (!ALLOWED_MIME.has(contentType)) return res.status(400).json({ error: `Không hỗ trợ định dạng: ${contentType}` });

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > 10 * 1024 * 1024) return res.status(400).json({ error: "Ảnh tối đa 10MB" });

  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  const safeName = String(filename || "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const blobPath = `ops-images/${uid()}-${safeName}.${ext}`;

  const blob = await put(blobPath, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
  });

  return res.status(200).json({ ok: true, url: blob.url });
}
