/**
 * components/TabSystemHealth.js — Manager-only: "Trạng thái hệ thống".
 * Backed by /api/system-health (scraper heartbeat + data freshness).
 * Purpose: never again let a data source go silently stale for weeks
 * (SYSTEM_SPEC incident #19) — every red card says exactly what to do.
 */
import { useState, useEffect, useCallback } from "react";

const NOVNC_URL = "https://sd3-cloud-scraper-production.up.railway.app/vnc_auto.html";

const LEVELS = {
  red:     { label: "Cần xử lý",   color: "var(--red)",   bg: "var(--red-glow)" },
  yellow:  { label: "Cảnh báo",    color: "var(--amber)", bg: "var(--amber-glow)" },
  green:   { label: "Ổn định",     color: "var(--green)", bg: "var(--green-glow)" },
  paused:  { label: "Tạm dừng",    color: "var(--text-muted)", bg: "rgba(100,116,139,0.15)" },
  unknown: { label: "Chưa có dữ liệu", color: "var(--text-muted)", bg: "rgba(100,116,139,0.15)" },
};

const STEP_LABELS = { raw_ontime: "LTL", rillnet: "Rillnet", kpi: "KPI" };
const STATUS_ICON = { ok: "✓", session_expired: "🔒", error: "✕", not_run: "–" };

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

function fmtAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

const btnStyle = {
  background: "rgba(var(--brand-rgb),0.1)", border: "1px solid rgba(var(--brand-rgb),0.2)",
  color: "var(--cyan)", fontWeight: 600, borderRadius: 6, cursor: "pointer",
};

const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("vi-VN"));
const fmtDate = (s) => (s ? s.split("-").reverse().join("/") : "—");
const fmtBytes = (b) => (b == null ? "—" : b > 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${Math.round(b / 1e3)} KB`);

function Badge({ level }) {
  const l = LEVELS[level] || LEVELS.unknown;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: l.bg, color: l.color, whiteSpace: "nowrap" }}>
      {l.label}
    </span>
  );
}

function Fact({ label, value, hint }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "5px 0", borderBottom: "1px dashed var(--border)" }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)", textAlign: "right" }}>
        {value}
        {hint && <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 12 }}>{hint}</span>}
      </span>
    </div>
  );
}

// What the manager should do, per source + level. Kept here (not in the API)
// because it's presentation: links and button wording.
function ActionHint({ source, onResync, resyncing }) {
  if (source.level === "green" || source.level === "paused") return null;
  const box = (children) => (
    <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: 13, lineHeight: 1.5, background: "rgba(var(--brand-rgb),0.08)", border: "1px solid rgba(var(--brand-rgb),0.25)", color: "var(--text-secondary)" }}>
      <b style={{ color: "var(--cyan)" }}>Cách xử lý: </b>{children}
    </div>
  );
  if (source.key === "snapshot") {
    return box(<>
      Bấm để dựng lại snapshot từ Google Sheet ngay (15–30 giây).{" "}
      <button onClick={onResync} disabled={resyncing} style={{ ...btnStyle, marginLeft: 6, padding: "4px 10px", fontSize: 12 }}>
        {resyncing ? "Đang đồng bộ…" : "🔄 Đồng bộ ngay"}
      </button>
    </>);
  }
  if (source.key === "scraper") {
    return box(<>Vào Railway (project <code>sd3-cloud-scraper</code>) kiểm tra container còn chạy không; xem log <code>/data/scraper_log.txt</code>. Nếu container dừng thì Redeploy.</>);
  }
  if (source.key === "scope") {
    return source.level === "yellow"
      ? box(<>Bấm "Là Điện máy" nếu khách thuộc ngành Điện máy (đơn của khách vào mọi số Điện máy), hoặc "Ngoài Điện máy" để không hỏi lại. Số liệu tự dựng lại sau mỗi lần bấm.</>)
      : null;
  }
  if (source.key === "raw_ontime" && source.level === "yellow") {
    return box(<>Scraper vẫn chạy tốt nhưng sheet nguồn GHN không có dòng mới. Hỏi người quản lý sheet raw_ontime xem họ có đang cập nhật không.</>);
  }
  if (source.level === "red" && /noVNC|Phiên/.test(source.reason)) {
    return box(<>
      Mở <a href={NOVNC_URL} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>noVNC của scraper</a> (mật khẩu = biến <code>VNC_PASSWORD</code> trên Railway),
      tự đăng nhập lại {source.key === "rillnet" ? "Rillnet bằng GHN SSO" : "Google / GHN"} trong cửa sổ Chrome. Lần chạy kế tiếp (08:50 · 12:50 · 17:50) sẽ tự lấy lại dữ liệu.
      Hướng dẫn chi tiết: SYSTEM_SPEC.md mục 16.2.
    </>);
  }
  return box(<>Xem log <code>/data/scraper_log.txt</code> trên Railway để biết lỗi cụ thể{source.detail ? <> — <i>{source.detail}</i></> : null}.</>);
}

// Incident #37: clients with real LTL volume that nothing classifies yet. One
// click decides; the choice is saved and the snapshot rebuilt right after.
function ScopeFix({ clients, onDecide }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  if (!clients.length) return null;
  const decide = async (client, industry) => {
    setBusy(client); setErr(null);
    try {
      const res = await fetch("/api/client-industry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client, industry }) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lưu không được");
      await onDecide();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const small = { ...btnStyle, padding: "4px 10px", fontSize: 12 };
  return (
    <div style={{ marginTop: 8 }}>
      {clients.map((c) => (
        <div key={c.client} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px dashed var(--border)", fontSize: 13, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px", minWidth: 0 }}>
            <b style={{ color: "var(--text-primary)" }}>{c.client}</b>
            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{fmtNum(c.orders)} đơn LTL / 14 ngày · lấy gần nhất {fmtDate(c.lastPickup)} · nhãn nguồn {c.label}</div>
          </div>
          <button disabled={busy === c.client} onClick={() => decide(c.client, "DM")} style={small}>Là Điện máy</button>
          <button disabled={busy === c.client} onClick={() => decide(c.client, "OTHER")} style={{ ...small, color: "var(--text-muted)", background: "transparent", border: "1px solid var(--border)" }}>Ngoài Điện máy</button>
        </div>
      ))}
      {busy && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Đang lưu và dựng lại số liệu (~20 giây)…</div>}
      {err && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function SourceFacts({ s, onDecide }) {
  const f = s.facts || {};
  switch (s.key) {
    case "scraper":
      return <>
        <Fact label="Báo cáo gần nhất" value={fmtTime(f.lastReportAt)} hint={fmtAgo(f.lastReportAt)} />
        <Fact label="Lịch chạy" value={f.schedule} />
      </>;
    case "raw_ontime":
      return <>
        <Fact label="Đồng bộ thành công gần nhất" value={fmtTime(f.lastSyncedAt)} hint={fmtAgo(f.lastSyncedAt)} />
        <Fact label="Số dòng raw_ontime" value={fmtNum(f.totalRows)} />
        <Fact label="Số đơn LTL Điện Máy (từ 07/2026)" value={fmtNum(f.ltlRows)} />
        <Fact label="Ngày lấy hàng mới nhất" value={fmtDate(f.newestPickupDate)} />
        {f.failingSince && <Fact label="Lỗi liên tục từ" value={fmtTime(f.failingSince)} hint={fmtAgo(f.failingSince)} />}
      </>;
    case "rillnet":
      return <>
        <Fact label="Đồng bộ thành công gần nhất" value={fmtTime(f.lastSyncedAt)} hint={fmtAgo(f.lastSyncedAt)} />
        <Fact label="Tổng số ca bể vỡ" value={fmtNum(f.totalCases)} />
        <Fact label="Ngày ca mới nhất" value={fmtDate(f.newestCaseDate)} />
        {f.failingSince && <Fact label="Hết phiên / lỗi từ" value={fmtTime(f.failingSince)} hint={fmtAgo(f.failingSince)} />}
      </>;
    case "scope":
      return <ScopeFix clients={f.unclassified || []} onDecide={onDecide} />;
    case "kpi":
      return <Fact label="Đồng bộ thành công gần nhất" value={fmtTime(f.lastSyncedAt)} />;
    case "snapshot":
      return <>
        <Fact label="Thời điểm dựng" value={fmtTime(f.builtAt)} hint={fmtAgo(f.builtAt)} />
        <Fact label="Dung lượng (gzip)" value={fmtBytes(f.sizeBytes)} />
        <Fact label="Số đơn LTL trong snapshot" value={fmtNum(f.ltlRows)} />
      </>;
    default:
      return null;
  }
}

export default function TabSystemHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resyncing, setResyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/system-health?t=${Date.now()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi tải trạng thái");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resync = async () => {
    setResyncing(true);
    try {
      await fetch(`/api/data?force=true&t=${Date.now()}`);
      await load();
    } finally {
      setResyncing(false);
    }
  };

  const overall = data ? LEVELS[data.overall] || LEVELS.unknown : null;

  return (
    <div className="fade-in" style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        {data && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: overall.bg, color: overall.color, fontWeight: 600, fontSize: 14 }}>
            {data.alertCount > 0 ? `⚠ ${data.alertCount} nguồn cần chú ý` : "✓ Tất cả nguồn dữ liệu đang ổn định"}
          </div>
        )}
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {data ? `Kiểm tra lúc ${fmtTime(data.checkedAt)}` : ""}
        </span>
        <button onClick={load} disabled={loading} style={{ ...btnStyle, marginLeft: "auto", padding: "6px 12px", fontSize: 13 }}>
          {loading ? "Đang kiểm tra…" : "↻ Kiểm tra lại"}
        </button>
      </div>

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: "var(--red-glow)", color: "var(--red)", marginBottom: 16 }}>{error}</div>
      )}

      {!data && loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 190, borderRadius: 12 }} />)}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {data.sources.map((s) => (
              <div key={s.key} className="kpi-card" style={{ padding: 16, borderLeft: `3px solid ${(LEVELS[s.level] || LEVELS.unknown).color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>{s.name}</div>
                  <Badge level={s.level} />
                </div>
                <div style={{ fontSize: 13, color: (LEVELS[s.level] || LEVELS.unknown).color, marginBottom: 10 }}>{s.reason}</div>
                <SourceFacts s={s} onDecide={resync} />
                <ActionHint source={s} onResync={resync} resyncing={resyncing} />
              </div>
            ))}
          </div>

          {data.dataHealth && (
            <div className="kpi-card" style={{ padding: 16, marginTop: 16, borderLeft: `3px solid ${(LEVELS[data.dataHealth.level] || LEVELS.unknown).color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>Chất lượng dữ liệu LTL</div>
                <Badge level={data.dataHealth.level} />
              </div>
              <div style={{ fontSize: 13, color: (LEVELS[data.dataHealth.level] || LEVELS.unknown).color, marginBottom: 12 }}>
                {data.dataHealth.reason}
              </div>
              {(() => {
                const f = data.dataHealth.facts || {};
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0 24px" }}>
                    <Fact label="Tổng số đơn" value={fmtNum(f.totalRows)} />
                    {f.errorCells > 0 && <Fact label="Ô lỗi công thức" value={<span style={{ color: "var(--amber)" }}>{fmtNum(f.errorCells)}</span>} />}
                    {f.duplicateOrderCodes > 0 && <Fact label="Mã đơn trùng" value={<span style={{ color: "var(--amber)" }}>{fmtNum(f.duplicateOrderCodes)}</span>} />}
                    {f.emptyOrderCode > 0 && <Fact label="Thiếu mã đơn" value={<span style={{ color: "var(--amber)" }}>{fmtNum(f.emptyOrderCode)}</span>} />}
                    {f.emptyProject > 0 && <Fact label="Thiếu tên dự án" value={<span style={{ color: "var(--amber)" }}>{fmtNum(f.emptyProject)}</span>} />}
                    {f.nullPickupTimes > 0 && <Fact label="Thiếu ngày lấy hàng" value={<span style={{ color: "var(--amber)" }}>{fmtNum(f.nullPickupTimes)}</span>} />}
                    <Fact label="Đơn thiếu kho lấy" value={fmtNum(f.emptyKhoLay)} />
                    <Fact label="Đơn thiếu kho giao" value={fmtNum(f.emptyKhoGiao)} />
                    {f.zeroWeight > 0 && <Fact label="Trọng lượng = 0" value={fmtNum(f.zeroWeight)} hint="(có thể hợp lệ)" />}
                    {f.malformedDamageRecent > 0 && <Fact label="Ca hư hỏng định dạng sai (7d)" value={<span style={{ color: "var(--amber)" }}>{fmtNum(f.malformedDamageRecent)}</span>} />}
                  </div>
                );
              })()}
            </div>
          )}

          {data.history?.length > 0 && (
            <div className="kpi-card" style={{ padding: 16, marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: "var(--text-primary)" }}>Các lần chạy scraper gần nhất</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>Thời điểm</th>
                      {Object.values(STEP_LABELS).map((l) => <th key={l} style={{ padding: "6px 8px" }}>{l}</th>)}
                      <th style={{ padding: "6px 8px" }}>Dòng nguồn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((h) => (
                      <tr key={h.at} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmtTime(h.at)}</td>
                        {Object.keys(STEP_LABELS).map((k) => {
                          const st = h.steps.find((x) => x.name === k);
                          const color = !st ? "var(--text-muted)" : st.status === "ok" ? "var(--green)" : st.status === "not_run" ? "var(--text-muted)" : "var(--red)";
                          return (
                            <td key={k} style={{ padding: "6px 8px", color }} title={st?.status}>
                              {st ? `${STATUS_ICON[st.status] || "?"} ${st.status === "ok" && st.count != null ? fmtNum(st.count) : st.status === "session_expired" ? "hết phiên" : st.status === "error" ? "lỗi" : ""}` : "—"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "6px 8px" }}>{fmtNum(h.steps.find((x) => x.name === "raw_ontime")?.sourceRows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
