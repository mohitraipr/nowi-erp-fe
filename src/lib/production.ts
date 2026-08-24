import type { useTranslation } from 'react-i18next';
import type { InventoryStyle } from '@/api/inventoryHealth';
import type { BatchStatus } from '@/api/production';

type T = ReturnType<typeof useTranslation>['t'];

/** The three floor stages read as a state the lot is IN; the off-floor statuses
 *  (planning / completed / dispatched / cancelled) keep their plain name. */
/** Pieces still out for alteration: sent back, not yet finished or written off.
 *  Derived, never stored — a returning piece is recorded into `finishing` like
 *  any other instalment and this falls to zero on its own. */
export function outstandingAlteration(b: {
  sizes: { qtyStitched: number; qtyFinished: number; qtyScrapped: number }[];
}): number {
  return b.sizes.reduce(
    (n, s) => n + Math.max(0, s.qtyStitched - s.qtyFinished - s.qtyScrapped),
    0,
  );
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
