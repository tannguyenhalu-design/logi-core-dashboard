/**
 * GET /api/sop/image?b=<encoded-blob-url>
 * Stream private Vercel Blob ảnh SOP ra public (không cần user auth).
 * Dùng BLOB_READ_WRITE_TOKEN server-side để fetch, rồi pipe về client.
 */
export default async function handler(req, res) {
  let blobUrl = (req.query.b || "").trim().replace(/ /g, "");
  if (!blobUrl || !blobUrl.startsWith("https://")) {
    return res.status(400).end();
  }

  // Unwrap nếu là proxy URL (deployment cũ / double-proxy):
  //   https://xxx.vercel.app/api/sop/image?b=<encoded-blob>
  // → lấy inner blob URL thật
  while (blobUrl.includes("/api/sop/image?b=")) {
    try {
      const inner = decodeURIComponent(new URL(blobUrl.replace(/ /g, "")).searchParams.get("b") || "");
      if (!inner || !inner.startsWith("https://") || inner.replace(/ /g, "") === blobUrl) break;
      blobUrl = inner.trim().replace(/ /g, "");
    } catch { break; }
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(503).json({ error: "BLOB_READ_WRITE_TOKEN not configured" });
  }

  try {
    const upstream = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!upstream.ok) {
      console.error("[sop/image] upstream", upstream.status, blobUrl.slice(0, 80));
      return res.status(upstream.status).end();
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const buf = await upstream.arrayBuffer();
    return res.send(Buffer.from(buf));
  } catch (err) {
    console.error("[sop/image] error:", err?.message);
    return res.status(502).end();
  }
}
