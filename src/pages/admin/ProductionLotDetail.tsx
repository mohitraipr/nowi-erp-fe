import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import LotStageStepper from '@/components/production/LotStageStepper';
import EditLotDialog from '@/components/production/EditLotDialog';
import {
  advanceBatch,
  correctStageQuantities,
  getLot,
  updateBatch,
  type CorrectStageQtyItem,
  type BatchStatus,
  type LotDetail,
  type LotTimelineEntry,
} from '@/api/production';
import { statusLabel } from '@/lib/production';
import { hasAnyRole, PRODUCTION_WRITE_ROLES } from '@/lib/userRoles';
import { useAuth } from '@/context/auth';

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

/** Statuses the server will accept a plan edit on. */
const ON_FLOOR: BatchStatus[] = ['cutting', 'stitching', 'finishing'];

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
  const { user } = useAuth();
  const canWrite = hasAnyRole(user, PRODUCTION_WRITE_ROLES);
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // The lot page is where a mis-click gets undone: the board only ever moves a
  // lot forward, so a wrong stage — and the plan behind it — is corrected here.
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const reload = async () => setLot(await getLot(Number(id)));

  const save = async (
    planned: Record<string, number>,
    corrections: CorrectStageQtyItem[],
    status: BatchStatus,
  ) => {
    if (!lot) return;
    setSaving(true);
    try {
      const plannedChanged = lot.sizes.some((s) => planned[s.sku] !== s.qtyPlanned);
      // `items` REPLACES the size lines, so every size goes up, not just edits.
      if (plannedChanged) {
        await updateBatch(lot.id, {
          items: lot.sizes.map((s) => ({
            sku: s.sku,
            size: s.size,
            qtyPlanned: planned[s.sku] ?? s.qtyPlanned,
          })),
        });
      }
      // Before the stage move: a correction is refused once the lot is off the
      // floor, so it has to land while the lot is still where it was.
      if (corrections.length > 0) await correctStageQuantities(lot.id, corrections);
      if (status !== lot.status) await advanceBatch(lot.id, status);
      await reload();
      setEditOpen(false);
      toast.show(t('common.saved', { defaultValue: 'Saved.' }));
    } catch {
      // These are three separate calls, so a failure part-way leaves some of the
      // edit applied. Re-read either way, or the page keeps showing figures the
      // server no longer holds.
      await reload().catch(() => undefined);
      toast.show(t('common.error', { defaultValue: 'Something went wrong.' }), 'error');
    } finally {
      setSaving(false);
    }
  };

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

  /** How much of the plan is finished. Caps at 100% — cumulative finishing can
   *  exceed the plan once pieces go round again through alteration. */
  const bar = (done: number, plan: number) => {
    const pct = Math.min(100, Math.round((done / (plan || 1)) * 100));
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-9 text-[11px] font-semibold text-[var(--color-muted-foreground)]">
          {pct}%
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => navigate('/admin/production')}>
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{lot.batchNo}</h1>
        {(lot.name || lot.styleRef) && (
          <span className="text-base text-[var(--color-muted-foreground)]">
            {lot.name ?? lot.styleRef}
          </span>
        )}
        <Badge variant="outline">{statusLabel(t, lot.status)}</Badge>
        {lot.tailorName && <Badge variant="secondary">{lot.tailorName}</Badge>}
        {lot.brandName && <Badge variant="outline">{lot.brandName}</Badge>}
        {lot.colourName && <Badge variant="outline">{lot.colourName}</Badge>}

        {/* The server only accepts a plan edit while the lot is on the floor,
            so the button is absent rather than failing on save. */}
        {canWrite && ON_FLOOR.includes(lot.status) && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={saving}
            onClick={() => setEditOpen(true)}
          >
            {t('common.edit', { defaultValue: 'Edit' })}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <LotStageStepper lot={lot} />
        </CardContent>
      </Card>

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
                    {t('admin.production.lot.inAlteration', { defaultValue: 'In alteration' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.finished', { defaultValue: 'Finished' })}
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    {t('admin.production.lot.dispatched', { defaultValue: 'Dispatched' })}
                  </th>
                  <th className="w-40 py-2 text-left font-semibold">
                    {t('admin.production.lot.progress', { defaultValue: 'Progress' })}
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
                    <td className="py-2 pr-3 text-right text-[var(--color-muted-foreground)]">
                      {stageCell('alteration', s.qtyAltered)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-semibold ${
                        recorded.has('finishing')
                          ? 'text-emerald-700'
                          : 'text-[var(--color-muted-foreground)]'
                      }`}
                    >
                      {stageCell('finishing', s.qtyFinished)}
                    </td>
                    <td className="py-2 pr-3 text-right text-[var(--color-muted-foreground)]">
                      {s.qtyDispatched}
                    </td>
                    <td className="py-2">{bar(s.qtyFinished, s.qtyPlanned)}</td>
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
                  <td className="py-2 pr-3 text-right text-[var(--color-muted-foreground)]">
                    {stageCell('alteration', totals.altered)}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right ${
                      recorded.has('finishing')
                        ? 'text-emerald-700'
                        : 'text-[var(--color-muted-foreground)]'
                    }`}
                  >
                    {stageCell('finishing', totals.finished)}
                  </td>
                  <td className="py-2 pr-3 text-right text-[var(--color-muted-foreground)]">
                    {totals.dispatched}
                  </td>
                  <td className="py-2">{bar(totals.finished, totals.planned)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
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

      <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.production.lot.details', { defaultValue: 'Details' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
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

      <Card>
        <CardContent className="flex flex-col gap-2.5 pt-6 text-sm">
          <Stat
            label={t('admin.production.lot.timeInStage', { defaultValue: 'Time in current stage' })}
            value={`${lot.daysInStatus}d`}
          />
          <Stat
            label={t('admin.production.lot.inAlteration', { defaultValue: 'In alteration' })}
            value={totals.altered || '—'}
          />
          <Stat
            label={t('admin.production.lot.scrapped', { defaultValue: 'Scrapped' })}
            value={totals.scrapped || '—'}
          />
          <Stat
            label={t('admin.production.lot.made', { defaultValue: 'Made' })}
            value={lot.qtyProduced ?? '—'}
          />
        </CardContent>
      </Card>
      </div>
      </div>

      <EditLotDialog
        open={editOpen}
        busy={saving}
        lot={lot}
        onClose={() => setEditOpen(false)}
        onSave={(planned, corrections, status) => void save(planned, corrections, status)}
      />
    </div>
  );
}

/** One label/value line in the lot summary card. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium text-[var(--color-muted-foreground)]">{label}</span>
      <span className="font-bold">{value}</span>
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
