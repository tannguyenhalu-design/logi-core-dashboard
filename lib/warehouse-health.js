/**
 * Warehouse saturation analysis using avgOrdersGtc (cap GTC trung bình) as baseline.
 * BẤT ỔN when DM + NHC + STTP daily orders > cap.
 * ECOM is excluded from the saturation check — no reliable vol data yet.
 *
 * @param {object} warehouseLayerAll  — computed from all 4 industries combined
 * @param {object} options
 * @param {object} options.dm         — warehouseLayer (DM-only)
 * @param {object} options.nhc        — warehouseLayerNhc
 * @param {object} options.sttp       — warehouseLayerSttp
 * @param {object} options.ecom       — warehouseLayerEcom (informational only, not in saturation)
 * @returns {{ sites: Array, summary: object, note: string }}
 */
export function computeWarehouseSaturation(warehouseLayerAll, { dm, nhc, sttp, ecom } = {}) {
  if (!warehouseLayerAll?.sites?.length) return { sites: [], summary: { total: 0, unstable: 0 }, note: "" };

  // Build per-site order lookup for each industry layer
  const buildIndex = (layer) => {
    const idx = new Map();
    for (const site of (layer?.sites || [])) {
      idx.set(site.id, site.giao?.ordersPerDay?.avg ?? site.giao?.mean ?? 0);
    }
    return idx;
  };

  const dmIdx   = buildIndex(dm);
  const nhcIdx  = buildIndex(nhc);
  const sttpIdx = buildIndex(sttp);
  const ecomIdx = buildIndex(ecom);

  const sites = warehouseLayerAll.sites.map((site) => {
    const cap = site.names.reduce((s, n) => s + (n.total?.avgOrdersGtc ?? 0), 0);

    const dmOrders   = dmIdx.get(site.id)   ?? 0;
    const nhcOrders  = nhcIdx.get(site.id)  ?? 0;
    const sttpOrders = sttpIdx.get(site.id) ?? 0;
    const ecomOrders = ecomIdx.get(site.id) ?? 0;

    // Saturation uses only DM + NHC + STTP (ECOM vol data not yet reliable)
    const measuredOrders = dmOrders + nhcOrders + sttpOrders;
    const satRate = cap > 0 ? (measuredOrders / cap) * 100 : null;

    return {
      id: site.id,
      names: site.names,
      cap,
      measuredOrders,
      ecomOrders,
      satRate,
      unstable: cap > 0 && measuredOrders > cap,
      breakdown: { dm: dmOrders, nhc: nhcOrders, sttp: sttpOrders, ecom: ecomOrders },
    };
  });

  const unstable = sites.filter((s) => s.unstable).length;
  return {
    sites,
    summary: { total: sites.length, unstable, capAvailable: sites.filter((s) => s.cap > 0).length },
    note: "*Tính trên sản lượng DM + NHC + STTP (Chưa có vol Ecom)",
  };
}
