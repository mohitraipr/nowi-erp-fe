import { apiClient } from './apiClient';
import type { StyleLifecycle } from './types';

// Types co-located with the caller (same convention as inventoryHealth.ts).

/** Why the batch exists. Decides whether `suggestedQty` means anything, and
 *  whether the batch reconciles against the forecast at all. */
export type BatchOrigin = 'forecast' | 'style' | 'external';

/**
 * Ordered production pipeline. A batch opens at `planning` (pre-floor staging)
 * and moves to `cutting` via `sendToProduction`. `completed` is reachable ONLY
 * through `completeBatch` (the sole place per-size produced quantities are
 * captured), and `cancelled` only through `cancelBatch`. Everything else is a
 * free move in either direction.
 */
export type BatchStatus =
  | 'planning'
  | 'cutting'
  | 'stitching'
  | 'finishing'
  | 'completed'
  | 'dispatched'
  | 'cancelled';

/** The stages the inline dropdown offers — mirrors BE `ADVANCEABLE_STATUSES`. */
export const ADVANCEABLE_STATUSES: BatchStatus[] = [
  'cutting',
  'stitching',
  'finishing',
  'dispatched',
];

/** Stepper order for display. `cancelled` is an off-ramp, not a step. */
export const BATCH_STAGE_ORDER: BatchStatus[] = [
  'cutting',
  'stitching',
  'finishing',
  'completed',
  'dispatched',
];

export interface BatchSizeLine {
  sku: string;
  size: string;
  qtyPlanned: number;
  /** Units recorded into each floor stage (the sum of that stage's entries).
   *  0 also means "nothing recorded" — lots that ran before the lot journey
   *  shipped have no history to show. */
  qtyCut: number;
  qtyStitched: number;
  /** Pieces CURRENTLY out for alteration — a signed balance the server keeps:
   *  +n when pieces are sent back, -n when they return or are scrapped. */
  qtyAltered: number;
  qtyFinished: number;
  /** Written off at alteration; these never reach finishing. */
  qtyScrapped: number;
  /** null = no forecast existed (style-origin), NOT "forecast said zero". */
  suggestedQty: number | null;
  qtyProduced: number | null;
  /** Units already shipped on challans; `qtyProduced - qtyDispatched` is what
   *  remains to dispatch. Always a number (0 when nothing shipped). */
  qtyDispatched: number;
}

export interface ProductionBatch {
  id: number;
  batchNo: string;
  origin: BatchOrigin;
  status: BatchStatus;
  styleKey: string | null;
  styleId: number | null;
  /** Brand for an external batch; null = Nowi's own production. */
  brandId: number | null;
  brandName: string | null;
  externalSku: string | null;
  /** Colour master for an external batch; null on style/forecast batches. */
  colourId: number | null;
  colourName: string | null;
  colourHex: string | null;
  /** Tailor the lot went to the floor with; their code is inside `batchNo`. */
  tailorId: number | null;
  tailorName: string | null;
  /** ERP Style # when linked, external SKU for an external batch, else the key. */
  styleRef: string | null;
  name: string | null;
  imageUrl: string | null;
  sizes: BatchSizeLine[];
  qtyPlanned: number;
  /** null on style/external batches — render "—", never 0. */
  qtySuggested: number | null;
  qtyProduced: number | null;
  statusChangedAt: string;
  /** Whole days sat in the current status — amber past 7. */
  daysInStatus: number;
  /** Entered Planning — the "Planning" timeline stamp. */
  startedAt: string;
  /** Entered the floor — null while still in Planning. */
  productionStartedAt: string | null;
  completedAt: string | null;
  dispatchedAt: string | null;
  createdBy: { id: number; name: string } | null;
  notes: string | null;
  shortfallReason: string | null;
  cancelReason: string | null;
}

export interface ProductionKpis {
  /** status=planning — what the "Planning" tab lists. */
  planningBatches: number;
  /** cutting/stitching/finishing only — what the "Production" tab lists. */
  inProductionBatches: number;
  unitsInPipeline: number;
  /** Distinct styles across open batches — the "Styles in flight" card. Two
   *  batches of one style count once, so it is not the sum of the split below. */
  stylesInPipeline: number;
  /** Renders as the card sub-line "12 forecast · 4 style · 2 external". */
  stylesByOrigin: { forecast: number; style: number; external: number };
  unitsByOrigin: { forecast: number; style: number; external: number };
  /** Open, not-yet-completed batches sat 7+ days in their CURRENT status — the
   *  same threshold the board ambers in its "In status" column. */
  stalledBatches: number;
  stalledOldestDays: number | null;
  /** Completed batches still holding units no challan has shipped. */
  dueToDispatchBatches: number;
  dueToDispatchUnits: number;
  /** Row count per board tab — the chips on the tab strip. */
  tabCounts: {
    planning: number;
    in_production: number;
    completed: number;
    parked: number;
  };
}

export interface ListBatchesResponse {
  rows: ProductionBatch[];
  total: number;
  kpis: ProductionKpis;
}

/** Board tabs. `to_start` (Suggested) is served by GET /inventory-health — no
 *  batch rows yet. `dispatched` has no tab (that system ships later). */
export type ProductionTab = 'planning' | 'in_production' | 'completed';

export interface ListBatchesParams {
  tab?: ProductionTab;
  status?: BatchStatus;
  origin?: BatchOrigin;
  search?: string;
  /** Inclusive `startedAt` window, local `YYYY-MM-DD` (interpreted IST server-side). */
  from?: string;
  to?: string;
  skip?: number;
  take?: number;
}

export function getBatches(params: ListBatchesParams = {}): Promise<ListBatchesResponse> {
  const q: Record<string, string> = {};
  if (params.tab) q.tab = params.tab;
  if (params.status) q.status = params.status;
  if (params.origin) q.origin = params.origin;
  if (params.search) q.search = params.search;
  if (params.from) q.from = params.from;
  if (params.to) q.to = params.to;
  if (params.skip != null) q.skip = String(params.skip);
  if (params.take != null) q.take = String(params.take);
  return apiClient.get<ListBatchesResponse>('/api/production/batches', { params: q }).then((r) => r.data);
}

/**
 * One selectable style in the production picker, sourced from the EasyEcom
 * catalog rather than the ERP styles table — anything Nowi sells is producible.
 * `linkedStyleId` is null for the many styles that were listed and sold without
 * ever passing through the ERP design pipeline.
 */
export interface CatalogStyle {
  /** Base EasyEcom style key — versions `(N)` already collapsed by the BE. */
  styleKey: string;
  name: string | null;
  imageUrl: string | null;
  sizes: { sku: string; size: string; inFlightQty: number }[];
  linkedStyleId: number | null;
  erpStyleId: string | null;
  lifecycle: StyleLifecycle | null;
  alreadyInProduction: boolean;
}

/** Server-side search over the EasyEcom catalog. Replaces the old
 *  load-one-page-and-filter-in-the-browser picker — the catalog is past that. */
export function searchCatalog(q: string, take = 30): Promise<{ rows: CatalogStyle[]; total: number }> {
  return apiClient
    .get<{ rows: CatalogStyle[]; total: number }>('/api/production/catalog', {
      params: { q: q || undefined, take },
    })
    .then((r) => r.data);
}

export interface StyleSizes {
  styleId: number;
  styleRef: string | null;
  name: string | null;
  imageUrl: string | null;
  /** `inFlightQty` = units already committed for this size across the style's
   *  open batches — drives the "already in production" confirm on intake. */
  sizes: { sku: string; size: string; inFlightQty: number }[];
  /** True when any size is already in flight — show the confirm dialog. */
  alreadyInProduction: boolean;
}

/** Seeds the start dialog when production is started for an existing Nowi style
 *  (dashboard live tab / intake search). Also reports what's already in flight. */
export function getStyleSizes(styleId: number): Promise<StyleSizes> {
  return apiClient.get<StyleSizes>(`/api/production/style-sizes/${styleId}`).then((r) => r.data);
}

export interface CreateBatchItem {
  sku: string;
  size: string;
  qtyPlanned: number;
  /** OMIT on a style/external batch — absent means "no forecast existed". */
  suggestedQty?: number;
}

export interface CreateBatchBody {
  origin: BatchOrigin;
  styleKey?: string;
  styleId?: number;
  /** Required on an external batch; omitted for Nowi's own. */
  brandId?: number;
  /** Required on an external batch (free-text SKU, no Sku row). */
  externalSku?: string;
  /** Colour master FK — REQUIRED on an external (brand) batch. */
  colourId?: number;
  /** Uploaded image (GCS object path) for an external batch. */
  imagePath?: string;
  /** Skip Planning and open on the floor (cutting); stamps both timestamps. */
  directToProduction?: boolean;
  /** Tailor for a lot opening straight on the floor — their short code becomes
   *  the lot number suffix. Ignored when the lot lands in Planning. */
  tailorId?: number;
  notes?: string;
  items: CreateBatchItem[];
}

export function createBatch(body: CreateBatchBody): Promise<ProductionBatch> {
  return apiClient.post<ProductionBatch>('/api/production/batches', body).then((r) => r.data);
}

/** Sending `items` REPLACES the size lines wholesale. */
export function updateBatch(
  id: number,
  body: { items?: CreateBatchItem[]; notes?: string },
): Promise<ProductionBatch> {
  return apiClient.patch<ProductionBatch>(`/api/production/batches/${id}`, body).then((r) => r.data);
}

/** Per-size line for a stage move: how many pieces reached that stage. It does
 *  NOT touch the plan — planned is fixed when the lot is created. */
export interface StageQtyItem {
  sku: string;
  qty: number;
}

export function advanceBatch(
  id: number,
  status: BatchStatus,
  items?: StageQtyItem[],
): Promise<ProductionBatch> {
  return apiClient
    .post<ProductionBatch>(`/api/production/batches/${id}/actions/advance`, {
      status,
      ...(items ? { items } : {}),
    })
    .then((r) => r.data);
}

/** Planning → floor. Records what went into cutting and names the tailor, whose
 *  short code turns lot `1001` into `1001-RAJ`. `fabricFeasible` is the sender's
 *  confirmation that the fabric exists; it lands on the audit entry. */
export function sendToProduction(
  id: number,
  items: StageQtyItem[],
  extra?: { tailorId?: number; fabricFeasible?: boolean },
): Promise<ProductionBatch> {
  return apiClient
    .post<ProductionBatch>(`/api/production/batches/${id}/actions/send-to-production`, {
      items,
      ...(extra?.tailorId != null ? { tailorId: extra.tailorId } : {}),
      ...(extra?.fabricFeasible != null ? { fabricFeasible: extra.fabricFeasible } : {}),
    })
    .then((r) => r.data);
}

export function completeBatch(
  id: number,
  items: { sku: string; qtyProduced: number }[],
  shortfallReason?: string,
): Promise<ProductionBatch> {
  return apiClient
    .post<ProductionBatch>(`/api/production/batches/${id}/actions/complete`, { items, shortfallReason })
    .then((r) => r.data);
}

/** One recording on a lot's timeline — "300 M cut on Tuesday by Asha". */
export interface LotTimelineEntry {
  id: number;
  sku: string;
  size: string;
  stage: 'cutting' | 'stitching' | 'alteration' | 'finishing' | 'scrapped';
  qty: number;
  note: string | null;
  recordedAt: string;
  recordedBy: { id: number; name: string } | null;
}

export interface LotDetail extends ProductionBatch {
  timeline: LotTimelineEntry[];
}

/** The lot page's payload: the batch plus every stage entry, oldest first. */
export function getLot(id: number): Promise<LotDetail> {
  return apiClient.get<LotDetail>(`/api/production/lots/${id}`).then((r) => r.data);
}

/** Drop a style from the production queue (Parked tab). */
export function parkStyle(styleKey: string): Promise<void> {
  return apiClient.post(`/api/production/parked/${encodeURIComponent(styleKey)}`).then(() => undefined);
}

/** Restore a parked style to the queue. */
export function unparkStyle(styleKey: string): Promise<void> {
  return apiClient.delete(`/api/production/parked/${encodeURIComponent(styleKey)}`).then(() => undefined);
}

export function cancelBatch(id: number, reason: string): Promise<ProductionBatch> {
  return apiClient
    .post<ProductionBatch>(`/api/production/batches/${id}/actions/cancel`, { reason })
    .then((r) => r.data);
}

/** One size's outcome when pieces come back from alteration. */
export interface AlterationReturnItem {
  sku: string;
  qtyFinished: number;
  qtyScrapped?: number;
}

/**
 * Record pieces coming BACK from alteration. Not a stage move — the lot is
 * already in finishing, so only the per-size counts change. The server rejects
 * returning more than is outstanding (`stitched - finished - scrapped`).
 */
export function alterationReturn(
  id: number,
  items: AlterationReturnItem[],
): Promise<ProductionBatch> {
  return apiClient
    .post<ProductionBatch>(`/api/production/batches/${id}/actions/alteration-return`, { items })
    .then((r) => r.data);
}
