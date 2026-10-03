/**
 * components/ltl/damage/DamageMoneyPanel.js — "💰 Tiền đền cho khách" của tab
 * Hư hỏng & Rủi ro (Kế hoạch E · phiên 2, user duyệt 29/09).
 * Data: body.damageMoney (lib/damage-money.js) — tiền theo kỳ đang lọc + so kỳ
 * trước, theo dự án / tuyến, đối chiếu với các ô của trang Rillnet (B5).
 * Tiền thiệt hại = tiền đền cho khách (số CS nhập theo mã đơn, số mới nhất).
 * Truy thu chỉ hiện riêng để tham khảo, KHÔNG trừ.
 */
import { useState } from "react";
import { fmt } from "../utils";
import { SHOW_TRUY_THU } from "../../../lib/display-flags";

const vnd = (x) => `${Math.round(x || 0).toLocaleString("vi-VN")}đ`;
const tr = (x) => (!x ? "0" : `${(x / 1e6).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tr`);
const shortWh = (s) => String(s || "").replace(/^Kho Giao Hàng Nặng - /, "").replace(/^Key Account Warehouse /, "KA WH ").replace(/^Kho B2B - /, "B2B ").trim();
const shortRoute = (r) => `${shortWh(r.kho_lay) || "?"} → ${shortWh(r.kho_giao) || "?"}`;
const vnStamp = (iso) => { if (!iso || Number.isNaN(Date.parse(iso))) return ""; const v = new Date(Date.parse(iso) + 7 * 3600e3).toISOString(); return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}`; };
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

// ▲▼ for money: up = worse (red), down = better (green).
export function Arrow({ cur, prev }) {
  if (!cur && !prev) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  if (!prev) return <span style={{ color: "var(--red)", fontWeight: 700 }}>▲ mới</span>;
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.05) return <span style={{ color: "var(--text-muted)" }}>±0%</span>;
  return <span style={{ color: d > 0 ? "var(--red)" : "var(--green)", fontWeight: 700 }}>{d > 0 ? "▲" : "▼"} {Math.abs(d).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</span>;
}

export const coverageText = (s) => `${fmt(s.withAmount)}/${fmt(s.compensated)} ca đã chốt đền bù có số tiền`;

const th = { padding: "7px 9px", fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textAlign: "right", whiteSpace: "nowrap" };
const td = { padding: "7px 9px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
const small = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 };
const seg = (on) => ({ fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border)", background: on ? "rgba(var(--brand-rgb),0.16)" : "transparent", color: on ? "var(--cyan)" : "var(--text-muted)", fontWeight: on ? 700 : 500 });

function MoneyTable({ rows, cmp, kind, limit }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, limit);
  const window = cmp && cmp.mode === "window";
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12, minWidth: window ? 860 : 720 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>{kind === "route" ? "Tuyến (kho lấy → kho giao của đơn)" : "Dự án / khách"}</th>
            <th style={th}>Ca bể</th>
            <th style={th} title="Số ca đã chốt đền bù có số tiền / số ca đã chốt đền bù">Đã chốt (có tiền)</th>
            <th style={th}>Tiền đền</th>
            {window && <th style={th}>{cmp.currentLabel}</th>}
            {cmp && <th style={th}>{cmp.mode === "window" ? `cùng kỳ ${cmp.compareLabel}` : `kỳ trước ${cmp.compareLabel}`}</th>}
            {cmp && <th style={th}>So kỳ trước</th>}
            {SHOW_TRUY_THU && <th style={{ ...th, color: "var(--text-muted)" }} title="Thu lại từ nhân viên GHN — không giảm thiệt hại, không trừ">Truy thu (tham khảo)</th>}
          </tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.name}>
                <td style={{ ...td, textAlign: "left", fontWeight: 600, whiteSpace: "normal", minWidth: 180, maxWidth: 360 }} title={r.name}>{kind === "route" ? shortRoute(r) : r.name}</td>
                <td style={td}>{fmt(r.cases)}</td>
                <td style={td}>{fmt(r.compensated)} <span style={small}>({fmt(r.withAmount)})</span></td>
                <td style={{ ...td, fontWeight: 700, color: r.amount ? "var(--amber)" : "var(--text-muted)" }}>{r.amount ? vnd(r.amount) : "—"}</td>
                {window && <td style={td}>{r.cmp?.amount ? vnd(r.cmp.amount) : "—"}</td>}
                {cmp && <td style={td}>{r.cmp?.prevAmount ? vnd(r.cmp.prevAmount) : "—"}</td>}
                {cmp && <td style={td}><Arrow cur={window ? r.cmp?.amount : r.amount} prev={r.cmp?.prevAmount} /></td>}
                {SHOW_TRUY_THU && <td style={{ ...td, color: "var(--text-muted)" }}>{r.truyThuAmount ? vnd(r.truyThuAmount) : "—"}</td>}
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>Không có ca nào trong kỳ đang lọc.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button style={{ ...seg(false), marginTop: 6 }} onClick={() => setAll((x) => !x)}>{all ? "Thu gọn" : `Xem tất cả ${rows.length}`}</button>}
    </>
  );
}

function Reconcile({ rc }) {
  if (!rc) return null;
  const r = rc.rillnet;
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
        🔎 Đối chiếu với các ô của trang Rillnet{" "}
        {!rc.readable ? <span style={{ ...small, fontWeight: 400 }}>— chưa đối chiếu được</span>
          : rc.mismatches.length ? <span style={{ color: "var(--red)" }}>— lệch {rc.mismatches.length} chỉ số</span>
          : <span style={{ color: "var(--green)" }}>— khớp</span>}
      </summary>
      <div style={{ marginTop: 6 }}>
        {!rc.readable && (
          <div style={{ fontSize: 12.5, color: "var(--amber)", marginBottom: 6 }}>
            ⚠ Ô Rillnet đọc ra 0 / trống{r?.syncedAt ? ` (lần đọc ${vnStamp(r.syncedAt)})` : ""} — scraper chưa đọc được các ô này (đang sửa ở Kế hoạch E · phiên 1). Bảng dưới chỉ có số dashboard tính từ sheet.
          </div>
        )}
        <div style={small}>
          Phạm vi: {rc.scope === "dm" ? "Điện máy" : "mọi khách GHN trong sheet Rillnet"}
          {rc.range.from || rc.range.to ? ` · ca ghi nhận ${dmy(rc.range.from) || "…"} – ${dmy(rc.range.to) || "…"}` : " · mọi ca trong sheet"}
          {" "}· các dòng "mọi thời gian" là ô Tổng hợp của trang Đền bù / Truy thu. Dashboard Điện máy cùng khoảng: {fmt(rc.dashboardDm.cases)} ca · {fmt(rc.dashboardDm.compensated)} đã chốt đền bù · tiền đền {vnd(rc.dashboardDm.amount)}.
        </div>
        <div style={{ overflowX: "auto", marginTop: 6 }}>
          <table className="data-table" style={{ fontSize: 12, minWidth: 560 }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Chỉ số</th><th style={th}>Rillnet</th><th style={th}>Dashboard</th><th style={th}>Lệch</th></tr></thead>
            <tbody>{rc.rows.map((x) => {
              const f = (v) => (v == null ? "—" : x.money ? vnd(v) : fmt(v));
              const bad = x.diff != null && Math.abs(x.diff) > (x.money ? 0.5 : 0);
              return (
                <tr key={x.key}>
                  <td style={{ ...td, textAlign: "left" }}>{x.label}</td>
                  <td style={td}>{f(x.rillnet)}</td>
                  <td style={td}>{f(x.dashboard)}</td>
                  <td style={{ ...td, fontWeight: 700, color: x.diff == null ? "var(--text-muted)" : bad ? "var(--red)" : "var(--green)" }}>{x.diff == null ? "—" : bad ? `${x.diff > 0 ? "+" : "−"}${x.money ? vnd(Math.abs(x.diff)) : fmt(Math.abs(x.diff))}` : "✓"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {rc.mismatches.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>
            Lệch: {rc.mismatches.map((x) => `${x.label} (Rillnet ${x.money ? vnd(x.rillnet) : fmt(x.rillnet)} · dashboard ${x.money ? vnd(x.dashboard) : fmt(x.dashboard)})`).join("; ")}. Nguyên nhân hay gặp: ca có đơn lấy trước 01/07 (ngoài phạm vi dữ liệu), ca vừa đổi trạng thái sau lần quét, khoảng ngày khác nhau.
          </div>
        )}
        {rc.mismatches.some((x) => x.key === "totalChot" || x.key === "totalAmount") && rc.chotCases?.length > 0 && (
          <div style={{ fontSize: 12, marginTop: 6 }}>
            <b>Ca có số "đã chốt" trong sheet ({rc.chotCases.length} ca, {vnd(rc.chotCases.reduce((a, c) => a + c.amount, 0))}):</b>{" "}
            {rc.chotCases.map((c) => `${c.order_code} (${c.client_name.replace(/ Điện máy$/, "")}) ${vnd(c.amount)}`).join(" · ")}.{" "}
            <span style={small}>Tổng "đã chốt" của Rillnet ({vnd(rc.rillnet?.totalChot)}) chỉ gồm số nạp qua file "Chốt tiền" — ca nào có số trong sheet mà không nằm trong tổng Rillnet thì lệch từ đó; chênh = tổng các ca đó.</span>
          </div>
        )}
      </div>
    </details>
  );
}

export default function DamageMoneyPanel({ money }) {
  const [tab, setTab] = useState("project");
  if (!money) return null;
  const t = money.total, c = money.compare;
  const curAmt = c && !c.incomplete ? (c.mode === "window" ? c.cur.amount : t.amount) : null;
  const tiles = [
    {
      label: "Tiền đền cho khách (kỳ đang lọc)", value: vnd(t.amount), strong: true,
      sub: `${coverageText(t)}${t.amountOutside ? ` · +${fmt(t.amountOutside)} ca có tiền chưa đánh dấu đã chốt` : ""}`,
    },
    c && !c.incomplete ? {
      label: c.mode === "window" ? `${c.currentLabel} so cùng kỳ ${c.compareLabel}` : `So kỳ trước (${c.compareLabel})`,
      value: <span>{vnd(curAmt)} <span style={{ fontSize: 14 }}><Arrow cur={curAmt} prev={c.prev.amount} /></span></span>,
      sub: `kỳ trước ${vnd(c.prev.amount)} · ${coverageText(c.mode === "window" ? c.cur : t)} / kỳ trước ${coverageText(c.prev)}`,
    } : { label: "So kỳ trước", value: "—", sub: c?.incomplete ? `Kỳ trước (${c.compareLabel}) nằm ngoài phạm vi dữ liệu` : "Không so được với bộ lọc này" },
    SHOW_TRUY_THU ? { label: "Truy thu đã duyệt (tham khảo)", value: vnd(t.truyThuAmount), muted: true, sub: `${fmt(t.truyThuCases)} ca · thu từ nhân viên GHN — không giảm thiệt hại, không trừ` } : null,
  ].filter(Boolean);
  return (
    <div className="chart-panel" style={{ width: "100%" }}>
      <div className="chart-panel-title">💰 Tiền đền cho khách</div>
      <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="grid-3">
          {tiles.map((x) => (
            <div key={x.label} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{x.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: x.muted ? "var(--text-secondary)" : x.strong ? "var(--amber)" : "var(--text-primary)" }}>{x.value}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{x.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--amber)" }}>
          ⚠ {money.note}. Luôn lấy số mới nhất (đã chốt &gt; dự kiến sửa sau QC &gt; số CS nhập khi tick). Hiện <b>{coverageText(t)}</b> — tổng tiền còn thiếu cho tới khi đủ số.
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button style={seg(tab === "project")} onClick={() => setTab("project")}>Theo dự án / khách</button>
          <button style={seg(tab === "route")} onClick={() => setTab("route")}>Theo tuyến</button>
          <span style={small}>{tab === "route" ? `${fmt(money.routeCount)} tuyến có ca · hiện ${fmt(money.byRoute.length)} tuyến nhiều tiền / nhiều ca nhất` : `${fmt(money.byProject.length)} dự án`}</span>
        </div>
        {tab === "project"
          ? <MoneyTable rows={money.byProject} cmp={c && !c.incomplete ? c : null} kind="project" limit={12} />
          : <MoneyTable rows={money.byRoute} cmp={c && !c.incomplete ? c : null} kind="route" limit={12} />}
        <div style={small}>
          Cùng tập ca với ô "Ca hư hỏng (kỳ đang lọc)" (ca Rillnet gắn theo mã đơn). Không lọc tháng/ngày: so khoảng "So sánh cùng kỳ" theo ngày ghi nhận ca; có lọc: so kỳ trước cùng độ dài như thẻ KPI. Tuyến = kho lấy → kho giao của ĐƠN.
        </div>
        <Reconcile rc={money.reconcile} />
      </div>
    </div>
  );
}
