import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { BatchStatus, ProductionBatch } from '@/api/production';

const ORDER: BatchStatus[] = ['cutting', 'stitching', 'finishing'];

/**
 * The lot's journey as one strip: what each stage holds, and how many pieces are
 * waiting to move on. The "ready" figures are derived, never stored — the same
 * arithmetic the record dialog caps its inputs with, so the strip and the dialog
 * can't tell you different things.
 *
 * Cutting has no ready figure on purpose: its quantity is written when the lot is
 * SENT to the floor, so it would read "all ready" before anyone touched the cloth.
 */
export default function LotStageStepper({ lot }: { lot: ProductionBatch }) {
  const { t } = useTranslation();

  const sum = (pick: (s: ProductionBatch['sizes'][number]) => number) =>
    lot.sizes.reduce((n, s) => n + pick(s), 0);

  const cut = sum((s) => s.qtyCut);
  const stitched = sum((s) => s.qtyStitched);
  const finished = sum((s) => s.qtyFinished);
  const altered = sum((s) => s.qtyAltered);
  const scrapped = sum((s) => s.qtyScrapped);

  // `indexOf` is -1 both BEFORE the floor (planning) and after it (completed,
  // dispatched). Treating them alike ticked every stage on a lot that had not
  // started, so past-the-floor is named explicitly rather than inferred.
  const at = ORDER.indexOf(lot.status);
  const pastFloor = ['completed', 'dispatched'].includes(lot.status);
  // Two different questions per stage. `value` is cumulative — everything that
  // has ever passed through here. `here` is what is sitting at the station right
  // now: a piece stays IN a stage until the next one takes it.
  //
  // Clamped at zero. `finished` is cumulative and counts a piece twice if it
  // goes round again through alteration, so after a rework cycle the raw
  // subtraction can go negative — and "-3 in stitching" reads as a fault.
  // Each stage splits what reached it into two: pieces that have moved ON to the
  // next stage, and pieces still sitting here. `value` is the first, `pending`
  // the second, and they always sum to what the stage took in.
  //
  // So the headline number answers "how far has this stage got", not "how much
  // has ever passed through" — 4 cut of 5 means one is still on the table.
  //
  // Clamped: `finished` is cumulative and counts a piece twice if it goes round
  // again through alteration, so the subtraction can go negative after rework.
  const pendingCut = Math.max(0, cut - stitched);
  const pendingStitch = Math.max(0, stitched - scrapped - altered - finished);
  // Nothing leaves finishing except closing the lot: until then none are
  // finished and all of them are pending.
  const pendingFinish = pastFloor ? 0 : finished;

  const steps = [
    { key: 'cutting', label: 'cut', value: cut - pendingCut, pending: pendingCut },
    { key: 'stitching', label: 'stitched', value: stitched - pendingStitch, pending: pendingStitch },
    { key: 'finishing', label: 'finished', value: finished - pendingFinish, pending: pendingFinish },
  ];

  return (
    <div className="flex items-center gap-0 overflow-x-auto">
      {steps.map((step, i) => {
        const holds = step.pending > 0;
        const done = !holds && (pastFloor || (at !== -1 && i < at));
        const here = i === at;
        return (
          <div key={step.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-shrink-0 items-center gap-2.5">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  done
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                    : holds || here
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted-foreground)]'
                }`}
              >
                {done ? <Check size={14} /> : i + 1}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  {t(`admin.production.stage.${step.key}`, { defaultValue: step.key })}
                </div>
                <div
                  className={`whitespace-nowrap text-[13px] font-semibold ${
                    holds || done || here ? '' : 'text-[var(--color-muted-foreground)]'
                  }`}
                >
                  {holds
                    ? t(`admin.production.lot.stepPending.${step.key}`, {
                        defaultValue: '{{n}} {{label}} · {{p}} pending',
                        n: step.value,
                        label: step.label,
                        p: step.pending,
                      })
                    : t(`admin.production.lot.stepValue.${step.key}`, {
                        defaultValue: '{{n}} {{label}}',
                        n: step.value,
                        label: step.label,
                      })}
                </div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-2.5 h-0.5 min-w-3 flex-1 rounded ${
                  done ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
                }`}
              />
            )}
          </div>
        );
      })}
      {altered > 0 && (
        <div className="ml-4 flex-shrink-0 whitespace-nowrap rounded-full bg-amber-50 px-3 py-1.5 text-[13px] font-semibold text-amber-700">
          {t('admin.production.lot.outForAlteration', {
            defaultValue: '↩ {{n}} in alteration',
            n: altered,
          })}
        </div>
      )}
    </div>
  );
}
