import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { getLot, type LotDetail, type LotTimelineEntry } from '@/api/production';
import { statusLabel } from '@/lib/production';

/** Stage pill colours, reusing the badge variants the floor screens already use. */
const STAGE_VARIANT: Record<
  LotTimelineEntry['stage'],
  'secondary' | 'stitch' | 'finish' | 'rework' | 'destructive'
> = {
  cutting: 'secondary',
  stitching: 'stitch',
  // Reuses the existing `rework` tone — alteration IS pieces going back, and the
  // floor screens already read that colour that way.
  alteration: 'rework',
  finishing: 'finish',
  scrapped: 'destructive',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * One production lot, end to end: what was planned, what each floor stage
 * actually recorded, and who recorded it.
 *
 * Read-only on purpose — every figure here is entered through the board's stage
 * dialogs, so there is exactly one way to write a lot's history.
 */
export default function ProductionLotDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Drop the previous lot before fetching the next one. Without this, a failed
    // request leaves the OLD lot on screen under the NEW url — you'd be reading
    // one lot's quantities believing they belong to another.
    setLot(null);
    getLot(Number(id))
      .then((res) => {
        if (!cancelled) setLot(res);
      })
      .catch(() => {
        if (!cancelled) toast.show(t('common.error', { defaultValue: 'Something went wrong.' }), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A stage with no entries at all never ran under the journey system — that's
  // a lot from before it shipped, and "—" is honest where "0" would be a lie.
  const recorded = useMemo(
    () => new Set((lot?.timeline ?? []).map((e) => e.stage)),
    [lot],
  );

  // Newest first: the last thing that happened is what you came here to see.
  const timeline = useMemo(() => [...(lot?.timeline ?? [])].reverse(), [lot]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!lot) {
    return (
      <div className="space-y-3">
        <Button variant="outline" onClick={() => navigate('/admin/production')}>
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <div className="text-sm text-[var(--color-muted-foreground)]">
          {t('admin.production.lot.notFound', { defaultValue: "That lot doesn't exist." })}
        </div>
      </div>
    );
  }

  const totals = lot.sizes.reduce(
    (a, s) => ({
      planned: a.planned + s.qtyPlanned,
      cut: a.cut + s.qtyCut,
      altered: a.altered + s.qtyAltered,
      scrapped: a.scrapped + s.qtyScrapped,
      stitched: a.stitched + s.qtyStitched,
      finished: a.finished + s.qtyFinished,
      produced: a.produced + (s.qtyProduced ?? 0),
      dispatched: a.dispatched + s.qtyDispatched,
    }),
    {
      planned: 0,
      cut: 0,
      altered: 0,
      scrapped: 0,
      stitched: 0,
      finished: 0,
      produced: 0,
      dispatched: 0,
    },
  );

  const stageCell = (stage: LotTimelineEntry['stage'], qty: number) =>
    recorded.has(stage) ? qty : '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => navigate('/admin/production')}>
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <h1 className="font-mono text-lg font-semibold">{lot.batchNo}</h1>
        {(lot.name || lot.styleRef) && (
          <span className="text-sm text-[var(--color-muted-foreground)]">
            {lot.name ?? lot.styleRef}
          </span>
        )}
        <Badge variant="outline">{statusLabel(t, lot.status)}</Badge>
        {lot.tailorName && <Badge variant="secondary">{lot.tailorName}</Badge>}
        {lot.brandName && <Badge variant="outline">{lot.brandName}</Badge>}
        {lot.colourName && <Badge variant="outline">{lot.colourName}</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('admin.production.lot.journey', { defaultValue: 'Per-size journey' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[10.5px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  <th className="py-2 pr-3 text-left font-semibold">
                    {t('admin.production.size', { defaultValue: 'Size' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.planned', { defaultValue: 'Planned' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.cut', { defaultValue: 'Cut' })}
                  </th>

                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.stitched', { defaultValue: 'Stitched' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.altered', { defaultValue: 'Altered' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.finished', { defaultValue: 'Finished' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.scrapped', { defaultValue: 'Scrapped' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.made', { defaultValue: 'Made' })}
                  </th>
                  <th className="py-2 text-right font-semibold">
                    {t('admin.production.lot.dispatched', { defaultValue: 'Dispatched' })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lot.sizes.map((s) => (
                  <tr key={s.sku} className="border-b border-[var(--color-border)]/60">
                    <td className="py-2 pr-3 font-semibold">{s.size}</td>
                    <td className="py-2 pr-3 text-right">{s.qtyPlanned}</td>
                    <td className="py-2 pr-3 text-right">{stageCell('cutting', s.qtyCut)}</td>

                    <td className="py-2 pr-3 text-right">
                      {stageCell('stitching', s.qtyStitched)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {stageCell('alteration', s.qtyAltered)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {stageCell('finishing', s.qtyFinished)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {stageCell('scrapped', s.qtyScrapped)}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold">{s.qtyProduced ?? '—'}</td>
                    <td className="py-2 text-right text-[var(--color-muted-foreground)]">
                      {s.qtyDispatched}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-3">
                    {t('admin.production.lot.total', { defaultValue: 'Total' })}
                  </td>
                  <td className="py-2 pr-3 text-right">{totals.planned}</td>
                  <td className="py-2 pr-3 text-right">{stageCell('cutting', totals.cut)}</td>
                  <td className="py-2 pr-3 text-right">
                    {stageCell('stitching', totals.stitched)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {stageCell('alteration', totals.altered)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {stageCell('finishing', totals.finished)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {stageCell('scrapped', totals.scrapped)}
                  </td>
                  <td className="py-2 pr-3 text-right">{lot.qtyProduced ?? '—'}</td>
                  <td className="py-2 text-right text-[var(--color-muted-foreground)]">
                    {totals.dispatched}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('admin.production.lot.timeline', { defaultValue: 'What was recorded' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <div className="text-sm text-[var(--color-muted-foreground)]">
              {t('admin.production.lot.noEntries', {
                defaultValue: 'Nothing recorded yet — this lot has not reached the floor.',
              })}
            </div>
          ) : (
            <ul className="space-y-2">
              {timeline.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)]/60 pb-2 text-sm last:border-b-0 last:pb-0"
                >
                  <Badge variant={STAGE_VARIANT[e.stage]}>
                    {t(`admin.production.stage.${e.stage}`, { defaultValue: e.stage })}
                  </Badge>
                  <span className="font-semibold">
                    {e.qty} × {e.size}
                  </span>
                  <span className="text-[var(--color-muted-foreground)]">
                    {fmtDateTime(e.recordedAt)}
                  </span>
                  {e.recordedBy && (
                    <span className="text-[var(--color-muted-foreground)]">
                      · {e.recordedBy.name}
                    </span>
                  )}
                  {e.note && <span className="text-[var(--color-muted-foreground)]">· {e.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.production.lot.details', { defaultValue: 'Details' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <Field
              label={t('admin.production.lot.startedAt', { defaultValue: 'Added' })}
              value={fmtDate(lot.startedAt)}
            />
            <Field
              label={t('admin.production.lot.productionStartedAt', {
                defaultValue: 'On the floor',
              })}
              value={fmtDate(lot.productionStartedAt)}
            />
            <Field
              label={t('admin.production.lot.completedAt', { defaultValue: 'Completed' })}
              value={fmtDate(lot.completedAt)}
            />
            <Field
              label={t('admin.production.lot.dispatchedAt', { defaultValue: 'Dispatched' })}
              value={fmtDate(lot.dispatchedAt)}
            />
            <Field
              label={t('admin.production.lot.tailor', { defaultValue: 'Tailor' })}
              value={lot.tailorName ?? '—'}
            />
            <Field
              label={t('admin.production.lot.createdBy', { defaultValue: 'Added by' })}
              value={lot.createdBy?.name ?? '—'}
            />
            {lot.notes && (
              <Field
                label={t('admin.production.lot.notes', { defaultValue: 'Notes' })}
                value={lot.notes}
              />
            )}
            {lot.shortfallReason && (
              <Field
                label={t('admin.production.lot.shortfallReason', { defaultValue: 'Why it was short' })}
                value={lot.shortfallReason}
              />
            )}
            {lot.cancelReason && (
              <Field
                label={t('admin.production.lot.cancelReason', { defaultValue: 'Why it was cancelled' })}
                value={lot.cancelReason}
              />
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
