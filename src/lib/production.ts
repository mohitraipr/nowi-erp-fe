import type { useTranslation } from 'react-i18next';
import type { InventoryStyle } from '@/api/inventoryHealth';
import type { BatchStatus } from '@/api/production';

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

/**
 * Each floor stage and the figure it answers to.
 *
 * CUTTING IS ABSENT, deliberately. `sendToProduction` writes the cutting
 * entries in the same transaction that puts the lot on the floor, seeded with
 * the plan — so a lot reads "all cut" the second it is sent, before anyone has
 * touched the cloth. Stitched and finished are recorded AS THE WORK COMPLETES;
 * cut is recorded on the way IN. Only the first kind can say a stage is done.
 */
const STAGE_PAIR: Partial<
  Record<BatchStatus, { prev: 'qtyPlanned' | 'qtyCut' | 'qtyStitched'; cur: 'qtyCut' | 'qtyStitched' | 'qtyFinished' }>
> = {
  stitching: { prev: 'qtyCut', cur: 'qtyStitched' },
  finishing: { prev: 'qtyStitched', cur: 'qtyFinished' },
};

/**
 * Has the stage this lot sits in taken everything the stage before it passed on?
 *
 * Derived, never stored. The counters already carry the answer, and a stored
 * "stitching done" flag could contradict them — say it to read done while the
 * numbers show 40 of 51. Scrapped pieces count as accounted for at finishing:
 * they left the lot at alteration and are never coming back to it.
 *
 * Always false in cutting — see {@link STAGE_PAIR}. There, the only signal that
 * the work is finished is somebody moving the lot on.
 */
export function stageComplete(b: {
  status: BatchStatus;
  sizes: { qtyPlanned: number; qtyCut: number; qtyStitched: number; qtyFinished: number; qtyScrapped: number }[];
}): boolean {
  const pair = STAGE_PAIR[b.status];
  if (!pair || b.sizes.length === 0) return false;
  return b.sizes.every((s) => {
    const done = s[pair.cur] + (pair.cur === 'qtyFinished' ? s.qtyScrapped : 0);
    return s[pair.prev] > 0 && done >= s[pair.prev];
  });
}

/** The stage a finished-here lot is waiting to move to. Null at finishing —
 *  what follows it is completion, which has its own action. */
export function nextStage(status: BatchStatus): BatchStatus | null {
  return status === 'cutting' ? 'stitching' : status === 'stitching' ? 'finishing' : null;
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
