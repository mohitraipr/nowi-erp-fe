import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ADVANCEABLE_STATUSES,
  type BatchStatus,
  type CorrectStageQtyItem,
  type LotDetail,
} from '@/api/production';
import { statusLabel } from '@/lib/production';

/** The stages whose recorded totals can be corrected here. */
const STAGES = ['cutting', 'stitching', 'finishing', 'alteration'] as const;
type STAGE = (typeof STAGES)[number];

/** i18n key per stage — the same keys the per-size table uses, so the two
 *  headings can never drift apart. */
const STAGE_LABEL: Record<STAGE, string> = {
  cutting: 'cut',
  stitching: 'stitched',
  finishing: 'finished',
  // A balance, not a running total: how many are out right now.
  alteration: 'inAlteration',
};

/** The words themselves, since these keys carry no locale entries. */
const STAGE_TEXT: Record<string, string> = {
  cut: 'Cut',
  stitched: 'Stitched',
  finished: 'Finished',
  finishing: 'Finishing',
  inAlteration: 'In alteration',
};

/** Until the lot is closed the pieces are IN finishing, not finished — the
 *  per-size table says the same, and the two must not disagree. */
const stageHeading = (stage: STAGE, pastFloor: boolean) =>
  stage === 'finishing' && !pastFloor ? 'finishing' : STAGE_LABEL[stage];

/**
 * Corrects a lot: its plan, what each stage recorded, and the stage it sits in.
 *
 * This is the ONLY place any of those go DOWN. The board moves lots forward and
 * adds to what a stage recorded; a wrong stage is usually a wrong quantity too,
 * and both are corrected here, next to the history that explains them.
 *
 * Stage figures are totals, not entries: type what the number should read and
 * the server records the difference, keeping the original in the history.
 */
export default function EditLotDialog({
  open,
  busy,
  lot,
  onClose,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  lot: LotDetail | null;
  onClose: () => void;
  onSave: (
    planned: Record<string, number>,
    corrections: CorrectStageQtyItem[],
    status: BatchStatus,
  ) => void;
}) {
  const { t } = useTranslation();
  const [planned, setPlanned] = useState<Record<string, number>>({});
  const [stages, setStages] = useState<Record<string, Record<STAGE, number>>>({});
  const [status, setStatus] = useState<BatchStatus>('cutting');

  useEffect(() => {
    if (!open || !lot) return;
    setPlanned(Object.fromEntries(lot.sizes.map((s) => [s.sku, s.qtyPlanned])));
    setStages(
      Object.fromEntries(
        lot.sizes.map((s) => [
          s.sku,
          {
            cutting: s.qtyCut,
            stitching: s.qtyStitched,
            finishing: s.qtyFinished,
            alteration: s.qtyAltered,
          },
        ]),
      ),
    );
    setStatus(lot.status);
  }, [open, lot]);

  if (!lot) return null;

  const total = Object.values(planned).reduce((a, b) => a + b, 0);
  const pastFloor = ['completed', 'dispatched'].includes(lot.status);

  // Only the figures that actually moved, so an untouched stage is left alone
  // rather than being "corrected" to the value it already holds.
  const corrections = (): CorrectStageQtyItem[] =>
    lot.sizes.flatMap((s) => {
      const now = {
        cutting: s.qtyCut,
        stitching: s.qtyStitched,
        finishing: s.qtyFinished,
        alteration: s.qtyAltered,
      };
      const changed = STAGES.filter((k) => (stages[s.sku]?.[k] ?? now[k]) !== now[k]);
      return changed.length === 0
        ? []
        : [{ sku: s.sku, ...Object.fromEntries(changed.map((k) => [k, stages[s.sku][k]])) }];
    });

  const setStage = (sku: string, stage: STAGE, raw: string) =>
    setStages((p) => ({
      ...p,
      [sku]: { ...p[sku], [stage]: Math.max(0, Number.parseInt(raw, 10) || 0) },
    }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidthClassName="max-w-2xl"
      title={
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">
            {lot.name ?? lot.styleRef ?? lot.batchNo}
          </div>
          <div className="truncate font-mono text-[11px] font-normal text-[var(--color-muted-foreground)]">
            {/* Lot number AND style reference: the title falls back through
                name -> styleRef, so a named lot showed no style identifier at
                all — and that is what you check you are editing the right one by. */}
            {[lot.batchNo, lot.styleRef ?? lot.styleKey].filter(Boolean).join(' · ')}
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
            // A lot must plan at least one unit — the server refuses zero too.
            disabled={busy || total <= 0}
            onClick={() => onSave(planned, corrections(), status)}
          >
            <Pencil size={14} />
            <span className="ml-1">{t('common.save', { defaultValue: 'Save' })}</span>
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium">
          {t('admin.production.stage', { defaultValue: 'Stage' })}
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as BatchStatus)}
          className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          {ADVANCEABLE_STATUSES.filter((s) => s !== 'dispatched').map((s) => (
            <option key={s} value={s}>
              {statusLabel(t, s)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[10.5px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <th className="py-2 pr-3 text-left font-semibold">
                {t('admin.production.size', { defaultValue: 'Size' })}
              </th>
              <th className="py-2 pr-3 text-left font-semibold">
                {t('admin.production.lot.planned', { defaultValue: 'Planned' })}
              </th>
              {STAGES.map((k) => (
                <th key={k} className="py-2 pr-3 text-left font-semibold">
                  {t(`admin.production.lot.${stageHeading(k, pastFloor)}`, {
                    defaultValue: STAGE_TEXT[stageHeading(k, pastFloor)],
                  })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lot.sizes.map((s) => (
              <tr key={s.sku} className="border-b border-[var(--color-border)]/60">
                <td className="py-2 pr-3 font-semibold">{s.size}</td>
                <td className="py-2 pr-3">
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="h-9 w-20 text-center text-sm font-semibold"
                    value={String(planned[s.sku] ?? 0)}
                    onChange={(e) =>
                      setPlanned((p) => ({
                        ...p,
                        [s.sku]: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    aria-label={t('admin.production.lot.plannedFor', {
                      defaultValue: 'Planned for size {{size}}',
                      size: s.size,
                    })}
                  />
                </td>
                {STAGES.map((k) => (
                  <td key={k} className="py-2 pr-3">
                    <Input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="h-9 w-20 text-center text-sm font-semibold"
                      value={String(stages[s.sku]?.[k] ?? 0)}
                      onChange={(e) => setStage(s.sku, k, e.target.value)}
                      aria-label={t('admin.production.lot.stageQtyFor', {
                        defaultValue: '{{stage}} for size {{size}}',
                        stage: STAGE_TEXT[STAGE_LABEL[k]],
                        size: s.size,
                      })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
