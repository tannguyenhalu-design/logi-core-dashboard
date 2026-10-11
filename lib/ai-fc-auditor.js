/**
 * lib/ai-fc-auditor.js — Pure anomaly detection for FC data.
 * No API calls, no side effects.
 */

const MIN_FC_THRESHOLD = 5; // bỏ qua client có FC < 5 đơn (noise)

/**
 * Quét bất thường giữa forecastByClient và clientActuals.
 *
 * @param {object} opts
 * @param {object} opts.forecastByClient  { [client]: { total, dm1, d0, dp1 } }
 * @param {object} opts.clientActuals     { [client]: number } — tổng đơn 3 ngày event
 * @param {boolean} opts.isFuture
 * @param {string}  opts.eventDate        "YYYY-MM-DD"
 * @param {Array}   opts.annotations      loaded từ /api/fc-annotations
 * @returns {{ alerts, fcOverrides, score, commentary }}
 */
export function runAudit({ forecastByClient = {}, clientActuals = {}, isFuture = false, eventDate = "", annotations = [] }) {
  // Xây fcOverrides từ annotations
  const fcOverrides = {};
  for (const ann of annotations) {
    if (ann.reasonType !== "pause") continue;
    if (ann.scope === "global" || (ann.scope === "event" && ann.eventDate === eventDate)) {
      fcOverrides[ann.client] = 0;
    }
  }

  const alerts = [];

  if (!isFuture) {
    for (const [cl, fc] of Object.entries(forecastByClient)) {
      const fcTotal = fc.total ?? 0;
      if (fcTotal < MIN_FC_THRESHOLD) continue;

      const actual = clientActuals[cl] ?? 0;
      const annotation = annotations.find(
        (a) => a.client === cl && (a.scope === "global" || a.eventDate === eventDate)
      ) || null;
      const annotated = !!annotation;

      if (actual === 0) {
        // RED: có FC nhưng không có đơn thực tế
        alerts.push({ client: cl, type: "red", fcOrders: Math.round(fcTotal), actualOrders: 0, annotated, annotation });
      } else {
        // YELLOW: lệch >30%
        const deviation = Math.abs(actual - fcTotal) / fcTotal;
        if (deviation > 0.30) {
          alerts.push({ client: cl, type: "yellow", fcOrders: Math.round(fcTotal), actualOrders: Math.round(actual), deviation: Math.round(deviation * 100), annotated, annotation });
        }
      }
    }
  }

  // Scorecard
  const unRed    = alerts.filter((a) => a.type === "red"    && !a.annotated).length;
  const unYellow = alerts.filter((a) => a.type === "yellow" && !a.annotated).length;
  const score    = Math.max(0, 100 - unRed * 20 - unYellow * 5);

  const commentary = [];
  if (unRed > 0)    commentary.push(`${unRed} khách có FC nhưng 0 đơn thực tế — FC đang tính dư, nên ghi nhận lý do.`);
  if (unYellow > 0) commentary.push(`${unYellow} khách lệch số >30% chưa ghi nhận — có thể ảnh hưởng dự báo kỳ sau.`);
  if (score === 100 && alerts.length > 0) commentary.push("Tất cả cảnh báo đã có lý do — FC đang tính chính xác.");
  if (alerts.length === 0) commentary.push("Không phát hiện bất thường trong kỳ này.");

  return { alerts, fcOverrides, score, commentary };
}
