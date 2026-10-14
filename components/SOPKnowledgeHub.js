/**
 * components/SOPKnowledgeHub.js
 * Tab "SOP & Điểm Giao" — Cards/Accordion per B2B client.
 * Sections: 4 bước chuẩn + custom steps do Manager tự cấu hình.
 * Manager: thêm/xóa bước, inline-edit text + image URLs; viewer: thumbnails + lightbox.
 */
import { useState, useEffect, useCallback, useRef } from "react";

const DEFAULT_STEP_KEYS = ["pickup", "linehaul", "delivery", "epod_docs"];

const SECTION_CFG = {
  pickup: {
    label: "📦 Chặng 1 — Lấy Hàng (Pickup)",
    color: "var(--cyan)",
    bg: "rgba(var(--brand-rgb),0.08)",
    hint: "CCDC bốc xếp, tem seal/niêm phong, kiểm đếm ngoại quan, thủ tục cổng, cut-off",
    imgHint: "Ảnh mẫu tem seal, sơ đồ cổng kho, CCDC yêu cầu…",
  },
  linehaul: {
    label: "🚛 Chặng 2 — Trung Chuyển (Linehaul)",
    color: "var(--amber)",
    bg: "rgba(245,158,11,0.08)",
    hint: "Loại xe, xếp tầng (stacking limit), chèn lót thùng xe, tuyến FTL/LTL, thông tin tài xế",
    imgHint: "Ảnh cách xếp xe, vách ngăn bo góc, quy cách chèn lót…",
  },
  delivery: {
    label: "📍 Chặng 3 — Giao Hàng (Delivery)",
    color: "var(--green)",
    bg: "rgba(16,185,129,0.08)",
    hint: "Khung giờ TTTM/siêu thị, tải trọng xe cho phép, nhân sự bốc xếp điểm giao",
    imgHint: "Sơ đồ hầm B2, vị trí dock/cổng giao hàng, bãi tập kết…",
  },
  epod_docs: {
    label: "📄 Chặng 4 — EPOD & Chứng Từ",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.08)",
    hint: "Bộ chứng từ bắt buộc (PO/VAT/serial), quy chuẩn chữ ký/dấu, thời hạn nộp POD",
    imgHint: "Mẫu POD, biên bản bàn giao, form chữ ký thủ kho…",
  },
};

const STEP_COLORS = [
  { value: "#06b6d4", label: "Xanh cyan" },
  { value: "#f59e0b", label: "Cam vàng" },
  { value: "#10b981", label: "Xanh lá" },
  { value: "#8b5cf6", label: "Tím" },
  { value: "#ef4444", label: "Đỏ" },
  { value: "#f97316", label: "Cam" },
  { value: "#3b82f6", label: "Xanh biển" },
  { value: "#ec4899", label: "Hồng" },
];

function hexToBg(hex) {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},0.08)`;
  } catch {
    return "rgba(6,182,212,0.08)";
  }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ url, onClose }) {
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.82)", display: "flex",
        alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 20,
          background: "none", border: "none", color: "#fff",
          fontSize: 28, cursor: "pointer", lineHeight: 1, padding: 4,
        }}
        aria-label="Đóng"
      >
        ×
      </button>
      <img
        src={url}
        alt="Ảnh minh họa"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: "90vw", maxHeight: "86vh",
          borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

// ── Thumbnail grid ─────────────────────────────────────────────────────────────
function ThumbnailGrid({ urls, onOpen }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {urls.map((url, i) => (
        <button
          key={i}
          onClick={() => onOpen(toDisplayUrl(url))}
          title="Bấm để phóng to"
          style={{
            width: 80, height: 80, padding: 0, border: "2px solid var(--border)",
            borderRadius: 6, overflow: "hidden", cursor: "zoom-in",
            background: "var(--bg-panel)", flexShrink: 0,
            transition: "border-color 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "var(--cyan)"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <img
            src={toDisplayUrl(url)}
            alt={`Ảnh ${i + 1}`}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            onError={e => {
              e.currentTarget.style.display = "none";
              e.currentTarget.parentElement.style.background = "rgba(100,116,139,0.15)";
            }}
          />
        </button>
      ))}
    </div>
  );
}

// ── Wrap private blob URL qua proxy ───────────────────────────────────────────
function toDisplayUrl(url) {
  if (!url) return url;
  if (url.startsWith("/api/sop/image")) return url;
  if (url.includes("blob.vercel-storage.com")) {
    return `/api/sop/image?b=${encodeURIComponent(url)}`;
  }
  if (url.includes("/api/sop/image?b=")) {
    try {
      const inner = decodeURIComponent(new URL(url).searchParams.get("b") || "");
      if (inner) return `/api/sop/image?b=${encodeURIComponent(inner)}`;
    } catch {}
  }
  return url;
}

// ── Parse URL input ────────────────────────────────────────────────────────────
function parseUrlInput(text) {
  return text
    .split(/[\n,]+/)
    .map(u => u.trim())
    .filter(u => u.startsWith("http"));
}

// ── Image upload area ──────────────────────────────────────────────────────────
function ImageUploadArea({ urls, onChange, onOpenLightbox, color }) {
  const [dragging, setDragging]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef                   = useRef(null);

  const doUpload = async (files) => {
    const images = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!images.length) return;
    setUploading(true);
    setUploadErr("");
    const next = [...urls];
    let errMsg = "";
    for (const file of images) {
      try {
        const ab = await file.arrayBuffer();
        const r  = await fetch(
          `/api/sop/upload-image?filename=${encodeURIComponent(file.name)}`,
          { method: "POST", body: ab, headers: { "Content-Type": file.type } }
        );
        let d;
        try { d = await r.json(); } catch { d = { ok: false, error: `Lỗi ${r.status}` }; }
        if (d.ok) {
          next.push(d.url);
        } else {
          errMsg = d.error || `Lỗi ${r.status}`;
        }
      } catch (e) {
        errMsg = e.message || "Upload thất bại";
      }
    }
    onChange(next);
    setUploading(false);
    if (errMsg) setUploadErr(errMsg);
  };

  const addPasteUrls = () => {
    const added = parseUrlInput(pasteText);
    if (added.length) onChange([...urls, ...added]);
    setPasteText("");
    setShowPaste(false);
  };

  const remove = (idx) => onChange(urls.filter((_, i) => i !== idx));

  return (
    <div>
      {urls.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {urls.map((url, i) => (
            <div key={i} style={{ position: "relative" }}>
              <button
                onClick={() => onOpenLightbox(toDisplayUrl(url))}
                title="Bấm để phóng to"
                style={{
                  width: 80, height: 80, padding: 0,
                  border: `2px solid ${color}`, borderRadius: 6,
                  overflow: "hidden", cursor: "zoom-in", background: "var(--bg-panel)",
                }}
              >
                <img
                  src={toDisplayUrl(url)} alt={`Ảnh ${i + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={e => { e.currentTarget.style.display = "none"; }}
                />
              </button>
              <button
                onClick={() => remove(i)}
                title="Xóa ảnh"
                style={{
                  position: "absolute", top: -6, right: -6,
                  width: 18, height: 18, borderRadius: "50%",
                  background: "var(--red)", color: "#fff",
                  border: "none", cursor: "pointer",
                  fontSize: 11, lineHeight: 1, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  fontFamily: "inherit",
                }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      <div
        onDrop={e => { e.preventDefault(); setDragging(false); doUpload(e.dataTransfer.files); }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? color : "var(--border)"}`,
          borderRadius: 7, padding: "10px 14px", textAlign: "center",
          cursor: "pointer", fontSize: 12,
          color: dragging ? color : "var(--text-muted)",
          background: dragging ? `rgba(0,0,0,0.03)` : "transparent",
          transition: "all 0.15s", marginBottom: 6, userSelect: "none",
        }}
      >
        {uploading ? "⏳ Đang upload…" : "📁 Upload ảnh hoặc kéo thả vào đây (PNG, JPG, WebP)"}
      </div>
      <input
        ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={e => { doUpload(e.target.files); e.target.value = ""; }}
      />
      {uploadErr && (
        <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>⚠️ {uploadErr}</div>
      )}

      <button
        onClick={() => setShowPaste(v => !v)}
        style={{
          background: "none", border: "none", fontSize: 11,
          color: "var(--text-muted)", cursor: "pointer",
          padding: 0, fontFamily: "inherit", textDecoration: "underline",
        }}
      >
        {showPaste ? "▲ Ẩn" : "🔗 Hoặc dán URL ảnh"}
      </button>
      {showPaste && (
        <div style={{ marginTop: 6 }}>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={2}
            placeholder="https://… (mỗi dòng hoặc cách nhau bởi dấu phẩy)"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              borderRadius: 6, color: "var(--text-primary)",
              fontSize: 11.5, padding: "6px 8px", fontFamily: "monospace",
              resize: "vertical",
            }}
          />
          <button
            onClick={addPasteUrls}
            style={{
              marginTop: 4, background: color, color: "#fff", border: "none",
              borderRadius: 5, padding: "3px 10px", fontSize: 11,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >Thêm</button>
        </div>
      )}
    </div>
  );
}

// ── Section block ──────────────────────────────────────────────────────────────
// cfg prop: { label, color, bg, hint, imgHint? }
// onDeleteStep: callback khi xóa custom step (undefined cho 4 bước mặc định)
function SectionBlock({ sectionKey, cfg: cfgProp, lines, manualNote, imageUrls, isManager, onSaveNote, onOpenLightbox, onDeleteStep }) {
  const cfg = cfgProp || SECTION_CFG[sectionKey] || {
    label: sectionKey, color: "var(--cyan)",
    bg: "rgba(var(--brand-rgb),0.08)", hint: "",
  };

  const [editing, setEditing]       = useState(false);
  const [draft, setDraft]           = useState(manualNote || "");
  const [imgUrls, setImgUrls]       = useState(imageUrls || []);
  const [saving, setSaving]         = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveNote(sectionKey, draft, imgUrls);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    setDraft(manualNote || lines.join("\n"));
    setImgUrls(imageUrls || []);
    setEditing(true);
  };

  const displayItems = manualNote
    ? manualNote.split("\n").map(l => l.trim()).filter(Boolean)
    : lines;

  return (
    <div style={{
      background: cfg.bg,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: "0 8px 8px 0",
      padding: "10px 14px",
      marginBottom: 8,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: (displayItems.length > 0 || (imageUrls && imageUrls.length > 0)) ? 8 : 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 12.5, color: cfg.color }}>{cfg.label}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {isManager && !editing && (
            <button
              onClick={handleEdit}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, color: "var(--text-muted)", padding: "2px 6px", borderRadius: 4,
              }}
              title="Chỉnh sửa ghi chú và ảnh"
            >✏️ Sửa</button>
          )}
          {isManager && onDeleteStep && !editing && (
            <button
              onClick={() => setConfirmDel(true)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, color: "var(--red)", padding: "2px 4px", borderRadius: 4,
              }}
              title="Xóa bước này"
            >🗑️</button>
          )}
        </div>
      </div>

      {/* Confirm delete strip */}
      {confirmDel && (
        <div style={{
          marginBottom: 8, padding: "8px 10px",
          background: "rgba(244,63,94,0.06)", borderRadius: 6,
          border: "1px solid rgba(244,63,94,0.25)",
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 11.5, color: "var(--red)", flex: 1 }}>
            Xóa bước <strong>{cfg.label}</strong>? Ghi chú + ảnh của bước này cũng sẽ mất.
          </span>
          <button
            onClick={() => { setConfirmDel(false); onDeleteStep(); }}
            style={{
              background: "var(--red)", color: "#fff", border: "none", borderRadius: 5,
              padding: "3px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}
          >Xóa</button>
          <button
            onClick={() => setConfirmDel(false)}
            style={{
              background: "none", border: "1px solid var(--border)", borderRadius: 5,
              padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "var(--text-secondary)",
            }}
          >Hủy</button>
        </div>
      )}

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={4}
            placeholder={cfg.hint}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              borderRadius: 6, color: "var(--text-primary)",
              fontSize: 12, padding: "6px 8px", fontFamily: "inherit",
              resize: "vertical", marginBottom: 10,
            }}
          />
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
            🖼️ Ảnh minh họa
          </label>
          <ImageUploadArea
            urls={imgUrls}
            onChange={setImgUrls}
            onOpenLightbox={onOpenLightbox}
            color={cfg.color}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: cfg.color, color: "#fff", border: "none",
                borderRadius: 5, padding: "4px 12px", fontSize: 12,
                cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}
            >{saving ? "Đang lưu…" : "Lưu"}</button>
            <button
              onClick={() => setEditing(false)}
              style={{
                background: "none", border: "1px solid var(--border)", borderRadius: 5,
                padding: "4px 12px", fontSize: 12, cursor: "pointer",
                color: "var(--text-muted)", fontFamily: "inherit",
              }}
            >Hủy</button>
            {manualNote && (
              <button
                onClick={() => { setDraft(""); setImgUrls([]); handleSave(); }}
                style={{
                  background: "none", border: "none", fontSize: 11,
                  color: "var(--red)", cursor: "pointer", marginLeft: "auto",
                  fontFamily: "inherit",
                }}
              >Xóa ghi chú thủ công</button>
            )}
          </div>
        </div>
      ) : (
        <>
          {displayItems.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, listStyle: "disc" }}>
              {displayItems.map((item, i) => (
                <li key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 3, lineHeight: 1.5 }}>
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontStyle: "italic" }}>
              {cfg.hint}
              {isManager && <span style={{ color: cfg.color }}> — nhấn ✏️ Sửa để thêm ghi chú.</span>}
            </span>
          )}
          <ThumbnailGrid urls={imageUrls} onOpen={onOpenLightbox} />
        </>
      )}
    </div>
  );
}

// ── Add Step Form (inline, inside ClientCard) ──────────────────────────────────
function AddStepForm({ onSave, onCancel, saving }) {
  const [draft, setDraft] = useState({ label: "", color: "#06b6d4", hint: "" });

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "var(--bg-main)", border: "1px solid var(--border)",
    borderRadius: 6, padding: "6px 9px", fontSize: 12,
    color: "var(--text-primary)", fontFamily: "inherit",
  };

  return (
    <div style={{
      marginTop: 8, padding: "12px 14px",
      background: "rgba(var(--brand-rgb),0.04)",
      border: "1px dashed rgba(var(--brand-rgb),0.3)",
      borderRadius: 8,
    }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: "var(--cyan)", marginBottom: 10 }}>
        ➕ Bước mới
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>
          Tên bước <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <input
          type="text"
          value={draft.label}
          onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
          placeholder="vd: Kiểm hàng đặc biệt, Xử lý hoàn hàng…"
          style={inputStyle}
          autoFocus
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>
          Màu badge
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STEP_COLORS.map(c => (
            <button
              key={c.value}
              onClick={() => setDraft(d => ({ ...d, color: c.value }))}
              title={c.label}
              style={{
                width: 26, height: 26, borderRadius: "50%",
                background: c.value, cursor: "pointer", border: "none",
                outline: draft.color === c.value ? `3px solid ${c.value}` : "3px solid transparent",
                outlineOffset: 2,
                transition: "outline 0.1s",
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>
          Mô tả gợi ý (hint)
        </label>
        <input
          type="text"
          value={draft.hint}
          onChange={e => setDraft(d => ({ ...d, hint: e.target.value }))}
          placeholder="vd: Các thao tác cần làm ở bước này…"
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => onSave(draft)}
          disabled={saving || !draft.label.trim()}
          style={{
            background: draft.color || "var(--cyan)", color: "#fff", border: "none",
            borderRadius: 6, padding: "5px 16px", fontSize: 12, fontWeight: 600,
            cursor: (saving || !draft.label.trim()) ? "not-allowed" : "pointer",
            opacity: (saving || !draft.label.trim()) ? 0.6 : 1,
          }}
        >{saving ? "Đang lưu…" : "Thêm bước"}</button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 6,
            padding: "5px 12px", fontSize: 12, cursor: "pointer",
            color: "var(--text-secondary)", fontFamily: "inherit",
          }}
        >Hủy</button>
      </div>
    </div>
  );
}

// ── Client card ────────────────────────────────────────────────────────────────
function ClientCard({ summary, isManager, onSaveNote, onEditEntry, onDeleteEntry, onAddStep, onDeleteStep }) {
  const [open, setOpen]             = useState(false);
  const [lightboxUrl, setLightbox]  = useState(null);
  const [editMode, setEditMode]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [kbDraft, setKbDraft]       = useState(null);
  const [kbSaving, setKbSaving]     = useState(false);
  const [kbError, setKbError]       = useState("");
  const [addingStep, setAddingStep] = useState(false);
  const [stepSaving, setStepSaving] = useState(false);

  const openEdit = async (e) => {
    e.stopPropagation();
    setKbSaving(true);
    setKbError("");
    try {
      const res  = await fetch("/api/sops-knowledge");
      const data = await res.json();
      const entry = (data.entries || []).find(en => en.id === summary.id);
      if (!entry) throw new Error("Không tìm thấy entry trong KB");
      setKbDraft({
        title:    entry.title,
        tags:     (entry.tags || []).join(", "),
        content:  entry.content,
        category: entry.category || "khác",
      });
      setEditMode(true);
      setOpen(true);
    } catch (err) {
      setKbError(err.message);
    } finally {
      setKbSaving(false);
    }
  };

  const saveEdit = async () => {
    setKbSaving(true);
    setKbError("");
    try {
      const tagsArr = kbDraft.tags.split(",").map(t => t.trim()).filter(Boolean);
      const res = await fetch("/api/sops-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          entry: {
            id:       summary.id,
            title:    kbDraft.title.trim(),
            tags:     tagsArr,
            content:  kbDraft.content,
            category: kbDraft.category || "khác",
            // customSteps not passed → API preserves existing
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Lưu thất bại");
      onEditEntry(summary.id, { title: kbDraft.title.trim(), tags: tagsArr });
      setEditMode(false);
    } catch (err) {
      setKbError(err.message);
    } finally {
      setKbSaving(false);
    }
  };

  const doDelete = async () => {
    setKbSaving(true);
    setKbError("");
    try {
      const res = await fetch("/api/sops-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: summary.id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Xóa thất bại");
      onDeleteEntry(summary.id);
    } catch (err) {
      setKbError(err.message);
      setKbSaving(false);
    }
  };

  const handleAddStep = async (stepDraft) => {
    setStepSaving(true);
    setKbError("");
    try {
      const res = await fetch("/api/sops-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:   "add-step",
          entry_id: summary.id,
          step:     stepDraft,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Thêm bước thất bại");
      onAddStep(summary.id, data.step);
      setAddingStep(false);
    } catch (err) {
      setKbError(err.message);
    } finally {
      setStepSaving(false);
    }
  };

  const handleDeleteStep = async (stepId) => {
    setKbSaving(true);
    setKbError("");
    try {
      const res = await fetch("/api/sops-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:   "remove-step",
          entry_id: summary.id,
          step_id:  stepId,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Xóa bước thất bại");
      onDeleteStep(summary.id, stepId);
    } catch (err) {
      setKbError(err.message);
    } finally {
      setKbSaving(false);
    }
  };

  const customSteps = summary.customSteps || [];
  const allStepIds  = [...DEFAULT_STEP_KEYS, ...customSteps.map(s => s.id)];

  return (
    <>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightbox(null)} />}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", background: "var(--bg-panel)" }}>
          <button
            onClick={() => setOpen(v => !v)}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 12px 12px 16px", background: "none", border: "none",
              cursor: "pointer", fontFamily: "inherit", textAlign: "left", minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text-primary)" }}>
                {summary.title}
              </span>
              {summary.client_id && (
                <span style={{
                  fontSize: 10.5, fontWeight: 600,
                  background: "rgba(var(--brand-rgb),0.12)", color: "var(--cyan)",
                  borderRadius: 4, padding: "1px 7px",
                }}>
                  Client {summary.client_id}
                </span>
              )}
              {customSteps.length > 0 && (
                <span style={{
                  fontSize: 10, color: "var(--text-muted)",
                  background: "rgba(100,116,139,0.1)", borderRadius: 4, padding: "1px 6px",
                }}>
                  +{customSteps.length} bước
                </span>
              )}
              {summary.tags?.slice(0, 3).map(t => (
                <span key={t} style={{
                  fontSize: 10, color: "var(--text-muted)",
                  background: "rgba(100,116,139,0.1)", borderRadius: 4, padding: "1px 6px",
                }}>{t}</span>
              ))}
            </div>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2"
              style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0, marginLeft: 8 }}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {isManager && (
            <div style={{ display: "flex", gap: 4, padding: "0 12px", flexShrink: 0 }}>
              <button
                onClick={openEdit}
                disabled={kbSaving}
                title="Sửa KB entry"
                style={{
                  background: "none", border: "1px solid var(--border)", borderRadius: 5,
                  padding: "3px 9px", fontSize: 11, color: "var(--text-muted)",
                  cursor: kbSaving ? "not-allowed" : "pointer", fontFamily: "inherit",
                  opacity: kbSaving ? 0.5 : 1,
                }}
              >✏️ Sửa KB</button>
              <button
                onClick={() => { setConfirmDel(true); setKbError(""); }}
                disabled={kbSaving}
                title="Xóa KB entry"
                style={{
                  background: "none", border: "1px solid rgba(244,63,94,0.4)", borderRadius: 5,
                  padding: "3px 9px", fontSize: 11, color: "var(--red)",
                  cursor: kbSaving ? "not-allowed" : "pointer", fontFamily: "inherit",
                  opacity: kbSaving ? 0.5 : 1,
                }}
              >🗑️</button>
            </div>
          )}
        </div>

        {/* Delete confirm strip */}
        {confirmDel && (
          <div style={{
            padding: "8px 16px", background: "rgba(244,63,94,0.06)",
            borderTop: "1px solid rgba(244,63,94,0.2)",
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 12, color: "var(--red)", flex: 1 }}>
              ⚠️ Xóa vĩnh viễn SOP <strong>{summary.title}</strong>? Không thể khôi phục.
            </span>
            <button
              onClick={doDelete} disabled={kbSaving}
              style={{
                background: "var(--red)", color: "#fff", border: "none", borderRadius: 5,
                padding: "4px 14px", fontSize: 12, fontWeight: 600,
                cursor: kbSaving ? "not-allowed" : "pointer", opacity: kbSaving ? 0.7 : 1,
              }}
            >{kbSaving ? "Đang xóa…" : "Xóa"}</button>
            <button
              onClick={() => { setConfirmDel(false); setKbError(""); }} disabled={kbSaving}
              style={{
                background: "none", border: "1px solid var(--border)", borderRadius: 5,
                padding: "4px 12px", fontSize: 12, cursor: "pointer", color: "var(--text-secondary)",
              }}
            >Hủy</button>
            {kbError && <span style={{ fontSize: 11, color: "var(--red)" }}>{kbError}</span>}
          </div>
        )}

        {/* Body */}
        {open && (
          <div style={{ borderTop: "1px solid var(--border)" }}>
            {editMode ? (
              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--cyan)", marginBottom: 12 }}>
                  ✏️ Chỉnh sửa KB — {summary.title}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                    Tên KH / Tiêu đề
                  </label>
                  <input
                    type="text"
                    value={kbDraft.title}
                    onChange={e => setKbDraft(d => ({ ...d, title: e.target.value }))}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--bg-main)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "7px 10px", fontSize: 12.5,
                      color: "var(--text-primary)", fontFamily: "inherit",
                    }}
                  />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                    Tags (cách nhau bởi dấu phẩy)
                  </label>
                  <input
                    type="text"
                    value={kbDraft.tags}
                    onChange={e => setKbDraft(d => ({ ...d, tags: e.target.value }))}
                    placeholder="vd: aqua, b2b, tttm"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--bg-main)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "7px 10px", fontSize: 12.5,
                      color: "var(--text-primary)", fontFamily: "inherit",
                    }}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                    Nội dung SOP (Markdown)
                  </label>
                  <textarea
                    value={kbDraft.content}
                    onChange={e => setKbDraft(d => ({ ...d, content: e.target.value }))}
                    rows={14}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--bg-main)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "7px 10px", fontSize: 12,
                      color: "var(--text-primary)", fontFamily: "inherit", resize: "vertical",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
                {kbError && (
                  <div style={{ fontSize: 11.5, color: "var(--red)", marginBottom: 8 }}>⚠️ {kbError}</div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={saveEdit}
                    disabled={kbSaving || !kbDraft.title.trim() || !kbDraft.content.trim()}
                    style={{
                      background: "var(--cyan)", color: "#fff", border: "none", borderRadius: 6,
                      padding: "6px 18px", fontSize: 12.5, fontWeight: 600,
                      cursor: (kbSaving || !kbDraft.title.trim() || !kbDraft.content.trim()) ? "not-allowed" : "pointer",
                      opacity: (kbSaving || !kbDraft.title.trim() || !kbDraft.content.trim()) ? 0.6 : 1,
                    }}
                  >{kbSaving ? "Đang lưu…" : "Lưu KB"}</button>
                  <button
                    onClick={() => { setEditMode(false); setKbError(""); }}
                    disabled={kbSaving}
                    style={{
                      background: "none", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "6px 14px", fontSize: 12.5, cursor: "pointer",
                      color: "var(--text-secondary)", fontFamily: "inherit",
                    }}
                  >Hủy</button>
                </div>
              </div>
            ) : (
              <div style={{ padding: "12px 16px 14px" }}>
                {/* Render 4 bước chuẩn + custom steps */}
                {allStepIds.map(secId => {
                  const customStep = customSteps.find(s => s.id === secId);
                  const cfg = customStep
                    ? { label: customStep.label, color: customStep.color || "#06b6d4", bg: hexToBg(customStep.color || "#06b6d4"), hint: customStep.hint || "" }
                    : SECTION_CFG[secId];
                  return (
                    <SectionBlock
                      key={secId}
                      sectionKey={secId}
                      cfg={cfg}
                      lines={summary[secId] || []}
                      manualNote={summary.manualNote?.[secId] || ""}
                      imageUrls={summary.imageUrls?.[secId] || []}
                      isManager={isManager}
                      onSaveNote={(section, content, imgs) => onSaveNote(summary.id, section, content, imgs)}
                      onOpenLightbox={setLightbox}
                      onDeleteStep={customStep ? () => handleDeleteStep(secId) : undefined}
                    />
                  );
                })}

                {/* Thêm bước mới (manager only) */}
                {isManager && !addingStep && (
                  <button
                    onClick={() => setAddingStep(true)}
                    style={{
                      marginTop: 4, width: "100%", background: "none",
                      border: "1px dashed var(--border)", borderRadius: 7,
                      padding: "7px 0", fontSize: 12, color: "var(--text-muted)",
                      cursor: "pointer", fontFamily: "inherit",
                      transition: "border-color 0.15s, color 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--cyan)"; e.currentTarget.style.color = "var(--cyan)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    ➕ Thêm bước SOP mới
                  </button>
                )}

                {isManager && addingStep && (
                  <AddStepForm
                    onSave={handleAddStep}
                    onCancel={() => { setAddingStep(false); setKbError(""); }}
                    saving={stepSaving}
                  />
                )}

                {kbError && !editMode && !confirmDel && (
                  <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>⚠️ {kbError}</div>
                )}

                {summary.updatedAt && (
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>
                    Cập nhật KB: {new Date(summary.updatedAt).toLocaleDateString("vi-VN")}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Add SOP Panel (manager only) ──────────────────────────────────────────────
const CATEGORIES = ["vận chuyển", "đóng gói", "xử lý sự cố", "CCDC", "quy trình nội bộ", "khách hàng", "khác"];

function AddSOPPanel({ onAdded, onCancel }) {
  const [draft, setDraft]   = useState({ title: "", tags: "", category: "vận chuyển", content: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");

  const handleSave = async () => {
    setSaving(true);
    setErr("");
    try {
      const tagsArr = draft.tags.split(",").map(t => t.trim()).filter(Boolean);
      const res = await fetch("/api/sops-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          entry: {
            title:    draft.title.trim(),
            tags:     tagsArr,
            category: draft.category,
            content:  draft.content,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Lưu thất bại");
      const sumRes = await fetch("/api/sop/summary");
      const sumData = await sumRes.json();
      onAdded(sumData.ok ? (sumData.summaries || []) : null);
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "var(--bg-main)", border: "1px solid var(--border)",
    borderRadius: 6, padding: "7px 10px", fontSize: 12.5,
    color: "var(--text-primary)", fontFamily: "inherit",
  };

  return (
    <div style={{
      marginBottom: 20, padding: "16px 18px",
      background: "rgba(var(--brand-rgb),0.04)", border: "1px solid rgba(var(--brand-rgb),0.25)",
      borderRadius: 10,
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--cyan)", marginBottom: 14 }}>
        ➕ Thêm SOP mới vào Knowledge Base
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            Tên KH / Tiêu đề <span style={{ color: "var(--red)" }}>*</span>
          </label>
          <input
            type="text"
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="vd: SOP FRT B2B"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            Category
          </label>
          <select
            value={draft.category}
            onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
          Tags (cách nhau bởi dấu phẩy)
        </label>
        <input
          type="text"
          value={draft.tags}
          onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
          placeholder="vd: FRT, FPT Retail, B2B, điện máy"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
          Nội dung SOP (Markdown) <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          value={draft.content}
          onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
          rows={16}
          placeholder={`## I. Chân dung khách hàng\n- Khách hàng: ...\n- Client ID: ...\n\n## II. Booking & Cut-off\n...\n\n## III. Quy trình lấy hàng\n...\n\n## IV. Giao hàng\n...`}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, fontSize: 12 }}
        />
      </div>

      {err && <div style={{ fontSize: 11.5, color: "var(--red)", marginBottom: 8 }}>⚠️ {err}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving || !draft.title.trim() || !draft.content.trim()}
          style={{
            background: "var(--cyan)", color: "#fff", border: "none", borderRadius: 6,
            padding: "7px 20px", fontSize: 13, fontWeight: 600,
            cursor: (saving || !draft.title.trim() || !draft.content.trim()) ? "not-allowed" : "pointer",
            opacity: (saving || !draft.title.trim() || !draft.content.trim()) ? 0.6 : 1,
          }}
        >{saving ? "Đang lưu…" : "Thêm SOP"}</button>
        <button
          onClick={onCancel} disabled={saving}
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 6,
            padding: "7px 16px", fontSize: 13, cursor: "pointer",
            color: "var(--text-secondary)", fontFamily: "inherit",
          }}
        >Hủy</button>
      </div>
    </div>
  );
}

// ── GTalk Test Panel (manager only) ───────────────────────────────────────────
function GtalkTestPanel() {
  const [form, setForm]     = useState({ order_code: "TEST001", client_id: "", delivery_staff_id: "" });
  const [result, setResult] = useState(null);
  const [sending, setSend]  = useState(false);

  const handleTest = async () => {
    setSend(true);
    setResult(null);
    try {
      const res = await fetch("/api/notifications/gtalk-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, status: "delivering" }),
      });
      const data = await res.json();
      setResult({ ok: data.ok, raw: data });
    } catch (e) {
      setResult({ ok: false, raw: { error: e.message } });
    } finally {
      setSend(false);
    }
  };

  return (
    <div style={{
      marginBottom: 20, padding: "14px 16px",
      background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.25)",
      borderRadius: 10,
    }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--green)", marginBottom: 10 }}>
        🧪 Test GTalk Dispatch (Manager)
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {[
          { key: "order_code", ph: "Mã đơn (vd: TEST001)" },
          { key: "client_id",  ph: "Client ID (vd: 5438335)" },
          { key: "delivery_staff_id", ph: "Mã NV GHN (vd: 3131671)" },
        ].map(({ key, ph }) => (
          <input
            key={key}
            type="text"
            placeholder={ph}
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            style={{
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "6px 10px", fontSize: 12, color: "var(--text-primary)",
              fontFamily: "inherit", minWidth: 180, flex: 1,
            }}
          />
        ))}
        <button
          onClick={handleTest}
          disabled={sending || !form.client_id || !form.delivery_staff_id}
          style={{
            background: sending ? "var(--bg-panel)" : "var(--green)", color: "#fff",
            border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12,
            fontWeight: 600, cursor: sending ? "not-allowed" : "pointer", opacity: sending ? 0.6 : 1,
          }}
        >{sending ? "Đang gửi…" : "Gửi Test"}</button>
      </div>
      {result && (
        <pre style={{
          margin: 0, fontSize: 11, padding: "8px 10px", borderRadius: 6, overflowX: "auto",
          background: result.ok ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)",
          border: `1px solid ${result.ok ? "var(--green)" : "var(--red)"}`,
          color: result.ok ? "var(--green)" : "var(--red)",
        }}>
          {JSON.stringify(result.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function SOPKnowledgeHub({ role }) {
  const isManager = role === "manager" || role === "sd3";
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [search, setSearch]       = useState("");
  const [saveError, setSaveError] = useState(null);
  const [addMode, setAddMode]     = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/sop/summary")
      .then(r => r.json())
      .then(d => {
        if (d.ok) setSummaries(d.summaries || []);
        else setError(d.error || "Lỗi tải dữ liệu");
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleEditEntry = useCallback((id, { title, tags }) => {
    setSummaries(prev => prev.map(s =>
      s.id !== id ? s : { ...s, title, tags }
    ));
  }, []);

  const handleDeleteEntry = useCallback((id) => {
    setSummaries(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleSaveNote = useCallback(async (id, section, content, imageUrls) => {
    setSaveError(null);
    const res = await fetch("/api/sop/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, section, content, image_urls: imageUrls || [] }),
    });
    const data = await res.json();
    if (!data.ok) { setSaveError(data.error || "Lưu thất bại"); return; }

    setSummaries(prev => prev.map(s => {
      if (s.id !== id) return s;
      return {
        ...s,
        manualNote: { ...s.manualNote, [section]: content },
        imageUrls:  { ...s.imageUrls,  [section]: imageUrls || [] },
      };
    }));
  }, []);

  const handleAddStep = useCallback((id, step) => {
    setSummaries(prev => prev.map(s => {
      if (s.id !== id) return s;
      return {
        ...s,
        customSteps: [...(s.customSteps || []), step],
        manualNote:  { ...s.manualNote, [step.id]: "" },
        imageUrls:   { ...s.imageUrls,  [step.id]: [] },
      };
    }));
  }, []);

  const handleDeleteStep = useCallback((id, stepId) => {
    setSummaries(prev => prev.map(s => {
      if (s.id !== id) return s;
      return {
        ...s,
        customSteps: (s.customSteps || []).filter(step => step.id !== stepId),
      };
    }));
  }, []);

  const filtered = summaries.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.title.toLowerCase().includes(q) ||
      (s.client_id || "").includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q));
  });

  return (
    <div style={{ padding: "20px 24px", maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontWeight: 700, fontSize: 17, margin: 0, marginBottom: 4 }}>
          SOP & Đặc thù điểm giao — B2B Điện Máy
        </h2>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: 0 }}>
          Tóm tắt actionable cho từng khách hàng: yêu cầu kho nguồn, vận tải, và đặc thù điểm giao.
          {isManager && " Manager có thể chỉnh sửa ghi chú, ảnh minh họa và thêm bước tùy chỉnh."}
        </p>
      </div>

      {/* Search + Add button */}
      <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Tìm theo tên KH hoặc Client ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, maxWidth: 320,
            background: "var(--bg-panel)", border: "1px solid var(--border)",
            borderRadius: 7, padding: "7px 12px", fontSize: 12.5,
            color: "var(--text-primary)", fontFamily: "inherit",
          }}
        />
        {summaries.length > 0 && (
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            {filtered.length}/{summaries.length} khách hàng
          </span>
        )}
        {isManager && !addMode && (
          <button
            onClick={() => setAddMode(true)}
            style={{
              background: "var(--cyan)", color: "#fff", border: "none", borderRadius: 7,
              padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >➕ Thêm SOP</button>
        )}
      </div>

      {isManager && addMode && (
        <AddSOPPanel
          onAdded={(freshSummaries) => {
            if (freshSummaries) setSummaries(freshSummaries);
            setAddMode(false);
          }}
          onCancel={() => setAddMode(false)}
        />
      )}

      {isManager && !addMode && <GtalkTestPanel />}

      {saveError && (
        <div style={{
          background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)",
          borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--red)", marginBottom: 12,
        }}>
          {saveError}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 13 }}>
          Đang tải KB…
        </div>
      )}

      {error && !loading && (
        <div style={{
          background: "rgba(244,63,94,0.1)", border: "1px solid var(--red)",
          borderRadius: 8, padding: 16, color: "var(--red)",
        }}>
          Lỗi: {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 13 }}>
          {search ? "Không tìm thấy khách hàng phù hợp." : "Chưa có SOP nào trong Knowledge Base."}
        </div>
      )}

      {filtered.map(s => (
        <ClientCard
          key={s.id}
          summary={s}
          isManager={isManager}
          onSaveNote={handleSaveNote}
          onEditEntry={handleEditEntry}
          onDeleteEntry={handleDeleteEntry}
          onAddStep={handleAddStep}
          onDeleteStep={handleDeleteStep}
        />
      ))}

      {/* Legend */}
      {!loading && filtered.length > 0 && (
        <div style={{
          marginTop: 20, padding: "10px 14px",
          background: "var(--bg-panel)", borderRadius: 8,
          border: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-muted)",
        }}>
          <strong style={{ color: "var(--text-secondary)" }}>Chú thích:</strong>{" "}
          Nội dung auto-parse từ KB. ✏️ Sửa để thêm ghi chú + ảnh minh họa.
          Manager: ➕ Thêm bước SOP mới trong mỗi card. Thêm SOP mới: chạy{" "}
          <code style={{ background: "rgba(100,116,139,0.15)", padding: "1px 4px", borderRadius: 3 }}>
            node scripts/seed_sops_knowledge.mjs
          </code>.
        </div>
      )}
    </div>
  );
}
