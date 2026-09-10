import { apiClient } from './apiClient';

// Types co-located with the caller (same convention as productionKpis.ts).

export type SalesBucket = 'sales' | 'fulfilment';
export type SalesFormat = 'currency' | 'number' | 'percent';
/** `snapshot` metrics (e.g. Total Design Live) show a single current value. */
export type SalesKind = 'flow' | 'ratio' | 'snapshot';

/** One metric row, measured across the four reporting windows. A `null` window
 *  is "N/A" (the source isn't wired yet) — distinct from a real 0. */
export interface SalesMetric {
  key: string;
  label: string;
  /** Plain-English "exactly what this means" — shown in the card's ⓘ tooltip. */
  description?: string;
  bucket: SalesBucket;
  format: SalesFormat;
  kind: SalesKind;
  /** False = no data source wired yet — the FE hides the card and lists it below. */
  available: boolean;
  today: number | null;
  yesterday: number | null;
  last7Days: number | null;
  last30Days: number | null;
  /** Per-day values for the 7 days ending on the reference day (oldest → newest). */
  spark: number[];
  /** ISO date (YYYY-MM-DD) for each spark point, 1:1 with `spark`. */
  sparkDates: string[];
  /** Signed % change of Today vs the 7-day mean. */
  trendPct: number;
}

export interface SalesBucketInfo {
  key: SalesBucket;
  label: string;
}

export interface SalesKpisResponse {
  buckets: SalesBucketInfo[];
  metrics: SalesMetric[];
  generatedAt: string;
  /** Reference date the windows anchor on (YYYY-MM-DD, IST). */
  asOf: string;
  /** True when the latest synced day pulled EasyEcom sales successfully. */
  isLive: boolean;
  /** ISO timestamp of the most recent sync covering the window. */
  lastSyncedAt?: string | null;
  /** True when the latest sync served STALE (cached) data — the live fetch failed. */
  stale?: boolean;
  /** Earliest day (YYYY-MM-DD) that has Real/Virtual data. Older history is
   *  whole-account only, so the As-of picker floors here in a scoped view. */
  splitFrom?: string | null;
  /** True while a manual refresh is still generating reports in the background.
   *  The FE keeps showing "fetching…" and polls until this flips to false. */
  syncing?: boolean;
  /** Dashboard buckets whose data is currently being refreshed. A page shows
   *  "fetching…" only while one of ITS buckets appears here, so refreshes on
   *  different pages stay independent. */
  syncingBuckets?: SalesBucket[];
}

/** Real / virtual inventory view, matching Inventory Health: `virtual` = SKUs
 *  holding China-warehouse stock, `real` = the rest. RTO/RTV read whole-account
 *  in every view — a returned parcel can hold both kinds, so it cannot be split. */
export type SalesInventoryView = 'all' | 'real' | 'virtual';

/** GET /api/sales-kpis — the bucketed dashboard metrics. */
export function getSalesKpis(
  asOf?: string,
  inventory: SalesInventoryView = 'all',
): Promise<SalesKpisResponse> {
  const params: Record<string, string> = {};
  if (asOf) params.asOf = asOf;
  if (inventory !== 'all') params.inventory = inventory;
  return apiClient
    .get<SalesKpisResponse>('/api/sales-kpis', { params })
    .then((res) => res.data);
}

/** POST /api/sales-kpis/refresh-all — one pull refreshes EVERY EasyEcom-derived
 *  read model (Sales KPI + Inventory Health) in the background, stamped with one
 *  shared timestamp so every screen's "as of" matches. Returns immediately; poll
 *  {@link getSalesKpis} / the inventory-health endpoint until `syncing` clears. */
export function refreshAllEasyEcom(): Promise<{ syncing: boolean }> {
  return apiClient
    .post<{ syncing: boolean }>('/api/sales-kpis/refresh-all', {})
    .then((res) => res.data);
}
