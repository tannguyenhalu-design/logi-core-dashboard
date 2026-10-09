/**
 * lib/weekly-trend.js
 * Aggregates LTL data into per-ISO-week buckets for the "Historical Trend &
 * Incident Tracker" panel (PHẦN 3). Returns the last N ISO weeks found in
 * the data (defaulting to 4) plus a province-level SLA decline table.
 *
 * Metrics match the company report definitions in lib/biweekly-report.js:
 *  - SLA % = ontime / (ontime + late) — evaluated delivered orders only.
 *  - Bể vỡ % = countedDamage cases (by case_date week) / LTC by pickup week.
 *  - Hàng hoàn % = deliver_type "return" orders / LTC, both by pickup week.
 */
import { mondayOf, isoWeekOf, weekKey, isInProgress } from "./biweekly-report";
import { getOntimeOutcome } from "./transform-ltl";
import { countedDamage } from "./damage-rules";

const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => ymd(new Date(Date.parse(iso) + n * DAY));

function dayOf(raw) {
  const s = String(raw || "").trim();
  const x = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})|^(\d{4})-(\d{2})-(\d{2})/);
  if (!x) return "";
  return x[1] ? `${x[3]}-${x[2].padStart(2, "0")}-${x[1].padStart(2, "0")}` : `${x[4]}-${x[5]}-${x[6]}`;
}

const weekLabel = (monday) => `W${isoWeekOf(monday).week}`;
const weekRange = (monday) =>
  `${monday.slice(8, 10)}/${monday.slice(5, 7)}–${addDays(monday, 6).slice(8, 10)}/${addDays(monday, 6).slice(5, 7)}`;

const blank = () => ({ ltc: 0, ontime: 0, late: 0, fd: 0, damageCases: 0 });

export function computeWeeklyTrend(ltlRows, rawDamageCauses, { projects, origin, weeks: nWeeks = 4 } = {}) {
  const damageRows = countedDamage(rawDamageCauses || []);

  // Determine last N ISO week Mondays present in the data.
  const mondaySeen = new Set();
  for (const r of ltlRows) {
    const mon = mondayOf(r.pickup_time);
    if (mon) mondaySeen.add(mon);
  }
  const allMondays = [...mondaySeen].sort();
  const lastMondays = allMondays.slice(-nWeeks);
  if (!lastMondays.length) return { weeks: [], provinceDeclines: [] };

  const mondaySet = new Set(lastMondays);

  // Per-week buckets (overall + per province).
  const wk = {};   // weekKey → blank()
  const prov = {}; // province → weekKey → blank()
  const orderCodes = new Set();

  const inScope = (r) =>
    (!projects?.length || projects.includes(r.client_name)) &&
    (!origin || String(r.from_province_name || "").trim() === origin);

  for (const r of ltlRows) {
    if (!inScope(r)) continue;
    const mon = mondayOf(r.pickup_time);
    if (!mon || !mondaySet.has(mon)) continue;
    const key = weekKey(mon);
    if (!wk[key]) wk[key] = blank();

    orderCodes.add(String(r.order_code || "").trim());
    wk[key].ltc++;

    const toName = String(r.to_province_name || "").trim();
    if (toName) {
      if (!prov[toName]) prov[toName] = {};
      if (!prov[toName][key]) prov[toName][key] = blank();
      prov[toName][key].ltc++;
    }

    const outcome = getOntimeOutcome(r);
    if (outcome === "ontime") {
      wk[key].ontime++;
      if (toName && prov[toName]?.[key]) prov[toName][key].ontime++;
    } else if (outcome === "late") {
      wk[key].late++;
      if (toName && prov[toName]?.[key]) prov[toName][key].late++;
    }

    if (String(r.deliver_type || "").toLowerCase() === "return") {
      wk[key].fd++;
      if (toName && prov[toName]?.[key]) prov[toName][key].fd++;
    }
  }

  // Damage cases keyed by case_date ISO week.
  for (const d of damageRows) {
    if (!orderCodes.has(String(d.order_code || "").trim())) continue;
    const mon = mondayOf(dayOf(d.case_date));
    if (!mon || !mondaySet.has(mon)) continue;
    const key = weekKey(mon);
    if (wk[key]) wk[key].damageCases++;
  }

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

  const weeks = lastMondays.map((mon) => {
    const key = weekKey(mon);
    const b = wk[key] || blank();
    const evalN = b.ontime + b.late;
    return {
      key,
      label: weekLabel(mon),
      range: weekRange(mon),
      mature: !isInProgress(mon),
      ltc: b.ltc,
      evalCount: evalN,
      ontimePct: pct(b.ontime, evalN),
      damagePct: pct(b.damageCases, b.ltc),
      fdPct: pct(b.fd, b.ltc),
    };
  });

  // Province decline tracker: "cur" = most recent week (in progress or complete).
  // "prev" = the last COMPLETED week before cur.
  // This always gives the most up-to-date comparison (e.g. W40→W41 while W41 is live).
  const completedWeeks = weeks.filter((w) => w.mature);
  const curWeek = weeks[weeks.length - 1] || null;
  // If cur is itself mature, prev is the completed week before it.
  // If cur is not mature (in progress), prev is the last completed week.
  const prevWeek = curWeek?.mature
    ? completedWeeks[completedWeeks.length - 2] || null
    : completedWeeks[completedWeeks.length - 1] || null;
  let provinceDeclines = [];
  if (prevWeek && curWeek && prevWeek.key !== curWeek.key) {
    const prev = prevWeek;
    const cur = curWeek;
    const MIN_SAMPLE = 5;
    const MIN_DROP_POINTS = 5; // ignore noise: < 5pp drop is not actionable

    for (const [name, byWeek] of Object.entries(prov)) {
      const p = byWeek[prev.key];
      const c = byWeek[cur.key];
      if (!p || !c) continue;
      const prevN = p.ontime + p.late, curN = c.ontime + c.late;
      if (prevN < MIN_SAMPLE || curN < MIN_SAMPLE) continue;
      const prevPct = pct(p.ontime, prevN), curPct = pct(c.ontime, curN);
      if (prevPct === null || curPct === null) continue;
      const delta = Math.round((curPct - prevPct) * 10) / 10;
      if (delta <= -MIN_DROP_POINTS) {
        provinceDeclines.push({
          name, prevPct, curPct, delta,
          prevN, curN, prevLabel: prev.label, curLabel: cur.label,
        });
      }
    }
    provinceDeclines.sort((a, b) => a.delta - b.delta);
    provinceDeclines = provinceDeclines.slice(0, 5);
  }

  return {
    weeks,
    provinceDeclines,
    // true = both comparison weeks are complete; false = cur week still in progress
    declineCurMature: curWeek?.mature ?? true,
  };
}
