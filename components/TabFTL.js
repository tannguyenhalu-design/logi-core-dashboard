/**
 * components/TabFTL.js — FTL (Full Truck Load) operations tab.
 * Data source: "raw_ftl_orders", scoped to Điện Máy clients only. Polls
 * /api/ftl-data every 5 min for near-realtime updates.
 *
 * As of 2026-08-27, raw_ftl_orders is populated by manually running
 * cloud-scraper/sync_ftl_order_sheet.js against the "FTL_order" tab of the
 * xlsx export GHN's tech team provides (a periodically-synced Google Sheet) —
 * NOT by CDP-scraping portal.ghn.vn anymore (per user instruction: no more
 * browser-automation access to internal GHN portals). The old
 * ftl_scraper.py/30-min cron + ftl_enrich_vehicle.py + the "Đồng bộ ngay từ
 * GHN" button are retired; see cloud-scraper/crontab.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import KpiCard from "./KpiCard";
import TruckLoader from "./TruckLoader";
import { vehicleTypesOf } from "../lib/transform-ftl-live";
import { downloadCSV } from "../lib/csv-export";
import { regionOf } from "../lib/vn-regions";
import { FTL_PORTAL_DM_CLIENTS } from "../lib/dm-clients";

const POLL_MS = 5 * 60 * 1000;

const STATUS_COLOR = {
  "Giao thành công": "text-green",
  "Đang vận chuyển": "text-cyan",
  "Đã tạo": "text-amber",
  "Đã giao một phần": "text-amber",
  "Hủy đơn": "text-red",
  "Lấy thành công": "text-cyan",
  "Giao thất bại": "text-red",
};

// "Đang xử lý" is the group that needs active attention (chuyến còn đang
// chạy) so it gets red — more urgent than "Hủy đơn", which already
// happened and needs no more action, just amber for visibility.
const GROUP_LABEL = { done: "Hoàn tất", processing: "Đang xử lý", issue: "Hủy đơn" };
const GROUP_COLOR = { done: "var(--green)", processing: "var(--red)", issue: "var(--amber)" };

function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

// A multi-stop trip's delivery_address is a ";"-joined string of every
// stop — for a 4-drop route that can run to several hundred characters and
// blow a table row up to many wrapped lines. Show just the first stop with
// a "+N điểm" badge; the full list is one hover away via the title tooltip
// instead of always being spelled out on-screen.
function AddressCell({ value, maxWidth = 320, light = false }) {
  const parts = String(value || "").split(";").map((s) => s.trim()).filter(Boolean);
  const mutedColor = light ? "rgba(255,255,255,0.75)" : "var(--text-muted)";
  const badgeBorder = light ? "rgba(255,255,255,0.45)" : "var(--border)";
  if (parts.length === 0) return <span style={{ color: mutedColor }}>—</span>;
  return (
    <span title={parts.join("\n")} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth }}>{parts[0]}</span>
      {parts.length > 1 && (
        <span style={{ flex: "none", fontSize: 10, color: mutedColor, border: `1px solid ${badgeBorder}`, borderRadius: 4, padding: "0 4px" }}>
          +{parts.length - 1} điểm
        </span>
      )}
    </span>
  );
}

// Tab "Điểm giao theo khách" — trả lời câu hỏi "chuyến điện máy của khách X
// thường giao đến tỉnh nào nhiều nhất, bao nhiêu %, và mấy chuyến mỗi loại
// xe" (yêu cầu người dùng 2026-08-25). Dữ liệu đã tính sẵn ở
// lib/transform-ftl-live.js (destinationBreakdown), tab này chỉ hiển thị.
function DestinationBreakdown({ data, fmt }) {
  const breakdown = data?.destinationBreakdown || [];
  // { groupKey, kind: 'region'|'province', value } — bấm lại đúng ô đang mở để đóng lại.
  const [selected, setSelected] = useState(null);

  const selectedGroup = selected ? breakdown.find((c) => c.clientName === selected.groupKey) : null;
  const detailOrders = useMemo(() => {
    if (!selected || !selectedGroup || !data?.orders) return [];
    return data.orders.filter((o) => {
      if (o.status === "Hủy đơn") return false;
      if (o.clientName !== selectedGroup.rawClientName) return false;
      if (selectedGroup.pickupRegion && regionOf(o.pickupProvince) !== selectedGroup.pickupRegion) return false;
      if (selected.kind === "region") return regionOf(o.deliveryProvince) === selected.value;
      return (o.deliveryProvince || "(chưa rõ)") === selected.value;
    });
  }, [selected, selectedGroup, data]);

  if (breakdown.length === 0) {
    return (
      <div className="chart-panel" style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>
        Không có dữ liệu trong khoảng đang lọc.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Mỗi khách: gộp theo Miền (nếu giao cả 2 miền trở lên), rồi chi tiết tỉnh giao hàng phổ biến nhất kèm % số chuyến, breakdown theo loại xe, và địa chỉ giao cụ thể hay gặp nhất tại tỉnh đó. Bấm vào 1 ô Miền hoặc 1 tỉnh để xem đúng danh sách chuyến + địa chỉ.
      </div>
      {breakdown.map((client) => (
        <div key={client.clientName} className="chart-panel" style={{ padding: 0 }}>
          <div className="chart-panel-title" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <span>{client.clientName}</span>
            <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)" }}>— {fmt(client.totalOrders)} chuyến trong khoảng đang lọc</span>
          </div>
          {client.regions.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "0 20px 14px" }}>
              {client.regions.map((r) => {
                const isSelected = selected?.groupKey === client.clientName && selected?.kind === "region" && selected?.value === r.region;
                return (
                <div
                  key={r.region}
                  onClick={() => setSelected(isSelected ? null : { groupKey: client.clientName, kind: "region", value: r.region })}
                  style={{
                    flex: "1 1 200px", minWidth: 180, background: isSelected ? "rgba(var(--brand-rgb),0.15)" : "var(--panel-glow)",
                    border: isSelected ? "1px solid var(--cyan)" : "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 14px", cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{r.region}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--cyan)" }}>
                    {fmt(r.count)} <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>chuyến ({r.pct}%)</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                    {Object.entries(r.byVehicleType).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                      <span key={type} style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 12,
                        background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                      }}>
                        {type}: {n}
                      </span>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 20px 18px" }}>
            {client.provinces.slice(0, 8).map((p, idx) => {
              const isSelected = selected?.groupKey === client.clientName && selected?.kind === "province" && selected?.value === p.province;
              return (
              <div
                key={p.province}
                onClick={() => setSelected(isSelected ? null : { groupKey: client.clientName, kind: "province", value: p.province })}
                style={{
                  display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                  padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                  background: isSelected ? "rgba(var(--brand-rgb),0.15)" : idx === 0 ? "rgba(var(--brand-rgb),0.08)" : "var(--panel-glow)",
                  border: isSelected ? "1px solid var(--cyan)" : idx === 0 ? "1px solid rgba(var(--brand-rgb),0.3)" : "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 150 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: idx === 0 ? "var(--cyan)" : "var(--text-primary)" }}>
                    {idx === 0 && "🥇 "}{p.province}
                  </div>
                  {p.topAddress && (
                    <div title={p.topAddress.address} style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.topAddress.address} ({p.topAddress.count} chuyến)
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>
                  {fmt(p.count)} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>chuyến</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: idx === 0 ? "var(--cyan)" : "var(--text-secondary)" }}>
                  {p.pct}%
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginLeft: "auto" }}>
                  {Object.entries(p.byVehicleType).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                    <span key={type} style={{
                      fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 14,
                      background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                    }}>
                      {type}: {n} chuyến
                    </span>
                  ))}
                </div>
              </div>
              );
            })}
            {client.provinces.length > 8 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>+ {client.provinces.length - 8} tỉnh khác (số chuyến ít hơn)</div>
            )}
          </div>

          {selected?.groupKey === client.clientName && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "14px 20px 18px" }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
                {selected.kind === "region" ? `Miền ${selected.value.replace("Miền ", "")}` : selected.value} — {detailOrders.length} chuyến
              </div>
              <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                      <th style={{ padding: "6px 10px" }}>Mã đơn</th>
                      <th style={{ padding: "6px 10px" }}>Ngày tạo</th>
                      <th style={{ padding: "6px 10px" }}>Trạng thái</th>
                      <th style={{ padding: "6px 10px" }}>Loại xe</th>
                      <th style={{ padding: "6px 10px" }}>Tỉnh lấy</th>
                      <th style={{ padding: "6px 10px" }}>Địa chỉ giao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailOrders.map((o) => (
                      <tr key={o.orderCode} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 10px", fontWeight: 600 }}>{o.orderCode}</td>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{o.createdDate}</td>
                        <td style={{ padding: "6px 10px", color: `var(--${(STATUS_COLOR[o.status] || "text-cyan").replace("text-", "")})` }}>{o.status}</td>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{o.vehicleCapacity || "—"}</td>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{o.pickupProvince || "—"}</td>
                        <td style={{ padding: "6px 10px", maxWidth: 340 }}><AddressCell value={o.deliveryAddress} /></td>
                      </tr>
                    ))}
                    {detailOrders.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: "10px", color: "var(--text-muted)" }}>Không tìm thấy chuyến khớp — thử bấm lại ô này.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Same normalize/match logic as lib/ftl-difficult-addresses.js's
// normalizeAddress/findMatches, duplicated here (not imported) because
// that file also pulls in "./sheets" (googleapis/fs — Node-only) at module
// scope, which would break this client bundle. Kept tiny and in sync by
// hand rather than worth a shared client-safe module for this much logic.
function normalizeAddressClient(address) {
  return String(address || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Cùng logic "khớp theo cụm >=3 từ liên tiếp" với
// lib/ftl-difficult-addresses.js's addressesLikelyMatch — xem comment ở đó.
const MIN_SHARED_WORDS_CLIENT = 3;
function addressesLikelyMatchClient(normA, normB) {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const wordsA = normA.split(" ").filter(Boolean);
  const wordsB = normB.split(" ").filter(Boolean);
  if (wordsA.length < MIN_SHARED_WORDS_CLIENT || wordsB.length < MIN_SHARED_WORDS_CLIENT) {
    return normA.includes(normB) || normB.includes(normA);
  }
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, normB] : [wordsB, normA];
  for (let i = 0; i <= shorter.length - MIN_SHARED_WORDS_CLIENT; i++) {
    const gram = shorter.slice(i, i + MIN_SHARED_WORDS_CLIENT).join(" ");
    if (longer.includes(gram)) return true;
  }
  return false;
}
function findAddressWarningsClient(addressText, difficultAddresses) {
  const needle = normalizeAddressClient(addressText);
  if (!needle) return [];
  return difficultAddresses.filter((e) => e.addressNormalized && addressesLikelyMatchClient(needle, e.addressNormalized));
}

const BOOKING_STATUS_COLOR = {
  "Mới": "var(--amber)",
  "Đã xác nhận xe": "var(--cyan)",
  "Đã lên đơn GHN": "var(--green)",
  "Hoàn tất": "var(--green)",
  "Huỷ": "var(--red)",
};
const BOOKING_STATUS_ORDER = ["Mới", "Đã xác nhận xe", "Đã lên đơn GHN", "Hoàn tất", "Huỷ"];

const EMPTY_BOOKING_FORM = {
  clientName: "", pickupDate: "", pickupAddress: "", deliveryDate: "", deliveryAddress: "",
  quantity: "", weightKg: "", cargoHeightCm: "", vehicleTypeRequested: "", specialNotes: "", sourceLink: "",
};

// Tab "Booking FTL" — theo yêu cầu người dùng (2026-08-25): thay thế việc
// CS phải VLOOKUP/copy tay booking rải rác từ nhiều link Zalo nhỏ lẻ vào 1
// link chung cho OPS/GSVT/SD check — giờ tất cả đọc/ghi chung 1 danh sách ở
// đây. Không giới hạn theo canSeeDestinationTab như "Điểm giao theo khách"
// — CS cần quyền tạo/sửa booking, chỉ cần đã được cấp tab "ftl" (server
// cũng tự kiểm tra lại điều này ở /api/ftl-bookings, không chỉ ẩn ở UI).
function fmtNum2(n) {
  const num = Number(n);
  if (!num) return "0";
  return num.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

// Sum/merge only what's numeric — deliberately conservative on the softer
// fields (address, ship-to name) since combining 2 DN groups whose
// delivery points genuinely differ is a real mistake to flag, not paper
// over silently.
function mergeStagedGroups(selected) {
  const addresses = [...new Set(selected.map((g) => g.deliveryAddress).filter(Boolean))];
  const shipToNames = [...new Set(selected.map((g) => g.shipToName).filter(Boolean))];
  const notesParts = [...new Set(selected.flatMap((g) => (g.specialNotes ? [g.specialNotes] : [])))];
  if (addresses.length > 1) notesParts.push(`⚠️ Gộp từ ${selected.length} DN có địa chỉ giao KHÁC NHAU — kiểm tra lại trước khi lên đơn`);
  const missing = [...new Set(selected.flatMap((g) => g.missingDimensionSkus || []))];
  return {
    _key: `merged-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    dnNo: selected.map((g) => g.dnNo).join(", "),
    clientName: selected[0].clientName,
    shipToName: shipToNames.join(" / "),
    deliveryAddress: addresses[0] || "",
    deliveryDate: selected[0].deliveryDate,
    totalQty: selected.reduce((s, g) => s + (g.totalQty || 0), 0),
    totalCbm: Math.round(selected.reduce((s, g) => s + (g.totalCbm || 0), 0) * 100) / 100,
    totalWeightKgEquiv: Math.round(selected.reduce((s, g) => s + (g.totalWeightKgEquiv || 0), 0) * 100) / 100,
    maxItemHeightMm: Math.max(...selected.map((g) => g.maxItemHeightMm || 0)),
    suggestedVehicleType: "(gộp — cần OPS xác nhận lại)",
    missingDimensionSkus: missing,
    specialNotes: notesParts.join(" · "),
    selected: false,
  };
}

function BookingFTL() {
  const [bookings, setBookings] = useState([]);
  const [difficultAddresses, setDifficultAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_BOOKING_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");

  // ── Excel import (primary flow) ──
  const fileInputRef = React.useRef(null);
  const [clientNameHint, setClientNameHint] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importMeta, setImportMeta] = useState(null); // {mode, fileName, rowsInFile, truncated, aiProvider, unmatchedRowCount}
  const [stagedGroups, setStagedGroups] = useState(null); // deterministic mode
  const [stagedAiRows, setStagedAiRows] = useState(null); // ai-parse mode
  const [savingImport, setSavingImport] = useState(false);

  // ── Reference data settings (vehicle specs / SKU dimension master) — so
  // OPS can keep these current themselves (AQUA updates their SKU list
  // regularly) without needing a developer to re-seed the sheet by hand. ──
  const [showRefSettings, setShowRefSettings] = useState(false);
  const [refDimClient, setRefDimClient] = useState("AQUA B2B");
  const [refUploading, setRefUploading] = useState(null); // "specs" | "dimensions" | null
  const [refMsg, setRefMsg] = useState("");

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // Vehicle-spec file expected shape matches AQUA's real "Kích thước xe"
  // sheet: "Dòng xe", "kích thước lọt lòng thùng xe (D - R - C)", "Tải
  // trọng chuyên chở", "Số khối thùng xe", "Số CBM an toàn (85%)",
  // "Diện tích sàn", "85% DT sàn" — parsed client-side (small file, no
  // dimension-master lookup needed) then POSTed as structured specs[].
  const handleVehicleSpecsUpload = async (file) => {
    if (!file) return;
    setRefUploading("specs");
    setRefMsg("");
    try {
      const XLSX = await import("xlsx");
      const base64 = await fileToBase64(file);
      const wb = XLSX.read(base64, { type: "base64" });
      const ws = wb.Sheets[wb.SheetNames.find((n) => n.toLowerCase().includes("kích thước") || n.toLowerCase().includes("kich thuoc")) || wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
      const specs = grid.slice(1)
        .filter((r) => String(r[1] || "").includes("x"))
        .map((r) => {
          const [l, w, h] = String(r[1]).split("x").map((s) => parseFloat(s.trim()) || 0);
          const cbmCapacity = parseFloat(r[3]) || 0;
          const vehicleTypeClass = cbmCapacity < 20 ? "1.9T" : cbmCapacity < 40 ? "5T" : "8T";
          return {
            vehicleModel: r[0] || `${l}x${w}x${h}`, vehicleTypeClass,
            interiorLengthMm: l, interiorWidthMm: w, interiorHeightMm: h,
            payloadKg: parseFloat(r[2]) || 0, cbmCapacity, safeCbm85: parseFloat(r[4]) || 0,
            floorAreaM2: parseFloat(r[5]) || 0, safeFloorArea85: parseFloat(r[6]) || 0,
          };
        });
      if (!specs.length) throw new Error("Không đọc được dòng xe nào từ file.");
      const res = await fetch("/api/ftl-vehicle-specs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specs }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi lưu");
      setRefMsg(`✅ Đã cập nhật ${json.count} dòng xe.`);
    } catch (e) {
      setRefMsg("Lỗi: " + e.message);
    } finally {
      setRefUploading(null);
    }
  };

  const handleDimensionsUpload = async (file) => {
    if (!file || !refDimClient.trim()) return;
    setRefUploading("dimensions");
    setRefMsg("");
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch("/api/ftl-product-dimensions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientName: refDimClient.trim(), fileBase64 }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi lưu");
      setRefMsg(`✅ ${refDimClient}: ${json.total} SKU (${json.newCount} mới, ${json.updatedCount} cập nhật).`);
    } catch (e) {
      setRefMsg("Lỗi: " + e.message);
    } finally {
      setRefUploading(null);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setStagedGroups(null);
    setStagedAiRows(null);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/ftl-bookings-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, fileName: file.name, clientNameHint: clientNameHint.trim() }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi đọc file");
      setImportMeta({ mode: json.mode, fileName: file.name, rowsInFile: json.rowsInFile, truncated: json.truncated, aiProvider: json.aiProvider, unmatchedRowCount: json.unmatchedRowCount });
      if (json.mode === "deterministic") {
        setStagedGroups(json.groups.map((g) => ({ ...g, _key: g.dnNo, selected: false })));
      } else {
        setStagedAiRows(json.rows.map((r, i) => ({ ...r, _key: `ai-${i}` })));
      }
    } catch (e) {
      setImportError(e.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleGroup = (key) => setStagedGroups((prev) => prev.map((g) => (g._key === key ? { ...g, selected: !g.selected } : g)));
  const removeGroup = (key) => setStagedGroups((prev) => prev.filter((g) => g._key !== key));
  const mergeSelectedGroups = () => {
    setStagedGroups((prev) => {
      const selected = prev.filter((g) => g.selected);
      if (selected.length < 2) return prev;
      const merged = mergeStagedGroups(selected);
      return [merged, ...prev.filter((g) => !g.selected)];
    });
  };

  const saveStagedGroups = async () => {
    if (!stagedGroups?.length) return;
    setSavingImport(true);
    try {
      const bookings = stagedGroups.map((g) => ({
        clientName: g.clientName,
        deliveryDate: g.deliveryDate,
        deliveryAddress: g.deliveryAddress,
        quantity: g.totalQty,
        weightKg: g.totalWeightKgEquiv,
        cargoHeightCm: "",
        vehicleTypeRequested: "",
        specialNotes: [g.shipToName && `Ship-to: ${g.shipToName}`, g.missingDimensionSkus?.length > 0 && `⚠️ Thiếu kích thước ${g.missingDimensionSkus.length} SKU: ${g.missingDimensionSkus.slice(0, 5).join(", ")}`, g.specialNotes].filter(Boolean).join(" · "),
        sourceLink: `📎 ${importMeta?.fileName || ""}`,
        dnNumbers: g.dnNo,
        totalCbm: g.totalCbm,
        totalWeightKgEquiv: g.totalWeightKgEquiv,
        maxItemHeightMm: g.maxItemHeightMm,
        suggestedVehicleType: g.suggestedVehicleType,
      }));
      const res = await fetch("/api/ftl-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookings }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi lưu booking");
      setStagedGroups(null);
      setImportMeta(null);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingImport(false);
    }
  };

  const editAiRow = (key, field, value) => setStagedAiRows((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
  const removeAiRow = (key) => setStagedAiRows((prev) => prev.filter((r) => r._key !== key));
  const saveAiRows = async () => {
    if (!stagedAiRows?.length) return;
    setSavingImport(true);
    try {
      const bookings = stagedAiRows.map(({ _key, ...r }) => ({ ...r, sourceLink: `📎 ${importMeta?.fileName || ""}` }));
      const res = await fetch("/api/ftl-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookings }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi lưu booking");
      setStagedAiRows(null);
      setImportMeta(null);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingImport(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ftl-bookings");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi tải booking");
      setBookings(json.bookings || []);
      setDifficultAddresses(json.difficultAddresses || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60 * 1000); // dữ liệu cộng tác nhiều người sửa — làm mới thường xuyên hơn các tab chỉ-xem khác
    return () => clearInterval(interval);
  }, [load]);

  const formDeliveryWarnings = useMemo(
    () => findAddressWarningsClient(form.deliveryAddress, difficultAddresses),
    [form.deliveryAddress, difficultAddresses]
  );

  const submitBooking = async (e) => {
    e.preventDefault();
    if (!form.clientName.trim() || !form.deliveryAddress.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ftl-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi lưu booking");
      setForm(EMPTY_BOOKING_FORM);
      setShowAddModal(false);
      await load();
    } catch (e2) {
      alert(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (id, status) => {
    setBusyId(id);
    try {
      await fetch("/api/ftl-bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const saveBookingField = async (id, field, value) => {
    setBusyId(id);
    try {
      await fetch("/api/ftl-bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, fields: { [field]: value } }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const flagDifficult = async (booking) => {
    const reason = prompt(`Ghi chú vì sao địa chỉ này khó giao (VD: "Cấm tải, cần tăng bo"):`, "");
    if (reason === null) return;
    await fetch("/api/ftl-difficult-addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: booking.deliveryAddress, reason }),
    });
    await load();
  };

  const unflagDifficult = async (addressNormalized) => {
    if (!confirm("Bỏ đánh dấu địa chỉ khó giao này?")) return;
    await fetch("/api/ftl-difficult-addresses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addressNormalized }),
    });
    await load();
  };

  const removeBooking = async (id) => {
    if (!confirm("Xoá booking này?")) return;
    setBusyId(id);
    try {
      await fetch("/api/ftl-bookings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const newCount = bookings.filter((b) => b.status === "Mới").length;
  const visibleBookings = (statusFilter ? bookings.filter((b) => b.status === statusFilter) : bookings)
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
        <TruckLoader size={72} label="Đang tải booking..." />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div style={{ background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", borderRadius: 10, padding: 16, color: "var(--red)" }}>
          Lỗi: {error}
        </div>
      )}

      {newCount > 0 && (
        <div style={{ background: "#c2410c", border: "2px solid #9a3412", borderRadius: 10, padding: 16, color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
          🟠 {newCount} booking "Mới" chưa được xác nhận xe — cần GSVT/OPS check
        </div>
      )}

      {/* Excel upload — primary CS entry point (2026-08-25: manual form
          alone still means retyping every field by hand, same tedious work
          as the VLOOKUP process this tab replaces). File never gets saved
          straight to FTLBookings — always lands in an editable staging
          table below first. */}
      <div className="chart-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>📥 Tải file Excel booking lên</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Khách hàng (nếu file không rõ)</div>
            <input list="ftl-booking-clients" value={clientNameHint} onChange={(e) => setClientNameHint(e.target.value)} placeholder="VD: AQUA B2B" style={{ ...inputStyle, width: 200 }} />
            <datalist id="ftl-booking-clients">
              {[...FTL_PORTAL_DM_CLIENTS].map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
              disabled={importing}
              style={{ fontSize: 13, color: "var(--text-secondary)" }}
            />
          </div>
          {importing && <TruckLoader size={28} label="Đang đọc file..." />}
        </div>
        {importError && (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 12 }}>
            Lỗi: {importError}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--panel-glow)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          + Nhập tay 1 booking
        </button>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">Tất cả trạng thái ({bookings.length})</option>
          {BOOKING_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{s} ({bookings.filter((b) => b.status === s).length})</option>
          ))}
        </select>
        <button
          onClick={() => downloadCSV(`Booking FTL - ${new Date().toISOString().slice(0, 10)}.csv`, [
            { label: "Khách hàng", value: "clientName" }, { label: "Trạng thái", value: "status" },
            { label: "Ngày giao", value: "deliveryDate" }, { label: "Địa chỉ giao", value: "deliveryAddress" },
            { label: "Số lượng", value: "quantity" }, { label: "Tổng CBM", value: "totalCbm" },
            { label: "Tổng kg quy đổi", value: "totalWeightKgEquiv" }, { label: "Xe gợi ý", value: "suggestedVehicleType" },
            { label: "Xe xác nhận", value: "vehicleTypeRequested" }, { label: "Biển số", value: "plate" },
            { label: "Tài xế", value: "driverName" }, { label: "Mã đơn GHN", value: "linkedOrderCode" },
            { label: "Ghi chú", value: "specialNotes" }, { label: "Tạo bởi", value: "createdBy" },
          ], visibleBookings)}
          disabled={!visibleBookings.length}
          style={{
            marginLeft: "auto", padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--panel-glow)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600,
            cursor: visibleBookings.length ? "pointer" : "not-allowed", fontFamily: "inherit",
          }}
        >
          ⬇️ Xuất Excel/CSV
        </button>
      </div>

      {/* Staging table — deterministic (AQUA) import: grouped by DN No.,
          real CBM/kg-quy-đổi math already computed server-side. */}
      {stagedGroups && (
        <div className="chart-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            📊 Xem trước từ file "{importMeta?.fileName}" — {stagedGroups.length} chuyến (gộp theo DN No., tự tính CBM/kg quy đổi thật)
          </div>
          {importMeta?.unmatchedRowCount > 0 && (
            <div style={{ fontSize: 12, color: "var(--amber)" }}>⚠️ {importMeta.unmatchedRowCount} dòng trong file không có DN No., đã bỏ qua.</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={mergeSelectedGroups} disabled={stagedGroups.filter((g) => g.selected).length < 2} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--cyan)", background: "rgba(var(--brand-rgb),0.1)", color: "var(--cyan)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Gộp các DN đã chọn thành 1 booking
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                  <th style={{ padding: "4px 6px" }}></th>
                  <th style={{ padding: "4px 6px" }}>DN No.</th>
                  <th style={{ padding: "4px 6px" }}>Ship-to</th>
                  <th style={{ padding: "4px 6px" }}>Ngày giao</th>
                  <th style={{ padding: "4px 6px" }}>SL</th>
                  <th style={{ padding: "4px 6px" }}>CBM</th>
                  <th style={{ padding: "4px 6px" }}>Kg quy đổi</th>
                  <th style={{ padding: "4px 6px" }}>Cao nhất (mm)</th>
                  <th style={{ padding: "4px 6px" }}>Xe gợi ý</th>
                  <th style={{ padding: "4px 6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {stagedGroups.map((g) => (
                  <tr key={g._key} style={{ borderTop: "1px solid var(--border)", background: g.selected ? "rgba(var(--brand-rgb),0.08)" : "transparent" }}>
                    <td style={{ padding: "4px 6px" }}><input type="checkbox" checked={!!g.selected} onChange={() => toggleGroup(g._key)} /></td>
                    <td style={{ padding: "4px 6px", fontWeight: 600, whiteSpace: "nowrap" }}>{g.dnNo}</td>
                    <td style={{ padding: "4px 6px", maxWidth: 260 }} title={g.deliveryAddress}>
                      <div>{g.shipToName}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{g.deliveryAddress}</div>
                    </td>
                    <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{g.deliveryDate || "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{fmtNum2(g.totalQty)}</td>
                    <td style={{ padding: "4px 6px" }}>{fmtNum2(g.totalCbm)}</td>
                    <td style={{ padding: "4px 6px" }}>{fmtNum2(g.totalWeightKgEquiv)}</td>
                    <td style={{ padding: "4px 6px" }}>{g.maxItemHeightMm || "—"}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 600, color: g.suggestedVehicleFits === false ? "var(--red)" : "var(--cyan)" }}>
                      {g.suggestedVehicleType || "—"}
                      {g.missingDimensionSkus?.length > 0 && <div title={g.missingDimensionSkus.join(", ")} style={{ fontSize: 10, color: "var(--amber)", fontWeight: 400 }}>⚠️ thiếu {g.missingDimensionSkus.length} SKU</div>}
                    </td>
                    <td style={{ padding: "4px 6px" }}><button onClick={() => removeGroup(g._key)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setStagedGroups(null); setImportMeta(null); }} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Huỷ</button>
            <button onClick={saveStagedGroups} disabled={savingImport} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--cyan)", background: "rgba(var(--brand-rgb),0.15)", color: "var(--cyan)", fontSize: 13, fontWeight: 700, cursor: savingImport ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {savingImport ? "Đang lưu..." : `✅ Xác nhận & Lưu ${stagedGroups.length} booking`}
            </button>
          </div>
        </div>
      )}

      {/* Staging table — AI-parse fallback for clients without a known
          dimension master. Every field editable before saving. */}
      {stagedAiRows && (
        <div className="chart-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            🤖 Xem trước từ file "{importMeta?.fileName}" (AI đọc, kiểm tra kỹ trước khi lưu — dùng {importMeta?.aiProvider})
          </div>
          {importMeta?.truncated && <div style={{ fontSize: 12, color: "var(--amber)" }}>⚠️ File có {importMeta.rowsInFile} dòng, chỉ xử lý 300 dòng đầu.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stagedAiRows.map((r) => {
              const warnings = findAddressWarningsClient(r.deliveryAddress, difficultAddresses);
              return (
                <div key={r._key} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <input value={r.clientName} onChange={(e) => editAiRow(r._key, "clientName", e.target.value)} placeholder="Khách hàng" style={{ ...inputStyle, width: 140 }} />
                  <input type="date" value={r.deliveryDate} onChange={(e) => editAiRow(r._key, "deliveryDate", e.target.value)} style={{ ...inputStyle, width: 140 }} />
                  <div style={{ flex: "1 1 220px" }}>
                    <input value={r.deliveryAddress} onChange={(e) => editAiRow(r._key, "deliveryAddress", e.target.value)} placeholder="Địa chỉ giao" style={{ ...inputStyle, width: "100%" }} />
                    {warnings.length > 0 && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 3 }}>⚠️ {warnings.map((w) => w.reason).filter(Boolean).join("; ")}</div>}
                  </div>
                  <input type="number" value={r.quantity} onChange={(e) => editAiRow(r._key, "quantity", e.target.value)} placeholder="SL" style={{ ...inputStyle, width: 70 }} />
                  <input value={r.vehicleTypeRequested} onChange={(e) => editAiRow(r._key, "vehicleTypeRequested", e.target.value)} placeholder="Loại xe" style={{ ...inputStyle, width: 80 }} />
                  <button onClick={() => removeAiRow(r._key)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setStagedAiRows(null); setImportMeta(null); }} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Huỷ</button>
            <button onClick={saveAiRows} disabled={savingImport} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--cyan)", background: "rgba(var(--brand-rgb),0.15)", color: "var(--cyan)", fontSize: 13, fontWeight: 700, cursor: savingImport ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {savingImport ? "Đang lưu..." : `✅ Xác nhận & Lưu ${stagedAiRows.length} booking`}
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitBooking}
            className="chart-panel"
            style={{ padding: 20, maxWidth: 640, width: "100%", maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>+ Thêm booking FTL</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Khách hàng *</div>
                <input list="ftl-booking-clients" required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
                <datalist id="ftl-booking-clients">
                  {[...FTL_PORTAL_DM_CLIENTS].map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Loại xe cần</div>
                <select value={form.vehicleTypeRequested} onChange={(e) => setForm({ ...form, vehicleTypeRequested: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">— Chưa rõ —</option>
                  <option value="1.9T">1.9T</option>
                  <option value="5T">5T</option>
                  <option value="8T">8T</option>
                </select>
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Ngày lấy hàng</div>
                <input type="date" value={form.pickupDate} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Địa chỉ lấy hàng</div>
                <input value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Ngày giao hàng</div>
                <input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Địa chỉ giao hàng *</div>
                <input required value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
                {formDeliveryWarnings.length > 0 && (
                  <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "rgba(244,63,94,0.12)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 12, fontWeight: 600 }}>
                    ⚠️ Địa chỉ này từng bị đánh dấu khó giao: {formDeliveryWarnings.map((w) => w.reason).filter(Boolean).join("; ") || "(chưa có ghi chú lý do)"}
                  </div>
                )}
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Số lượng</div>
                <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Khối lượng (kg)</div>
                <input type="number" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Chiều cao hàng (cm) — nếu cao bất thường</div>
                <input type="number" value={form.cargoHeightCm} onChange={(e) => setForm({ ...form, cargoHeightCm: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </div>
              {form.cargoHeightCm && (
                <div style={{ flex: "1 1 100%", padding: "6px 10px", borderRadius: 6, background: "rgba(234,179,8,0.12)", border: "1px solid var(--amber)", color: "var(--amber)", fontSize: 12, fontWeight: 600 }}>
                  ⚠️ Hàng cao {form.cargoHeightCm}cm — cần GSVT xác nhận loại xe thùng phù hợp trước khi lên đơn, đừng chỉ dựa vào tải trọng.
                </div>
              )}
              <div style={{ flex: "1 1 100%" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Ghi chú đặc biệt</div>
                <textarea rows={2} value={form.specialNotes} onChange={(e) => setForm({ ...form, specialNotes: e.target.value })} style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
              </div>
              <div style={{ flex: "1 1 100%" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Link nguồn (Zalo/sheet gốc)</div>
                <input value={form.sourceLink} onChange={(e) => setForm({ ...form, sourceLink: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
              <button type="button" onClick={() => setShowAddModal(false)} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Huỷ</button>
              <button type="submit" disabled={saving} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--cyan)", background: "rgba(var(--brand-rgb),0.15)", color: "var(--cyan)", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {saving ? "Đang lưu..." : "Lưu booking"}
              </button>
            </div>
          </form>
        </div>
      )}

      {visibleBookings.length === 0 ? (
        <div className="chart-panel" style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Chưa có booking nào.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleBookings.map((b) => (
            <div key={b.id} className="chart-panel" style={{ padding: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{b.clientName}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Tạo bởi {b.createdBy || "?"} · {b.createdAt ? new Date(b.createdAt).toLocaleString("vi-VN") : ""}
                  </div>
                </div>
                <select
                  value={b.status}
                  disabled={busyId === b.id}
                  onChange={(e) => changeStatus(b.id, e.target.value)}
                  style={{
                    ...inputStyle, fontWeight: 700, color: BOOKING_STATUS_COLOR[b.status] || "var(--text-primary)",
                    borderColor: BOOKING_STATUS_COLOR[b.status] || "var(--border)",
                  }}
                >
                  {BOOKING_STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, fontSize: 13 }}>
                {b.dnNumbers && (
                  <div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>DN No.</div>
                    <div title={b.dnNumbers}>{b.dnNumbers.split(",").length > 1 ? `${b.dnNumbers.split(",")[0]} +${b.dnNumbers.split(",").length - 1}` : b.dnNumbers}</div>
                  </div>
                )}
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Lấy hàng {b.pickupDate && `(${b.pickupDate})`}</div>
                  <div>{b.pickupAddress || "—"}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Giao hàng {b.deliveryDate && `(${b.deliveryDate})`}</div>
                  <div>{b.deliveryAddress || "—"}</div>
                </div>
                {(b.quantity || b.weightKg) && (
                  <div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Số lượng / Khối lượng</div>
                    <div>{b.quantity || "—"} {b.weightKg ? `/ ${b.weightKg}kg` : ""}</div>
                  </div>
                )}
                {b.totalCbm && (
                  <div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Tổng CBM / Kg quy đổi</div>
                    <div>{fmtNum2(b.totalCbm)} / {fmtNum2(b.totalWeightKgEquiv)}kg</div>
                  </div>
                )}
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{b.suggestedVehicleType ? "Xe gợi ý / xác nhận" : "Loại xe cần"}</div>
                  <div>
                    {b.suggestedVehicleType && <span style={{ color: "var(--cyan)" }}>{b.suggestedVehicleType}</span>}
                    {b.suggestedVehicleType && " / "}
                    {b.vehicleTypeRequested || "Chưa rõ"}
                  </div>
                </div>
                {b.respondedAt && (
                  <div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Phản hồi</div>
                    <div>{b.respondedBy} ({Math.round((new Date(b.respondedAt) - new Date(b.createdAt)) / 60000)} phút)</div>
                  </div>
                )}
              </div>

              {b.cargoHeightCm && (
                <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, background: "rgba(234,179,8,0.12)", border: "1px solid var(--amber)", color: "var(--amber)", fontSize: 12, fontWeight: 600, display: "inline-block" }}>
                  ⚠️ Hàng cao {b.cargoHeightCm}cm — cần GSVT xác nhận loại xe thùng phù hợp
                </div>
              )}
              {b.maxItemHeightMm && Number(b.maxItemHeightMm) > 1800 && (
                <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, background: "rgba(234,179,8,0.12)", border: "1px solid var(--amber)", color: "var(--amber)", fontSize: 12, fontWeight: 600, display: "inline-block" }}>
                  ⚠️ Có SP cao {b.maxItemHeightMm}mm — kiểm tra chiều cao lọt lòng thùng xe trước khi xác nhận
                </div>
              )}
              {b.deliveryWarnings?.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {b.deliveryWarnings.map((w) => (
                    <div key={w.addressNormalized} style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(244,63,94,0.12)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>⚠️ Điểm giao khó: {w.reason || "(chưa có ghi chú lý do)"}</span>
                      <button onClick={() => unflagDifficult(w.addressNormalized)} title="Bỏ đánh dấu" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 12, padding: 0 }}>✕ Bỏ đánh dấu</button>
                    </div>
                  ))}
                </div>
              )}
              {b.specialNotes && (
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}><b>Ghi chú:</b> {b.specialNotes}</div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Mã đơn GHN:</span>
                  <input
                    defaultValue={b.linkedOrderCode}
                    placeholder="Dán mã đơn sau khi lên đơn GHN"
                    onBlur={(e) => e.target.value !== b.linkedOrderCode && saveBookingField(b.id, "linkedOrderCode", e.target.value)}
                    style={{ ...inputStyle, padding: "5px 8px", fontSize: 12, width: 220 }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Biển số:</span>
                  <input
                    defaultValue={b.plate}
                    placeholder="51D-xxxxx"
                    onBlur={(e) => e.target.value !== b.plate && saveBookingField(b.id, "plate", e.target.value)}
                    style={{ ...inputStyle, padding: "5px 8px", fontSize: 12, width: 110 }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Tài xế:</span>
                  <input
                    defaultValue={b.driverName}
                    placeholder="Tên tài xế"
                    onBlur={(e) => e.target.value !== b.driverName && saveBookingField(b.id, "driverName", e.target.value)}
                    style={{ ...inputStyle, padding: "5px 8px", fontSize: 12, width: 130 }}
                  />
                </div>
                {b.sourceLink && (
                  <a href={b.sourceLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--cyan)" }}>🔗 Nguồn gốc</a>
                )}
                <button onClick={() => flagDifficult(b)} style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 6, border: "1px solid var(--red)", background: "transparent", color: "var(--red)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  🚩 Đánh dấu điểm giao khó
                </button>
                <button onClick={() => removeBooking(b.id)} disabled={busyId === b.id} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                  Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reference data OPS maintains themselves going forward — AQUA
          confirmed (2026-08-25) they keep their SKU list current as new
          products launch, so this can't be a one-time developer seed. */}
      <div className="chart-panel" style={{ padding: 16 }}>
        <div onClick={() => setShowRefSettings((v) => !v)} style={{ cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          ⚙️ Dữ liệu tham chiếu (kích thước xe GHN / kích thước SP theo khách)
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>{showRefSettings ? "Thu gọn ▲" : "Mở ▼"}</span>
        </div>
        {showRefSettings && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Bảng kích thước xe GHN (dùng chung mọi khách)</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>File có cột: Dòng xe, kích thước lọt lòng (D-R-C), tải trọng, số khối, CBM an toàn 85%, diện tích sàn — như sheet "Kích thước xe" của AQUA.</div>
              <input type="file" accept=".xlsx,.xls,.csv" disabled={refUploading === "specs"} onChange={(e) => handleVehicleSpecsUpload(e.target.files?.[0])} style={{ fontSize: 12 }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Bảng kích thước SKU theo khách (VD: sheet "SP" của AQUA)</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>File có cột: Material No, Length/Width/Height (mm), CBM. Ghi đè theo Material No — tải file mới nhất mỗi khi khách thêm SKU.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input list="ftl-booking-clients" value={refDimClient} onChange={(e) => setRefDimClient(e.target.value)} placeholder="Tên khách" style={{ ...inputStyle, width: 180 }} />
                <input type="file" accept=".xlsx,.xls,.csv" disabled={refUploading === "dimensions"} onChange={(e) => handleDimensionsUpload(e.target.files?.[0])} style={{ fontSize: 12 }} />
              </div>
            </div>
            {refUploading && <TruckLoader size={28} label="Đang xử lý..." />}
            {refMsg && <div style={{ fontSize: 12, color: refMsg.startsWith("Lỗi") ? "var(--red)" : "var(--green)" }}>{refMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
// d.toISOString() converts to UTC first, which silently rolls back to the
// previous calendar day for any local midnight east of UTC (e.g. ICT,
// UTC+7) — confirmed live: new Date(2026,5,1) (1/6 local) produced
// "2026-05-31" via toISOString(). Build the string from the LOCAL
// year/month/day fields directly instead.
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Gần đây nhất trước, chỉ hiện các tháng thật sự đã bắt đầu (không hiện
// tháng tương lai). MONTHS_BACK giới hạn số nút hiển thị — dữ liệu FTL bắt
// đầu có từ 06/2026 nên 6 tháng gần nhất là đủ dùng.
const MONTHS_BACK = 6;
function recentMonths() {
  const now = new Date();
  const months = [];
  for (let i = 0; i < MONTHS_BACK; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return months;
}

const inputStyle = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--panel-bg-strong)", color: "var(--text-primary)", fontSize: 13,
};

export default function TabFTL({ isManager = false, userRole = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // "Số xe sử dụng theo ngày" (+ cap xe) is SD3/Manager-internal, not for
  // CS — enforced server-side too (see /api/ftl-data, /api/ftl-caps), this
  // is just so a CS session doesn't even bother fetching caps or rendering
  // the (empty, server-stripped) panel.
  const canSeeVehicleStats = userRole !== "cs";
  // "Điểm giao theo khách" — nội bộ SD3, server cũng strip trường này khỏi
  // response cho role khác (xem pages/api/ftl-data.js).
  const canSeeDestinationTab = userRole === "sd3" || userRole === "manager";
  const [subTab, setSubTab] = useState("overview");

  // ── Cap xe/ngày theo dự án ──
  const [caps, setCaps] = useState([]);
  const [showCapSettings, setShowCapSettings] = useState(false);
  const [capForm, setCapForm] = useState({ clientName: "", pickupProvince: "", vehicleType: "1.9T", dailyCap: "" });
  const [savingCap, setSavingCap] = useState(false);

  const loadCaps = useCallback(async () => {
    if (!canSeeVehicleStats) return;
    try {
      const res = await fetch("/api/ftl-caps");
      const json = await res.json();
      if (json.ok) setCaps(json.caps);
    } catch {
      // best-effort — caps just won't show if this fails, no need to block the rest of the tab
    }
  }, [canSeeVehicleStats]);

  useEffect(() => {
    loadCaps();
  }, [loadCaps]);

  const saveCap = async (e) => {
    e.preventDefault();
    if (!capForm.clientName || !capForm.vehicleType || !capForm.dailyCap) return;
    setSavingCap(true);
    try {
      await fetch("/api/ftl-caps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(capForm),
      });
      await loadCaps();
      setCapForm({ clientName: capForm.clientName, pickupProvince: "", vehicleType: "1.9T", dailyCap: "" });
    } finally {
      setSavingCap(false);
    }
  };

  const removeCap = async (cap) => {
    if (!confirm(`Xoá cap ${cap.vehicleType} của ${cap.clientName}${cap.pickupProvince ? ` (${cap.pickupProvince})` : ""}?`)) return;
    await fetch("/api/ftl-caps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...cap, dailyCap: 0 }),
    });
    await loadCaps();
  };

  // ── Filters ──
  const [selectedClient, setSelectedClient] = useState("");
  const [dateFrom, setDateFrom] = useState(daysAgoISO(30));
  const [dateTo, setDateTo] = useState(todayISO());
  const [addressSearch, setAddressSearch] = useState("");
  const [addressInput, setAddressInput] = useState(""); // debounced separately from addressSearch

  const selectMonth = (year, month) => {
    const from = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const today = new Date();
    const to = lastDayOfMonth > today ? today : lastDayOfMonth; // không cho chọn quá ngày hôm nay
    setDateFrom(toISO(from));
    setDateTo(toISO(to));
  };
  const isMonthActive = (year, month) => {
    const from = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const today = new Date();
    const to = lastDayOfMonth > today ? today : lastDayOfMonth;
    return dateFrom === toISO(from) && dateTo === toISO(to);
  };

  // Click a row in "Số xe sử dụng theo ngày" to expand its actual
  // day-by-day breakdown — the aggregate avg/min/max alone can't answer
  // "which specific days" a sporadic-shipping client needs trucks on.
  const [expandedVehicleClient, setExpandedVehicleClient] = useState(null);
  // Click a specific day chip (within an expanded row) to see exactly which
  // order(s) made up that day's count — the chip alone only shows a number.
  const [selectedVehicleDay, setSelectedVehicleDay] = useState(null); // { clientName, pickupProvince, date }

  // Matrix cell click -> detail panel, now scoped to ONE status group
  // (hoàn tất / đang xử lý / sự cố) so clicking "đang xử lý" shows exactly
  // the trips still needing driver follow-up, not everything mixed together.
  const [selectedCell, setSelectedCell] = useState(null); // { clientName, vehicleCapacity, group }

  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showStalled, setShowStalled] = useState(false);
  const [showRunningToday, setShowRunningToday] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedClient) params.set("clients", selectedClient);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (addressSearch) params.set("address", addressSearch);
      const res = await fetch(`/api/ftl-data?${params.toString()}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Lỗi tải dữ liệu");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedClient, dateFrom, dateTo, addressSearch]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Debounce the free-text address search so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setAddressSearch(addressInput), 500);
    return () => clearTimeout(t);
  }, [addressInput]);

  // Reset the open detail panel whenever the underlying filters change, since
  // the matrix cell it pointed at may no longer exist in the new result set.
  useEffect(() => {
    setSelectedCell(null);
    setExpandedVehicleClient(null);
    setSelectedVehicleDay(null);
  }, [selectedClient, dateFrom, dateTo, addressSearch]);

  // Tất cả các ngày trong khoảng đang lọc (kể cả ngày không có xe) — cần để
  // đánh giá vượt/dưới cap đúng, vì 1 ngày KHÔNG có xe khi có cap nghĩa là
  // "dưới cap" chứ không phải bỏ qua.
  const allDatesInRange = useMemo(() => {
    if (!dateFrom || !dateTo) return [];
    const dates = [];
    let cur = new Date(dateFrom + "T00:00:00");
    const end = new Date(dateTo + "T00:00:00");
    while (cur <= end) {
      dates.push(toISO(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    return dates;
  }, [dateFrom, dateTo]);

  const capEvalFor = useCallback((row, clientName, pickupProvince) => {
    const relevantCaps = caps.filter((c) => c.clientName === clientName && (c.pickupProvince || "") === (pickupProvince || ""));
    if (relevantCaps.length === 0 || allDatesInRange.length === 0) return null;
    const byDateMap = {};
    row.overall.dailyBreakdown.forEach((d) => { byDateMap[d.date] = d.byType || {}; });
    const perType = relevantCaps.map((c) => {
      let over = 0, under = 0, at = 0;
      allDatesInRange.forEach((date) => {
        const count = (byDateMap[date] || {})[c.vehicleType] || 0;
        if (count > c.dailyCap) over++;
        else if (count < c.dailyCap) under++;
        else at++;
      });
      return { vehicleType: c.vehicleType, dailyCap: c.dailyCap, over, under, at };
    });
    return { perType, totalDays: allDatesInRange.length };
  }, [caps, allDatesInRange]);

  // Client chỉ tách theo từng khu vực lấy hàng nếu THẬT SỰ có cap riêng
  // theo khu vực (VD: SF | AQUA B2B) — khách không set cap theo khu vực thì
  // vẫn gộp 1 dòng như cũ, không tự nhiên vỡ bảng ra nhiều dòng.
  const vehicleRows = useMemo(() => {
    if (!data?.dailyVehicleStats) return [];
    const provinceCapClients = new Set(caps.filter((c) => c.pickupProvince).map((c) => c.clientName));
    const rows = [];
    data.dailyVehicleStats.forEach((row) => {
      if (provinceCapClients.has(row.clientName)) {
        const provinceRows = (data.dailyVehicleStatsByProvince || []).filter((r) => r.clientName === row.clientName && r.pickupProvince);
        provinceRows.forEach((pr) => {
          rows.push({
            key: `${pr.clientName}|||${pr.pickupProvince}`,
            label: `${pr.clientName} — ${pr.pickupProvince}`,
            clientName: pr.clientName,
            pickupProvince: pr.pickupProvince,
            overall: pr.overall,
            byType: pr.byType,
            capEval: capEvalFor(pr, pr.clientName, pr.pickupProvince),
          });
        });
      } else {
        rows.push({
          key: row.clientName,
          label: row.clientName,
          clientName: row.clientName,
          pickupProvince: "",
          overall: row.overall,
          byType: row.byType,
          capEval: capEvalFor(row, row.clientName, ""),
        });
      }
    });
    return rows;
  }, [data, caps, capEvalFor]);

  const detailOrders = useMemo(() => {
    if (!selectedCell || !data?.orders) return [];
    return data.orders.filter((o) => {
      const types = vehicleTypesOf(o.vehicleCapacity);
      return o.clientName === selectedCell.clientName && types.includes(selectedCell.vehicleCapacity) && o.statusGroup === selectedCell.group;
    });
  }, [selectedCell, data]);

  // Click-through for a day chip in "Số xe sử dụng theo ngày" — same
  // (client, province, date) bucket the stats for that chip were computed
  // from. Row has no province split (pickupProvince === "") -> match any
  // province, same as how that row's aggregate count was built.
  const vehicleDayOrders = useMemo(() => {
    if (!selectedVehicleDay || !data?.orders) return [];
    const [y, m, d] = selectedVehicleDay.date.split("-");
    const vnDate = `${d}/${m}/${y}`;
    return data.orders.filter((o) => {
      if (o.statusGroup === "issue") return false;
      if (o.clientName !== selectedVehicleDay.clientName) return false;
      if (selectedVehicleDay.pickupProvince && o.pickupProvince !== selectedVehicleDay.pickupProvince) return false;
      return o.createdDate === vnDate;
    });
  }, [selectedVehicleDay, data]);

  // Exports exactly the current filtered view (client/ngày/địa chỉ), same
  // dataset the matrix and detail panels read from. `data.orders` is capped
  // at 1000 rows server-side (see transform-ftl-live.js) — warn instead of
  // silently shipping a partial file when the real filtered count is bigger.
  const exportOrdersCSV = () => {
    if (!data?.orders?.length) return;
    if (data.totalOrders > data.orders.length) {
      const proceed = window.confirm(
        `Bộ lọc hiện tại có ${fmt(data.totalOrders)} đơn nhưng chỉ xuất được tối đa ${fmt(data.orders.length)} đơn/lần. Thu hẹp khoảng ngày để xuất đủ, hoặc bấm OK để xuất ${fmt(data.orders.length)} đơn mới nhất.`
      );
      if (!proceed) return;
    }
    downloadCSV(
      `FTL Dien May - ${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { label: "Mã đơn", value: "orderCode" },
        { label: "Mã đơn KH", value: "customOrderCode" },
        { label: "Khách hàng", value: "clientName" },
        { label: "Ngày tạo", value: "createdDate" },
        { label: "Trạng thái đơn", value: "status" },
        { label: "Trạng thái chuyến", value: "tripStatus" },
        { label: "Loại xe", value: "vehicleCapacity" },
        { label: "Số xe/chuyến", value: "tripCount" },
        { label: "BKS", value: "plate" },
        { label: "Tài xế", value: "driver" },
        { label: "Địa chỉ lấy", value: "pickupAddress" },
        { label: "Địa chỉ giao", value: "deliveryAddress" },
        { label: "Số điểm giao", value: "deliveryPointCount" },
      ],
      data.orders
    );
  };

  // Xuất đúng số liệu "Số xe sử dụng theo ngày" — 1 dòng/(khách hàng [+khu
  // vực], ngày CÓ xe), không phải danh sách đơn thô (đã có nút xuất riêng
  // ở trên cho việc đó).
  const exportVehicleStatsCSV = () => {
    if (!vehicleRows.length) return;
    const types = data?.dailyVehicleTypes || [];
    const rows = [];
    vehicleRows.forEach((row) => {
      row.overall.dailyBreakdown.forEach((d) => {
        rows.push({
          clientName: row.clientName,
          pickupProvince: row.pickupProvince || "",
          date: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}/${d.date.slice(0, 4)}`,
          total: d.count,
          byType: d.byType || {},
        });
      });
    });
    rows.sort((a, b) => (a.clientName + a.pickupProvince).localeCompare(b.clientName + b.pickupProvince) || a.date.localeCompare(b.date));
    downloadCSV(
      `So xe FTL theo ngay - ${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { label: "Khách hàng", value: "clientName" },
        { label: "Khu vực lấy hàng", value: "pickupProvince" },
        { label: "Ngày", value: "date" },
        { label: "Tổng số xe", value: "total" },
        ...types.map((t) => ({ label: t, value: (r) => r.byType[t] || 0 })),
      ],
      rows
    );
  };

  if (loading && !data) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
        <TruckLoader size={88} label="Đang tải dữ liệu FTL..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)",
        borderRadius: 10, padding: 20, color: "var(--red)",
      }}>
        Lỗi tải dữ liệu FTL: {error}
      </div>
    );
  }

  const statusCounts = data?.statusCounts || {};
  const showOverdueAlert = data?.overdueCount > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{`
        @keyframes ftl-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.72; }
        }
        .ftl-overdue-banner {
          animation: ftl-blink 1.6s ease-in-out infinite;
        }
        .ftl-cell-num {
          cursor: pointer;
          padding: 1px 4px;
          border-radius: 4px;
          transition: background 0.15s;
        }
        .ftl-cell-num:hover {
          background: rgba(var(--brand-rgb), 0.18);
        }
        .ftl-cell-num.selected {
          background: rgba(var(--brand-rgb), 0.28);
          outline: 1px solid var(--cyan);
        }
        .ftl-cell-num.zero {
          cursor: default;
          opacity: 0.35;
        }
      `}</style>

      {/* "Điểm giao theo khách" là dữ liệu nội bộ SD3 — theo yêu cầu người
          dùng (2026-08-25) chỉ SD3/Manager mới thấy nút chuyển sang tab đó
          (server cũng đã strip destinationBreakdown khỏi response cho role
          khác, xem pages/api/ftl-data.js). "Booking FTL" thì NGƯỢC LẠI —
          hiện cho bất kỳ ai đã vào được trang FTL này (kể cả CS), vì CS
          chính là người cần tạo booking — server tự kiểm tra lại quyền này
          ở /api/ftl-bookings, không chỉ ẩn ở UI. */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 2 }}>
        {[
          { key: "overview", label: "Tổng quan FTL" },
          ...(canSeeDestinationTab ? [{ key: "destination", label: "📍 Điểm giao theo khách" }] : []),
          { key: "booking", label: "📋 Booking FTL" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            style={{
              padding: "9px 16px", border: "none", borderBottom: subTab === t.key ? "2px solid var(--cyan)" : "2px solid transparent",
              background: "transparent", color: subTab === t.key ? "var(--cyan)" : "var(--text-secondary)",
              fontSize: 13, fontWeight: subTab === t.key ? 700 : 500, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "booking" ? (
        <BookingFTL />
      ) : (
      <>
      {/* Filter bar — bộ lọc ngày/tháng/khách hàng dùng chung cho "Tổng
          quan FTL" và "Điểm giao theo khách" (theo yêu cầu người dùng
          2026-08-25: cần lọc theo ngày/tháng/năm ở cả tab "Điểm giao theo
          khách", trước đó bộ lọc chỉ nằm trong nhánh "Tổng quan FTL" nên
          tab kia không có cách đổi khoảng ngày). "Booking FTL" có chu kỳ
          dữ liệu khác hẳn (không phải lọc theo ngày tạo đơn GHN) nên không
          dùng chung bộ lọc này — xem nhánh riêng ở trên. */}
      <div className="chart-panel" style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Chọn theo tháng</div>
          <div style={{ display: "flex", background: "var(--panel-glow)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {recentMonths().reverse().map(({ year, month }) => (
              <button
                key={`${year}-${month}`}
                onClick={() => selectMonth(year, month)}
                style={{
                  padding: "8px 10px", fontSize: 12, border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontWeight: isMonthActive(year, month) ? 700 : 400,
                  background: isMonthActive(year, month) ? "rgba(var(--brand-rgb),0.2)" : "transparent",
                  color: isMonthActive(year, month) ? "var(--cyan)" : "var(--text-muted)",
                  whiteSpace: "nowrap", transition: "all 0.15s",
                }}
              >
                Th.{month + 1}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Từ ngày</div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Đến ngày</div>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Khách hàng / Dự án</div>
          <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
            <option value="">Tất cả khách Điện Máy FTL</option>
            {(data?.allClients || []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Tìm theo địa chỉ giao/lấy hàng</div>
          <input
            type="text"
            placeholder="VD: Bình Dương, Cao Lỗ, KCN..."
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          {data?.lastSyncedAt && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Đồng bộ lần cuối: {new Date(data.lastSyncedAt).toLocaleString("vi-VN")}
            </div>
          )}
          <button
            onClick={exportOrdersCSV}
            disabled={!data?.orders?.length}
            title="Xuất danh sách đơn theo bộ lọc hiện tại — mở được bằng Excel hoặc import vào Google Sheets"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "var(--panel-glow)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", padding: "7px 12px", borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: data?.orders?.length ? "pointer" : "not-allowed",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Xuất Excel/CSV
          </button>
        </div>
      </div>

      {subTab === "destination" && canSeeDestinationTab ? (
        <DestinationBreakdown data={data} fmt={fmt} />
      ) : (
      <>
      {/* Overdue alert — blinking red once past 20:00 */}
      {showOverdueAlert && (
        <div
          className="ftl-overdue-banner"
          style={{
            background: "#a11d1d", border: "2px solid #7f1d1d",
            borderRadius: 10, padding: 16, color: "#fff",
          }}
        >
          <div style={{ fontWeight: 700, color: "#fff", fontSize: 15, marginBottom: 8 }}>
            🔴 {data.overdueCount} chuyến FTL Điện Máy đang trễ — quá 20h hôm nay hoặc còn tồn từ ngày trước mà CHƯA giao xong, cần liên hệ tài xế gấp!
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "9%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "35%" }} />
              </colgroup>
              <thead>
                <tr style={{ textAlign: "left", color: "rgba(255,255,255,0.8)" }}>
                  <th style={{ padding: "4px 8px" }}>Mã đơn</th>
                  <th style={{ padding: "4px 8px" }}>Khách hàng</th>
                  <th style={{ padding: "4px 8px" }}>Ngày tạo</th>
                  <th style={{ padding: "4px 8px" }}>Trạng thái</th>
                  <th style={{ padding: "4px 8px" }}>Loại xe</th>
                  <th style={{ padding: "4px 8px" }}>BKS / Tài xế</th>
                  <th style={{ padding: "4px 8px" }}>Địa chỉ giao</th>
                </tr>
              </thead>
              <tbody>
                {data.overdueOrders.map((o) => (
                  <tr key={o.orderCode} style={{ borderTop: "1px solid rgba(255,255,255,0.25)" }}>
                    <td style={{ padding: "4px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.orderCode}</td>
                    <td style={{ padding: "4px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.clientName}</td>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{o.createdDate}</td>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {o.status}
                      {o.tripStatus && o.tripStatus !== o.status && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Chuyến: {o.tripStatus}</div>
                      )}
                    </td>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{o.vehicleCapacity || "—"}</td>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.plate ? `${o.plate}${o.driver ? ` — ${o.driver}` : ""}` : "—"}</td>
                    <td style={{ padding: "4px 8px" }}><AddressCell value={o.deliveryAddress} maxWidth={220} light /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cảnh báo 2: Đã tạo nhưng chưa gán tài xế trên GHN */}
      {data?.unassignedCount > 0 && (
        <div style={{
          background: "#c2410c", border: "2px solid #9a3412",
          borderRadius: 10, padding: 16, color: "#fff",
        }}>
          <div
            style={{ fontWeight: 700, color: "#fff", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => setShowUnassigned((v) => !v)}
          >
            🟠 {data.unassignedCount} đơn "Đã tạo" nhưng CHƯA có xe/tài xế trên GHN — cần đôn đốc điều xe
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.85)" }}>{showUnassigned ? "Thu gọn ▲" : "Xem danh sách ▼"}</span>
          </div>
          {showUnassigned && (
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "rgba(255,255,255,0.8)" }}>
                    <th style={{ padding: "4px 8px" }}>Mã đơn</th>
                    <th style={{ padding: "4px 8px" }}>Khách hàng</th>
                    <th style={{ padding: "4px 8px" }}>Ngày tạo</th>
                    <th style={{ padding: "4px 8px" }}>Số ngày chờ</th>
                    <th style={{ padding: "4px 8px" }}>Địa chỉ giao</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unassignedOrders.map((o) => (
                    <tr key={o.orderCode} style={{ borderTop: "1px solid rgba(255,255,255,0.25)" }}>
                      <td style={{ padding: "4px 8px", fontWeight: 600 }}>{o.orderCode}</td>
                      <td style={{ padding: "4px 8px" }}>{o.clientName}</td>
                      <td style={{ padding: "4px 8px" }}>{o.createdDate}</td>
                      <td style={{ padding: "4px 8px", color: o.daysSinceCreated >= 3 ? "#fde047" : "#fff", fontWeight: 700 }}>{o.daysSinceCreated} ngày</td>
                      <td style={{ padding: "4px 8px", maxWidth: 260 }}><AddressCell value={o.deliveryAddress} maxWidth={220} light /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Cảnh báo 3: Đã gán xe nhưng chưa xuất phát */}
      {data?.stalledAssignedCount > 0 && (
        <div style={{
          background: "#eab308", border: "2px solid #a16207",
          borderRadius: 10, padding: 16, color: "#7f1d1d",
        }}>
          <div
            style={{ fontWeight: 700, color: "#7f1d1d", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => setShowStalled((v) => !v)}
          >
            🟡 {data.stalledAssignedCount} đơn ĐÃ gán xe/tài xế nhưng vẫn đứng ở "Đã tạo" — chưa thấy thao tác lấy hàng
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400, color: "rgba(127,29,29,0.75)" }}>{showStalled ? "Thu gọn ▲" : "Xem danh sách ▼"}</span>
          </div>
          {showStalled && (
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "rgba(127,29,29,0.75)" }}>
                    <th style={{ padding: "4px 8px" }}>Mã đơn</th>
                    <th style={{ padding: "4px 8px" }}>Khách hàng</th>
                    <th style={{ padding: "4px 8px" }}>Ngày tạo</th>
                    <th style={{ padding: "4px 8px" }}>Số ngày chờ</th>
                    <th style={{ padding: "4px 8px" }}>Biển số / Tài xế</th>
                    <th style={{ padding: "4px 8px" }}>Địa chỉ giao</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stalledAssignedOrders.map((o) => (
                    <tr key={o.orderCode} style={{ borderTop: "1px solid rgba(127,29,29,0.25)" }}>
                      <td style={{ padding: "4px 8px", fontWeight: 600 }}>{o.orderCode}</td>
                      <td style={{ padding: "4px 8px" }}>{o.clientName}</td>
                      <td style={{ padding: "4px 8px" }}>{o.createdDate}</td>
                      <td style={{ padding: "4px 8px", color: "#991b1b", fontWeight: 700 }}>{o.daysSinceCreated} ngày</td>
                      <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{o.plate}{o.driver ? ` — ${o.driver}` : ""}</td>
                      <td style={{ padding: "4px 8px", maxWidth: 260 }}><AddressCell value={o.deliveryAddress} maxWidth={220} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* "Chuyến đang chạy hôm nay" — theo yêu cầu người dùng (2026-08-26):
          xem nhanh 1 phát biết hôm nay có bao nhiêu chuyến FTL có NGÀY LẤY
          HÀNG là hôm nay (giao xong hôm nay hay mai đều tính, chuyến đường
          dài thường lấy 1 ngày giao ngày kế). Cố định "hôm nay" — không đổi
          theo bộ lọc ngày/tháng phía trên, xem giải thích trong
          lib/transform-ftl-live.js. */}
      {data?.runningTodayCount > 0 && (
        <div className="chart-panel" style={{ padding: 0 }}>
          <div
            onClick={() => setShowRunningToday((v) => !v)}
            style={{
              padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              fontSize: 15, fontWeight: 700, color: "var(--cyan)",
            }}
          >
            🚚 {data.runningTodayCount} chuyến FTL Điện Máy đang chạy hôm nay ({todayISO().split("-").reverse().join("/")}) — lấy hàng hôm nay, giao hôm nay hoặc mai
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>{showRunningToday ? "Thu gọn ▲" : "Xem danh sách ▼"}</span>
          </div>

          {/* Số xe theo dự án × loại tải trọng — luôn hiện, không cần bấm mở,
              vì đây chính là con số "xem nhanh" người dùng cần đầu tiên.
              Tách rõ 2 loại số theo phản hồi người dùng (2026-08-26): số
              màu cyan = ĐÃ CÓ xe/tài xế thật (GHN xác nhận, đáng tin); số
              trong ngoặc màu vàng = KHÁCH ĐẶT lúc tạo đơn, GHN CHƯA gán xe
              thật nên có thể đổi loại khi thực sự điều xe — không phải xe
              GHN đã cung cấp. */}
          {data.runningTodayByClient?.length > 0 && (
            <div style={{ padding: "0 20px 10px", fontSize: 11, color: "var(--text-muted)" }}>
              <span style={{ color: "var(--cyan)", fontWeight: 700 }}>Số xanh</span> = GHN đã xác nhận xe/tài xế thật ·{" "}
              <span style={{ color: "var(--amber)", fontWeight: 700 }}>số vàng trong ngoặc</span> = khách đặt lúc tạo đơn, GHN <b>chưa</b> gán xe nên có thể đổi loại khác khi điều xe thật
            </div>
          )}
          {data.runningTodayByClient?.length > 0 && (
            <div style={{ overflowX: "auto", padding: "0 20px 16px" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>
                    <th style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>Dự án</th>
                    <th style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>Đã xác nhận</th>
                    <th style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>Khách đặt (chưa gán xe)</th>
                    {(data.runningTodayVehicleTypes || []).map((v) => (
                      <th key={v} style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.runningTodayByClient.map((row) => (
                    <tr key={row.clientName} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "7px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>{row.clientName}</td>
                      <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 700, color: "var(--cyan)" }}>{row.totalVehicles}</td>
                      <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 700, color: "var(--amber)" }}>{row.totalRequested || "—"}</td>
                      {(data.runningTodayVehicleTypes || []).map((v) => {
                        const cell = row.byType[v];
                        if (!cell) return <td key={v} style={{ padding: "7px 10px", textAlign: "center", color: "var(--text-muted)" }}>—</td>;
                        return (
                          <td key={v} style={{ padding: "7px 10px", textAlign: "center", whiteSpace: "nowrap" }}>
                            {cell.confirmed > 0 && <span style={{ color: "var(--cyan)", fontWeight: 700 }}>{cell.confirmed}</span>}
                            {cell.confirmed > 0 && cell.requested > 0 && " "}
                            {cell.requested > 0 && <span style={{ color: "var(--amber)" }}>({cell.requested})</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showRunningToday && (
            <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto", padding: "0 20px 16px" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
                    <th style={{ padding: "6px 8px" }}>Mã đơn</th>
                    <th style={{ padding: "6px 8px" }}>Khách hàng</th>
                    <th style={{ padding: "6px 8px" }}>Trạng thái</th>
                    <th style={{ padding: "6px 8px" }}>Loại xe</th>
                    <th style={{ padding: "6px 8px" }}>BKS / Tài xế</th>
                    <th style={{ padding: "6px 8px" }}>Địa chỉ giao</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runningTodayOrders.map((o) => (
                    <tr key={o.orderCode} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{o.orderCode}</td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{o.clientName}</td>
                      <td style={{ padding: "6px 8px", color: `var(--${(STATUS_COLOR[o.status] || "text-cyan").replace("text-", "")})`, whiteSpace: "nowrap" }}>
                        {o.status}
                        {o.tripStatus && o.tripStatus !== o.status && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Chuyến: {o.tripStatus}</div>
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                        {o.vehicleCapacity || (o.requestedVehicleType ? <span title="Tải trọng khách yêu cầu — GHN chưa gán xe/tài xế thật">{o.requestedVehicleType} (yêu cầu)</span> : "—")}
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{o.plate ? `${o.plate}${o.driver ? ` — ${o.driver}` : ""}` : "Chưa gán"}</td>
                      <td style={{ padding: "6px 8px", maxWidth: 300 }}><AddressCell value={o.deliveryAddress} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* KPI funnel — flex-wrap instead of a fixed 4-column grid, since the
          number of status cards depends on live data (5-7 typically) and a
          rigid grid-4 leaves an uneven, gap-filled last row (e.g. 7 cards ->
          4 + 3, with an empty 4th slot). flex-wrap lets the last row's cards
          grow to fill the full width evenly instead. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div style={{ flex: "1 1 220px", minWidth: 200, maxWidth: 320 }}>
          <KpiCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>}
            label="Tổng đơn FTL Điện Máy"
            value={fmt(data?.totalOrders)}
            sub="Trong khoảng lọc hiện tại"
            colorClass="text-cyan"
          />
        </div>
        {Object.entries(statusCounts).map(([status, count]) => (
          <div key={status} style={{ flex: "1 1 220px", minWidth: 200, maxWidth: 320 }}>
            <KpiCard
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>}
              label={status}
              value={fmt(count)}
              colorClass={STATUS_COLOR[status] || "text-cyan"}
            />
          </div>
        ))}
      </div>

      {/* Client × Vehicle type matrix */}
      <div className="chart-panel" style={{ padding: 0 }}>
        <div className="chart-panel-title" style={{ padding: "16px 20px" }}>
          Theo khách hàng × Loại xe (xe GHN cung cấp) <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)" }}>— mỗi ô: <span style={{ color: "var(--green)" }}>hoàn tất</span> / <span style={{ color: "var(--red)" }}>đang xử lý</span> / <span style={{ color: "var(--amber)" }}>hủy đơn</span> — bấm vào từng số để xem đúng danh sách chuyến đó</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 15, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>
                <th style={{ padding: "10px 20px", fontSize: 13, fontWeight: 700, position: "sticky", left: 0, background: "var(--panel-bg-strong)", whiteSpace: "nowrap" }}>Khách hàng</th>
                {(data?.vehicleTypes || []).map((v) => (
                  <th key={v} style={{ padding: "10px 16px", textAlign: "center", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.clientVehicleMatrix || []).map((row) => (
                <tr key={row.clientName} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 20px", fontWeight: 700, fontSize: 15, position: "sticky", left: 0, background: "var(--panel-bg)", whiteSpace: "nowrap" }}>{row.clientName}</td>
                  {(data?.vehicleTypes || []).map((v) => {
                    const cell = row.cells[v];
                    if (!cell) {
                      return <td key={v} style={{ padding: "10px 16px", textAlign: "center", color: "var(--text-muted)", whiteSpace: "nowrap" }}>—</td>;
                    }
                    return (
                      <td key={v} style={{ padding: "10px 16px", textAlign: "center", whiteSpace: "nowrap" }}>
                        {["done", "processing", "issue"].map((group, i) => {
                          const n = cell[group];
                          const isSelected = selectedCell?.clientName === row.clientName && selectedCell?.vehicleCapacity === v && selectedCell?.group === group;
                          return (
                            <span key={group} style={{ whiteSpace: "nowrap" }}>
                              {i > 0 && <span style={{ color: "var(--text-muted)" }}> / </span>}
                              <span
                                className={`ftl-cell-num${isSelected ? " selected" : ""}${n === 0 ? " zero" : ""}`}
                                style={{ color: GROUP_COLOR[group], fontSize: 16, fontWeight: 700 }}
                                onClick={() => n > 0 && setSelectedCell(isSelected ? null : { clientName: row.clientName, vehicleCapacity: v, group })}
                              >
                                {n}
                              </span>
                            </span>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Expanded detail for the clicked cell — scoped to just that status group */}
        {selectedCell && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "16px 20px" }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
              {selectedCell.clientName} — {selectedCell.vehicleCapacity} — <span style={{ color: GROUP_COLOR[selectedCell.group] }}>{GROUP_LABEL[selectedCell.group]}</span> ({detailOrders.length} chuyến)
            </div>
            <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                    <th style={{ padding: "6px 10px" }}>Mã đơn</th>
                    <th style={{ padding: "6px 10px" }}>Ngày tạo</th>
                    <th style={{ padding: "6px 10px" }}>Trạng thái</th>
                    <th style={{ padding: "6px 10px" }}>Biển số / Tài xế</th>
                    <th style={{ padding: "6px 10px" }}>Địa chỉ giao</th>
                  </tr>
                </thead>
                <tbody>
                  {detailOrders.map((o) => (
                    <tr key={o.orderCode} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>
                        {o.orderCode}
                        {o.tripCount > 1 && (
                          <span title="Đơn bị tách nhiều xe" style={{ marginLeft: 4, fontSize: 10, color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 4, padding: "0 4px" }}>
                            {o.tripCount} xe
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px" }}>{o.createdDate}</td>
                      <td style={{ padding: "6px 10px", color: `var(--${(STATUS_COLOR[o.status] || "text-cyan").replace("text-", "")})` }}>
                        {o.status}
                        {o.tripStatus && o.tripStatus !== o.status && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Chuyến: {o.tripStatus}</div>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px" }}>{o.plate ? `${o.plate}${o.driver ? ` — ${o.driver}` : ""}` : "—"}</td>
                      <td style={{ padding: "6px 10px", maxWidth: 340 }}><AddressCell value={o.deliveryAddress} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <ul style={{ margin: 0, padding: "0 20px 16px 36px", fontSize: 11, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          <li>"Loại xe" là xe GHN <b>thực tế</b> cấp cho chuyến, không phải tải trọng khách đặt — lấy thẳng từ hệ thống GHN.</li>
          <li>Đơn bị tách nhiều xe (VD: 1 xe 5T + 1 xe 1.9T) được tính vào <b>cả 2 cột</b> — badge "2 xe" trong danh sách chi tiết cho biết đây là đơn tách, nên tổng các cột có thể nhiều hơn tổng số đơn.</li>
          <li>Ma trận chỉ hiện đơn <b>ĐÃ có xe</b> — đơn GHN chưa gán xe xem ở cảnh báo 🟠 phía trên, không lặp lại ở đây.</li>
          <li>"Hoàn tất" tính theo trạng thái chuyến thực tế, kể cả khi trạng thái đơn (mục 1) vẫn còn hiện "Đã tạo".</li>
        </ul>
      </div>

      {/* Region rollup — "chuẩn bị bao nhiêu xe/ngày cho Miền Bắc/Nam", gộp
          tất cả khách theo khu vực lấy hàng thay vì phải tự cộng dòng theo
          từng khách như bảng "theo khách hàng" bên dưới. */}
      {canSeeVehicleStats && data?.dailyVehicleStatsByRegion?.length > 0 && (
        <div className="chart-panel">
          <div className="chart-panel-title">
            Dự báo xe cần chuẩn bị theo Miền <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)" }}>— trung bình rải đều {fmt(data.totalDaysInRange)} ngày đang lọc, gộp tất cả khách hàng theo khu vực lấy hàng</span>
          </div>

          {data.dailyVehicleStatsOverall && (
            <div style={{ padding: "0 20px 16px" }}>
              <div style={{
                background: "rgba(var(--brand-rgb),0.08)", border: "1px solid rgba(var(--brand-rgb),0.3)",
                borderRadius: 12, padding: 16,
                display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>🚚 Toàn hệ thống</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: "var(--cyan)", lineHeight: 1.1 }}>
                    {data.dailyVehicleStatsOverall.overall.avgPerDayInRange} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>xe/ngày (TB)</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Ngày cao điểm: {data.dailyVehicleStatsOverall.overall.maxPerDay} xe
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1 }}>
                  {(data?.dailyVehicleTypes || []).map((v) => {
                    const s = data.dailyVehicleStatsOverall.byType[v];
                    if (!s) return null;
                    return (
                      <div key={v} style={{
                        background: "var(--panel-bg-strong)", border: "1px solid var(--border)", borderRadius: 10,
                        padding: "8px 14px", minWidth: 90, textAlign: "center",
                      }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{v}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{s.avgPerDayInRange}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>xe/ngày</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`, gap: 12, padding: "0 20px 20px" }}>
            {data.dailyVehicleStatsByRegion.map((r) => (
              <div key={r.region} style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{r.region}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "var(--cyan)", lineHeight: 1.2 }}>
                  {r.overall.avgPerDayInRange} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>xe/ngày (TB)</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, marginBottom: 10 }}>
                  Ngày cao điểm: {r.overall.maxPerDay} xe · {r.overall.daysWithData}/{data.totalDaysInRange} ngày có phát sinh
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(data?.dailyVehicleTypes || []).map((v) => {
                    const s = r.byType[v];
                    if (!s) return null;
                    return (
                      <span key={v} style={{
                        fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 14,
                        background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                      }}>
                        {v}: {s.avgPerDayInRange} xe/ngày
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "0 20px 16px", fontSize: 11, color: "var(--text-muted)" }}>
            "Khác" = tỉnh lấy hàng chưa được phân miền — báo lại nếu thấy tên tỉnh lạ ở đây để bổ sung.
          </div>
        </div>
      )}

      {/* Daily vehicle usage — capacity planning: bao nhiêu xe/ngày mỗi dự án cần */}
      {canSeeVehicleStats && data?.dailyVehicleStats?.length > 0 && (
        <div className="chart-panel" style={{ padding: 0 }}>
          <div className="chart-panel-title" style={{ padding: "16px 20px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span>
              Số xe sử dụng theo ngày (theo khách hàng) <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)" }}>— khoảng đang lọc có {fmt(data.totalDaysInRange)} ngày. Bấm vào 1 dòng để xem đúng ngày nào có xe, ngày nào không.</span>
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={exportVehicleStatsCSV}
                style={{
                  padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)",
                  background: "var(--panel-glow)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Xuất Excel/CSV
              </button>
              {isManager && (
                <button
                  onClick={() => setShowCapSettings((v) => !v)}
                  style={{
                    padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)",
                    background: showCapSettings ? "rgba(var(--brand-rgb),0.15)" : "var(--panel-glow)",
                    color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  ⚙️ Cài đặt cap xe/ngày
                </button>
              )}
            </div>
          </div>

          {isManager && showCapSettings && (
            <div style={{ padding: "0 20px 16px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "12px 0 8px" }}>
                Cap = số xe cố định/ngày mà dự án đó thường dùng. Để trống "Khu vực lấy hàng" nếu dự án chỉ có 1 mức cap chung; điền tỉnh lấy hàng (VD: Đồng Nai, Hưng Yên) nếu dự án có cap riêng theo từng khu vực.
              </div>
              <form onSubmit={saveCap} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Khách hàng</div>
                  <select value={capForm.clientName} onChange={(e) => setCapForm({ ...capForm, clientName: e.target.value })} style={{ ...inputStyle, minWidth: 200 }} required>
                    <option value="">— Chọn —</option>
                    {(data?.allClients || []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Khu vực lấy hàng (để trống = chung)</div>
                  <input type="text" placeholder="VD: Đồng Nai" value={capForm.pickupProvince} onChange={(e) => setCapForm({ ...capForm, pickupProvince: e.target.value })} style={{ ...inputStyle, minWidth: 160 }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Loại xe</div>
                  <select value={capForm.vehicleType} onChange={(e) => setCapForm({ ...capForm, vehicleType: e.target.value })} style={inputStyle}>
                    <option value="1.9T">1.9T</option>
                    <option value="5T">5T</option>
                    <option value="8T">8T</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Cap (xe/ngày)</div>
                  <input type="number" min="1" placeholder="VD: 5" value={capForm.dailyCap} onChange={(e) => setCapForm({ ...capForm, dailyCap: e.target.value })} style={{ ...inputStyle, width: 90 }} required />
                </div>
                <button type="submit" disabled={savingCap} style={{
                  padding: "8px 14px", borderRadius: 8, border: "1px solid var(--cyan)",
                  background: "rgba(var(--brand-rgb),0.15)", color: "var(--cyan)", fontSize: 13, fontWeight: 600,
                  cursor: savingCap ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}>
                  {savingCap ? "Đang lưu..." : "+ Lưu cap"}
                </button>
              </form>

              {caps.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {caps.map((c) => (
                    <div key={`${c.clientName}|||${c.pickupProvince}|||${c.vehicleType}`} style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 20,
                      border: "1px solid var(--border)", background: "var(--panel-bg-strong)", fontSize: 12,
                    }}>
                      <span style={{ fontWeight: 600 }}>{c.clientName}</span>
                      {c.pickupProvince && <span style={{ color: "var(--text-muted)" }}>({c.pickupProvince})</span>}
                      <span style={{ color: "var(--cyan)" }}>{c.vehicleType}: {c.dailyCap} xe/ngày</span>
                      <button onClick={() => removeCap(c)} title="Xoá" style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>Khách hàng</th>
                  <th title="Số ngày CÓ xe / Tổng ngày" style={{ padding: "8px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>Ngày có xe</th>
                  <th title="TB (Min–Max) — những ngày CÓ xe" style={{ padding: "8px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>TB (có xe)</th>
                  <th title="TB rải đều CẢ khoảng lọc" style={{ padding: "8px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>TB (rải đều)</th>
                  {(data?.dailyVehicleTypes || []).map((v) => (
                    <th key={v} style={{ padding: "8px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vehicleRows.map((row) => {
                  const isExpanded = expandedVehicleClient === row.key;
                  const overCapDays = row.capEval ? row.capEval.perType.reduce((s, p) => s + p.over, 0) : 0;
                  return (
                  <React.Fragment key={row.key}>
                    <tr
                      onClick={() => setExpandedVehicleClient(isExpanded ? null : row.key)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: isExpanded ? "rgba(var(--brand-rgb),0.08)" : "transparent" }}
                    >
                      <td style={{ padding: "8px 14px", fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>
                        <span style={{ marginRight: 6, display: "inline-block", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "none" }}>▸</span>
                        {row.label}
                        {row.capEval && overCapDays > 0 && (
                          <span title="Có ngày vượt cap" style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "var(--red)" }}>⚠️ vượt cap {overCapDays} ngày</span>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap" }}>{row.overall.daysWithData} / {data.totalDaysInRange}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {row.overall.avgPerDay} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({row.overall.minPerDay}–{row.overall.maxPerDay})</span>
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap" }}>{row.overall.avgPerDayInRange}</td>
                      {(data?.dailyVehicleTypes || []).map((v) => {
                        const s = row.byType[v];
                        const capForType = row.capEval?.perType.find((p) => p.vehicleType === v);
                        return (
                          <td key={v} style={{ padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap" }}>
                            {s ? <>{s.avgPerDay} <span style={{ color: "var(--text-muted)", fontSize: 12 }}>({s.minPerDay}–{s.maxPerDay})</span></> : <span style={{ color: "var(--text-muted)" }}>—</span>}
                            {capForType && (
                              <div style={{ marginTop: 3, display: "flex", justifyContent: "center" }}>
                                <span style={{
                                  display: "inline-block", padding: "2px 7px", borderRadius: 10,
                                  fontSize: 11, fontWeight: 700, color: "#fff",
                                  background: capForType.over > 0 ? "var(--red)" : "#0891b2",
                                }}>
                                  Cap {capForType.dailyCap}
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={4 + (data?.dailyVehicleTypes || []).length} style={{ padding: "12px 20px 16px 46px", background: "var(--panel-bg-strong)" }}>
                          {row.capEval && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12, fontSize: 12 }}>
                              {row.capEval.perType.map((p) => (
                                <div key={p.vehicleType} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-bg)" }}>
                                  <b>{p.vehicleType}</b> — cap {p.dailyCap} xe/ngày: {" "}
                                  <span style={{ color: "var(--red)", fontWeight: 600 }}>Vượt {p.over}/{row.capEval.totalDays} ({Math.round((p.over / row.capEval.totalDays) * 100)}%)</span>
                                  {" · "}
                                  <span style={{ color: "var(--green)", fontWeight: 600 }}>Đúng {p.at}/{row.capEval.totalDays}</span>
                                  {" · "}
                                  <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Dưới {p.under}/{row.capEval.totalDays} ({Math.round((p.under / row.capEval.totalDays) * 100)}%)</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                            Chi tiết từng ngày CÓ xe của {row.label} ({row.overall.daysWithData} ngày) — bấm vào 1 ngày để xem đúng chuyến nào. Ngày không liệt kê nghĩa là không có xe nào chạy hôm đó:
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {row.overall.dailyBreakdown.map((d) => {
                              let dayStatus = null; // "over" | "under" | "at" | null
                              if (row.capEval) {
                                if (row.capEval.perType.some((p) => (d.byType?.[p.vehicleType] || 0) > p.dailyCap)) dayStatus = "over";
                                else if (row.capEval.perType.every((p) => (d.byType?.[p.vehicleType] || 0) === p.dailyCap)) dayStatus = "at";
                                else dayStatus = "under";
                              }
                              const borderColor = dayStatus === "over" ? "var(--red)" : dayStatus === "at" ? "var(--green)" : dayStatus === "under" ? "var(--amber)" : "var(--border)";
                              const isDaySelected = selectedVehicleDay?.clientName === row.clientName && selectedVehicleDay?.pickupProvince === row.pickupProvince && selectedVehicleDay?.date === d.date;
                              return (
                                <div
                                  key={d.date}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedVehicleDay(isDaySelected ? null : { clientName: row.clientName, pickupProvince: row.pickupProvince, date: d.date });
                                  }}
                                  style={{
                                    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                                    padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`,
                                    background: isDaySelected ? "rgba(var(--brand-rgb),0.15)" : "var(--panel-bg)", minWidth: 68,
                                    cursor: "pointer", outline: isDaySelected ? "2px solid var(--cyan)" : "none",
                                  }}
                                >
                                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</span>
                                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cyan)" }}>{d.count}</span>
                                  <span style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", whiteSpace: "nowrap" }}>
                                    {Object.entries(d.byType || {}).map(([type, n]) => `${type}×${n}`).join(", ")}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {selectedVehicleDay?.clientName === row.clientName && selectedVehicleDay?.pickupProvince === row.pickupProvince && (
                            <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                                Các chuyến ngày {selectedVehicleDay.date.slice(8, 10)}/{selectedVehicleDay.date.slice(5, 7)} ({vehicleDayOrders.length} đơn):
                              </div>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                                      <th style={{ padding: "4px 8px" }}>Mã đơn</th>
                                      <th style={{ padding: "4px 8px" }}>Trạng thái</th>
                                      <th style={{ padding: "4px 8px" }}>Loại xe</th>
                                      <th style={{ padding: "4px 8px" }}>Biển số / Tài xế</th>
                                      <th style={{ padding: "4px 8px" }}>Địa chỉ giao</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {vehicleDayOrders.map((o) => (
                                      <tr key={o.orderCode} style={{ borderTop: "1px solid var(--border)" }}>
                                        <td style={{ padding: "4px 8px", fontWeight: 600 }}>{o.orderCode}</td>
                                        <td style={{ padding: "4px 8px", color: `var(--${(STATUS_COLOR[o.status] || "text-cyan").replace("text-", "")})` }}>
                                          {o.status}
                                          {o.tripStatus && o.tripStatus !== o.status && (
                                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Chuyến: {o.tripStatus}</div>
                                          )}
                                        </td>
                                        <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{o.vehicleCapacity || "—"}</td>
                                        <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{o.plate ? `${o.plate}${o.driver ? ` — ${o.driver}` : ""}` : "Chưa gán"}</td>
                                        <td style={{ padding: "4px 8px", maxWidth: 300 }}><AddressCell value={o.deliveryAddress} /></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul style={{ margin: 0, padding: "12px 20px 16px 36px", fontSize: 11, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Tính theo <b>ngày tạo đơn</b>, đếm số xe <b>khác nhau</b> chạy trong ngày đó (theo biển số) — 1 xe chạy 2 chuyến cùng ngày vẫn tính là 1.</li>
            <li>Chỉ loại bỏ đơn <b>Hủy đơn</b>. Đơn GSVT chưa gán biển số/chưa thao tác trên hệ thống <b>vẫn được tính là 1 xe</b> (xe thực tế vẫn chạy, chỉ là chưa cập nhật hệ thống) — xếp vào cột <b>"(chưa rõ)"</b> vì không có dữ liệu loại xe cho các đơn này.</li>
            <li><b>"TB những ngày CÓ xe"</b>: chỉ chia cho số ngày thực sự có xe chạy — cho biết "hôm nào có ship thì cần bao nhiêu xe". <b>"TB rải đều CẢ khoảng lọc"</b>: chia cho toàn bộ số ngày đang lọc, kể cả ngày không có đơn — cho biết mức trung bình nếu rải đều ra cả tháng. Khách ship lai rai (không phải ngày nào cũng có) sẽ có 2 số này chênh lệch lớn — bấm vào dòng đó để xem đúng ngày nào có xe.</li>
            <li>Manager có thể bấm <b>"⚙️ Cài đặt cap xe/ngày"</b> để nhập số xe cố định/ngày mỗi dự án — sau khi cài, bấm vào dòng đó sẽ thấy tỷ lệ ngày vượt/đúng/dưới cap, và khung màu từng ngày (đỏ = vượt, xanh lá = đúng, vàng = dưới cap).</li>
          </ul>
        </div>
      )}
      </>
      )}
      </>
      )}
    </div>
  );
}
