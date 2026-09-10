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
import { DayPicker } from 'react-day-picker';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Polished SINGLE-date picker — the one-date sibling of {@link DateRangePicker},
 * matching its trigger pill + portalled/clamped popover so the two read as one
 * design system. Presets are Today / Yesterday; the calendar is a single month.
 *
 * OUTPUT CONTRACT: the parent owns `value` as a LOCAL `YYYY-MM-DD` string. This
 * component never reaches `toISOString()` — every conversion goes through the
 * local `toLocalISO` / `fromLocalISO` helpers, so an IST user in the small hours
 * never has "today" shift to yesterday.
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

interface PresetDate {
  key: string;
  label: string;
  date: Date;
}

/** Build the presets fresh on each open so "today"/"yesterday" track the clock. */
function buildPresets(t: ReturnType<typeof useTranslation>['t']): PresetDate[] {
  return [
    {
      key: 'today',
      label: t('common.today', { defaultValue: 'Today' }),
      date: localToday(),
    },
    {
      key: 'yesterday',
      label: t('common.yesterday', { defaultValue: 'Yesterday' }),
      date: daysAgo(1),
    },
  ];
}

/** Short, locale-agnostic "Jun 5" style label for the trigger. */
function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Props {
  /** Current committed date — a LOCAL `YYYY-MM-DD` string. */
  value: string;
  /** Commit a new date — a LOCAL `YYYY-MM-DD` string. */
  onChange: (date: string) => void;
  /** Upper bound for selectable days (LOCAL `YYYY-MM-DD`). Defaults to today. */
  maxDate?: string;
  /** Lower bound for selectable days (LOCAL `YYYY-MM-DD`). Omit for no floor. */
  minDate?: string;
  /** Optional muted prefix shown before the date on the trigger (e.g. "As of")
   *  so it reads as a labelled FILTER, not a bare date. */
  label?: string;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  maxDate,
  minDate,
  label,
  className,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Draft selection lives only while the popover is open; Apply commits it,
  // Cancel discards it. Seed from the committed prop each time we open.
  const [draft, setDraft] = useState<Date | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  // Rebuild presets on each open so "today"-relative dates stay current.
  const presets = useMemo(() => buildPresets(t), [t, open]);
  const maxDay = useMemo(
    () => (maxDate ? fromLocalISO(maxDate) : localToday()),
    [maxDate],
  );
  const minDay = useMemo(() => (minDate ? fromLocalISO(minDate) : null), [minDate]);
  /** Out-of-range test shared by the calendar and the preset list, so a preset
   *  can't commit a day the calendar greys out. */
  const outOfRange = useCallback(
    (d: Date): boolean => d > maxDay || (minDay ? d < minDay : false),
    [maxDay, minDay],
  );

  const committed = useMemo(() => fromLocalISO(value), [value]);

  // Which preset (if any) the committed date matches → drives the trigger label
  // ("Yesterday" reads better than "Jun 5").
  const matchedPreset = useMemo(
    () => presets.find((p) => toLocalISO(p.date) === value) ?? null,
    [presets, value],
  );

  const triggerLabel = matchedPreset ? matchedPreset.label : fmtShort(committed);

  const openPopover = useCallback(() => {
    setDraft(committed);
    setOpen(true);
  }, [committed]);

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
  // viewport so the panel can't run off the right edge (or the bottom).
  // useLayoutEffect + the ungated portal below means popRef is mounted and
  // measurable on the first pass, so we clamp before paint (no flash). We re-run
  // on scroll/resize to keep it anchored.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const M = 8; // viewport margin
      const w = popRef.current?.offsetWidth ?? 0;
      const h = popRef.current?.offsetHeight ?? 0;
      let left = r.left;
      if (w) left = Math.min(left, window.innerWidth - w - M);
      left = Math.max(M, left);
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

  const applyPreset = useCallback((p: PresetDate) => {
    setDraft(p.date);
  }, []);

  const apply = useCallback(() => {
    if (!draft) {
      close();
      return;
    }
    onChange(toLocalISO(draft));
    close();
  }, [draft, onChange, close]);

  // Default the calendar to the month containing the draft, so reopening lands
  // on the active date rather than today.
  const defaultMonth = draft ?? committed;

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
            aria-label={t('common.selectDate', { defaultValue: 'Select date' })}
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
              <div className="flex shrink-0 flex-col gap-0.5 border-b border-[var(--color-border)] p-2 sm:w-36 sm:border-b-0 sm:border-r">
                {presets.map((p) => {
                  const active = draft && toLocalISO(draft) === toLocalISO(p.date);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={outOfRange(p.date)}
                      onClick={() => applyPreset(p)}
                      className={cn(
                        'rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40',
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

              {/* Single-month calendar */}
              <div className="p-3">
                <DayPicker
                  mode="single"
                  numberOfMonths={1}
                  selected={draft}
                  onSelect={(d) => {
                    if (d) setDraft(d);
                  }}
                  defaultMonth={defaultMonth}
                  disabled={minDay ? [{ after: maxDay }, { before: minDay }] : { after: maxDay }}
                  classNames={{
                    // `relative` so the absolutely-positioned nav arrows below
                    // scope to the calendar area — not the whole popover.
                    root: 'relative',
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
                    selected:
                      'rounded-[var(--radius-sm)] [&_button]:bg-[var(--color-primary)] [&_button]:text-[var(--color-primary-foreground)] [&_button:hover]:bg-[var(--color-primary)]',
                    disabled:
                      '[&_button]:pointer-events-none [&_button]:opacity-30',
                  }}
                />
              </div>
            </div>

            {/* Footer — Cancel / Apply */}
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
              <Button size="sm" variant="outline" onClick={close}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button size="sm" onClick={apply} disabled={!draft}>
                {t('common.apply', { defaultValue: 'Apply' })}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
