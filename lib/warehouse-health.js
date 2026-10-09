/**
 * Warehouse saturation — threshold 85% of GTC cap.
 * Uses warehouseLayerAll (all 4 industries combined) so no per-industry
 * breakdown is needed. When satRate > 85, the site is flagged "KHO BẤT ỔN".
 *
 * @param {object} warehouseLayerAll — computed from all 4 industries combined
 * @returns {{ sites: Array, summary: object, note: string }}
 */
export function computeWarehouseSaturation(warehouseLayerAll) {
  if (!warehouseLayerAll?.sites?.length) return { sites: [], summary: { total: 0, unstable: 0 }, note: "" };

  const sites = warehouseLayerAll.sites.map((site) => {
    const cap = site.names.reduce((s, n) => s + (n.total?.avgOrdersGtc ?? 0), 0);
    const measuredOrders = site.giao?.ordersPerDay?.avg ?? 0;
    const satRate = cap > 0 ? (measuredOrders / cap) * 100 : null;

    return {
      id: site.id,
      names: site.names,
      cap,
      measuredOrders,
      satRate,
      unstable: satRate !== null && satRate > 85,
    };
  });

  const unstable = sites.filter((s) => s.unstable).length;
  return {
    sites,
    summary: { total: sites.length, unstable, capAvailable: sites.filter((s) => s.cap > 0).length },
    note: "*Tính trên sản lượng tổng 4 ngành",
  };
}
