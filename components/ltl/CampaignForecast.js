/**
 * components/ltl/CampaignForecast.js — "📅 Sự kiện" tab (v3)
 * Lịch event ecommerce cố định theo tháng + cửa sổ 3 ngày (D-1/D0/D+1)
 * với số đơn và tấn. Bảng chi tiết theo dự án trong mỗi card, bảng xu
 * hướng tăng trưởng dự án qua các event liên tiếp.
 */
import { useState, useEffect, useMemo, useCallback } from "react";

// ─── helpers ────────────────────────────────────────────────────────────────
const LS_KEY = "ltl_campaign_custom_v2";
const n = (v, d = 0) =>
  v == null ? "—" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d });
const ton = (kg, prefix = "") =>
  kg > 0
    ? `${prefix}${(kg / 1000).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tấn`
    : "—";
const fmtDd   = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const fmtMMYY = (iso) => (iso ? `T${parseInt(iso.slice(5, 7), 10)}/${iso.slice(2, 4)}` : "—");
const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso, delta) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const pct = (v) => {
  if (v == null || !isFinite(v)) return "—";
  const s = (v * 100).toFixed(0);
  return v >= 0 ? `+${s}%` : `${s}%`;
};

// ─── Ecommerce event calendar ────────────────────────────────────────────────
const ECOM_CALENDAR = {
  "01": [{ day: 1,  name: "1.1 Sale"    }, { day: 15, name: "15/1"   }, { day: 25, name: "25/1"   }],
  "02": [{ day: 14, name: "Valentine"   }, { day: 20, name: "20/2"   }, { day: 25, name: "25/2"   }],
  "03": [{ day: 8,  name: "8/3"         }, { day: 15, name: "15/3"   }, { day: 25, name: "25/3"   }],
  "04": [{ day: 15, name: "15/4"        }, { day: 20, name: "20/4"   }, { day: 25, name: "25/4"   }],
  "05": [{ day: 10, name: "10/5"        }, { day: 15, name: "15/5"   }, { day: 25, name: "25/5"   }],
  "06": [{ day: 6,  name: "6.6 Sale"    }, { day: 15, name: "15/6"   }, { day: 25, name: "25/6"   }],
  "07": [{ day: 15, name: "15/7"        }, { day: 20, name: "20/7"   }, { day: 25, name: "25/7"   }],
  "08": [{ day: 8,  name: "8.8 Sale"    }, { day: 15, name: "15/8"   }, { day: 25, name: "25/8"   }],
  "09": [{ day: 9,  name: "9.9 Sale"    }, { day: 15, name: "15/9"   }, { day: 25, name: "25/9"   }],
  "10": [{ day: 10, name: "10.10 Sale"  }, { day: 15, name: "15/10"  }, { day: 25, name: "25/10"  }],
  "11": [{ day: 11, name: "11.11 Sale"  }, { day: 15, name: "15/11"  }, { day: 25, name: "25/11"  }],
  "12": [{ day: 12, name: "12.12 Sale"  }, { day: 15, name: "15/12"  }, { day: 25, name: "25/12"  }],
};

function eventsOfYM(ym) {
  const [year, mm] = ym.split("-");
  return (ECOM_CALENDAR[mm] || []).map(({ day, name }, idx) => ({
    date: `${year}-${mm}-${String(day).padStart(2, "0")}`,
    name,
    isCustom: false,
    slot: idx,
  }));
}

// Tổng hợp đơn + tấn 3 ngày theo tỉnh
function mergeProvinceWindow(dm1, d0, dp1, byProvinceAndDay, weightByProvinceAndDay) {
  const orders = {}, weight = {};
  for (const d of [dm1, d0, dp1]) {
    for (const [prov, cnt] of Object.entries((byProvinceAndDay || {})[d] || {})) {
      orders[prov] = (orders[prov] || 0) + cnt;
    }
    for (const [prov, kg] of Object.entries((weightByProvinceAndDay || {})[d] || {})) {
      weight[prov] = (weight[prov] || 0) + kg;
    }
  }
  return Object.entries(orders)
    .map(([prov, cnt]) => ({ prov, orders: cnt, weight: weight[prov] || 0 }))
    .sort((a, b) => b.orders - a.orders);
}

// Tổng hợp số đơn 3 ngày theo client
function mergeClientWindow(dm1, d0, dp1, byClientAndDay) {
  const map = {};
  for (const [d, slot] of [[dm1, "dm1"], [d0, "d0"], [dp1, "dp1"]]) {
    for (const [cl, cnt] of Object.entries(byClientAndDay[d] || {})) {
      if (!map[cl]) map[cl] = { dm1: 0, d0: 0, dp1: 0 };
      map[cl][slot] = (map[cl][slot] || 0) + cnt;
    }
  }
  return Object.fromEntries(
    Object.entries(map).map(([cl, v]) => [cl, { ...v, total: v.dm1 + v.d0 + v.dp1 }])
  );
}

// ─── ProvinceBreakdown (bảng tỉnh thành trong từng card) ────────────────────
function ProvinceBreakdown({ date, byProvinceAndDay, weightByProvinceAndDay, topN = 15 }) {
  const dm1 = addDays(date, -1), dp1 = addDays(date, 1);
  const rows = useMemo(
    () => mergeProvinceWindow(dm1, date, dp1, byProvinceAndDay, weightByProvinceAndDay).slice(0, topN),
    [dm1, date, dp1, byProvinceAndDay, weightByProvinceAndDay]
  );
  const tdS = { padding: "5px 8px", fontSize: 11.5, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  if (!rows.length) return <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>Không có dữ liệu tỉnh thành.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 220 }}>
        <thead>
          <tr>
            {["Tỉnh thành", "Đơn", "Tấn"].map((h, i) => (
              <th key={i} style={{ ...tdS, fontWeight: 700, fontSize: 10.5, color: "var(--text-secondary)", textAlign: i > 0 ? "right" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.prov}>
              <td style={tdS}>{r.prov}</td>
              <td style={{ ...tdS, textAlign: "right", fontWeight: 600 }}>{n(r.orders)}</td>
              <td style={{ ...tdS, textAlign: "right", color: "var(--text-muted)" }}>{ton(r.weight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── KhoLayBreakdown (bảng kho lấy trong từng card) ─────────────────────────
function KhoLayBreakdown({ date, byKhoLayAndDay, overrideRows, topN = 15 }) {
  const dm1 = addDays(date, -1), dp1 = addDays(date, 1);
  const rows = useMemo(() => {
    if (overrideRows) return overrideRows.slice(0, topN);
    const map = {};
    for (const d of [dm1, date, dp1]) {
      for (const [kho, cnt] of Object.entries((byKhoLayAndDay || {})[d] || {})) {
        map[kho] = (map[kho] || 0) + cnt;
      }
    }
    return Object.entries(map)
      .map(([kho, orders]) => ({ kho, orders }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, topN);
  }, [dm1, date, dp1, byKhoLayAndDay, overrideRows]);
  const tdS = { padding: "5px 8px", fontSize: 11.5, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  if (!rows.length) return <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>Không có dữ liệu kho lấy.</div>;
  const total = rows.reduce((s, r) => s + r.orders, 0);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 200 }}>
        <thead>
          <tr>
            {["Kho lấy", "Đơn", "%"].map((h, i) => (
              <th key={i} style={{ ...tdS, fontWeight: 700, fontSize: 10.5, color: "var(--text-secondary)", textAlign: i > 0 ? "right" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kho}>
              <td style={tdS}>{r.kho}</td>
              <td style={{ ...tdS, textAlign: "right", fontWeight: 600 }}>{n(r.orders)}</td>
              <td style={{ ...tdS, textAlign: "right", color: "var(--text-muted)" }}>{total > 0 ? `${((r.orders / total) * 100).toFixed(0)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ProjectBreakdown (bảng dự án trong từng card) ──────────────────────────
function ProjectBreakdown({ date, byClientAndDay, isFuture, forecastByClient }) {
  const dm1 = addDays(date, -1);
  const dp1 = addDays(date, 1);

  const rows = useMemo(() => {
    if (isFuture) {
      // forecast: aggregated across all event types — show total per client
      if (!forecastByClient) return [];
      return Object.entries(forecastByClient)
        .map(([name, v]) => ({ name, dm1: v.dm1, d0: v.d0, dp1: v.dp1, total: v.total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
    }
    const merged = mergeClientWindow(dm1, date, dp1, byClientAndDay);
    return Object.entries(merged)
      .map(([name, v]) => ({ name, dm1: v.dm1, d0: v.d0, dp1: v.dp1, total: v.total }))
      .sort((a, b) => b.total - a.total)
      .filter((r) => r.total > 0);
  }, [date, byClientAndDay, isFuture, forecastByClient]);

  if (!rows.length) return (
    <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>Không có dữ liệu.</div>
  );

  const tdS = { padding: "5px 8px", fontSize: 11.5, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 280 }}>
        <thead>
          <tr>
            {["Dự án", "D-1", "D0 ⭐", "D+1", "Tổng"].map((h, i) => (
              <th key={i} style={{ ...tdS, fontWeight: 700, fontSize: 10.5, color: "var(--text-secondary)", textAlign: i > 0 ? "right" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={{ ...tdS, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</td>
              <td style={{ ...tdS, textAlign: "right", color: "var(--text-muted)" }}>{r.dm1 || "—"}</td>
              <td style={{ ...tdS, textAlign: "right", fontWeight: 700, color: "var(--amber)" }}>{r.d0 || "—"}</td>
              <td style={{ ...tdS, textAlign: "right", color: "var(--text-muted)" }}>{r.dp1 || "—"}</td>
              <td style={{ ...tdS, textAlign: "right", fontWeight: 700 }}>{n(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── DayCol ──────────────────────────────────────────────────────────────────
function DayCol({ label, date, orders, weightKg, maxOrders, isPeak, isFuture }) {
  const barH = maxOrders > 0 ? Math.min(100, (orders / maxOrders) * 100) : 0;
  const clr = isPeak ? "var(--amber)" : "var(--cyan)";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: isPeak ? 700 : 400, color: isPeak ? "var(--amber)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{fmtDd(date)}</div>
      <div style={{ width: "68%", height: 44, display: "flex", alignItems: "flex-end" }}>
        <div style={{
          width: "100%", height: isFuture ? "55%" : `${Math.max(barH, orders > 0 ? 4 : 0)}%`,
          borderRadius: "2px 2px 0 0",
          background: isFuture ? "transparent" : clr,
          border: isFuture ? `1.5px dashed ${clr}` : "none",
          opacity: isFuture ? 0.65 : 1, minHeight: 0,
        }} />
      </div>
      <div style={{ fontSize: isPeak ? 15 : 13, fontWeight: 700, color: isFuture ? "var(--text-muted)" : isPeak ? "var(--amber)" : "var(--text-primary)" }}>
        {orders > 0 ? `${isFuture ? "~" : ""}${n(orders)}` : "—"}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
        {weightKg > 0 ? ton(weightKg, isFuture ? "~" : "") : "—"}
      </div>
    </div>
  );
}

// ─── EventCard ───────────────────────────────────────────────────────────────
function EventCard({ event, byDay, weightByDay, byClientAndDay, byProvinceAndDay, weightByProvinceAndDay, byKhoLayAndDay, forecastBaseline, normalStats, today, growthRateO, fcSnapshot, onChot, provinceForecast, khoLayForecast }) {
  const [showProjects, setShowProjects] = useState(false);
  const [showProvince, setShowProvince] = useState(false);
  const [showKhoLay, setShowKhoLay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { date, name, isCustom } = event;
  const dm1 = addDays(date, -1);
  const dp1 = addDays(date, 1);
  const isFuture = date > today;

  const actual = {
    dm1: { orders: byDay[dm1] || 0,   weight: weightByDay[dm1] || 0   },
    d0:  { orders: byDay[date] || 0,  weight: weightByDay[date] || 0  },
    dp1: { orders: byDay[dp1] || 0,   weight: weightByDay[dp1] || 0   },
  };
  const fc = forecastBaseline;
  const forecast = fc
    ? { dm1: { orders: fc.dm1O, weight: fc.dm1W }, d0: { orders: fc.d0O, weight: fc.d0W }, dp1: { orders: fc.dp1O, weight: fc.dp1W } }
    : { dm1: { orders: 0, weight: 0 }, d0: { orders: 0, weight: 0 }, dp1: { orders: 0, weight: 0 } };

  const days = isFuture ? forecast : actual;
  const hasData = !isFuture && (actual.d0.orders > 0 || actual.dm1.orders > 0 || actual.dp1.orders > 0);

  const totO = days.dm1.orders + days.d0.orders + days.dp1.orders;
  const totW = days.dm1.weight + days.d0.weight + days.dp1.weight;
  const maxO = Math.max(days.dm1.orders, days.d0.orders, days.dp1.orders, 1);
  const spikeRatio = normalStats.orders > 0 && totO > 0 ? totO / (normalStats.orders * 3) : null;

  // Forecast per-client breakdown from baseline avg
  const forecastByClient = useMemo(() => {
    if (!isFuture || !fc?.clientAvg) return null;
    return fc.clientAvg;
  }, [isFuture, fc]);

  return (
    <div style={{ background: "var(--bg-panel)", border: `1px solid ${isFuture ? "var(--amber)" : hasData ? "var(--green)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "7px 12px", borderBottom: "1px solid var(--border)", background: isFuture ? "rgba(251,191,36,0.06)" : "transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: isFuture ? "var(--amber)" : "var(--text-primary)" }}>
          🛒 {name}{isCustom ? " ✎" : ""}
        </span>
        <span style={{ fontSize: 10, color: isFuture ? "var(--amber)" : hasData ? "var(--green)" : "var(--text-muted)" }}>
          {isFuture ? "⏳ Sắp tới" : hasData ? "✓ Đã qua" : "? Không có data"}
        </span>
      </div>

      {/* 3-day columns */}
      <div style={{ display: "flex", padding: "10px 6px 6px", gap: 2 }}>
        <DayCol label="D-1" date={dm1} orders={days.dm1.orders} weightKg={days.dm1.weight} maxOrders={maxO} isPeak={false} isFuture={isFuture} />
        <div style={{ width: 1, background: "var(--border)", margin: "4px 0" }} />
        <DayCol label="D0 ⭐" date={date} orders={days.d0.orders} weightKg={days.d0.weight} maxOrders={maxO} isPeak={true} isFuture={isFuture} />
        <div style={{ width: 1, background: "var(--border)", margin: "4px 0" }} />
        <DayCol label="D+1" date={dp1} orders={days.dp1.orders} weightKg={days.dp1.weight} maxOrders={maxO} isPeak={false} isFuture={isFuture} />
      </div>

      {/* Footer */}
      <div style={{ padding: "5px 12px 4px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{isFuture ? "~" : ""}{n(totO)} đơn</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ton(totW, isFuture ? "~" : "")}</span>
        {isFuture && growthRateO != null ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: growthRateO >= 0 ? "var(--green)" : "var(--red)" }}>
            {pct(growthRateO)} so kỳ trước
          </span>
        ) : spikeRatio != null ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: spikeRatio >= 1.5 ? "var(--red)" : spikeRatio >= 1.1 ? "var(--amber)" : "var(--text-muted)" }}>
            {spikeRatio.toFixed(1).replace(".", ",")}× TB
          </span>
        ) : null}
      </div>

      {/* Chốt FC (future) / Accuracy (past) */}
      {isFuture && fc && (
        <div style={{ padding: "5px 12px 6px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          {saved || fcSnapshot ? (
            <span style={{ fontSize: 10.5, color: "var(--green)" }}>
              ✓ Đã chốt FC: ~{n(fcSnapshot ? fcSnapshot.dm1O + fcSnapshot.d0O + fcSnapshot.dp1O : totO)} đơn
              {fcSnapshot?.savedAt ? ` · ${new Date(fcSnapshot.savedAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
          ) : (
            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onChot?.({ date, dm1O: days.dm1.orders, d0O: days.d0.orders, dp1O: days.dp1.orders, dm1W: days.dm1.weight, d0W: days.d0.weight, dp1W: days.dp1.weight, clientAvg: fc.clientAvg || {} });
                  setSaved(true);
                } finally { setSaving(false); }
              }}
              style={{ fontSize: 10.5, padding: "2px 10px", background: "rgba(251,191,36,0.12)", border: "1px solid var(--amber)", borderRadius: 4, cursor: saving ? "not-allowed" : "pointer", color: "var(--amber)", fontFamily: "inherit" }}>
              {saving ? "Đang lưu..." : "💾 Chốt FC"}
            </button>
          )}
        </div>
      )}
      {!isFuture && hasData && fcSnapshot && (() => {
        const fcTotal = fcSnapshot.dm1O + fcSnapshot.d0O + fcSnapshot.dp1O;
        const actualTotal = totO;
        const err = fcTotal > 0 ? (actualTotal - fcTotal) / fcTotal : null;
        const errClr = err == null ? "var(--text-muted)" : Math.abs(err) <= 0.1 ? "var(--green)" : Math.abs(err) <= 0.25 ? "var(--amber)" : "var(--red)";
        return (
          <div style={{ padding: "5px 12px 6px", borderTop: "1px solid var(--border)", fontSize: 10.5, color: "var(--text-muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>FC đã chốt: ~{n(fcTotal)}</span>
            <span>Actual: {n(actualTotal)}</span>
            {err != null && <span style={{ fontWeight: 700, color: errClr }}>Lệch: {err >= 0 ? "+" : ""}{(err * 100).toFixed(1)}%</span>}
          </div>
        );
      })()}

      {/* Toggles: dự án + tỉnh thành */}
      {(hasData || (isFuture && fc)) && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setShowProjects((v) => !v)} style={{
            width: "100%", padding: "5px 12px", background: "none", border: "none", cursor: "pointer",
            fontSize: 11, color: "var(--text-muted)", textAlign: "left", fontFamily: "inherit",
          }}>
            {showProjects ? "▲ Ẩn theo dự án" : "▼ Xem theo dự án"}
          </button>
          {showProjects && (
            <div style={{ padding: "0 8px 8px" }}>
              <ProjectBreakdown date={date} byClientAndDay={byClientAndDay} isFuture={isFuture} forecastByClient={forecastByClient} />
            </div>
          )}
        </div>
      )}
      {hasData && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setShowProvince((v) => !v)} style={{
            width: "100%", padding: "5px 12px", background: "none", border: "none", cursor: "pointer",
            fontSize: 11, color: "var(--text-muted)", textAlign: "left", fontFamily: "inherit",
          }}>
            {showProvince ? "▲ Ẩn theo tỉnh thành" : "▼ Xem theo tỉnh thành"}
          </button>
          {showProvince && (
            <div style={{ padding: "0 8px 8px" }}>
              <ProvinceBreakdown date={date} byProvinceAndDay={byProvinceAndDay} weightByProvinceAndDay={weightByProvinceAndDay} />
            </div>
          )}
        </div>
      )}
      {(hasData || (isFuture && khoLayForecast && Object.keys(khoLayForecast).length > 0)) && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setShowKhoLay((v) => !v)} style={{
            width: "100%", padding: "5px 12px", background: "none", border: "none", cursor: "pointer",
            fontSize: 11, color: "var(--text-muted)", textAlign: "left", fontFamily: "inherit",
          }}>
            {showKhoLay ? "▲ Ẩn theo kho lấy" : `▼ Xem theo kho lấy${isFuture ? " (lịch sử)" : ""}`}
          </button>
          {showKhoLay && (
            <div style={{ padding: "0 8px 8px" }}>
              {isFuture && khoLayForecast
                ? <KhoLayBreakdown date={date} overrideRows={Object.entries(khoLayForecast).map(([kho, orders]) => ({ kho, orders })).sort((a, b) => b.orders - a.orders)} />
                : <KhoLayBreakdown date={date} byKhoLayAndDay={byKhoLayAndDay} />
              }
            </div>
          )}
        </div>
      )}
      {/* Dự báo tỉnh thành — chỉ hiện khi event sắp tới và có dữ liệu lịch sử */}
      {isFuture && provinceForecast && Object.keys(provinceForecast).length > 0 && (() => {
        const top5 = Object.entries(provinceForecast)
          .filter(([, v]) => v.fcOrders > 0)
          .sort(([, a], [, b]) => b.fcOrders - a.fcOrders)
          .slice(0, 5);
        if (!top5.length) return null;
        return (
          <div style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={() => setShowProvince((v) => !v)} style={{
              width: "100%", padding: "5px 12px", background: "none", border: "none", cursor: "pointer",
              fontSize: 11, color: "var(--text-muted)", textAlign: "left", fontFamily: "inherit",
            }}>
              {showProvince ? "▲ Ẩn dự báo tỉnh thành" : "▼ Dự báo tỉnh thành (top 5)"}
            </button>
            {showProvince && (
              <div style={{ padding: "0 8px 8px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      {["Tỉnh", "T9 (thực)", "T10 (DB)", "Tăng"].map((h, i) => (
                        <th key={i} style={{ padding: "4px 6px", fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {top5.map(([prov, v]) => (
                      <tr key={prov}>
                        <td style={{ padding: "4px 6px", fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={prov}>{prov}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-muted)" }}>{n(v.lastOrders)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: "var(--amber)" }}>~{n(v.fcOrders)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 10, fontWeight: 600, color: v.growthRate >= 0 ? "var(--green)" : "var(--red)" }}>
                          {v.growthRate >= 0 ? "+" : ""}{(v.growthRate * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── GrowthTrendTable ────────────────────────────────────────────────────────
const SLOT_META = {
  0: { label: "Sự kiện đầu tháng (ngày đôi)", icon: "🔥" },
  1: { label: "Giữa tháng (ngày 15)",          icon: "📆" },
  2: { label: "Cuối tháng (ngày 25)",           icon: "📆" },
};

function SlotTable({ slotKey, eventsForSlot, forecast, byClientAndDay }) {
  const [showAll, setShowAll] = useState(false);
  const growthRate = (a, b) => (a > 0 ? (b - a) / a : null);
  const gClr = (r) => r == null ? "var(--text-muted)" : r > 0 ? "var(--green)" : r < 0 ? "var(--red)" : "var(--text-muted)";
  const thS = { padding: "7px 8px", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", textAlign: "right" };
  const tdS = (isFc) => ({ padding: "6px 8px", fontSize: 12, textAlign: "right", borderBottom: "1px solid var(--border)", color: isFc ? "var(--amber)" : "var(--text-primary)", whiteSpace: "nowrap" });

  const sorted = [...eventsForSlot].sort((a, b) => a.date.localeCompare(b.date));
  const recent = showAll ? sorted : sorted.slice(-3); // mặc định 3 kỳ gần nhất

  const eventCols = recent.map((ev) => ({
    label: fmtDd(ev.date),
    name: ev.name,
    isForecast: false,
    clientTotals: mergeClientWindow(ev.dm1, ev.date, ev.dp1, byClientAndDay),
    grandTotal: ev.totalO,
  }));

  const fcCol = forecast?.clientAvg
    ? {
        label: "⏳ Dự báo",
        name: `TB ${forecast.count} event`,
        isForecast: true,
        clientTotals: Object.fromEntries(
          Object.entries(forecast.clientAvg).map(([cl, v]) => [cl, { total: v.total }])
        ),
        grandTotal: forecast.dm1O + forecast.d0O + forecast.dp1O,
      }
    : null;

  const allCols = fcCol ? [...eventCols, fcCol] : eventCols;

  const allClients = [...new Set(eventCols.flatMap((col) => Object.keys(col.clientTotals)))]
    .sort((a, b) => {
      const ta = eventCols[eventCols.length - 1]?.clientTotals[a]?.total || 0;
      const tb = eventCols[eventCols.length - 1]?.clientTotals[b]?.total || 0;
      return tb - ta;
    });

  if (!allClients.length) return null;
  const meta = SLOT_META[slotKey] || { label: `Nhóm ${slotKey}`, icon: "📆" };

  return (
    <div className="chart-panel" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px" }}>
        <span className="chart-panel-title" style={{ margin: 0, padding: 0 }}>{meta.icon} {meta.label}</span>
        {sorted.length > 3 && (
          <button onClick={() => setShowAll((v) => !v)} style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer",
            fontSize: 10.5, color: "var(--text-muted)", padding: "2px 8px", fontFamily: "inherit",
          }}>
            {showAll ? "▲ Thu gọn" : `▼ Xem thêm (${sorted.length - 3} kỳ cũ hơn)`}
          </button>
        )}
      </div>
      <div style={{ overflowX: "auto", padding: "0 8px 12px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: "left", minWidth: 130 }}>Dự án</th>
              {allCols.map((col, i) => (
                <th key={i} style={{ ...thS, color: col.isForecast ? "var(--amber)" : "var(--text-secondary)" }}>
                  {col.label}
                  <div style={{ fontSize: 9.5, fontWeight: 400, color: "var(--text-muted)" }}>{col.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allClients.map((cl) => {
              const vals = allCols.map((col) => col.clientTotals[cl]?.total || 0);
              const prevLast = vals.length >= 2 ? vals[vals.length - 2] : null;
              const last = vals[vals.length - 1];
              const gr = fcCol ? null : growthRate(prevLast, last);
              return (
                <tr key={cl}>
                  <td style={{ ...tdS(false), textAlign: "left", fontWeight: 600, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }} title={cl}>{cl}</td>
                  {vals.map((v, i) => {
                    const isFc = allCols[i]?.isForecast;
                    const prevV = i > 0 ? vals[i - 1] : null;
                    const cellGr = isFc ? growthRate(prevV, v) : null;
                    return (
                      <td key={i} style={tdS(isFc)}>
                        {isFc ? (v > 0 ? `~${n(v)}` : "—") : (v > 0 ? n(v) : "—")}
                        {cellGr != null && v > 0 && (
                          <span style={{ fontSize: 9.5, fontWeight: 600, color: gClr(cellGr), marginLeft: 3 }}>{pct(cellGr)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Total row */}
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <td style={{ ...tdS(false), textAlign: "left", fontWeight: 800 }}>Tổng</td>
              {allCols.map((col, i) => {
                const prev = i > 0 ? allCols[i - 1].grandTotal : null;
                const gr = growthRate(prev, col.grandTotal);
                return (
                  <td key={i} style={{ ...tdS(col.isForecast), fontWeight: 800 }}>
                    {col.isForecast ? `~${n(col.grandTotal)}` : n(col.grandTotal)}
                    {gr != null && col.grandTotal > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: gClr(gr), marginLeft: 4 }}>{pct(gr)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrowthTrendTable({ pastWindows, forecastBySlot, byClientAndDay }) {
  const bySlot = useMemo(() => {
    const map = {};
    for (const ev of pastWindows) {
      const s = ev.slot ?? 0;
      if (!map[s]) map[s] = [];
      map[s].push(ev);
    }
    return map;
  }, [pastWindows]);

  const slots = Object.keys(bySlot).sort();
  if (!slots.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", paddingLeft: 2 }}>
        📈 Xu hướng tăng trưởng theo dự án
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8 }}>
        Tổng đơn 3 ngày (D-1+D0+D+1) mỗi event · dự báo = kỳ trước × (1 + % tăng trưởng kỳ cuối)
      </div>
      {slots.map((s) => (
        <SlotTable
          key={s}
          slotKey={s}
          eventsForSlot={bySlot[s]}
          forecast={forecastBySlot?.[s]}
          byClientAndDay={byClientAndDay}
        />
      ))}
    </div>
  );
}

// ─── Excel export ────────────────────────────────────────────────────────────
async function exportToExcel({ selectedYM, eventsForMonth, byDay, weightByDay, byClientAndDay, byProvinceAndDay, weightByProvinceAndDay, pastWindows, forecastBySlot, provincesForecastBySlot, normalStats, today, forecastBaseline }) {
  const XLSX = (await import("xlsx")).default || (await import("xlsx"));
  const wb = XLSX.utils.book_new();
  const mmLabel = `T${parseInt(selectedYM.slice(5, 7), 10)}-${selectedYM.slice(0, 4)}`;

  // ── Sheet 1: Dự báo tháng ──
  const fcastRows = [["Sự kiện", "Ngày D0", "D-1 (đơn)", "D0 (đơn)", "D+1 (đơn)", "Tổng đơn", "Tổng tấn", "Spike"]];
  for (const ev of eventsForMonth) {
    const dm1 = addDays(ev.date, -1), dp1 = addDays(ev.date, 1);
    const isFut = ev.date > today;
    const fc = isFut ? (forecastBySlot[ev.slot ?? 0] ?? forecastBaseline) : null;
    const dm1O = isFut ? (fc?.dm1O ?? 0) : (byDay[dm1] || 0);
    const d0O  = isFut ? (fc?.d0O  ?? 0) : (byDay[ev.date] || 0);
    const dp1O = isFut ? (fc?.dp1O ?? 0) : (byDay[dp1] || 0);
    const dm1W = isFut ? (fc?.dm1W ?? 0) : (weightByDay[dm1] || 0);
    const d0W  = isFut ? (fc?.d0W  ?? 0) : (weightByDay[ev.date] || 0);
    const dp1W = isFut ? (fc?.dp1W ?? 0) : (weightByDay[dp1] || 0);
    const totO = dm1O + d0O + dp1O;
    const totW = Number(((dm1W + d0W + dp1W) / 1000).toFixed(2));
    const spike = normalStats.orders > 0 && totO > 0 ? Number((totO / (normalStats.orders * 3)).toFixed(2)) : "";
    fcastRows.push([`${isFut ? "[DB] " : ""}${ev.name}`, ev.date, dm1O, d0O, dp1O, totO, totW, spike]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fcastRows), `Dự báo ${mmLabel}`);

  // ── Sheet 2-4: Xu hướng từng slot ──
  const slotNames = { 0: "XH-Ngày đôi", 1: "XH-Giữa tháng", 2: "XH-Cuối tháng" };
  const bySlotMap = {};
  for (const ev of pastWindows) { const s = ev.slot ?? 0; if (!bySlotMap[s]) bySlotMap[s] = []; bySlotMap[s].push(ev); }
  for (const [sKey, evs] of Object.entries(bySlotMap)) {
    const recent = [...evs].sort((a, b) => a.date.localeCompare(b.date)).slice(-4);
    const fc = forecastBySlot[sKey];
    const eventCols = recent.map((ev) => ({ label: `${fmtDd(ev.date)} ${ev.name}`, totals: mergeClientWindow(ev.dm1, ev.date, ev.dp1, byClientAndDay) }));
    const clients = [...new Set(eventCols.flatMap((c) => Object.keys(c.totals)))].sort((a, b) => {
      return (eventCols[eventCols.length-1]?.totals[b]?.total || 0) - (eventCols[eventCols.length-1]?.totals[a]?.total || 0);
    });
    const header = ["Dự án", ...eventCols.map((c) => c.label), fc ? `[DỰ BÁO] TB ${fc.count} event` : ""];
    const rows = [header];
    for (const cl of clients) {
      rows.push([cl, ...eventCols.map((c) => c.totals[cl]?.total || 0), fc?.clientAvg?.[cl]?.total ?? ""]);
    }
    const grandTotals = eventCols.map((c) => Object.values(c.totals).reduce((s, v) => s + v.total, 0));
    rows.push(["TỔNG", ...grandTotals, fc ? (fc.dm1O + fc.d0O + fc.dp1O) : ""]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), slotNames[sKey] || `XH-${sKey}`);
  }

  // ── Sheet 5: Tỉnh thành (tất cả event đã qua trong tháng) ──
  const provHeader = ["Sự kiện", "Ngày D0", "Tỉnh thành", "Đơn (3 ngày)", "Tấn (3 ngày)"];
  const provRows = [provHeader];
  for (const ev of eventsForMonth.filter((e) => e.date <= today)) {
    const provData = mergeProvinceWindow(addDays(ev.date, -1), ev.date, addDays(ev.date, 1), byProvinceAndDay, weightByProvinceAndDay);
    for (const p of provData) {
      provRows.push([ev.name, ev.date, p.prov, p.orders, Number((p.weight / 1000).toFixed(2))]);
    }
  }
  if (provRows.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(provRows), "Tỉnh thành");

  // ── Sheet 6: Dự báo tỉnh thành theo slot ──
  if (provincesForecastBySlot && Object.keys(provincesForecastBySlot).length > 0) {
    const slotLabels = { 0: "Ngày đôi", 1: "Giữa tháng", 2: "Cuối tháng" };
    const dbProvRows = [["Nhóm sự kiện", "Tỉnh thành", "Kỳ trước (đơn)", "Kỳ trước (tấn)", "Dự báo (đơn)", "Dự báo (tấn)", "Tăng trưởng %"]];
    for (const [s, forecasts] of Object.entries(provincesForecastBySlot).sort()) {
      const top15 = Object.entries(forecasts)
        .filter(([, v]) => v.fcOrders > 0)
        .sort(([, a], [, b]) => b.fcOrders - a.fcOrders)
        .slice(0, 15);
      for (const [prov, v] of top15) {
        dbProvRows.push([
          slotLabels[s] || `Slot ${s}`,
          prov,
          v.lastOrders,
          Number((v.lastWeight / 1000).toFixed(2)),
          v.fcOrders,
          Number((v.fcWeight / 1000).toFixed(2)),
          Number((v.growthRate * 100).toFixed(1)),
        ]);
      }
      // Dòng tổng per slot
      const totalLast = top15.reduce((sum, [, v]) => sum + v.lastOrders, 0);
      const totalFc   = top15.reduce((sum, [, v]) => sum + v.fcOrders, 0);
      dbProvRows.push([`  TỔNG ${slotLabels[s] || s}`, "", totalLast, "", totalFc, "", ""]);
      dbProvRows.push(["", "", "", "", "", "", ""]); // blank row
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dbProvRows), "DB-Tỉnh thành");
  }

  XLSX.writeFile(wb, `SuKien_${mmLabel}.xlsx`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function CampaignForecast({ dailyOrders = {} }) {
  const { byDay = {}, weightByDay = {}, byClientAndDay = {}, byProvinceAndDay = {}, weightByProvinceAndDay = {}, byKhoLayAndDay = {} } = dailyOrders;

  const [customEvents, setCustomEvents] = useState([]);
  const [newDate, setNewDate]           = useState("");
  const [newLabel, setNewLabel]         = useState("");
  const [showCustom, setShowCustom]     = useState(false);

  const today  = useMemo(() => vnToday(), []);
  const curYM  = today.slice(0, 7);

  const [selectedYM, setSelectedYM] = useState(() => curYM);
  const [selectedEventDate, setSelectedEventDate] = useState(null); // null = auto-detect từ today
  const [fcSnapshots, setFcSnapshots] = useState({});

  useEffect(() => {
    try { setCustomEvents(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); } catch {}
  }, []);

  // Load tất cả FC snapshots đã chốt
  useEffect(() => {
    fetch("/api/fc-snapshot")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setFcSnapshots(d.snapshots || {}); })
      .catch(() => {});
  }, []);

  const handleChotFc = useCallback(async (payload) => {
    const res = await fetch("/api/fc-snapshot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const saved = { ...payload, savedAt: new Date().toISOString() };
      setFcSnapshots((prev) => ({ ...prev, [payload.date]: saved }));
    }
  }, []);

  // Month tabs — ẩn tháng đã qua có quá ít đơn trong event window (< 300 tổng)
  const monthOptions = useMemo(() => {
    const s = new Set(Object.keys(byDay).map((d) => d.slice(0, 7)));
    s.add(curYM);
    const [y, m] = curYM.split("-").map(Number);
    s.add(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`);
    const MIN_EVENT_ORDERS = 500;
    return [...s].sort().filter((ym) => {
      if (ym >= curYM) return true; // tháng hiện tại + tương lai: luôn hiển thị
      const [yy, mm] = ym.split("-");
      const days = ECOM_CALENDAR[mm] || [];
      let total = 0;
      for (const { day } of days) {
        const d0 = `${yy}-${mm}-${String(day).padStart(2, "0")}`;
        for (const delta of [-1, 0, 1]) total += byDay[addDays(d0, delta)] || 0;
      }
      return total >= MIN_EVENT_ORDERS;
    });
  }, [byDay, curYM]);

  // Events for selected month
  const eventsForMonth = useMemo(() => {
    const preset = eventsOfYM(selectedYM);
    const custom = customEvents
      .filter((c) => c.date.slice(0, 7) === selectedYM)
      .map((c) => ({ date: c.date, name: c.name || c.label || c.date, isCustom: true }));
    return [...preset, ...custom].sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedYM, customEvents]);

  // Event đang active: event nào có today trong cửa sổ D-1/D0/D+1, hoặc event gần nhất sắp tới, hoặc event cuối cùng trong tháng
  const activeEventDate = useMemo(() => {
    // Chỉ dùng selectedEventDate nếu nó thuộc tháng đang xem
    if (selectedEventDate && eventsForMonth.some((e) => e.date === selectedEventDate)) return selectedEventDate;
    // Ưu tiên event đang trong cửa sổ 3 ngày
    for (const ev of eventsForMonth) {
      if (today >= addDays(ev.date, -1) && today <= addDays(ev.date, 1)) return ev.date;
    }
    // Tiếp theo: event sắp tới gần nhất
    for (const ev of eventsForMonth) {
      if (ev.date > today) return ev.date;
    }
    // Fallback: event gần nhất đã qua
    return eventsForMonth[eventsForMonth.length - 1]?.date ?? null;
  }, [selectedEventDate, eventsForMonth, today]);

  const activeEvent = useMemo(() => eventsForMonth.find((e) => e.date === activeEventDate) ?? null, [eventsForMonth, activeEventDate]);

  // All past event windows with data (sorted by date asc) — including client breakdown
  const pastWindows = useMemo(() => {
    const years = [...new Set(Object.keys(byDay).map((d) => d.slice(0, 4)))];
    const out = [];
    for (const [mm, days] of Object.entries(ECOM_CALENDAR)) {
      for (const year of years) {
        for (const [slotIdx, { day, name }] of days.entries()) {
          const date = `${year}-${mm}-${String(day).padStart(2, "0")}`;
          if (date > today) continue;
          const dm1 = addDays(date, -1), dp1 = addDays(date, 1);
          if (!byDay[date] && !byDay[dm1] && !byDay[dp1]) continue;
          const dm1O = byDay[dm1] || 0, d0O = byDay[date] || 0, dp1O = byDay[dp1] || 0;
          const totalO = dm1O + d0O + dp1O;
          // Bỏ event window có quá ít đơn (tháng vừa onboard / data thiếu) — tránh skew forecast
          if (totalO < 500) continue;
          const dm1W = weightByDay[dm1] || 0, d0W = weightByDay[date] || 0, dp1W = weightByDay[dp1] || 0;
          out.push({
            date, name, dm1, dp1, slot: slotIdx,
            dm1O, d0O, dp1O, dm1W, d0W, dp1W,
            totalO,
            totalW: dm1W + d0W + dp1W,
          });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [byDay, weightByDay, today]);

  // Forecast baseline = avg of past windows + per-client avg
  const forecastBaseline = useMemo(() => {
    if (!pastWindows.length) return null;
    const w = pastWindows;
    const avg = (fn) => w.reduce((s, x) => s + fn(x), 0) / w.length;

    // Per-client avg across past events
    const clientSums = {};
    for (const ev of w) {
      const merged = mergeClientWindow(ev.dm1, ev.date, ev.dp1, byClientAndDay);
      for (const [cl, v] of Object.entries(merged)) {
        if (!clientSums[cl]) clientSums[cl] = { dm1: 0, d0: 0, dp1: 0, count: 0 };
        clientSums[cl].dm1 += v.dm1; clientSums[cl].d0 += v.d0; clientSums[cl].dp1 += v.dp1;
        clientSums[cl].count++;
      }
    }
    const clientAvg = {};
    for (const [cl, s] of Object.entries(clientSums)) {
      const c = s.count || 1;
      clientAvg[cl] = { dm1: Math.round(s.dm1 / c), d0: Math.round(s.d0 / c), dp1: Math.round(s.dp1 / c), total: Math.round((s.dm1 + s.d0 + s.dp1) / c) };
    }

    return {
      dm1O: Math.round(avg((x) => x.dm1O)), d0O: Math.round(avg((x) => x.d0O)), dp1O: Math.round(avg((x) => x.dp1O)),
      dm1W: avg((x) => x.dm1W), d0W: avg((x) => x.d0W), dp1W: avg((x) => x.dp1W),
      count: w.length,
      clientAvg,
    };
  }, [pastWindows, byClientAndDay]);

  // Forecast per slot — dùng growth rate của kỳ GẦN NHẤT (T8→T9), không bình quân tất cả
  // Lý do: T7 có baseline thấp (client mới onboard/data thiếu) → T7→T8 tăng 500-900% → skew avgGr
  const forecastBySlot = useMemo(() => {
    // lastGr: chỉ lấy bước cuối cùng, cap ±100% để tránh outlier đơn lẻ
    const lastGr = (vals) => {
      const n = vals.length;
      if (n < 2 || vals[n - 2] <= 0) return 0;
      const raw = (vals[n - 1] - vals[n - 2]) / vals[n - 2];
      return Math.max(-0.9, Math.min(raw, 1.0)); // cap: tối đa +100%, tối thiểu -90%/kỳ
    };
    const project = (lastVal, gr) => Math.max(0, Math.round(lastVal * (1 + gr)));

    const bySlot = {};
    for (const ev of pastWindows) {
      const s = ev.slot ?? 0;
      if (!bySlot[s]) bySlot[s] = [];
      bySlot[s].push(ev);
    }
    const result = {};
    for (const [s, rawEvs] of Object.entries(bySlot)) {
      const evs = [...rawEvs].sort((a, b) => a.date.localeCompare(b.date));
      const last = evs[evs.length - 1];

      // Tổng đơn/tấn: chiếu theo growth rate kỳ gần nhất (không bình quân)
      const grDm1O = lastGr(evs.map((e) => e.dm1O));
      const grD0O  = lastGr(evs.map((e) => e.d0O));
      const grDp1O = lastGr(evs.map((e) => e.dp1O));
      const grDm1W = lastGr(evs.map((e) => e.dm1W));
      const grD0W  = lastGr(evs.map((e) => e.d0W));
      const grDp1W = lastGr(evs.map((e) => e.dp1W));

      // Per-client: lấy tổng 3 ngày qua từng event, tính % tăng kỳ cuối, chiếu tiếp
      const clientHistory = {};
      for (const ev of evs) {
        const merged = mergeClientWindow(ev.dm1, ev.date, ev.dp1, byClientAndDay);
        for (const [cl, v] of Object.entries(merged)) {
          if (!clientHistory[cl]) clientHistory[cl] = { totals: [], lastSlots: null };
          clientHistory[cl].totals.push(v.total);
          clientHistory[cl].lastSlots = v;
        }
      }
      const clientAvg = {};
      for (const [cl, h] of Object.entries(clientHistory)) {
        const gr = lastGr(h.totals);
        const lastTotal = h.totals[h.totals.length - 1];
        const projected = project(lastTotal, gr);
        const ls = h.lastSlots || {};
        const ratio = lastTotal > 0
          ? { dm1: ls.dm1 / lastTotal, d0: ls.d0 / lastTotal, dp1: ls.dp1 / lastTotal }
          : { dm1: 0.27, d0: 0.43, dp1: 0.30 };
        clientAvg[cl] = {
          dm1: Math.round(projected * ratio.dm1),
          d0:  Math.round(projected * ratio.d0),
          dp1: Math.round(projected * ratio.dp1),
          total: projected,
          growthRate: gr,
        };
      }

      result[s] = {
        dm1O: project(last.dm1O, grDm1O), d0O: project(last.d0O, grD0O), dp1O: project(last.dp1O, grDp1O),
        dm1W: Math.max(0, last.dm1W * (1 + grDm1W)),
        d0W:  Math.max(0, last.d0W  * (1 + grD0W)),
        dp1W: Math.max(0, last.dp1W * (1 + grDp1W)),
        count: evs.length,
        growthRateO: lastGr(evs.map((e) => e.totalO)),
        clientAvg,
      };
    }
    return result;
  }, [pastWindows, byClientAndDay]);

  // Dự báo theo tỉnh thành per slot — lastGr per tỉnh từ T8→T9
  const provincesForecastBySlot = useMemo(() => {
    const lastGrProv = (vals) => {
      const n = vals.length;
      if (n < 2 || vals[n - 2] <= 0) return 0;
      return Math.max(-0.9, Math.min((vals[n - 1] - vals[n - 2]) / vals[n - 2], 1.0));
    };

    const bySlot = {};
    for (const ev of pastWindows) {
      const s = ev.slot ?? 0;
      if (!bySlot[s]) bySlot[s] = [];
      bySlot[s].push(ev);
    }
    const result = {};
    for (const [s, rawEvs] of Object.entries(bySlot)) {
      const evs = [...rawEvs].sort((a, b) => a.date.localeCompare(b.date));
      // Per-province: gom đơn + kg trong cửa sổ 3 ngày của từng event
      const provHistory = {};
      for (const ev of evs) {
        const days = [ev.dm1, ev.date, ev.dp1];
        const dayProvOrders = {};
        const dayProvWeight = {};
        for (const d of days) {
          for (const [prov, cnt] of Object.entries(byProvinceAndDay[d] || {})) {
            dayProvOrders[prov] = (dayProvOrders[prov] || 0) + cnt;
          }
          for (const [prov, kg] of Object.entries(weightByProvinceAndDay[d] || {})) {
            dayProvWeight[prov] = (dayProvWeight[prov] || 0) + kg;
          }
        }
        const allProvs = new Set([...Object.keys(dayProvOrders), ...Object.keys(dayProvWeight)]);
        for (const prov of allProvs) {
          if (!provHistory[prov]) provHistory[prov] = { orders: [], weight: [] };
          provHistory[prov].orders.push(dayProvOrders[prov] || 0);
          provHistory[prov].weight.push(dayProvWeight[prov] || 0);
        }
      }
      // Chiếu tiếp từ kỳ cuối
      const forecast = {};
      const lastIdx = evs.length - 1;
      const lastEv = evs[lastIdx];
      for (const [prov, h] of Object.entries(provHistory)) {
        const grO = lastGrProv(h.orders);
        const grW = lastGrProv(h.weight);
        const lastO = h.orders[h.orders.length - 1];
        const lastW = h.weight[h.weight.length - 1];
        forecast[prov] = {
          lastOrders: lastO,
          lastWeight: lastW,
          lastDate: lastEv.date,
          fcOrders: Math.max(0, Math.round(lastO * (1 + grO))),
          fcWeight: Math.max(0, Math.round(lastW * (1 + grW))),
          growthRate: grO,
        };
      }
      result[s] = forecast;
    }
    return result;
  }, [pastWindows, byProvinceAndDay, weightByProvinceAndDay]);

  // Kho lấy lịch sử theo slot — dùng cho future event (không có actual data)
  const khoLayForecastBySlot = useMemo(() => {
    const result = {};
    for (const pw of pastWindows) {
      const s = pw.slot ?? 0;
      if (!result[s]) result[s] = {};
      for (const d of [pw.dm1, pw.date, pw.dp1]) {
        for (const [kho, cnt] of Object.entries((byKhoLayAndDay || {})[d] || {})) {
          result[s][kho] = (result[s][kho] || 0) + cnt;
        }
      }
    }
    return result;
  }, [pastWindows, byKhoLayAndDay]);

  // Normal day stats (non-event ± 1 day, last 90 days)
  const normalStats = useMemo(() => {
    const allEDate = new Set();
    for (const [mm, days] of Object.entries(ECOM_CALENDAR)) {
      const years = [...new Set(Object.keys(byDay).map((d) => d.slice(0, 4)))];
      for (const year of years) {
        for (const { day } of days) {
          const d0 = `${year}-${mm}-${String(day).padStart(2, "0")}`;
          allEDate.add(addDays(d0, -1)); allEDate.add(d0); allEDate.add(addDays(d0, 1));
        }
      }
    }
    const normalDays = Object.keys(byDay).filter((d) => d <= today && !allEDate.has(d)).sort().slice(-90);
    if (!normalDays.length) return { orders: 0, weight: 0 };
    return {
      orders: normalDays.reduce((s, d) => s + (byDay[d] || 0), 0) / normalDays.length,
      weight: normalDays.reduce((s, d) => s + (weightByDay[d] || 0), 0) / normalDays.length,
    };
  }, [byDay, weightByDay, today]);

  // Custom event management
  const addCustom = () => {
    if (!newDate) return;
    const next = [
      ...customEvents.filter((c) => c.date !== newDate),
      { date: newDate, name: newLabel.trim() || `Custom ${fmtDd(newDate)}`, label: newLabel.trim() },
    ].sort((a, b) => a.date.localeCompare(b.date));
    setCustomEvents(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
    setNewDate(""); setNewLabel("");
  };
  const removeCustom = (date) => {
    const next = customEvents.filter((c) => c.date !== date);
    setCustomEvents(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  };

  const inpS = {
    padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
    background: "var(--bg-panel)", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit",
  };
  const chipS = (active) => ({
    padding: "5px 12px", borderRadius: 6, fontSize: 12.5, fontWeight: active ? 700 : 400,
    cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${active ? "var(--cyan)" : "var(--border)"}`,
    background: active ? "rgba(var(--brand-rgb),0.12)" : "transparent",
    color: active ? "var(--cyan)" : "var(--text-muted)",
  });

  // Next upcoming event (for forecast column in growth table)
  const nextEvent = useMemo(() => {
    for (const ym of monthOptions) {
      for (const ev of eventsOfYM(ym)) {
        if (ev.date > today) return ev;
      }
    }
    return null;
  }, [monthOptions, today]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>

      {/* Month selector + Xuất Excel */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginRight: 4 }}>Tháng:</span>
        {monthOptions.map((ym) => {
          const [y, m] = ym.split("-");
          return (
            <button key={ym} style={chipS(selectedYM === ym)} onClick={() => { setSelectedYM(ym); setSelectedEventDate(null); }}>
              T{parseInt(m, 10)}/{y.slice(2)}
            </button>
          );
        })}
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => exportToExcel({ selectedYM, eventsForMonth, byDay, weightByDay, byClientAndDay, byProvinceAndDay, weightByProvinceAndDay, pastWindows, forecastBySlot, provincesForecastBySlot, normalStats, today, forecastBaseline })}
            style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--cyan)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}
          >
            📥 Xuất Excel
          </button>
        </div>
      </div>

      {/* Event selector + single card */}
      {eventsForMonth.length === 0 ? (
        <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 32, fontSize: 13 }}>
          Không có sự kiện nào trong tháng này.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Event picker chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {eventsForMonth.map((ev) => {
              const inWindow = today >= addDays(ev.date, -1) && today <= addDays(ev.date, 1);
              const isActive = ev.date === activeEventDate;
              const isFut = ev.date > today;
              return (
                <button key={ev.date} onClick={() => setSelectedEventDate(ev.date)} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: "pointer",
                  border: isActive ? "1.5px solid var(--brand)" : "1px solid var(--border)",
                  background: isActive ? "rgba(var(--brand-rgb),0.15)" : inWindow ? "rgba(var(--amber-rgb,245,158,11),0.08)" : "var(--bg-panel)",
                  color: isActive ? "var(--brand)" : isFut ? "var(--amber)" : "var(--text-primary)",
                }}>
                  {inWindow ? "⚡ " : isFut ? "⏳ " : ""}{ev.name}
                  {ev.isCustom ? " ✏️" : ""}
                </button>
              );
            })}
          </div>
          {/* Chi tiết event đang chọn */}
          {activeEvent && (
            <EventCard event={activeEvent}
              byDay={byDay} weightByDay={weightByDay} byClientAndDay={byClientAndDay}
              byProvinceAndDay={byProvinceAndDay} weightByProvinceAndDay={weightByProvinceAndDay}
              byKhoLayAndDay={byKhoLayAndDay}
              forecastBaseline={activeEvent.date > today ? (forecastBySlot[activeEvent.slot ?? 0] ?? forecastBaseline) : null}
              normalStats={normalStats} today={today}
              growthRateO={activeEvent.date > today ? forecastBySlot[activeEvent.slot ?? 0]?.growthRateO : null}
              fcSnapshot={fcSnapshots[activeEvent.date] || null}
              onChot={handleChotFc}
              provinceForecast={activeEvent.date > today ? (provincesForecastBySlot[activeEvent.slot ?? 0] || null) : null}
            khoLayForecast={activeEvent.date > today ? (khoLayForecastBySlot[activeEvent.slot ?? 0] || null) : null} />
          )}
        </div>
      )}

      {/* Normal day baseline */}
      {normalStats.orders > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
          TB ngày thường: <b style={{ color: "var(--text-secondary)" }}>{n(normalStats.orders, 0)} đơn/ngày</b>
          {" · "}{ton(normalStats.weight)}/ngày
          {forecastBaseline && <> · Dự báo từ <b>{forecastBaseline.count}</b> event đã qua</>}
        </div>
      )}

      {/* Custom event manager */}
      <div className="chart-panel">
        <div className="chart-panel-title" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => setShowCustom((v) => !v)}>
          <span>✎ Thêm event tùy chỉnh</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>{showCustom ? "▲" : "▼"}</span>
        </div>
        {showCustom && (
          <div style={{ padding: "0 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={inpS} />
              <input type="text" placeholder="Tên event" value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                style={{ ...inpS, flex: 1, minWidth: 160 }} />
              <button onClick={addCustom} disabled={!newDate} style={{
                padding: "6px 14px", borderRadius: 6, border: "none", fontFamily: "inherit",
                fontWeight: 700, fontSize: 13, cursor: newDate ? "pointer" : "default",
                background: newDate ? "var(--cyan)" : "var(--border)",
                color: newDate ? "#000" : "var(--text-muted)",
              }}>+ Thêm</button>
            </div>
            {customEvents.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {customEvents.map((c) => (
                  <div key={c.date} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--bg-panel)", fontSize: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>{fmtDd(c.date)} · {c.name}</span>
                    <button onClick={() => removeCustom(c.date)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
