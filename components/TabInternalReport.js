/**
 * components/TabInternalReport.js
 * Tab "Báo cáo nội bộ ĐTĐM" — dành cho Manager + chuyên viên SD được phân quyền.
 * 5 section: CompMatrix (LTL/FTL đối soát), CaseList, PICTaskBoard,
 *            NewProjectPipeline, ZaloExport.
 */
import { useState, useEffect, useCallback } from "react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getISOWeek(d) {
  const tmp = new Date(d.getTime());
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return { week: Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7), year: tmp.getUTCFullYear() };
}

function vnNow() {
  return new Date(Date.now() + 7 * 3600 * 1000);
}

// "W40-W41" + 2026 → "2026-W41" (odd-ending week of the biweekly range)
function labelToApiPeriod(label, year) {
  const weeks = [...String(label).matchAll(/W(\d+)/gi)].map((m) => parseInt(m[1]));
  if (!weeks.length) return null;
  const odd = weeks.find((w) => w % 2 === 1) ?? Math.max(...weeks);
  return `${year}-W${String(odd).padStart(2, "0")}`;
}

// Extract auto-fill values from a biweekly report for the "Kỳ này" span column.
function extractFromReport(report) {
  if (!report?.ontime?.rows) return null;
  const spanIdx = report.ontime.delta?.[1] ?? (report.ontime.cols.length - 1);
  const dmgSpanIdx = report.damage?.delta?.[1] ?? (report.damage?.cols?.length - 1);
  const pct1 = (v) => (v == null || isNaN(v) ? "" : String(Math.round(v * 1000) / 10));
  const cnt = (rows, name, grand) => {
    const row = grand ? rows?.find((r) => r.grand) : rows?.find((r) => r.name === name);
    const v = row?.counts?.[spanIdx];
    return v == null ? "" : String(v);
  };
  const rate = (rows, name, grand) => {
    const row = grand ? rows?.find((r) => r.grand) : rows?.find((r) => r.name === name);
    return pct1(row?.rates?.[spanIdx]);
  };
  const dmgCnt = (rows) => {
    const row = rows?.find((r) => r.grand);
    const v = row?.counts?.[dmgSpanIdx ?? spanIdx];
    return v == null ? "" : String(v);
  };
  return {
    ltl: {
      don:    cnt(report.ontime.rows, null, true),
      ontime: rate(report.ontime.rows, null, true),
      bevo:   dmgCnt(report.damage?.rows),
      fd:     cnt(report.fd?.rows, null, true),
    },
    b2c: {
      don:    cnt(report.ontime.rows, "Tổng Khách B2C", false),
      ontime: rate(report.ontime.rows, "Tổng Khách B2C", false),
      bevo:   "",
      fd:     cnt(report.fd?.rows, "Tổng Khách B2C", false),
    },
    b2b: {
      don:    cnt(report.ontime.rows, "Tổng Khách B2B LTL", false),
      ontime: rate(report.ontime.rows, "Tổng Khách B2B LTL", false),
      bevo:   "",
      fd:     cnt(report.fd?.rows, "Tổng Khách B2B LTL", false),
    },
  };
}

function delta(curr, prev) {
  const c = parseFloat(curr), p = parseFloat(prev);
  if (isNaN(c) || isNaN(p)) return "";
  const d = c - p;
  return (d > 0 ? "+" : "") + (Number.isInteger(d) ? d : d.toFixed(1));
}

function deltaColor(curr, prev, lowerIsBetter = false) {
  const c = parseFloat(curr), p = parseFloat(prev);
  if (isNaN(c) || isNaN(p) || c === p) return "var(--text-muted)";
  const better = lowerIsBetter ? c < p : c > p;
  return better ? "var(--green)" : "var(--red)";
}

const n = (v) => (v === "" || v == null ? "—" : Number(v).toLocaleString("vi-VN"));

// ── Constants ─────────────────────────────────────────────────────────────────

const PICS = ["Tú", "Đạt", "Diện", "Tân"];

const EMPTY_CELL = { prev: "", curr: "" };

const DEFAULT_MATRIX = {
  ltl:  { don: { ...EMPTY_CELL }, ontime: { ...EMPTY_CELL }, bevo: { ...EMPTY_CELL }, fd: { ...EMPTY_CELL } },
  b2c:  { don: { ...EMPTY_CELL }, ontime: { ...EMPTY_CELL }, bevo: { ...EMPTY_CELL }, fd: { ...EMPTY_CELL } },
  b2b:  { don: { ...EMPTY_CELL }, ontime: { ...EMPTY_CELL }, bevo: { ...EMPTY_CELL }, fd: { ...EMPTY_CELL } },
  ftl: [
    { label: "1.9T", trips: { ...EMPTY_CELL }, fill: { ...EMPTY_CELL } },
    { label: "5T",   trips: { ...EMPTY_CELL }, fill: { ...EMPTY_CELL } },
    { label: "8T",   trips: { ...EMPTY_CELL }, fill: { ...EMPTY_CELL } },
    { label: "NCC",  trips: { ...EMPTY_CELL }, fill: { ...EMPTY_CELL } },
  ],
};

const INITIAL_CASES = [
  {
    id: "cheobill", label: "Chéo Bill / Dán nhầm code",
    color: "var(--amber)",
    items: [
      { id: "cb1", code: "GYR8LKKH", client: "", detail: "Chéo bill / dán nhầm code" },
      { id: "cb2", code: "GYR8NU3H", client: "", detail: "Chéo bill / dán nhầm code" },
      { id: "cb3", code: "GYRXA3FW", client: "", detail: "Chéo bill / dán nhầm code" },
    ],
  },
  {
    id: "bevo", label: "Bể vỡ / Rủi ro",
    color: "var(--red)",
    items: [
      { id: "bv1", code: "GYR4ND4B", client: "Smartlink", detail: "Bể vỡ hàng hóa" },
      { id: "bv2", code: "",        client: "Digiworld Tân Thuận", detail: "Bể vỡ hàng hóa" },
      { id: "bv3", code: "",        client: "Komex Tivi/Tủ lạnh", detail: "Bể vỡ hàng hóa" },
      { id: "bv4", code: "",        client: "Hồng Đạt Thái Bình", detail: "Bể vỡ hàng hóa" },
    ],
  },
  {
    id: "sla", label: "SLA & Sản lượng",
    color: "var(--cyan, #06b6d4)",
    items: [
      { id: "sl1", code: "", client: "Aqua B2C",      detail: "Theo dõi SLA / sản lượng" },
      { id: "sl2", code: "", client: "Digiworld",      detail: "Theo dõi SLA / sản lượng" },
      { id: "sl3", code: "", client: "PSD Miền Bắc",  detail: "Theo dõi SLA / sản lượng" },
      { id: "sl4", code: "", client: "FRT Miền Nam",  detail: "Theo dõi SLA / sản lượng" },
    ],
  },
];

const INITIAL_PIPELINE = [
  { id: "p1", name: "Digiworld MN",        status: "Đang đàm phán", pic: "", note: "" },
  { id: "p2", name: "Mutosi",              status: "Đang đàm phán", pic: "", note: "" },
  { id: "p3", name: "Bluestone MB",        status: "Đang đàm phán", pic: "", note: "" },
  { id: "p4", name: "FRT Tivi",            status: "Đang đàm phán", pic: "", note: "" },
  { id: "p5", name: "UKG",                 status: "Đang đàm phán", pic: "", note: "" },
  { id: "p6", name: "Karcher",             status: "Đang đàm phán", pic: "", note: "" },
  { id: "p7", name: "Lắp đặt Nguyễn Kim", status: "Đang đàm phán", pic: "", note: "" },
];

const PIPELINE_STATUSES = ["Đang đàm phán", "Chờ hợp đồng", "Đang onboard", "Hoạt động", "Tạm dừng", "Từ chối"];
const TASK_STATUSES = ["pending", "inprogress", "done"];
const TASK_STATUS_LABEL = { pending: "Chờ xử lý", inprogress: "Đang làm", done: "Hoàn thành" };
const TASK_STATUS_COLOR = { pending: "var(--text-muted)", inprogress: "var(--amber)", done: "var(--green)" };

// ── Styles ────────────────────────────────────────────────────────────────────

const panel = { background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 16 };
const h2Style = { fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.4 };
const cellInput = {
  width: "100%", background: "transparent", border: "none", outline: "none",
  fontSize: 12, color: "var(--text-primary)", textAlign: "right", padding: "2px 4px",
};
const tdStyle = { padding: "5px 8px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-primary)" };
const thStyle = { ...tdStyle, color: "var(--text-muted)", fontWeight: 600, fontSize: 11, background: "var(--surface-0, var(--bg-panel))" };

// ── Sub-component: EditableCell ───────────────────────────────────────────────

function EditableCell({ value, onChange, suffix = "", placeholder = "—", align = "right" }) {
  return (
    <td style={{ ...tdStyle, padding: "4px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: align === "right" ? "flex-end" : "flex-start", gap: 2 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...cellInput, textAlign: align, width: suffix ? 55 : 70 }}
        />
        {suffix && <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{suffix}</span>}
      </div>
    </td>
  );
}

// ── Sub-component: DeltaCell ──────────────────────────────────────────────────

function DeltaCell({ curr, prev, lowerIsBetter = false, suffix = "" }) {
  const d = delta(curr, prev);
  return (
    <td style={{ ...tdStyle, color: d ? deltaColor(curr, prev, lowerIsBetter) : "var(--text-muted)", fontWeight: 600, textAlign: "right" }}>
      {d ? d + suffix : "—"}
    </td>
  );
}

// ── Sub-component: SectionHeader ─────────────────────────────────────────────

function SectionHeader({ title, weekLabel, onAdd }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <h3 style={h2Style}>{title}</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {weekLabel && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{weekLabel}</span>}
        {onAdd && (
          <button onClick={onAdd} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-secondary)" }}>
            + Thêm
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-component: CompMatrix ─────────────────────────────────────────────────

function CompMatrix({ matrix, setMatrix, prevLabel, currLabel, apiData, apiLoading }) {
  const setLTL = useCallback((seg, metric, period, val) => {
    setMatrix((prev) => ({ ...prev, [seg]: { ...prev[seg], [metric]: { ...prev[seg][metric], [period]: val } } }));
  }, [setMatrix]);

  const setFTL = useCallback((idx, field, period, val) => {
    setMatrix((prev) => {
      const ftl = [...prev.ftl];
      ftl[idx] = { ...ftl[idx], [field]: { ...ftl[idx][field], [period]: val } };
      return { ...prev, ftl };
    });
  }, [setMatrix]);

  const SEGS = [
    { key: "ltl", label: "LTL tổng", bold: true },
    { key: "b2c", label: "└ B2C",    bold: false },
    { key: "b2b", label: "└ B2B",    bold: false },
  ];

  const METRICS = [
    { key: "don",   label: "# Đơn LTC", suffix: "",  lowerIsBetter: false },
    { key: "ontime", label: "% On-time", suffix: "%", lowerIsBetter: false },
    { key: "bevo",  label: "# Bể vỡ đền", suffix: "", lowerIsBetter: true },
    { key: "fd",    label: "# FD",      suffix: "",  lowerIsBetter: true },
  ];

  return (
    <div>
      {/* Badge trạng thái API */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 11, color: apiLoading ? "var(--amber)" : apiData ? "var(--green)" : "var(--text-muted)" }}>
        {apiLoading ? "⏳ Đang nạp số liệu từ Báo cáo Công ty..." : apiData ? "✓ Số liệu LTL tự động từ Báo cáo Công ty · FTL nhập tay" : "ℹ Chưa nạp được dữ liệu API — nhập tay"}
      </div>

      {/* LTL/B2C/B2B table */}
      <div style={{ marginBottom: 16, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 110, textAlign: "left" }}>Phân khúc</th>
              {METRICS.map((m) => (
                <th key={m.key} colSpan={3} style={{ ...thStyle, textAlign: "center", borderLeft: "2px solid var(--border)" }}>
                  {m.label}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: "left" }}></th>
              {METRICS.map((m) => (
                <>
                  <th key={`${m.key}_p`} style={{ ...thStyle, textAlign: "right", borderLeft: "2px solid var(--border)", fontSize: 10, color: "var(--text-muted)" }}>{prevLabel}</th>
                  <th key={`${m.key}_c`} style={{ ...thStyle, textAlign: "right", fontSize: 10 }}>{currLabel}</th>
                  <th key={`${m.key}_d`} style={{ ...thStyle, textAlign: "right", fontSize: 10, color: "var(--text-muted)" }}>±</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {SEGS.map(({ key: seg, label, bold }) => (
              <tr key={seg}>
                <td style={{ ...tdStyle, fontWeight: bold ? 700 : 400, fontSize: bold ? 12 : 11 }}>{label}</td>
                {METRICS.map((m) => (
                  <>
                    <EditableCell key={`${seg}_${m.key}_p`} value={matrix[seg][m.key].prev} onChange={(v) => setLTL(seg, m.key, "prev", v)} suffix={m.suffix} />
                    <EditableCell key={`${seg}_${m.key}_c`} value={matrix[seg][m.key].curr} onChange={(v) => setLTL(seg, m.key, "curr", v)} suffix={m.suffix} />
                    <DeltaCell key={`${seg}_${m.key}_d`} curr={matrix[seg][m.key].curr} prev={matrix[seg][m.key].prev} lowerIsBetter={m.lowerIsBetter} suffix={m.suffix} />
                  </>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* FTL table */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>FTL — Theo dõi chuyến xe</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 70, textAlign: "left" }}>Loại xe</th>
              <th style={{ ...thStyle, textAlign: "right", borderLeft: "2px solid var(--border)" }}>{prevLabel} (chuyến)</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{currLabel} (chuyến)</th>
              <th style={{ ...thStyle, textAlign: "right" }}>±</th>
              <th style={{ ...thStyle, textAlign: "right", borderLeft: "2px solid var(--border)" }}>{prevLabel} Fill%</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{currLabel} Fill%</th>
              <th style={{ ...thStyle, textAlign: "right" }}>±</th>
            </tr>
          </thead>
          <tbody>
            {matrix.ftl.map((row, idx) => (
              <tr key={row.label}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{row.label}</td>
                <EditableCell value={row.trips.prev} onChange={(v) => setFTL(idx, "trips", "prev", v)} />
                <EditableCell value={row.trips.curr} onChange={(v) => setFTL(idx, "trips", "curr", v)} />
                <DeltaCell curr={row.trips.curr} prev={row.trips.prev} />
                <EditableCell value={row.fill.prev} onChange={(v) => setFTL(idx, "fill", "prev", v)} suffix="%" />
                <EditableCell value={row.fill.curr} onChange={(v) => setFTL(idx, "fill", "curr", v)} suffix="%" />
                <DeltaCell curr={row.fill.curr} prev={row.fill.prev} suffix="pp" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 8 }}>
        FTL (chuyến xe, fill%) — nhập tay từ hệ thống booking FTL riêng.
      </div>
    </div>
  );
}

// ── Sub-component: CaseList ───────────────────────────────────────────────────

function CaseList({ cases, setCases }) {
  const addCase = (groupId) => {
    setCases((prev) => prev.map((g) =>
      g.id !== groupId ? g : { ...g, items: [...g.items, { id: `${groupId}_${Date.now()}`, code: "", client: "", detail: "" }] }
    ));
  };

  const updateItem = (groupId, itemId, field, val) => {
    setCases((prev) => prev.map((g) =>
      g.id !== groupId ? g : { ...g, items: g.items.map((it) => it.id !== itemId ? it : { ...it, [field]: val }) }
    ));
  };

  const removeItem = (groupId, itemId) => {
    setCases((prev) => prev.map((g) =>
      g.id !== groupId ? g : { ...g, items: g.items.filter((it) => it.id !== itemId) }
    ));
  };

  return (
    <div>
      {cases.map((group) => (
        <div key={group.id} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: group.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-primary)" }}>{group.label}</span>
            <button onClick={() => addCase(group.id)} style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-secondary)" }}>+ Thêm</button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 110, textAlign: "left" }}>Mã đơn</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Khách hàng</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Chi tiết sự cố</th>
                <th style={{ ...thStyle, width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => (
                <tr key={item.id}>
                  <td style={{ ...tdStyle, padding: "4px 6px" }}>
                    <input value={item.code} onChange={(e) => updateItem(group.id, item.id, "code", e.target.value)} placeholder="Mã đơn" style={{ ...cellInput, textAlign: "left", width: "100%" }} />
                  </td>
                  <td style={{ ...tdStyle, padding: "4px 6px" }}>
                    <input value={item.client} onChange={(e) => updateItem(group.id, item.id, "client", e.target.value)} placeholder="Tên KH" style={{ ...cellInput, textAlign: "left", width: "100%" }} />
                  </td>
                  <td style={{ ...tdStyle, padding: "4px 6px" }}>
                    <input value={item.detail} onChange={(e) => updateItem(group.id, item.id, "detail", e.target.value)} placeholder="Mô tả" style={{ ...cellInput, textAlign: "left", width: "100%" }} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <button onClick={() => removeItem(group.id, item.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--red)", fontSize: 12, padding: 0 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ── Sub-component: PICTaskBoard ───────────────────────────────────────────────

function PICTaskBoard({ tasks, setTasks }) {
  const addTask = (pic) => {
    setTasks((prev) => [...prev, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, pic, client: "", action: "", deadline: "", status: "pending" }]);
  };

  const updateTask = (id, field, val) => {
    setTasks((prev) => prev.map((t) => t.id !== id ? t : { ...t, [field]: val }));
  };

  const removeTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div>
      {PICS.map((pic) => {
        const picTasks = tasks.filter((t) => t.pic === pic);
        return (
          <div key={pic} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ background: "var(--amber)", color: "#fff", borderRadius: 4, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{pic}</div>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{picTasks.length} task</span>
              <button onClick={() => addTask(pic)} style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-secondary)" }}>+ Thêm</button>
            </div>
            {picTasks.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 0", fontStyle: "italic" }}>Chưa có task</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: "left", width: 120 }}>Khách / Sự cố</th>
                    <th style={{ ...thStyle, textAlign: "left" }}>Action Plan</th>
                    <th style={{ ...thStyle, width: 90, textAlign: "left" }}>Deadline</th>
                    <th style={{ ...thStyle, width: 90, textAlign: "left" }}>Trạng thái</th>
                    <th style={{ ...thStyle, width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {picTasks.map((task) => (
                    <tr key={task.id}>
                      <td style={{ ...tdStyle, padding: "4px 6px" }}>
                        <input value={task.client} onChange={(e) => updateTask(task.id, "client", e.target.value)} placeholder="KH / sự cố" style={{ ...cellInput, textAlign: "left", width: "100%" }} />
                      </td>
                      <td style={{ ...tdStyle, padding: "4px 6px" }}>
                        <input value={task.action} onChange={(e) => updateTask(task.id, "action", e.target.value)} placeholder="Việc cần làm..." style={{ ...cellInput, textAlign: "left", width: "100%" }} />
                      </td>
                      <td style={{ ...tdStyle, padding: "4px 6px" }}>
                        <input type="date" value={task.deadline} onChange={(e) => updateTask(task.id, "deadline", e.target.value)} style={{ ...cellInput, textAlign: "left", width: "100%", fontSize: 11 }} />
                      </td>
                      <td style={{ ...tdStyle, padding: "4px 6px" }}>
                        <select value={task.status} onChange={(e) => updateTask(task.id, "status", e.target.value)} style={{ ...cellInput, textAlign: "left", width: "100%", fontSize: 11, cursor: "pointer", color: TASK_STATUS_COLOR[task.status] }}>
                          {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <button onClick={() => removeTask(task.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--red)", fontSize: 12, padding: 0 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-component: NewProjectPipeline ─────────────────────────────────────────

function NewProjectPipeline({ pipeline, setPipeline }) {
  const addRow = () => {
    setPipeline((prev) => [...prev, { id: `p${Date.now()}`, name: "", status: "Đang đàm phán", pic: "", note: "" }]);
  };

  const update = (id, field, val) => {
    setPipeline((prev) => prev.map((p) => p.id !== id ? p : { ...p, [field]: val }));
  };

  const remove = (id) => {
    setPipeline((prev) => prev.filter((p) => p.id !== id));
  };

  const STATUS_COLOR = { "Đang đàm phán": "var(--amber)", "Chờ hợp đồng": "#3b82f6", "Đang onboard": "var(--cyan, #06b6d4)", "Hoạt động": "var(--green)", "Tạm dừng": "var(--text-muted)", "Từ chối": "var(--red)" };

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left", width: 180 }}>Dự án mới</th>
            <th style={{ ...thStyle, textAlign: "left", width: 130 }}>Trạng thái</th>
            <th style={{ ...thStyle, textAlign: "left", width: 70 }}>PIC</th>
            <th style={{ ...thStyle, textAlign: "left" }}>Ghi chú</th>
            <th style={{ ...thStyle, width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {pipeline.map((row) => (
            <tr key={row.id}>
              <td style={{ ...tdStyle, padding: "4px 6px" }}>
                <input value={row.name} onChange={(e) => update(row.id, "name", e.target.value)} placeholder="Tên dự án" style={{ ...cellInput, textAlign: "left", width: "100%" }} />
              </td>
              <td style={{ ...tdStyle, padding: "4px 6px" }}>
                <select value={row.status} onChange={(e) => update(row.id, "status", e.target.value)} style={{ ...cellInput, textAlign: "left", width: "100%", color: STATUS_COLOR[row.status] || "var(--text-primary)", cursor: "pointer" }}>
                  {PIPELINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td style={{ ...tdStyle, padding: "4px 6px" }}>
                <input value={row.pic} onChange={(e) => update(row.id, "pic", e.target.value)} placeholder="PIC" style={{ ...cellInput, textAlign: "left", width: "100%" }} />
              </td>
              <td style={{ ...tdStyle, padding: "4px 6px" }}>
                <input value={row.note} onChange={(e) => update(row.id, "note", e.target.value)} placeholder="Ghi chú..." style={{ ...cellInput, textAlign: "left", width: "100%" }} />
              </td>
              <td style={{ ...tdStyle, textAlign: "center" }}>
                <button onClick={() => remove(row.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--red)", fontSize: 12, padding: 0 }}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} style={{ marginTop: 8, fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px dashed var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-secondary)", width: "100%" }}>+ Thêm dự án mới</button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TabInternalReport() {
  const now = vnNow();
  const { week: thisWeek, year: thisYear } = getISOWeek(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
  const weekKey = `W${thisWeek}_${thisYear}`;

  // Period labels — user can edit these strings
  const [prevLabel, setPrevLabel] = useState(`W${thisWeek - 2}-W${thisWeek - 1}`);
  const [currLabel, setCurrLabel] = useState(`W${thisWeek}-W${thisWeek + 1}`);

  // Core data state
  const [matrix, setMatrix] = useState(() => {
    try {
      const raw = localStorage.getItem(`teamreport_matrix_${weekKey}`);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_MATRIX));
    } catch { return JSON.parse(JSON.stringify(DEFAULT_MATRIX)); }
  });
  const [cases, setCases] = useState(() => {
    try {
      const raw = localStorage.getItem(`teamreport_cases_${weekKey}`);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(INITIAL_CASES));
    } catch { return JSON.parse(JSON.stringify(INITIAL_CASES)); }
  });
  const [tasks, setTasks] = useState(() => {
    try {
      const raw = localStorage.getItem(`teamreport_tasks_${weekKey}`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [pipeline, setPipeline] = useState(() => {
    try {
      const raw = localStorage.getItem("teamreport_pipeline");
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(INITIAL_PIPELINE));
    } catch { return JSON.parse(JSON.stringify(INITIAL_PIPELINE)); }
  });

  const [apiData, setApiData] = useState(null);   // {prev: extracted, curr: extracted}
  const [apiLoading, setApiLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [blobLoaded, setBlobLoaded] = useState(false);

  // Load từ Blob khi mount
  useEffect(() => {
    fetch(`/api/team-notes?week=${weekKey}`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (!data) return;
        if (Array.isArray(data.tasks)) setTasks(data.tasks);
        if (data.matrix) setMatrix(data.matrix);
        if (Array.isArray(data.cases)) setCases(data.cases);
        if (Array.isArray(data.pipeline)) setPipeline(data.pipeline);
        setBlobLoaded(true);
      })
      .catch(() => {});
  }, [weekKey]);

  // Auto-populate từ Báo cáo Công ty (biweekly API) khi prevLabel/currLabel thay đổi
  useEffect(() => {
    const prevKey = labelToApiPeriod(prevLabel, thisYear);
    const currKey = labelToApiPeriod(currLabel, thisYear);
    if (!prevKey && !currKey) return;
    setApiLoading(true);
    const base = "/api/report/biweekly?type=biweekly&format=json&lite=1&period=";
    Promise.all([
      prevKey ? fetch(base + encodeURIComponent(prevKey)).then((r) => r.json()).catch(() => null) : Promise.resolve(null),
      currKey ? fetch(base + encodeURIComponent(currKey)).then((r) => r.json()).catch(() => null) : Promise.resolve(null),
    ]).then(([prevResp, currResp]) => {
      const prevExt = extractFromReport(prevResp?.report);
      const currExt = extractFromReport(currResp?.report);
      if (!prevExt && !currExt) { setApiLoading(false); return; }
      setApiData({ prev: prevExt, curr: currExt });
      // Điền thẳng vào matrix: LTL / B2C / B2B — 4 chỉ số
      setMatrix((m) => {
        const fill = (seg, metric) => ({
          prev: prevExt?.[seg]?.[metric] !== undefined ? prevExt[seg][metric] : m[seg][metric].prev,
          curr: currExt?.[seg]?.[metric] !== undefined ? currExt[seg][metric] : m[seg][metric].curr,
        });
        return {
          ...m,
          ltl: { don: fill("ltl","don"), ontime: fill("ltl","ontime"), bevo: fill("ltl","bevo"), fd: fill("ltl","fd") },
          b2c: { don: fill("b2c","don"), ontime: fill("b2c","ontime"), bevo: fill("b2c","bevo"), fd: fill("b2c","fd") },
          b2b: { don: fill("b2b","don"), ontime: fill("b2b","ontime"), bevo: fill("b2b","bevo"), fd: fill("b2b","fd") },
        };
      });
      setApiLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevLabel, currLabel, thisYear]);

  // Persist localStorage
  useEffect(() => {
    try { localStorage.setItem(`teamreport_matrix_${weekKey}`, JSON.stringify(matrix)); } catch {}
  }, [matrix, weekKey]);
  useEffect(() => {
    try { localStorage.setItem(`teamreport_cases_${weekKey}`, JSON.stringify(cases)); } catch {}
  }, [cases, weekKey]);
  useEffect(() => {
    try { localStorage.setItem(`teamreport_tasks_${weekKey}`, JSON.stringify(tasks)); } catch {}
  }, [tasks, weekKey]);
  useEffect(() => {
    try { localStorage.setItem("teamreport_pipeline", JSON.stringify(pipeline)); } catch {}
  }, [pipeline]);

  // Save to Blob
  const saveToBlob = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/team-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: weekKey, tasks, matrix, cases, pipeline }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  }, [weekKey, tasks, matrix, cases, pipeline]);

  // Build Zalo export string
  const buildZaloText = useCallback(() => {
    const lines = [];
    lines.push(`📊 GIAO BAN NỘI BỘ ĐTĐM — ${weekKey}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("📦 ĐỐI SOÁT SỐ LIỆU");
    const seg = (label, key) => {
      const s = matrix[key];
      if (!s.don.prev && !s.don.curr) return;
      const d = delta(s.don.curr, s.don.prev);
      lines.push(`${label}: ${n(s.don.prev)} → ${n(s.don.curr)} đơn (${d || "—"}) | OT: ${s.ontime.prev || "—"}% → ${s.ontime.curr || "—"}% | BV: ${s.bevo.prev || "—"} → ${s.bevo.curr || "—"}`);
    };
    seg("LTL tổng", "ltl");
    seg("B2C", "b2c");
    seg("B2B", "b2b");

    const ftlLines = matrix.ftl.filter((r) => r.trips.prev || r.trips.curr);
    if (ftlLines.length > 0) {
      lines.push("🚛 FTL: " + ftlLines.map((r) => `${r.label}: ${r.trips.prev || 0}→${r.trips.curr || 0} chuyến`).join(" | "));
    }

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("🔍 CASE NỔI BẬT");
    for (const group of cases) {
      const notableItems = group.items.filter((it) => it.code || it.client);
      if (notableItems.length === 0) continue;
      lines.push(`【${group.label}】`);
      for (const it of notableItems) {
        lines.push(`• ${[it.code, it.client, it.detail].filter(Boolean).join(" — ")}`);
      }
    }

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("✅ PHÂN CÔNG TUẦN MỚI");
    for (const pic of PICS) {
      const picTasks = tasks.filter((t) => t.pic === pic && t.status !== "done");
      if (picTasks.length === 0) continue;
      lines.push(`👤 ${pic}:`);
      for (const t of picTasks) {
        const parts = [t.client, t.action].filter(Boolean);
        const dl = t.deadline ? ` (${t.deadline.slice(5).replace("-", "/")})` : "";
        lines.push(`  • ${parts.join(": ")}${dl}`);
      }
    }

    const newProjs = pipeline.filter((p) => p.status === "Đang đàm phán" || p.status === "Đang onboard");
    if (newProjs.length > 0) {
      lines.push("━━━━━━━━━━━━━━━━━━━━");
      lines.push("🆕 DỰ ÁN MỚI ĐANG TRIỂN KHAI");
      for (const p of newProjs) {
        lines.push(`• ${p.name} — ${p.status}${p.pic ? " (PIC: " + p.pic + ")" : ""}${p.note ? " — " + p.note : ""}`);
      }
    }

    return lines.join("\n");
  }, [matrix, cases, tasks, pipeline, weekKey]);

  const copyZalo = useCallback(() => {
    const text = buildZaloText();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }, [buildZaloText]);

  const btnBase = { fontSize: 12, padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 600, border: "none" };

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1100 }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          Báo cáo nội bộ ĐTĐM — <span style={{ color: "var(--amber)" }}>{weekKey}</span>
        </h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
          Kỳ trước:
          <input value={prevLabel} onChange={(e) => setPrevLabel(e.target.value)} style={{ width: 90, fontSize: 11, padding: "2px 6px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)" }} />
          Kỳ này:
          <input value={currLabel} onChange={(e) => setCurrLabel(e.target.value)} style={{ width: 90, fontSize: 11, padding: "2px 6px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)" }} />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={saveToBlob} disabled={saving} style={{ ...btnBase, background: saving ? "var(--border)" : "var(--amber)", color: saving ? "var(--text-muted)" : "#fff" }}>
            {saving ? "Đang lưu..." : saved ? "✓ Đã lưu" : "💾 Lưu báo cáo"}
          </button>
          <button onClick={copyZalo} style={{ ...btnBase, background: copied ? "var(--green)" : "var(--surface-1, var(--bg-panel))", color: copied ? "#fff" : "var(--text-primary)", border: "1px solid var(--border)" }}>
            {copied ? "✓ Đã copy!" : "📋 Copy Zalo"}
          </button>
        </div>
      </div>

      {/* ── 1. Bảng đối soát ───────────────────────────────────── */}
      <div style={panel}>
        <SectionHeader title="Bảng đối soát LTL / FTL" weekLabel={`${prevLabel} vs ${currLabel}`} />
        <CompMatrix matrix={matrix} setMatrix={setMatrix} prevLabel={prevLabel} currLabel={currLabel} apiData={apiData} apiLoading={apiLoading} />
      </div>

      {/* ── 2. Điều tra case thực tế ───────────────────────────── */}
      <div style={panel}>
        <SectionHeader title={`Điều tra Case — ${currLabel}`} onAdd={null} />
        <CaseList cases={cases} setCases={setCases} />
      </div>

      {/* ── 3. Phân công PIC ───────────────────────────────────── */}
      <div style={panel}>
        <SectionHeader title={`Giao việc tuần mới — ${currLabel}`} />
        <PICTaskBoard tasks={tasks} setTasks={setTasks} />
      </div>

      {/* ── 4. Pipeline dự án mới ──────────────────────────────── */}
      <div style={panel}>
        <SectionHeader title="Dự án mới — Pipeline" onAdd={null} />
        <NewProjectPipeline pipeline={pipeline} setPipeline={setPipeline} />
      </div>

      {/* ── Footer info ────────────────────────────────────────── */}
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", textAlign: "center", marginTop: 8 }}>
        Dữ liệu tự động lưu vào localStorage · Nhấn "Lưu báo cáo" để đồng bộ lên Cloud · {blobLoaded ? "☁ Đã đồng bộ" : "Chưa tải từ cloud"}
      </div>
    </div>
  );
}
