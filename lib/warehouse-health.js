/**
 * Warehouse health — "Clear Time" logic (Sheet Anh Tân formula, 2026-10-09).
 *
 * Replaces the old satRate > 85% rule.
 * Uses pre-computed clearTime data attached to each site name by
 * buildWarehouseIndex (from the KhoClearTime Google Sheet tab).
 *
 * A site is flagged "KHO BẤT ỔN" when BOTH:
 *   est_clear_hien_tai = backlog_lastmile / tb_gtc_L7D  > 1.5 ngày
 *   peak_ratio         = backlog_lastmile / max_gtc_L7D > 1.2
 *
 * @param {object} warehouseLayerAll — computed from all 4 industries combined
 * @returns {{ sites: Array, summary: object, note: string }}
 */
const INDUSTRY_LABEL = { DM: "Điện máy", NHC: "NH chung", STTP: "STTP", ECOM: "Ecom", OTHER: "chưa phân ngành" };
const f1 = (n) => n.toFixed(1).replace(".", ",");
const f2 = (n) => n.toFixed(2).replace(".", ",");

/**
 * Plain-language "why" for an unstable site. `bl` = warehouseLayerAll.backlog[siteId]
 * (orders of the 4 tracked industries sitting at the site now) — it only covers
 * part of the Sheet Anh Tân backlog, so the share it explains is stated.
 */
function explainUnstable({ backlog, est_clear_hien_tai, est_clear_sap_ve, peak_ratio }, bl) {
  const reasons = [
    `Tồn ${backlog} đơn chờ giao — cần ${f2(est_clear_hien_tai)} ngày mới giao hết (ngưỡng 1,5)` +
      (peak_ratio != null ? `, gấp ${f2(peak_ratio)} lần ngày giao nhiều nhất 7 ngày qua.` : "."),
  ];
  let headline = "Bất ổn do tồn hàng ngoài 4 ngành theo dõi";
  const atKho = bl?.atKho || 0;
  if (bl === undefined) {
    headline = "Kho bất ổn — tồn vượt năng lực giao";
  } else if (atKho > 0) {
    const share = (n) => Math.round((n / atKho) * 100);
    const inds = bl.industries.filter((i) => share(i.orders) >= 10).slice(0, 3);
    const clients = bl.topClients.slice(0, 2).map((c) => `${c.name} (${c.orders})`).join(", ");
    reasons.push(
      `${atKho} đơn 4 ngành đang nằm tại kho: ` +
      inds.map((i) => `${share(i.orders)}% ${INDUSTRY_LABEL[i.name] || i.name}`).join(", ") +
      (clients ? ` — nhiều nhất ${clients}.` : "."),
    );
    const covered = backlog > 0 ? atKho / backlog : 1;
    if (covered < 0.3) {
      reasons.push(`Khoảng ${Math.round((1 - covered) * 100)}% tồn là hàng khách GHN ngoài 4 ngành.`);
    } else {
      const lead = bl.industries[0];
      if (lead && share(lead.orders) >= 50) {
        headline = `Bất ổn do hàng ${INDUSTRY_LABEL[lead.name] || lead.name} tồn nhiều` +
          (bl.topClients[0] ? ` (${bl.topClients[0].name})` : "");
      } else {
        headline = `Bất ổn do tồn nhiều ngành: ${inds.map((i) => INDUSTRY_LABEL[i.name] || i.name).join(" + ")}`;
      }
    }
  } else {
    reasons.push("Không có đơn 4 ngành nào đang nằm tại kho — tồn là hàng khách GHN khác.");
  }
  if (est_clear_sap_ve > 1.5) {
    reasons.push(`Hàng sắp về (chờ trung chuyển + đơn tạo hôm qua) cần thêm ${f1(est_clear_sap_ve)} ngày giao — áp lực còn tăng.`);
  }
  return { headline, reasons };
}

export function computeWarehouseSaturation(warehouseLayerAll) {
  const baseSites = warehouseLayerAll?.healthSites || warehouseLayerAll?.sites;
  if (!baseSites?.length) return { sites: [], summary: { total: 0, unstable: 0 }, note: "" };
  // No backlog object at all = data unavailable (old cached body), not "nothing in stock".
  const backlogBySite = warehouseLayerAll.backlog;

  const sites = baseSites.map((site) => {
    // Aggregate clear-time fields across all names in this map point.
    let backlog = 0, backlogKtc = 0, donTaoN1 = 0, tbGtc = 0, maxGtc = 0, hasData = false;
    for (const n of site.names) {
      const ct = n.clearTime;
      if (!ct) continue;
      hasData = true;
      backlog   += ct.backlog_lastmile ?? 0;
      backlogKtc += ct.backlog_ktc    ?? 0;
      donTaoN1  += ct.don_tao_N1     ?? 0;
      tbGtc     += ct.tb_gtc_L7D     ?? 0;
      maxGtc    += ct.max_gtc_L7D    ?? 0;
    }

    if (!hasData || tbGtc <= 0) {
      return { id: site.id, names: site.names, hasData: false, unstable: false };
    }

    const est_clear_hien_tai = backlog / tbGtc;
    const est_clear_sap_ve   = (backlogKtc + donTaoN1) / tbGtc;
    const peak_ratio         = maxGtc > 0 ? backlog / maxGtc : null;
    const unstable           = est_clear_hien_tai > 1.5 && (peak_ratio == null || peak_ratio > 1.2);
    const explain = unstable
      ? explainUnstable({ backlog, est_clear_hien_tai, est_clear_sap_ve, peak_ratio }, backlogBySite ? (backlogBySite[site.id] || null) : undefined)
      : null;

    return {
      ...explain,
      id: site.id,
      names: site.names,
      hasData: true,
      backlog,
      tbGtc,
      maxGtc,
      est_clear_hien_tai,
      est_clear_sap_ve,
      peak_ratio,
      unstable,
    };
  });

  const withData = sites.filter((s) => s.hasData);
  const unstable = sites.filter((s) => s.unstable).length;
  return {
    sites,
    summary: { total: sites.length, withData: withData.length, unstable },
    note: "*Theo logic Xả Hàng (Sheet Anh Tân): Clear Time > 1.5 ngày & Peak Ratio > 1.2",
  };
}
