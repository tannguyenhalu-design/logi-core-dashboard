/**
 * components/ltl/WeeklyReviewBoard.js
 * Bàn Review Tuần dành cho Manager — 3 phần:
 *   1. Biến động sản lượng KH W_prev vs W_curr + nhãn Tiềm năng
 *   2. Truy vết bể vỡ theo Khâu (Bốc xếp / Chèn lót FTL / Hub / Lastmile)
 *   3. Ghi chú & Chỉ đạo Ops tuần — lưu localStorage
 */
import { useState, useMemo, useEffect, useCallback } from "react";

function getISOWeek(utcDate) {
  // utcDate phải được tạo bằng Date.UTC để tránh lệch múi giờ
  const d = new Date(utcDate.getTime());
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const KHAU_PALETTE = ["var(--amber)", "var(--red)", "var(--cyan)", "#3b82f6", "var(--green)", "#a855f7", "var(--text-muted)"];

const panelStyle = {
  background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", marginBottom: 16,
};
const h3Style = {
  fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5,
};

function newNote() {
  return { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, issue: "", detail: "", imageUrl: "", actionPlan: "" };
}

export default function WeeklyReviewBoard({ ordersByProjectAndWeek, ordersByMonth, damageCases = [] }) {
  // Lấy ngày VN qua ISO string để tránh double-shift (vnNow là UTC+7 nhưng getFullYear() lại dùng local TZ)
  const vnDateStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const [vy, vm, vd] = vnDateStr.split("-").map(Number);
  const weekNum = getISOWeek(new Date(Date.UTC(vy, vm - 1, vd)));
  const weekKey = `W${weekNum}_${vy}`;
  const LS_KEY = `ops_notes_${weekKey}`;

  // Lưu ý vận hành — mảng 4 cột
  const [notes, setNotes] = useState(() => {
    try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : [newNote()]; } catch { return [newNote()]; }
  });
  const [savedMsg, setSavedMsg] = useState(false);
  const [imgModal, setImgModal] = useState(null); // URL ảnh đang xem phóng to
  const [videoModal, setVideoModal] = useState(null); // URL video đang xem
  const [damagePicker, setDamagePicker] = useState(false); // hiện dropdown chọn ca bể vỡ

  // ESC đóng lightbox / video modal / picker
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") { setImgModal(null); setVideoModal(null); setDamagePicker(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Load từ API khi mount
  useEffect(() => {
    fetch(`/api/ops-notes?week=${weekKey}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.notes?.length) {
          setNotes(d.notes);
          try { localStorage.setItem(LS_KEY, JSON.stringify(d.notes)); } catch {}
        }
      })
      .catch(() => {});
  }, [weekKey, LS_KEY]);

  const updateNote = useCallback((id, field, value) => {
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, [field]: value } : n));
  }, []);

  const addNote = useCallback(() => setNotes((prev) => [...prev, newNote()]), []);

  const removeNote = useCallback((id) => {
    setNotes((prev) => prev.length > 1 ? prev.filter((n) => n.id !== id) : prev);
  }, []);

  const saveNotes = useCallback(async () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(notes)); } catch {}
    try {
      await fetch("/api/ops-notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: weekKey, notes }),
      });
    } catch {}
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  }, [notes, weekKey, LS_KEY]);

  // Detect video URL
  const isVideoUrl = (url) => url && /\.(mp4|mov|webm|avi|mkv)(\?.*)?$/i.test(url);

  // Auto-fill dòng đầu trống từ ca bể vỡ Rillnet
  const fillFromDamageCase = useCallback((c) => {
    const emptyIdx = notes.findIndex((n) => !n.issue && !n.detail);
    const detail = [
      c.order_code ? `Mã đơn: ${c.order_code}` : "",
      c.client_name ? `KH: ${c.client_name}` : "",
      c.suspected_leg ? `Khâu: ${c.suspected_leg}` : "",
      c.severity ? `Mức: ${c.severity}` : "",
      c.case_date ? `Ngày: ${c.case_date}` : "",
    ].filter(Boolean).join(" · ");
    const newRow = {
      ...(emptyIdx >= 0 ? notes[emptyIdx] : newNote()),
      issue: (c.damage_details || "Bể vỡ hàng hóa").slice(0, 80),
      detail,
    };
    if (emptyIdx >= 0) {
      setNotes((prev) => prev.map((n, i) => i === emptyIdx ? newRow : n));
    } else {
      setNotes((prev) => [...prev, newRow]);
    }
    setDamagePicker(false);
  }, [notes]);

  // ── Part 1: W_prev vs W_curr ─────────────────────────────────────────────
  const weeks = useMemo(
    () => Object.keys(ordersByMonth || {}).map(Number).sort((a, b) => a - b),
    [ordersByMonth],
  );
  const wCurr = weeks[weeks.length - 1];
  const wPrev = weeks[weeks.length - 2];

  const clients = useMemo(() => {
    return Object.entries(ordersByProjectAndWeek || {})
      .map(([name, byWeek]) => ({
        name,
        prev: byWeek[wPrev] || 0,
        curr: byWeek[wCurr] || 0,
        delta: (byWeek[wCurr] || 0) - (byWeek[wPrev] || 0),
      }))
      .filter((c) => c.prev > 0 || c.curr > 0)
      .sort((a, b) => b.curr - a.curr);
  }, [ordersByProjectAndWeek, wPrev, wCurr]);

  // "Tiềm năng" = tăng > 10 đơn và > 15% so tuần trước
  const tiemNangSet = useMemo(
    () => new Set(clients.filter(c => c.delta > 10 && c.prev > 0 && c.delta / c.prev > 0.15).map(c => c.name)),
    [clients],
  );
  const topGains = [...clients].sort((a, b) => b.delta - a.delta).filter(c => c.delta > 0).slice(0, 5);
  const topDrops = [...clients].sort((a, b) => a.delta - b.delta).filter(c => c.delta < 0).slice(0, 5);

  // ── Part 2: Bể vỡ theo Khâu — group trực tiếp từ damage_details thật ───
  const khauCounts = useMemo(() => {
    const map = {};
    for (const c of damageCases) {
      const key = (c.damage_details || "").trim() || "Chưa xác định";
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [damageCases]);
  const khauList = useMemo(
    () => Object.entries(khauCounts).sort((a, b) => b[1] - a[1]).map(([k]) => k),
    [khauCounts]
  );
  const totalCases = damageCases.length;

  if (!wCurr || !wPrev) {
    return (
      <div style={{ ...panelStyle, color: "var(--text-muted)", fontSize: 13 }}>
        Chưa đủ dữ liệu 2 tuần để so sánh sản lượng KH.
      </div>
    );
  }

  return (
    <div>
      {/* ── Part 1: Biến động sản lượng KH ─────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <span style={h3Style}>Biến động sản lượng KH</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Tuần {wPrev} → Tuần {wCurr}</span>
        </div>

        {(topGains.length > 0 || topDrops.length > 0) && (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14, padding: "10px 12px", background: "var(--bg-card, rgba(255,255,255,0.03))", borderRadius: 8, border: "1px solid var(--border)" }}>
            {topGains.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 700, marginBottom: 6 }}>📈 Top tăng (T{wPrev}→T{wCurr})</div>
                {topGains.map(c => (
                  <div key={c.name} style={{ fontSize: 12, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--green)", fontWeight: 700, minWidth: 30 }}>+{c.delta}</span>
                    <span style={{ color: "var(--text-primary)" }}>{c.name}</span>
                    {tiemNangSet.has(c.name) && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "rgba(16,185,129,0.15)", color: "var(--green)", border: "1px solid var(--green)", whiteSpace: "nowrap" }}>⭐ Tiềm năng</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {topDrops.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 700, marginBottom: 6 }}>📉 Top giảm (T{wPrev}→T{wCurr})</div>
                {topDrops.map(c => (
                  <div key={c.name} style={{ fontSize: 12, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--red)", fontWeight: 700, minWidth: 30 }}>{c.delta}</span>
                    <span style={{ color: "var(--text-primary)" }}>{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, fontSize: 11.5 }}>Khách hàng</th>
                <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 11.5 }}>Tuần {wPrev}</th>
                <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 11.5 }}>Tuần {wCurr}</th>
                <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 11.5 }}>Δ</th>
                <th style={{ padding: "7px 10px", fontWeight: 700, fontSize: 11.5 }}></th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => {
                const isUp = c.delta > 0;
                const isDown = c.delta < 0;
                return (
                  <tr key={c.name} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--text-secondary)" }}>{c.prev}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{c.curr}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: isUp ? "var(--green)" : isDown ? "var(--red)" : "var(--text-muted)" }}>
                      {c.delta > 0 ? `+${c.delta}` : c.delta || "—"}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {tiemNangSet.has(c.name) && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "rgba(16,185,129,0.15)", color: "var(--green)", border: "1px solid var(--green)", whiteSpace: "nowrap" }}>⭐ Tiềm năng</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {clients.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 13 }}>Chưa có dữ liệu sản lượng KH.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Part 2: Bể vỡ theo Khâu ─────────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <span style={h3Style}>Truy vết bể vỡ theo Khâu</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{totalCases} ca · kỳ đang lọc</span>
        </div>
        {totalCases === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Không có ca bể vỡ trong kỳ lọc.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {khauList.map((khau, i) => {
              const count = khauCounts[khau] || 0;
              const pct = Math.round((count / totalCases) * 100);
              const color = KHAU_PALETTE[i % KHAU_PALETTE.length];
              return (
                <div key={khau}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{khau}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{count} ca ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {totalCases > 0 && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-muted)" }}>
            Phân loại dựa trên trường <em>damage_details</em> / <em>suspected_leg</em>. Cập nhật thủ công nếu phân loại chưa chính xác.
          </div>
        )}
      </div>

      {/* ── Part 3: Lưu ý vận hành 4 cột ─────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <span style={h3Style}>LƯU Ý VẬN HÀNH — TUẦN W{weekNum}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", position: "relative" }}>
            {/* Nút nhập từ Ca Bể vỡ Rillnet */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setDamagePicker((v) => !v)} style={{
                padding: "5px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid var(--red)",
                color: "var(--red)", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                🔗 Nhập từ Ca Bể vỡ
              </button>
              {damagePicker && damageCases.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 200, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", minWidth: 320, maxHeight: 260, overflowY: "auto" }}>
                  <div style={{ padding: "6px 10px", fontSize: 10.5, color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Chọn ca bể vỡ để tự điền Vấn đề + Chi tiết</div>
                  {damageCases.slice(0, 50).map((c, i) => (
                    <button key={c.order_code || i} onClick={() => fillFromDamageCase(c)} style={{
                      display: "block", width: "100%", textAlign: "left", padding: "7px 10px",
                      background: "none", border: "none", borderBottom: "1px solid var(--border)",
                      cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "var(--text-primary)",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(var(--brand-rgb),0.08)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                      <span style={{ fontWeight: 600, color: "var(--red)" }}>{c.order_code || "—"}</span>
                      <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11 }}>{c.client_name}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{(c.damage_details || "").slice(0, 60)}</span>
                    </button>
                  ))}
                </div>
              )}
              {damagePicker && damageCases.length === 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 200, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "var(--text-muted)" }}>
                  Không có ca bể vỡ trong kỳ lọc.
                </div>
              )}
            </div>
            <button onClick={addNote} style={{
              padding: "5px 12px", background: "rgba(6,182,212,0.08)", border: "1px solid var(--cyan)",
              color: "var(--cyan)", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>
              ➕ Thêm lưu ý
            </button>
            <button onClick={saveNotes} style={{
              padding: "5px 14px", background: savedMsg ? "rgba(16,185,129,0.15)" : "rgba(6,182,212,0.12)",
              border: `1px solid ${savedMsg ? "var(--green)" : "var(--cyan)"}`,
              color: savedMsg ? "var(--green)" : "var(--cyan)",
              borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
            }}>
              {savedMsg ? "✓ Đã lưu" : `💾 Lưu danh sách W${weekNum}`}
            </button>
          </div>
        </div>

        {/* Modal xem ảnh phóng to */}
        {imgModal && (
          <div onClick={() => setImgModal(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)", zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          }}>
            <button onClick={() => setImgModal(null)} style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Đóng (ESC)</button>
            <img src={imgModal} alt="" style={{ maxWidth: "90vw", maxHeight: "88vh", borderRadius: 10, boxShadow: "0 12px 48px rgba(0,0,0,0.7)" }} onClick={(e) => e.stopPropagation()} />
          </div>
        )}
        {/* Modal xem video */}
        {videoModal && (
          <div onClick={() => setVideoModal(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)", zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>
            <button onClick={() => setVideoModal(null)} style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Đóng (ESC)</button>
            <video src={videoModal} controls autoPlay={false} style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 10, boxShadow: "0 12px 48px rgba(0,0,0,0.7)" }} onClick={(e) => e.stopPropagation()} />
          </div>
        )}

        {/* Bảng 4 cột */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--bg-panel)" }}>
                {["Vấn đề", "Chi tiết vấn đề", "Hình ảnh", "Action plan", ""].map((h, i) => (
                  <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", width: i === 0 ? 160 : i === 2 ? 120 : i === 4 ? 36 : "auto" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {notes.map((note, idx) => (
                <tr key={note.id} style={{ borderBottom: "1px solid var(--border)", background: idx % 2 === 0 ? "transparent" : "var(--bg-panel)" }}>
                  {/* Cột 1: Vấn đề */}
                  <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
                    <input
                      value={note.issue}
                      onChange={(e) => updateNote(note.id, "issue", e.target.value)}
                      placeholder="Tên vấn đề..."
                      style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 12.5, background: "var(--input-bg)", color: "var(--text-primary)" }}
                    />
                  </td>
                  {/* Cột 2: Chi tiết */}
                  <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
                    <textarea
                      value={note.detail}
                      onChange={(e) => updateNote(note.id, "detail", e.target.value)}
                      placeholder="Mô tả chi tiết, số liệu, kho liên quan..."
                      rows={3}
                      style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 12, resize: "vertical", background: "var(--input-bg)", color: "var(--text-primary)", lineHeight: 1.5 }}
                    />
                  </td>
                  {/* Cột 3: Hình ảnh / Video */}
                  <td style={{ padding: "8px 10px", verticalAlign: "top", minWidth: 90 }}>
                    {note.imageUrl ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {isVideoUrl(note.imageUrl) ? (
                          <button onClick={() => setVideoModal(note.imageUrl)} style={{
                            width: 60, height: 60, borderRadius: 6, border: "1px solid var(--border)",
                            background: "rgba(0,0,0,0.55)", cursor: "pointer", display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center", gap: 2, padding: 0,
                          }}>
                            <span style={{ fontSize: 18 }}>▶</span>
                            <span style={{ fontSize: 9, color: "#fff", fontWeight: 600 }}>Video</span>
                          </button>
                        ) : (
                          <img
                            src={note.imageUrl}
                            alt=""
                            loading="lazy"
                            onClick={() => setImgModal(note.imageUrl)}
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                            style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, cursor: "zoom-in", border: "1px solid var(--border)" }}
                          />
                        )}
                        <input
                          value={note.imageUrl}
                          onChange={(e) => updateNote(note.id, "imageUrl", e.target.value)}
                          placeholder="URL ảnh/video..."
                          style={{ width: "100%", boxSizing: "border-box", padding: "3px 6px", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 10.5, background: "var(--input-bg)", color: "var(--text-muted)" }}
                        />
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ width: 60, height: 60, border: "1.5px dashed var(--border)", borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, color: "var(--text-muted)", fontSize: 18, cursor: "default" }}>
                          📷
                          <span style={{ fontSize: 9.5, letterSpacing: 0 }}>Dán link</span>
                        </div>
                        <input
                          value={note.imageUrl}
                          onChange={(e) => updateNote(note.id, "imageUrl", e.target.value)}
                          placeholder="URL ảnh/video..."
                          style={{ width: "100%", boxSizing: "border-box", padding: "3px 6px", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 10.5, background: "var(--input-bg)", color: "var(--text-primary)" }}
                        />
                      </div>
                    )}
                  </td>
                  {/* Cột 4: Action plan */}
                  <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
                    <textarea
                      value={note.actionPlan}
                      onChange={(e) => updateNote(note.id, "actionPlan", e.target.value)}
                      placeholder="Phân công, deadline, người chịu trách nhiệm..."
                      rows={3}
                      style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 12, resize: "vertical", background: "var(--input-bg)", color: "var(--text-primary)", lineHeight: 1.5 }}
                    />
                  </td>
                  {/* Cột xóa */}
                  <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                    <button
                      onClick={() => removeNote(note.id)}
                      title="Xóa dòng"
                      disabled={notes.length === 1}
                      style={{ background: "none", border: "1px solid var(--border)", color: "var(--red)", cursor: notes.length > 1 ? "pointer" : "default", borderRadius: 5, padding: "4px 7px", fontSize: 13, opacity: notes.length === 1 ? 0.3 : 1 }}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
          Lưu vào Vercel Blob + trình duyệt này · Tuần W{weekNum} · {vy} · {notes.length} lưu ý
        </div>
      </div>
    </div>
  );
}
