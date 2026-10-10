import React, { useState, useEffect } from "react";
import { SHOW_TRUY_THU } from "../../../lib/display-flags";

// Claim pipeline (approved 2026-09-26) — the server maps legacy labels
// (Mới / Đang xử lý / Chờ đền bù / Hoàn tất) onto these on read.
const CLAIM_STATUSES = ["Mới phát sinh", "Đang xác minh lỗi", "Đã chốt đền bù", "Đã đóng"];
const STATUS_COLOR = {
  "Mới phát sinh": "var(--red)",
  "Đang xác minh lỗi": "var(--amber)",
  "Đã chốt đền bù": "var(--cyan)",
  "Đã đóng": "var(--green)",
};
const DEFAULT_CLAIM = { status: CLAIM_STATUSES[0], assignee: "", notes: "" };
const fmtYmd = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s)) ? String(s).slice(0, 10).split("-").reverse().join("/") : s || "—");

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || "var(--text-muted)";
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 12, whiteSpace: "nowrap", color, border: `1px solid ${color}` }}>
      {status}
    </span>
  );
}

// Rillnet compensation / clawback state (2026-09-27)
function CompBadges({ c }) {
  const tt = c.truy_thu === "co" ? { t: `Truy thu ${(c.truy_thu_amount || 0).toLocaleString("vi-VN")}đ`, col: "var(--red)" }
    : c.truy_thu === "khong" ? { t: "Không truy thu", col: "var(--green)" } : { t: "Chờ chốt truy thu", col: "var(--text-muted)" };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {c.compensated && <span style={{ color: "var(--amber)" }}>✅ Đã chốt đền bù{c.comp_amount ? ` · ${c.comp_amount.toLocaleString("vi-VN")}đ` : ""}{c.comp_edited ? " ✎" : ""}</span>}
      {c.compensated && c.comp_edited && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>đã chỉnh sửa{c.comp_from ? ` (trước ${c.comp_from.toLocaleString("vi-VN")}đ)` : ""}</span>}
      {!c.compensated && c.comp_pending > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>Dự kiến {c.comp_pending.toLocaleString("vi-VN")}đ · chưa chốt</span>}
      {SHOW_TRUY_THU && <span style={{ color: tt.col }}>{tt.t}</span>}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13, padding: "5px 0", borderBottom: "1px dashed var(--border)" }}>
      <span style={{ color: "var(--text-muted)", minWidth: 130 }}>{label}</span>
      <span style={{ color: "var(--text-primary)", wordBreak: "break-word" }}>{children || "—"}</span>
    </div>
  );
}

function ImageGallery({ urls }) {
  const [lightbox, setLightbox] = useState(null);
  if (!urls.length) return null;
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Ảnh hiện trường ({urls.length})</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {urls.map((url, i) => (
          <img key={i} src={url} alt={`Ảnh ${i + 1}`}
            onClick={() => setLightbox(url)}
            onError={(e) => { e.target.style.display = "none"; }}
            style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 6, cursor: "pointer", border: "1px solid var(--border)" }}
          />
        ))}
      </div>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
        }}>
          <img src={lightbox} alt="Ảnh phóng to" style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8, objectFit: "contain" }} />
          <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }} style={{
            position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.2)", border: "none",
            color: "#fff", fontSize: 20, cursor: "pointer", borderRadius: "50%", width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>
      )}
    </div>
  );
}

function ClaimDrawer({ c, claim, canEdit, onClose, onSave }) {
  const [status, setStatus] = useState(claim.status);
  const [assignee, setAssignee] = useState(claim.assignee || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = status !== claim.status || assignee !== (claim.assignee || "") || note.trim();

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(c.order_code, { status, assignee, note: note.trim() || undefined });
      setNote("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const idx = CLAIM_STATUSES.indexOf(status);
  const input = {
    background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 6, fontSize: 13, padding: "8px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(520px, 100%)", height: "100%", overflowY: "auto", background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)", padding: 22, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Ca hư hỏng</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "var(--cyan)" }}>{c.order_code}</div>
            <div style={{ fontSize: 13, marginTop: 2 }}>{c.client_name} · {c.damage_type}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>

        {/* Stepper */}
        <div style={{ display: "flex", gap: 4 }}>
          {CLAIM_STATUSES.map((s, i) => {
            const on = i <= idx;
            return (
              <button key={s} disabled={!canEdit} onClick={() => setStatus(s)} style={{
                flex: 1, padding: "8px 4px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", borderRadius: 6,
                cursor: canEdit ? "pointer" : "default",
                border: `1px solid ${on ? STATUS_COLOR[s] : "var(--border)"}`,
                background: i === idx ? STATUS_COLOR[s] : "transparent",
                color: i === idx ? "#fff" : on ? STATUS_COLOR[s] : "var(--text-muted)",
              }}>{i + 1}. {s}</button>
            );
          })}
        </div>

        <div>
          <Field label="Tuyến">{`${c.kho_lay || "?"} → ${c.warehouse_giao || "?"}`}</Field>
          <Field label="Tỉnh">{`${c.from_province || "?"} → ${c.to_province || "?"}`}</Field>
          <Field label="Ngày lấy hàng">{fmtYmd(c.pickup_time)}</Field>
          <Field label="Trạng thái đơn">{c.ltl_status}</Field>
          <Field label="Chặng nghi vấn">{c.damage_details}</Field>
          <Field label="Ngày ghi nhận">{fmtYmd(c.case_date)}</Field>
          <Field label="Nguồn báo">{c.source}</Field>
          <Field label="Trạng thái Rillnet">{c.rillnet_status}</Field>
          <Field label="Đền bù cho khách">{c.compensated ? `✅ Đã chốt${c.comp_amount ? ` · ${c.comp_amount.toLocaleString("vi-VN")}đ` : ""}${c.comp_edited ? ` · đã chỉnh sửa${c.comp_from ? ` (trước ${c.comp_from.toLocaleString("vi-VN")}đ)` : ""}` : ""}` : c.comp_pending > 0 ? `Chưa chốt · dự kiến ${c.comp_pending.toLocaleString("vi-VN")}đ (CS điền, Ops chưa chấp nhận)` : "Chưa chốt"}</Field>
          {SHOW_TRUY_THU && <Field label="Truy thu">{c.truy_thu === "co" ? `Có · ${(c.truy_thu_amount || 0).toLocaleString("vi-VN")}đ (đã duyệt)` : c.truy_thu === "khong" ? "Không truy thu (đã duyệt)" : "Chờ chốt"}</Field>}
          {c.amount > 0 && <Field label="Số tiền (nguồn)">{`${c.amount.toLocaleString("vi-VN")} đ`}</Field>}
        </div>

        {/* Gallery ảnh Rillnet — hiển thị nếu record có image_urls / evidence_links / links / hinh_anh */}
        {(() => {
          const raw = c.image_urls || c.evidence_links || c.links || c.hinh_anh || "";
          const urls = Array.isArray(raw)
            ? raw.filter(Boolean)
            : String(raw).split(/[\n,]+/).map(u => u.trim()).filter(u => u.startsWith("http"));
          if (urls.length) return <ImageGallery urls={urls} />;
          if (c.photo_count > 0) return (
            <div style={{ padding: "8px 0", fontSize: 13, color: "var(--text-secondary)" }}>
              📷 Có {c.photo_count} ảnh ·{" "}
              <a href="https://rillnet.ghn.vn/" target="_blank" rel="noreferrer"
                style={{ color: "var(--cyan)", textDecoration: "underline" }}>
                Xem trên Rillnet
              </a>
            </div>
          );
          return null;
        })()}

        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Người phụ trách</div>
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!canEdit} placeholder="Chưa gán" style={input} />
        </div>

        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Nhật ký ghi chú</div>
          <div style={{
            fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "var(--input-bg)", border: "1px solid var(--border)",
            borderRadius: 6, padding: 10, maxHeight: 200, overflowY: "auto", color: claim.notes ? "var(--text-primary)" : "var(--text-muted)",
          }}>
            {claim.notes || "Chưa có ghi chú."}
          </div>
          {canEdit && (
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3}
              placeholder="Thêm ghi chú mới (vd: đã liên hệ kho giao, chờ ảnh hiện trường...)" style={{ ...input, marginTop: 8, resize: "vertical" }} />
          )}
        </div>

        {claim.updatedAt && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Cập nhật lần cuối: {new Date(claim.updatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {claim.updatedBy}
          </div>
        )}
        {error && <div style={{ color: "var(--red)", fontSize: 13 }}>⚠ {error}</div>}

        {canEdit ? (
          <button className="btn-primary" disabled={!dirty || saving} onClick={save} style={{ marginTop: "auto" }}>
            {saving ? "Đang lưu vào Google Sheet…" : "Lưu"}
          </button>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: "auto" }}>Chỉ Manager và SD3 được cập nhật ca hư hỏng.</div>
        )}
      </div>
    </div>
  );
}

export default function DetailedDamageTable({ cases, filter, showClaimsWorkflow = true, externalCase = null, onExternalClose = null }) {
  const [claims, setClaims] = useState({});
  const [canEdit, setCanEdit] = useState(false);
  const [openCode, setOpenCode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openClosedFilter, setOpenClosedFilter] = useState("all"); // "all" | "open" | "closed"

  useEffect(() => {
    if (!showClaimsWorkflow) return;
    fetch("/api/damage-claims")
      .then((r) => r.json())
      .then((json) => { if (json.ok) { setClaims(json.claims || {}); setCanEdit(!!json.canEdit); } })
      .catch(() => {});
  }, [showClaimsWorkflow]);

  const uniqueProjects = [...new Set(cases.map(c => c.client_name).filter(Boolean))].sort();
  const uniqueTypes = [...new Set(cases.map(c => c.damage_type).filter(Boolean))].sort();
  const uniqueWarehouses = [...new Set(cases.map(c => c.warehouse_giao).filter(Boolean))].sort();
  const claimOf = (code) => claims[code] || DEFAULT_CLAIM;

  const saveClaim = async (orderCode, patch) => {
    const res = await fetch("/api/damage-claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderCode, ...patch }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Không lưu được");
    setClaims((prev) => ({ ...prev, [orderCode]: json.claim }));
  };

  const q = searchQuery.trim().toLowerCase();
  const baseFiltered = cases.filter(c => {
    if (filter) {
      if (filter.type === 'type' && String(c.damage_type || "").trim().toLowerCase() !== String(filter.value || "").trim().toLowerCase()) return false;
      if (filter.type === 'province' && c.to_province !== filter.value) return false;
      if (filter.type === 'warehouse' && c.warehouse_giao !== filter.value) return false;
    }
    if (projectFilter !== "all" && c.client_name !== projectFilter) return false;
    if (typeFilter !== "all" && c.damage_type !== typeFilter) return false;
    if (warehouseFilter !== "all" && c.warehouse_giao !== warehouseFilter) return false;
    if (q) {
      const haystack = `${c.order_code} ${c.client_name} ${c.to_province} ${c.warehouse_giao} ${c.kho_lay} ${c.damage_details} ${c.offence_place}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  // Pipeline counts follow every filter except the status one itself.
  const statusCounts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0]));
  baseFiltered.forEach((c) => { statusCounts[claimOf(c.order_code).status]++; });
  const byStatus = statusFilter === "all" ? baseFiltered : baseFiltered.filter((c) => claimOf(c.order_code).status === statusFilter);
  const filteredCases = openClosedFilter === "all" ? byStatus
    : openClosedFilter === "open"   ? byStatus.filter((c) => claimOf(c.order_code).status !== "Đã đóng")
    : byStatus.filter((c) => claimOf(c.order_code).status === "Đã đóng");

  const hasLocalFilters = q || projectFilter !== "all" || typeFilter !== "all" || warehouseFilter !== "all" || statusFilter !== "all" || openClosedFilter !== "all";
  const clearLocalFilters = () => {
    setSearchQuery(""); setProjectFilter("all"); setTypeFilter("all"); setWarehouseFilter("all"); setStatusFilter("all"); setOpenClosedFilter("all");
  };
  const showAmount = cases.some((c) => c.amount > 0);
  // externalCase: a case opened from "Ca còn mở" (may be outside the month/date filter)
  const openCase = externalCase || (openCode ? cases.find((c) => c.order_code === openCode) : null);

  const selectStyle = {
    background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 6, fontSize: 12, padding: "6px 8px", fontFamily: "inherit", cursor: "pointer",
    maxWidth: "100%", // long warehouse names must not push the row past a phone screen
  };

  return (
    <div style={{ marginTop: 16 }}>
      {showClaimsWorkflow && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Trạng thái ca:</span>
          {[["all", "Tất cả"], ["open", "Chỉ ca CÒN MỞ"], ["closed", "Ca ĐÃ ĐÓNG"]].map(([v, label]) => (
            <button key={v} onClick={() => setOpenClosedFilter(v)} style={{
              padding: "4px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600,
              border: `1px solid ${openClosedFilter === v ? "var(--cyan)" : "var(--border)"}`,
              background: openClosedFilter === v ? "rgba(6,182,212,0.12)" : "transparent",
              color: openClosedFilter === v ? "var(--cyan)" : "var(--text-muted)",
            }}>{label}</button>
          ))}
        </div>
      )}
      {showClaimsWorkflow && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
          {CLAIM_STATUSES.map((s, i) => {
            const on = statusFilter === s;
            return (
              <button key={s} onClick={() => setStatusFilter(on ? "all" : s)} style={{
                textAlign: "left", padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${on ? STATUS_COLOR[s] : "var(--border)"}`, borderLeft: `4px solid ${STATUS_COLOR[s]}`,
                background: on ? "rgba(var(--brand-rgb),0.08)" : "var(--bg-panel)", color: "var(--text-primary)",
              }}>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{i + 1}. {s}{i < 3 ? " →" : ""}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLOR[s] }}>{statusCounts[s]}</div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 Tìm mã đơn, dự án, kho, chặng..."
          style={{
            background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
            borderRadius: 6, fontSize: 12, padding: "6px 10px", fontFamily: "inherit", minWidth: 220, flex: 1,
          }}
        />
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả dự án</option>
          {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả loại lỗi</option>
          {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả kho</option>
          {uniqueWarehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        {hasLocalFilters && (
          <button
            onClick={clearLocalFilters}
            style={{ background: "rgba(244,63,94,0.15)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 11, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
          >
            Xóa lọc x
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {filteredCases.length} / {cases.length} ca{showClaimsWorkflow ? " · bấm vào dòng để xem & cập nhật" : ""}
        </span>
      </div>

      <div style={{ overflowX: "auto", maxHeight: 440, overflowY: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>Dự án</th>
            <th>Kho lấy → Kho giao</th>
            <th>Tỉnh nhận</th>
            <th>Loại lỗi</th>
            <th>Chặng nghi vấn</th>
            <th>{SHOW_TRUY_THU ? "Đền bù / Truy thu" : "Đền bù cho khách"}</th>
            {showAmount && <th style={{ textAlign: "right" }}>Số tiền</th>}
            {showClaimsWorkflow && <th>Trạng thái xử lý</th>}
            {showClaimsWorkflow && <th>Người phụ trách</th>}
          </tr>
        </thead>
        <tbody>
          {filteredCases.map((c, i) => {
            const claim = claimOf(c.order_code);
            return (
            <tr key={i} onClick={showClaimsWorkflow && c.order_code ? () => setOpenCode(c.order_code) : undefined}
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: showClaimsWorkflow ? "pointer" : "default" }}>
              <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "var(--cyan)" }}>{c.order_code}</td>
              <td style={{ fontSize: 12 }}>{c.client_name}</td>
              <td style={{ fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${c.kho_lay} → ${c.warehouse_giao}`}>
                {c.kho_lay || "?"} → {c.warehouse_giao || "?"}
              </td>
              <td style={{ fontSize: 12 }}>{c.to_province}</td>
              <td><span className="badge bg-red" style={{ fontSize: 10, padding: "2px 6px" }}>{c.damage_type}</span></td>
              <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.damage_details || "—"}</td>
              <td><CompBadges c={c} /></td>
              {showAmount && (
                <td style={{ textAlign: "right", fontFamily: "monospace", color: "var(--amber)", fontSize: 12, fontWeight: 600 }}>
                  {c.amount > 0 ? c.amount.toLocaleString("vi-VN") + " đ" : "—"}
                </td>
              )}
              {showClaimsWorkflow && <td><StatusBadge status={claim.status} /></td>}
              {showClaimsWorkflow && <td style={{ fontSize: 12, color: claim.assignee ? "var(--text-primary)" : "var(--text-muted)" }}>{claim.assignee || "Chưa gán"}</td>}
            </tr>
            );
          })}
          {filteredCases.length === 0 && (
            <tr>
              <td colSpan={10} style={{ textAlign: "center", color: "var(--text-muted)", padding: 30 }}>
                {cases.length === 0 ? "Không có dữ liệu ca hư hỏng chi tiết." : "Không có ca nào khớp bộ lọc hiện tại."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {openCase && (
        <ClaimDrawer
          key={openCase.order_code}
          c={openCase}
          claim={claimOf(openCase.order_code)}
          canEdit={canEdit}
          onClose={() => { setOpenCode(null); onExternalClose?.(); }}
          onSave={saveClaim}
        />
      )}
    </div>
  );
}
