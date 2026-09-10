import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search, ArrowUp, ArrowDown, ArrowUpDown, ArrowUpRight, Minus, Ban, RotateCcw, X, Sparkles, Copy, Check, Factory, Clock, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import {
  FilterRail,
  FilterRailDivider,
  FilterRailSegments,
  RAIL_SELECT_CLASS,
} from '@/components/ui/filter-rail';
import { todayISO } from '@/lib/date';
import { meaningfulName } from '@/lib/production';
import { useDebounced } from '@/lib/useDebounced';
import { useAuth } from '@/context/auth';
import { hasAnyRole, PRODUCTION_WRITE_ROLES } from '@/lib/userRoles';
import { createBatch, type CreateBatchBody } from '@/api/production';
import StartProductionDialog, {
  type StartProductionTarget,
} from '@/components/production/StartProductionDialog';
import { useSignedUrls } from '@/hooks/useSignedUrls';
import { HoverThumbnail } from '@/components/dashboard/StylesInFlightTable';
import { CARD_SHELL, Sparkline as TrendChart } from '@/components/admin/kpiPrimitives';
import { QueueTabs, type QueueTab } from '@/components/styles/StyleQueueTable';
import {
  getInventoryHealth,
  setStyleDiscontinued,
  setStylePendingApproval,
  type Aging,
  type FilterKey,
  type InventoryHealthResponse,
  type InventoryKpis,
  type InventorySize,
  type InventoryStyle,
  type InventoryView,
  type Urgency,
} from '@/api/inventoryHealth';
import { refreshAllEasyEcom } from '@/api/salesKpis';

/** Refresh POSTs a background recompute, then polls GET until `syncing` clears. */
const REFRESH_POLL_MS = 5_000;
const REFRESH_MAX_WAIT_MS = 3 * 60_000;

// ── Neutral palette: colour = meaning only ───────────────────────────────
// Red = act now (out/critical), amber = watch, everything else neutral grey.
const RED = '#DC2626';
const AMBER = '#D97706';
const INK = '#18181B'; // near-black for emphasis
const MUTED = '#C4C4C8';
const NEUTRAL_DOT = '#A1A1AA';
const LABEL_GREY = '#B0AFAE'; // KPI-card label caps
// Trend direction colours: velocity rising = green, falling = red, flat = grey.
const TREND_UP = '#059669';
const TREND_DOWN = '#DC2626';
// Column-label ink for the child-size grid header.
const HEADER_INK = '#334155';
// Active-state accents use the app's theme blue.
const PRIMARY = 'var(--color-primary)';

// Child (size) grid — the sub-header + every size row align to it.
// SIZE (thumb + size) · COVER · DRR · TREND · STOCK · PIPELINE · MAKE
const GRID = 'minmax(0,1.5fr) 0.8fr 0.6fr 1.05fr 0.6fr 0.6fr 0.6fr';

/** Per-urgency: label + the meaning-colour (red/amber/neutral) for text + dot. */
const URG: Record<Urgency, { label: string; color: string; dot: string }> = {
  out: { label: 'Out of stock', color: RED, dot: RED },
  critical: { label: 'Critical', color: RED, dot: RED },
  watch: { label: 'Watch', color: AMBER, dot: AMBER },
  healthy: { label: 'Healthy', color: '#52525B', dot: NEUTRAL_DOT },
};

/** Per-aging lens: label + meaning-colour dot. `active` never renders a pill. */
const AGE: Record<Exclude<Aging, 'active'>, { label: string; dot: string }> = {
  slow: { label: 'Slow-mover', dot: AMBER },
  dead: { label: 'Dead stock', dot: '#52525B' },
};

/** Sortable columns. `null` = the priority (urgency-first) default order. A
 *  column sorts the STYLES by that metric aggregated over their sizes. `newest`
 *  (arrival recency) is dropdown-only — it maps to no column header. */
type SortKey = 'style' | 'cover' | 'drr' | 'stock' | 'atrisk' | 'make' | 'newest';

const PAGE_SIZE = 50;

function fmtN(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** LOCAL YYYY-MM-DD `n` days before today — seeds the date picker. */
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Jun 5" style short label for the active-window line. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Absolute IST clock label for the last sync — mirrors SalesKpis absTime(). */
function absTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${date}, ${time}`;
}

/** "5 min ago" relative label — mirrors SalesKpis relativeTime(). */
function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Amber banner shown while a manual/background sync runs — an EasyEcom report
 *  takes a few minutes, so reassure the user it's working. Mirrors SalesKpis. */
function FetchingBanner({ t }: { t: ReturnType<typeof useTranslation>['t'] }): ReactNode {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <RefreshCw size={16} className="shrink-0 animate-spin" />
      <span>
        {t('admin.inventoryHealth.fetchingReport', {
          defaultValue:
            'Fetching the latest report from EasyEcom — this can take a few minutes. It runs in the background, so you can keep working.',
        })}
      </span>
    </div>
  );
}

export default function InventoryHealth(): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Server-paginated: `styles` accumulates pages of style groups.
  const [styles, setStyles] = useState<InventoryStyle[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState<InventoryKpis | null>(null);
  // Day-key axis every visible size's trend sparkline aligns to (same for the page).
  const [trendDates, setTrendDates] = useState<string[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  // Real / virtual inventory view (display-only filter; China stock = virtual).
  const [inventory, setInventory] = useState<InventoryView>('all');
  // Clickable column sort; null = priority (urgency-first) default. The sort
  // dropdown (default / best seller / new arrival) writes the same two pieces.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Category filter (exact match) + the full category list from the response.
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  // Optional DRR/cover window. Empty = precomputed default (no from/to sent).
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const windowActive = !!(dateFrom && dateTo);
  // Seed search from ?q= so it survives navigating into a style and back.
  const [searchText, setSearchText] = useState(() => searchParams.get('q') ?? '');
  const debouncedSearch = useDebounced(searchText, 300);
  const { user } = useAuth();
  // Disable/enable is a merchandising action — admins + sampling editors.
  const canManage = hasAnyRole(user, ['admin', 'sampling_editor']);
  // Sending a style to the pipeline is a production action — a different set
  // (the page itself is open to every production reader).
  const canProduce = hasAnyRole(user, PRODUCTION_WRITE_ROLES);
  // Pending disable/enable confirmation (per style).
  const [confirmDisc, setConfirmDisc] = useState<{ styleKey: string; next: boolean } | null>(null);
  // Seller-approval hold confirmation (per style).
  const [confirmHold, setConfirmHold] = useState<{ styleKey: string; next: boolean } | null>(null);
  // Style queued for the "add to pipeline" dialog (quantities are editable there).
  const [produceTarget, setProduceTarget] = useState<StartProductionTarget | null>(null);
  const [produceBusy, setProduceBusy] = useState(false);

  // Fetch one server page for the current query (server filters/trims/sorts/slices).
  const load = useCallback(
    (skip: number): Promise<InventoryHealthResponse> =>
      getInventoryHealth({
        from: windowActive ? dateFrom : undefined,
        to: windowActive ? dateTo : undefined,
        skip,
        limit: PAGE_SIZE,
        filter,
        inventory,
        search: debouncedSearch.trim() || undefined,
        category: category || undefined,
        sortKey: sortKey ?? undefined,
        sortDir,
      }),
    [windowActive, dateFrom, dateTo, filter, inventory, debouncedSearch, category, sortKey, sortDir],
  );

  // Discard out-of-order responses when the query changes mid-flight.
  const reqRef = useRef(0);
  // Synchronous append guard (state lags a same-commit double observer fire).
  const loadingMoreRef = useRef(false);
  // The IntersectionObserver calls the freshest loadMore via a ref (its own
  // callback ref is stable) and re-attaches on every sentinel (re)mount.
  const loadMoreRef = useRef<() => void>(() => {});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: '400px' },
    );
    io.observe(node);
    observerRef.current = io;
  }, []);

  // Mirror the (debounced) search into ?q= so back-navigation restores it.
  useEffect(() => {
    const q = debouncedSearch.trim();
    // Functional update reads the LATEST params (not a stale closure); return the
    // previous instance unchanged so an identical q doesn't cause a redundant nav.
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (q) params.set('q', q);
        else params.delete('q');
        return params.toString() === prev.toString() ? prev : params;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Replace-load page 0 whenever the query (via `load`) or a manual reload changes.
  useEffect(() => {
    const my = ++reqRef.current;
    setLoading(true);
    setError(false);
    setLoadMoreError(false);
    loadingMoreRef.current = false;
    load(0)
      .then((d) => {
        if (reqRef.current !== my) return;
        setStyles(d.styles);
        setTotal(d.total);
        setKpis(d.kpis);
        setCategories(d.categories);
        setTrendDates(d.trendDates);
        setSyncedAt(d.syncedAt);
        setSyncing(d.syncing);
        setStale(d.stale);
      })
      .catch(() => {
        if (reqRef.current === my) setError(true);
      })
      .finally(() => {
        if (reqRef.current === my) setLoading(false);
      });
  }, [load, reloadTick]);

  // Append the next page when the sentinel scrolls into view.
  const loadMore = useCallback(() => {
    // Synchronous ref guard: two observer fires in one commit window read the
    // same stale `loadingMore` state, so gate on a ref that flips immediately.
    // Also blocked during a refresh so onRefresh's page-0 reload can't collide.
    if (loading || refreshing || loadingMoreRef.current || styles.length >= total) return;
    loadingMoreRef.current = true;
    const my = reqRef.current;
    setLoadMoreError(false);
    load(styles.length)
      .then((d) => {
        if (reqRef.current !== my) return; // query changed mid-flight → drop this page
        setStyles((prev) => [...prev, ...d.styles]);
        setTotal(d.total);
      })
      .catch(() => {
        // Don't swallow — the sentinel stays intersecting, so the observer won't
        // auto-retry; surface a Retry affordance instead of stalling forever.
        if (reqRef.current === my) setLoadMoreError(true);
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [load, loading, refreshing, styles.length, total]);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  // Passive watcher: if a sync (nightly cron / another admin) is already running
  // when we load, poll its status and do ONE race-safe reload when it finishes —
  // without the user clicking Refresh. Deliberately touches no pagination state.
  useEffect(() => {
    if (!syncing || refreshing) return;
    let cancelled = false;
    let elapsed = 0;
    const id = setInterval(async () => {
      elapsed += REFRESH_POLL_MS;
      let completed = false;
      try {
        const d = await load(0);
        completed = !d.syncing;
      } catch {
        /* transient — keep polling until the cap */
      }
      if (cancelled) return;
      if (completed) {
        clearInterval(id);
        setSyncing(false);
        setReloadTick((n) => n + 1); // pull the fresh data race-safely
      } else if (elapsed >= REFRESH_MAX_WAIT_MS) {
        // Give up watching WITHOUT reloading — a reload would re-read syncing=true
        // and restart this interval forever. The banner clears; manual Refresh stays.
        clearInterval(id);
        setSyncing(false);
      }
    }, REFRESH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [syncing, refreshing, load]);

  const onRefresh = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // ONE pull refreshes EVERY EasyEcom read model (Inventory Health + Sales KPI),
      // stamped with a single shared timestamp so every screen's "as of" matches.
      await refreshAllEasyEcom();
      const my = ++reqRef.current;
      const startAt = Date.now();
      let d = await load(0);
      while (d.syncing && Date.now() - startAt < REFRESH_MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, REFRESH_POLL_MS));
        try {
          d = await load(0);
        } catch {
          continue;
        }
      }
      if (reqRef.current === my) {
        setStyles(d.styles);
        setTotal(d.total);
        setKpis(d.kpis);
        setCategories(d.categories);
        setTrendDates(d.trendDates);
        setSyncedAt(d.syncedAt);
        setSyncing(d.syncing);
        setStale(d.stale);
        setLoadMoreError(false);
        loadingMoreRef.current = false;
        setError(false);
      }
      if (d.syncing) {
        // Polling timed out before the recompute finished — this is the last
        // available data, not a confirmed-fresh one; don't claim success.
        toast.show(
          t('admin.inventoryHealth.refreshTimeout', {
            defaultValue: 'Still refreshing in the background — showing the latest available data.',
          }),
          'error',
        );
      } else if (d.stale) {
        // Sync finished but the data didn't advance (EasyEcom fetch failed).
        toast.show(
          t('admin.inventoryHealth.refreshedStale', {
            defaultValue: 'Couldn’t fetch new data from EasyEcom — showing the latest available.',
          }),
          'error',
        );
      } else {
        toast.show(t('admin.inventoryHealth.refreshed', { defaultValue: 'Inventory health refreshed.' }), 'success');
      }
    } catch (err: unknown) {
      const res = (err as { response?: { status?: number; data?: { message?: string } } }).response;
      if (res?.status === 429) {
        // Shared cooldown with the Sales KPI refresh (refresh-all throttles non-admins
        // to one pull / 10 min) — data is still valid, not a failure. Mirror SalesKpis.
        toast.show(
          res.data?.message ??
            t('admin.inventoryHealth.refreshCooldown', { defaultValue: 'Refreshed recently — please try again soon.' }),
          'info',
        );
        return;
      }
      toast.show(t('admin.inventoryHealth.refreshFailed', { defaultValue: 'Refresh failed. Please try again.' }), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // Sign any GCS object paths (v1 imageUrl is usually null → ImageOff fallback).
  const imagePaths = useMemo(() => [...new Set(styles.map((s) => s.imageUrl))], [styles]);
  const signed = useSignedUrls(imagePaths);

  // Click a column header: toggle dir if it's the active one, else switch to it (asc).
  const onSort = useCallback(
    (key: SortKey): void => {
      // Update the two state pieces independently. Nesting setSortDir inside
      // setSortKey's updater double-fires the toggle under StrictMode (dev
      // double-invokes updaters) → the direction never flips locally.
      if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey],
  );

  // Preset sort dropdown ↔ the same (sortKey, sortDir) state the column headers use.
  // A column-header sort (e.g. Cover) matches no preset and reads as Default here.
  // ponytail: that cosmetic fallback is fine — the dropdown is the primary control.
  const sortPreset: 'default' | 'best' | 'newest' =
    sortKey === 'newest' ? 'newest' : sortKey === 'drr' && sortDir === 'desc' ? 'best' : 'default';
  const onSortPreset = useCallback((v: 'default' | 'best' | 'newest'): void => {
    if (v === 'default') setSortKey(null);
    else if (v === 'best') {
      setSortKey('drr');
      setSortDir('desc');
    } else {
      setSortKey('newest');
      setSortDir('desc');
    }
  }, []);

  // Absolute IST clock + "· 5 min ago" relative, mirroring the Sales KPI line.
  const syncedAbs = absTime(syncedAt);
  const syncedAgo = relativeTime(syncedAt);
  const synced = syncedAbs ? (syncedAgo ? `${syncedAbs} · ${syncedAgo}` : syncedAbs) : null;
  // Back-target for the style workspace, restoring this page + search. Held in a
  // ref so openStyle stays referentially stable — otherwise each search keystroke
  // (which mutates ?q=) changes `from`, rebuilding the whole columns memo.
  const from = `${location.pathname}${location.search}`;
  const fromRef = useRef(from);
  fromRef.current = from;

  const openStyle = useCallback(
    (linkedStyleId: number | null): void => {
      if (linkedStyleId == null) return;
      navigate(`/styles/${linkedStyleId}`, { state: { from: fromRef.current } });
    },
    [navigate],
  );

  // Confirm → mark/unmark the product discontinued, then race-safely reload page 0.
  const onConfirmDiscontinue = async (): Promise<void> => {
    if (!confirmDisc) return;
    const { styleKey, next } = confirmDisc;
    setConfirmDisc(null);
    try {
      await setStyleDiscontinued(styleKey, next);
      toast.show(
        next
          ? t('admin.inventoryHealth.discontinuedDone', { defaultValue: 'Product disabled.' })
          : t('admin.inventoryHealth.restoredDone', { defaultValue: 'Product enabled.' }),
        'success',
      );
      setReloadTick((n) => n + 1);
    } catch {
      toast.show(
        t('admin.inventoryHealth.discontinueFailed', { defaultValue: 'Couldn’t update. Please try again.' }),
        'error',
      );
    }
  };

  // Confirm → hold the style for seller approval (or release it), then reload.
  const onConfirmHold = async (): Promise<void> => {
    if (!confirmHold) return;
    const { styleKey, next } = confirmHold;
    setConfirmHold(null);
    try {
      await setStylePendingApproval(styleKey, next);
      toast.show(
        next
          ? t('admin.inventoryHealth.holdDone', { defaultValue: 'Moved to pending approval.' })
          : t('admin.inventoryHealth.releaseDone', { defaultValue: 'Back on the list.' }),
        'success',
      );
      setReloadTick((n) => n + 1);
    } catch {
      toast.show(
        t('admin.inventoryHealth.holdFailed', { defaultValue: 'Couldn’t update. Please try again.' }),
        'error',
      );
    }
  };

  // Add to pipeline → the shared start-production dialog, seeded from the
  // forecast. Quantities stay editable there: a new arrival has no sales history,
  // so every suggested qty is 0 and a one-click send would have nothing to send.
  const openProduce = (style: InventoryStyle, imageUrl: string | null): void => {
    const covers = style.sizes.map((z) => z.coverDays).filter((c): c is number => c != null);
    setProduceTarget({
      origin: 'forecast',
      styleKey: style.styleKey,
      styleId: style.linkedStyleId ?? undefined,
      styleRef: style.erpStyleId,
      name: meaningfulName(style),
      imageUrl,
      sizes: style.sizes.map((z) => ({
        sku: z.sku,
        size: z.size,
        suggestedQty: z.makeQty,
        coverDays: z.coverDays,
        currentStock: z.currentStock,
      })),
      drr: style.sizes.reduce((a, z) => a + z.drr, 0),
      worstCoverDays: covers.length ? Math.min(...covers) : null,
      totalStock: style.sizes.reduce((a, z) => a + z.currentStock, 0),
    });
  };

  const onProduceConfirm = async (body: CreateBatchBody): Promise<void> => {
    setProduceBusy(true);
    try {
      await createBatch(body);
      setProduceTarget(null);
      toast.show(t('admin.inventoryHealth.pipelineDone', { defaultValue: 'Added to pipeline.' }), 'success');
      // Reload so the style's Pipeline column + "in production" pill catch up.
      setReloadTick((n) => n + 1);
    } catch {
      toast.show(
        t('admin.inventoryHealth.pipelineFailed', { defaultValue: 'Couldn’t add to pipeline. Please try again.' }),
        'error',
      );
    } finally {
      setProduceBusy(false);
    }
  };

  // The lens tabs (Sampling-style) — urgency tiers, then the aging + new lenses.
  const lensTabs: QueueTab<FilterKey>[] = kpis
    ? [
        { key: 'all', label: t('admin.inventoryHealth.tab.all', { defaultValue: 'All styles' }), count: kpis.totalStyles },
        { key: 'cut', label: t('admin.inventoryHealth.tab.cut', { defaultValue: 'Cut size' }), count: kpis.cutSize },
        { key: 'out', label: t('admin.inventoryHealth.tab.out', { defaultValue: 'Out of stock' }), count: kpis.outOfStock },
        { key: 'critical', label: t('admin.inventoryHealth.tab.critical', { defaultValue: 'Critical' }), count: kpis.critical },
        { key: 'watch', label: t('admin.inventoryHealth.tab.watch', { defaultValue: 'Watch' }), count: kpis.watch },
        { key: 'slow', label: t('admin.inventoryHealth.tab.slow', { defaultValue: 'Slow-movers' }), count: kpis.slow },
        { key: 'dead', label: t('admin.inventoryHealth.tab.dead', { defaultValue: 'Dead stock' }), count: kpis.dead },
        // Held for seller approval — unsellable, so off every other lens. This is
        // the only way back to them.
        { key: 'pending', label: t('admin.inventoryHealth.tab.pending', { defaultValue: 'Pending approval' }), count: kpis.pendingApproval },
        // "What's new" is a sort preset (it reorders whichever lens is in focus),
        // not a lens of its own — no tab.
      ]
    : [];

  return (
    <div className="space-y-8 pb-10">
      {/* Header block — serif title + controls (right), status line beneath.
          Padding / max-width / background come from the AdminShell <main>, so this
          page reads identically to the dashboard (no self-padding / own bg). */}
      <div>
        {/* Tier 1 (design 1b) — title · compact sync status · Refresh. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            {t('admin.inventoryHealth.title', { defaultValue: 'Inventory Health' })}
          </h1>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* Sync status: stale/error read as a coloured pill, healthy as a dot line. */}
            {loading ? (
              <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                {t('admin.inventoryHealth.loading', { defaultValue: 'Loading…' })}
              </span>
            ) : error ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {t('admin.inventoryHealth.loadError', { defaultValue: 'Couldn’t load inventory health.' })}
              </span>
            ) : stale && synced ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                {t('admin.inventoryHealth.stale', {
                  defaultValue: 'Showing data from {{when}} — couldn’t fetch the latest from EasyEcom.',
                  when: synced,
                })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {synced
                  ? t('admin.inventoryHealth.synced', { defaultValue: 'As of {{when}}', when: synced })
                  : t('admin.inventoryHealth.neverSynced', { defaultValue: 'Not synced yet' })}
              </span>
            )}
            {/* Active custom window chip — clears back to the default trailing window. */}
            {windowActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                {t('admin.inventoryHealth.windowActive', {
                  defaultValue: 'Window: {{from}} – {{to}}',
                  from: shortDay(dateFrom),
                  to: shortDay(dateTo),
                })}
                <button
                  type="button"
                  aria-label={t('admin.inventoryHealth.windowClear', { defaultValue: 'Reset to default window' })}
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="text-neutral-400 hover:text-neutral-700"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={onRefresh}
              aria-busy={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] shadow-sm transition hover:opacity-90"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              {refreshing
                ? t('admin.inventoryHealth.syncing', { defaultValue: 'Syncing…' })
                : t('admin.inventoryHealth.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
        </div>

        {/* Tier 2 (design 1b) — one segmented control rail: stock view · category ·
            sort · window, divided into groups. Left-aligned, not full-width. */}
        <FilterRail className="mt-4">
            {/* Real / virtual stock view. */}
            <FilterRailSegments
              value={inventory}
              onChange={setInventory}
              ariaLabel={t('admin.inventoryHealth.inv.all', { defaultValue: 'All stock' })}
              options={(['all', 'real', 'virtual'] as const).map((v) => ({
                value: v,
                label: t(`admin.inventoryHealth.inv.${v}`, {
                  defaultValue: v === 'all' ? 'All stock' : v === 'real' ? 'Real' : 'Virtual',
                }),
              }))}
            />
            <FilterRailDivider />
            {/* Category filter — populated from the response's full-set list. */}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`${RAIL_SELECT_CLASS} max-w-[11rem]`}
              aria-label={t('admin.inventoryHealth.filterCategory', { defaultValue: 'Category' })}
            >
              <option value="">{t('admin.inventoryHealth.categoryAll', { defaultValue: 'All categories' })}</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <FilterRailDivider />
            {/* Sort preset — writes the same sortKey/sortDir as the column headers. */}
            <select
              value={sortPreset}
              onChange={(e) => onSortPreset(e.target.value as 'default' | 'best' | 'newest')}
              className={RAIL_SELECT_CLASS}
              aria-label={t('admin.inventoryHealth.sortBy', { defaultValue: 'Sort by' })}
            >
              <option value="default">{t('admin.inventoryHealth.sort.default', { defaultValue: 'Sort: Default' })}</option>
              <option value="best">{t('admin.inventoryHealth.sort.best', { defaultValue: 'Best seller' })}</option>
              <option value="newest">{t('admin.inventoryHealth.sort.newest', { defaultValue: 'What’s new' })}</option>
            </select>
            <FilterRailDivider />
            {/* DRR/cover window — same control the sampling dashboard uses. */}
            <div className="flex items-center">
              <DateRangePicker
                from={windowActive ? dateFrom : daysAgoISO(29)}
                to={windowActive ? dateTo : todayISO()}
                maxDate={todayISO()}
                label={t('admin.inventoryHealth.window', { defaultValue: 'Window' })}
                onApply={(f, tt) => {
                  setDateFrom(f);
                  setDateTo(tt);
                }}
              />
            </div>
        </FilterRail>
      </div>

      {/* Persistent banner while a manual/background sync is running. */}
      {(refreshing || syncing) && !loading && <FetchingBanner t={t} />}

        {/* Body */}
        {loading && !styles.length ? (
          <>
            <div style={CARD_SHELL} className="mb-4">
              <Skeleton className="h-6 w-80 rounded-md" />
              <Skeleton className="mt-3 h-4 w-64 rounded-md" />
            </div>
            <div style={CARD_SHELL}>
              <Skeleton className="h-40 w-full rounded-md" />
            </div>
          </>
        ) : kpis ? (
          <>
            {/* KPI cards — the two stock-gap cards double as filters (click to
                toggle, in sync with the lens tabs below); "To make" is the roll-up.
                Critical/Watch stay tabs-only: they forecast a stockout, while these
                two report one that already happened. Counts follow Real/Virtual. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                label={t('admin.inventoryHealth.chip.cut', { defaultValue: 'Cut size' })}
                value={kpis.cutSize}
                dot={AMBER}
                active={filter === 'cut'}
                onClick={() => setFilter(filter === 'cut' ? 'all' : 'cut')}
                t={t}
              />
              <StatCard
                label={t('admin.inventoryHealth.chip.out', { defaultValue: 'Out of stock' })}
                value={kpis.outOfStock}
                dot={RED}
                active={filter === 'out'}
                onClick={() => setFilter(filter === 'out' ? 'all' : 'out')}
                t={t}
              />
              <StatCard
                label={t('admin.inventoryHealth.toMake', { defaultValue: 'To make' })}
                value={kpis.unitsToMake}
                unit={t('admin.inventoryHealth.headlineUnits', { defaultValue: 'units' })}
              />
            </div>

            {/* One unified panel — the Sampling "style tracking" treatment: lens
                tabs · search + view filter · table · footer all share a single
                bordered card. */}
            <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
              {/* Tabs row — QueueTabs' own bottom border is the divider. */}
              <div className="px-4 pt-3">
                <QueueTabs tabs={lensTabs} active={filter} onSelect={setFilter} />
              </div>

              {/* Search · count. Category + sort live in the top-right controls row. */}
              <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-3">
                <div className="relative w-full sm:w-72">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-primary)]" />
                  <input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder={t('admin.inventoryHealth.search', { defaultValue: 'Search style, size or name…' })}
                    className="h-9 w-full rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary-soft)]/30 pl-9 pr-3 text-[13px] text-[var(--color-foreground)] outline-none focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/25"
                  />
                </div>
                <span className="ml-auto shrink-0 text-[12px] tabular-nums text-[var(--color-muted-foreground)]">
                  {t('admin.inventoryHealth.styleCount', { defaultValue: '{{n}} styles', n: total })}
                </span>
              </div>

              {/* A fresh query (tab switch / filter / search / sort) shows the loader
                  in place of the now-stale rows, then the new data — instead of
                  silently swapping one dataset for another. */}
              {loading ? (
                <div aria-busy aria-label={t('admin.inventoryHealth.loading', { defaultValue: 'Loading…' })}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 border-t border-neutral-100 px-4 py-3.5 first:border-t-0"
                    >
                      <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                      <Skeleton className="h-4 w-44 rounded" />
                      <div className="ml-auto flex items-center gap-6">
                        <Skeleton className="h-4 w-16 rounded" />
                        <Skeleton className="hidden h-4 w-24 rounded lg:block" />
                        <Skeleton className="h-4 w-10 rounded" />
                        <Skeleton className="h-4 w-10 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : total === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-[var(--color-muted-foreground)]">
                  {t('admin.inventoryHealth.empty', { defaultValue: 'Nothing matches this filter.' })}
                </div>
              ) : (
                // Grey list — column labels + floating white style cards (gap on
                // every side); the header sits inside the grey area to stay aligned.
                <div className="space-y-2.5 bg-neutral-100 p-2.5">
                  <div
                    className="hidden gap-3 px-4 pb-0.5 text-[11px] font-semibold uppercase tracking-wide lg:grid"
                    style={{ gridTemplateColumns: GRID, color: HEADER_INK }}
                  >
                    <span>{t('admin.inventoryHealth.col.size', { defaultValue: 'Size' })}</span>
                    <SortHeader label={t('admin.inventoryHealth.col.cover', { defaultValue: 'Cover' })} col="cover" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortHeader label={t('admin.inventoryHealth.col.drr', { defaultValue: 'DRR · /d' })} col="drr" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <span className="flex justify-end">{t('admin.inventoryHealth.col.trend', { defaultValue: 'Trend · /d' })}</span>
                    <SortHeader label={t('admin.inventoryHealth.col.stock', { defaultValue: 'Stock' })} col="stock" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                    <span className="flex justify-end">{t('admin.inventoryHealth.col.pipeline', { defaultValue: 'Pipeline' })}</span>
                    <SortHeader label={t('admin.inventoryHealth.col.make', { defaultValue: 'Make' })} col="make" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  </div>
                  {styles.map((style) => {
                    const img = (style.imageUrl && signed[style.imageUrl]) || null;
                    return (
                      <StyleGroup
                        key={style.styleKey}
                        style={style}
                        imageUrl={img}
                        dates={trendDates}
                        onOpen={() => openStyle(style.linkedStyleId)}
                        canManage={canManage}
                        canProduce={canProduce}
                        onRequestDiscontinue={(styleKey, next) => setConfirmDisc({ styleKey, next })}
                        onRequestHold={(styleKey, next) => setConfirmHold({ styleKey, next })}
                        onProduce={() => openProduce(style, img)}
                        t={t}
                      />
                    );
                  })}
                </div>
              )}

              {/* Infinite-scroll sentinel as the panel footer: entering the viewport
                  fetches the next page. On a fetch error the observer can't self-retry
                  (sentinel stays in view), so show a manual Retry instead of stalling. */}
              {styles.length < total && (
                <div
                  ref={sentinelRef}
                  className="border-t border-[var(--color-border)] px-4 py-3 text-center text-xs text-[var(--color-muted-foreground)]"
                >
                  {loadMoreError ? (
                    <button
                      type="button"
                      onClick={() => loadMore()}
                      className="font-medium text-[var(--color-foreground)] underline underline-offset-2 hover:opacity-80"
                    >
                      {t('admin.inventoryHealth.loadMoreRetry', {
                        defaultValue: 'Couldn’t load more — retry',
                      })}
                    </button>
                  ) : (
                    t('admin.inventoryHealth.loadingMore', {
                      defaultValue: 'Loading more… ({{shown}} of {{total}})',
                      shown: styles.length,
                      total,
                    })
                  )}
                </div>
              )}
            </section>
          </>
        ) : error ? (
          <div style={CARD_SHELL} className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-neutral-600">
              {t('admin.inventoryHealth.loadError', { defaultValue: 'Couldn’t load inventory health.' })}
            </p>
            <button
              type="button"
              onClick={() => setReloadTick((n) => n + 1)}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
              {t('admin.inventoryHealth.retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        ) : null}

      <ConfirmDialog
        open={confirmDisc != null}
        destructive={confirmDisc?.next === true}
        title={
          confirmDisc?.next
            ? t('admin.inventoryHealth.discontinueTitle', { defaultValue: 'Disable product?' })
            : t('admin.inventoryHealth.restoreTitle', { defaultValue: 'Enable product?' })
        }
        message={
          confirmDisc?.next
            ? t('admin.inventoryHealth.discontinueMsg', {
                defaultValue: '“{{style}}” and all its sizes will drop to the bottom of the list.',
                style: confirmDisc?.styleKey ?? '',
              })
            : t('admin.inventoryHealth.restoreMsg', {
                defaultValue: '“{{style}}” will return to its normal position.',
                style: confirmDisc?.styleKey ?? '',
              })
        }
        confirmLabel={
          confirmDisc?.next
            ? t('admin.inventoryHealth.discontinueConfirm', { defaultValue: 'Disable' })
            : t('admin.inventoryHealth.restoreConfirm', { defaultValue: 'Enable' })
        }
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        onConfirm={onConfirmDiscontinue}
        onCancel={() => setConfirmDisc(null)}
      />

      <ConfirmDialog
        open={confirmHold != null}
        title={
          confirmHold?.next
            ? t('admin.inventoryHealth.holdTitle', { defaultValue: 'Hold for seller approval?' })
            : t('admin.inventoryHealth.releaseTitle', { defaultValue: 'Mark approved?' })
        }
        message={
          confirmHold?.next
            ? t('admin.inventoryHealth.holdMsg', {
                defaultValue:
                  '“{{style}}” leaves the forecast and the production queue until it is approved. You’ll find it under Pending approval.',
                style: confirmHold?.styleKey ?? '',
              })
            : t('admin.inventoryHealth.releaseMsg', {
                defaultValue: '“{{style}}” goes back on the list and can be produced again.',
                style: confirmHold?.styleKey ?? '',
              })
        }
        confirmLabel={
          confirmHold?.next
            ? t('admin.inventoryHealth.holdConfirm', { defaultValue: 'Hold' })
            : t('admin.inventoryHealth.releaseConfirm', { defaultValue: 'Mark approved' })
        }
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        onConfirm={() => void onConfirmHold()}
        onCancel={() => setConfirmHold(null)}
      />

      {/* Add to pipeline — the same dialog the dashboard starts production from. */}
      <StartProductionDialog
        open={produceTarget != null}
        busy={produceBusy}
        target={produceTarget}
        onClose={() => setProduceTarget(null)}
        onConfirm={(body) => void onProduceConfirm(body)}
      />
    </div>
  );
}

/** Per-channel listing chips — clickable out-links to the live marketplace
 *  listing (only channels with a real ERP StyleChannelListing URL appear). */
function ChannelChips({ links }: { links: { channel: string; url: string }[] }): ReactNode {
  if (!links.length) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {links.map((l) => (
        <a
          key={l.channel}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open on ${l.channel}`}
          className="inline-flex items-center gap-1 rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          {l.channel}
          <ArrowUpRight size={10} className="text-neutral-400" />
        </a>
      ))}
    </span>
  );
}

/** A style group — a header (product image + code + status pills) over its size
 *  rows, always expanded. The code opens the style workspace. */
function StyleGroup({
  style,
  imageUrl,
  dates,
  onOpen,
  canManage,
  canProduce,
  onRequestDiscontinue,
  onRequestHold,
  onProduce,
  t,
}: {
  style: InventoryStyle;
  imageUrl: string | null;
  dates: string[];
  onOpen: () => void;
  canManage: boolean;
  canProduce: boolean;
  onRequestDiscontinue: (styleKey: string, next: boolean) => void;
  onRequestHold: (styleKey: string, next: boolean) => void;
  onProduce: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}): ReactNode {
  const linked = style.linkedStyleId != null;
  const codeColor = style.lowVolume ? 'text-neutral-500' : 'text-neutral-900';
  const showName = meaningfulName(style) != null;
  // Sizes soonest-to-run-out first within the group.
  const cover = (z: InventorySize): number => z.coverDays ?? Number.POSITIVE_INFINITY;
  const sizes = [...style.sizes].sort((a, b) => cover(a) - cover(b));
  // Units in production across the style's sizes (drives the "in production" pill).
  const pipelineTotal = style.sizes.reduce((a, z) => a + z.pipelineQty, 0);
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-md)] border border-neutral-200 bg-white shadow-sm ${
        style.discontinued ? 'opacity-60' : ''
      }`}
    >
      {/* Style header — product image + code + status pills, over its (always
          visible) size rows. Reads as a product card. */}
      <div className="flex items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3.5">
        <HoverThumbnail src={imageUrl} alt={style.styleKey} size={48} radius="10px" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {linked ? (
              <button
                type="button"
                onClick={onOpen}
                title={t('admin.inventoryHealth.openStyle', { defaultValue: 'Open style workspace' })}
                className="inline-flex min-w-0 items-center gap-1 text-[15px] font-semibold text-[var(--color-primary)] underline decoration-dotted underline-offset-4 hover:decoration-solid"
              >
                <span className="truncate">{style.styleKey}</span>
                <ArrowUpRight size={14} className="shrink-0" style={{ color: PRIMARY }} />
              </button>
            ) : (
              <span className={`truncate text-[15px] font-semibold ${codeColor}`}>{style.styleKey}</span>
            )}
            <UrgencyPill urgency={style.worstUrgency} />
            {style.isNew && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                <Sparkles size={10} />
                {t('admin.inventoryHealth.newBadge', { defaultValue: 'New arrival' })}
              </span>
            )}
            {style.discontinued && (
              <span className="inline-flex items-center rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                {t('admin.inventoryHealth.discontinuedBadge', { defaultValue: 'disabled' })}
              </span>
            )}
            {style.pendingApproval && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                <Clock size={10} />
                {t('admin.inventoryHealth.pendingBadge', { defaultValue: 'pending approval' })}
              </span>
            )}
            {style.lowVolume && (
              <span className="inline-flex items-center rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400">
                {t('admin.inventoryHealth.lowVolume', { defaultValue: 'low volume' })}
              </span>
            )}
            {pipelineTotal > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                <Factory size={10} />
                {t('admin.inventoryHealth.inProduction', { defaultValue: '{{n}} in production', n: fmtN(pipelineTotal) })}
              </span>
            )}
          </div>
          {(showName || style.marketplaceLinks.length > 0) && (
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              {showName && (
                <span className="truncate font-mono text-[11px]" style={{ color: NEUTRAL_DOT }}>
                  {style.name}
                </span>
              )}
              <ChannelChips links={style.marketplaceLinks} />
            </div>
          )}
        </div>
        {canProduce && !style.discontinued && !style.pendingApproval && (
          <button
            type="button"
            onClick={onProduce}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.08] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary)] transition hover:bg-[var(--color-primary)]/[0.14]"
          >
            <Factory size={13} />
            {t('admin.inventoryHealth.addToPipeline', { defaultValue: 'Add to pipeline' })}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => onRequestHold(style.styleKey, !style.pendingApproval)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
              style.pendingApproval
                ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                : 'border-amber-200 text-amber-700 hover:bg-amber-50'
            }`}
          >
            {style.pendingApproval ? (
              <>
                <CheckCircle2 size={13} />
                {t('admin.inventoryHealth.release', { defaultValue: 'Approved' })}
              </>
            ) : (
              <>
                <Clock size={13} />
                {t('admin.inventoryHealth.hold', { defaultValue: 'Hold for approval' })}
              </>
            )}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => onRequestDiscontinue(style.styleKey, !style.discontinued)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
              style.discontinued
                ? 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                : 'border-red-200 text-red-600 hover:bg-red-50'
            }`}
          >
            {style.discontinued ? (
              <>
                <RotateCcw size={13} />
                {t('admin.inventoryHealth.enable', { defaultValue: 'Enable' })}
              </>
            ) : (
              <>
                <Ban size={13} />
                {t('admin.inventoryHealth.disable', { defaultValue: 'Disable' })}
              </>
            )}
          </button>
        )}
      </div>

      {/* Size rows — always visible; columns align to the single top header. */}
      <div>
        {sizes.map((sz) => (
          <SizeRow key={sz.sku} size={sz} dates={dates} t={t} />
        ))}
      </div>
    </div>
  );
}

/** One size — a child row: urgency dot + size + SKU (+ aging pill), then metrics.
 *  The product image lives once in the style header, not repeated per size. */
function SizeRow({
  size,
  dates,
  t,
}: {
  size: InventorySize;
  dates: string[];
  t: ReturnType<typeof useTranslation>['t'];
}): ReactNode {
  const u = URG[size.urgency];
  const low = size.confidence === 'low';
  return (
    <div
      className="grid grid-cols-2 items-center gap-y-1 gap-x-3 border-t border-neutral-100 px-4 py-3 text-sm transition first:border-t-0 hover:bg-neutral-50/60 lg:grid-cols-[var(--ih-grid)]"
      style={{ ['--ih-grid' as string]: GRID }}
    >
      {/* Size: urgency dot + size + SKU + aging pill */}
      <div className="col-span-2 flex min-w-0 items-center gap-2.5 lg:col-span-1">
        <span style={{ width: 8, height: 8, borderRadius: 999, background: u.dot }} className="shrink-0" />
        <span className="text-[14px] font-semibold text-neutral-800">{size.size}</span>
        <span className="truncate font-mono text-[11px] font-medium text-neutral-600">{size.sku}</span>
        <CopyButton text={size.sku} label={t('admin.inventoryHealth.copySku', { defaultValue: 'Copy SKU' })} />
        {(size.aging === 'slow' || size.aging === 'dead') && <AgingPill aging={size.aging} />}
      </div>

      <Cell label={t('admin.inventoryHealth.col.cover', { defaultValue: 'Cover' })}>
        {size.coverDays == null ? (
          <span className="font-semibold" style={{ color: MUTED }}>—</span>
        ) : (
          <span className="font-semibold" style={{ color: u.color }}>
            {t('admin.inventoryHealth.daysLeft', { defaultValue: '{{n}} days left', n: fmtN(size.coverDays) })}
          </span>
        )}
      </Cell>

      {/* DRR — up to 2dp so a 0.03/day slow-mover never rounds to a misleading "0". */}
      <Cell label={t('admin.inventoryHealth.col.drr', { defaultValue: 'DRR' })}>
        <span className="tabular-nums" style={{ color: low ? MUTED : INK }}>
          {low ? '~' : ''}
          {size.drr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </span>
        {low && (
          <span className="ml-1.5 rounded bg-neutral-200 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
            {t('admin.inventoryHealth.lowData', { defaultValue: 'low data' })}
          </span>
        )}
      </Cell>

      <Cell label={t('admin.inventoryHealth.col.trend', { defaultValue: 'Trend · /d' })} align="right">
        <TrendCell data={size.trend ?? []} dates={dates} t={t} />
      </Cell>

      <Cell label={t('admin.inventoryHealth.col.stock', { defaultValue: 'Stock' })} align="right">
        <span className="tabular-nums text-neutral-700">{fmtN(size.currentStock)}</span>
      </Cell>

      {/* Units already in open production batches (planning + on the floor). Folded
          into cover/make server-side; shown so a size mid-make reads as covered. */}
      <Cell label={t('admin.inventoryHealth.col.pipeline', { defaultValue: 'Pipeline' })} align="right">
        <span className="tabular-nums" style={{ color: size.pipelineQty > 0 ? INK : MUTED }}>
          {size.pipelineQty > 0 ? fmtN(size.pipelineQty) : '—'}
        </span>
      </Cell>

      <Cell label={t('admin.inventoryHealth.col.make', { defaultValue: 'Make' })} align="right">
        <span className="font-bold tabular-nums" style={{ color: size.makeQty > 0 ? INK : MUTED }}>
          {fmtN(size.makeQty)}
        </span>
      </Cell>
    </div>
  );
}

/** Copy-to-clipboard button for the SKU — the mono code is easy to mistype, so
 *  a one-click copy sits beside it. Brief check-mark confirmation. */
function CopyButton({ text, label }: { text: string; label: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {
            // Clipboard blocked (denied permission / insecure context) — the
            // check-mark just won't show; don't leave the rejection unhandled.
          });
      }}
      className="shrink-0 rounded p-0.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
    >
      {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
    </button>
  );
}

/** One data cell — inline column label on small screens; right-align opt-in. */
function Cell({
  label,
  align = 'left',
  children,
}: {
  label: string;
  align?: 'left' | 'right';
  children: ReactNode;
}): ReactNode {
  const right = align === 'right';
  return (
    <div className={`flex items-center justify-between ${right ? 'lg:justify-end' : 'lg:block lg:justify-start'}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">{label}</span>
      <span className="flex items-center">{children}</span>
    </div>
  );
}

/** KPI card. The three urgency cards are clickable filters (active = ring +
 *  emphasised border) that toggle the same `filter` state as the lens tabs; the
 *  "to make" roll-up is informational (no onClick). Counts are inventory-scoped. */
function StatCard({
  label,
  value,
  unit,
  dot,
  active,
  onClick,
  t,
}: {
  label: string;
  value: number;
  unit?: string;
  dot?: string;
  active?: boolean;
  onClick?: () => void;
  t?: ReturnType<typeof useTranslation>['t'];
}): ReactNode {
  const clickable = !!onClick;
  return (
    <div
      {...(clickable
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-pressed': !!active,
            onClick,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            },
          }
        : {})}
      style={{ ...CARD_SHELL, padding: '14px 16px', borderColor: active ? PRIMARY : '#EFEDEB' }}
      className={`flex flex-col transition ${
        clickable ? 'cursor-pointer hover:border-neutral-400' : 'cursor-default'
      } ${active ? 'ring-1 ring-[var(--color-primary)]' : ''}`}
    >
      <span
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: LABEL_GREY }}
      >
        {dot && <span style={{ width: 7, height: 7, borderRadius: 999, background: dot }} />}
        {label}
      </span>
      <span className="mt-2 tabular-nums" style={{ color: INK, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
        {fmtN(value)}
        {unit && (
          <span className="ml-1 text-sm font-medium" style={{ color: MUTED }}>
            {unit}
          </span>
        )}
      </span>
      {clickable && active && (
        <span className="mt-1.5 text-[10px] font-medium" style={{ color: NEUTRAL_DOT }}>
          {t?.('admin.inventoryHealth.filtering', { defaultValue: 'filtering · click to clear' })}
        </span>
      )}
    </div>
  );
}

/** Clickable column header. A faint ArrowUpDown means "sortable"; the active
 *  column shows a solid ArrowUp/ArrowDown. Sorts the STYLES (server-side). */
function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey | null;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}): ReactNode {
  const activeSort = sortKey === col;
  const Icon = activeSort ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSort(col);
      }}
      className={`flex items-center gap-1 uppercase tracking-[inherit] transition hover:text-[var(--color-foreground)] ${
        align === 'right' ? 'ml-auto justify-end' : 'justify-start'
      }`}
      style={{ color: activeSort ? PRIMARY : 'inherit', letterSpacing: 'inherit' }}
    >
      {label}
      <Icon size={12} style={{ color: activeSort ? PRIMARY : MUTED }} />
    </button>
  );
}

export function UrgencyPill({ urgency }: { urgency: Urgency }): ReactNode {
  const u = URG[urgency];
  // Neutral chrome; the dot carries the meaning-colour (red/amber/grey).
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
      <span style={{ width: 6, height: 6, borderRadius: 999, background: u.dot }} />
      {u.label}
    </span>
  );
}

function AgingPill({ aging }: { aging: Exclude<Aging, 'active'> }): ReactNode {
  const a = AGE[aging];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
      <span style={{ width: 6, height: 6, borderRadius: 999, background: a.dot }} />
      {a.label}
    </span>
  );
}

/** Up / down / flat from the first-third vs last-third mean, with a 10% deadband
 *  so noise doesn't read as a trend (colours the sparkline + arrow). */
function trendDir(data: number[]): 'up' | 'down' | 'flat' {
  const n = data.length;
  if (n < 4) return 'flat';
  const k = Math.max(1, Math.floor(n / 3));
  const mean = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const first = mean(data.slice(0, k));
  const last = mean(data.slice(n - k));
  const delta = (last - first) / Math.max(first, 0.001);
  if (delta > 0.1) return 'up';
  if (delta < -0.1) return 'down';
  return 'flat';
}

/** Inline INTERACTIVE trend sparkline: hover any day to read that day's units in
 *  the built-in tooltip. Colour + arrow show whether velocity is rising or
 *  falling. No enlarge/popover — the chart itself IS the interaction. */
function TrendCell({
  data,
  dates,
  t,
}: {
  data: number[];
  dates: string[];
  t: ReturnType<typeof useTranslation>['t'];
}): ReactNode {
  // Always render the sparkline — even a flat no-sales line shows the size has a
  // chart (a "—" placeholder read as missing data). Flat/zero → grey, no arrow.
  const dir = useMemo(() => trendDir(data), [data]);
  const color = dir === 'up' ? TREND_UP : dir === 'down' ? TREND_DOWN : NEUTRAL_DOT;
  const DirIcon = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus;
  return (
    <span className="flex w-full items-center justify-end gap-1.5">
      <span
        className="-mt-3 inline-block w-[92px] shrink-0"
        title={t('admin.inventoryHealth.trendTitle', { defaultValue: 'Daily units — hover a day for its value' })}
      >
        {/* Raw daily units → the built-in tooltip shows that day's actual value. */}
        <TrendChart
          data={data}
          dates={dates}
          accent={color}
          unit={t('admin.inventoryHealth.perDay', { defaultValue: '/d' })}
        />
      </span>
      <DirIcon size={13} style={{ color }} className="shrink-0" />
    </span>
  );
}
