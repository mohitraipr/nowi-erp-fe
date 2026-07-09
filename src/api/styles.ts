// Client for the Product Development module. Mirrors the §8 endpoint
// contracts from docs/PRODUCT_DEV_MODULE_PLAN.md. Use these types
// instead of the old `articles.ts` — that file was dropped along with
// the standalone Article entity (decision #14).

import { apiClient } from './apiClient';
import type {
  Style,
  StyleVariant,
  StyleInspection,
  StyleChannelListing,
  StyleAuditLog,
  StyleSource,
  StyleLifecycle,
  ChannelName,
  ChannelState,
  InspectionVerdict,
  Gender,
  Fabric,
  FabricStockEntry,
  FabricStockEntryType,
  Colour,
} from './types';

// ── enum unions (mirror prisma/schema.prisma) ──────────────────────────
export type ArticleCategory =
  | 'winterwear'
  | 'womens_bottom_wear'
  | 'mens_bottom_wear'
  | 'womens_top_wear'
  | 'mens_top_wear'
  | 'mens_suit'
  | 'china_import';

export type SamplingStatus =
  | 'in_progress_pattern_dev'
  | 'in_progress_fabric_sourcing'
  | 'in_progress_cutting'
  | 'ready_for_inspection'
  | 'corrections_needed'
  | 'ready_for_production';

export type SampleApprovalStatus =
  | 'approved_for_production'
  | 'under_review_corrections'
  | 'pattern_correction_approved';

export type ProductionStatus =
  | 'sample_handover'
  | 'in_progress_cutting'
  | 'in_progress_stitching'
  | 'in_progress_finishing'
  | 'packing_dispatch'
  | 'warehouse_dispatch';

export type YesNo = 'yes' | 'no';
export type LiveStatus = 'live' | 'not_live';

export type StyleTab =
  | 'inbox'
  | 'in_sampling'
  | 'parked'
  | 'sample_approved'
  | 'all'
  | 'china_import'
  | 'in_pd'
  | 'cataloguing'
  | 'live';

export interface ListStylesParams {
  source?: StyleSource;
  tab?: StyleTab;
  collectionId?: number;
  samplingStatus?: SamplingStatus;
  search?: string;
  skip?: number;
  take?: number;
}

export interface StyleListResponse {
  data: Style[];
  total: number;
  skip: number;
  take: number;
}

export type CreateStyleRequest = Partial<
  Omit<
    Style,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'variants'
    | 'inspections'
    | 'channelListings'
    | 'category'
  >
> & {
  source: StyleSource;
  category: ArticleCategory;
  /** Submit fork (case C): link this design to an existing approved
   *  sample to skip sampling. Resolve by picking an existing style id… */
  basedOnStyleId?: number;
  /** …or by entering its minted style code (BE resolves to the id). */
  basedOnStyleCode?: string;
  /** 3rd-party fork: the partner's own style code, stored verbatim as the
   *  Style # (sent with source='third_party'; no NOWI minting). */
  thirdPartyStyleId?: string;
};

export type UpdateStyleRequest = Partial<CreateStyleRequest>;

export interface Option {
  value: string;
  label: string;
}
export interface StyleOptions {
  category: Option[];
  samplingStatus: Option[];
  sampleApproval: Option[];
  productionStatus: Option[];
  websiteLive: Option[];
}

export interface StylesSummary {
  attention: {
    awaitingApproval1: number;
    awaitingApproval2: number;
    readyForQc: number;
    readyToDispatch: number;
  };
  kpi: {
    stylesDeveloped: number;
    approved: number;
    inProduction: number;
    live: number;
    virtualLive: number;
  };
}

export interface LinkExtractResult {
  ok: boolean;
  imageUrl?: string;
  title?: string;
  price?: number;
  currency?: string;
  // AI-extracted, editable suggestions (best-effort):
  /** NOWI StyleGender (W/M/U). */
  gender?: 'W' | 'M' | 'U';
  /** Category.styleCode the model picked. */
  categoryCode?: string;
  /** Resolved categoryId for the picked code (when known). */
  categoryId?: number;
  /** Free-text colour → primaryColour. */
  colour?: string;
  /** Concise AI-suggested working name (no brand/SEO filler). */
  name?: string;
  /** 0..1 — drives a "please confirm" hint when low. */
  confidence?: number;
  source?:
    | 'jsonld'
    | 'opengraph'
    | 'flipkart'
    | 'myntra'
    | 'gemini_url_context'
    | 'gemini_vision';
  reason?: string;
}

// ─── Styles list/detail/CRUD ──────────────────────────────────────────
export async function listStyles(
  params: ListStylesParams = {},
): Promise<StyleListResponse> {
  const res = await apiClient.get<StyleListResponse>('/api/styles', { params });
  return res.data;
}

export async function getStyle(styleId: number | string): Promise<Style> {
  const res = await apiClient.get<Style>(`/api/styles/${styleId}`);
  return res.data;
}

export async function getStyleOptions(): Promise<StyleOptions> {
  const res = await apiClient.get<StyleOptions>('/api/styles/options');
  return res.data;
}

/** Resolve the colour family for a style — every sibling sharing its
 *  `familyCode` (the family root's stylecode). Drives the detail-page
 *  "Colour family" strip and the marketplace "other colours" group.
 *  Test-data-consistent (a family never straddles the test/prod line). */
/** BE returns the group envelope `{ familyCode, groupId, members }` (the
 *  groupId is the marketplace "other colours" group key). Consumers only need
 *  the sibling list, so we unwrap `members`; `?? []` guards a standalone /
 *  based-on style (familyCode null → empty members) and any shape surprise. */
export interface ColourGroup {
  familyCode: string | null;
  groupId: string | null;
  members: Style[];
}
export async function colourGroup(id: number): Promise<Style[]> {
  const res = await apiClient.get<ColourGroup>(`/api/styles/${id}/colour-group`);
  return res.data?.members ?? [];
}

export async function getStylesSummary(): Promise<StylesSummary> {
  const res = await apiClient.get<StylesSummary>('/api/styles/summary');
  return res.data;
}

/** Distinct primaryColour values from existing styles — feeds the
 *  Colour picker's suggestion list. Free-text under the hood, no
 *  master table; "+ Add 'X'" just commits whatever the user typed. */
export async function listDistinctColours(): Promise<string[]> {
  const res = await apiClient.get<string[]>('/api/styles/colours');
  return res.data;
}

export async function createStyle(body: CreateStyleRequest): Promise<Style> {
  const res = await apiClient.post<Style>('/api/styles', body);
  return res.data;
}

/** Payload for POST /api/styles/:id/colour-variants. Only the colour is
 * required — everything else inherits from the parent style. */
export interface CreateColourVariantRequest {
  primaryColour: string;
  referenceLink?: string | null;
  referenceImages?: string[];
  referenceImageUrl?: string | null;
  /** 3rd-party only: the partner's verbatim code for this colour (becomes the
   *  child Style #). Required when the parent is a 3rd-party style. */
  thirdPartyStyleId?: string;
}

/** Spawn a draft colour variant inheriting fabric/gender/category/CAD
 * from the parent. The new style gets its own minted styleId on
 * Approval #1; parent/child are linked via `parentStyleId`. */
export async function spawnColourVariant(
  parentId: number,
  body: CreateColourVariantRequest,
): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${parentId}/colour-variants`,
    body,
  );
  return res.data;
}

export async function patchStyle(
  styleId: number,
  body: UpdateStyleRequest,
): Promise<Style> {
  const res = await apiClient.patch<Style>(`/api/styles/${styleId}`, body);
  return res.data;
}

/** Soft delete (archive). For destructive deletes use {@link hardDeleteStyle}. */
export async function archiveStyle(styleId: number): Promise<void> {
  await apiClient.post(`/api/styles/${styleId}/archive`);
}

/** Hard delete — requires admin / production_lead on the BE. */
export async function hardDeleteStyle(styleId: number): Promise<void> {
  await apiClient.delete(`/api/styles/${styleId}`);
}

// ─── Style actions ────────────────────────────────────────────────────
/**
 * Optional body for Approval #1 — the merchandiser's intake checks
 * (fabric feasible / price OK / collection fit) plus an optional note.
 * The BE auto-sets `samplingStatus = Pattern dev` on approval, so the
 * dialog no longer asks for an initial status.
 */
export interface ApproveStyleBody {
  approval1FabricFeasible?: boolean;
  approval1PriceOk?: boolean;
  approval1CollectionFit?: boolean;
  approval1Note?: string;
}

/**
 * Optional body for Approval #2 — sample sign-off. Captures the
 * sample-verdict enum. Defaults to `approved_for_production`
 * server-side when omitted.
 */
export interface SampleApproveStyleBody {
  sampleApproval?: SampleApprovalStatus;
  note?: string;
  /** Per-style cost price. Required by the BE when the verdict advances the
   *  lifecycle (an approved sample must carry its cost). */
  costPrice?: number;
}

export async function approveStyle(
  styleId: number,
  body: ApproveStyleBody = {},
): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/approve`,
    body,
  );
  return res.data;
}

export async function parkStyle(
  styleId: number,
  body: { reason: string },
): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/park`,
    body,
  );
  return res.data;
}

export async function reviveStyle(styleId: number): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/revive`,
  );
  return res.data;
}

export async function sampleApproveStyle(
  styleId: number,
  body: SampleApproveStyleBody = {},
): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/sample-approve`,
    body,
  );
  return res.data;
}

// ─── Go-to-market lifecycle ───────────────────────────────────────────
/** sample_approved → cataloguing (cataloguingStatus = pending). */
export async function startCataloguing(styleId: number): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/start-cataloguing`,
  );
  return res.data;
}

/** Toggle the EasyEcom catalog checkpoint (internal OMS step, no side-effects). */
export async function setEasyecomDone(
  styleId: number,
  done: boolean,
): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/easyecom-checkpoint`,
    { done },
  );
  return res.data;
}

/**
 * List a marketplace channel (`listed: true`, with its public `listingUrl`) or
 * take it offline (`listed: false`). A listed channel is prepared while the
 * style is cataloguing and goes live automatically once EasyEcom is marked
 * done. `listingUrl` is required when listing.
 */
export async function setMarketplaceListing(
  styleId: number,
  body: {
    channel: ChannelName;
    listed: boolean;
    listingUrl?: string;
    /** Reason for taking the channel offline (when listed=false). */
    reason?: string;
  },
): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/marketplace-listing`,
    body,
  );
  return res.data;
}

/**
 * Take a live style out of stock — the inverse of go-live. Demotes it back to
 * the EasyEcom checkpoint (lifecycle → cataloguing, easyecom pending; its live
 * listings revert to draft), so it must be re-published to sell again. One-way:
 * the way back is the normal republish (`setEasyecomDone`). NOWI doesn't push
 * to EasyEcom — the operator zeroes the inventory there by hand.
 */
export async function markOutOfStock(
  styleId: number,
  body: {
    /** Reason for taking out of stock (recorded on the audit trail). */
    reason?: string;
  },
): Promise<Style> {
  const res = await apiClient.post<Style>(
    `/api/styles/${styleId}/actions/out-of-stock`,
    body,
  );
  return res.data;
}

/** A channel + its public listing URL + MRP — used by the "Add listings" dialog. */
export interface GoLiveChannel {
  channel: ChannelName;
  listingUrl?: string;
}

// ─── Variants ─────────────────────────────────────────────────────────
/**
 * Add a variant. Either `colour` (free text) or `fabricColourId` must be
 * present — the server defaults `colour` from the fabric-colour when only
 * the latter is given.
 */
export async function addVariant(
  styleId: number,
  body: Partial<StyleVariant> & ({ colour: string } | { fabricColourId: number }),
): Promise<StyleVariant> {
  const res = await apiClient.post<StyleVariant>(
    `/api/styles/${styleId}/variants`,
    body,
  );
  return res.data;
}

export async function patchVariant(
  styleId: number,
  variantId: number,
  body: Partial<StyleVariant>,
): Promise<StyleVariant> {
  const res = await apiClient.patch<StyleVariant>(
    `/api/styles/${styleId}/variants/${variantId}`,
    body,
  );
  return res.data;
}

// ─── Inspections ──────────────────────────────────────────────────────
export async function addInspection(
  styleId: number,
  body: { remarks: string; verdict?: InspectionVerdict },
): Promise<StyleInspection> {
  const res = await apiClient.post<StyleInspection>(
    `/api/styles/${styleId}/inspections`,
    body,
  );
  return res.data;
}

export async function patchInspection(
  styleId: number,
  roundNo: number,
  body: Partial<StyleInspection>,
): Promise<StyleInspection> {
  const res = await apiClient.patch<StyleInspection>(
    `/api/styles/${styleId}/inspections/${roundNo}`,
    body,
  );
  return res.data;
}

// ─── Channel listings ─────────────────────────────────────────────────
export async function updateChannel(
  styleId: number,
  channel: ChannelName,
  body: Partial<StyleChannelListing>,
): Promise<StyleChannelListing> {
  const res = await apiClient.patch<StyleChannelListing>(
    `/api/styles/${styleId}/channels/${channel}`,
    body,
  );
  return res.data;
}

// ─── Link extraction ──────────────────────────────────────────────────
/** Best-effort — resolves even when extraction fails (ok:false). */
export async function extractLink(url: string): Promise<LinkExtractResult> {
  try {
    const res = await apiClient.post<LinkExtractResult>(
      '/api/styles/extract-link',
      { url },
    );
    return res.data;
  } catch {
    return {
      ok: false,
      reason: 'Could not reach the extractor — paste or upload the image.',
    };
  }
}

/**
 * Classify an already-uploaded reference image (GCS objectPath) with Gemini
 * vision — the fallback for sites url-context can't read (e.g. Amazon).
 * Best-effort: resolves even when classification fails (ok:false).
 */
export async function classifyImage(
  objectPath: string,
): Promise<LinkExtractResult> {
  try {
    const res = await apiClient.post<LinkExtractResult>(
      '/api/styles/classify-image',
      { objectPath },
    );
    return res.data;
  } catch {
    return { ok: false, reason: 'Could not classify the image.' };
  }
}

// ─── Master data (fabrics / fabric types) ─────────────────────────────
export async function listFabrics(): Promise<Fabric[]> {
  const res = await apiClient.get<Fabric[]>('/api/fabrics');
  return res.data;
}

/** Shape accepted by create/update — `compositions` percent may be number or string. */
export interface FabricUpsertBody {
  name?: string;
  pricePerUnit?: string | number | null;
  /** GCS object path of the fabric's representative image (from the upload flow). */
  imagePath?: string | null;
  notes?: string | null;
  isActive?: boolean;
  count?: string | null;
  construction?: string | null;
  gsm?: number | null;
  cuttableWidth?: string | number | null;
  unitOfMeasure?: 'meter' | 'kg' | 'oz' | null;
  compositions?: { fibre: string; percent: number }[];
  /** Colour-master ids this fabric is stocked in (full desired set). */
  colourIds?: number[];
}

/** Curated colour master — feeds the fabric colours multi-select. */
export async function listColourMaster(): Promise<Colour[]> {
  const res = await apiClient.get<Colour[]>('/api/colours');
  return res.data;
}

/** Create a colour-master row (PD editors). Used by the fabric
 *  editor's "+ Add colour" popup. */
export async function createColourMaster(body: {
  name: string;
  hex?: string | null;
  family?: string | null;
}): Promise<Colour> {
  const res = await apiClient.post<Colour>('/api/colours', body);
  return res.data;
}

export async function createFabric(
  body: FabricUpsertBody & { name: string },
): Promise<Fabric> {
  const res = await apiClient.post<Fabric>('/api/fabrics', body);
  return res.data;
}

export async function patchFabric(
  id: number,
  body: FabricUpsertBody,
): Promise<Fabric> {
  const res = await apiClient.patch<Fabric>(`/api/fabrics/${id}`, body);
  return res.data;
}

export async function deleteFabric(id: number): Promise<void> {
  await apiClient.delete(`/api/fabrics/${id}`);
}

// ─── Fabric stock ledger ──────────────────────────────────────────────
export async function listFabricStock(
  fabricId: number,
): Promise<FabricStockEntry[]> {
  const res = await apiClient.get<FabricStockEntry[]>(
    `/api/fabrics/${fabricId}/stock`,
  );
  return res.data;
}

// Stock is written only via fabric challans (IN/OUT) — see api/fabricChallans.

// Re-export common types so screens don't need to reach into types.ts.
export type {
  Style,
  StyleVariant,
  StyleInspection,
  StyleChannelListing,
  StyleAuditLog,
  StyleSource,
  StyleLifecycle,
  ChannelName,
  ChannelState,
  InspectionVerdict,
  Gender,
  Fabric,
  FabricStockEntry,
  FabricStockEntryType,
};
