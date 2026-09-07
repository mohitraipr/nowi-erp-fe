import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The filter rail — one bordered white container holding every list control,
 * its groups separated by hairline dividers. Introduced on Inventory Health and
 * shared from here so the production board and the sampling dashboard read the
 * same way instead of each hand-rolling a row of bordered selects.
 *
 * Left-aligned by design (`inline-flex`, `self-start`): the rail hugs its
 * controls rather than stretching across the page.
 */
export function FilterRail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex">
      <div
        className={cn(
          'inline-flex flex-wrap items-stretch gap-2.5 self-start rounded-xl border border-neutral-200 bg-white p-1.5 shadow-sm',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Hairline between two control groups inside a {@link FilterRail}. */
export function FilterRailDivider() {
  return <span aria-hidden className="my-0.5 w-px bg-neutral-300" />;
}

/**
 * Classes for a `<select>` sitting in the rail: borderless and transparent, so
 * the rail supplies the chrome and the control reads as part of it.
 */
export const RAIL_SELECT_CLASS =
  'h-9 cursor-pointer rounded-md border-none bg-transparent px-3 text-sm font-semibold text-[var(--color-foreground)] transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/30';

/**
 * A segmented pill group (the "All stock · Real · Virtual" control). `value`
 * is compared against each option's `value`; the active one takes the primary
 * fill. Generic over the option union so callers keep their literal types.
 */
export function FilterRailSegments<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'rounded-md px-4 py-1.5 text-sm font-semibold transition',
            value === o.value
              ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm'
              : 'text-neutral-500 hover:text-[var(--color-primary)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Toggle-chip filter row — for a filter that sits beside a search box rather
 * than in the rail. Not a {@link FilterRailSegments}: the caller owns the
 * toggle semantics, so the same chips serve a pick-one filter (Production)
 * and a pick-many one (the sampling dashboard).
 */
export function FilterChips<T extends string>({
  options,
  value,
  onToggle,
  onClear,
  clearLabel,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  /** The selected set; a pick-one caller passes 0 or 1 entries. */
  value: T[];
  onToggle: (v: T) => void;
  onClear: () => void;
  clearLabel: string;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            aria-pressed={on}
            className={cn(
              'h-8 rounded-full border px-3 text-[12px] font-medium transition-colors',
              on
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
      {value.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="h-8 px-2 text-[12px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
