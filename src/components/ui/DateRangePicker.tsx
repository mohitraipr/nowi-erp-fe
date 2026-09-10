import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { DayPicker, type DateRange } from 'react-day-picker';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Polished date-range picker for the dashboard activity window. Replaces the
 * two native `<input type="date">` + reset button with one trigger + popover:
 * a presets sidebar (Today / Yesterday / Last 7·30·90 days / This year / This
 * financial year) and a dual-month react-day-picker range calendar.
 * AUTO-APPLIES: a preset click, or the second click that completes a range,
 * commits and closes — there is no Apply button.
 *
 * OUTPUT CONTRACT: the parent owns `from`/`to` as LOCAL `YYYY-MM-DD` strings
 * (the same shape the dashboard cards + styles table consume). This component
 * never reaches `toISOString()` — every conversion goes through the local
 * `toLocalISO` / `fromLocalISO` helpers below, so an IST user in the small
 * hours never has "today" shift to yesterday (the bug `isoDaysAgo` guards).
 */

// ── Local-zone date helpers (NEVER toISOString — that formats in UTC) ──

/** `Date` → LOCAL `YYYY-MM-DD`, built from local Y/M/D parts. */
function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** LOCAL `YYYY-MM-DD` → a `Date` at local midnight (no UTC parsing). */
function fromLocalISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today at local midnight. */
function localToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** A local-midnight `Date` `n` days before today (0 = today). */
function daysAgo(n: number): Date {
  const d = localToday();
  d.setDate(d.getDate() - n);
  return d;
}

/**
 * India financial-year start (Apr 1) for the FY that contains `ref`. Months are
 * 0-indexed, so Jan–Mar (0–2) belong to the FY that began the previous calendar
 * year; Apr onward (3–11) to the current one.
 */
function indiaFyStart(ref: Date): Date {
  const y = ref.getMonth() < 3 ? ref.getFullYear() - 1 : ref.getFullYear();
  return new Date(y, 3, 1);
}

export interface PresetRange {
  key: string;
  label: string;
  /** Inclusive local-midnight bounds. */
  from: Date;
  to: Date;
}

/** Build the presets fresh on each open so "today" tracks the wall clock. */
/**
 * Range floor for the "All time" preset — predates all data. The single
 * definition: pages seeding an all-time default import THIS rather than
 * re-typing the date, so the preset and the default can never disagree (a
 * mismatch would show a custom range label instead of "All time").
 */
export const ALL_TIME_FROM_ISO = '2000-01-01';

function buildPresets(t: ReturnType<typeof useTranslation>['t']): PresetRange[] {
  const today = localToday();
  return [
    {
      // A floor low enough to predate every record, so "All time" is expressible
      // as a RANGE — the control (and every server filter behind it) only speaks
      // from/to, and a null window would need a second code path everywhere.
      key: 'allTime',
      label: t('dashboard.dateFilter.presets.allTime', { defaultValue: 'All time' }),
      from: fromLocalISO(ALL_TIME_FROM_ISO),
      to: today,
    },
    {
      key: 'today',
      label: t('dashboard.dateFilter.presets.today', { defaultValue: 'Today' }),
      from: today,
      to: today,
    },
    {
      key: 'yesterday',
      label: t('dashboard.dateFilter.presets.yesterday', {
        defaultValue: 'Yesterday',
      }),
      from: daysAgo(1),
      to: daysAgo(1),
    },
    {
      key: 'last7',
      label: t('dashboard.dateFilter.presets.last7', {
        defaultValue: 'Last 7 days',
      }),
      from: daysAgo(6),
      to: today,
    },
    {
      key: 'last30',
      label: t('dashboard.dateFilter.presets.last30', {
        defaultValue: 'Last 30 days',
      }),
      from: daysAgo(29),
      to: today,
    },
    {
      key: 'last90',
      label: t('dashboard.dateFilter.presets.last90', {
        defaultValue: 'Last 90 days',
      }),
      from: daysAgo(89),
      to: today,
    },
    {
      key: 'thisYear',
      label: t('dashboard.dateFilter.presets.thisYear', {
        defaultValue: 'This year',
      }),
      from: new Date(today.getFullYear(), 0, 1),
      to: today,
    },
    {
      key: 'thisFy',
      label: t('dashboard.dateFilter.presets.thisFy', {
        defaultValue: 'This financial year',
      }),
      from: indiaFyStart(today),
      to: today,
    },
  ];
}

/** Short, locale-agnostic "Jun 5" style label for the trigger / range. */
function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Props {
  /** Current committed range — LOCAL `YYYY-MM-DD` strings. */
  from: string;
  to: string;
  /** Commit a new range. Both args are LOCAL `YYYY-MM-DD` strings. */
  onApply: (from: string, to: string) => void;
  /** Upper bound for selectable days (LOCAL `YYYY-MM-DD`). Defaults to today. */
  maxDate?: string;
  /** Optional muted prefix shown before the range on the trigger (e.g.
   *  "Updated") so it reads as a labelled FILTER, not a bare date. */
  label?: string;
  className?: string;
}

export function DateRangePicker({
  from,
  to,
  onApply,
  maxDate,
  label,
  className,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Draft selection lives only while the popover is open; Apply commits it,
  // Cancel discards it. Seed from the committed props each time we open.
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  // Rebuild presets on each open so "today"-relative ranges stay current.
  const presets = useMemo(() => buildPresets(t), [t, open]);
  const maxDay = useMemo(
    () => (maxDate ? fromLocalISO(maxDate) : localToday()),
    [maxDate],
  );

  const committedFrom = useMemo(() => fromLocalISO(from), [from]);
  const committedTo = useMemo(() => fromLocalISO(to), [to]);

  // Which preset (if any) the committed range exactly matches → drives the
  // trigger label ("Last 7 days" reads better than "Jun 5 – Jun 11").
  const matchedPreset = useMemo(
    () =>
      presets.find(
        (p) => toLocalISO(p.from) === from && toLocalISO(p.to) === to,
      ) ?? null,
    [presets, from, to],
  );

  const triggerLabel = matchedPreset
    ? matchedPreset.label
    : from === to
      ? fmtShort(committedFrom)
      : `${fmtShort(committedFrom)} – ${fmtShort(committedTo)}`;

  const openPopover = useCallback(() => {
    setDraft({ from: committedFrom, to: committedTo });
    setOpen(true);
  }, [committedFrom, committedTo]);

  const close = useCallback(() => setOpen(false), []);

  // Outside click → close (discard). The popover is portalled to <body>, so a
  // click inside it isn't inside rootRef — check the portal node explicitly.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (!rootRef.current?.contains(node) && !popRef.current?.contains(node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  // Esc → close (discard).
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, close]);

  // Position the portalled popover under the trigger, then CLAMP it into the
  // viewport so the wide dual-month panel can't run off the right edge (or the
  // bottom). useLayoutEffect + the ungated portal below means popRef is mounted
  // and measurable on the first pass, so we clamp before paint (no flash). We
  // re-run on scroll/resize to keep it anchored.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const M = 8; // viewport margin
      const w = popRef.current?.offsetWidth ?? 0;
      const h = popRef.current?.offsetHeight ?? 0;
      // Anchor the left edge to the trigger, then pull it back in if the panel
      // would overflow the right edge; never let it cross the left margin.
      let left = r.left;
      if (w) left = Math.min(left, window.innerWidth - w - M);
      left = Math.max(M, left);
      // Open below the trigger; if that overflows the bottom, flip above when
      // it fits, else pin to the bottom margin.
      let top = r.bottom + 6;
      if (h && top + h > window.innerHeight - M) {
        const above = r.top - 6 - h;
        top = above >= M ? above : Math.max(M, window.innerHeight - h - M);
      }
      setRect({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  /** Commit a complete range and close. The picker auto-applies — there is no
   *  Apply button — so every path that produces a full range routes through here. */
  const commit = useCallback(
    (f: Date, tEnd: Date) => {
      onApply(toLocalISO(f), toLocalISO(tEnd));
      close();
    },
    [onApply, close],
  );

  const applyPreset = useCallback(
    (p: PresetRange) => {
      setDraft({ from: p.from, to: p.to });
      commit(p.from, p.to);
    },
    [commit],
  );

  // Google-style range selection — deterministic two-click cycle, so a click
  // can always start a fresh range (change the start date), which react-day-
  // picker's default range mode doesn't reliably allow:
  //   • a start is set but no end yet  → this click sets the END
  //     (clicking before the start swaps them so the range stays valid);
  //   • no selection OR a complete range → this click starts a NEW range at
  //     the clicked day and clears the end. The next click sets the end.
  // We ignore rdp's proposed `range` and drive the draft ourselves.
  const handleRangeSelect = useCallback(
    (_range: DateRange | undefined, clickedDay: Date) => {
      // Decide from the CURRENT draft, never inside a setDraft updater: React
      // may replay updaters (StrictMode invokes them twice), and committing in
      // there fires the parent's state update + refetch mid-render — the double
      // apply and the cross-component update warning that comes with it.
      if (draft?.from && !draft.to) {
        // Second click completes the range → apply straight away. Applying on
        // the FIRST click would fire a request for a half-picked window.
        const next =
          clickedDay.getTime() >= draft.from.getTime()
            ? { from: draft.from, to: clickedDay }
            : { from: clickedDay, to: draft.from };
        setDraft(next);
        commit(next.from, next.to);
        return;
      }
      setDraft({ from: clickedDay, to: undefined });
    },
    [draft, commit],
  );

  // Default the calendar to show the month containing the draft's end (or
  // start), so reopening lands on the active range rather than today.
  const defaultMonth = draft?.to ?? draft?.from ?? committedTo;

  const dayBase =
    'h-9 w-9 rounded-[var(--radius-sm)] text-[13px] text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors';

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => (open ? close() : openPopover())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors',
          open
            ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-primary)]',
        )}
      >
        <CalendarDays
          size={15}
          className="text-[var(--color-muted-foreground)]"
        />
        {label && (
          <span className="font-medium text-[var(--color-muted-foreground)]">
            {label}:
          </span>
        )}
        <span className="tabular-nums">{triggerLabel}</span>
        <ChevronDown
          size={14}
          className="text-[var(--color-muted-foreground)]"
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={t('dashboard.dateFilter.ariaLabel', {
              defaultValue: 'Select date range',
            })}
            // Mounted as soon as it's open (so the clamp effect can measure it),
            // but kept invisible until `rect` is computed to avoid a one-frame
            // flash at the unclamped top-left.
            style={{
              position: 'fixed',
              top: rect?.top ?? 0,
              left: rect?.left ?? 0,
              visibility: rect ? 'visible' : 'hidden',
            }}
            className="z-50 flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
          >
            <div className="flex flex-col sm:flex-row">
              {/* Presets sidebar */}
              <div className="flex shrink-0 flex-col gap-0.5 border-b border-[var(--color-border)] p-2 sm:w-44 sm:border-b-0 sm:border-r">
                {presets.map((p) => {
                  const active =
                    draft?.from &&
                    draft?.to &&
                    toLocalISO(draft.from) === toLocalISO(p.from) &&
                    toLocalISO(draft.to) === toLocalISO(p.to);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={cn(
                        'rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] transition-colors',
                        active
                          ? 'bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]'
                          : 'text-[var(--color-foreground-2)] hover:bg-[var(--color-muted)]',
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Dual-month range calendar */}
              <div className="p-3">
                <DayPicker
                  mode="range"
                  numberOfMonths={2}
                  selected={draft}
                  onSelect={handleRangeSelect}
                  defaultMonth={defaultMonth}
                  disabled={{ after: maxDay }}
                  classNames={{
                    // `relative` so the absolutely-positioned nav arrows below
                    // scope to the calendar area — not the whole popover (which
                    // put the left arrow on top of the presets sidebar).
                    root: 'relative',
                    months: 'flex flex-col gap-4 sm:flex-row',
                    month: 'space-y-2',
                    month_caption:
                      'flex h-8 items-center justify-center px-8 text-[13px] font-medium text-[var(--color-foreground)]',
                    caption_label: 'tabular-nums',
                    nav: 'absolute inset-x-0 top-0 flex items-center justify-between px-1',
                    button_previous:
                      'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:pointer-events-none disabled:opacity-30',
                    button_next:
                      'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:pointer-events-none disabled:opacity-30',
                    month_grid: 'border-collapse',
                    weekdays: 'flex',
                    weekday:
                      'flex h-8 w-9 items-center justify-center text-[11px] font-medium text-[var(--color-muted-foreground)]',
                    week: 'flex',
                    // Fixed cell size so the LEADING empty cells (outside days,
                    // rendered without a button when showOutsideDays is off) still
                    // occupy their column under `week: flex` — otherwise they
                    // collapse to 0 width and the month's days pack left, landing
                    // under the wrong weekday (e.g. the 1st shown as Sunday).
                    day: 'h-9 w-9 p-0',
                    day_button: dayBase,
                    today:
                      '[&_button]:font-semibold [&_button]:text-[var(--color-primary)]',
                    outside:
                      '[&_button]:text-[var(--color-muted-foreground-2)]',
                    // A range with only `from` picked (no `to` yet) gets ONLY
                    // the `selected` modifier — rdp sets range_start/_end just
                    // once BOTH ends exist — so without this the first click
                    // showed no fill. Interior days are also `selected`, so
                    // range_middle below re-overrides them (with `!`).
                    selected:
                      '[&_button]:bg-[var(--color-primary)] [&_button]:text-[var(--color-primary-foreground)] [&_button:hover]:bg-[var(--color-primary)]',
                    range_start:
                      'rounded-l-[var(--radius-sm)] [&_button]:bg-[var(--color-primary)] [&_button]:text-[var(--color-primary-foreground)] [&_button:hover]:bg-[var(--color-primary)]',
                    range_end:
                      'rounded-r-[var(--radius-sm)] [&_button]:bg-[var(--color-primary)] [&_button]:text-[var(--color-primary-foreground)] [&_button:hover]:bg-[var(--color-primary)]',
                    range_middle:
                      'bg-[var(--color-primary-soft)] [&_button]:rounded-none [&_button]:bg-transparent! [&_button]:text-[var(--color-primary)]! [&_button:hover]:bg-[var(--color-primary-soft)]!',
                    disabled:
                      '[&_button]:pointer-events-none [&_button]:opacity-30',
                  }}
                />
              </div>
            </div>

          </div>,
          document.body,
        )}
    </div>
  );
}
