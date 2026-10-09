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
export function computeWarehouseSaturation(warehouseLayerAll) {
  if (!warehouseLayerAll?.sites?.length) return { sites: [], summary: { total: 0, unstable: 0 }, note: "" };

  const sites = warehouseLayerAll.sites.map((site) => {
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

    return {
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
