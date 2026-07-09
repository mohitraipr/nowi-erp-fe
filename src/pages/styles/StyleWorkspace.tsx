import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Clock,
  Pencil,
  Plus,
  Upload,
  CheckCircle2,
  ExternalLink,
  Link2,
  PackageCheck,
  PackageX,
  Store,
  HeartPulse,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import SamplingPipelineStepper from '@/components/styles/SamplingPipelineStepper';
import StyleImagePanel from '@/components/styles/StyleImagePanel';
import FabricSwatchThumb from '@/components/styles/FabricSwatchThumb';
import PatternCadPreview from '@/components/styles/PatternCadPreview';
import AddColourModal from '@/components/styles/AddColourModal';
import StyleEditModal from '@/components/styles/StyleEditModal';
import {
  CoreSpecsEditModal,
  BomEditModal,
  PatternCadEditModal,
} from '@/components/styles/ScopedStyleEditModals';
import Approval1Dialog from '@/components/styles/Approval1Dialog';
import ParkDialog from '@/components/styles/ParkDialog';
import {
  getStyle,
  parkStyle,
  reviveStyle,
  approveStyle,
  sampleApproveStyle,
  patchStyle,
  listFabrics,
  colourGroup,
  startCataloguing,
  setMarketplaceListing,
  setEasyecomDone,
  markOutOfStock,
  type SamplingStatus,
} from '@/api/styles';
import type {
  ChannelName,
  Fabric,
  Style,
  StyleAuditLog,
  StyleChannelListing,
} from '@/api/types';
import { useAuth } from '@/context/auth';
import {
  APPROVER_ROLES,
  CATALOGUER_WRITE_ROLES,
  PD_WRITE_ROLES,
  STYLE_EDIT_ROLES,
  userAllRoles,
} from '@/lib/userRoles';
import { cn } from '@/lib/utils';
import { POST_SAMPLING, formatStyleRef } from '@/lib/styleRef';
import GoLiveDialog from '@/components/styles/GoLiveDialog';
import SampleApproveDialog from '@/components/styles/SampleApproveDialog';

// Roles allowed to add a new colour (spawn a sibling submission). Adding a
// colour is a CREATE-flavoured action — colourways are finished-goods /
// marketplace work — so it admits the narrow `cataloguer` on top of the PD
// editors. Mirrors the BE colour-variants @Roles (CATALOGUER_WRITE_ROLES).
const COLOUR_WRITE = CATALOGUER_WRITE_ROLES;

// Gender may arrive as a code (W/M/U) or long form (women/men/unisex)
// depending on the row — render the human label either way so the header /
// specs read "Women · Dress", never "W · JC".
const GENDER_LABEL: Record<string, string> = {
  W: 'Women',
  M: 'Men',
  U: 'Unisex',
  women: 'Women',
  men: 'Men',
  unisex: 'Unisex',
};
const genderLabel = (g: string | null | undefined) =>
  (g ? GENDER_LABEL[g] : null) ?? g ?? '—';

// Friendly host for a reference URL (e.g. "myntra.com") — falls back to the
// raw string if it isn't a parseable absolute URL.
const linkHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// Validate the URL scheme before we ever put a user-supplied value in an
// anchor `href` — only http(s) is clickable. Anything else (notably
// `javascript:`) returns null so the caller renders inert text, not a live
// link. referenceLink is captured at intake, so treat it as untrusted.
const safeHref = (raw: string): string | null => {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? u.toString()
      : null;
  } catch {
    return null;
  }
};

// ₹ with Indian-grouping, no decimals when whole (₹1,200 / ₹1,200.50). Coerces
// because Decimal fields (costPrice, listing mrp) arrive as JSON strings from
// the styles GET — Number() makes the grouping/precision apply correctly.
const formatInr = (value: number | string): string =>
  `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Snapshot field → English label, for describing WHAT an audit entry
// changed (mirrors StylesService.diffSnapshot on the BE). Admin-facing
// only → English-only by design (no Hindi).
const AUDIT_FIELD_LABELS: Record<string, string> = {
  workingName: 'Working name',
  fabricId: 'Fabric',
  sampleFabricRequired: 'Sample fabric',
  primaryColour: 'Primary colour',
  costPrice: 'Cost price',
  referenceLink: 'Reference link',
  referenceImage: 'Reference image',
  referenceImageUrl: 'Reference image',
  samplingStatus: 'Stage',
  samplingTimeline: 'Timeline',
  patternCadPaths: 'CAD files',
  sampleApproval: 'Sample verdict',
  developmentReason: 'Dev reason',
  remark: 'Remark',
  gender: 'Gender',
  lifecycle: 'Lifecycle',
  styleId: 'Style #',
  familyCode: 'Colour family',
  basedOnStyleId: 'Based on',
  oldStyleId: 'Relived from',
  reason: 'Reason',
};

// Shared card chrome, hoisted to module scope so the loading skeleton can
// reuse the exact surface/border/radius of the real cards below (the
// component-local `cardClasses` is identical, declared after the early
// return where this skeleton renders).
const WORKSPACE_CARD =
  'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-sm overflow-hidden flex flex-col';

/**
 * Shimmer placeholder shown while the style loads. Mirrors the real
 * workspace skeleton 1:1 — back link, big style-code heading + status
 * pills, subtitle, an action button row, the stepper band, and the
 * two-column card grid — so the layout doesn't jump when data arrives.
 */
function WorkspaceSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading style">
      {/* Header: back link · code + pills · subtitle · action buttons. */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2.5">
          <Skeleton className="h-4 w-14" />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-52" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end shrink-0">
          <Skeleton className="h-8 w-20 rounded-[var(--radius-md)]" />
          <Skeleton className="h-8 w-28 rounded-[var(--radius-md)]" />
        </div>
      </header>

      {/* Context band — the sampling stepper card. */}
      <section className={cn(WORKSPACE_CARD, 'gap-4 p-4')}>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex items-center gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-1 items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      </section>

      {/* Two-column grid: image panel (left) · spec cards (right). */}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <section className={WORKSPACE_CARD}>
          <Skeleton className="aspect-[4/5] w-full rounded-none" />
        </section>
        <div className="space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <section key={i} className={cn(WORKSPACE_CARD, 'gap-3 p-4')}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Per-style deep page.
 *
 * Two lifecycle-conditional layouts, both 1:1 with the Stitch mocks:
 *
 *  - SAMPLING (`draft` / `in_sampling`): header (Park · Send back for
 *    corrections · Approve sample) → progress-stepper band (timeline /
 *    pattern-master meta + horizontal stepper) → 7/5 grid: left = Core
 *    specifications + Bill of materials; right = Pattern / CAD + Activity
 *    log.
 *  - PRODUCTION (`sample_approved`+): header (Park · Start production ·
 *    Add colour) → colour-family strip → 2-up grid: left = Core
 *    specifications (+ "Sample approved by …" footer) + Bill of materials;
 *    right = Pattern / CAD + Activity log.
 *
 * China Import keeps its single-approval shell inside the same chrome.
 *
 * `:styleId` URL param accepts either the numeric DB id or the Style #.
 */
export default function StyleWorkspace() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // Where the user came from (the exact dashboard tab / registry), stashed in
  // router state on navigate-in. Falls back to the dashboard for deep links
  // and hard refreshes (which drop history state).
  const backTo = (location.state as { from?: string } | null)?.from ?? '/';
  const toast = useToast();
  const { user } = useAuth();
  const roles = userAllRoles(user);
  const { styleId: idParam } = useParams<{ styleId: string }>();

  const [style, setStyle] = useState<Style | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [sampleApproveOpen, setSampleApproveOpen] = useState(false);
  const [colourModalOpen, setColourModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // Scoped editors — the Core-specs pencil and the BOM edit affordance
  // open these small field-subset dialogs instead of the full form.
  const [coreSpecsEditOpen, setCoreSpecsEditOpen] = useState(false);
  const [bomEditOpen, setBomEditOpen] = useState(false);
  // Pattern/CAD upload affordance opens a scoped editor that ONLY
  // uploads CAD files (patternCadPaths) — not the full StyleEditModal.
  const [patternCadEditOpen, setPatternCadEditOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  // "Add listings": opens a dialog to pick channel(s) + paste each listing URL.
  // Listings are prepared (draft); EasyEcom-done is what flips them live.
  const [listingsOpen, setListingsOpen] = useState(false);
  // Two-step Withdraw: confirm pulling a committed (post-Approval-#1)
  // design out of the pipeline, then open ParkDialog to capture the
  // reason. Drafts skip this and open ParkDialog directly.
  const [reviveConfirmOpen, setReviveConfirmOpen] = useState(false);
  // Colour family (siblings sharing this style's familyCode). Sourced from
  // the BE colour-group resolver, NOT parent.colourVariants — so opening
  // Add-Colour from a SIBLING (not the root) still sees the whole family.
  // parentStyleId drives inbox NESTING; familyCode drives the marketplace
  // "other colours" GROUP — do NOT unify; based-on shares neither.
  const [colourFamily, setColourFamily] = useState<Style[]>([]);
  // StyleEditModal lazy-loads its own fabric master on first open;
  // we still pre-warm it here so the user doesn't see the modal
  // flicker into pickers. Collection was dropped from the schema.
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const ensureMasterData = useCallback(async () => {
    if (fabrics.length === 0) {
      try {
        const f = await listFabrics();
        setFabrics(f);
      } catch {
        /* soft-fail — modal will refetch itself */
      }
    }
  }, [fabrics.length]);

  const load = useCallback(async () => {
    if (!idParam) return;
    setLoading(true);
    try {
      const s = await getStyle(idParam);
      setStyle(s);
      // Resolve the whole colour family (every sibling sharing familyCode)
      // off the canonical numeric id. A based-on style has no familyCode →
      // empty group → the ColourFamilyCard hides itself. Soft-fail: the
      // card just shows no siblings if the resolver errors.
      try {
        setColourFamily(await colourGroup(s.id));
      } catch {
        setColourFamily([]);
      }
    } catch {
      setStyle(null);
      setColourFamily([]);
    } finally {
      setLoading(false);
    }
  }, [idParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const doAction = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      toast.show('Saved.', 'success');
      await load();
    } catch {
      toast.show('Action failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <WorkspaceSkeleton />;
  }

  if (!style) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/styles')}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]"
        >
          <span>{t('admin.styles.title')}</span>
        </button>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t('admin.styles.workspace.notFound')}
        </p>
      </div>
    );
  }

  // China Import is a simple single-approval flow — no sampling stage,
  // no Approval #2, no inspections. Sampling-only UI is hidden for it.
  const isChinaImport = style.source === 'china_import';
  // 3rd-party finished goods — surface the source as a headline badge (like
  // China Import) so it's obvious the Style # is a partner code, not minted.
  const isThirdParty = style.source === 'third_party';
  // Manufactured by a 3rd party — like China Import, the source IS the story
  // (skips sampling, minted Style #), so surface it as a headline badge too.
  const isThirdPartyMfg = style.source === 'third_party_manufactured';
  // Imported / partner *finished goods* — a single-approval flow with no
  // sampling phase (china = NW-minted, 3rd-party = verbatim partner code).
  // Used only for the sampling-skip below; colour fan-out is gated separately
  // (3rd-party CAN fan out colours — each carries the partner's own code —
  // China Import can't).
  const isFinishedGoodsSource = isChinaImport || isThirdParty;
  // Whether this style passes through the sampling phase at all. Mirrors the BE
  // `skipSampling` predicate (styles-actions.service): finished-goods sources,
  // colour variants (familyCode), based-on rows, and relives (oldStyleId) all
  // require Approval #1 but then land straight at sample_approved — no
  // in_sampling stage, so no stepper band and no Approval #2.
  const skipsSampling =
    isFinishedGoodsSource ||
    // Manufactured by a 3rd party: minted Style # (so not a finished-goods
    // partner code), but still skips the sampling phase like the BE does.
    style.source === 'third_party_manufactured' ||
    style.familyCode != null ||
    style.basedOnStyleId != null ||
    style.oldStyleId != null;
  // Approval #1 is APPROVE-gated on the BE (`@Post('approve')` → `@Roles(APPROVE)`),
  // so gate the button to approvers too — matching the dashboard's `canApprove`.
  // Without this a non-approver writer sees "Approve intake" and 403s on click.
  const canApproveIntake =
    style.lifecycle === 'draft' &&
    roles.some((r) => APPROVER_ROLES.includes(r));
  // Sample sign-off (Approval #2) is approver-only — the BE endpoint is
  // APPROVE-gated, so don't show the button to writers who would 403.
  const canSampleApprove =
    !skipsSampling &&
    style.lifecycle === 'in_sampling' &&
    roles.some((r) => APPROVER_ROLES.includes(r));

  // Add-Colour: only once the family has an approved sample to inherit
  // (POST_SAMPLING) and only for colour-WRITE roles. Excluded for China Import
  // (no NOWI colour family to extend); 3rd-party IS allowed — its colour child
  // carries the partner's own verbatim code (entered in the modal). A colour
  // add is a SUBMISSION — the spawned draft re-enters the Inbox for Approval #1.
  const canAddColour =
    POST_SAMPLING.has(style.lifecycle) &&
    !isChinaImport &&
    roles.some((r) => COLOUR_WRITE.includes(r));

  // Whether the user may edit this style's fields at all — mirrors the BE
  // styles WRITE set (STYLE_EDIT_ROLES). Gates the scoped edit affordances
  // (core-specs pencil / BOM / pattern-CAD upload) and the Edit surface so
  // a read-only viewer never sees a control that 403s on save.
  const canWrite = roles.some((r) => STYLE_EDIT_ROLES.includes(r));
  // Sampling pipeline moves are WORKFLOW, not a style edit: `cataloguer` sits in
  // STYLE_EDIT_ROLES for a design's specs, but the BE rejects samplingStatus
  // from a style edit, so the stepper must not offer it to them.
  const canEditWorkflow = roles.some((r) => PD_WRITE_ROLES.includes(r));

  // Cataloguing writes (EasyEcom checkpoint + marketplace take-offline) also
  // admit the narrow `cataloguer`. A superset of canWrite for the Channels
  // card only — cataloguer can't edit the rest of the design.
  const canCataloguingWrite = roles.some((r) =>
    CATALOGUER_WRITE_ROLES.includes(r),
  );

  // Park gate (mirrors the BE): an admin may park at ANY stage (a live style is
  // pulled off the market); a non-admin sampling approver (e.g. sampling_lead)
  // may park during the sampling phase (draft or in_sampling). Parking a
  // parked/archived style is a no-op.
  const isAdmin = roles.includes('admin');
  const isApprover = roles.some((r) => APPROVER_ROLES.includes(r));
  const inSamplingPhase =
    style.lifecycle === 'draft' || style.lifecycle === 'in_sampling';
  const canPark =
    style.lifecycle !== 'parked' &&
    style.lifecycle !== 'archived' &&
    (isAdmin || (inSamplingPhase && isApprover));
  const canRevive = style.lifecycle === 'parked';
  const sourceLabel = t(`admin.styles.source.${style.source}`);

  // "Approve sample" is the primary action while a style is in sampling.
  const canSampleApproveAction = canSampleApprove;

  // ── Go-to-market lifecycle actions ──
  // These advance the lifecycle and are APPROVE-gated on the BE — gate the
  // buttons to approver roles too (matching the dashboard) so a writer
  // never sees a control that 403s. EasyEcom (the cataloguing gate) + take-
  // offline stay open to all writers; only the lifecycle advances are gated.
  const canApproveGoToMarket =
    roles.some((r) => APPROVER_ROLES.includes(r)) && !isChinaImport;
  // sample_approved → cataloguing (status=pending)
  const canStartCataloguing =
    canApproveGoToMarket && style.lifecycle === 'sample_approved';
  // "Add listings" — pick marketplace channels + links (+ MRP). Editable while
  // cataloguing AND once live (add another channel / fix a link or price) —
  // matches the BE (setMarketplaceListing allows cataloguing|live) and the
  // dashboard row action. Cataloguer-editable, not approver-gated.
  const canAddListings =
    canCataloguingWrite &&
    (style.lifecycle === 'cataloguing' || style.lifecycle === 'live');

  // Layout selector. The sampling layout (stepper band + 7/5 grid) covers
  // draft / in_sampling; the production layout (colour strip + 2-up grid)
  // covers sample_approved and beyond. China Import / 3rd-party never sample
  // — they ride the sampling shell (no band) with their approval-record card,
  // including while still draft.
  const isProductionLayout = POST_SAMPLING.has(style.lifecycle);
  const showSamplingBand = !skipsSampling && !isProductionLayout;

  // The second header pill names the current workflow stage. In sampling
  // it tracks the live sampling step ("Fabric sourcing"); in the go-to-market
  // states it names that stage (Cataloguing · pending/done / Live); otherwise
  // (sample_approved / in_pd / qc / dispatched) it reads "Ready for production".
  let stagePill = '';
  if (style.lifecycle === 'cataloguing') {
    stagePill = t(
      `admin.styles.cataloguingStatus.${style.cataloguingStatus ?? 'pending'}` as const,
      {
        defaultValue:
          style.cataloguingStatus === 'done'
            ? 'Cataloguing · done'
            : 'Cataloguing · pending',
      },
    );
  } else if (style.lifecycle === 'live') {
    stagePill = t('admin.styles.workspace.liveStage', {
      defaultValue: 'Live',
    });
  } else if (isProductionLayout) {
    stagePill = t('admin.styles.workspace.readyForProduction', {
      defaultValue: 'Ready for production',
    });
  } else if (style.samplingStatus) {
    stagePill = t(`admin.styles.samplingSteps.${style.samplingStatus}` as const, {
      defaultValue: '',
    });
  }

  // The lifecycle badge's label. The stage pill is suppressed when it would
  // just repeat this (e.g. the `live` stage pill is literally "Live"), so the
  // header never shows the same word twice.
  const lifecycleLabel = t(`admin.styles.lifecycle.${style.lifecycle}`);

  // Section card chrome — Stitch's "surface card with header strip" look,
  // rendered in the app's tokens (surface / border / radius), not the
  // Stitch navy literals.
  const cardClasses = WORKSPACE_CARD;

  // Shared cards — identical in both layouts, only the column wrapper and
  // a couple of header affordances differ.
  // Reference-image gallery + fabric swatch; renders nothing when the style
  // carries no images (legacy floor-intake styles), so the column is unchanged.
  const imagePanelCard = (
    <StyleImagePanel
      styleId={style.id}
      referenceImages={style.referenceImages}
      workingName={style.workingName}
      canWrite={canWrite}
      onUpdated={() => void load()}
    />
  );

  const coreSpecsCard = (
    <section className={cardClasses}>
      <CardHeader
        title={t('admin.styles.workspace.coreSpecs')}
        right={
          canWrite ? (
            <button
              type="button"
              aria-label={t('admin.styles.workspace.edit', {
                defaultValue: 'Edit',
              })}
              onClick={() => {
                void ensureMasterData();
                setCoreSpecsEditOpen(true);
              }}
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors"
            >
              <Pencil size={18} />
            </button>
          ) : undefined
        }
      />
      <div className="p-5">
        <dl className="flex flex-col">
          <SpecRow label="Gender" value={genderLabel(style.gender)} />
          <SpecRow
            label="Category"
            value={style.category?.name ?? style.categoryCode ?? '—'}
          />
          <SpecRow label="Collection" value={style.collection?.name ?? '—'} />
          <SpecRow
            label="Fabric"
            value={
              <span className="inline-flex items-center gap-2">
                {style.fabric?.name ?? '—'}
                <FabricSwatchThumb
                  fabricImagePath={style.fabric?.imagePath ?? style.fabricImagePath}
                />
              </span>
            }
          />
          <SpecRow
            label="Primary colour"
            value={
              <span className="inline-flex items-center gap-2">
                <ColourSwatch colour={style.primaryColour} />
                {style.primaryColour ?? '—'}
              </span>
            }
          />
          {/* Relive provenance — the OLD style code this design was re-released
              from. Links to the source when it resolved to an in-system Style
              (relivedFromStyleId set); otherwise shown as a bare reference with
              a quiet "not in system" note. Only rendered for relived styles. */}
          {style.oldStyleId && (
            <SpecRow
              label="Relived from"
              value={
                style.relivedFromStyleId ? (
                  // oldStyleId is the matched Style #, so it resolves directly
                  // via the workspace's id-or-code route.
                  <Link
                    to={`/styles/${style.oldStyleId}`}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    {style.oldStyleId}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {style.oldStyleId}
                    <span className="font-sans text-[11px] text-[var(--color-muted-foreground)]">
                      not in system
                    </span>
                  </span>
                )
              }
            />
          )}
          {/* Sampling layout carries the sample-fabric requirement; the
              production layout drops it (mock has neither sampling row). */}
          {!isProductionLayout &&
            !isChinaImport &&
            style.sampleFabricRequired != null && (
              <SpecRow
                label="Sample fabric required"
                value={`${style.sampleFabricRequired} ${
                  style.fabric?.unitOfMeasure === 'meter'
                    ? 'm'
                    : (style.fabric?.unitOfMeasure ?? 'm')
                }`}
              />
            )}
          {/* The source product URL captured at intake (drives reference-image
              auto-fetch). Surfaced here as a clickable link — the detail view
              previously never rendered it. Editable via the core-specs pencil. */}
          {style.referenceLink && (
            <SpecRow
              label="Reference link"
              value={(() => {
                const href = safeHref(style.referenceLink);
                // Non-http(s) schemes (e.g. javascript:) are shown as inert
                // text — never as a clickable href.
                return href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-[var(--color-primary)] hover:underline break-all"
                  >
                    <ExternalLink size={13} className="shrink-0" />
                    {linkHost(style.referenceLink)}
                  </a>
                ) : (
                  <span className="break-all">{style.referenceLink}</span>
                );
              })()}
            />
          )}
          {/* Cost price — always shown (em-dash when unset, editable via the
              core-specs pencil). */}
          <SpecRow
            label="Cost price"
            value={
              style.costPrice != null ? (
                formatInr(style.costPrice)
              ) : (
                <span className="text-[var(--color-muted-foreground)]">—</span>
              )
            }
          />
          {/* MRP — per-style selling price (em-dash when unset, editable via the
              core-specs pencil). Final row. */}
          <SpecRow
            label="MRP"
            value={
              style.mrp != null ? (
                formatInr(style.mrp)
              ) : (
                <span className="text-[var(--color-muted-foreground)]">—</span>
              )
            }
            last
          />
        </dl>
      </div>
      {/* Production layout footers the card with the sample sign-off
          record (e.g. "Sample approved by <approver> · 2 days ago"). */}
      {isProductionLayout && style.sampleApprovedAt && (
        <div className="px-3 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] text-right text-xs text-[var(--color-muted-foreground)]">
          {t('admin.styles.workspace.sampleApprovedBy', {
            defaultValue: 'Sample approved by {{name}} · {{when}}',
            name: style.approver?.name ?? '—',
            when: new Date(style.sampleApprovedAt).toLocaleDateString(),
          })}
        </div>
      )}
    </section>
  );

  const billOfMaterialsCard = (
    <BillOfMaterialsCard
      style={style}
      cardClasses={cardClasses}
      production={isProductionLayout}
      onEdit={
        canWrite
          ? () => {
              void ensureMasterData();
              setBomEditOpen(true);
            }
          : undefined
      }
    />
  );

  const patternCadCard = (
    <section className={cardClasses}>
      <CardHeader
        title={t('admin.styles.drawer.patternCad.label', {
          defaultValue: 'Pattern / CAD',
        })}
        right={
          // The sampling mock exposes an upload affordance in the header;
          // the production mock has none. Opens a scoped CAD-only editor.
          // Gated to writers so a read-only viewer sees no upload button.
          canWrite && !isProductionLayout ? (
            <button
              type="button"
              aria-label={t('admin.styles.drawer.patternCad.upload', {
                defaultValue: 'Upload CAD file',
              })}
              onClick={() => setPatternCadEditOpen(true)}
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors"
            >
              <Upload size={18} />
            </button>
          ) : undefined
        }
      />
      <div className="p-5">
        {style.patternCadPaths && style.patternCadPaths.length > 0 ? (
          <PatternCadPreview patternCadPaths={style.patternCadPaths} />
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t('admin.styles.drawer.patternCad.none', {
              defaultValue:
                'No pattern or CAD files uploaded yet. Use the upload button to add .dxf / .pdf / .png / .jpg.',
            })}
          </p>
        )}
      </div>
    </section>
  );

  const activityLogCard = (
    <ActivityTimelineCard style={style} cardClasses={cardClasses} />
  );

  // Channels / live-listings — surfaced once the style enters the
  // go-to-market lifecycle (cataloguing / live). Lists each channel listing
  // with its state and a clickable listing URL when present.
  const showChannels =
    style.lifecycle === 'cataloguing' || style.lifecycle === 'live';
  const channelsCard = showChannels ? (
    <ChannelsCard
      style={style}
      cardClasses={cardClasses}
      cataloguingStatus={style.cataloguingStatus}
      canManage={canCataloguingWrite}
      easyecomDone={style.easyecomDone}
      onSetEasyecom={(done) =>
        doAction('easyecom-checkpoint', () => setEasyecomDone(style.id, done))
      }
      onTakeOffline={(channel, reason) =>
        doAction('take-offline', () =>
          setMarketplaceListing(style.id, { channel, listed: false, reason }),
        )
      }
      outOfStock={style.outOfStock}
      onMarkOutOfStock={(reason) =>
        doAction('out-of-stock', () => markOutOfStock(style.id, { reason }))
      }
    />
  ) : null;

  return (
    <div className="space-y-5">
      {/* ── Header: breadcrumb · large style code + status pills · subtitle ──
          Action bar (lifecycle-conditional) sits top-right. */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-primary)]"
          >
            <ArrowLeft size={14} aria-hidden className="shrink-0" />
            {t('admin.styles.workspace.back', { defaultValue: 'Back' })}
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-3xl font-semibold text-[var(--color-primary)] tracking-tight m-0">
              {formatStyleRef(style, t('admin.styles.draft'))}
            </h1>
            {/* For China Import styles the source IS the story — surface it.
                For sampling styles the NOWI prefix already implies source,
                so the source chip is redundant and we omit it. */}
            {(isChinaImport || isThirdParty || isThirdPartyMfg) && (
              <Badge variant="stitch">{sourceLabel}</Badge>
            )}
            <Badge variant={isProductionLayout ? 'ready' : 'secondary'}>
              {lifecycleLabel}
            </Badge>
            {/* Stage pill — the finer workflow step within the lifecycle.
                Hidden when it would just repeat the lifecycle label (the `live`
                stage pill is "Live") so the header never shows the same twice. */}
            {!isChinaImport && stagePill && stagePill !== lifecycleLabel && (
              <Badge variant="outline">{stagePill}</Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
            {[
              style.workingName,
              style.gender ? genderLabel(style.gender) : null,
              style.category?.name ?? style.categoryCode,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </p>
        </div>

        {/* Action bar — lifecycle-conditional, matching each mock exactly.
            in_sampling → Park · Send back for corrections · Approve sample
            sample_approved+ → Park · Start production · Add colour */}
        <div className="flex flex-wrap items-center gap-2 md:justify-end shrink-0">
          {/* Jump to this style's inventory health (admins/viewers only —
              the IH route is gated to those roles). Deep-links via ?q=code. */}
          {style.styleId &&
            userAllRoles(user).some((r) => r === 'admin' || r === 'viewer') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(
                    `/admin/analytics/inventory-health?q=${encodeURIComponent(style.styleId!)}`,
                  )
                }
              >
                <HeartPulse size={16} />
                <span className="ml-1">
                  {t('admin.styles.workspace.inventoryHealth', {
                    defaultValue: 'Inventory health',
                  })}
                </span>
              </Button>
            )}
          {canPark && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setParkOpen(true)}
            >
              {t('admin.styles.workspace.parkAction', {
                defaultValue: 'Park',
              })}
            </Button>
          )}
          {canRevive && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setReviveConfirmOpen(true)}
            >
              {t('admin.styles.workspace.revive')}
            </Button>
          )}
          {/* Send-back for corrections is no longer a separate button — it's
              the "corrections" verdict inside the Approve-sample dialog, so
              there's one sign-off path (the popup). */}
          {/* Start cataloguing — sample_approved → cataloguing (pending). */}
          {canStartCataloguing && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void doAction('start-cataloguing', () =>
                  startCataloguing(style.id),
                )
              }
            >
              {t('admin.styles.workspace.startCataloguing', {
                defaultValue: 'Start cataloguing',
              })}
            </Button>
          )}
          {/* Add listings — pick channels + paste each link while cataloguing.
              Listings are prepared; marking EasyEcom done (Channels card) takes
              them live. No separate "Go live" button. */}
          {canAddListings && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setListingsOpen(true)}
            >
              <Link2 size={16} />
              <span className="ml-1">
                {t('admin.styles.workspace.addListings', {
                  defaultValue: 'Add listings',
                })}
              </span>
            </Button>
          )}
          {/* + Add colour — spawns a sibling Style that re-enters the Inbox
              for Approval #1. Gated to POST_SAMPLING + colour-WRITE roles. */}
          {canAddColour && (
            <Button size="sm" onClick={() => setColourModalOpen(true)}>
              <Plus size={16} />
              <span className="ml-1">
                {t('admin.styles.workspace.addColour', 'Add colour')}
              </span>
            </Button>
          )}
          {/* Approve intake (Approval #1) — drafts only. China Import keeps
              the lightweight single-click approve; sampling opens the
              checklist dialog. */}
          {canApproveIntake && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                if (isChinaImport) {
                  void doAction('approve', () => approveStyle(style.id));
                } else {
                  setApproveOpen(true);
                }
              }}
            >
              {t('admin.styles.workspace.approve')}
            </Button>
          )}
          {/* Approve sample (Approval #2) — primary action while in_sampling.
              Opens the SampleApproveDialog. */}
          {canSampleApproveAction && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => setSampleApproveOpen(true)}
            >
              {t('admin.styles.workspace.sampleApprove', {
                defaultValue: 'Approve sample',
              })}
            </Button>
          )}
        </div>
      </header>

      {/* ── Context band — lifecycle-conditional ──
          in_sampling (+ earlier): progress-stepper band (timeline /
            pattern-master meta line + horizontal stepper).
          sample_approved+: colour-family strip. */}
      {showSamplingBand && (
        <section className={cn(cardClasses, 'p-4')}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
              <Clock size={14} aria-hidden />
              <span>
                {t('admin.styles.workspace.samplingTimelineMeta', {
                  defaultValue: 'Sampling timeline: {{timeline}}',
                  timeline: renderSamplingTimeline(style.samplingTimeline),
                })}
              </span>
            </div>
            <p className="text-xs italic text-[var(--color-muted-foreground)]">
              {t('admin.styles.workspace.coloursAfterApproval', {
                defaultValue:
                  'Colours are added after sample approval — not during sampling.',
              })}
            </p>
          </div>
          {/* Horizontal sampling pipeline — driven by the live SamplingStatus
              enum. The terminal step opens the sample sign-off dialog. */}
          <SamplingPipelineStepper
            samplingStatus={style.samplingStatus as SamplingStatus | null}
            onStepClick={
              // Editable only after intake is approved (lifecycle = in_sampling)
              // AND by a PD editor. Drafts — and cataloguer — get it read-only.
              style.lifecycle === 'in_sampling' && canEditWorkflow
                ? (next) =>
                    void doAction('step', () =>
                      patchStyle(style.id, { samplingStatus: next }),
                    )
                : undefined
            }
            onApproveClick={
              canSampleApprove ? () => setSampleApproveOpen(true) : undefined
            }
          />
        </section>
      )}

      {isProductionLayout && (
        <ColourFamilyCard
          style={style}
          family={colourFamily}
          canAddColour={canAddColour}
          onAddColour={() => setColourModalOpen(true)}
        />
      )}

      {/* China Import: simple "Approved by X on DATE" record card. */}
      {isChinaImport && style.approvedAt && (
        <ChinaImportApprovalCard style={style} cardClasses={cardClasses} />
      )}

      {/* ── Main area — two columns ──
          LEFT: product image gallery (compact). RIGHT: Core specs → Bill of
          materials → Pattern/CAD → Activity log, stacked top-to-bottom.
          Same shape for both sampling + production layouts. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-4 space-y-4">{imagePanelCard}</div>
        <div className="lg:col-span-8 space-y-4">
          {coreSpecsCard}
          {billOfMaterialsCard}
          {patternCadCard}
          {channelsCard}
          {activityLogCard}
        </div>
      </div>

      <AddColourModal
        parent={style}
        // Whole colour family (every sibling sharing familyCode), resolved
        // off the BE — so the duplicate guard + "existing colours" strip
        // are correct even when Add-Colour is opened from a SIBLING rather
        // than the root. Not parent.colourVariants (root-only).
        family={colourFamily}
        open={colourModalOpen}
        onClose={() => setColourModalOpen(false)}
        onCreated={(created) => {
          // Navigate to the new variant so the designer can pick up the
          // sample flow from there. Use numeric id when no styleId is
          // minted yet (it's a draft).
          navigate(`/styles/${created.styleId ?? created.id}`);
        }}
      />

      {/* Full editor — renders the SAME shared form the /styles/new
          page uses, wrapped in a centered modal. */}
      <StyleEditModal
        open={editOpen}
        style={style}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          // If the styleId changed (e.g. after first approval mints
          // it) route to the new canonical URL; otherwise just
          // refresh the current page.
          if (saved.styleId && saved.styleId !== style.styleId) {
            navigate(`/styles/${saved.styleId}`);
          } else {
            void load();
          }
        }}
      />

      {/* Scoped Core-specifications editor — working name, gender,
          category, fabric, primary colour, sampling timeline only. */}
      <CoreSpecsEditModal
        open={coreSpecsEditOpen}
        style={style}
        fabrics={fabrics}
        onClose={() => setCoreSpecsEditOpen(false)}
        onSaved={(saved) => {
          if (saved.styleId && saved.styleId !== style.styleId) {
            navigate(`/styles/${saved.styleId}`);
          } else {
            void load();
          }
        }}
      />

      {/* Scoped Bill-of-materials editor — fabric + sample fabric
          required only. */}
      <BomEditModal
        open={bomEditOpen}
        style={style}
        fabrics={fabrics}
        onClose={() => setBomEditOpen(false)}
        onSaved={(saved) => {
          if (saved.styleId && saved.styleId !== style.styleId) {
            navigate(`/styles/${saved.styleId}`);
          } else {
            void load();
          }
        }}
      />

      {/* Scoped Pattern / CAD editor — uploads CAD files and patches
          patternCadPaths only (no full intake form). */}
      <PatternCadEditModal
        open={patternCadEditOpen}
        style={style}
        onClose={() => setPatternCadEditOpen(false)}
        onSaved={(saved) => {
          if (saved.styleId && saved.styleId !== style.styleId) {
            navigate(`/styles/${saved.styleId}`);
          } else {
            void load();
          }
        }}
      />

      {/* Revive confirmation — reviving resets sampling state + re-enters
          Approval #1, so confirm before acting. */}
      <ConfirmDialog
        open={reviveConfirmOpen}
        title={t('admin.styles.revive.title', { defaultValue: 'Revive style?' })}
        message={t('admin.styles.revive.body', {
          defaultValue:
            'This resets sampling state and sends the style back to Approval #1.',
        })}
        confirmLabel={t('admin.styles.workspace.revive', {
          defaultValue: 'Revive',
        })}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        onCancel={() => setReviveConfirmOpen(false)}
        onConfirm={() => {
          setReviveConfirmOpen(false);
          void doAction('revive', () => reviveStyle(style.id));
        }}
      />

      {/* Park confirmation — captures the reason for the audit log. */}
      <ParkDialog
        open={parkOpen}
        busy={busy !== null}
        approved={false}
        styleLabel={
          style.styleId ??
          (style.draftNo != null ? `D-${style.draftNo}` : style.workingName) ??
          null
        }
        onClose={() => setParkOpen(false)}
        onConfirm={(reason) => {
          setParkOpen(false);
          void doAction('park', () => parkStyle(style.id, { reason }));
        }}
      />

      {/* Approval #1 checklist dialog — sampling flow only */}
      <Approval1Dialog
        open={approveOpen}
        busy={busy !== null}
        gender={style.gender}
        onClose={() => setApproveOpen(false)}
        onConfirm={(body) => {
          setApproveOpen(false);
          void doAction('approve', () => approveStyle(style.id, body));
        }}
      />

      {/* Approval #2 (sample sign-off) dialog */}
      <SampleApproveDialog
        open={sampleApproveOpen}
        busy={busy !== null}
        costPrice={style.costPrice}
        onClose={() => setSampleApproveOpen(false)}
        onConfirm={(body) => {
          setSampleApproveOpen(false);
          void doAction('sample-approve', () =>
            sampleApproveStyle(style.id, body),
          );
        }}
      />

      {/* Add-listings picker — records each channel + link as a prepared
          listing. Going live happens when EasyEcom is marked done. */}
      <GoLiveDialog
        open={listingsOpen}
        busy={busy !== null}
        existing={style.channelListings ?? []}
        onClose={() => setListingsOpen(false)}
        onConfirm={(channels) => {
          setListingsOpen(false);
          void doAction('list-channels', async () => {
            // Prepare each channel in turn; the last result refreshes state.
            let updated = style;
            for (const ch of channels) {
              updated = await setMarketplaceListing(style.id, {
                channel: ch.channel,
                listed: true,
                listingUrl: ch.listingUrl,
              });
            }
            return updated;
          });
        }}
      />
    </div>
  );
}

/**
 * Channels / live-listings card. Surfaced in the go-to-market lifecycle
 * (cataloguing / live). Renders each StyleChannelListing with its state pill
 * and a clickable listing URL (new tab) when present.
 */
function ChannelsCard({
  style,
  cardClasses,
  cataloguingStatus,
  canManage,
  easyecomDone,
  onSetEasyecom,
  onTakeOffline,
  outOfStock,
  onMarkOutOfStock,
}: {
  style: Style;
  cardClasses: string;
  cataloguingStatus: Style['cataloguingStatus'];
  canManage: boolean;
  easyecomDone: boolean;
  onSetEasyecom: (done: boolean) => void;
  onTakeOffline: (channel: ChannelName, reason: string) => void;
  outOfStock: boolean;
  onMarkOutOfStock: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const listings = (style.channelListings ?? []).filter(
    (l) => l.state !== 'off',
  );
  // EasyEcom-done is order-gated: at least one channel must be listed (prepared,
  // with a link) first. Mirror the BE guard so the toggle is disabled until then.
  const hasPreparedListing = listings.some(
    (l) => l.state === 'draft' && !!l.listingUrl,
  );
  const easyecomBlocked = !easyecomDone && !hasPreparedListing;
  const stateBadge = (s: StyleChannelListing['state']) =>
    s === 'live' ? 'success' : s === 'draft' ? 'warning' : 'outline';
  // Take-offline target + reason (the consequential un-publish lives here in
  // the workspace, not on the dashboard).
  const [offlineChannel, setOfflineChannel] = useState<ChannelName | null>(
    null,
  );
  const [offlineReason, setOfflineReason] = useState('');
  // Take-out-of-stock dialog state. One-way: confirming demotes the live style
  // back to the EasyEcom checkpoint (its live listings revert to draft) to be
  // re-published — that republish is the way back to stock, not a revive here.
  // The dialog captures an optional reason.
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockReason, setStockReason] = useState('');
  return (
    <section className={cardClasses}>
      <CardHeader
        title={t('admin.styles.workspace.channelsTitle', {
          defaultValue: 'Channels',
        })}
        right={
          style.lifecycle === 'cataloguing' ? (
            <Badge
              variant={cataloguingStatus === 'done' ? 'success' : 'warning'}
              className="text-[10px]"
            >
              {t(
                `admin.styles.cataloguingStatus.${cataloguingStatus ?? 'pending'}` as const,
                {
                  defaultValue:
                    cataloguingStatus === 'done'
                      ? 'Cataloguing · done'
                      : 'Cataloguing · pending',
                },
              )}
            </Badge>
          ) : (
            <Badge variant="success" className="text-[10px]">
              {t('admin.styles.workspace.liveStage', { defaultValue: 'Live' })}
            </Badge>
          )
        }
      />
      <div className="p-5">
        {/* Restock-pending banner — this style is back in cataloguing because
            it was taken out of stock. Re-publishing it (the EasyEcom checkpoint
            below) re-promotes its prepared listings and restocks it. */}
        {style.lifecycle === 'cataloguing' && outOfStock && (
          <div className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-red-200 bg-red-50 px-3 py-2.5">
            <PackageX
              size={18}
              aria-hidden
              className="mt-0.5 shrink-0 text-red-600"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">
                  {t('admin.styles.workspace.stockTitle', {
                    defaultValue: 'Stock',
                  })}
                </p>
                <Badge variant="destructive" className="text-[10px]">
                  {t('admin.styles.workspace.outOfStock', {
                    defaultValue: 'Out of stock',
                  })}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                {t('admin.styles.workspace.outOfStockBanner', {
                  defaultValue:
                    'Taken out of stock — re-publish (mark EasyEcom done) to restock and go live again.',
                })}
              </p>
            </div>
          </div>
        )}
        {/* EasyEcom checkpoint — the go-live trigger. Ticking it auto-promotes
            the prepared (listed) channels to live; it's disabled until at least
            one channel is listed with a link (see easyecomBlocked).
            Editable by cataloguers. */}
        {style.lifecycle === 'cataloguing' && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t('admin.styles.workspace.easyecomTitle', {
                  defaultValue: 'EasyEcom catalog',
                })}
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {easyecomBlocked
                  ? t('admin.styles.workspace.easyecomHintBlocked', {
                      defaultValue:
                        'Add at least one marketplace listing (with its link) first — then this takes the style live.',
                    })
                  : t('admin.styles.workspace.easyecomHint', {
                      defaultValue:
                        'Marking this done takes the listed channels live.',
                    })}
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                aria-pressed={easyecomDone}
                disabled={easyecomBlocked}
                title={
                  easyecomBlocked
                    ? t('admin.styles.workspace.easyecomHintBlocked', {
                        defaultValue:
                          'Add at least one marketplace listing (with its link) first.',
                      })
                    : undefined
                }
                onClick={() => onSetEasyecom(!easyecomDone)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50',
                  easyecomDone
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-muted-foreground)] border border-[var(--color-border)]',
                )}
              >
                {easyecomDone
                  ? t('admin.styles.workspace.easyecomDone', {
                      defaultValue: 'Done',
                    })
                  : t('admin.styles.workspace.easyecomPending', {
                      defaultValue: 'Pending',
                    })}
              </button>
            ) : (
              <Badge
                variant={easyecomDone ? 'success' : 'warning'}
                className="text-[10px]"
              >
                {easyecomDone
                  ? t('admin.styles.workspace.easyecomDone', {
                      defaultValue: 'Done',
                    })
                  : t('admin.styles.workspace.easyecomPending', {
                      defaultValue: 'Pending',
                    })}
              </Badge>
            )}
          </div>
        )}
        {/* Stock — a live style is buyable. Taking it out of stock is the
            INVERSE of go-live: it returns to the EasyEcom checkpoint to be
            re-published (one-way; republishing restocks it). Editable by
            cataloguers. */}
        {style.lifecycle === 'live' && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <PackageCheck
                size={18}
                aria-hidden
                className="mt-0.5 shrink-0 text-emerald-600"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">
                    {t('admin.styles.workspace.stockTitle', {
                      defaultValue: 'Stock',
                    })}
                  </p>
                  <Badge variant="success" className="text-[10px]">
                    {t('admin.styles.workspace.inStock', {
                      defaultValue: 'In stock',
                    })}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {t('admin.styles.workspace.outOfStockHint', {
                    defaultValue:
                      'Taking it out of stock returns it to the EasyEcom checkpoint to re-publish. Zero its EasyEcom inventory by hand.',
                  })}
                </p>
              </div>
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="destructive"
                className="shrink-0"
                onClick={() => {
                  setStockReason('');
                  setStockDialogOpen(true);
                }}
              >
                {t('admin.styles.workspace.markOutOfStock', {
                  defaultValue: 'Mark out of stock',
                })}
              </Button>
            )}
          </div>
        )}
        {listings.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t('admin.styles.workspace.channelsNone', {
              defaultValue:
                'No listings yet. Use "Add listings" to add a channel + its link.',
            })}
          </p>
        ) : (
          <ul className="space-y-2">
            {listings.map((l) => (
              <li
                key={l.id}
                className="flex items-start justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2.5"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <Store
                    size={18}
                    aria-hidden
                    className={cn(
                      'mt-0.5 shrink-0',
                      l.state === 'live'
                        ? 'text-emerald-600'
                        : l.state === 'draft'
                          ? 'text-amber-600'
                          : 'text-[var(--color-muted-foreground)]',
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t(`admin.styles.channel.${l.channel}` as const, {
                          defaultValue: l.channel,
                        })}
                      </span>
                      <Badge
                        variant={stateBadge(l.state)}
                        className="text-[10px]"
                      >
                        {t(`admin.styles.channel.state.${l.state}` as const, {
                          defaultValue: l.state,
                        })}
                      </Badge>
                    </div>
                    {/* Secondary line — mirrors the Stock row's hint slot. */}
                    <div className="mt-0.5">
                      {l.listingUrl ? (
                        <a
                          href={l.listingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
                        >
                          {t('admin.styles.workspace.viewListing', {
                            defaultValue: 'View listing',
                          })}
                          <ExternalLink size={12} aria-hidden />
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          {t('admin.styles.workspace.noListingUrl', {
                            defaultValue: 'No URL',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Take-offline — only for live channels, write-gated. A button
                    (not a text link) so it reads as the same design family as
                    the Stock row's action. */}
                {canManage && l.state === 'live' && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="shrink-0"
                    onClick={() => {
                      setOfflineReason('');
                      setOfflineChannel(l.channel);
                    }}
                  >
                    {t('admin.styles.workspace.takeOffline', {
                      defaultValue: 'Take offline',
                    })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Take-offline reason dialog. */}
      <Dialog
        open={offlineChannel !== null}
        onClose={() => setOfflineChannel(null)}
        title={t('admin.styles.workspace.takeOfflineTitle', {
          defaultValue: 'Take offline',
        })}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOfflineChannel(null)}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!offlineReason.trim()}
              onClick={() => {
                if (offlineChannel) {
                  onTakeOffline(offlineChannel, offlineReason.trim());
                }
                setOfflineChannel(null);
              }}
            >
              {t('admin.styles.workspace.takeOffline', {
                defaultValue: 'Take offline',
              })}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
          {t('admin.styles.workspace.takeOfflineIntro', {
            defaultValue:
              'This removes the live listing. If no other channel is live the style returns to cataloguing.',
          })}
        </p>
        <label className="mb-1 block text-xs text-[var(--color-muted-foreground)]">
          {t('admin.styles.workspace.takeOfflineReason', {
            defaultValue: 'Reason (required)',
          })}
        </label>
        <Textarea
          value={offlineReason}
          onChange={(e) => setOfflineReason(e.target.value)}
        />
      </Dialog>

      {/* Take-out-of-stock dialog. One-way: confirming demotes the live style
          back to the EasyEcom checkpoint to be re-published. Optional reason. */}
      <Dialog
        open={stockDialogOpen}
        onClose={() => setStockDialogOpen(false)}
        title={t('admin.styles.workspace.outOfStockTitle', {
          defaultValue: 'Mark out of stock',
        })}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStockDialogOpen(false)}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                onMarkOutOfStock(stockReason.trim());
                setStockDialogOpen(false);
              }}
            >
              {t('admin.styles.workspace.markOutOfStock', {
                defaultValue: 'Mark out of stock',
              })}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
          {t('admin.styles.workspace.outOfStockIntro', {
            defaultValue:
              'Returns the style to the EasyEcom checkpoint (its live listings revert to prepared) — re-publish to sell again. Zero its inventory in EasyEcom yourself; NOWI only records the state.',
          })}
        </p>
        <label className="mb-1 block text-xs text-[var(--color-muted-foreground)]">
          {t('admin.styles.workspace.outOfStockReason', {
            defaultValue: 'Reason (optional)',
          })}
        </label>
        <Textarea
          value={stockReason}
          onChange={(e) => setStockReason(e.target.value)}
        />
      </Dialog>
    </section>
  );
}

/**
 * Sampling timeline is stored as a free-form string at the moment
 * (legacy column shape). The intake form writes a plain integer count
 * of days now ("5"); some older rows still hold ISO dates from the
 * pre-revamp UI. Render both cases sanely:
 *   - integer → "5 days" / "1 day"
 *   - ISO     → localized date
 *   - other   → as-is
 */
function renderSamplingTimeline(value: string | null | undefined): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return `${n} ${n === 1 ? 'day' : 'days'}`;
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  return trimmed;
}

/**
 * Section card header strip — the Stitch "title bar on a tinted band"
 * look, rendered in the app's surface-2 / border tokens. Optional trailing
 * slot (e.g. an edit / upload affordance) sits on the right.
 */
function CardHeader({
  title,
  right,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <h3 className="font-serif text-base font-semibold m-0">{title}</h3>
      {right}
    </div>
  );
}

/**
 * Core-specs table row — label cell on a tinted band, value cell beside
 * it. Mirrors the mock's `<th>`/`<td>` row structure (uppercase caps
 * label + tabular value), rendered as a flex row in the app's tokens.
 */
function SpecRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-4 py-3',
        !last && 'border-b border-[var(--color-border)]',
      )}
    >
      <span className="w-1/3 shrink-0 text-[11px] uppercase tracking-[0.05em] font-semibold text-[var(--color-muted-foreground)]">
        {label}
      </span>
      <span className="flex-1 font-mono text-[13px] text-[var(--color-foreground)] break-words">
        {value}
      </span>
    </div>
  );
}

/**
 * Small round colour swatch. We only know `primaryColour` as a free-text
 * name; pass it straight to CSS (most catalogue names — Indigo, Black,
 * Sand — resolve), and fall back to a neutral filled dot otherwise so the
 * element is always present per the mock.
 */
function ColourSwatch({ colour }: { colour: string | null }) {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 rounded-full border border-[var(--color-border-strong)] shadow-sm"
      style={{
        backgroundColor: colour ?? 'var(--color-muted-foreground-2)',
      }}
    />
  );
}

/**
 * Bill of materials card. The mock lists a materials table (Main fabric,
 * trims …). The Style model only carries the main fabric today, so we
 * render the single derived "Main fabric" row from `style.fabric` (+ the
 * sample-fabric requirement as the quantity). The header affordance is an
 * "add" icon in the sampling mock and an "Edit BOM" button in production;
 * both route to the Edit surface (no inline BOM editor on this page).
 */
function BillOfMaterialsCard({
  style,
  cardClasses,
  production,
  onEdit,
}: {
  style: Style;
  cardClasses: string;
  production: boolean;
  // Absent for read-only viewers — the Edit/＋ affordance is then hidden.
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const fabricName = style.fabric?.name ?? '—';
  const qty =
    style.sampleFabricRequired != null
      ? `${style.sampleFabricRequired} ${
          style.fabric?.unitOfMeasure === 'meter'
            ? 'm'
            : (style.fabric?.unitOfMeasure ?? 'm')
        }`
      : '—';
  return (
    <section className={cardClasses}>
      <CardHeader
        title={t('admin.styles.workspace.billOfMaterials', {
          defaultValue: 'Bill of materials',
        })}
        right={
          !onEdit ? undefined : production ? (
            <button
              type="button"
              onClick={onEdit}
              className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] text-[var(--color-foreground)] text-xs hover:bg-[var(--color-surface-2)] transition-colors"
            >
              {t('admin.styles.workspace.editBom', {
                defaultValue: 'Edit BOM',
              })}
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('admin.styles.workspace.editBom', {
                defaultValue: 'Edit BOM',
              })}
              onClick={onEdit}
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors"
            >
              <Plus size={18} />
            </button>
          )
        }
      />
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
              <th className="px-4 py-2 text-[11px] uppercase tracking-[0.05em] font-semibold text-[var(--color-muted-foreground)]">
                {production
                  ? t('admin.styles.workspace.bomItem', {
                      defaultValue: 'Item',
                    })
                  : t('admin.styles.workspace.bomType', {
                      defaultValue: 'Type',
                    })}
              </th>
              <th className="px-4 py-2 text-[11px] uppercase tracking-[0.05em] font-semibold text-[var(--color-muted-foreground)]">
                {production
                  ? t('admin.styles.workspace.bomSpec', {
                      defaultValue: 'Spec',
                    })
                  : t('admin.styles.workspace.bomDescription', {
                      defaultValue: 'Description',
                    })}
              </th>
              <th className="px-4 py-2 text-right text-[11px] uppercase tracking-[0.05em] font-semibold text-[var(--color-muted-foreground)]">
                {production
                  ? t('admin.styles.workspace.bomQty', { defaultValue: 'Qty' })
                  : t('admin.styles.workspace.bomQuantity', {
                      defaultValue: 'Quantity',
                    })}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="hover:bg-[var(--color-surface-2)] transition-colors">
              <td className="px-4 py-3 font-mono text-[13px] text-[var(--color-foreground)]">
                {t('admin.styles.workspace.bomMainFabric', {
                  defaultValue: 'Main fabric',
                })}
              </td>
              <td className="px-4 py-3 text-[13px] text-[var(--color-foreground-2)]">
                {fabricName}
              </td>
              <td className="px-4 py-3 font-mono text-[13px] text-[var(--color-foreground)] text-right">
                {qty}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Compact "Colour family" strip. Lists every sibling sharing this style's
 * `familyCode` — the marketplace "other colours" group — resolved off the
 * BE colour-group endpoint and passed in as `family`. The current style is
 * marked "this style"; the rest render as chips. The trailing "+ Add
 * colour" chip opens the AddColourModal (gated upstream).
 */
function ColourFamilyCard({
  style,
  family,
  canAddColour,
  onAddColour,
}: {
  style: Style;
  /** Whole colour family from the BE — every sibling sharing familyCode,
   *  including `style` itself. Empty for a style with no family. */
  family: Style[];
  /** Gated POST_SAMPLING + colour-WRITE — see canAddColour upstream. */
  canAddColour: boolean;
  onAddColour: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hasFamily = family.length > 1;
  // Render the WHOLE family in its stable order (the BE colourGroup order),
  // highlighting the style we're viewing IN PLACE — selecting a sibling only
  // navigates + re-highlights, so a colour never jumps to the front. Falls
  // back to the lone current style when it has no family yet (chip still shows).
  const members = family.length > 0 ? family : [style];
  // Hide entirely when there's no family AND no add affordance.
  if (!hasFamily && !canAddColour) return null;
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
        <h2 className="font-serif text-base font-semibold m-0">
          {t('admin.styles.workspace.colourFamily', {
            defaultValue: 'Colour family',
          })}
          {hasFamily && (
            <span className="text-[var(--color-muted-foreground)] font-normal">
              {' · '}
              {family.length}
            </span>
          )}
        </h2>
        <p className="text-xs text-[var(--color-muted-foreground)] m-0">
          {t('admin.styles.workspace.colourFamilySubtitle', {
            defaultValue:
              'Same design, different colours — grouped as "other colours" on marketplaces.',
          })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {members.map((v) =>
          v.id === style.id ? (
            // Current style — highlighted IN PLACE (kept in its family slot,
            // never moved to the front).
            <span
              key={v.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-3 py-1.5 text-xs text-[var(--color-primary)]"
              title={v.styleId ?? undefined}
            >
              <ColourSwatch colour={v.primaryColour} />
              <span className="font-mono">
                {v.primaryColour ?? '—'}
                {' · '}
                {t('admin.styles.workspace.colourFamilyThisStyle', {
                  defaultValue: 'this style',
                })}
              </span>
            </span>
          ) : (
            <button
              key={v.id}
              type="button"
              onClick={() => navigate(`/styles/${v.styleId ?? v.id}`)}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-foreground-2)] hover:bg-[var(--color-surface-2)] transition-colors"
              title={v.styleId ?? undefined}
            >
              <ColourSwatch colour={v.primaryColour} />
              <span className="font-mono">
                {v.primaryColour ?? '—'}
                {v.styleId ? ` → ${v.styleId}` : ''}
              </span>
            </button>
          ),
        )}
        {canAddColour && (
          <button
            type="button"
            onClick={onAddColour}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--color-border-strong)] text-[var(--color-muted-foreground)] px-3 py-1.5 text-xs hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-colors"
          >
            <Plus size={16} />
            {t('admin.styles.workspace.addColour', {
              defaultValue: 'Add colour',
            })}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * China Import approval card. Gurukul flow has no sampling phase —
 * just a single intake approval that mints the NW- number
 * and takes the style to terminal lifecycle.
 */
function ChinaImportApprovalCard({
  style,
  cardClasses,
}: {
  style: Style;
  cardClasses: string;
}) {
  const { t } = useTranslation();
  const approvedAt = style.approvedAt ? new Date(style.approvedAt) : null;
  return (
    <section className={cardClasses}>
      <CardHeader
        title={t('admin.styles.workspace.chinaImportApproval.title', {
          defaultValue: 'Approval',
        })}
        right={
          <Badge variant="success" className="text-[10px]">
            <CheckCircle2 size={11} className="mr-1" />
            {t('admin.styles.workspace.chinaImportApproval.approved', {
              defaultValue: 'Approved',
            })}
          </Badge>
        }
      />
      <div className="p-5">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-[var(--color-muted-foreground)] mb-0.5">
              {t('admin.styles.workspace.chinaImportApproval.approvedBy', {
                defaultValue: 'Approved by',
              })}
            </dt>
            <dd className="text-sm text-[var(--color-foreground)] break-words">
              {style.approver?.name ?? '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-[var(--color-muted-foreground)] mb-0.5">
              {t('admin.styles.workspace.chinaImportApproval.approvedOn', {
                defaultValue: 'Approved on',
              })}
            </dt>
            <dd className="text-sm text-[var(--color-foreground)] break-words">
              {approvedAt ? approvedAt.toLocaleString() : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-[var(--color-muted-foreground)] mb-0.5">
              {t('admin.styles.workspace.chinaImportApproval.styleNumber', {
                defaultValue: 'Style # minted',
              })}
            </dt>
            <dd className="text-sm text-[var(--color-foreground)] break-words">
              <span className="font-mono">{style.styleId ?? '—'}</span>
            </dd>
          </div>
        </dl>
        {style.remark && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
            <div className="text-[10px] uppercase tracking-[0.06em] text-[var(--color-muted-foreground)] mb-1">
              {t('admin.styles.workspace.chinaImportApproval.remark', {
                defaultValue: 'Remark',
              })}
            </div>
            <p className="text-sm italic whitespace-pre-wrap text-[var(--color-foreground-2)]">
              {style.remark}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Activity timeline — surfaces the audit log already hydrated by the
 * detail include. Compact list of "actor · action · time". The most-recent
 * entry's dot is brand-primary; older ones are muted, matching the mock's
 * activity-log treatment.
 */
function ActivityTimelineCard({
  style,
  cardClasses,
}: {
  style: Style;
  cardClasses: string;
}) {
  const { t } = useTranslation();
  const logs = style.auditLogs ?? [];
  if (logs.length === 0) return null;

  // Describe WHAT each entry changed by diffing its before/after snapshots
  // (BE StylesService.diffSnapshot). `chips` = changed fields, showing the
  // new value for enum-ish fields (reusing the samplingSteps / sampleApproval
  // i18n labels); `note` = any free text (e.g. a park reason). `created` has
  // no `before`, so its verb label ("Created") stands on its own.
  const summarize = (
    log: StyleAuditLog,
  ): { chips: string[]; note: string | null } => {
    const note = log.notes ?? null;
    const before = log.before as Record<string, unknown> | null;
    const after = (log.after ?? {}) as Record<string, unknown>;
    if (!before) return { chips: [], note };
    const fmt = (k: string, v: unknown): string | null => {
      if (v === null || v === undefined || v === '') return null;
      switch (k) {
        case 'samplingStatus':
          return t(`admin.styles.samplingSteps.${String(v)}` as const, {
            defaultValue: String(v),
          });
        case 'sampleApproval':
          return t(`admin.styles.sampleApproval.${String(v)}` as const, {
            defaultValue: String(v),
          });
        case 'gender':
          return genderLabel(String(v));
        case 'lifecycle':
          return String(v).replace(/_/g, ' ');
        case 'samplingTimeline': {
          // Guard against non-ISO values (e.g. legacy day-count strings)
          // so the chip never reads "Invalid Date" — mirrors the guard in
          // renderSamplingTimeline.
          const d = new Date(String(v));
          return Number.isNaN(d.getTime())
            ? String(v)
            : d.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              });
        }
        case 'sampleFabricRequired':
          // A Decimal quantity in metres (serialized "2.50"), not a flag —
          // show the actual value that changed, not a boolean label.
          return `${String(v)} m`;
        case 'styleId':
        case 'primaryColour':
        case 'reason':
          return String(v);
        default:
          // Long/opaque text (working name, remark, links) → label only.
          return null;
      }
    };
    const chips: string[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
      const label = AUDIT_FIELD_LABELS[k] ?? k;
      const v = fmt(k, after[k]);
      chips.push(v ? `${label}: ${v}` : label);
    }
    return { chips, note };
  };

  return (
    <section className={cardClasses}>
      <CardHeader
        title={t('admin.styles.workspace.activity', {
          defaultValue: 'Activity log',
        })}
      />
      {/* The log sits at the bottom of the right-hand stack (Core specs →
          BoM → Pattern/CAD → Activity log) and scrolls inside a capped
          height so a long history never pushes the page. A thin,
          always-visible scrollbar signals there's more to scroll (vs.
          macOS overlay bars that hide). */}
      <div className="relative">
        <div className="overflow-y-auto p-5 max-h-[480px] [scrollbar-width:thin] [scrollbar-color:var(--color-muted-foreground-2)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-muted-foreground-2)]">
          <ol className="relative ml-1.5 border-l border-[var(--color-border)] space-y-5">
            {logs.slice(0, 20).map((log, i) => {
              const { chips, note } = summarize(log);
              return (
                <li key={log.id} className="relative pl-5">
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-surface)]',
                      i === 0
                        ? 'bg-[var(--color-primary)]'
                        : 'bg-[var(--color-muted-foreground-2)]',
                    )}
                  />
                  <div className="text-sm text-[var(--color-foreground)]">
                    <span className="font-medium">
                      {log.actor?.name ?? '—'}
                    </span>
                    {' — '}
                    <span className="text-[var(--color-muted-foreground)]">
                      {t(`admin.styles.audit.${log.action}` as const, {
                        defaultValue: log.action,
                      })}
                    </span>
                  </div>
                  {/* What actually changed — chips of field → new value, so
                      the entry reads "Stage: QC" instead of a bare "Updated". */}
                  {chips.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {chips.map((c) => (
                        <span
                          key={c}
                          className="rounded-[6px] bg-[var(--color-muted)] px-1.5 py-0.5 text-[11px] text-[var(--color-foreground)]"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {note && (
                    <div className="mt-1.5 text-[12px] italic text-[var(--color-muted-foreground)]">
                      “{note}”
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-[var(--color-muted-foreground)] tabular-nums">
                    {new Date(log.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
