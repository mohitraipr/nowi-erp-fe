// Hand-written minimal types. Will be regenerated from BE OpenAPI via `pnpm gen:api`.

// Mirrors the BE Prisma `UserRole` enum (12 values). Kept in sync with
// `nowi-erp-api` schema.prisma + the FE role sets in `lib/userRoles.ts`.
export type UserRole =
  | 'admin'
  | 'floor_manager'
  | 'stitching_master'
  | 'finishing_master'
  | 'viewer'
  // Submit-only: can file a design intake and nothing else.
  | 'design_submitter'
  // ── Product Development multi-role values ──────────────────────────
  | 'sampling_editor'
  | 'sampling_lead'
  // Production admin — full access to production/floor + ops master-data
  // and the main dashboard; sits above floor_manager.
  | 'production_lead'
  // Production desk: starts batches off the Inventory Health forecast (or a
  // live style) and walks them through the floor stages. Not a PD editor;
  // cancelling a batch stays with admin + production_lead.
  | 'production_editor'
  // Narrow go-to-market role: create a design + do cataloguing (EasyEcom +
  // marketplace take-offline). No editing, approving, or going live.
  | 'cataloguer'
  // Fabric desk owner: full read/write/delete over the fabric domain (fabric
  // master, stock ledger, supplier challans); lands on the dashboard. Not a
  // general PD editor.
  | 'fabric_manager'
  // Receiving warehouse desk: sees inbound production challans and accepts them
  // (records received-per-size, flags mismatches). Read-only on the rest of
  // production — cannot start batches, move stages, or create dispatches.
  | 'warehouse_manager';

export interface User {
  id: string;
  name: string;
  /** Primary role — the legacy single-role guard reads this. */
  role: UserRole;
  /** Extra roles granted via UserRoleAssignment rows. Does NOT include
   *  the primary role; use `userAllRoles(user)` for the union. */
  roleAssignments?: Array<{ role: UserRole }>;
  isTrainingMode: boolean;
  onboardedAt?: string | null;
  mobileNumber?: string;
  isActive?: boolean;
}

export interface VerifyOtpResponse {
  token: string;
  user: User;
}

// ─── Master data ──────────────────────────────────────────────────────────

export interface Vendor {
  id: string;
  code: string;
  name: string;
  isInternal: boolean;
  easyecomEnabled: boolean;
  consumptionApiEnabled: boolean;
  isActive: boolean;
}

export interface Sku {
  id: string;
  code: string;
  baseCode: string;
  sizeLabel: string;
  brand?: string | null;
  gender?: string | null;
  category?: string | null;
  originVendorId?: string | null;
  costPrice?: number | null;
  mrp?: number | null;
  sellingPrice?: number | null;
}

// ─── Orders / lots ────────────────────────────────────────────────────────

export type OrderStatus =
  | 'receiving'
  | 'in_stitching'
  | 'in_finishing'
  | 'in_rework'
  | 'dispatched'
  | 'closed'
  | 'closed_with_adjustment'
  | 'stuck';

export interface Order {
  id: string;
  orderNo: string;
  inboundChallanId: string;
  status: OrderStatus;
  createdAt: string;
  closedAt?: string | null;
}

/** Aggregated qty per size label, e.g. { S: 50, M: 30 }. */
export type SizeMatrix = Record<string, number>;

export interface Lot {
  id: number;
  lotNo: string;
  vendorId: string;
  vendorLotNo?: string | null;
  inboundChallanId?: number | null;
  orderId: number;
  /** Optional legacy. Real per-size SKU lives on the Style. */
  sku?: string;
  baseCode?: string | null;
  qtyIn: SizeMatrix;
  /**
   * Sum of forward-receipt qty per stage code (`stitching`, `finishing`, …),
   * if the BE list endpoint included it. Lets the queue card show
   * "X of Y forwarded" without N+1 availability queries.
   */
  stageForwarded?: Partial<Record<string, number>>;
  /**
   * Mirror of stageForwarded for scrap events. `forwarded + scrapped >=
   * totalUnits(qtyIn)` ⇒ nothing left to do at that stage, so queue UIs
   * can hide the lot once work is finished even before status advances.
   */
  stageScrapped?: Partial<Record<string, number>>;
  /**
   * Stage receipts for this lot (only included on `getLot`, not on the
   * list endpoint). Used by the finishing detail screen to compute
   * per-size dispatch defaults.
   */
  receipts?: Array<{
    id: number;
    stageId: number;
    sizeLabel: string;
    qty: number;
    kind: 'forward' | 'rework_return' | 'rework_redo';
    receivedAt: string;
  }>;
  /**
   * Open rework issues for this lot (`getLot` only) — reason + defect
   * photos the assigned stitcher must see before redoing the work.
   */
  reworkIssues?: ReworkIssue[];
  /**
   * Count of open/in-progress rework issues (list endpoint only). Drives
   * the "N need rework" badge on the stitcher queue without an N+1.
   */
  openReworkCount?: number;
  /** Stitching master this lot is assigned to. `null` = pending stitching assignment. */
  assignedStitcherUserId?: number | null;
  /** Finishing master this lot is assigned to. `null` = pending finishing assignment. */
  assignedFinisherUserId?: number | null;
  /** Training/test row. Floor screens may flag these so they're not mistaken for live work. */
  isTestData?: boolean;
  assignedStitcher?: { id: number; name: string } | null;
  assignedFinisher?: { id: number; name: string } | null;
  vendor?: Vendor | null;
  order?: Order | null;
  /** Embedded NOWI Style (added when the BE response includes it). */
  style?: {
    id: number;
    styleId: string;
    gender: 'W' | 'M' | 'U';
    categoryCode: string;
    category?: { id: number; code: string; name: string };
  } | null;
  createdAt: string;
}

// ─── Styles ───────────────────────────────────────────────────────────────

/** W = Women, M = Men, U = Unisex. Mirrors the BE enum. */
export type StyleGender = 'W' | 'M' | 'U';

export interface CategoryWithStyleCode {
  id: number;
  code: string;
  name: string;
  styleCode: string | null;
  styleCounter: number;
  isActive: boolean;
}

/** Collection master — seasonal/thematic grouping a design is tagged with. */
export interface Collection {
  id: number;
  name: string;
  code: string | null;
  isActive: boolean;
  isTestData: boolean;
  createdAt: string;
}

/** Lightweight collection shape embedded on a Style (listInclude). */
export interface CollectionLite {
  id: number;
  name: string;
  code: string | null;
}

// The canonical `Style` entity now lives in the Product Development
// section below — it extends the legacy floor-intake fields (id,
// styleId, categoryCode, category) with all PD intake / sampling /
// approval columns. See §6 of docs/PRODUCT_DEV_MODULE_PLAN.md.

// ─── Product Development — Styles, variants, inspections, channels ──
// Source of truth: docs/PRODUCT_DEV_MODULE_PLAN.md §6.

export type StyleSource =
  | 'sampling'
  | 'china_import'
  | 'legacy_floor_intake'
  // 3rd-party finished goods — the partner's own style code is typed at intake
  // and stored verbatim as the Style # (no NOWI minting). Skips sampling.
  | 'third_party'
  // Manufactured by a 3rd party to our spec — the system mints the Style #
  // (NOWI prefix) at Approval #1, like sampling. Skips sampling, goes to
  // cataloguing like china_import.
  | 'third_party_manufactured';

export type StyleLifecycle =
  | 'draft'
  | 'parked'
  | 'in_sampling'
  | 'sample_approved'
  // Go-to-market lifecycle (between sample_approved and archived):
  | 'cataloguing'
  | 'live'
  | 'archived'
  // v2 lifecycle states (kept for forward compat / type completeness):
  | 'in_pd'
  | 'qc'
  | 'dispatched';

/** Cataloguing sub-state while a style is in the `cataloguing` lifecycle. */
export type CataloguingStatus = 'pending' | 'done';

export type ChannelName =
  | 'myntra'
  | 'nykaa'
  | 'nowi_shopify'
  | 'amazon'
  | 'other';
export type ChannelState = 'off' | 'draft' | 'live';
export type InspectionVerdict = 'pending' | 'corrections_needed' | 'approved';
export type Gender = 'women' | 'men' | 'unisex';

export type FabricUnitOfMeasure = 'meter' | 'kg' | 'oz';

export interface FabricComposition {
  id?: number;
  fibre: string;
  percent: string;
}

/** Curated colour-master swatch (also the source for fabric colours). */
export interface Colour {
  id: number;
  name: string;
  hex: string | null;
  family: string | null;
  isActive: boolean;
}

/**
 * A colour a fabric is stocked in. `id` is the FabricColour row id — the
 * value sent back as `fabricColourId` on stock entries and variants.
 */
export interface FabricColour {
  id: number;
  colourId: number;
  name: string;
  hex: string | null;
  family: string | null;
  /** Derived child fabric code `{fabric.code}-{suffix}`, e.g. `FAB-00001-NVY`. */
  code?: string | null;
  /** Current (latest-paid) price for this colour — ₹ per fabric UoM. */
  pricePerUnit?: number | null;
  /** GCS path of this colour's swatch image (optional). */
  imagePath?: string | null;
  /** Per-(fabric, colour) availability: SUM of stock entries for this colour. */
  availableQuantity?: number;
}

export interface Fabric {
  id: number;
  /** NOWI-minted parent fabric code, e.g. `FAB-00001`. */
  code?: string | null;
  name: string;
  /** GCS object path of the fabric's representative image. */
  imagePath?: string | null;
  /** @deprecated Price now lives per colour child (`FabricColour.pricePerUnit`). */
  pricePerUnit: string | null;
  /** Derived classification from the dominant fibre in `compositions`. */
  typeLabel?: string | null;
  notes: string | null;
  isActive: boolean;
  count: string | null;
  construction: string | null;
  gsm: number | null;
  cuttableWidth: string | null;
  unitOfMeasure: FabricUnitOfMeasure | null;
  isBlended: boolean;
  compositions: FabricComposition[];
  /** Active colours this fabric is stocked in. */
  colours?: FabricColour[];
  /** Computed: SUM of all stock-ledger entries (signed). */
  availableQuantity?: number;
  updatedAt?: string;
}

export type FabricStockEntryType = 'receipt' | 'consumption' | 'adjustment';

export interface FabricStockEntry {
  id: number;
  fabricId: number;
  /** Which fabric-colour this entry moves; null = unattributed/legacy. */
  fabricColourId: number | null;
  /** Hydrated by the ledger read — the colour name/hex for display. */
  fabricColour?: { id: number; colour: { name: string; hex: string | null } } | null;
  /** Signed: positive for receipt, negative for consumption. */
  quantity: string;
  entryType: FabricStockEntryType;
  note: string | null;
  styleId: number | null;
  createdBy: number | null;
  createdAt: string;
  isTestData?: boolean;
}

// ── Fabric receipt challans ──────────────────────────────────────────────

/** One fabric line of a challan to record (becomes a `receipt` entry). */
/** Direction of a fabric challan: `in` adds stock, `out` reduces it. */
export type FabricChallanDirection = 'in' | 'out';

export interface FabricChallanLineInput {
  /** The colour child (FabricColour id) this line moves — the stocked unit. */
  fabricColourId: number;
  /** Positive magnitude in the fabric's UoM. */
  quantity: number;
  /** Rate per unit (₹ / UoM). IN only — refreshes the colour child's price. */
  pricePerUnit?: number | null;
  note?: string | null;
}

export interface CreateFabricChallanInput {
  /** Movement direction — defaults to `in` on the server when omitted. */
  direction?: FabricChallanDirection;
  challanNo: string;
  /** ISO yyyy-mm-dd (the date printed on the paper challan). */
  challanDate: string;
  /** Vendor id (structured source for an IN challan). */
  vendorId?: number | null;
  supplier: string;
  transportMode?: string | null;
  placeOfSupply?: string | null;
  note?: string | null;
  lines: FabricChallanLineInput[];
}

/** A recorded challan line (the underlying receipt entry), hydrated for view. */
export interface FabricChallanLine {
  id: number;
  fabricId: number;
  fabricColourId: number | null;
  quantity: string;
  note: string | null;
  fabric?: {
    id: number;
    name: string;
    unitOfMeasure: FabricUnitOfMeasure | null;
  } | null;
  fabricColour?: { id: number; colour: { name: string; hex: string | null } } | null;
}

export interface FabricChallan {
  id: number;
  challanNo: string;
  challanDate: string;
  supplier: string;
  transportMode: string | null;
  placeOfSupply: string | null;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  isTestData?: boolean;
  /** Present on the detail read. */
  entries?: FabricChallanLine[];
  /** Present on the list read. */
  _count?: { entries: number };
}

export interface StyleVariant {
  id: number;
  styleId: number;
  /** Effective product colour (defaults from the fabric-colour; overridable). */
  colour: string;
  fabricId: number | null;
  fabric?: Pick<Fabric, 'id' | 'name'> | null;
  /** The fabric-colour this variant is cut from (provenance / stock). */
  fabricColourId: number | null;
  fabricColour?: {
    id: number;
    colourId: number;
    colour: { name: string; hex: string | null };
  } | null;
  samplingStatus: string | null;
  sampleApproval: string | null;
  cuttingQty: number | null;
  stitchingOutput: number | null;
  packagingQty: number | null;
  websiteLive: 'live' | 'not_live' | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StyleInspection {
  id: number;
  styleId: number;
  roundNo: number;
  inspectorId: number | null;
  inspector?: { id: number; name: string } | null;
  remarks: string;
  verdict: InspectionVerdict;
  isArchived: boolean;
  inspectedAt: string;
}

export interface StyleChannelListing {
  id: number;
  styleId: number;
  channel: ChannelName;
  state: ChannelState;
  /** Public marketplace listing URL — clickable once the channel is live. */
  listingUrl: string | null;
  /** Per-channel MRP (selling price on this marketplace). */
  mrp?: number | null;
  virtualInventoryQty: number | null;
  notes: string | null;
  updatedBy: number | null;
  updatedAt: string;
}

/**
 * One append-only entry in a Style's history (`style_audit_log`).
 * `before` / `after` are partial field snapshots; `notes` is free text.
 * Returned (newest-first) on `getStyle` only.
 */
export interface StyleAuditLog {
  id: number;
  styleId: number;
  action: string;
  actorUserId: number | null;
  actor?: { id: number; name: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  notes: string | null;
  createdAt: string;
}

/**
 * Product-Development view of the Style entity.
 *
 * Extends the existing floor-intake Style with intake / sampling /
 * approval / parking / channel fields. The legacy floor-intake fields
 * (categoryCode, gender, sequenceNo) are kept for cross-system continuity
 * — same `styleId` column the Lots/Stages/Dispatch screens use.
 */
export interface Style {
  // Existing ERP fields (legacy floor-intake)
  id: number;
  /** Style # — null while in `draft`. Assigned at first approval. */
  styleId: string | null;
  /** Draft-only integer minted at intake so the design can be referred
   *  to as `D-1042` in chat before Approval #1 mints the real `styleId`.
   *  Stays on the row after approval so stale references still resolve. */
  draftNo: number | null;
  /** Letter form used by the floor system: W / M / U. */
  legacyGender?: StyleGender | null;
  categoryCode: string;
  sequenceNo?: number;
  category?: CategoryWithStyleCode;
  /** Seasonal/thematic grouping (FK + relation). Required at submission. */
  collectionId: number | null;
  collection?: CollectionLite | null;

  // New PD intake fields
  source: StyleSource;
  lifecycle: StyleLifecycle;
  /** Sub-state while `lifecycle === 'cataloguing'`; null otherwise. Mirrors
   *  `easyecomDone` — the EasyEcom checkpoint is the single cataloguing gate. */
  cataloguingStatus: CataloguingStatus | null;
  /** EasyEcom catalog checkpoint — the single "cataloguing complete" gate and
   *  the prerequisite for going live. */
  easyecomDone: boolean;
  /** When the style first went live (stable; not derived from listing edits). */
  wentLiveAt: string | null;
  /** Out of stock — set when a live style was taken out of stock. That demotes
   *  it back to the EasyEcom checkpoint (lifecycle → `cataloguing`, easyecom
   *  pending; its live listings revert to draft), so it must be re-published to
   *  sell again. Cleared on republish / revive. */
  outOfStock: boolean;
  outOfStockAt: string | null;
  outOfStockReason: string | null;
  workingName: string | null;
  /** Free-text rationale for why this style is being developed. Captured at intake. */
  developmentReason: string | null;
  gender: Gender | null;
  fabricId: number | null;
  fabric?: Fabric | null;
  /** Fabric quantity consumed to make one sample (fabric's unit). */
  sampleFabricRequired: string | number | null;
  primaryColour: string | null;

  // References
  referenceLink: string | null;
  /** Legacy single image; mirrors `referenceImages[0]`. Read-only on new code. */
  referenceImage: string | null;
  referenceImageUrl: string | null;
  /** Multi-image board, up to 5. First entry is the "primary". */
  referenceImages: string[];
  /** GCS object path of the per-sample fabric swatch photo (sampling backfill). */
  fabricImagePath: string | null;
  /** Original hand-typed sheet code(s) (Gurukul/Live backfill); Myntra cross-ref. */
  legacyStyleCode: string | null;

  /** Self-FK to the "designed-as-a-family" parent style. Set when this
   *  style was spawned via the Add Colour modal. */
  parentStyleId: number | null;
  /** Hydrated by detail reads when present. */
  parentStyle?: {
    id: number;
    styleId: string | null;
    workingName: string | null;
    primaryColour: string | null;
  } | null;
  /** Hydrated by both list AND detail reads — sibling colours for the
   *  "Existing colours" chip strip on the variant-spawn modal and the
   *  parent/variant nesting in the inbox table. `lifecycle` lets the
   *  inbox row decide whether to show variant counts as "in progress",
   *  "approved", etc. */
  colourVariants?: Array<{
    id: number;
    styleId: string | null;
    primaryColour: string | null;
    lifecycle?: StyleLifecycle;
  }>;

  /** Colour-family group key = the family ROOT's minted stylecode. Flat,
   *  denormalized (NOT an FK). Set on every colour sibling. XOR with
   *  `basedOnStyleId` — a style carries one or neither, never both.
   *  Drives the marketplace "other colours" grouping. */
  familyCode?: string | null;
  /** Sampling-bypass provenance self-FK ("this design reused that
   *  approved sample to skip sampling"). Never co-exists with
   *  `familyCode`. Set at submit. */
  basedOnStyleId?: number | null;
  /** Hydrated mirror of the based-on style when reads include it. */
  basedOnStyle?: { id: number; styleId: string | null } | null;

  /** "Relive" provenance — the source style's minted Style # (the approved
   *  design being re-released). A relive must point at an existing approved
   *  in-system style, so this is always that source's code; the relive's own
   *  code is derived from it as `{oldStyleId}-{n}`. Shown as "Relived from" on
   *  the workspace + "Relive of X" in the type column. */
  oldStyleId?: string | null;
  /** Self-FK to the approved in-system Style this re-releases. Always set
   *  together with `oldStyleId` (a relive requires a resolvable source). */
  relivedFromStyleId?: number | null;
  /** Hydrated mirror of the relived-from style when reads include it — the
   *  resolved source's CURRENT code/name (preferred over the raw `oldStyleId`
   *  snapshot for display + linking). */
  relivedFromStyle?: {
    id: number;
    styleId: string | null;
    workingName: string | null;
  } | null;

  // Sampling state
  samplingStatus: string | null;
  samplingTimeline: string | null;
  /** GCS object paths of uploaded pattern / CAD files (.dxf/.pdf/image). */
  patternCadPaths: string[];

  // Approval #2
  sampleApproval: string | null;
  sampleApprovedBy: number | null;
  sampleApprovedAt: string | null;

  /** Per-style manufacturing cost + selling price (MRP). Both editable. */
  costPrice?: number | null;
  mrp?: number | null;

  // Production (v2)
  productionStatus: string | null;
  productionTimeline: string | null;
  factoryId: number | null;
  pdNote: string | null;

  // Approval #1
  approvedBy: number | null;
  approvedAt: string | null;
  /** Who approved this submission (BE `listInclude`/`detailInclude.approver`). */
  approver?: { id: number; name: string } | null;
  /** Approval #1 recorded checks (sampling flow only). */
  approval1FabricFeasible: boolean | null;
  approval1PriceOk: boolean | null;
  approval1CollectionFit: boolean | null;
  approval1Note: string | null;

  // Park
  parkedBy: number | null;
  parkedAt: string | null;
  parkedReason: string | null;

  // Dispatch (v2)
  dispatchedAt: string | null;
  easyecomDispatchId: string | null;

  // Catch-all
  remark: string | null;

  // Audit / housekeeping
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  isTestData?: boolean;

  // Nested children (included on getStyle)
  variants?: StyleVariant[];
  inspections?: StyleInspection[];
  channelListings?: StyleChannelListing[];
  auditLogs?: StyleAuditLog[];
}

/**
 * A member of the fixed sampling reviewer panel (an active approver-role
 * user). The inbox shows the approver when present, else this panel.
 * BE: GET /api/users/reviewers.
 */
export interface Reviewer {
  id: number;
  name: string;
}

// ─── Inbound ──────────────────────────────────────────────────────────────

export interface InboundLotPayload {
  /** Optional override; if omitted, BE generates `LOT-YY-NNNNN`. */
  lotNo?: string;
  /** Vendor's own style code from the paper challan (e.g. Kotty `724`). */
  vendorStyleId: string;
  /** Vendor's lot id for THIS lot (e.g. `560MM`). Required. */
  vendorLotNo: string;
  /** Used only when minting a fresh NOWI Style — ignored if the mapping
   *  already exists for this (vendor, vendorStyleId). */
  gender: StyleGender;
  categoryId: number;
  qtyIn: SizeMatrix;
}

export interface CreateInboundPayload {
  vendorId: number;
  vendorChallanNo: string;
  /** Optional legacy fallback — new flow carries vendorLotNo per lot. */
  vendorLotNo?: string;
  receivedAt?: string;
  notes?: string;
  lots: InboundLotPayload[];
}

export interface CreateInboundResponseLot {
  id: number;
  lotNo: string;
  vendorLotNo: string | null;
  /** Resolved NOWI Style id (e.g. `NOWI-W-DR-1002`). */
  styleCode: string;
  /** True if this lot caused a brand-new Style to be minted. */
  styleCreated: boolean;
}

export interface CreateInboundResponse {
  challan: { id: number; vendorChallanNo: string };
  order: { id: number; orderNo: string };
  lots: CreateInboundResponseLot[];
}

// ─── Receipts ─────────────────────────────────────────────────────────────

export interface ReceiptLine {
  sizeLabel: string;
  qty: number;
}

export interface CreateReceiptsPayload {
  /** BE DTO uses @IsInt() — must be a number, not the URL param string. */
  lotId: number;
  stageId: number;
  receipts: ReceiptLine[];
}

export interface AvailabilityResponse {
  stageId: number;
  available: SizeMatrix;
}

// ─── Rework ───────────────────────────────────────────────────────────────

export interface OpenReworkPayload {
  lotId: number;
  sku: string;
  sizeLabel: string;
  qty: number;
  reason: string;
  /** Mandatory — at least one defect photo object path. */
  photoPaths: string[];
}

export interface ReworkIssue {
  id: string;
  lotId: string;
  sku: string;
  sizeLabel: string;
  qty: number;
  reason: string;
  /** GCS object paths of defect photos attached at finishing. */
  photoPaths?: string[];
  attemptNumber: number;
  status: 'open' | 'in_progress' | 'resolved' | 'exceeded_limit';
  openedAt: string;
}

// ─── Scrap ────────────────────────────────────────────────────────────────

export interface CreateScrapPayload {
  lotId: number;
  stageId?: number | null;
  sku: string;
  sizeLabel: string;
  qty: number;
  reason: string;
  photoPaths?: string[];
}

export interface ScrapEvent {
  id: string;
  lotId: string;
  stageId?: number | null;
  sku: string;
  sizeLabel: string;
  qty: number;
  reason: string;
  scrappedAt: string;
}

// ─── Storage ──────────────────────────────────────────────────────────────

export interface UploadUrlResponse {
  uploadUrl: string;
  objectPath: string;
  noop?: boolean;
}

// ─── Destination warehouses ────────────────────────────────────────────────

export interface DestinationWarehouse {
  id: number;
  code: string;
  name: string;
  address?: string | null;
  spocName?: string | null;
  spocPhone?: string | null;
  easyecomWarehouseId?: string | null;
  easyecomEnabled: boolean;
  isActive: boolean;
  createdAt?: string;
}

export interface CreateDestinationWarehousePayload {
  code: string;
  name: string;
  address?: string;
  spocName?: string;
  spocPhone?: string;
  easyecomWarehouseId?: string;
  easyecomEnabled?: boolean;
  isActive?: boolean;
}

export type UpdateDestinationWarehousePayload =
  Partial<CreateDestinationWarehousePayload>;

/** Map of requested objectPath → signed read URL. */
export interface ReadUrlsResponse {
  urls: Record<string, string>;
}

// ─── Filters ──────────────────────────────────────────────────────────────

export interface FilterOption {
  id: string;
  code: string;
  name: string;
}

export interface FilterStage extends FilterOption {
  sequence?: number;
}

export interface FilterStatus {
  id: string;
  code: OrderStatus | string;
  name: string;
}

export interface FilterSku {
  id: string;
  code: string;
  baseCode: string;
  sizeLabel: string;
  originVendorCode?: string | null;
}

// ─── Locator ──────────────────────────────────────────────────────────────

export interface LocatorOriginVendor {
  id: string;
  code: string;
  name: string;
}

export interface LocatorCounts {
  inbound: number;
  stitching: number;
  finishing: number;
  dispatched: number;
  available: number;
}

export interface LocatorRow {
  sku: string;
  baseCode: string;
  sizeLabel: string;
  originVendor: LocatorOriginVendor;
  counts: LocatorCounts;
  lotsCount: number;
}

export interface LocatorPage {
  skip: number;
  take: number;
  total: number;
}

export interface LocatorResponse {
  rows: LocatorRow[];
  page: LocatorPage;
}

export interface LocatorParams {
  vendorId?: string;
  stageId?: string;
  warehouseId?: string;
  status?: string;
  sku?: string;
  baseCode?: string;
  originVendorId?: string;
  from?: string;
  to?: string;
  skip?: number;
  take?: number;
}

export interface SkuDetailTotals {
  inbound: number;
  stitching: number;
  finishing: number;
  dispatched: number;
  scrapped: number;
  reworking: number;
}

export interface SkuDetailLot {
  id: string;
  lotNo: string;
  vendor: { id: string; code: string; name: string } | null;
  order: { id: string; orderNo: string; status: OrderStatus | string } | null;
  qtyIn: number;
  stitchingAvail: number;
  finishingAvail: number;
  scrapped: number;
  openRework: number;
}

export interface SkuDetailReceipt {
  id: string;
  at: string;
  stage: string;
  qty: number;
  kind: 'forward' | 'rework' | 'scrap' | string;
}

export interface SkuDetailResponse {
  sku: string;
  baseCode: string;
  sizeLabel: string;
  originVendor: LocatorOriginVendor | null;
  totals: SkuDetailTotals;
  lots: SkuDetailLot[];
  recentReceipts: SkuDetailReceipt[];
}

// ─── Dashboard ────────────────────────────────────────────────────────────

export interface ThroughputPoint {
  date: string;
  finished: number;
  dispatched: number;
}

export interface ThroughputResponse {
  finishedUnits: number;
  dispatchedUnits: number;
  trend: ThroughputPoint[];
}

export interface ReworkRateRow {
  sku: string;
  baseCode?: string;
  sizeLabel?: string;
  reworkUnits: number;
  finishingForwardUnits: number;
  ratePct: number;
}

export interface ReworkRateStageRow {
  stage: string;
  reworkUnits: number;
  ratePct: number;
}

export interface ReworkRateResponse {
  overall: {
    reworkUnits: number;
    finishingForwardUnits: number;
    ratePct: number;
  };
  bySku: ReworkRateRow[];
  byStage: ReworkRateStageRow[];
}

export interface CycleTimeBucket {
  bucket: string;
  count: number;
}

export interface CycleTimeSkuRow {
  sku: string;
  avgDays: number;
}

export interface CycleTimeResponse {
  avgDays: number;
  bySku: CycleTimeSkuRow[];
  distribution: CycleTimeBucket[];
}

// ─── Dispatches ───────────────────────────────────────────────────────────

export type DispatchStatus =
  | 'draft'
  | 'awaiting_confirmation'
  | 'synced'
  | 'manual_pdf'
  | 'awaiting_grn'
  | 'grn_received'
  | 'grn_mismatch'
  | 'sync_failed'
  | 'closed'
  | 'closed_with_adjustment';

export type DispatchSyncMode = 'easyecom' | 'manual_pdf';

export interface DispatchItem {
  id: string;
  dispatchId: string;
  lotId: string;
  lotNo?: string | null;
  sku: string;
  sizeLabel: string;
  qtySent: number;
  qtyReceived?: number | null;
  mismatch?: boolean;
  lastEditAt?: string | null;
  lastEditBy?: string | null;
  lastEditReason?: string | null;
}

export interface DispatchGrnEvent {
  id: string;
  dispatchId: string;
  receivedAt: string;
  payload: unknown;
}

export interface DispatchSyncQueueEntry {
  id: string;
  dispatchId: string;
  attempts: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  status?: string | null;
}

export interface Dispatch {
  id: string;
  dispatchNo: string;
  orderId: string;
  destWarehouseId: string;
  destWarehouse?: { id: string; name: string; code?: string | null } | null;
  status: DispatchStatus;
  syncMode: DispatchSyncMode;
  dispatchedAt: string;
  itemsCount?: number;
  totalQtySent?: number;
}

export interface DispatchDetail extends Dispatch {
  order?: Order | null;
  items: DispatchItem[];
  grnEvents: DispatchGrnEvent[];
  syncQueue: DispatchSyncQueueEntry[];
}

export interface CreateDispatchItemInput {
  lotId: number;
  sku: string;
  sizeLabel: string;
  qty: number;
}

export interface CreateDispatchPayload {
  orderId: number;
  destWarehouseId: number;
  items: CreateDispatchItemInput[];
  syncMode?: DispatchSyncMode;
}

export interface ListDispatchesParams {
  orderId?: string;
  destWarehouseId?: string;
  status?: DispatchStatus | string;
  from?: string;
  to?: string;
  skip?: number;
  take?: number;
}

export interface ListDispatchesResponse {
  rows: Dispatch[];
  page: { skip: number; take: number; total: number };
}

export interface EditDispatchItemPayload {
  qty: number;
  reason: string;
  note?: string;
}
