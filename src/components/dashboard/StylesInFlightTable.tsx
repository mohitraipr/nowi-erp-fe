import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Link2,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { FloatingPill, TruncText } from '@/components/ui/trunc-text';
import { FilterChips } from '@/components/ui/filter-rail';
import { useToast } from '@/components/ui/toast';
import Approval1Dialog from '@/components/styles/Approval1Dialog';
import ParkDialog from '@/components/styles/ParkDialog';
import {
  StyleQueueTable,
  QueueTabs,
  StyleRefLink,
  ColourCell,
  compactAge,
  ApproveButton,
  GhostActionButton,
  PrimaryActionButton,
  RowChevron,
  type QueueColumn,
} from '@/components/styles/StyleQueueTable';
import {
  getDashboardStyles,
  type DashboardStyleRow,
  type DashboardStyleTab,
  type DashboardStatusFilter,
} from '@/api/dashboard';
import {
  approveStyle,
  parkStyle,
  patchStyle,
  setEasyecomDone,
  setMarketplaceListing,
  sampleApproveStyle,
  startCataloguing,
  type SamplingStatus,
  type GoLiveChannel,
  type SampleApproveStyleBody,
} from '@/api/styles';
import type { StyleChannelListing } from '@/api/types';
import GoLiveDialog from '@/components/styles/GoLiveDialog';
import SampleApproveDialog from '@/components/styles/SampleApproveDialog';
import { useAuth } from '@/context/auth';
import {
  hasAnyRole,
  PD_WRITE_ROLES,
  APPROVER_ROLES,
  ADMIN_ROLES,
  CATALOGUER_WRITE_ROLES,
  PRODUCTION_WRITE_ROLES,
} from '@/lib/userRoles';
import { createBatch, getStyleSizes } from '@/api/production';
import StartProductionDialog, {
  type StartProductionTarget,
} from '@/components/production/StartProductionDialog';
import { useDebounced } from '@/lib/useDebounced';
import { formatStyleRef } from '@/lib/styleRef';

/**
 * Self-contained Home content surface — the per-style "Styles in flight"
 * table. Owns its own tab + (debounced) search state and fetches its own
 * data via `getDashboardStyles`. Renders the shared `StyleQueueTable` so
 * the dashboard and the Sampling registry share one table design; PD
 * styles carry no lots, so STAGE is a coarse lifecycle/sampling/production
 * pill — never a unit-level X/Y (see docs/DASHBOARD_REDESIGN.md).
 */

interface Props {
  /** Seed the starting tab — Home passes it from a `?tab=` query param. */
  initialTab?: DashboardStyleTab;
  /** Activity window (YYYY-MM-DD) from the shared dashboard date control. */
  from?: string;
  to?: string;
  /**
   * Called after a successful inline approve/park (in addition to the
   * table's own refetch) so the Home can refresh its summary cards.
   */
  onActionDone?: () => void;
  /**
   * "View all" — reset the shared activity window so every product shows,
   * regardless of last-touched date. Rendered as a bottom-bar button on
   * every tab; omit to hide it.
   */
  onViewAll?: () => void;
}

// `my_work` is the FIRST chip — a ROLE-AWARE union of the caller's actionable
// queue (approver → pending approvals; sampling author → their own in-progress
// sampling; cataloguer → the cataloguing queue), the default tab + the target
// of the "My work" summary card.
const TABS: DashboardStyleTab[] = [
  'my_work',
  'all',
  'draft',
  'sampling',
  'cataloguing',
  'live',
  // Paused designs (lifecycle = parked). A standing bucket like draft/live —
  // no STATUS_OPTIONS_BY_TAB entry, so its status-filter control auto-hides.
  'parked',
];

// Multi-select status filter options per tab — only the statuses REACHABLE in
// that tab, so the filter narrows without offering dead choices. Tabs with one
// (or zero) reachable status (draft / live) omit the control entirely. The two
// cataloguing sub-states mirror the Status column ("Ready to publish" once a
// channel is prepared, else "Listings pending"). The BE AND's these with the
// tab, so the filter always scopes the current bucket.
const STATUS_OPTIONS_BY_TAB: Partial<
  Record<DashboardStyleTab, DashboardStatusFilter[]>
> = {
  all: [
    'draft',
    'in_sampling',
    'sample_approved',
    'ready_to_publish',
    'listings_pending',
    'live',
  ],
  sampling: ['in_sampling', 'sample_approved'],
  cataloguing: ['ready_to_publish', 'listings_pending'],
  my_work: ['draft', 'in_sampling', 'ready_to_publish', 'listings_pending'],
};

// Rows per page in the in-flight feed. 50 keeps the smaller tabs on a single
// page while still paginating the larger "All" list (BE caps `take` at 200).
const PAGE_SIZE = 50;

// Roles allowed to inline-edit the sampling Stage. NOT STYLE_EDIT_ROLES:
// `cataloguer` was widened into that set to edit a design's SPECS, but moving a
// style through the sampling pipeline is workflow, and the BE rejects it from a
// style edit — showing the dropdown here would just 403 on click.
const INLINE_WRITE_ROLES = PD_WRITE_ROLES;

// Cost + MRP are pricing data, not design details — they stay on the PD editor
// set. `cataloguer` edits a style's specs, never what it costs to make.
const MONEY_WRITE_ROLES = PD_WRITE_ROLES;

// Sampling-status options for the inline Stage editor — the in-progress
// WORKING steps only. The terminal outcomes (sign-off / corrections) are NOT
// here: those go through the Approve-sample dialog (the single sign-off path),
// not a silent dropdown set. Labels render via `admin.styles.samplingSteps.*`.
const SAMPLING_STATUS_OPTIONS: SamplingStatus[] = [
  'in_progress_pattern_dev',
  'in_progress_fabric_sourcing',
  'in_progress_cutting',
  'ready_for_inspection',
];

// Per-channel brand chip: a small coloured square with the channel's initial
// (Myntra red, Amazon amber, …). Keeps the marketplace cell scannable.
const CHANNEL_BRAND: Record<string, { bg: string; fg: string; ch: string }> = {
  myntra: { bg: '#ef4444', fg: '#ffffff', ch: 'M' },
  nykaa: { bg: '#e91e8c', fg: '#ffffff', ch: 'N' },
  amazon: { bg: '#ff9900', fg: '#1a1a1a', ch: 'A' },
  nowi_shopify: { bg: '#22c55e', fg: '#ffffff', ch: 'S' },
  other: { bg: '#64748b', fg: '#ffffff', ch: '•' },
};

/**
 * Row thumbnail (80px) that pops a large preview on hover. The preview is
 * portalled to <body> so the table's `overflow-x-auto` can't clip it, and
 * positioned to the right of the cell (flipping left near the viewport edge).
 */
export function HoverThumbnail({
  src,
  alt,
  size = 80,
  radius = 'var(--radius-sm)',
}: {
  src: string | null;
  alt: string;
  /** Thumbnail edge in px (default 80). Hover preview stays 240px. */
  size?: number;
  radius?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const SIZE = 240;
    const M = 8; // viewport margin
    // Prefer the right of the cell; flip to the left if it would overflow.
    const left =
      r.right + 12 + SIZE < window.innerWidth
        ? r.right + 12
        : r.left - 12 - SIZE;
    // Center on the row, then clamp so the preview never runs off the top or
    // bottom of the viewport (fixes the last-rows-clipped case).
    const rawTop = r.top + r.height / 2 - SIZE / 2;
    const top = Math.max(M, Math.min(rawTop, window.innerHeight - SIZE - M));
    setPos({ top, left });
    setHover(true);
  };
  const hide = () => setHover(false);

  const hasImg = !!src && !broken;
  return (
    <div
      ref={ref}
      onMouseEnter={hasImg ? show : undefined}
      onMouseLeave={hide}
      className="inline-block"
    >
      {hasImg ? (
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          style={{ width: size, height: size, borderRadius: radius }}
          className="shrink-0 cursor-zoom-in border border-[var(--color-border)] object-cover transition-transform"
        />
      ) : (
        <span
          aria-hidden
          style={{ width: size, height: size, borderRadius: radius }}
          className="flex shrink-0 items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted-foreground)]"
        >
          <ImageOff size={Math.round(size * 0.33)} />
        </span>
      )}
      {hover &&
        hasImg &&
        pos &&
        createPortal(
          <div
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-[60] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
          >
            <img src={src} alt={alt} className="h-60 w-60 object-cover" />
          </div>,
          document.body,
        )}
    </div>
  );
}

function ChannelLogo({ channel }: { channel: string }) {
  const b = CHANNEL_BRAND[channel] ?? CHANNEL_BRAND.other;
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold"
      style={{ background: b.bg, color: b.fg }}
    >
      {b.ch}
    </span>
  );
}

/**
 * Status pill with a leading dot — e.g. "• LIVE". `tone` maps to the app's
 * semantic tokens so it reads consistently with the rest of the UI.
 */
function DotStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'live' | 'pending' | 'neutral';
}) {
  // Bordered pill (matches the Style-Tracking mock): a subtle tone-tinted
  // border + pale fill + a brighter accent dot than the label text.
  const cfg: Record<typeof tone, { box: string; dot: string }> = {
    live: {
      box: 'border-[var(--color-success)]/30 bg-[var(--color-success-bg)] text-[var(--status-ready-ink)]',
      dot: 'bg-[var(--color-success)]',
    },
    pending: {
      box: 'border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] text-[var(--status-rework-ink)]',
      dot: 'bg-[var(--color-warning)]',
    },
    neutral: {
      box: 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted-foreground)]',
      dot: 'bg-[var(--color-muted-foreground)]',
    },
  };
  const c = cfg[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        c.box,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {label}
    </span>
  );
}

/**
 * Lightweight hover tooltip — wraps a trigger and, on hover/focus, shows a
 * styled detail pill centred above it. Zero-dependency (the house pattern,
 * mirroring HoverThumbnail / RailTooltip). Renders nothing when `content` is
 * empty, so callers can wrap unconditionally.
 */
export function HoverTip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const show = () => {
    if (ref.current) setRect(ref.current.getBoundingClientRect());
  };
  const hide = () => setRect(null);
  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </span>
      {rect && content && <FloatingPill rect={rect}>{content}</FloatingPill>}
    </>
  );
}

/**
 * Two-line metric cell — a bold primary line ("2d live") + a muted "Upd: Xd
 * ago" subline. Used by the go-to-market tabs where the row's age-in-state is
 * the at-a-glance signal.
 */
function MetricCell({
  primaryIso,
  primarySuffix,
  updatedIso,
}: {
  primaryIso: string | null;
  primarySuffix: string;
  updatedIso: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-bold text-[var(--color-foreground)] tabular-nums">
        {primaryIso ? `${compactAge(primaryIso)} ${primarySuffix}` : '—'}
      </span>
      <span className="text-[11px] text-[var(--color-muted-foreground)]">
        {t('dashboard.table.updatedAgo', {
          age: compactAge(updatedIso),
          defaultValue: `Upd: ${compactAge(updatedIso)}`,
        })}
      </span>
    </div>
  );
}

/** ₹ with Indian-grouping, no decimals when whole (₹1,200 / ₹1,200.50). */
function formatInr(value: number): string {
  return `₹${value.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;
}

// Only treat an absolute http(s) URL as a real link — a scheme-less/junk value
// (e.g. "kk") would resolve relative to our origin and go nowhere.
const isHttpUrl = (u?: string | null): u is string =>
  !!u && /^https?:\/\//i.test(u);

/**
 * Inline-editable price cell (cost or MRP). Writers click to edit (Enter/blur
 * saves, Escape cancels); an empty cell shows an "Add" affordance. Interactions
 * stop row-click propagation so editing never navigates into the style.
 */
function PriceCell({
  value,
  canEdit,
  editTitle,
  addLabel,
  onSave,
}: {
  value: number | null;
  canEdit: boolean;
  editTitle: string;
  addLabel: string;
  onSave: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = (e: MouseEvent) => {
    e.stopPropagation();
    setDraft(value != null ? String(value) : '');
    setEditing(true);
  };
  const commit = () => {
    const n = draft.trim() ? Number(draft) : NaN;
    setEditing(false);
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n);
  };

  if (editing) {
    return (
      <div className="relative w-24" onClick={(e) => e.stopPropagation()}>
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-[var(--color-muted-foreground)]">
          ₹
        </span>
        <input
          autoFocus
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          onBlur={commit}
          className="h-8 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-surface)] pl-5 pr-2 text-[12px] tabular-nums text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        />
      </div>
    );
  }

  if (!canEdit) {
    return (
      <span className="tabular-nums text-[var(--color-foreground)]">
        {value != null ? (
          formatInr(value)
        ) : (
          <span className="text-[var(--color-muted-foreground)]">—</span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[13px] tabular-nums transition-colors hover:bg-[var(--color-surface-2)]"
      title={editTitle}
    >
      {value != null ? (
        <span className="text-[var(--color-foreground)]">
          {formatInr(value)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[var(--color-primary)]">
          <Pencil size={12} aria-hidden />
          {addLabel}
        </span>
      )}
    </button>
  );
}


export default function StylesInFlightTable({
  initialTab = 'all',
  from,
  to,
  onActionDone,
  onViewAll,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<DashboardStyleTab>(initialTab);
  // Seed from ?q= so a search survives navigating into a style and back.
  const [searchText, setSearchText] = useState(
    () => searchParams.get('q') ?? '',
  );
  const debouncedSearch = useDebounced(searchText, 300);

  // Mirror the (debounced) search into ?q= so back-navigation restores it.
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const q = debouncedSearch.trim();
    if (q) params.set('q', q);
    else params.delete('q');
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [debouncedSearch, searchParams, setSearchParams]);
  // Multi-select status filter, scoped to the active tab. Cleared on any tab
  // switch (a previous tab's statuses wouldn't apply to the new bucket).
  const [statuses, setStatuses] = useState<DashboardStatusFilter[]>([]);
  const statusOptions = STATUS_OPTIONS_BY_TAB[tab] ?? [];

  const [rows, setRows] = useState<DashboardStyleRow[]>([]);
  const [tabCounts, setTabCounts] = useState<Partial<Record<DashboardStyleTab, number>>>({});
  /** Monotonic request id — only the newest fetch may write state. */
  const reqRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Pagination — page through the feed `PAGE_SIZE` at a time. `total` drives
  // the "Showing X–Y of Z" label + the prev/next enabled state.
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);

  // Inline action targets — opening either dialog stashes the row.
  const [approvalTarget, setApprovalTarget] =
    useState<DashboardStyleRow | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [parkTarget, setParkTarget] = useState<DashboardStyleRow | null>(null);
  const [parkBusy, setParkBusy] = useState(false);
  // Sample sign-off (Approval #2) — opens the shared verdict dialog.
  const [sampleApproveTarget, setSampleApproveTarget] =
    useState<DashboardStyleRow | null>(null);
  const [sampleApproveBusy, setSampleApproveBusy] = useState(false);

  // Add-listings — opens the SHARED channel+link dialog (same one the workspace
  // uses) and records each pick as a prepared listing. Going live happens when
  // EasyEcom is marked done, not here.
  const [listTarget, setListTarget] = useState<DashboardStyleRow | null>(null);
  const [listBusy, setListBusy] = useState(false);

  // If Home re-seeds the tab from a fresh `?tab=` deep link, follow it.
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    // Requests overlap when tabs/filters/dates are changed quickly, and they do
    // not come back in order. Without this, a slower earlier response lands last
    // and repaints the view with the PREVIOUS query's rows and chip counts.
    // Same guard the production board uses.
    const my = ++reqRef.current;
    try {
      const res = await getDashboardStyles({
        tab,
        search: debouncedSearch.trim() || undefined,
        statuses: statuses.length ? statuses : undefined,
        from,
        to,
        skip,
        take: PAGE_SIZE,
      });
      if (reqRef.current !== my) return;
      setRows(res.rows);
      setTotal(res.page.total);
      setTabCounts(res.tabCounts);
    } catch {
      if (reqRef.current !== my) return;
      setRows([]);
      setTotal(0);
      setTabCounts({});
      setError(true);
    } finally {
      if (reqRef.current === my) setLoading(false);
    }
  }, [tab, debouncedSearch, statuses, from, to, skip]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to the first page whenever the result SET changes (tab / search /
  // status filter / date window) — otherwise a stale `skip` could land past
  // the last page.
  useEffect(() => {
    setSkip(0);
  }, [tab, debouncedSearch, statuses, from, to]);

  // Clear the status filter on any tab switch — the previous tab's statuses
  // aren't reachable in the new bucket (and the control's options change).
  // Functional updater keeps the SAME reference when already empty so we don't
  // invalidate `load` and trigger a redundant second fetch on every tab switch.
  useEffect(() => {
    setStatuses((prev) => (prev.length ? [] : prev));
  }, [tab]);

  // Refetch the table AND let the Home refresh its cards.
  const afterAction = () => {
    void load();
    onActionDone?.();
  };

  // The Style detail route. Stash the active tab + search as `from` so the
  // workspace back button returns to this exact bucket AND search, not the
  // dashboard default.
  const openStyle = (row: DashboardStyleRow) => {
    const q = debouncedSearch.trim();
    const from = `/?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    navigate(`/styles/${row.styleId ?? row.id}`, { state: { from } });
  };

  // Mirror the active tab into ?tab= so a refresh or shared link reopens
  // the selected bucket (not the stale deep-linked one) — matches the
  // Sampling registry's behaviour.
  const selectTab = (next: DashboardStyleTab) => {
    setTab(next);
    // Switching tabs clears the (global) search so the new bucket shows its own
    // contents, not carried-over search results. Same for the status chips: the
    // new tab offers its own statuses, so a carried-over one would filter with
    // no chip lit to explain the empty list.
    setSearchText('');
    setStatuses([]);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    params.delete('q');
    setSearchParams(params, { replace: true });
  };

  const canApprove = (row: DashboardStyleRow) =>
    row.lifecycle === 'draft' && hasAnyRole(user, APPROVER_ROLES);

  // Park gate (mirrors the BE): an admin may park at ANY stage (a live style is
  // pulled off the market); a non-admin approver (e.g. sampling_lead) may park
  // during the sampling phase (draft or in_sampling). Parked/archived rows
  // can't be parked again.
  const canPark = (row: DashboardStyleRow) =>
    row.lifecycle !== 'parked' &&
    row.lifecycle !== 'archived' &&
    (hasAnyRole(user, ADMIN_ROLES) ||
      ((row.lifecycle === 'draft' || row.lifecycle === 'in_sampling') &&
        hasAnyRole(user, APPROVER_ROLES)));

  const stageLabel = (row: DashboardStyleRow): string => {
    if (row.lifecycle === 'in_sampling' && row.samplingStatus) {
      return t(`admin.styles.samplingSteps.${row.samplingStatus}` as const, {
        defaultValue: row.samplingStatus.replace(/_/g, ' '),
      });
    }
    if (row.lifecycle === 'in_pd' && row.productionStatus) {
      return t(
        `dashboard.table.productionStatus.${row.productionStatus}` as const,
        {
          defaultValue: row.productionStatus.replace(/_/g, ' '),
        },
      );
    }
    // Past the granular working steps (e.g. sample_approved → ready for
    // cataloguing) there's no sub-status — fall back to the lifecycle label so
    // the Stage cell reads "Sample approved" instead of a bare "—".
    return t(`admin.styles.lifecycle.${row.lifecycle}` as const, {
      defaultValue: row.lifecycle.replace(/_/g, ' '),
    });
  };

  // Inline sampling-status edits are gated on the PD write set.
  // Non-writers see read-only cells.
  const canWriteInline = hasAnyRole(user, INLINE_WRITE_ROLES);
  const canEditMoney = hasAnyRole(user, MONEY_WRITE_ROLES);
  // A live style can be pushed onto the floor without waiting for the forecast
  // to flag it. Style-origin: no suggested quantities to compare against.
  const canProduce = hasAnyRole(user, PRODUCTION_WRITE_ROLES);
  const [produceTarget, setProduceTarget] = useState<StartProductionTarget | null>(null);
  const [produceBusy, setProduceBusy] = useState(false);

  const openProduce = async (row: DashboardStyleRow) => {
    setProduceBusy(true);
    try {
      const s = await getStyleSizes(row.id);
      setProduceTarget({
        origin: 'style',
        styleId: s.styleId,
        styleRef: s.styleRef,
        name: s.name ?? row.workingName ?? null,
        imageUrl: s.imageUrl,
        sizes: s.sizes.map((z) => ({ sku: z.sku, size: z.size, suggestedQty: null })),
      });
    } catch {
      // A style with no active per-size SKUs 400s here — say so rather than
      // leaving the button looking dead.
      toast.show(
        t('admin.production.sizesFailed', {
          defaultValue: "Couldn't load this style's sizes.",
        }),
        'error',
      );
    } finally {
      setProduceBusy(false);
    }
  };

  // The cataloguing write (Mark EasyEcom done) admits the narrow `cataloguer`
  // too — its whole remit. A superset of PD writers; NOT the sampling dropdown.
  const canCataloguingWrite = hasAnyRole(user, CATALOGUER_WRITE_ROLES);

  // Cataloguing → live is now cataloguer work: add listings (channel
  // + link), then mark EasyEcom done — the latter auto-promotes the prepared
  // listings to live. Both are CATALOGUER_WRITE; no approver gate on going live.
  //   • "Add listings"   — list channels + links (cataloguing or live row)
  //   • "Mark EasyEcom done" — the go-live trigger (requires a listed channel)
  // At least one prepared/live channel exists — the BE's precondition for
  // marking EasyEcom done (else it 400s). Mirror it so the button only appears
  // once it'll succeed, and "Add listings" stays the primary CTA until then.
  const hasListedChannel = (row: DashboardStyleRow) =>
    row.preparedListings.length > 0 || row.liveListings.length > 0;
  const canMarkEasyecom = (row: DashboardStyleRow) =>
    row.lifecycle === 'cataloguing' &&
    !row.easyecomDone &&
    canCataloguingWrite &&
    hasListedChannel(row);
  const canAddListings = (row: DashboardStyleRow) =>
    (row.lifecycle === 'cataloguing' || row.lifecycle === 'live') &&
    canCataloguingWrite;

  // Mark the EasyEcom checkpoint done — the go-live trigger (cataloguer).
  // The BE auto-promotes the listed channels to live, so the row
  // leaves the Cataloguing tab on the next load. Optimistic; revert on error
  // (e.g. the BE 400 when no channel is listed yet).
  const markEasyecomDone = (row: DashboardStyleRow) => {
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, easyecomDone: true } : r)),
    );
    setEasyecomDone(row.id, true)
      .then(() => {
        toast.show(
          t('dashboard.table.toast.easyecomDone', {
            defaultValue: 'EasyEcom marked done.',
          }),
          'success',
        );
      })
      .catch(() => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, easyecomDone: false } : r,
          ),
        );
        toast.show(
          t('dashboard.table.toast.checkpointError', {
            defaultValue: 'Could not update checkpoint.',
          }),
          'error',
        );
      });
  };

  // Open the shared channel+link dialog to add listings (no precondition —
  // listing is independent of EasyEcom; the BE enforces order at the EasyEcom
  // step). Taking a channel offline lives in the Style workspace (captures a
  // reason).
  const openListings = (row: DashboardStyleRow) => setListTarget(row);

  // Record each pick as a prepared listing (channel + link). Promotion to live
  // happens when EasyEcom is marked done; on a style that's already live the BE
  // lists the new channel live straight away. Refetch so the rows + cards sync.
  const confirmListings = (channels: GoLiveChannel[]) => {
    if (!listTarget) return;
    const row = listTarget;
    setListBusy(true);
    Promise.all(
      channels.map((ch) =>
        setMarketplaceListing(row.id, {
          channel: ch.channel,
          listed: true,
          listingUrl: ch.listingUrl,
        }),
      ),
    )
      .then(() => {
        setListTarget(null);
        toast.show(
          t('dashboard.table.toast.listingsSaved', {
            defaultValue: 'Listings saved.',
          }),
          'success',
        );
        afterAction();
      })
      .catch((e: unknown) => {
        const m =
          (e as { response?: { data?: { message?: string | string[] } } })
            ?.response?.data?.message ??
          t('dashboard.table.toast.listingsError', {
            defaultValue: 'Could not save listings.',
          });
        toast.show(Array.isArray(m) ? m.join(', ') : String(m), 'error');
      })
      .finally(() => setListBusy(false));
  };

  // Inline sampling-status change (working steps only) — optimistic, persisted
  // via PATCH /styles/:id. Quiet success toast on save; revert on error.
  const changeSamplingStatus = (
    row: DashboardStyleRow,
    next: SamplingStatus,
  ) => {
    const prevStatus = row.samplingStatus;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, samplingStatus: next } : r)),
    );
    patchStyle(row.id, { samplingStatus: next })
      .then(() => {
        toast.show(
          t('dashboard.table.toast.statusSaved', {
            defaultValue: 'Stage updated.',
          }),
          'success',
        );
      })
      .catch(() => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, samplingStatus: prevStatus } : r,
          ),
        );
        toast.show(
          t('dashboard.table.toast.statusError', {
            defaultValue: 'Could not update status.',
          }),
          'error',
        );
      });
  };

  // Inline cost-price edit (Sampling + Live Cost column) — optimistic PATCH,
  // the same pattern as the sampling-status dropdown. Doubles as the backfill
  // path for styles approved before pricing existed.
  const changeCostPrice = (row: DashboardStyleRow, next: number) => {
    const prev = row.costPrice;
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, costPrice: next } : r)),
    );
    patchStyle(row.id, { costPrice: next })
      .then(() => {
        toast.show(
          t('dashboard.table.toast.costSaved', {
            defaultValue: 'Cost price saved.',
          }),
          'success',
        );
      })
      .catch(() => {
        setRows((rs) =>
          rs.map((r) => (r.id === row.id ? { ...r, costPrice: prev } : r)),
        );
        toast.show(
          t('dashboard.table.toast.costError', {
            defaultValue: 'Could not save cost price.',
          }),
          'error',
        );
      });
  };

  // Inline MRP edit — single per-style value, editable any stage. Same optimistic
  // PATCH pattern as costPrice.
  const changeMrp = (row: DashboardStyleRow, next: number) => {
    const prev = row.mrp;
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, mrp: next } : r)),
    );
    patchStyle(row.id, { mrp: next })
      .then(() => {
        toast.show(
          t('dashboard.table.toast.mrpSaved', { defaultValue: 'MRP saved.' }),
          'success',
        );
      })
      .catch(() => {
        setRows((rs) =>
          rs.map((r) => (r.id === row.id ? { ...r, mrp: prev } : r)),
        );
        toast.show(
          t('dashboard.table.toast.mrpError', {
            defaultValue: 'Could not save MRP.',
          }),
          'error',
        );
      });
  };

  // Sample sign-off (Approval #2) — approver-only, opens the shared verdict
  // dialog (same as the workspace). Only in_sampling, non-china-import rows.
  const canSampleApprove = (row: DashboardStyleRow) =>
    row.lifecycle === 'in_sampling' &&
    row.source !== 'china_import' &&
    hasAnyRole(user, APPROVER_ROLES);

  const confirmSampleApprove = (body: SampleApproveStyleBody) => {
    if (!sampleApproveTarget) return;
    const row = sampleApproveTarget;
    setSampleApproveBusy(true);
    sampleApproveStyle(row.id, body)
      .then(() => {
        setSampleApproveTarget(null);
        toast.show(
          t('dashboard.table.toast.sampleApproved', {
            defaultValue: 'Sample verdict recorded.',
          }),
          'success',
        );
        afterAction();
      })
      .catch((e: unknown) => {
        const m =
          (e as { response?: { data?: { message?: string | string[] } } })
            ?.response?.data?.message ??
          t('dashboard.table.toast.sampleApproveError', {
            defaultValue: 'Could not record the verdict.',
          });
        toast.show(Array.isArray(m) ? m.join(', ') : String(m), 'error');
      })
      .finally(() => setSampleApproveBusy(false));
  };

  // Start cataloguing — cataloguing-phase write (pulls a signed-off sample into
  // the cataloguer's queue), so it's CATALOGUER_WRITE-gated, not approver-only.
  // Plain action (no dialog), mirroring the workspace button + the BE @Roles.
  const canStartCataloguing = (row: DashboardStyleRow) =>
    row.lifecycle === 'sample_approved' &&
    row.source !== 'china_import' &&
    hasAnyRole(user, CATALOGUER_WRITE_ROLES);

  const doStartCataloguing = (row: DashboardStyleRow) => {
    startCataloguing(row.id)
      .then(() => {
        toast.show(
          t('dashboard.table.toast.cataloguingStarted', {
            defaultValue: 'Cataloguing started.',
          }),
          'success',
        );
        afterAction();
      })
      .catch((e: unknown) => {
        const m =
          (e as { response?: { data?: { message?: string | string[] } } })
            ?.response?.data?.message ??
          t('dashboard.table.toast.actionError', {
            defaultValue: 'Could not complete the action.',
          });
        toast.show(Array.isArray(m) ? m.join(', ') : String(m), 'error');
      });
  };

  // Row action cluster — the "next step" for the row's lifecycle (Park rides
  // alongside). Rendered as a COLUMN placed just before Metrics (see
  // actionsColumn) rather than the table's trailing slot, so the buttons stay
  // visible without horizontal-scrolling to the far right on the wider tabs.
  const renderRowActions = (row: DashboardStyleRow): ReactNode => {
    const approve = canApprove(row);
    const park = canPark(row);
    const sampleApprove = canSampleApprove(row);
    const startCat = canStartCataloguing(row);
    const markEasyecom = canMarkEasyecom(row);
    const addListings = canAddListings(row);
    // A cataloguing style with no channel listed yet can't mark EasyEcom
    // done (BE 400s). "Add listings" is the real next step, so it leads
    // as the PRIMARY button; once a channel is listed, "Mark EasyEcom
    // done" takes over the primary slot and Add listings drops to ghost.
    const needsListing =
      row.lifecycle === 'cataloguing' && !hasListedChannel(row);
    // Live rows get a "Channel" affordance (manage channels in the
    // workspace) for those who can't add listings inline.
    const channel = row.lifecycle === 'live';
    const produce = canProduce && row.lifecycle === 'live';
    if (
      !approve &&
      !park &&
      !sampleApprove &&
      !startCat &&
      !markEasyecom &&
      !addListings &&
      !channel &&
      !produce
    ) {
      return <RowChevron />;
    }
    return (
      <>
        {produce && (
          <PrimaryActionButton onClick={() => void openProduce(row)}>
            {t('admin.production.addToPipeline', {
              defaultValue: 'Add to production pipeline',
            })}
          </PrimaryActionButton>
        )}
        {park && (
          <GhostActionButton icon="park" onClick={() => setParkTarget(row)}>
            {t('dashboard.table.actions.park')}
          </GhostActionButton>
        )}
        {startCat && (
          <PrimaryActionButton onClick={() => doStartCataloguing(row)}>
            {t('dashboard.table.actions.startCataloguing', {
              defaultValue: 'Start cataloguing',
            })}
          </PrimaryActionButton>
        )}
        {sampleApprove && (
          <PrimaryActionButton onClick={() => setSampleApproveTarget(row)}>
            {t('dashboard.table.actions.approveSample', {
              defaultValue: 'Approve sample',
            })}
          </PrimaryActionButton>
        )}
        {/* Cataloguing → live: list channels first, then EasyEcom-done
            auto-promotes them live. Leads as PRIMARY until a channel is
            listed (when Mark EasyEcom done becomes the primary). */}
        {addListings &&
          (needsListing ? (
            <PrimaryActionButton
              icon={<Link2 size={13} />}
              onClick={() => openListings(row)}
            >
              {t('dashboard.table.actions.addListings', {
                defaultValue: 'Add listings',
              })}
            </PrimaryActionButton>
          ) : (
            <GhostActionButton icon="link" onClick={() => openListings(row)}>
              {t('dashboard.table.actions.addListings', {
                defaultValue: 'Add listings',
              })}
            </GhostActionButton>
          ))}
        {markEasyecom && (
          <PrimaryActionButton onClick={() => markEasyecomDone(row)}>
            {t('dashboard.table.actions.markEasyecom', {
              defaultValue: 'Mark EasyEcom done',
            })}
          </PrimaryActionButton>
        )}
        {channel && !addListings && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openStyle(row);
            }}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]"
          >
            <Link2 size={13} aria-hidden />
            {t('dashboard.table.actions.channel', {
              defaultValue: 'Channel',
            })}
          </button>
        )}
        {approve && <ApproveButton onClick={() => setApprovalTarget(row)} />}
      </>
    );
  };

  const actionsColumn: QueueColumn<DashboardStyleRow> = {
    key: 'actions',
    header: '',
    width: '220px',
    align: 'right',
    cell: (row) => (
      <div className="flex items-center justify-end gap-2">
        {renderRowActions(row)}
      </div>
    ),
  };

  // ── Shared grammar: IMG · Style/Name · [context] · Status · Metrics ──
  // A thumbnail in its own narrow column (split out of the Style cell).
  const imgColumn: QueueColumn<DashboardStyleRow> = {
    key: 'img',
    header: t('dashboard.table.columns.img', { defaultValue: 'Img' }),
    // 80px image + the cell's horizontal padding needs ~116px of column.
    width: '116px',
    cell: (row) => (
      <HoverThumbnail
        src={row.thumbnail}
        alt={row.workingName ?? formatStyleRef(row, t('admin.styles.draft'))}
      />
    ),
  };

  // Style # / draft link + working name (no thumbnail — IMG owns that now).
  const styleNameColumn: QueueColumn<DashboardStyleRow> = {
    key: 'styleName',
    header: t('dashboard.table.columns.styleName', {
      defaultValue: 'Style ID / Name',
    }),
    width: '168px',
    cell: (row) => (
      // Cap the name block at a fixed width so a long working name truncates
      // instead of stretching the column on wide screens.
      <div className="flex max-w-[146px] min-w-0 flex-col">
        <StyleRefLink style={row} onClick={() => openStyle(row)} />
        {row.workingName && (
          <TruncText
            text={row.workingName}
            className="text-[var(--color-foreground)]"
          />
        )}
      </div>
    ),
  };

  // Status pill — one consistent at-a-glance state across EVERY non-sampling
  // tab, expressed as a single go-to-market ladder:
  //   Listings pending → Ready to publish (EasyEcom gate) → Live.
  // EasyEcom is no longer its own column; it's the "Ready to publish" rung
  // here (it's the gate between "prepared" and "live", not a marketplace).
  // Pre-cataloguing rows (draft / sample_approved / parked …) show their
  // lifecycle label. A hover detail-pill expands the one-word status into the
  // full picture (which channels, what's pending).
  const statusColumn: QueueColumn<DashboardStyleRow> = {
    key: 'status',
    header: t('dashboard.table.columns.status', { defaultValue: 'Status' }),
    width: '136px',
    cell: (row) => {
      const channelName = (c: string) =>
        t(`dashboard.table.channels.${c}` as const, { defaultValue: c });
      let label: string;
      let tone: 'live' | 'pending' | 'neutral';
      let detail: ReactNode = null;

      if (row.lifecycle === 'live') {
        label = t('dashboard.table.statusLive', { defaultValue: 'LIVE' });
        tone = 'live';
        const names = row.liveListings.map((l) => channelName(l.channel));
        detail = names.length
          ? t('dashboard.table.statusDetail.live', {
              channels: names.join(', '),
              defaultValue: `Live on ${names.join(', ')}`,
            })
          : null;
      } else if (row.lifecycle === 'cataloguing') {
        const prepared = [...row.preparedListings, ...row.liveListings];
        if (prepared.length > 0) {
          label = t('dashboard.table.status.readyToPublish', {
            defaultValue: 'Ready to publish',
          });
          tone = 'pending';
          const names = prepared.map((l) => channelName(l.channel)).join(', ');
          detail = t('dashboard.table.statusDetail.readyToPublish', {
            count: prepared.length,
            channels: names,
            defaultValue: `${prepared.length} channel(s) prepared: ${names}. EasyEcom catalog pending.`,
          });
        } else {
          label = t('dashboard.table.status.listingsPending', {
            defaultValue: 'Listings pending',
          });
          tone = 'neutral';
          detail = t('dashboard.table.statusDetail.listingsPending', {
            defaultValue: 'No channels prepared yet — add listings to begin.',
          });
        }
      } else {
        label = t(`admin.styles.lifecycle.${row.lifecycle}` as const, {
          defaultValue: row.lifecycle.replace(/_/g, ' '),
        });
        tone = row.lifecycle === 'sample_approved' ? 'live' : 'neutral';
        // Every pre-cataloguing lifecycle gets a hover detail too, so the
        // tooltip is consistent on every row (incl. the draft + in_sampling
        // rows that fill the Needs-attention tab). Unknown lifecycles fall
        // back to the label itself, so HoverTip always has content.
        const byLifecycle: Partial<Record<DashboardStyleRow['lifecycle'], string>> =
          {
            sample_approved: t('dashboard.table.statusDetail.sampleApproved', {
              defaultValue: 'Sample signed off — ready to start cataloguing.',
            }),
            draft: t('dashboard.table.statusDetail.draft', {
              defaultValue: 'Awaiting intake approval.',
            }),
            in_sampling: t('dashboard.table.statusDetail.inSampling', {
              defaultValue: 'In sampling — sample in progress.',
            }),
            parked: t('dashboard.table.statusDetail.parked', {
              defaultValue: 'Parked — revivable.',
            }),
          };
        detail = byLifecycle[row.lifecycle] ?? label;
      }

      // Out of stock — a restock-pending style sits in cataloguing (it was
      // demoted from live). Note it in the hover detail regardless of branch.
      if (row.outOfStock) {
        const oos = t('dashboard.table.statusDetail.outOfStock', {
          defaultValue: 'Out of stock — re-publish (EasyEcom) to restock.',
        });
        detail = detail ? (
          <>
            {detail}
            <br />
            {oos}
          </>
        ) : (
          oos
        );
      }

      // Live rows show their listing link under the pill — but only on tabs
      // that lack the Marketplace column (which already carries the links).
      const tabHasMarketplace = tab === 'cataloguing' || tab === 'live';
      const liveUrl = row.liveListings.find((l) => isHttpUrl(l.url))?.url ?? null;

      return (
        <div className="flex flex-col gap-0.5">
          <HoverTip content={detail}>
            <div className="flex items-center gap-1">
              <DotStatusPill label={label} tone={tone} />
              {row.outOfStock && (
                <Badge variant="destructive" className="text-[9px] uppercase">
                  {t('dashboard.table.outOfStockBadge', { defaultValue: 'OOS' })}
                </Badge>
              )}
            </div>
          </HoverTip>
          {row.lifecycle === 'live' && !tabHasMarketplace && liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--color-primary)] hover:underline"
            >
              <ExternalLink size={11} aria-hidden />
              {t('dashboard.table.viewNow', { defaultValue: 'View now' })}
            </a>
          )}
        </div>
      );
    },
  };

  // Metrics cell — "time in current state" (bold) + "Upd: Xd". The primary
  // milestone + suffix follow the ROW's lifecycle (so it's right on the mixed
  // All tab too), not the active tab.
  const metricInfo = (
    row: DashboardStyleRow,
  ): { iso: string | null; suffix: string } => {
    switch (row.lifecycle) {
      case 'live':
        return {
          iso: row.wentLiveAt,
          suffix: t('dashboard.table.metricSuffix.live', {
            defaultValue: 'live',
          }),
        };
      case 'cataloguing':
        return {
          iso: row.sampleApprovedAt,
          suffix: t('dashboard.table.metricSuffix.cataloguing', {
            defaultValue: 'in cat.',
          }),
        };
      case 'in_sampling':
        return {
          iso: row.approvedAt,
          suffix: t('dashboard.table.metricSuffix.sampling', {
            defaultValue: 'sampling',
          }),
        };
      case 'sample_approved':
        return {
          iso: row.sampleApprovedAt,
          suffix: t('dashboard.table.metricSuffix.ready', {
            defaultValue: 'ready',
          }),
        };
      case 'draft':
        return {
          iso: row.createdAt,
          suffix: t('dashboard.table.metricSuffix.draft', {
            defaultValue: 'old',
          }),
        };
      default:
        return { iso: row.updatedAt, suffix: '' };
    }
  };
  const metricsColumn: QueueColumn<DashboardStyleRow> = {
    key: 'metrics',
    header: t('dashboard.table.columns.metrics', { defaultValue: 'Metrics' }),
    width: '116px',
    align: 'right',
    cell: (row) => {
      const m = metricInfo(row);
      return (
        <div className="flex justify-end">
          <MetricCell
            primaryIso={m.iso}
            primarySuffix={m.suffix}
            updatedIso={row.updatedAt}
          />
        </div>
      );
    },
  };

  // Stage column — for the Sampling tab. The inline-editable sampling-status
  // dropdown for in_sampling rows (PD writers); a read-only stage badge else.
  const stageColumn: QueueColumn<DashboardStyleRow> = {
    key: 'stage',
    header: t('dashboard.table.columns.stage', { defaultValue: 'Stage' }),
    width: '190px',
    cell: (row) => {
      if (row.lifecycle === 'in_sampling' && canWriteInline) {
        return (
          <select
            value={row.samplingStatus ?? ''}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              changeSamplingStatus(row, e.target.value as SamplingStatus);
            }}
            className="h-8 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {!row.samplingStatus && (
              <option value="" disabled>
                {t('dashboard.table.setStatus', {
                  defaultValue: 'Set status…',
                })}
              </option>
            )}
            {SAMPLING_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`admin.styles.samplingSteps.${s}` as const, {
                  defaultValue: s.replace(/_/g, ' '),
                })}
              </option>
            ))}
          </select>
        );
      }
      const stage = stageLabel(row);
      return stage ? (
        <Badge variant="stitch" className="text-[10px]">
          {stage}
        </Badge>
      ) : (
        <span className="text-[var(--color-muted-foreground)]">—</span>
      );
    },
  };

  // Cost price — inline-editable for PD writers (also the backfill path for
  // older styles). Shown on the Sampling + Live tabs per the pricing spec.
  const costColumn: QueueColumn<DashboardStyleRow> = {
    key: 'cost',
    header: t('dashboard.table.columns.cost', { defaultValue: 'Cost' }),
    width: '120px',
    cell: (row) => (
      <PriceCell
        value={row.costPrice}
        canEdit={canEditMoney}
        editTitle={t('dashboard.table.editCost', {
          defaultValue: 'Edit cost price',
        })}
        addLabel={t('dashboard.table.addCost', { defaultValue: 'Add' })}
        onSave={(n) => changeCostPrice(row, n)}
      />
    ),
  };

  // MRP — single per-style selling price, inline-editable for PD writers at any
  // stage (like cost). Shown on every tab.
  const mrpColumn: QueueColumn<DashboardStyleRow> = {
    key: 'mrp',
    header: t('dashboard.table.columns.mrp', { defaultValue: 'MRP' }),
    width: '110px',
    cell: (row) => (
      <PriceCell
        value={row.mrp}
        canEdit={canEditMoney}
        editTitle={t('dashboard.table.editMrp', { defaultValue: 'Edit MRP' })}
        addLabel={t('dashboard.table.addMrp', { defaultValue: 'Add' })}
        onSave={(n) => changeMrp(row, n)}
      />
    ),
  };

  // Colour swatch + name — context column for the draft / all views.
  const colourColumn: QueueColumn<DashboardStyleRow> = {
    key: 'colour',
    header: t('dashboard.table.columns.colour', { defaultValue: 'Colour' }),
    width: '150px',
    className: 'hidden sm:table-cell',
    headerClassName: 'hidden sm:table-cell',
    cell: (row) => <ColourCell name={row.primaryColour} />,
  };

  // Collection — the seasonal/thematic grouping. Shared across tabs; hidden
  // on narrower screens so it never crowds the curated mobile layout.
  const collectionColumn: QueueColumn<DashboardStyleRow> = {
    key: 'collection',
    header: t('dashboard.table.columns.collection', {
      defaultValue: 'Collection',
    }),
    width: '150px',
    className: 'hidden lg:table-cell',
    headerClassName: 'hidden lg:table-cell',
    cell: (row) =>
      row.collection?.name ? (
        <TruncText
          text={row.collection.name}
          className="text-[var(--color-muted-foreground)]"
        />
      ) : (
        <span className="text-[var(--color-muted-foreground)]">—</span>
      ),
  };

  // Default grammar (All · Needs attention · Draft): IMG · Style/Name ·
  // Collection · Colour · Status · Metrics — same shared cells as every other tab.
  const defaultColumns: QueueColumn<DashboardStyleRow>[] = [
    imgColumn,
    styleNameColumn,
    collectionColumn,
    colourColumn,
    statusColumn,
    costColumn,
    mrpColumn,
    actionsColumn,
    metricsColumn,
  ];

  // Marketplace — pure per-channel STATUS. Each LIVE channel shows a "View now"
  // link to its public listing (or a plain Live badge if no URL). The go-live
  // ACTION is not here — it's the progressive row-action button. Taking a
  // channel offline lives in the Style workspace (captures a reason).
  const marketplaceColumn: QueueColumn<DashboardStyleRow> = {
    key: 'marketplace',
    header: t('dashboard.table.columns.marketplace', {
      defaultValue: 'Marketplace',
    }),
    width: '190px',
    cell: (row) => {
      // Each live channel as a brand chip (logo + name), with an external-link
      // icon when a public listing URL exists.
      const channelLabel = (channel: string) =>
        t(`dashboard.table.channels.${channel}` as const, {
          defaultValue: channel,
        });
      if (row.liveListings.length === 0) {
        return <span className="text-[var(--color-muted-foreground)]">—</span>;
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          {row.liveListings.map((listing) => {
            const label = channelLabel(listing.channel);
            const inner = (
              <>
                <ChannelLogo channel={listing.channel} />
                <span className="font-medium text-[var(--color-foreground)]">
                  {label}
                </span>
                {isHttpUrl(listing.url) && (
                  <ExternalLink
                    size={13}
                    className="text-[var(--color-primary)]"
                    aria-hidden
                  />
                )}
              </>
            );
            return isHttpUrl(listing.url) ? (
              <a
                key={listing.channel}
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 text-[13px] hover:opacity-80"
                title={t('dashboard.table.viewNow', {
                  defaultValue: 'View now',
                })}
              >
                {inner}
              </a>
            ) : (
              <span
                key={listing.channel}
                className="inline-flex items-center gap-1.5 text-[13px]"
              >
                {inner}
              </span>
            );
          })}
        </div>
      );
    },
  };

  // Sampling tab — IMG · Style/Name · Collection · Colour · Stage (inline
  // editor) · Cost · MRP · Metrics. Stage IS the status here (every row is
  // mid-sampling, so a lifecycle pill would say the same thing on every row);
  // the editable sub-stage is what matters, so no separate Status column.
  const samplingColumns: QueueColumn<DashboardStyleRow>[] = [
    imgColumn,
    styleNameColumn,
    collectionColumn,
    colourColumn,
    stageColumn,
    costColumn,
    mrpColumn,
    actionsColumn,
    metricsColumn,
  ];

  // Cataloguing tab — IMG · Style/Name · Collection · Colour · Status ·
  // Marketplace · Cost · MRP · Metrics. Status is the go-live ladder (Listings
  // pending → Ready to publish), Marketplace is the per-channel detail.
  const cataloguingColumns: QueueColumn<DashboardStyleRow>[] = [
    imgColumn,
    styleNameColumn,
    collectionColumn,
    colourColumn,
    statusColumn,
    marketplaceColumn,
    costColumn,
    mrpColumn,
    actionsColumn,
    metricsColumn,
  ];

  // Live tab — same grammar as cataloguing; Status reads "LIVE", Marketplace
  // lists the live channels with their "View now" links.
  const liveColumns: QueueColumn<DashboardStyleRow>[] = [
    imgColumn,
    styleNameColumn,
    collectionColumn,
    colourColumn,
    statusColumn,
    marketplaceColumn,
    costColumn,
    mrpColumn,
    actionsColumn,
    metricsColumn,
  ];

  const columns =
    tab === 'cataloguing'
      ? cataloguingColumns
      : tab === 'live'
        ? liveColumns
        : tab === 'sampling'
          ? samplingColumns
          : defaultColumns;

  // "Showing X–Y of Z" + prev/next — rendered both above and below the table
  // (the bottom copy saves a scroll-back-up after working a full page).
  const pager =
    total > 0 ? (
      <div className="flex items-center gap-3">
        <span className="text-[12px] tabular-nums text-[var(--color-muted-foreground)]">
          {t('dashboard.table.showing', {
            from: skip + 1,
            to: Math.min(skip + PAGE_SIZE, total),
            total,
            defaultValue: `Showing ${skip + 1}–${Math.min(
              skip + PAGE_SIZE,
              total,
            )} of ${total}`,
          })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('dashboard.table.prevPage', {
              defaultValue: 'Previous page',
            })}
            disabled={skip === 0}
            onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-2)] disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={t('dashboard.table.nextPage', {
              defaultValue: 'Next page',
            })}
            disabled={skip + PAGE_SIZE >= total}
            onClick={() => setSkip((s) => s + PAGE_SIZE)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-2)] disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      {/* One unified panel: tabs · search/pagination · table all share a
          single bordered card (the "Style tracking" treatment). */}
      <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        {/* Tabs row — the QueueTabs' own bottom border is the divider. */}
        <div className="px-4 pt-3">
          <QueueTabs
            tabs={TABS.map((tk) => ({
              key: tk,
              label: t(`dashboard.table.tabs.${tk}` as const),
              count: tabCounts[tk],
            }))}
            active={tab}
            onSelect={selectTab}
          />
        </div>

        {/* Search · date filter · pagination row. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-primary)]"
              />
              <Input
                className="h-9 text-[13px] pl-9 pr-9 border-[var(--color-primary)]/40 bg-[var(--color-primary-soft)]/30 focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/25"
                placeholder={t('dashboard.table.searchPlaceholder')}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              {searchText && (
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  aria-label={t('common.clear', { defaultValue: 'Clear' })}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Status chips sit beside the search box. Their options depend on
                the active tab, which is why the filter lives here and not in
                the page header's rail. */}
            {statusOptions.length > 1 && (
              <FilterChips
                ariaLabel={t('dashboard.table.columns.status', { defaultValue: 'Status' })}
                options={statusOptions.map((s2) => ({
                  value: s2,
                  label: t(`dashboard.table.statusFilter.${s2}` as const),
                }))}
                value={statuses}
                onToggle={(s2) =>
                  setStatuses(
                    statuses.includes(s2)
                      ? statuses.filter((x) => x !== s2)
                      : [...statuses, s2],
                  )
                }
                onClear={() => setStatuses([])}
                clearLabel={t('dashboard.table.statusFilter.clear', { defaultValue: 'Clear' })}
              />
            )}
          </div>

          {/* "Showing X–Y of Z" + prev/next (mirrored at the table bottom). */}
          {pager}
        </div>

        <StyleQueueTable<DashboardStyleRow>
          bare
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          loading={loading}
          error={error}
          loadingLabel={t('dashboard.table.loading')}
          emptyLabel={t('dashboard.table.empty')}
          errorLabel={t('dashboard.table.error')}
          onRowClick={openStyle}
          rowAccent={(row) => row.lifecycle === 'draft'}
        />

        {/* Bottom bar — "View all" (resets the date window to show every
            product) on the left; the pager mirror on the right so you can page
            without scrolling back up after working a full page. */}
        {(onViewAll || pager) && (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3">
            {onViewAll ? (
              <button
                type="button"
                onClick={onViewAll}
                className="text-[13px] font-medium text-[var(--color-primary)] transition-colors hover:underline"
              >
                {t('dashboard.table.viewAll', { defaultValue: 'View all' })}
              </button>
            ) : (
              <span />
            )}
            {pager}
          </div>
        )}
      </section>

      {/* Approval #1 — reuses the same dialog as the Sampling registry. */}
      <Approval1Dialog
        open={approvalTarget !== null}
        busy={approvalBusy}
        gender={null}
        onClose={() => setApprovalTarget(null)}
        onConfirm={async (body) => {
          if (!approvalTarget) return;
          setApprovalBusy(true);
          try {
            await approveStyle(approvalTarget.id, body);
            toast.show(t('dashboard.table.toast.approved'), 'success');
            setApprovalTarget(null);
            afterAction();
          } catch (e: unknown) {
            const m =
              (e as { response?: { data?: { message?: string | string[] } } })
                ?.response?.data?.message ??
              t('dashboard.table.toast.approveError');
            toast.show(Array.isArray(m) ? m.join(', ') : String(m), 'error');
          } finally {
            setApprovalBusy(false);
          }
        }}
      />

      {/* Park — captures a reason for the audit log. */}
      <ParkDialog
        open={parkTarget !== null}
        busy={parkBusy}
        styleLabel={
          parkTarget ? formatStyleRef(parkTarget, t('admin.styles.draft')) : null
        }
        approved={parkTarget ? parkTarget.lifecycle !== 'draft' : false}
        onClose={() => setParkTarget(null)}
        onConfirm={async (reason) => {
          if (!parkTarget) return;
          setParkBusy(true);
          try {
            await parkStyle(parkTarget.id, { reason });
            toast.show(t('dashboard.table.toast.parked'), 'success');
            setParkTarget(null);
            afterAction();
          } catch (e: unknown) {
            const m =
              (e as { response?: { data?: { message?: string | string[] } } })
                ?.response?.data?.message ??
              t('dashboard.table.toast.parkError');
            toast.show(Array.isArray(m) ? m.join(', ') : String(m), 'error');
          } finally {
            setParkBusy(false);
          }
        }}
      />

      {/* Add listings — the SAME channel+link dialog the workspace uses. Picks
          channels + URLs and records them as prepared listings (auto-live on
          EasyEcom done). */}
      <GoLiveDialog
        open={listTarget !== null}
        busy={listBusy}
        existing={
          [
            ...(listTarget?.liveListings ?? []),
            ...(listTarget?.preparedListings ?? []),
          ].map((l) => ({
            channel: l.channel,
            listingUrl: l.url,
          })) as StyleChannelListing[]
        }
        onClose={() => (listBusy ? undefined : setListTarget(null))}
        onConfirm={confirmListings}
      />

      {/* Approve sample (Approval #2) — the SAME verdict dialog the workspace
          uses. Records the verdict; only "approved" advances the lifecycle. */}
      <SampleApproveDialog
        open={sampleApproveTarget !== null}
        busy={sampleApproveBusy}
        costPrice={sampleApproveTarget?.costPrice ?? null}
        onClose={() =>
          sampleApproveBusy ? undefined : setSampleApproveTarget(null)
        }
        onConfirm={confirmSampleApprove}
      />
      <StartProductionDialog
        open={produceTarget !== null}
        busy={produceBusy}
        target={produceTarget}
        onClose={() => setProduceTarget(null)}
        onConfirm={(body) => {
          setProduceBusy(true);
          void createBatch(body)
            .then(() => {
              setProduceTarget(null);
              toast.show(
                t('admin.production.started', { defaultValue: 'Production started.' }),
              );
              // Starting from the dashboard creates a planning batch — land on
              // the Planning tab where it actually shows.
              navigate('/admin/production?tab=planning');
            })
            .catch(() =>
              toast.show(
                t('admin.production.startFailed', {
                  defaultValue: "Couldn't start production.",
                }),
                'error',
              ),
            )
            .finally(() => setProduceBusy(false));
        }}
      />
    </div>
  );
}
