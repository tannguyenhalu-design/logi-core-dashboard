/**
 * components/ltl/damage/DamageAnalysis.js — phân tích đơn hư hỏng (Kế hoạch E ·
 * phiên 2, user duyệt 29/09), chỉ ca Điện máy:
 *  (1) Ca còn mở — mọi trạng thái Rillnet TRỪ "Đã chốt — không truy thu" và
 *      "Hoàn tất kết luận QLRR"; số ngày tồn, khâu đang giữ (CS / OM / KTC…);
 *  (2) Tuyến / khách còn tái phát — 2/3/4 tuần gần nhất so với trước đó;
 *  (3) Chặng nghi vấn theo từng tuyến.
 * (1)(2) không theo bộ lọc tháng/ngày (danh sách "hiện tại", như Đơn treo) nhưng
 * theo dự án / điểm lấy / vai trò; (3) theo kỳ đang lọc.
 * Data: body.damageAnalysis (lib/damage-money.js).
 */
import { useState } from "react";
import { fmt } from "../utils";

const vnd = (x) => `${Math.round(x || 0).toLocaleString("vi-VN")}đ`;
const shortWh = (s) => String(s || "").replace(/^Kho Giao Hàng Nặng - /, "").replace(/^Key Account Warehouse /, "KA WH ").replace(/^Kho B2B - /, "B2B ").trim();
const shortRoute = (r) => `${shortWh(r.kho_lay) || "?"} → ${shortWh(r.kho_giao) || "?"}`;
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

const th = { padding: "7px 9px", fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textAlign: "left", whiteSpace: "nowrap" };
const td = { padding: "7px 9px", fontSize: 12.5, whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
const num = { ...td, textAlign: "right" };
const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };
const seg = (on) => ({ fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border)", background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", color: on ? "var(--cyan)" : "var(--text-muted)", fontWeight: on ? 700 : 500 });
const STAGE_COLOR = { "Chưa tiếp nhận": "var(--red)", "Đang mở": "var(--amber)", CS: "var(--cyan)", "KTC / KCT": "var(--amber)", OM: "var(--blue, #60a5fa)", "Chờ duyệt": "var(--text-secondary)", Khác: "var(--text-muted)" };
const daysColor = (d) => (d == null ? "var(--text-muted)" : d > 30 ? "var(--red)" : d > 14 ? "var(--amber)" : "var(--text-primary)");

function Panel({ title, sub, children }) {
  return (
    <div className="chart-panel" style={{ width: "100%" }}>
      <div className="chart-panel-title" style={{ flexWrap: "wrap", gap: 8 }}>{title}{sub && <span style={{ ...small, fontWeight: 400 }}>{sub}</span>}</div>
      <div style={{ padding: "0 16px 16px" }}>{children}</div>
    </div>
  );
}

export function OpenCasesPanel({ open, onOpenCase }) {
  const [stage, setStage] = useState(null);
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const list = stage ? open.cases.filter((c) => c.stage === stage) : open.cases;
  const copy = () => { try { navigator.clipboard.writeText(list.map((c) => c.order_code).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } };
  return (
    <Panel title="📂 Ca còn mở" sub={`không theo bộ lọc tháng/ngày · ${fmt(open.total)}/${fmt(open.all)} ca Điện máy chưa xử lý xong`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 10 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
          <div style={small}>Còn mở</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(open.total)}</div>
          <div style={small}>mở lâu nhất từ {dmy(open.oldest)} · {fmt(open.over30)} ca &gt; 30 ngày</div>
        </div>
        {open.byStage.map((s) => {
          const on = stage === s.stage;
          return (
            <button key={s.stage} onClick={() => setStage(on ? null : s.stage)} style={{
              textAlign: "left", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${on ? STAGE_COLOR[s.stage] : "var(--border)"}`, borderLeft: `4px solid ${STAGE_COLOR[s.stage] || "var(--border)"}`,
              background: on ? "rgba(var(--brand-rgb),0.08)" : "var(--bg-panel)", color: "var(--text-primary)",
            }}>
              <div style={small}>Đang ở khâu {s.stage}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: STAGE_COLOR[s.stage] }}>{fmt(s.count)}</div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <span style={small}>{stage ? `Lọc khâu ${stage}: ` : ""}{fmt(list.length)} ca · bấm 1 dòng để mở chi tiết ca · tiền đền đã có {vnd(open.money.amount)} ({fmt(open.money.withAmount)}/{fmt(open.money.compensated)} ca đã chốt có số tiền)</span>
        <button style={{ ...seg(false), marginLeft: "auto" }} onClick={copy}>{copied ? "✓ Đã copy" : `📋 Copy ${fmt(list.length)} mã đơn`}</button>
        {stage && <button style={seg(false)} onClick={() => setStage(null)}>Bỏ lọc ✕</button>}
      </div>
      <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 980 }}>
          <thead><tr>
            <th style={th}>Mã đơn</th><th style={th}>Khách</th><th style={th}>Kho lấy → kho giao</th>
            <th style={th}>Ngày ca</th><th style={{ ...th, textAlign: "right" }}>Tồn</th><th style={th}>Khâu</th><th style={th}>Trạng thái Rillnet</th>
            <th style={{ ...th, textAlign: "right" }}>Tiền đền</th>
          </tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.order_code + c.case_date} onClick={() => onOpenCase?.(c)} style={{ cursor: onOpenCase ? "pointer" : "default" }}>
                <td style={{ ...td, fontFamily: "monospace", fontWeight: 700, color: "var(--cyan)" }}>{c.order_code}</td>
                <td style={td}>{c.client_name}</td>
                <td style={{ ...td, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }} title={`${c.kho_lay} → ${c.kho_giao}`}>{shortRoute(c)}</td>
                <td style={td}>{dm(c.case_iso)}</td>
                <td style={{ ...num, fontWeight: 700, color: daysColor(c.days) }}>{c.days == null ? "—" : `${fmt(c.days)} ngày`}</td>
                <td style={{ ...td, color: STAGE_COLOR[c.stage], fontWeight: 600 }}>{c.stage}</td>
                <td style={{ ...td, whiteSpace: "normal", minWidth: 200, color: "var(--text-secondary)" }}>{c.rillnet_status || "—"}</td>
                <td style={{ ...num, color: c.comp_amount ? "var(--amber)" : "var(--text-muted)" }}>{c.comp_amount ? vnd(c.comp_amount) : c.compensated ? "đã chốt, chưa có số" : "—"}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>Không có ca còn mở.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ ...small, marginTop: 6 }}>
        Còn mở = mọi trạng thái Rillnet trừ "Đã chốt — không truy thu" và "Hoàn tất kết luận QLRR". Tồn = hôm nay − ngày ghi nhận ca. Khâu suy từ chữ trạng thái: {open.byStatus.map((s) => `${s.status} (${s.count}) → ${s.stage}`).join(" · ")}.
      </div>
    </Panel>
  );
}

const STATUS_CHIP = {
  recurring: { t: "🔁 Còn tái phát", c: "var(--red)" },
  new: { t: "🆕 Mới phát sinh", c: "var(--amber)" },
  stopped: { t: "✓ Đã ngưng", c: "var(--green)" },
};

export function RecurrencePanel({ recurrence }) {
  const [weeks, setWeeks] = useState(2);
  const [kind, setKind] = useState("routes");
  const [showAll, setShowAll] = useState(false);
  if (!recurrence) return null;
  const R = recurrence[weeks] || recurrence[2];
  const g = R[kind];
  const list = showAll ? g.active : g.active.slice(0, 12);
  return (
    <Panel title="🔁 Tuyến / khách còn tái phát" sub="không theo bộ lọc tháng/ngày · theo ngày ghi nhận ca">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        {[2, 3, 4].map((n) => <button key={n} style={seg(weeks === n)} onClick={() => setWeeks(n)}>{n} tuần gần nhất</button>)}
        <span style={{ width: 8 }} />
        <button style={seg(kind === "routes")} onClick={() => setKind("routes")}>Theo tuyến</button>
        <button style={seg(kind === "clients")} onClick={() => setKind("clients")}>Theo khách</button>
      </div>
      <div style={{ fontSize: 12.5, marginBottom: 8 }}>
        {dm(R.from)}–{dm(R.to)}: <b>{fmt(R.recentCases)} ca</b> · <b style={{ color: "var(--red)" }}>{fmt(g.recurringCount)}</b> {kind === "routes" ? "tuyến" : "khách"} còn tái phát (đã có ca từ {dm(R.beforeFrom)}–{dm(R.beforeTo)} và vẫn phát sinh) · {fmt(g.activeCount - g.recurringCount)} mới phát sinh.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 760 }}>
          <thead><tr>
            <th style={th}>{kind === "routes" ? "Tuyến (kho lấy → kho giao)" : "Khách"}</th>
            <th style={{ ...th, textAlign: "right" }}>{weeks} tuần gần nhất</th>
            <th style={{ ...th, textAlign: "right" }}>Trước đó</th>
            <th style={{ ...th, textAlign: "right" }} title="Ca / tuần: gần đây vs trước đó">Ca / tuần</th>
            <th style={th}>Ca gần nhất</th><th style={th}>Đánh dấu</th><th style={th}>Mã đơn gần đây</th>
          </tr></thead>
          <tbody>
            {list.map((x) => {
              const up = x.recentPerWeek > x.beforePerWeek;
              return (
                <tr key={x.name}>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: "normal", minWidth: 180, maxWidth: 320 }} title={x.name}>{kind === "routes" ? shortRoute(x) : x.name}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{fmt(x.recent)}</td>
                  <td style={num}>{fmt(x.before)}</td>
                  <td style={{ ...num, color: x.status === "recurring" ? (up ? "var(--red)" : "var(--text-secondary)") : "var(--text-muted)" }}>{x.recentPerWeek.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} vs {x.beforePerWeek.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}{x.status === "recurring" && up ? " ▲" : ""}</td>
                  <td style={td}>{dm(x.last)}</td>
                  <td style={{ ...td, color: STATUS_CHIP[x.status].c, fontWeight: 700 }}>{STATUS_CHIP[x.status].t}</td>
                  <td style={{ ...td, whiteSpace: "normal", minWidth: 160, fontFamily: "monospace", fontSize: 11.5, color: "var(--text-secondary)" }}>{x.codes.slice(0, 4).join(", ")}{x.codes.length > 4 ? ` +${x.codes.length - 4}` : ""}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>Không có ca nào trong {weeks} tuần gần nhất.</td></tr>}
          </tbody>
        </table>
      </div>
      {g.active.length > 12 && <button style={{ ...seg(false), marginTop: 6 }} onClick={() => setShowAll((v) => !v)}>{showAll ? "Thu gọn" : `Xem tất cả ${g.active.length}`}</button>}
      {g.stopped.length > 0 && (
        <div style={{ ...small, marginTop: 8 }}>
          <b style={{ color: "var(--green)" }}>✓ Đã ngưng</b> (≥ 2 ca trước đó, 0 ca trong {weeks} tuần): {g.stopped.map((x) => `${kind === "routes" ? shortRoute(x) : x.name} (${x.before})`).join(" · ")}
        </div>
      )}
      <div style={{ ...small, marginTop: 6 }}>Gần đây = {weeks} tuần tính tới hôm nay; trước đó = từ 01/07 tới trước khoảng đó (~{fmt(R.beforeWeeks, 1)} tuần). Ca / tuần để so 2 khoảng khác độ dài. Ca 1–2 tuần gần nhất có thể còn được ghi nhận thêm.</div>
    </Panel>
  );
}

export function LegRoutesPanel({ legs }) {
  const [showAll, setShowAll] = useState(false);
  if (!legs || !legs.total) return null;
  const cols = legs.legs.map((l) => l.leg);
  const list = showAll ? legs.routes : legs.routes.slice(0, 12);
  return (
    <Panel title="🧭 Chặng nghi vấn theo tuyến" sub={`kỳ đang lọc · ${fmt(legs.total)} ca · ${fmt(legs.routeCount)} tuyến`}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {legs.legs.map((l) => (
          <span key={l.leg} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 12, border: "1px solid var(--border)" }}>
            {l.leg}: <b>{fmt(l.count)}</b> ca ({pct(l.share)})
          </span>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 260 + cols.length * 120 }}>
          <thead><tr>
            <th style={th}>Tuyến (kho lấy → kho giao)</th><th style={{ ...th, textAlign: "right" }}>Ca</th>
            {cols.map((c) => <th key={c} style={{ ...th, textAlign: "right", whiteSpace: "normal", minWidth: 100 }}>{c}</th>)}
            <th style={th}>Chặng chính</th>
          </tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.name}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: "normal", minWidth: 180, maxWidth: 320 }} title={r.name}>{shortRoute(r)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmt(r.cases)}</td>
              {cols.map((c) => {
                const n = r.legs[c] || 0;
                return <td key={c} style={{ ...num, color: n ? "var(--text-primary)" : "var(--text-muted)", background: n ? `rgba(244,63,94,${0.05 + 0.3 * (n / r.cases)})` : "transparent" }}>{n || "—"}</td>;
              })}
              <td style={{ ...td, whiteSpace: "normal", minWidth: 160 }}>{r.topLeg} <span style={small}>({pct(r.topShare)})</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {legs.routes.length > 12 && <button style={{ ...seg(false), marginTop: 6 }} onClick={() => setShowAll((v) => !v)}>{showAll ? "Thu gọn" : `Xem ${legs.routes.length} tuyến nhiều ca nhất`}</button>}
      <div style={{ ...small, marginTop: 6 }}>Chặng nghi vấn = trường "chặng" của Rillnet cho từng ca (chưa có nguyên nhân chi tiết như đóng gói / bốc xếp). Tuyến = kho lấy → kho giao của đơn.</div>
    </Panel>
  );
}
