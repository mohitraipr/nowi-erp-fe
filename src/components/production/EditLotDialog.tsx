import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ADVANCEABLE_STATUSES, type BatchStatus, type LotDetail } from '@/api/production';
import { statusLabel } from '@/lib/production';

/**
 * Corrects a lot: its plan, and the stage it is sitting in.
 *
 * This is the ONLY place a lot goes backwards. The board moves lots forward and
 * records what arrived; a wrong stage is usually a wrong quantity too, and both
 * are visible here, next to the history that explains them.
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
  onSave: (planned: Record<string, number>, status: BatchStatus) => void;
}) {
  const { t } = useTranslation();
  const [planned, setPlanned] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<BatchStatus>('cutting');

  useEffect(() => {
    if (!open || !lot) return;
    setPlanned(Object.fromEntries(lot.sizes.map((s) => [s.sku, s.qtyPlanned])));
    setStatus(lot.status);
  }, [open, lot]);

  if (!lot) return null;

  const total = Object.values(planned).reduce((a, b) => a + b, 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidthClassName="max-w-lg"
      title={
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">
            {lot.name ?? lot.styleRef ?? lot.batchNo}
          </div>
          <div className="truncate font-mono text-[11px] font-normal text-[var(--color-muted-foreground)]">
            {lot.batchNo}
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
            onClick={() => onSave(planned, status)}
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

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-[10.5px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <th className="py-2 pr-3 text-left font-semibold">
              {t('admin.production.size', { defaultValue: 'Size' })}
            </th>
            <th className="py-2 pr-3 text-left font-semibold">
              {t('admin.production.lot.planned', { defaultValue: 'Planned' })}
            </th>
            <th className="py-2 text-right font-semibold">
              {t('admin.production.lot.cut', { defaultValue: 'Cut' })}
            </th>
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
                  className="h-9 w-24 text-center text-sm font-semibold"
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
              {/* What the floor has already taken, so a plan is not cut below it
                  without the person doing it seeing the number. */}
              <td className="py-2 text-right text-[var(--color-muted-foreground)]">{s.qtyCut}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
