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
  const steps = [
    {
      key: 'cutting',
      value: cut,
      label: 'cut',
      here: Math.max(0, cut - stitched),
    },
    {
      key: 'stitching',
      value: stitched,
      label: 'stitched',
      // Pieces out for rework are at the tailor, not at the stitching station.
      here: Math.max(0, stitched - scrapped - altered - finished),
    },
    {
      key: 'finishing',
      value: finished,
      label: 'finished',
      // Nothing leaves finishing except closing the lot, so everything finished
      // is still here until then — and none of it is, once the lot is closed.
      here: pastFloor ? 0 : finished,
    },
  ];

  return (
    <div className="flex items-center gap-0 overflow-x-auto">
      {steps.map((step, i) => {
        const done = pastFloor || (at !== -1 && i < at);
        const here = i === at;
        return (
          <div key={step.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-shrink-0 items-center gap-2.5">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  done
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                    : here
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
                    done || here ? '' : 'text-[var(--color-muted-foreground)]'
                  }`}
                >
                  {t(`admin.production.lot.stepValue.${step.key}`, {
                    defaultValue: '{{n}} {{label}}',
                    n: step.value,
                    label: step.label,
                  })}
                </div>
                {/* Shown whenever there is anything here, even when it equals
                    the cumulative figure — that they match is itself the news:
                    nothing has moved on yet. */}
                {step.here > 0 && (
                  <div className="whitespace-nowrap text-[12px] font-semibold text-emerald-700">
                    {t(`admin.production.lot.stepHere.${step.key}`, {
                      defaultValue: '{{n}} in {{stage}}',
                      n: step.here,
                      stage: step.key,
                    })}
                  </div>
                )}
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
