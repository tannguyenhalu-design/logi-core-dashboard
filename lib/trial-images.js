/**
 * lib/trial-images.js — photos of a Sổ tay phase (KẾ HOẠCH B, 28/09).
 * Stored in the PRIVATE Vercel Blob store under trials/<phaseId>/…; the
 * browser compresses to ≤ 1.600px JPEG before upload and reads them back
 * through /api/trials?image=… (logged-in Manager / SD3 only). The list of a
 * phase's photos (path, caption, who, when) lives in its sheet row.
 */
import { put, get, del } from "@vercel/blob";

export const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // after compression; the API body limit is 4 MB
const ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("Ảnh không hợp lệ (chỉ nhận JPG / PNG / WEBP)");
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) throw new Error("Ảnh rỗng");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Ảnh quá lớn sau khi nén (tối đa 2,5 MB)");
  return { contentType: m[1], buf, ext: ALLOWED[m[1]] };
}

export async function uploadPhaseImage(phaseId, dataUrl) {
  const { contentType, buf, ext } = decodeDataUrl(dataUrl);
  const safeId = String(phaseId).replace(/[^A-Za-z0-9-]/g, "");
  const path = `trials/${safeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await put(path, buf, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType });
  return { path, bytes: buf.length, contentType };
}

export const isImagePath = (p) => /^trials\/[A-Za-z0-9-]+\/[A-Za-z0-9.-]+\.(jpg|png|webp)$/.test(String(p || ""));

export async function readPhaseImage(path) {
  if (!isImagePath(path)) throw new Error("Đường dẫn ảnh không hợp lệ");
  const res = await get(path, { access: "private", useCache: false });
  if (!res || !res.stream) return null;
  const buf = Buffer.from(await new Response(res.stream).arrayBuffer());
  const contentType = res.blob?.contentType || (path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg");
  return { buf, contentType };
}

export async function deletePhaseImage(path) {
  if (!isImagePath(path)) throw new Error("Đường dẫn ảnh không hợp lệ");
  await del(path).catch(() => {}); // already gone is fine
}
