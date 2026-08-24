import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AlterationReturnItem, BatchSizeLine, ProductionBatch } from '@/api/production';

import { outstandingAlterationFor as outstandingFor } from '@/lib/production';

/**
 * Pieces coming BACK from alteration.
 *
 * Opened from the "N in alteration" chip on the row — the number that tells you
 * there is work outstanding IS the button that clears it, so there is nothing to
 * hunt for. Deliberately not a stage move: the lot is already in finishing (the
 * pieces that needed no rework went straight there), so only the counts change.
 *
 * Scrap is captured here rather than at completion because this is the moment
 * you learn a piece cannot be saved; left to completion it surfaces days later
 * as an unexplained shortfall.
 */
export default function AlterationReturnDialog({
  open,
  busy,
  batch,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  batch: ProductionBatch | null;
  onClose: () => void;
  onConfirm: (items: AlterationReturnItem[]) => void;
}) {
  const { t } = useTranslation();
  const [finished, setFinished] = useState<Record<string, number>>({});
  const [scrapped, setScrapped] = useState<Record<string, number>>({});

  // Only sizes with something out — a size that went straight through is noise.
  const rows = useMemo(
    () => (batch?.sizes ?? []).filter((s) => outstandingFor(s) > 0),
    [batch],
  );

  useEffect(() => {
    if (!open || !batch) return;
    // Seed "finished" with everything outstanding: the common case is that they
    // all came back fixed, so the default should be one click away.
    const seed: Record<string, number> = {};
    for (const s of rows) seed[s.sku] = outstandingFor(s);
    setFinished(seed);
    setScrapped({});
  }, [open, batch, rows]);

  const totalFinished = Object.values(finished).reduce((a, b) => a + b, 0);
  const totalScrapped = Object.values(scrapped).reduce((a, b) => a + b, 0);

  if (!batch) return null;

  // Finished + scrapped can never exceed what is actually out for that size —
  // the server rejects it too, but a capped input beats a 400.
  const capFor = (s: BatchSizeLine, other: number) =>
    Math.max(0, outstandingFor(s) - other);

  const clamp = (raw: string, max: number) =>
    Math.min(max, Math.max(0, Number.parseInt(raw, 10) || 0));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.production.alterationReturn.title', {
        defaultValue: 'Back from alteration · {{lot}}',
        lot: batch.batchNo,
      })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            size="sm"
            disabled={busy || totalFinished + totalScrapped === 0}
            onClick={() =>
              onConfirm(
                rows
                  .map((s) => ({
                    sku: s.sku,
                    qtyFinished: finished[s.sku] ?? 0,
                    qtyScrapped: scrapped[s.sku] ?? 0,
                  }))
                  .filter((i) => i.qtyFinished > 0 || i.qtyScrapped > 0),
              )
            }
          >
            <Undo2 size={14} />
            <span className="ml-1">
              {t('admin.production.alterationReturn.confirm', {
                defaultValue: 'Record · {{n}} finished',
                n: totalFinished,
              })}
            </span>
          </Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[10.5px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <th className="py-2 pr-3 text-left font-semibold">
                {t('admin.production.size', { defaultValue: 'Size' })}
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t('admin.production.alterationReturn.out', { defaultValue: 'Out' })}
              </th>
              <th className="py-2 pr-3 text-left font-semibold">
                {t('admin.production.alterationReturn.finished', { defaultValue: 'Finished' })}
              </th>
              <th className="py-2 text-left font-semibold">
                {t('admin.production.alterationReturn.scrapped', { defaultValue: 'Scrapped' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.sku} className="border-b border-[var(--color-border)]/60">
                <td className="py-2 pr-3 font-semibold">{s.size}</td>
                <td className="py-2 pr-3 text-right text-[var(--color-muted-foreground)]">
                  {outstandingFor(s)}
                </td>
                <td className="py-2 pr-3">
                  <Input
                    type="number"
                    min={0}
                    max={capFor(s, scrapped[s.sku] ?? 0)}
                    inputMode="numeric"
                    className="h-9 w-24 text-center text-sm font-semibold"
                    value={finished[s.sku] === 0 ? '' : String(finished[s.sku] ?? '')}
                    placeholder="0"
                    onChange={(e) =>
                      setFinished((p) => ({
                        ...p,
                        [s.sku]: clamp(e.target.value, capFor(s, scrapped[s.sku] ?? 0)),
                      }))
                    }
                    aria-label={t('admin.production.alterationReturn.finishedFor', {
                      defaultValue: 'Finished, size {{size}}',
                      size: s.size,
                    })}
                  />
                </td>
                <td className="py-2">
                  <Input
                    type="number"
                    min={0}
                    max={capFor(s, finished[s.sku] ?? 0)}
                    inputMode="numeric"
                    className="h-9 w-24 text-center text-sm font-semibold"
                    value={scrapped[s.sku] === 0 ? '' : String(scrapped[s.sku] ?? '')}
                    placeholder="0"
                    onChange={(e) =>
                      setScrapped((p) => ({
                        ...p,
                        [s.sku]: clamp(e.target.value, capFor(s, finished[s.sku] ?? 0)),
                      }))
                    }
                    aria-label={t('admin.production.alterationReturn.scrappedFor', {
                      defaultValue: 'Scrapped, size {{size}}',
                      size: s.size,
                    })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
