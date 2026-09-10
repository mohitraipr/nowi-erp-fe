import type { useTranslation } from 'react-i18next';
import type { InventoryStyle } from '@/api/inventoryHealth';
import type { BatchSizeLine, BatchStatus } from '@/api/production';

type T = ReturnType<typeof useTranslation>['t'];

/** The three floor stages read as a state the lot is IN; the off-floor statuses
 *  (planning / completed / dispatched / cancelled) keep their plain name. */
/**
 * Pieces currently out for alteration on one size.
 *
 * `qtyAltered` is a RECORDED BALANCE, not a cumulative count: the server writes
 * `+n` when pieces are sent back and `-n` when they return or are scrapped, so
 * the stage total already IS what is still out.
 *
 * It deliberately does not derive this from the other totals. Two lots reading
 * 100 stitched / 60 finished can mean "40 still at the tailor" or "all 40 came
 * back and 40 others are on the machine" — same numbers, opposite answers — so
 * any formula over them is wrong for one of the two.
 */
export function outstandingAlterationFor(s: { qtyAltered: number }): number {
  return Math.max(0, s.qtyAltered);
}

/** Whole-lot total of {@link outstandingAlterationFor}. */
export function outstandingAlteration(b: { sizes: { qtyAltered: number }[] }): number {
  return b.sizes.reduce((n, s) => n + outstandingAlterationFor(s), 0);
}

/** The three stages a lot physically passes through on the floor. */
export const FLOOR_STAGES = ['cutting', 'stitching', 'finishing'] as const;
export type FloorStage = (typeof FLOOR_STAGES)[number];

function isFloorStage(s: BatchStatus): s is FloorStage {
  return (FLOOR_STAGES as readonly string[]).includes(s);
}

/**
 * Work OWED at a stage on one size — pieces that have ARRIVED there and not been
 * done yet.
 *
 * It belongs to the stage that owes the work, not the one the piece last left: a
 * stitched piece has arrived at finishing, so it is pending THERE.
 *
 * Pieces out for alteration COUNT as pending: they are coming back and will still
 * need finishing, so the lot is not done until they land. Only `qtyScrapped` is
 * removed — written-off pieces never return, and leaving them in would hold a lot
 * above zero forever.
 *
 * Clamped at zero: `qtyFinished` is cumulative and counts a piece twice if it
 * goes round again, so the subtraction can go negative after a rework cycle.
 */
export const pendingAt: Record<FloorStage, (s: BatchSizeLine) => number> = {
  cutting: (s) => Math.max(0, s.qtyPlanned - s.qtyCut),
  stitching: (s) => Math.max(0, s.qtyCut - s.qtyStitched),
  finishing: (s) => Math.max(0, s.qtyStitched - s.qtyScrapped - s.qtyFinished),
};

/** Whole-lot work owed at the stage the lot is in RIGHT NOW. Null off the floor
 *  (planning / completed / dispatched / cancelled) — the lot is not at a stage,
 *  so nothing is owed at one. Shared by the board and the lot page. */
export function pendingAtCurrentStage(b: {
  status: BatchStatus;
  sizes: BatchSizeLine[];
}): number | null {
  if (!isFloorStage(b.status)) return null;
  const owed = pendingAt[b.status];
  return b.sizes.reduce((n, s) => n + owed(s), 0);
}

const FLOOR_STAGE_LABEL: Partial<Record<BatchStatus, string>> = {
  cutting: 'In cutting',
  stitching: 'In stitching',
  finishing: 'In finishing',
};

/** Status label, shared so the board and the lot page can't word it differently. */
export function statusLabel(t: T, status: BatchStatus): string {
  return t(`admin.production.status.${status}`, {
    defaultValue:
      FLOOR_STAGE_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1),
  });
}

/**
 * Show a style's SKU-derived name only when it adds information — not when it is
 * just the styleKey with a size suffix (e.g. "NOWIMPA1082 30", which normalises
 * to the NOWIMPA1082_30 SKU code). Shared by the Production board and Inventory
 * Health so the "is this name meaningful?" rule never drifts between them.
 */
export function cleanName(
  name: string | null,
  styleKey: string | null,
  skus: string[],
): string | null {
  const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const n = norm(name ?? '');
  if (!n) return null;
  if (styleKey && n === norm(styleKey)) return null;
  if (skus.some((sku) => norm(sku) === n)) return null;
  return name;
}

export function meaningfulName(style: InventoryStyle): string | null {
  return cleanName(
    style.name,
    style.styleKey,
    style.sizes.map((z) => z.sku),
  );
}

/** Cover-day colour: red = reorder now, amber = soon, muted otherwise. */
export function coverTone(days: number | null | undefined): string {
  if (days == null) return 'text-[var(--color-muted-foreground)]';
  if (days < 7) return 'text-[var(--color-destructive)]';
  if (days <= 15) return 'text-amber-600';
  return 'text-[var(--color-muted-foreground)]';
}
