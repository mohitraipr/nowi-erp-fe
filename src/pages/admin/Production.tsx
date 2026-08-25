import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Factory, Loader2, Search, Undo2, X } from 'lucide-react';
import {
  QueueTabs,
  StyleQueueTable,
  type QueueColumn,
} from '@/components/styles/StyleQueueTable';
import { HoverThumbnail, HoverTip } from '@/components/dashboard/StylesInFlightTable';
import { TruncText } from '@/components/ui/trunc-text';
import { SummaryCard } from '@/components/ui/summary-card';
import { ALL_TIME_FROM_ISO, DateRangePicker } from '@/components/ui/DateRangePicker';
import {
  FilterChips,
  FilterRail,
  FilterRailDivider,
  RAIL_SELECT_CLASS,
} from '@/components/ui/filter-rail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import RecordOutputDialog from '@/components/production/RecordOutputDialog';
import StageQtyDialog from '@/components/production/StageQtyDialog';
import AlterationReturnDialog from '@/components/production/AlterationReturnDialog';
import StartProductionIntakeDialog from '@/components/production/StartProductionIntakeDialog';
import DispatchBuilderDialog from '@/components/production/DispatchBuilderDialog';
import CancelBatchDialog from '@/components/production/CancelBatchDialog';
import { createDispatch, type CreateDispatchBody } from '@/api/productionDispatch';
import {
  ADVANCEABLE_STATUSES,
  advanceBatch,
  cancelBatch,
  completeBatch,
  alterationReturn,
  createBatch,
  getBatches,
  parkStyle,
  sendToProduction,
  unparkStyle,
  type BatchOrigin,
  type BatchStatus,
  type CreateBatchBody,
  type ProductionBatch,
  type ProductionKpis,
  type AlterationReturnItem,
  type StageQtyItem,
} from '@/api/production';
import { getInventoryHealth, type InventoryStyle } from '@/api/inventoryHealth';
import {
  cleanName,
  coverTone,
  meaningfulName,
  outstandingAlteration,
  statusLabel,
} from '@/lib/production';
import { UrgencyPill } from '@/pages/admin/InventoryHealth';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/context/auth';
import { useDebounced } from '@/lib/useDebounced';
import {
  hasAnyRole,
  PRODUCTION_CANCEL_ROLES,
  PRODUCTION_WRITE_ROLES,
} from '@/lib/userRoles';

type Tab = 'to_start' | 'planning' | 'in_production' | 'completed' | 'parked';

const PAGE_SIZE = 50;

/** Floor stage order, for direction only. Alteration is absent on purpose: it is
 *  a quantity recorded during the stitching → finishing move, never a stage the
 *  lot moves INTO. */
const STAGE_SEQUENCE: BatchStatus[] = ['planning', 'cutting', 'stitching', 'finishing'];

/** Is this move going forward down the floor? Unknown stages count as forward,
 *  so a new stage defaults to capturing its quantity rather than silently not. */
function isForward(from: BatchStatus, to: BatchStatus): boolean {
  const a = STAGE_SEQUENCE.indexOf(from);
  const b = STAGE_SEQUENCE.indexOf(to);
  return a === -1 || b === -1 || b > a;
}

/** Units made but not yet shipped — what a challan can still draw from. */
function remainingToDispatch(b: ProductionBatch): number {
  return b.sizes.reduce((n, s) => n + Math.max(0, (s.qtyProduced ?? 0) - s.qtyDispatched), 0);
}

/** Selectable for dispatch only while something is left to ship. */
function hasRemaining(b: ProductionBatch): boolean {
  return remainingToDispatch(b) > 0;
}

/** Which per-size figure each floor stage reports, and the word for it. */
const STAGE_DONE: Record<string, { key: 'qtyCut' | 'qtyStitched' | 'qtyFinished'; label: string }> =
  {
    cutting: { key: 'qtyCut', label: 'cut' },
    stitching: { key: 'qtyStitched', label: 'stitched' },
    finishing: { key: 'qtyFinished', label: 'finished' },
  };

/**
 * Units recorded into the stage this lot is currently sitting in — "in stitching,
 * 460 stitched". Null off the floor (Planning has no stage) and for lots that ran
 * before stage entries existed, where every figure is a zero that means "unknown".
 */
function stageTotal(b: ProductionBatch): { qty: number; label: string } | null {
  const at = STAGE_DONE[b.status];
  if (!at) return null;
  const qty = b.sizes.reduce((sum, s) => sum + (s[at.key] ?? 0), 0);
  return qty > 0 ? { qty, label: at.label } : null;
}

/** Amber past a week — a batch sitting in one stage is the thing to spot. */
function ageTone(days: number): string {
  return days >= 7 ? 'text-amber-600 font-semibold' : 'text-[var(--color-muted-foreground)]';
}

/** Local `YYYY-MM-DD` `n` days ago (never toISOString — that formats in UTC and
 *  shifts the day for an IST user in the small hours). */
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The board opens on ALL TIME, not a trailing window. It is an operational
 *  queue — a lot started 45 days ago and still on the floor is exactly the one
 *  you must not hide, and the KPI cards above are unwindowed, so a default
 *  window would also make the cards and the table disagree. Narrowing is an
 *  explicit choice via the picker. */

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export default function Production() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canWrite = hasAnyRole(user, PRODUCTION_WRITE_ROLES);
  const canCancel = hasAnyRole(user, PRODUCTION_CANCEL_ROLES);

  // Opens on the floor by default ("what's running right now?"), but honours
  // ?tab= so other pages can deep-link here — e.g. starting a batch elsewhere
  // lands on the Planning tab, its new home.
  const TABS: Tab[] = ['to_start', 'planning', 'in_production', 'completed', 'parked'];
  const initialTab = searchParams.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(
    initialTab && TABS.includes(initialTab) ? initialTab : 'in_production',
  );
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  // Every keystroke would otherwise fire a request, and slow responses can land
  // out of order and render a stale result set.
  const debouncedSearch = useDebounced(search, 300);

  // Mirror the (debounced) search into ?q= so back-navigation restores it —
  // the same system the dashboard Sampling tab and Inventory Health use.
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const q = debouncedSearch.trim();
    if (q) params.set('q', q);
    else params.delete('q');
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [debouncedSearch, searchParams, setSearchParams]);
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [suggestions, setSuggestions] = useState<InventoryStyle[]>([]);
  const [kpis, setKpis] = useState<ProductionKpis | null>(null);
  // Tab chips are FILTER-AWARE and the KPI cards are board-wide, so they cannot
  // share state: `loadKpis` deliberately fetches unfiltered and would otherwise
  // race the list response and overwrite the filtered counts with global ones.
  const [tabCounts, setTabCounts] = useState<ProductionKpis['tabCounts'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [total, setTotal] = useState(0);
  /** RAW rows fetched (pre client-side trim) — what the "more pages?" test uses. */
  const [loaded, setLoaded] = useState(0);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BatchStatus | ''>('');
  const [originFilter, setOriginFilter] = useState<BatchOrigin | ''>('');
  // Start-date window, defaulting to all time (see ALL_TIME_FROM_ISO).
  const [dateFrom, setDateFrom] = useState<string>(ALL_TIME_FROM_ISO);
  const [dateTo, setDateTo] = useState<string>(() => daysAgoISO(0));
  // Suggested-tab styles still expand; batch rows don't — the lot page is their
  // detail view.
  const [expandedStyles, setExpandedStyles] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [outputTarget, setOutputTarget] = useState<ProductionBatch | null>(null);
  const [sendTarget, setSendTarget] = useState<ProductionBatch | null>(null);
  const [stageTarget, setStageTarget] = useState<{ batch: ProductionBatch; status: BatchStatus } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ProductionBatch | null>(null);
  const [alterTarget, setAlterTarget] = useState<ProductionBatch | null>(null);
  const [dropTarget, setDropTarget] = useState<InventoryStyle | null>(null);
  // Completed-tab multi-select → the one place a challan is built. Keyed
  // per-size (`${batchId}:${sku}`) so a challan can ship a subset of a batch's
  // sizes.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [builderOpen, setBuilderOpen] = useState(false);

  // Current filters, held in a ref so `loadKpis` can read them while keeping a
  // STABLE identity — it sits in an effect's dep list, so recreating it on every
  // filter change would fire a second request alongside the list's own reload.
  const filtersRef = useRef({
    tab,
    statusFilter,
    originFilter,
    search: debouncedSearch,
    from: dateFrom,
    to: dateTo,
  });
  filtersRef.current = {
    tab,
    statusFilter,
    originFilter,
    search: debouncedSearch,
    from: dateFrom,
    to: dateTo,
  };

  const loadKpis = useCallback(async () => {
    // Board-level figures live on the batches endpoint; `take: 1` because we
    // only want the KPI block, not another page of rows.
    //
    // The active filters go with it so the TAB COUNTS come back scoped to what
    // the board is showing. The cards are unaffected — the server computes them
    // board-wide and ignores the query — so one call serves both. Mutations
    // refresh through here without reloading the list (which would blink it),
    // and before this carried the filters they left the chips on pre-mutation
    // numbers.
    const f = filtersRef.current;
    const res = await getBatches({
      take: 1,
      tab: f.tab === 'to_start' || f.tab === 'parked' ? undefined : f.tab,
      status: f.statusFilter || undefined,
      origin: f.originFilter || undefined,
      search: f.search || undefined,
      from: f.from,
      to: f.to,
    });
    setKpis(res.kpis);
    setTabCounts(res.kpis.tabCounts);
  }, []);

  const fetchPage = useCallback(
    async (skip: number) => {
      if (tab === 'to_start' || tab === 'parked') {
        const res = await getInventoryHealth({
          skip,
          limit: PAGE_SIZE,
          search: debouncedSearch || undefined,
          filter: tab === 'parked' ? 'parked' : undefined,
          // Suggested drops any style already in Planning/Production (dedup).
          excludeInProduction: tab === 'to_start',
        });
        const styles =
          tab === 'parked'
            ? res.styles
            : res.styles.filter((x) => !x.discontinued && x.sizes.some((z) => z.makeQty > 0));
        return {
          styles,
          batches: [] as ProductionBatch[],
          raw: res.styles.length,
          total: res.total,
          kpis: null,
        };
      }
      const res = await getBatches({
        tab,
        status: statusFilter || undefined,
        origin: originFilter || undefined,
        search: debouncedSearch || undefined,
        from: dateFrom,
        to: dateTo,
        skip,
        take: PAGE_SIZE,
      });
      return {
        styles: [] as InventoryStyle[],
        batches: res.rows,
        raw: res.rows.length,
        total: res.total,
        kpis: res.kpis,
      };
    },
    [tab, debouncedSearch, statusFilter, originFilter, dateFrom, dateTo],
  );

  const reqRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setLoadMoreError(false);
    const my = ++reqRef.current;
    try {
      const d = await fetchPage(0);
      if (reqRef.current !== my) return;
      setSuggestions(d.styles);
      setBatches(d.batches);
      setLoaded(d.raw);
      setTotal(d.total);
      if (d.kpis) {
        setKpis(d.kpis);
        setTabCounts(d.kpis.tabCounts); // only the LIST response carries filtered counts
      }
    } catch {
      if (reqRef.current === my) setError(true);
    } finally {
      if (reqRef.current === my) setLoading(false);
    }
  }, [fetchPage]);

  // Append the next page when the sentinel scrolls into view.
  const loadMore = useCallback(() => {
    // Synchronous ref guard: two observer fires in one commit read the same
    // stale state, so gate on a ref that flips immediately.
    if (loading || loadingMoreRef.current || loaded >= total) return;
    loadingMoreRef.current = true;
    const my = reqRef.current;
    setLoadMoreError(false);
    fetchPage(loaded)
      .then((d) => {
        if (reqRef.current !== my) return; // query changed mid-flight
        setSuggestions((prev) => [...prev, ...d.styles]);
        setBatches((prev) => [...prev, ...d.batches]);
        setLoaded((prev) => prev + d.raw);
        setTotal(d.total);
      })
      .catch(() => {
        // The sentinel stays intersecting, so the observer won't auto-retry —
        // surface a Retry instead of stalling silently.
        if (reqRef.current === my) setLoadMoreError(true);
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [fetchPage, loading, loaded, total]);

  const loadMoreRef = useRef<() => void>(() => {});
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
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


  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  // Patch ONE batch into the visible list without a full reload — so a stage
  // change repaints just that row instead of blinking the whole table. If the
  // update takes the batch out of the current tab (completed leaves Planning,
  // cancelled leaves both) it's removed; otherwise replaced in place.
  const applyBatch = useCallback(
    (updated: ProductionBatch) => {
      const inTab =
        tab === 'planning'
          ? updated.status === 'planning'
          : tab === 'completed'
            ? updated.status === 'completed'
            : updated.status === 'cutting' ||
              updated.status === 'stitching' ||
              updated.status === 'finishing';
      let removed = false;
      setBatches((prev) => {
        if (!inTab) {
          const next = prev.filter((b) => b.id !== updated.id);
          removed = next.length < prev.length;
          return next;
        }
        return prev.some((b) => b.id === updated.id)
          ? prev.map((b) => (b.id === updated.id ? updated : b))
          : [updated, ...prev];
      });
      // The row left the current tab — shrink the infinite-scroll offset with the
      // (now smaller) server result set, or the next page fetch skips one row.
      if (removed) {
        setLoaded((l) => Math.max(0, l - 1));
        setTotal((t) => Math.max(0, t - 1));
      }
      void loadKpis(); // KPI cards are separate state — updating them can't blink the list
    },
    [tab, loadKpis],
  );

  // A batch mutation that returns the updated batch; patch it in place.
  const runAction = async (fn: () => Promise<ProductionBatch>) => {
    setBusy(true);
    try {
      applyBatch(await fn());
    } catch (e: unknown) {
      // The server explains refusals ("lot is dispatched — this action needs
      // …"); show that rather than burying it under the generic line.
      const raw = (e as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      const m = Array.isArray(raw) ? raw.join(', ') : raw;
      toast.show(
        m ||
          t('admin.production.actionFailed', {
            defaultValue: "That didn't go through. Refresh and try again.",
          }),
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const onStart = (body: CreateBatchBody) => {
    setBusy(true);
    // Direct-to-production opens on the floor; otherwise it lands in Planning.
    const dest: Tab = body.directToProduction ? 'in_production' : 'planning';
    createBatch(body)
      .then(() => {
        setIntakeOpen(false);
        toast.show(
          body.directToProduction
            ? t('admin.production.started', { defaultValue: 'Sent to production.' })
            : t('admin.production.plannedToast', { defaultValue: 'Added to pipeline.' }),
        );
        void loadKpis(); // KPI cards are separate state — refresh after a create.
        setTab(dest);
        // Switching tabs refetches on its own; already being on `dest` doesn't,
        // so the new batch would be missing until a manual reload.
        if (tab === dest) void load();
      })
      .catch(() =>
        toast.show(
          t('admin.production.startFailed', { defaultValue: "Couldn't start production." }),
          'error',
        ),
      )
      .finally(() => setBusy(false));
  };

  // Suggested → Planning: no quantity prompt. Create a planning batch straight
  // from the forecast, seeding qtyPlanned from the make-qty per size.
  const onAddToPlanning = (style: InventoryStyle) => {
    const needing = style.sizes.filter((z) => z.makeQty > 0);
    if (needing.length === 0) return;
    setBusy(true);
    createBatch({
      origin: 'forecast',
      styleKey: style.styleKey,
      styleId: style.linkedStyleId ?? undefined,
      items: needing.map((z) => ({
        sku: z.sku,
        size: z.size,
        qtyPlanned: z.makeQty,
        suggestedQty: z.makeQty,
      })),
    })
      .then(() => {
        // Drop it from Suggested in place, then reveal the Planning tab.
        setSuggestions((prev) => prev.filter((x) => x.styleKey !== style.styleKey));
        toast.show(t('admin.production.plannedToast', { defaultValue: 'Added to pipeline.' }));
        void loadKpis();
        setTab('planning');
      })
      .catch(() =>
        toast.show(
          t('admin.production.startFailed', { defaultValue: "Couldn't add to pipeline." }),
          'error',
        ),
      )
      .finally(() => setBusy(false));
  };

  const onRecordOutput = (items: { sku: string; qtyProduced: number }[], reason?: string) => {
    const target = outputTarget;
    if (!target) return;
    return runAction(async () => {
      const updated = await completeBatch(target.id, items, reason);
      setOutputTarget(null);
      return updated;
    });
  };

  const onSend = (
    items: StageQtyItem[],
    extra?: { tailorId?: number; fabricFeasible?: boolean },
  ) => {
    const target = sendTarget;
    if (!target) return;
    return runAction(async () => {
      const updated = await sendToProduction(target.id, items, extra);
      setSendTarget(null);
      // The batch just left Pipeline for the floor — follow it to the tab it's
      // now on (the send button only exists on Pipeline, so this always moves).
      setTab('in_production');
      return updated;
    });
  };

  // A stage move records how many pieces reached that stage. It does NOT touch
  // the plan — "planned 500, cut 480" has to survive the move.
  const onStageQty = (items: StageQtyItem[]) => {
    const tgt = stageTarget;
    if (!tgt) return;
    return runAction(async () => {
      const updated = await advanceBatch(tgt.batch.id, tgt.status, items);
      setStageTarget(null);
      return updated;
    });
  };

  // Several lots ship on one challan, so this is a multi-select. Sizes and
  // quantities are then picked inside the builder.
  const selectedBatches = useMemo(
    () => batches.filter((b) => selected.has(b.id)),
    [batches, selected],
  );
  // Count the lots actually on screen, not the raw id set — a lot that was
  // fully dispatched has left the tab, and the CTA must not offer to ship it.
  const selectedCount = selectedBatches.length;

  const toggleLot = (id: number) =>
    setSelected((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Header checkbox: every lot on screen that still has something to ship.
  const dispatchable = useMemo(() => batches.filter(hasRemaining), [batches]);
  const allSelected =
    dispatchable.length > 0 && dispatchable.every((b) => selected.has(b.id));
  const toggleAllLots = (on: boolean) =>
    setSelected(on ? new Set(dispatchable.map((b) => b.id)) : new Set());

  // Completed tab → challan. The one creation path; clears selection, refreshes
  // the board, and jumps to the Dispatches page where the challan now lives.
  const onCreateDispatch = (body: CreateDispatchBody) => {
    setBusy(true);
    createDispatch(body)
      .then(() => {
        setBuilderOpen(false);
        setSelected(new Set());
        toast.show(t('admin.production.dispatch.created', { defaultValue: 'Challan created.' }));
        void load(); // a fully-dispatched batch leaves the Completed tab
        void loadKpis();
        navigate('/admin/dispatches?tab=challans');
      })
      .catch(() =>
        toast.show(
          t('admin.production.dispatch.createFailed', { defaultValue: "Couldn't create the challan." }),
          'error',
        ),
      )
      .finally(() => setBusy(false));
  };

  // Park (Drop) or un-park (Restore) a style, removing the row in place.
  const setParked = async (styleKey: string, parked: boolean) => {
    setBusy(true);
    try {
      await (parked ? parkStyle(styleKey) : unparkStyle(styleKey));
      setSuggestions((prev) => prev.filter((x) => x.styleKey !== styleKey));
    } catch {
      toast.show(
        t('admin.production.parkFailed', { defaultValue: "Couldn't update this style." }),
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (styleKey: string) => setParked(styleKey, true);

  // Counts come off the board KPIs, which derive them from the same status
  // groups the tabs list — so a chip can't disagree with its tab. `to_start` is
  // served by /inventory-health and has no count.
  const tabs = useMemo(
    () => [
      {
        key: 'to_start' as const,
        label: t('admin.production.tabs.toStart', { defaultValue: 'Suggested' }),
      },
      {
        key: 'planning' as const,
        label: t('admin.production.tabs.planning', { defaultValue: 'Pipeline' }),
        count: tabCounts?.planning,
      },
      {
        key: 'in_production' as const,
        label: t('admin.production.tabs.inProduction', { defaultValue: 'Production' }),
        count: tabCounts?.in_production,
      },
      {
        key: 'completed' as const,
        label: t('admin.production.tabs.completed', { defaultValue: 'Completed' }),
        count: tabCounts?.completed,
      },
      {
        key: 'parked' as const,
        label: t('admin.production.tabs.parked', { defaultValue: 'Parked' }),
        count: tabCounts?.parked,
      },
    ],
    [t, tabCounts],
  );

  return (
    <div className="space-y-6">
      {/* Page header — title (left); filter rail + primary action (right),
          the same arrangement the sampling dashboard uses. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('admin.production.title', { defaultValue: 'Production pipeline' })}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          {/* Origin + start-date filter BATCHES (status does too, but its chips
              sit beside the search box). The Suggested and Parked tabs are served
              by /inventory-health instead, so the rail would be inert there — and
              a parked style is on hold indefinitely, which a date window would
              hide. */}
          {tab !== 'to_start' && tab !== 'parked' && (
            <FilterRail>
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as BatchOrigin | '')}
              className={RAIL_SELECT_CLASS}
              aria-label={t('admin.production.filterOrigin', { defaultValue: 'Origin' })}
            >
              <option value="">
                {t('admin.production.originAll', { defaultValue: 'Origin: All' })}
              </option>
              <option value="forecast">
                {t('admin.production.originForecast', { defaultValue: 'From forecast' })}
              </option>
              <option value="style">
                {t('admin.production.originStyle', { defaultValue: 'From style' })}
              </option>
            </select>
            <FilterRailDivider />
            {/* Start-date window — the same shared picker the dashboard and
                Inventory Health use, so the presets and behaviour match. */}
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              maxDate={daysAgoISO(0)}
              label={t('admin.production.startedWindow', { defaultValue: 'Started' })}
              onApply={(f, tt) => {
                setDateFrom(f);
                setDateTo(tt);
              }}
            />
            </FilterRail>
          )}
          {canWrite && (
            <Button size="sm" onClick={() => setIntakeOpen(true)}>
              <Factory size={14} />
              <span className="ml-1">
                {t('admin.production.startCta', { defaultValue: 'Start production' })}
              </span>
            </Button>
          )}
        </div>
      </header>

      <KpiRow kpis={kpis} onTab={setTab} />

      <QueueTabs tabs={tabs} active={tab} onSelect={setTab} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-primary)]"
          />
          <Input
            className="h-9 text-[13px] pl-9 pr-9 border-[var(--color-primary)]/40 bg-[var(--color-primary-soft)]/30 focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/25"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.production.searchPlaceholder', {
              defaultValue: 'Search styles, batches, or SKUs…',
            })}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t('common.clear', { defaultValue: 'Clear' })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {tab !== 'to_start' && tab !== 'parked' && (
          <FilterChips
            ariaLabel={t('admin.production.filterStatus', { defaultValue: 'Status' })}
            options={[
              ...(tab === 'completed'
                ? (['completed', 'dispatched'] as BatchStatus[])
                : ADVANCEABLE_STATUSES.filter((x) => x !== 'dispatched')),
              'cancelled' as BatchStatus,
            ].map((x) => ({ value: x, label: statusLabel(t, x) }))}
            value={statusFilter ? [statusFilter] : []}
            onToggle={(x) => setStatusFilter(statusFilter === x ? '' : x)}
            onClear={() => setStatusFilter('')}
            clearLabel={t('common.clear', { defaultValue: 'Clear' })}
          />
        )}
        {canWrite && tab === 'completed' && (
          <Button
            size="sm"
            className="ml-auto"
            disabled={busy || selectedCount === 0}
            onClick={() => setBuilderOpen(true)}
          >
            {t('admin.production.dispatch.dispatchN', {
              defaultValue: 'Dispatch ({{n}})',
              n: selectedCount,
            })}
          </Button>
        )}
      </div>

      {/* The batch table draws its own shimmer rows, shaped like its columns, so
          it takes `loading` rather than being swapped for a skeleton block. */}
      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-8 text-sm text-[var(--color-destructive)]">
          {t('admin.production.loadError', { defaultValue: "Couldn't load production data." })}
        </div>
      ) : tab === 'to_start' || tab === 'parked' ? (
        loading ? (
          <BoardSkeleton />
        ) : (
        <ToStartTable
          styles={suggestions}
          canWrite={canWrite}
          busy={busy}
          parked={tab === 'parked'}
          expanded={expandedStyles}
          onToggle={(k) => setExpandedStyles((p) => ({ ...p, [k]: !p[k] }))}
          onAddToPlanning={onAddToPlanning}
          onDrop={(style) => setDropTarget(style)}
          onRestore={(k) => void setParked(k, false)}
        />
        )
      ) : (
        <BatchTable
          loading={loading}
          rows={batches}
          tab={tab}
          canWrite={canWrite}
          canCancel={canCancel}
          busy={busy}
          selectable={canWrite && tab === 'completed'}
          selected={selected}
          allSelected={allSelected}
          onToggleLot={toggleLot}
          onToggleAll={toggleAllLots}
          onStage={(b, status) => {
            // Ask "how many?" on a FORWARD move into a stage that records a
            // quantity. Going back is a correction — the pieces did not travel
            // again, so a dialog there would seed forward-oriented numbers and
            // append them, double-counting work already recorded.
            if (STAGE_DONE[status] !== undefined && isForward(b.status, status)) {
              setStageTarget({ batch: b, status });
            } else {
              void runAction(() => advanceBatch(b.id, status));
            }
          }}
          onComplete={(b) => setOutputTarget(b)}
          onOpen={(b) => navigate(`/admin/production/lots/${b.id}`)}
          onSend={(b) => setSendTarget(b)}
          onCancel={(b) => setCancelTarget(b)}
          onAlterationReturn={(b) => setAlterTarget(b)}
        />
      )}

      {!loading && !error && loaded < total && (
        <div ref={sentinelRef} className="py-4 text-center text-sm text-[var(--color-muted-foreground)]">
          {loadMoreError ? (
            <Button variant="outline" size="sm" onClick={() => loadMoreRef.current()}>
              {t('admin.production.retry', { defaultValue: 'Retry' })}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              {t('admin.production.loadingMore', { defaultValue: 'Loading more…' })}
            </span>
          )}
        </div>
      )}

      <RecordOutputDialog
        open={outputTarget !== null}
        busy={busy}
        batch={outputTarget}
        onClose={() => setOutputTarget(null)}
        onConfirm={onRecordOutput}
      />
      {/* Pipeline → floor: records what went into cutting AND names the tailor,
          which is what gives the lot number its suffix. */}
      <StageQtyDialog
        open={sendTarget !== null}
        busy={busy}
        batch={sendTarget}
        stage="cutting"
        askTailor
        onClose={() => setSendTarget(null)}
        onConfirm={onSend}
      />
      <StageQtyDialog
        open={stageTarget !== null}
        busy={busy}
        batch={stageTarget?.batch ?? null}
        stage={stageTarget?.status ?? 'stitching'}
        onClose={() => setStageTarget(null)}
        onConfirm={onStageQty}
      />
      <StartProductionIntakeDialog
        open={intakeOpen}
        busy={busy}
        onClose={() => setIntakeOpen(false)}
        onConfirm={onStart}
      />
      <DispatchBuilderDialog
        open={builderOpen}
        busy={busy}
        batches={selectedBatches}
        onClose={() => setBuilderOpen(false)}
        onConfirm={onCreateDispatch}
      />
      <AlterationReturnDialog
        open={alterTarget !== null}
        busy={busy}
        batch={alterTarget}
        onClose={() => setAlterTarget(null)}
        onConfirm={(items: AlterationReturnItem[]) => {
          const target = alterTarget;
          setAlterTarget(null);
          if (target) void runAction(() => alterationReturn(target.id, items));
        }}
      />
      <CancelBatchDialog
        open={cancelTarget !== null}
        busy={busy}
        batch={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (target) void runAction(() => cancelBatch(target.id, reason));
        }}
      />
      <ConfirmDialog
        open={dropTarget !== null}
        title={t('admin.production.drop.title', { defaultValue: 'Drop this style?' })}
        message={t('admin.production.drop.message', {
          defaultValue:
            '{{name}} will be parked and removed from the suggested queue. Re-enable it from Inventory Health.',
          name: dropTarget?.erpStyleId ?? dropTarget?.styleKey ?? '',
        })}
        confirmLabel={t('admin.production.drop.confirm', { defaultValue: 'Drop' })}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        destructive
        onCancel={() => setDropTarget(null)}
        onConfirm={() => {
          const k = dropTarget?.styleKey;
          setDropTarget(null);
          if (k) void onDrop(k);
        }}
      />
    </div>
  );
}

/** Placeholder rows that mirror the table layout while a tab loads. */
function BoardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <Skeleton className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

function KpiRow({
  kpis,
  onTab,
}: {
  kpis: ProductionKpis | null;
  onTab: (tab: Tab) => void;
}) {
  const { t } = useTranslation();
  const dash = '\u2014';

  return (
    // Same card as the dashboard's summary row (shared SummaryCard) — production
    // numbers, sampling's design.
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <SummaryCard
        label={t('admin.production.kpi.planning', { defaultValue: 'In pipeline' })}
        value={kpis?.planningBatches ?? dash}
        onClick={() => onTab('planning')}
      />
      <SummaryCard
        label={t('admin.production.kpi.inProduction', { defaultValue: 'On the floor' })}
        value={kpis?.inProductionBatches ?? dash}
        onClick={() => onTab('in_production')}
      />
      <SummaryCard
        label={t('admin.production.kpi.stylesInPipeline', { defaultValue: 'Styles in flight' })}
        value={kpis?.stylesInPipeline ?? dash}
        breakdown={
          kpis
            ? [
                {
                  label: t('admin.production.kpi.originForecast', { defaultValue: 'Forecast' }),
                  value: kpis.stylesByOrigin.forecast,
                },
                {
                  label: t('admin.production.kpi.originStyle', { defaultValue: 'Style' }),
                  value: kpis.stylesByOrigin.style,
                },
                {
                  label: t('admin.production.kpi.originExternal', { defaultValue: 'External' }),
                  value: kpis.stylesByOrigin.external,
                },
              ]
            : undefined
        }
        onClick={() => onTab('in_production')}
      />
      <SummaryCard
        label={t('admin.production.kpi.stalled', { defaultValue: 'Stalled 7d+' })}
        value={kpis?.stalledBatches ?? dash}
        breakdown={
          kpis && kpis.stalledOldestDays != null
            ? [
                {
                  label: t('admin.production.kpi.oldest', { defaultValue: 'Oldest' }),
                  value: `${kpis.stalledOldestDays}d`,
                },
              ]
            : undefined
        }
        onClick={() => onTab('in_production')}
      />
      <SummaryCard
        label={t('admin.production.kpi.dueToDispatch', { defaultValue: 'Due to dispatch' })}
        value={kpis?.dueToDispatchBatches ?? dash}
        breakdown={
          kpis
            ? [
                {
                  label: t('admin.production.kpi.unitsToShip', { defaultValue: 'Units' }),
                  value: kpis.dueToDispatchUnits.toLocaleString(),
                },
              ]
            : undefined
        }
        onClick={() => onTab('completed')}
      />
    </div>
  );
}

function ToStartTable({
  styles,
  canWrite,
  busy,
  parked,
  expanded,
  onToggle,
  onAddToPlanning,
  onDrop,
  onRestore,
}: {
  styles: InventoryStyle[];
  canWrite: boolean;
  busy: boolean;
  parked?: boolean;
  expanded: Record<string, boolean>;
  onToggle: (styleKey: string) => void;
  onAddToPlanning: (style: InventoryStyle) => void;
  onDrop: (style: InventoryStyle) => void;
  onRestore?: (styleKey: string) => void;
}) {
  const { t } = useTranslation();
  const head =
    'text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]';
  // Even data columns (equal fr) with a bounded Style column; the action column
  // is content-sized. gap-6 before nothing extra — actions get their own left
  // padding so the red Cover isn't crowding the button.
  const ROW =
    'grid grid-cols-[22px_40px_minmax(220px,1.6fr)_1fr_1fr_1fr_1fr_1fr_264px] items-center gap-5 px-4 min-w-[1080px]';

  if (styles.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
        {t('admin.production.toStartEmpty', {
          defaultValue: 'Nothing needs making \u2014 every size has enough cover.',
        })}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header row \u2014 names every column below. */}
      <div className={`${ROW} border-b border-[var(--color-border)] bg-[var(--color-surface-2)] py-2.5`}>
        <span />
        <span />
        <span className={head}>{t('admin.production.style', { defaultValue: 'Style' })}</span>
        <span className={head}>{t('admin.production.sizes', { defaultValue: 'Sizes' })}</span>
        <span className={`text-right ${head}`}>{t('admin.production.stock', { defaultValue: 'Stock' })}</span>
        <span className={`text-right ${head}`}>{t('admin.production.drr', { defaultValue: 'DRR/d' })}</span>
        <span className={`text-right ${head}`}>{t('admin.production.toMake', { defaultValue: 'To make' })}</span>
        <span className={`text-right ${head}`}>{t('admin.production.cover', { defaultValue: 'Cover' })}</span>
        <span />
      </div>

      {styles.map((s) => {
        const needing = s.sizes.filter((z) => z.makeQty > 0);
        const covers = s.sizes.map((z) => z.coverDays).filter((c): c is number => c != null);
        const totalStock = s.sizes.reduce((a, z) => a + z.currentStock, 0);
        const totalDrr = s.sizes.reduce((a, z) => a + z.drr, 0);
        const isOpen = !!expanded[s.styleKey];
        return (
          <div key={s.styleKey} className="border-b border-[var(--color-border)] last:border-b-0">
            {/* Whole row toggles the breakdown; the CTA stops propagation. */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => onToggle(s.styleKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle(s.styleKey);
                }
              }}
              className={`${ROW} cursor-pointer py-3 hover:bg-[var(--color-surface-2)]/50`}
            >
              <ChevronRight
                size={16}
                className={`w-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
              <HoverThumbnail src={s.imageUrl} alt={s.name ?? s.styleKey} size={40} />
              <div className="min-w-0">
                <div className="mb-0.5">
                  <UrgencyPill urgency={s.worstUrgency} />
                </div>
                <TruncText text={s.erpStyleId ?? s.styleKey} className="text-sm font-semibold" />
                {meaningfulName(s) && (
                  <TruncText
                    text={meaningfulName(s)!}
                    className="font-mono text-[11px] text-[var(--color-muted-foreground)]"
                  />
                )}
              </div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                {t('admin.production.sizesNeeding', {
                  defaultValue: '{{n}} of {{total}} sizes',
                  n: needing.length,
                  total: s.sizes.length,
                })}
              </div>
              <div className="text-right text-sm">{totalStock}</div>
              <div className="text-right text-sm text-[var(--color-muted-foreground)]">
                {totalDrr.toFixed(1)}
              </div>
              <div className="text-right text-base font-bold">{s.makeTotal}</div>
              <div
                className={`text-right text-sm font-semibold ${coverTone(covers.length > 0 ? Math.min(...covers) : null)}`}
              >
                {covers.length > 0 ? `${Math.min(...covers).toFixed(1)}d` : '\u2014'}
              </div>
              <div className="flex items-center justify-end gap-2 pl-2">
                {canWrite && parked && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestore?.(s.styleKey);
                    }}
                  >
                    {t('admin.production.restore', { defaultValue: 'Restore' })}
                  </Button>
                )}
                {canWrite && !parked && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToPlanning(s);
                      }}
                    >
                      {t('admin.production.addToPlanning', {
                        defaultValue: 'Add to pipeline',
                      })}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDrop(s);
                      }}
                    >
                      {t('admin.production.drop', { defaultValue: 'Drop' })}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3 pl-14">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className={head}>
                      <th className="py-1.5 text-left">{t('admin.production.size', { defaultValue: 'Size' })}</th>
                      <th className="py-1.5 text-left">SKU</th>
                      <th className="py-1.5 text-right">{t('admin.production.suggested', { defaultValue: 'Suggested' })}</th>
                      <th className="py-1.5 text-right">{t('admin.production.cover', { defaultValue: 'Cover' })}</th>
                      <th className="py-1.5 text-right">{t('admin.production.stock', { defaultValue: 'Stock' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Only the sizes that need making \u2014 not every SKU on the style. */}
                    {needing.map((z) => (
                      <tr key={z.sku} className="border-t border-[var(--color-border)]/50">
                        <td className="py-1.5 font-semibold">{z.size}</td>
                        <td className="py-1.5 font-mono text-xs text-[var(--color-muted-foreground)]">{z.sku}</td>
                        <td className="py-1.5 text-right font-semibold">{z.makeQty}</td>
                        <td className={`py-1.5 text-right font-semibold ${coverTone(z.coverDays)}`}>
                          {z.coverDays != null ? `${z.coverDays.toFixed(1)}d` : '\u2014'}
                        </td>
                        <td className="py-1.5 text-right text-[var(--color-muted-foreground)]">{z.currentStock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


/** Stop a click on an interactive cell from also opening the lot page. */
const stopRowClick = (e: React.MouseEvent) => e.stopPropagation();

/**
 * The production board, on the shared queue-table chrome the Sampling registry
 * uses — same card, sticky header, dense rows and action cluster, so the two
 * surfaces read as one app.
 *
 * Flat by design: the lot page is the detail view, and dispatch sizes are
 * chosen in the challan builder, so no row expands here.
 */
function BatchTable({
  rows,
  tab,
  canWrite,
  canCancel,
  busy,
  loading,
  selectable = false,
  selected,
  allSelected = false,
  onToggleLot,
  onToggleAll,
  onStage,
  onSend,
  onCancel,
  onComplete,
  onOpen,
  onAlterationReturn,
}: {
  rows: ProductionBatch[];
  tab: Tab;
  canWrite: boolean;
  canCancel: boolean;
  busy: boolean;
  loading?: boolean;
  /** Completed tab only: per-LOT checkboxes picking what goes on a challan. */
  selectable?: boolean;
  selected?: Set<number>;
  allSelected?: boolean;
  onToggleLot?: (id: number) => void;
  onToggleAll?: (on: boolean) => void;
  onStage: (batch: ProductionBatch, status: BatchStatus) => void;
  onSend: (batch: ProductionBatch) => void;
  onCancel: (batch: ProductionBatch) => void;
  /** Closes the lot: records produced-per-size and asks why if it's short. */
  onComplete?: (batch: ProductionBatch) => void;
  /** Opens the lot's own page. */
  onOpen?: (batch: ProductionBatch) => void;
  /** Fired by the "N in alteration" chip — records pieces coming back. */
  onAlterationReturn?: (batch: ProductionBatch) => void;
}) {
  const { t } = useTranslation();

  const columns = useMemo<QueueColumn<ProductionBatch>[]>(() => {
    const cols: QueueColumn<ProductionBatch>[] = [];

    if (selectable) {
      cols.push({
        key: 'pick',
        width: '40px',
        header: (
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-primary)]"
            checked={allSelected}
            disabled={busy}
            onChange={() => onToggleAll?.(!allSelected)}
            aria-label={t('admin.production.dispatch.selectAll', {
              defaultValue: 'Select all lots',
            })}
          />
        ),
        cell: (b) =>
          // A fully-shipped lot has nothing left to put on a challan.
          remainingToDispatch(b) > 0 ? (
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={selected?.has(b.id) ?? false}
              disabled={busy}
              onClick={stopRowClick}
              onChange={() => onToggleLot?.(b.id)}
              aria-label={t('admin.production.dispatch.selectLot', {
                defaultValue: 'Select lot {{lot}} for dispatch',
                lot: b.batchNo,
              })}
            />
          ) : null,
      });
    }

    // Own column at the sampling table's footprint (80px thumb + cell padding),
    // so a production row reads at the same rhythm as a sampling row.
    cols.push({
      key: 'img',
      width: '116px',
      header: t('admin.production.img', { defaultValue: 'Img' }),
      cell: (b) => (
        <HoverThumbnail
          src={b.imageUrl}
          alt={
            b.styleRef ??
            b.styleKey ??
            t('admin.production.untitled', { defaultValue: 'Untitled style' })
          }
        />
      ),
    });

    cols.push({
      key: 'style',
      width: '210px',
      header: t('admin.production.style', { defaultValue: 'Style' }),
      cell: (b) => {
        const nm = cleanName(
          b.name,
          b.styleKey,
          b.sizes.map((z) => z.sku),
        );
        const label =
          b.styleRef ??
          b.styleKey ??
          t('admin.production.untitled', { defaultValue: 'Untitled style' });
        return (
          // No thumbnail — the IMG column owns that, as in the sampling table.
          <div className="min-w-0">
            {/* Primary-coloured like the sampling table's style link, so the
                row reads as leading somewhere. */}
            <button
              type="button"
              title={label}
              onClick={(e) => {
                e.stopPropagation();
                onOpen?.(b);
              }}
              // Same type as the sampling table's StyleRefLink — mono 13px
              // primary. A batch has no Style row, so the classes are matched
              // rather than the component reused.
              className="block max-w-full truncate text-left font-mono text-[13px] text-[var(--color-primary)] hover:underline"
            >
              {label}
            </button>
            {nm && <TruncText text={nm} className="text-[var(--color-foreground)]" />}
            {b.colourName && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                  style={{ background: b.colourHex ?? b.colourName.toLowerCase() }}
                />
                {b.colourName}
              </span>
            )}
          </div>
        );
      },
    });

    cols.push({
      key: 'lot',
      width: '130px',
      header: t('admin.production.lot', { defaultValue: 'Lot' }),
      cell: (b) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px]">{b.batchNo}</div>
          {b.tailorName && (
            <div className="truncate text-[11px] text-[var(--color-muted-foreground)]">
              {b.tailorName}
            </div>
          )}
        </div>
      ),
    });

    cols.push({
      key: 'sizes',
      width: '180px',
      header: t('admin.production.sizes', { defaultValue: 'Sizes' }),
      cell: (b) => (
        // Circular chips: the size ladder at a glance, quantity one hover away.
        // A rectangular "S 100" chip cost ~50px each and broke the column.
        <div className="flex flex-wrap items-center gap-1">
          {b.sizes.slice(0, 5).map((s) => (
            <HoverTip
              key={s.sku}
              content={
                <span className="whitespace-nowrap">
                  {s.size} · {s.qtyPlanned}
                </span>
              }
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[10px] font-semibold text-[var(--color-foreground)]">
                {s.size}
              </span>
            </HoverTip>
          ))}
          {b.sizes.length > 5 && (
            <HoverTip
              content={
                <span className="whitespace-nowrap">
                  {b.sizes
                    .slice(5)
                    .map((s) => `${s.size} · ${s.qtyPlanned}`)
                    .join(', ')}
                </span>
              }
            >
              <span className="text-[11px] text-[var(--color-muted-foreground)]">
                +{b.sizes.length - 5}
              </span>
            </HoverTip>
          )}
        </div>
      ),
    });

    cols.push({
      key: 'planned',
      width: '80px',
      align: 'right',
      header: t('admin.production.planned', { defaultValue: 'Planned' }),
      cell: (b) => <span className="font-semibold">{b.qtyPlanned}</span>,
    });

    cols.push({
      key: 'atStage',
      width: '96px',
      align: 'right',
      header:
        tab === 'completed'
          ? t('admin.production.produced', { defaultValue: 'Produced' })
          : t('admin.production.atStage', { defaultValue: 'At stage' }),
      cell: (b) => {
        if (tab === 'completed') return b.qtyProduced ?? '—';
        // "—" while the lot is still in Planning, and for lots that ran before
        // stage entries existed — there is nothing recorded to show.
        const at = stageTotal(b);
        if (!at) return <span className="text-[var(--color-muted-foreground)]">—</span>;
        return (
          <>
            <span className="font-semibold">{at.qty}</span>
            <div className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
              {t(`admin.production.stageDone.${b.status}`, { defaultValue: at.label })}
            </div>
          </>
        );
      },
    });

    cols.push({
      key: 'stage',
      width: '130px',
      header: t('admin.production.stage', { defaultValue: 'Stage' }),
      cell: (b) =>
        canWrite && tab === 'in_production' ? (
          <select
            value={b.status}
            disabled={busy}
            onClick={stopRowClick}
            onChange={(e) => onStage(b, e.target.value as BatchStatus)}
            className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {/* Sourced from ADVANCEABLE_STATUSES rather than a literal list, so
                the dropdown and the server's accepted set can't drift. */}
            {ADVANCEABLE_STATUSES.filter((s) => s !== 'dispatched').map((s) => (
              <option key={s} value={s}>
                {statusLabel(t, s)}
              </option>
            ))}
          </select>
        ) : (
          <Badge variant="outline">{statusLabel(t, b.status)}</Badge>
        ),
    });

    // "N in alteration" — the signal and the action are the same object: the
    // number telling you work is outstanding IS the button that clears it, so
    // there is nothing to hunt for. Only rendered while something is out.
    cols.push({
      key: 'alteration',
      width: '132px',
      header: t('admin.production.alteration', { defaultValue: 'Alteration' }),
      cell: (b) => {
        const out = outstandingAlteration(b);
        if (out === 0) return <span className="text-[var(--color-muted-foreground)]">—</span>;
        if (!canWrite || !onAlterationReturn) {
          return (
            <Badge variant="rework">
              {t('admin.production.alterationOut', { defaultValue: '{{n}} out', n: out })}
            </Badge>
          );
        }
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAlterationReturn(b);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100"
          >
            <Undo2 size={12} />
            {t('admin.production.alterationOut', { defaultValue: '{{n}} out', n: out })}
          </button>
        );
      },
    });

    cols.push({
      key: 'age',
      width: '82px',
      header: t('admin.production.inStatus', { defaultValue: 'In status' }),
      cell: (b) => <span className={ageTone(b.daysInStatus)}>{b.daysInStatus}d</span>,
    });

    cols.push({
      key: 'started',
      width: '116px',
      header: t('admin.production.started', { defaultValue: 'Started' }),
      cell: (b) => (
        <div className="min-w-0">
          <div className="truncate">{fmtDate(b.startedAt)}</div>
          <div className="truncate text-[11px] text-[var(--color-muted-foreground)]">
            {b.createdBy?.name ?? '—'}
          </div>
        </div>
      ),
    });

    return cols;
  }, [
    t,
    tab,
    canWrite,
    busy,
    selectable,
    selected,
    allSelected,
    onToggleLot,
    onToggleAll,
    onStage,
    onOpen,
  ]);

  return (
    <StyleQueueTable<ProductionBatch>
      columns={columns}
      rows={rows}
      getRowKey={(b) => b.id}
      loading={loading}
      loadingLabel={t('common.loading', { defaultValue: 'Loading…' })}
      emptyLabel={t('admin.production.empty', { defaultValue: 'No batches here yet.' })}
      onRowClick={onOpen}
      actionsWidth="200px"
      renderActions={(b) => (
        <span className="flex items-center gap-2" onClick={stopRowClick}>
          {canWrite && tab === 'planning' && (
            <Button size="sm" disabled={busy} onClick={() => onSend(b)}>
              {t('admin.production.sendToProduction', { defaultValue: 'Send to production' })}
            </Button>
          )}
          {/* Closing the lot is a deliberate click, never a side effect of
              reaching finishing — 10 of 14 made keeps the lot open. */}
          {canWrite && tab === 'in_production' && (
            <Button size="sm" disabled={busy} onClick={() => onComplete?.(b)}>
              {t('admin.production.completeCta', { defaultValue: 'Complete' })}
            </Button>
          )}
          {/* A completed batch is done — nothing to cancel — so it's hidden there. */}
          {canCancel && b.status !== 'dispatched' && b.status !== 'completed' && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => onCancel(b)}>
              {t('admin.production.cancelCta', { defaultValue: 'Cancel' })}
            </Button>
          )}
        </span>
      )}
    />
  );
}
