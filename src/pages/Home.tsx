import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SummaryCards, {
  SummaryCardsSkeleton,
} from '@/components/dashboard/SummaryCards';
import StylesInFlightTable from '@/components/dashboard/StylesInFlightTable';
import { ALL_TIME_FROM_ISO, DateRangePicker } from '@/components/ui/DateRangePicker';
import { FilterRail } from '@/components/ui/filter-rail';
import { useAuth } from '@/context/auth';
import { hasAnyRole, DESIGN_SUBMIT_ROLES } from '@/lib/userRoles';
import {
  getDashboardCards,
  type DashboardCards,
  type DashboardStyleTab,
} from '@/api/dashboard';

/**
 * Unified, role-aware Home — the single office landing surface (kills the
 * old `/styles` sampling-home + `/admin` AdminHome split). Top → bottom:
 *   1. Header — serif "Dashboard" title + a narrative line built from REAL
 *      card counts + a "+ Submit design" link to the existing intake flow.
 *      (No test-data toggle here — AdminShell's header already owns it.)
 *   2. Four role-aware summary cards (SummaryCards) — all data real.
 *   3. The per-style "Styles in flight" table (StylesInFlightTable), seeded
 *      from the `?tab=` deep-link query param.
 * See docs/DASHBOARD_REDESIGN.md ("Home layout", "UI conventions").
 */

// Mirror the table's tab buckets so a `?tab=` deep link (e.g. the Live card)
// lands on the right tab. Anything unrecognised falls back to 'my_work'.
const VALID_TABS: DashboardStyleTab[] = [
  'all',
  'draft',
  'sampling',
  'cataloguing',
  'live',
  'parked',
  'my_work',
];

function tabFromParam(value: string | null): DashboardStyleTab {
  return VALID_TABS.includes(value as DashboardStyleTab)
    ? (value as DashboardStyleTab)
    : // No (or unknown) ?tab= → land on the role-aware "My work" queue (the
      // first tab in the table), not the full unfiltered list.
      'my_work';
}

/** YYYY-MM-DD for a date `n` days before today (0 = today), in the user's
 *  LOCAL zone. `toISOString()` would format in UTC and, for IST users in the
 *  early-morning hours, return yesterday — making "today" unselectable and
 *  shifting the default window a day back. Build the string from local parts. */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const DEFAULT_RANGE_DAYS = 7;
// "View all" clears the activity window to surface EVERY product regardless of
// last-touched date. The picker can't render an empty range, so we widen to an
// all-time floor (predates all data → BE date filter matches everything)
// rather than null out from/to.

export default function Home() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialTab = tabFromParam(searchParams.get('tab'));
  const { user } = useAuth();
  // "+ Submit design" creates a Style → gate to the design-create set
  // (mirrors the BE styles CREATE) so a read-only role never sees a CTA the
  // BE will 403.
  const canSubmit = hasAnyRole(user, DESIGN_SUBMIT_ROLES);

  const [cards, setCards] = useState<DashboardCards | null>(null);
  const [cardsError, setCardsError] = useState(false);

  // ONE shared date window for the whole dashboard — both the summary cards
  // (date-responsive metrics) AND the in-flight list below read it. The top
  // header picker and the in-card list picker are both bound to this single
  // state, so changing either re-scopes both surfaces (the list refetch shows
  // its own loading shimmer). Defaults to the last 7 days.
  const [cardsFrom, setCardsFrom] = useState<string>(() =>
    isoDaysAgo(DEFAULT_RANGE_DAYS - 1),
  );
  const [cardsTo, setCardsTo] = useState<string>(() => isoDaysAgo(0));

  const loadCards = useCallback(async () => {
    setCardsError(false);
    try {
      const res = await getDashboardCards({ from: cardsFrom, to: cardsTo });
      setCards(res);
    } catch {
      setCardsError(true);
    }
  }, [cardsFrom, cardsTo]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  return (
    <div className="space-y-6 pb-10">
      {/* Page header — title (left); filter rail + Submit (right). */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          {t('dashboard.title', { defaultValue: 'Dashboard' })}
        </h1>

        {/* The date window sits beside the primary action, on the title row. */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterRail>
            {/* Page-wide window — scopes BOTH cards and list. The status filter
                lives beside the table's search box, not here. */}
            <DateRangePicker
              from={cardsFrom}
              to={cardsTo}
              maxDate={isoDaysAgo(0)}
              label={t('dashboard.dateFilter.label', {
                defaultValue: 'Showing',
              })}
              onApply={(nextFrom, nextTo) => {
                setCardsFrom(nextFrom);
                setCardsTo(nextTo);
              }}
            />
          </FilterRail>
          {canSubmit && (
            <Button asChild>
              <Link to="/styles/new">
                <Plus size={16} />
                <span className="ml-1">
                  {t('dashboard.submitDesign', {
                    defaultValue: 'Submit design',
                  })}
                </span>
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* KPI cards — 4 distinct, elevated metric cards (not one panel). While
          loading, show same-shaped skeletons so the row doesn't pop in. */}
      {cards ? (
        <SummaryCards cards={cards} />
      ) : !cardsError ? (
        <SummaryCardsSkeleton />
      ) : null}

      {/* Styles in flight — the single content surface. Its own activity-window
          filter lives INSIDE the table card (passed via onDateApply). */}
      {/* The date filter lives ONCE, in the header (drives both cards + list).
          No in-card picker here — omitting onDateApply hides it; the table is
          still scoped by the shared from/to window. */}
      <StylesInFlightTable
        initialTab={initialTab}
        from={cardsFrom}
        to={cardsTo}
        onActionDone={loadCards}
        onViewAll={() => {
          setCardsFrom(ALL_TIME_FROM_ISO);
          setCardsTo(isoDaysAgo(0));
        }}
      />
    </div>
  );
}
