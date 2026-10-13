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
import { useState, useEffect } from "react";
import { fmt } from "../utils";

const vnd = (x) => `${Math.round(x || 0).toLocaleString("vi-VN")}đ`;
const shortWh = (s) => String(s || "")
  .replace(/^Kho Giao Hàng Nặng - /, "")
  .replace(/^Key Account Warehouse /, "KA WH ")
  .replace(/^Kho B2B - /, "B2B ")
  .trim()
  .replace(/^KA WH Ho Chi Minh$/i, "KA-HCM")
  .replace(/^KA WH H[aà] N[oộ]i?$/i, "KA-HN")
  .replace(/^KA WH [ĐD][aà] N[aẵ]ng?$/i, "KA-ĐN");
const shortRoute = (r) => `${shortWh(r.kho_lay) || "?"} → ${shortWh(r.kho_giao) || "?"}`;
const STATUS_SHORT = [
  [/đã chốt truy thu.*đợi cs.*đền bù/i,   "CS: chờ đền bù"],
  [/đã chốt tt.*chờ om chia/i,             "OM: chờ chia"],
  [/chờ ktc.*giải trình/i,                 "KTC: giải trình"],
  [/đã chốt.*không truy thu/i,             "Chốt — k.truy thu"],
  [/hoàn tất kết luận/i,                   "Hoàn tất QLRR"],
  [/chưa tiếp nhận/i,                      "Chưa TN"],
  [/đang xác minh/i,                       "Xác minh lỗi"],
];
const shortStatus = (s) => {
  if (!s) return "—";
  for (const [re, label] of STATUS_SHORT) if (re.test(s)) return label;
  return s.length > 22 ? s.slice(0, 20) + "…" : s;
};
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
  const [stage, setStage] = useState("CS");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false); // Thu gọn mặc định
  if (!open) return null;
  const list = stage ? open.cases.filter((c) => c.stage === stage) : open.cases;
  const over30Cases = open.cases.filter((c) => c.days != null && c.days > 30);
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
            <button key={s.stage} onClick={() => { setStage(on ? null : s.stage); if (!expanded) setExpanded(true); }} style={{
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

      {/* Accordion toggle */}
      <button onClick={() => setExpanded((v) => !v)} style={{
        width: "100%", padding: "7px 12px", marginBottom: expanded ? 8 : 0,
        background: expanded ? "rgba(6,182,212,0.06)" : "rgba(239,68,68,0.06)",
        border: `1px solid ${expanded ? "var(--cyan)" : "var(--red)"}`,
        borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
        color: expanded ? "var(--cyan)" : "var(--red)", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
      }}>
        {expanded ? "🔺 Thu gọn danh sách ca" : `🔻 Hiển thị ${fmt(open.over30)} ca tồn đọng trên 30 ngày (${fmt(open.total)} ca tổng)`}
      </button>

      {expanded && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <span style={small}>{stage ? `Lọc khâu ${stage}: ` : ""}{fmt(list.length)} ca · bấm 1 dòng để mở chi tiết ca · tiền đền đã có {vnd(open.money.amount)} ({fmt(open.money.withAmount)}/{fmt(open.money.compensated)} ca đã chốt có số tiền)</span>
            <button style={{ ...seg(false), marginLeft: "auto" }} onClick={copy}>{copied ? "✓ Đã copy" : `📋 Copy ${fmt(list.length)} mã đơn`}</button>
            {stage && <button style={seg(false)} onClick={() => setStage(null)}>Bỏ lọc ✕</button>}
          </div>
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table className="data-table" style={{ fontSize: 12, minWidth: 820 }}>
              <thead><tr>
                <th style={th}>Đơn / Khách</th><th style={th}>Tuyến</th>
                <th style={th}>Ngày ca</th><th style={{ ...th, textAlign: "right" }}>Tồn</th><th style={th}>Khâu</th><th style={th}>Trạng thái</th>
                <th style={{ ...th, textAlign: "right" }}>Tiền đền</th>
              </tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.order_code + c.case_date} onClick={() => onOpenCase?.(c)} style={{ cursor: onOpenCase ? "pointer" : "default" }}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--cyan)" }}>{c.order_code}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{c.client_name}</div>
                    </td>
                    <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${c.kho_lay} → ${c.kho_giao}`}>{shortRoute(c)}</td>
                    <td style={td}>{dm(c.case_iso)}</td>
                    <td style={{ ...num, fontWeight: 700, color: daysColor(c.days) }}>{c.days == null ? "—" : `${fmt(c.days)}n`}</td>
                    <td style={{ ...td, color: STAGE_COLOR[c.stage], fontWeight: 600 }}>{c.stage}</td>
                    <td style={{ ...td, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={c.rillnet_status || ""}>{shortStatus(c.rillnet_status)}</td>
                    <td style={{ ...num, color: c.comp_amount ? "var(--amber)" : "var(--text-muted)" }}>{c.comp_amount ? vnd(c.comp_amount) : c.compensated ? "đã chốt" : "—"}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>Không có ca còn mở.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ ...small, marginTop: 6 }}>
            Còn mở = mọi trạng thái Rillnet trừ "Đã chốt — không truy thu" và "Hoàn tất kết luận QLRR". Tồn = hôm nay − ngày ghi nhận ca. Khâu suy từ chữ trạng thái: {open.byStatus.map((s) => `${s.status} (${s.count}) → ${s.stage}`).join(" · ")}.
          </div>
        </>
      )}
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

// â”€â”€ P2A + P2B: PhÃ¢n tÃ­ch nhÃ³m máº·t hÃ ng & % khÃ¢u â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PRODUCT_GROUPS = [
  { id: "tivi",       label: "Tivi / TV",        re: /tivi|tv\b|television|mÃ n hÃ¬nh/i,                      color: "var(--cyan)" },
  { id: "tulanh",     label: "Tá»§ láº¡nh",          re: /tá»§ láº¡nh|tu lanh|\btl\b|refriger|tá»§ Ä‘Ã´ng|freezer/i,    color: "#60a5fa" },
  { id: "mayGiat",    label: "MÃ¡y giáº·t / Sáº¥y",   re: /mÃ¡y giáº·t|may giat|\bmg\b|mÃ¡y sáº¥y|washer|dryer|sáº¥y/i, color: "var(--brand)" },
  { id: "giaDung",    label: "Gia dá»¥ng",         re: /gia dá»¥ng|gia dung|báº¿p|lÃ² vi sÃ³ng|mÃ¡y lá»c|mÃ¡y xay|Ä‘iá»u hÃ²a|\bac\b|blender/i, color: "var(--amber)" },
];
const RESP_LEGS = [
  { id: "kho_nguon",    label: "Kho Nguá»“n (CS / Pickup)", re: /\bcs\b|kho nguá»“n|pickup/i,                            color: "var(--cyan)" },
  { id: "trung_chuyen", label: "Trung Chuyá»ƒn / FTL-LTL",  re: /ktc|kct|trung chuy[eÃª]n|\btc\b|ftl|truck/i,           color: "var(--amber)" },
  { id: "kho_dich",     label: "Kho ÄÃ­ch / Lastmile",     re: /\bom\b|gxt|\blm\b|lastmile|giao h[Ã a]|kho Ä‘[Ã­i]ch/i, color: "var(--brand)" },
];
const CLAIM_STATUS_COLOR_P2 = {
  "Má»›i phÃ¡t sinh": "var(--red)",
  "Äang xÃ¡c minh lá»—i": "var(--amber)",
  "ÄÃ£ chá»‘t Ä‘á»n bÃ¹": "var(--cyan)",
  "ÄÃ£ Ä‘Ã³ng": "var(--green)",
};
const DEFAULT_CLAIM_P2 = { status: "Má»›i phÃ¡t sinh", assignee: "", notes: "" };

function productGroupOf(c) {
  const hay = `${c.damage_type || ""} ${c.damage_details || ""} ${c.source || ""} ${c.client_name || ""}`;
  for (const g of PRODUCT_GROUPS) if (g.re.test(hay)) return g.id;
  return "khac";
}
function responsibleLegOf(c) {
  const hay = `${c.damage_details || ""} ${c.offence_place || ""}`;
  for (const l of RESP_LEGS) if (l.re.test(hay)) return l.id;
  return "chua_xd";
}
function mediaOfCase(c) {
  const raw = c.image_urls || c.evidence_links || c.links || c.hinh_anh || "";
  const urls = Array.isArray(raw)
    ? raw.filter(Boolean)
    : String(raw).split(/[\n,]+/).map((u) => u.trim()).filter((u) => u.startsWith("http"));
  if (urls.length) return { type: "urls", count: urls.length };
  if (Number(c.photo_count) > 0) return { type: "count", count: Number(c.photo_count) };
  return { type: "none" };
}
const dmOf = (s) => {
  if (!s) return "â€”";
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return `${str.slice(8, 10)}/${str.slice(5, 7)}`;
  return str.slice(0, 10);
};

export function ProductGroupPanel({ cases = [] }) {
  const groups = {
    tivi:    { ...PRODUCT_GROUPS[0], count: 0, comp: 0 },
    tulanh:  { ...PRODUCT_GROUPS[1], count: 0, comp: 0 },
    mayGiat: { ...PRODUCT_GROUPS[2], count: 0, comp: 0 },
    giaDung: { ...PRODUCT_GROUPS[3], count: 0, comp: 0 },
    khac:    { label: "KhÃ¡c / Cá»“ng ká»nh", color: "var(--text-secondary)", count: 0, comp: 0 },
  };
  const legs = {
    kho_nguon:    { ...RESP_LEGS[0], count: 0 },
    trung_chuyen: { ...RESP_LEGS[1], count: 0 },
    kho_dich:     { ...RESP_LEGS[2], count: 0 },
    chua_xd:      { label: "ChÆ°a xÃ¡c Ä‘á»‹nh", color: "var(--text-muted)", count: 0 },
  };
  for (const c of cases) {
    const gKey = productGroupOf(c);
    if (groups[gKey]) { groups[gKey].count++; groups[gKey].comp = (groups[gKey].comp || 0) + (Number(c.comp_amount) || 0); }
    const lKey = responsibleLegOf(c);
    if (legs[lKey]) legs[lKey].count++;
  }
  const total = cases.length || 1;
  const groupList = Object.values(groups).sort((a, b) => b.count - a.count);
  const legList = Object.values(legs).sort((a, b) => b.count - a.count);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Panel title="ðŸ“¦ PhÃ¢n tÃ­ch theo nhÃ³m máº·t hÃ ng" sub={`ká»³ Ä‘ang lá»c Â· ${fmt(cases.length)} ca`}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: 12.5, minWidth: 480 }}>
            <thead><tr>
              <th style={th}>NhÃ³m máº·t hÃ ng</th>
              <th style={{ ...th, textAlign: "right" }}>Ca</th>
              <th style={{ ...th, textAlign: "right" }}>Tá»· lá»‡</th>
              <th style={th}>Biá»ƒu Ä‘á»“</th>
              <th style={{ ...th, textAlign: "right" }}>Tiá»n Ä‘á»n</th>
            </tr></thead>
            <tbody>
              {groupList.map(({ label, color, count, comp }) => (
                <tr key={label}>
                  <td style={{ ...td, fontWeight: 600, color: color || "var(--text-primary)" }}>{label}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{fmt(count)}</td>
                  <td style={{ ...num, color: "var(--text-secondary)" }}>{pct(count / total)}</td>
                  <td style={{ ...td, minWidth: 120 }}>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: pct(count / total), background: color || "var(--brand)", borderRadius: 4 }} />
                    </div>
                  </td>
                  <td style={{ ...num, color: comp ? "var(--amber)" : "var(--text-muted)" }}>{comp ? vnd(comp) : "â€”"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="ðŸ­ % KhÃ¢u chá»‹u trÃ¡ch nhiá»‡m" sub={`theo cháº·ng nghi váº¥n Rillnet Â· ${fmt(cases.length)} ca`}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: 12.5, minWidth: 380 }}>
            <thead><tr>
              <th style={th}>KhÃ¢u</th>
              <th style={{ ...th, textAlign: "right" }}>Ca</th>
              <th style={{ ...th, textAlign: "right" }}>%</th>
              <th style={th}>Biá»ƒu Ä‘á»“</th>
            </tr></thead>
            <tbody>
              {legList.map(({ label, color, count }) => (
                <tr key={label}>
                  <td style={{ ...td, fontWeight: 600, color: color || "var(--text-muted)" }}>{label}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{fmt(count)}</td>
                  <td style={{ ...num, color: "var(--text-secondary)" }}>{pct(count / total)}</td>
                  <td style={{ ...td, minWidth: 120 }}>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: pct(count / total), background: color || "var(--text-muted)", borderRadius: 4 }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...small, marginTop: 6 }}>
          KhÃ¢u = phÃ¢n loáº¡i tá»« cháº·ng nghi váº¥n Rillnet: CSâ†’Kho Nguá»“n Â· KTC/TCâ†’Trung Chuyá»ƒn Â· OM/GXT/LMâ†’Kho ÄÃ­ch/Lastmile. "ChÆ°a xÃ¡c Ä‘á»‹nh" = cháº·ng trá»‘ng.
        </div>
      </Panel>
    </div>
  );
}

// â”€â”€ P2C: Há»“ sÆ¡ Ä‘á»n bÃ¹ + Media Rillnet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function CompensationPanel({ cases = [] }) {
  const [claims, setClaims] = useState(null);
  const [onlyMedia, setOnlyMedia] = useState(false);
  const [onlyComp, setOnlyComp] = useState(false);

  useEffect(() => {
    fetch("/api/damage-claims")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setClaims(j.claims || {}); })
      .catch(() => {});
  }, []);

  const claimOf = (code) => (claims || {})[code] || DEFAULT_CLAIM_P2;

  const list = cases.filter((c) => {
    if (onlyMedia && mediaOfCase(c).type === "none") return false;
    if (onlyComp && !c.compensated && !(Number(c.comp_pending) > 0)) return false;
    return true;
  });

  const withMedia = cases.filter((c) => mediaOfCase(c).type !== "none").length;
  const withComp = cases.filter((c) => c.compensated).length;

  return (
    <Panel
      title="ðŸ“‹ Há»“ sÆ¡ Ä‘á»n bÃ¹ & Media Rillnet"
      sub={`${fmt(cases.length)} ca Â· ${fmt(withComp)} Ä‘Ã£ chá»‘t Ä‘á»n bÃ¹ Â· ${fmt(withMedia)} ca cÃ³ media`}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        <button style={seg(onlyMedia)} onClick={() => setOnlyMedia((v) => !v)}>ðŸ“· CÃ³ media</button>
        <button style={seg(onlyComp)} onClick={() => setOnlyComp((v) => !v)}>ðŸ’° CÃ³ Ä‘á»n bÃ¹</button>
        {(onlyMedia || onlyComp) && (
          <button style={seg(false)} onClick={() => { setOnlyMedia(false); setOnlyComp(false); }}>Bá» lá»c âœ•</button>
        )}
        <span style={{ ...small, marginLeft: "auto" }}>Hiá»‡n {fmt(list.length)} ca</span>
      </div>
      <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: 660 }}>
          <thead><tr>
            <th style={th}>ÄÆ¡n / KhÃ¡ch</th>
            <th style={th}>NgÃ y ca</th>
            <th style={{ ...th, textAlign: "right" }}>Tiá»n Ä‘á»n</th>
            <th style={th}>Claim</th>
            <th style={th}>Media Rillnet</th>
          </tr></thead>
          <tbody>
            {list.map((c) => {
              const m = mediaOfCase(c);
              const cl = claimOf(c.order_code);
              const clColor = CLAIM_STATUS_COLOR_P2[cl.status] || "var(--text-muted)";
              return (
                <tr key={`${c.order_code}-${c.case_date || ""}`}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--cyan)", fontSize: 12 }}>{c.order_code}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{c.client_name}</div>
                  </td>
                  <td style={td}>{dmOf(c.case_iso || c.case_date)}</td>
                  <td style={{ ...num, color: c.compensated ? "var(--amber)" : Number(c.comp_pending) > 0 ? "var(--text-secondary)" : "var(--text-muted)", fontWeight: c.compensated ? 700 : 400 }}>
                    {c.compensated && Number(c.comp_amount) > 0 ? vnd(c.comp_amount) : Number(c.comp_pending) > 0 ? `~${vnd(c.comp_pending)}` : "â€”"}
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 10, border: `1px solid ${clColor}`, color: clColor, whiteSpace: "nowrap" }}>
                      {cl.status}
                    </span>
                  </td>
                  <td style={td}>
                    {m.type === "none" ? (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", border: "1px dashed var(--border)", padding: "2px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>
                        ChÆ°a cÃ³ media Rillnet
                      </span>
                    ) : m.type === "count" ? (
                      <a href="https://rillnet.ghn.vn/" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--cyan)", textDecoration: "none", whiteSpace: "nowrap" }}>
                        ðŸ“· {m.count} áº£nh (Rillnet â†—)
                      </a>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--cyan)", whiteSpace: "nowrap" }}>ðŸ“· {m.count} áº£nh</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>KhÃ´ng cÃ³ ca phÃ¹ há»£p.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

