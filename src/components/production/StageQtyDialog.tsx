import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Factory } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TailorPicker from '@/components/production/TailorPicker';
import type {
  BatchSizeLine,
  BatchStatus,
  ProductionBatch,
  StageQtyItem,
} from '@/api/production';

/** Which recorded figure the stage being entered is measured against. Cutting
 *  answers to the plan; every later stage answers to the stage before it. */
const PREVIOUS: Record<string, { key: 'qtyPlanned' | 'qtyCut' | 'qtyStitched'; label: string }> = {
  cutting: { key: 'qtyPlanned', label: 'Planned' },
  stitching: { key: 'qtyCut', label: 'Cut' },
  finishing: { key: 'qtyStitched', label: 'Stitched' },
};

/** The line's own figure for the stage being ENTERED. Entries are additive on
 *  the server, so whatever this stage already holds has to be netted off — else
 *  a second pass (back a stage, then forward again) counts the same pieces twice. */
const CURRENT: Record<string, 'qtyCut' | 'qtyStitched' | 'qtyFinished'> = {
  cutting: 'qtyCut',
  stitching: 'qtyStitched',
  finishing: 'qtyFinished',
};

const STAGE_VERB: Record<string, string> = {
  cutting: 'Cutting',
  stitching: 'Stitching',
  finishing: 'Finishing',
};

/** What this stage still has coming to it: what the previous step passed on,
 *  less what this stage already banked. Both the seeded value and the input's
 *  ceiling are this number, so they can't drift apart. */
const outstanding = (
  s: BatchSizeLine,
  prevKey: (typeof PREVIOUS)[string]['key'],
  curKey: (typeof CURRENT)[string],
): number =>
  Math.max(
    0,
    // Scrapped pieces were written off at alteration — they left the lot and can
    // never reach finishing, so they are not "still coming" to it.
    (s[prevKey] ?? 0) - (s[curKey] ?? 0) - (curKey === 'qtyFinished' ? s.qtyScrapped : 0),
  );

/**
 * Records how many pieces of each size reached ONE stage. Every floor move goes
 * through here — Pipeline → cutting (where the tailor is named and the lot
 * number gains its suffix), then cutting → stitching → finishing.
 *
 * The plan is shown but never editable: the whole point is that "planned 500,
 * cut 480" survives the move.
 *
 * The box means "how many MORE", because the server appends rather than
 * replaces. It is seeded with what's still outstanding at this stage, so the
 * first pass reads as the full quantity and a return visit only tops up.
 */
export default function StageQtyDialog({
  open,
  busy,
  batch,
  stage,
  askTailor = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  batch: ProductionBatch | null;
  /** Stage being entered — decides the column labels and what Δ compares to. */
  stage: BatchStatus;
  /** Pipeline → floor also names the tailor; later stage moves don't. */
  askTailor?: boolean;
  onClose: () => void;
  onConfirm: (
    items: StageQtyItem[],
    extra?: { tailorId?: number; fabricFeasible?: boolean },
  ) => void;
}) {
  const { t } = useTranslation();
  const [qty, setQty] = useState<Record<string, number>>({});
  // A lot SPLITS on the way into finishing: of 100 stitched, 90 reach finishing
  // and 10 go back for alteration. Only this move offers it — alteration happens
  // after stitching, and nothing before that stage can be "sent back".
  const [alter, setAlter] = useState<Record<string, number>>({});
  const [tailorId, setTailorId] = useState<number | ''>('');

  const prev = PREVIOUS[stage] ?? PREVIOUS.cutting;
  const cur = CURRENT[stage] ?? 'qtyCut';

  useEffect(() => {
    if (!open || !batch) return;
    // Seed each size with what is still OUTSTANDING at this stage: everything
    // the previous step passed on, minus whatever this stage already recorded.
    // First pass that's the full quantity; coming back it's the remainder, so
    // the box always means "how many more" — which is what the server appends.
    const seeded: Record<string, number> = {};
    for (const s of batch.sizes) seeded[s.sku] = outstanding(s, prev.key, cur);
    setQty(seeded);
    setAlter({});
    setTailorId(batch.tailorId ?? '');
  }, [open, batch, prev.key, cur]);

  const total = useMemo(() => Object.values(qty).reduce((a, b) => a + b, 0), [qty]);

  if (!batch) return null;

  // You cannot stitch more than was cut, or finish more than was stitched — the
  // previous figure is physical output, so the excess is unenterable rather than
  // merely flagged. Cutting is deliberately exempt: its "previous" is the PLAN,
  // and cutting a few pieces over plan is a real thing that happens on the floor.
  const capped = stage !== 'cutting';
  const maxFor = (s: BatchSizeLine): number =>
    capped ? outstanding(s, prev.key, cur) : Number.POSITIVE_INFINITY;

  const set = (sku: string, raw: string, max: number) => {
    const next = Math.min(max, Math.max(0, Number.parseInt(raw, 10) || 0));
    setQty((p) => ({ ...p, [sku]: next }));
    // Clamping only the field being edited let the PAIR drift over the cap:
    // enter 10 to alteration, then raise finishing, and the stale 10 rides along
    // into a payload the server rejects. Reconcile the other side here.
    if (splits) {
      setAlter((p) => {
        const room = Math.max(0, max - next);
        return (p[sku] ?? 0) > room ? { ...p, [sku]: room } : p;
      });
    }
  };

  const splits = stage === 'finishing';
  const alterTotal = Object.values(alter).reduce((a, b) => a + b, 0);
  // Finishing + alteration cannot exceed what stitching passed on.
  const setAlterFor = (sku: string, raw: string, max: number) =>
    setAlter((p) => ({
      ...p,
      [sku]: Math.min(max, Math.max(0, Number.parseInt(raw, 10) || 0)),
    }));

  const verb = STAGE_VERB[stage] ?? stage;
  // Anything already banked at this stage — shown as its own column, and what
  // makes a zero-quantity submit legitimate (the work is recorded; this move is
  // only putting the lot back on the right stage).
  const anyRecorded = batch.sizes.some((s) => (s[cur] ?? 0) > 0);
  // alterTotal counts: a run where every piece needs rework submits qty 0 to
  // finishing and the whole quantity to alteration, which is a real move.
  const canSubmit =
    (total > 0 || alterTotal > 0 || anyRecorded) &&
    (!askTailor || tailorId !== '');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidthClassName="max-w-2xl"
      title={
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary)]">
            {t(`admin.production.stage.${stage}`, { defaultValue: verb })}
          </div>
          <div className="truncate text-base font-semibold">
            {batch.name ?? batch.styleRef ?? batch.batchNo}
          </div>
          <div className="truncate font-mono text-[11px] font-normal text-[var(--color-muted-foreground)]">
            {batch.batchNo}
            {batch.tailorName ? ` · ${batch.tailorName}` : ''}
          </div>
        </div>
      }
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            size="sm"
            disabled={busy || !canSubmit}
            onClick={() =>
              onConfirm(
                batch.sizes.map((s) => ({
                  sku: s.sku,
                  qty: qty[s.sku] ?? 0,
                  ...(splits && (alter[s.sku] ?? 0) > 0
                    ? { qtyToAlteration: alter[s.sku] }
                    : {}),
                })),
                askTailor
                  ? { tailorId: tailorId === '' ? undefined : tailorId }
                  : undefined,
              )
            }
          >
            <Factory size={14} />
            <span className="ml-1">
              {alterTotal > 0
                ? t('admin.production.stage.confirmSplit', {
                    defaultValue: '{{verb}} · {{n}} · {{a}} to alteration',
                    verb,
                    n: total,
                    a: alterTotal,
                  })
                : t('admin.production.stage.confirm', {
                    defaultValue: '{{verb}} · {{n}}',
                    verb,
                    n: total,
                  })}
            </span>
          </Button>
        </>
      }
    >
      {askTailor && (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium">
            {t('admin.production.stage.tailor', { defaultValue: 'Tailor' })}
          </label>
          <TailorPicker
            value={tailorId === '' ? null : tailorId}
            onChange={(id) => setTailorId(id ?? '')}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[10.5px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <th className="py-2 pr-3 text-left font-semibold">
                {t('admin.production.size', { defaultValue: 'Size' })}
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t(`admin.production.stage.prev.${prev.key}`, { defaultValue: prev.label })}
              </th>
              {anyRecorded && (
                <th className="py-2 pr-3 text-right font-semibold">
                  {t('admin.production.stage.already', { defaultValue: 'Already' })}
                </th>
              )}
              <th className="py-2 pr-3 text-left font-semibold">
                {anyRecorded
                  ? t('admin.production.stage.more', { defaultValue: '{{verb}} more', verb })
                  : verb}
              </th>
              {splits && (
                <th className="py-2 pr-3 text-left font-semibold text-amber-700">
                  {t('admin.production.stage.toAlteration', {
                    defaultValue: 'To alteration',
                  })}
                </th>
              )}
              <th className="py-2 text-right font-semibold">
                {t('admin.production.stage.delta', { defaultValue: 'Diff' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {batch.sizes.map((s) => {
              const before = s[prev.key] ?? 0;
              const already = s[cur] ?? 0;
              // Compares this stage's TOTAL after the entry (not just the entry)
              // against the step before it — otherwise a top-up always reads short.
              const delta = already + (qty[s.sku] ?? 0) - before;
              return (
                <tr key={s.sku} className="border-b border-[var(--color-border)]/60">
                  <td className="py-2 pr-3 font-semibold">{s.size}</td>
                  <td className="py-2 pr-3 text-right text-[var(--color-muted-foreground)]">
                    {before}
                  </td>
                  {anyRecorded && (
                    <td className="py-2 pr-3 text-right text-[var(--color-muted-foreground)]">
                      {already || '—'}
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      min={0}
                      max={Number.isFinite(maxFor(s)) ? maxFor(s) : undefined}
                      inputMode="numeric"
                      className="h-9 w-24 text-center text-sm font-semibold"
                      value={qty[s.sku] === 0 ? '' : String(qty[s.sku] ?? '')}
                      placeholder="0"
                      onChange={(e) => set(s.sku, e.target.value, maxFor(s))}
                      aria-label={t('admin.production.send.qtyFor', {
                        defaultValue: 'Quantity for size {{size}}',
                        size: s.size,
                      })}
                    />
                  </td>
                  {splits && (
                    <td className="py-2 pr-3">
                      <Input
                        type="number"
                        min={0}
                        // Finishing + alteration can't exceed what stitching passed on.
                        max={Math.max(0, maxFor(s) - (qty[s.sku] ?? 0))}
                        inputMode="numeric"
                        className="h-9 w-24 text-center text-sm font-semibold"
                        value={alter[s.sku] === 0 ? '' : String(alter[s.sku] ?? '')}
                        placeholder="0"
                        onChange={(e) =>
                          setAlterFor(s.sku, e.target.value, Math.max(0, maxFor(s) - (qty[s.sku] ?? 0)))
                        }
                        aria-label={t('admin.production.stage.alterFor', {
                          defaultValue: 'To alteration, size {{size}}',
                          size: s.size,
                        })}
                      />
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {delta === 0 ? (
                      <span className="text-[var(--color-muted-foreground)]">—</span>
                    ) : (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          delta < 0
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
