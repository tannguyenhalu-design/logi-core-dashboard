/**
 * pages/api/ftl-product-dimensions.js
 * GET a client's SKU dimension master (see lib/ftl-product-dimensions.js),
 * POST an Excel file to merge fresh dimension rows in — this is the "📐 Cập
 * nhật bảng kích thước sản phẩm" action, kept re-uploadable since AQUA
 * confirmed (2026-08-25) they maintain this list themselves as SKUs change.
 * Expects the same shape as AQUA's real "SP" sheet: headers containing
 * "Material No", Length/Width/Height (mm), CBM — column names matched
 * loosely (case/diacritic-insensitive substring) since the exact wording
 * ("Chiều dài/Length (mm)" etc.) has line breaks embedded in the header
 * cell in the real file.
 */
import * as XLSX from "xlsx";
import { getSession } from "../../lib/auth";
import { getAllProductDimensions, mergeProductDimensions } from "../../lib/ftl-product-dimensions";
import { logAction } from "../../lib/audit-log";

function hasFTLAccess(session) {
  return session.user.role === "manager" || (session.user.tabs || []).includes("ftl");
}

function normHeader(h) {
  return String(h || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findCol(headers, ...needles) {
  const idx = headers.findIndex((h) => needles.some((n) => normHeader(h).includes(n)));
  return idx;
}

function parseSpRows(grid) {
  const headerRowIdx = grid.findIndex((row) => row.some((c) => normHeader(c).includes("material no")));
  if (headerRowIdx === -1) throw new Error('Không tìm thấy dòng tiêu đề chứa "Material No" trong file.');
  const headers = grid[headerRowIdx].map(normHeader);

  const colMaterialNo = findCol(headers, "material no");
  const colDesc = findCol(headers, "material desp", "material description", "material desc");
  const colLength = findCol(headers, "length", "dài");
  const colWidth = findCol(headers, "width", "rộng");
  const colHeight = findCol(headers, "height", "cao");
  const colCbm = findCol(headers, "cbm");
  const colFloors = findCol(headers, "số tầng", "so tang", "floors");
  if (colMaterialNo === -1) throw new Error('Không xác định được cột "Material No".');

  const num = (v) => {
    const n = Number(String(v ?? "").replace(/,/g, "").trim());
    return isNaN(n) ? 0 : n;
  };

  return grid
    .slice(headerRowIdx + 1)
    .filter((row) => row[colMaterialNo])
    .map((row) => ({
      materialNo: String(row[colMaterialNo]).trim(),
      materialDesc: colDesc !== -1 ? String(row[colDesc] || "").trim() : "",
      lengthMm: colLength !== -1 ? num(row[colLength]) : 0,
      widthMm: colWidth !== -1 ? num(row[colWidth]) : 0,
      heightMm: colHeight !== -1 ? num(row[colHeight]) : 0,
      cbm: colCbm !== -1 ? num(row[colCbm]) : 0,
      floors: colFloors !== -1 ? num(row[colFloors]) : 0,
    }));
}

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!hasFTLAccess(session)) {
    return res.status(403).json({ error: "Bạn không có quyền xem Booking FTL" });
  }
  const actor = session.user.name || session.user.email || session.user.username;

  if (req.method === "GET") {
    try {
      const clientName = req.query.clientName ? String(req.query.clientName) : undefined;
      const dimensions = await getAllProductDimensions(clientName);
      return res.status(200).json({ ok: true, dimensions, count: dimensions.length });
    } catch (err) {
      console.error("[/api/ftl-product-dimensions] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { clientName, fileBase64 } = req.body || {};
      if (!clientName || !fileBase64) return res.status(400).json({ error: "Missing clientName or fileBase64" });

      const buffer = Buffer.from(fileBase64, "base64");
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheetName = wb.SheetNames.find((n) => normHeader(n).includes("sp")) || wb.SheetNames[0];
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });

      const records = parseSpRows(grid);
      if (records.length === 0) return res.status(400).json({ error: "Không đọc được dòng dữ liệu nào từ file." });

      const result = await mergeProductDimensions(clientName, records, actor);
      await logAction({ actor, action: "ftl_product_dimensions.merge", target: clientName, details: result });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      console.error("[/api/ftl-product-dimensions] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
