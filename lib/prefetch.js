/**
 * lib/prefetch.js — browser-side idle prefetch (Kế hoạch A · P4, 28/09).
 * While the dashboard sits idle, pages/dashboard.js asks each tab module the
 * user may open for its first requests (prefetch() exported by the tab);
 * when the tab mounts it reads them from here instead of waiting on the
 * network. Entries live PREFETCH_TTL_MS: after that — or for any refresh the
 * user asks for — the tab fetches normally, so nothing stale sticks around.
 */
const PREFETCH_TTL_MS = 60 * 1000;
const store = new Map(); // url → { at, promise }

// Resolves { ok, status, j } — the HTTP ok flag and the parsed JSON body,
// the shape the tabs already branch on.
const load = (url) => fetch(url).then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, j }), () => ({ ok: false, status: r.status, j: {} })));

export function prefetchJSON(url) {
  const hit = store.get(url);
  if (hit && Date.now() - hit.at < PREFETCH_TTL_MS) return hit.promise;
  const promise = load(url);
  store.set(url, { at: Date.now(), promise });
  promise.then((x) => { if (!x.ok) store.delete(url); }, () => store.delete(url));
  return promise;
}

// A prefetched response still fresh, else a normal request.
export function getJSON(url) {
  const hit = store.get(url);
  if (hit && Date.now() - hit.at < PREFETCH_TTL_MS) return hit.promise;
  return load(url);
}

export function dropPrefetched(prefix = "") {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

// requestIdleCallback with a timeout fallback (Safari has none).
export function whenIdle(fn, timeout = 2000) {
  if (typeof window === "undefined") return () => {};
  if (window.requestIdleCallback) {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback && window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 300);
  return () => clearTimeout(id);
}

// ── Dashboard data stale-while-revalidate cache ──────────────────────────────
// Key = base query string (qs, no asOf). Value = { data, qsWithAsOf, at }.
// 5-min TTL: show stale data instantly while background-revalidating.
const DASH_TTL_MS = 5 * 60 * 1000;
const dashStore = new Map();

export function getStaleDash(qs) {
  const hit = dashStore.get(qs);
  if (!hit) return null;
  return { data: hit.data, qsWithAsOf: hit.qsWithAsOf, stale: Date.now() - hit.at > DASH_TTL_MS };
}

export function setStaleDash(qs, data, qsWithAsOf) {
  dashStore.set(qs, { data, qsWithAsOf, at: Date.now() });
}
