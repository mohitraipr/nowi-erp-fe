import { apiClient } from './apiClient';

// Types co-located with the caller (same convention as salesKpis.ts).

/** 4 tiers only. `needsAction` = styles that are out OR critical (never a sum:
 *  one style with both an out and a critical size would be counted twice). */
export type Urgency = 'out' | 'critical' | 'watch' | 'healthy';

/** Sales-recency lens (NOW-anchored): `dead` = stocked but no sale in 60d;
 *  `slow` = stocked, idle 30d but sold within 60d; `active` = sold within 30d. */
export type Aging = 'active' | 'slow' | 'dead';

/** Every list lens the server accepts: urgency tiers + aging + new arrivals.
 *  `out` = every size gone; `cut` = only some (a broken size ladder). */
export type FilterKey = 'all' | 'out' | 'cut' | 'critical' | 'watch' | 'slow' | 'dead' | 'new';

/** One size row (per SKU). */
export interface InventorySize {
  size: string;
  sku: string;
  urgency: Urgency;
  /** Sales-recency lens — drives the slow/dead tabs + pill. */
  aging: Aging;
  /** Days of cover left at the current DRR; null when DRR is 0/unknown. */
  coverDays: number | null;
  /** Daily run rate — units sold per day. */
  drr: number;
  /** 'low' = too little sales history to trust the DRR/cover. */
  confidence: 'high' | 'low';
  currentStock: number;
  /** Units already committed to open production batches (planning + on the floor)
   *  for this size. Folded into `available` server-side, so cover/make already
   *  account for it — this is the display figure for the Pipeline column. */
  pipelineQty: number;
  /** Suggested units to make to restore healthy cover. */
  makeQty: number;
  /** Unmet demand per day once below target cover (units/day) — "stock at risk
   *  per day". No rupees. */
  atRiskUnitsPerDay: number;
  /** Raw daily units over the response window (aligned to response `trendDates`).
   *  Drives the per-size interactive trend sparkline. */
  trend: number[];
}

/** A style group — an expandable parent row (summary) over its at-risk `sizes`. */
export interface InventoryStyle {
  styleKey: string;
  name: string | null;
  /** Signed URL or GCS object path or null (shown on each size child row). */
  imageUrl: string | null;
  linkedStyleId: number | null;
  /** Canonical ERP Style # (NOWI-…) when linked to the catalog, else null.
   *  The human identity shown in Sampling — prefer it over the EasyEcom key. */
  erpStyleId: string | null;
  /** Real ERP listing URLs — one clickable channel chip each (usually empty). */
  marketplaceLinks: { channel: string; url: string }[];
  /** Most-urgent tier across its sizes — drives the parent pill. */
  worstUrgency: Urgency;
  /** Suggested units to make across its sizes. */
  makeTotal: number;
  /** Tiny seller — de-emphasised in the list (shown, not hidden). */
  lowVolume: boolean;
  /** Manually marked discontinued — still shown, but forced to the bottom. */
  discontinued: boolean;
  /** Linked ERP style went live within the last 7 days — drives the new-arrivals
   *  tab + badge. False when the style isn't linked to the ERP catalog. */
  isNew: boolean;
  sizes: InventorySize[];
}

export interface InventoryKpis {
  unitsToMake: number;
  needsAction: number;
  /** Every size gone — nothing of the style is sellable. */
  outOfStock: number;
  /** Some sizes gone, some still sellable. */
  cutSize: number;
  critical: number;
  watch: number;
  healthy: number;
  /** Aging-lens counts (per-SKU, like the urgency chips). */
  slow: number;
  dead: number;
  /** Recently-live styles (per-style). */
  newArrivals: number;
  totalStyles: number;
  totalSkus: number;
}

export interface InventoryHealthResponse {
  /** ISO timestamp of the last sync, or null if never synced. */
  syncedAt: string | null;
  /** True while a background refresh is still running. Poll until false. */
  syncing: boolean;
  /** True when the last successful sync is older than a nightly cycle (~26h). */
  stale: boolean;
  kpis: InventoryKpis;
  /** Style count AFTER filter+search, BEFORE the page slice (drives scroll). */
  total: number;
  /** Day keys (YYYY-MM-DD) the per-size `trend` arrays align to. */
  trendDates: string[];
  /** Distinct style categories across the full set (sorted) — drives the category dropdown. */
  categories: string[];
  /** One page of style groups (server-side filtered/trimmed/sorted/sliced). */
  styles: InventoryStyle[];
}

/** Real/virtual inventory view: virtual = has China-warehouse stock. */
export type InventoryView = 'all' | 'real' | 'virtual';

export interface InventoryHealthParams {
  /** LOCAL YYYY-MM-DD window; both or neither. Omit for the precomputed view. */
  from?: string;
  to?: string;
  skip?: number;
  limit?: number;
  filter?: string;
  inventory?: InventoryView;
  search?: string;
  /** Exact style category (from the response `categories` list). Omit = all. */
  category?: string;
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc';
  /** Production Suggested tab: hide styles that already have an open batch. */
  excludeInProduction?: boolean;
}

/** GET /api/inventory-health — one page of the per-size stockout forecast.
 *  The server filters/searches/sorts the full set and returns a page + total. */
export function getInventoryHealth(params: InventoryHealthParams = {}): Promise<InventoryHealthResponse> {
  const q: Record<string, string> = {};
  if (params.from) q.from = params.from;
  if (params.to) q.to = params.to;
  if (params.skip != null) q.skip = String(params.skip);
  if (params.limit != null) q.limit = String(params.limit);
  if (params.filter && params.filter !== 'all') q.filter = params.filter;
  if (params.inventory && params.inventory !== 'all') q.inventory = params.inventory;
  if (params.search) q.search = params.search;
  if (params.category) q.category = params.category;
  if (params.sortKey) q.sortKey = params.sortKey;
  if (params.sortDir) q.sortDir = params.sortDir;
  if (params.excludeInProduction) q.excludeInProduction = '1';
  return apiClient.get<InventoryHealthResponse>('/api/inventory-health', { params: q }).then((r) => r.data);
}

/** Mark / unmark a product (by styleKey) discontinued — sinks it to the bottom. */
export function setStyleDiscontinued(styleKey: string, discontinued: boolean): Promise<void> {
  return apiClient.post('/api/inventory-health/discontinued', { styleKey, discontinued }).then(() => undefined);
}
