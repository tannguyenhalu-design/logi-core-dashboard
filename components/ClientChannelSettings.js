/**
 * components/ClientChannelSettings.js — "Cài đặt kênh khách hàng" inside the
 * "Báo cáo công ty" tab (27/09). Manager edits, SD3 views. Each client: kênh
 * B2B LTL / B2C, own row in the Ontime table, own row in the Hàng hoàn table,
 * row order. Saving replaces the `ClientChannels` sheet tab; onSaved(version)
 * lets the tab reload the report with the new grouping at once. Locked
 * reports never change.
 */
import { useEffect, useMemo, useState } from "react";

const SRC = {
  saved: { label: "Đã lưu", color: "var(--green)" },
  default: { label: "Mặc định", color: "var(--text-muted)" },
  auto: { label: "Chưa cấu hình", color: "var(--amber)" },
};
const same = (a, b) => a.channel === b.channel && a.ownOntime === b.ownOntime && a.ownFd === b.ownFd && Number(a.order) === Number(b.order);

export default function ClientChannelSettings({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [orig, setOrig] = useState({});
  const [canEdit, setCanEdit] = useState(false);
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = (cv = "") => fetch(`/api/report/client-channels${cv ? `?cv=${encodeURIComponent(cv)}` : ""}`)
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) throw new Error(j.error || "Không tải được cài đặt kênh");
      setRows(j.rows.map((r) => ({ ...r })));
      setOrig(Object.fromEntries(j.rows.map((r) => [r.client, { ...r }])));
      setCanEdit(!!j.canEdit);
    })
    .catch((e) => setMsg(`⚠ ${e.message}`));
  useEffect(() => { if (open && !rows) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => (rows || []).filter((r) => !orig[r.client] || !same(r, orig[r.client])), [rows, orig]);
  const counts = useMemo(() => ({
    auto: (rows || []).filter((r) => r.source === "auto").length,
    mixed: (rows || []).filter((r) => r.mixed).length,
  }), [rows]);
  const shown = (rows || []).filter((r) => (!search || r.client.toLowerCase().includes(search.toLowerCase()))
    && (only === "all" || (only === "auto" && r.source === "auto") || (only === "mixed" && r.mixed) || (only === "own" && (r.ownOntime || r.ownFd))));

  const set = (client, patch) => { setRows((rs) => rs.map((r) => (r.client === client ? { ...r, ...patch } : r))); setMsg(null); };
  const save = async () => {
    if (!dirty.length) return;
    if (!confirm(`Lưu cài đặt kênh (${dirty.length} khách thay đổi)?\nSố mới nhất của báo cáo sẽ tính lại theo cài đặt mới. Các bản đã chốt giữ nguyên.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/report/client-channels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows.map((x) => ({ client: x.client, channel: x.channel, ownOntime: x.ownOntime, ownFd: x.ownFd, order: Number(x.order) || 999 })) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Không lưu được");
      setMsg(`✓ Đã lưu ${j.changed} thay đổi — báo cáo đã tính lại theo cài đặt mới.`);
      await load(j.version);
      onSaved && onSaved(j.version);
    } catch (e) {
      setMsg(`⚠ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const btn = { fontSize: 12.5, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 };
  const primary = { ...btn, background: "rgba(var(--brand-rgb),0.12)", border: "1px solid rgba(var(--brand-rgb),0.35)", color: "var(--cyan)" };
  const ghost = { ...btn, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" };
  const seg = (on) => ({ ...btn, fontWeight: 500, padding: "4px 10px", background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", border: "1px solid var(--border)", color: on ? "var(--cyan)" : "var(--text-muted)" });
  const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };

  return (
    <div className="glass" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>⚙ Cài đặt kênh khách hàng</div>
          <div style={small}>Khách nào thuộc B2B LTL / B2C, khách nào có dòng riêng trong bảng Ontime / Hàng hoàn. Khách không có dòng riêng cộng vào "Khác" của kênh đó.</div>
        </div>
        <button style={ghost} onClick={() => setOpen((v) => !v)}>{open ? "Thu gọn" : "Mở cài đặt"}{!open && counts.auto ? ` · ${counts.auto} chưa cấu hình` : ""}</button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {!rows ? <div style={small}>{msg || "Đang tải…"}</div> : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm khách…"
                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13, width: 190 }} />
                <button style={seg(only === "all")} onClick={() => setOnly("all")}>Tất cả ({rows.length})</button>
                <button style={seg(only === "own")} onClick={() => setOnly("own")}>Có dòng riêng</button>
                <button style={seg(only === "auto")} onClick={() => setOnly("auto")}>Chưa cấu hình ({counts.auto})</button>
                <button style={seg(only === "mixed")} onClick={() => setOnly("mixed")}>Cờ B2B/B2C lẫn lộn ({counts.mixed})</button>
              </div>
              {!canEdit && <div style={{ ...small, color: "var(--amber)", marginBottom: 8 }}>Bạn chỉ xem được — chỉ Manager sửa và lưu cài đặt kênh.</div>}
              <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                <table className="data-table" style={{ fontSize: 12.5 }}>
                  <thead><tr>
                    <th>Khách</th><th style={{ textAlign: "right" }}>Số đơn</th><th>Dữ liệu nguồn (is_B2C)</th>
                    <th>Kênh</th><th style={{ textAlign: "center" }}>Dòng riêng Ontime</th><th style={{ textAlign: "center" }}>Dòng riêng Hàng hoàn</th><th>Thứ tự</th><th>Nguồn cài đặt</th>
                  </tr></thead>
                  <tbody>
                    {shown.map((r) => {
                      const changed = !orig[r.client] || !same(r, orig[r.client]);
                      return (
                        <tr key={r.client} style={changed ? { background: "rgba(var(--brand-rgb),0.08)" } : undefined}>
                          <td style={{ fontWeight: 600 }}>{r.client === "DigiWorld" ? "Digiworld" : r.client}</td>
                          <td style={{ textAlign: "right" }}>{Number(r.orders || 0).toLocaleString("vi-VN")}</td>
                          <td>
                            {r.b2cShare == null ? "—" : `${Math.round(r.b2cShare * 100)}% đơn B2C`}
                            {r.mixed && <span style={{ color: "var(--amber)" }} title="Cùng 1 khách mà đơn có cờ is_B2C khác nhau"> ⚠ lẫn lộn</span>}
                            {r.suggested !== r.channel && <span style={{ color: "var(--text-muted)" }}> · gợi ý {r.suggested}</span>}
                          </td>
                          <td>
                            <select disabled={!canEdit} value={r.channel} onChange={(e) => set(r.client, { channel: e.target.value })}
                              style={{ padding: "3px 6px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "inherit" }}>
                              <option value="B2B">B2B LTL</option><option value="B2C">B2C</option>
                            </select>
                          </td>
                          <td style={{ textAlign: "center" }}><input type="checkbox" disabled={!canEdit} checked={r.ownOntime} onChange={(e) => set(r.client, { ownOntime: e.target.checked })} /></td>
                          <td style={{ textAlign: "center" }}><input type="checkbox" disabled={!canEdit} checked={r.ownFd} onChange={(e) => set(r.client, { ownFd: e.target.checked })} /></td>
                          <td><input type="number" min="1" disabled={!canEdit} value={r.order === 999 ? "" : r.order} placeholder="—"
                            onChange={(e) => set(r.client, { order: e.target.value === "" ? 999 : Number(e.target.value) })}
                            style={{ width: 56, padding: "3px 6px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "inherit" }} /></td>
                          <td style={{ color: SRC[r.source].color }}>{SRC[r.source].label}{r.source === "saved" && r.updatedBy ? <span style={{ color: "var(--text-muted)" }}> · {r.updatedBy}</span> : null}</td>
                        </tr>
                      );
                    })}
                    {!shown.length && <tr><td colSpan={8} style={{ color: "var(--text-muted)" }}>Không có khách khớp.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ ...small, marginTop: 8 }}>
                Thứ tự: số nhỏ đứng trước, trong cùng kênh. "Mặc định" = bố cục báo cáo gốc; "Chưa cấu hình" = khách mới, tạm theo đa số đơn trong dữ liệu (gợi ý). Lưu xong: số mới nhất tính lại ngay; bản đã chốt giữ nguyên (mục "Số đã đổi kể từ lúc chốt" sẽ liệt kê ô bị ảnh hưởng).
              </div>
              {canEdit && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button style={primary} disabled={busy || !dirty.length} onClick={save}>{busy ? "Đang lưu…" : `💾 Lưu cài đặt${dirty.length ? ` (${dirty.length} thay đổi)` : ""}`}</button>
                  <button style={ghost} disabled={busy || !dirty.length} onClick={() => { setRows(Object.values(orig).map((r) => ({ ...r }))); setMsg(null); }}>Bỏ thay đổi</button>
                </div>
              )}
              {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
