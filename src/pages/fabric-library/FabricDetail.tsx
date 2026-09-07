import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Truck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import FabricEditorForm from '@/components/fabrics/FabricEditorForm';
import { getFabric, listFabricStock } from '@/api/styles';
import { useSignedUrls } from '@/hooks/useSignedUrls';
import type {
  Fabric,
  FabricColour,
  FabricStockEntry,
  FabricUnitOfMeasure,
} from '@/api/types';

const UOM_SHORT: Record<FabricUnitOfMeasure, string> = {
  meter: 'm',
  kg: 'kg',
  oz: 'oz',
};

/** Ledger rows for one colour, oldest→newest, each carrying its balance after. */
interface LedgerRow {
  entry: FabricStockEntry;
  balance: number;
}

/**
 * Walk a colour's entries oldest→newest so each row can show the balance the
 * ledger stood at *after* it, then flip to newest-first for display. The
 * balance is the running sum — never a stored number.
 */
function withRunningBalance(entries: FabricStockEntry[]): LedgerRow[] {
  const oldestFirst = [...entries].sort((a, b) => a.id - b.id);
  let balance = 0;
  const rows = oldestFirst.map((entry) => {
    balance += Number(entry.quantity);
    return { entry, balance };
  });
  return rows.reverse();
}

/**
 * Fabric detail — the per-colour view of one fabric.
 *
 * Price and stock live on the colour child, and so does history: every ledger
 * row carries its `fabricColourId`, so this page groups the fabric's entries by
 * colour rather than showing one merged list. Rows predating colours (or on
 * colourless fabrics) fall into an "unattributed" group so nothing is hidden.
 */
export default function FabricDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const fabricId = Number(id);

  const [fabric, setFabric] = useState<Fabric | null>(null);
  const [entries, setEntries] = useState<FabricStockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(fabricId)) return;
    setLoading(true);
    try {
      const [f, ledger] = await Promise.all([
        getFabric(fabricId),
        listFabricStock(fabricId),
      ]);
      setFabric(f);
      setEntries(ledger);
    } catch {
      setFabric(null);
    } finally {
      setLoading(false);
    }
  }, [fabricId]);

  useEffect(() => {
    void load();
  }, [load]);

  // One signed-URL call for the parent image plus every colour swatch.
  const imagePaths = useMemo(
    () => [
      fabric?.imagePath ?? null,
      ...(fabric?.colours ?? []).map((c) => c.imagePath ?? null),
    ],
    [fabric],
  );
  const imageUrls = useSignedUrls(imagePaths);

  const uom = fabric?.unitOfMeasure ? UOM_SHORT[fabric.unitOfMeasure] : '';
  const qty = (n: number) => `${n}${uom ? ` ${uom}` : ''}`;

  const byColour = useMemo(() => {
    const m = new Map<number, FabricStockEntry[]>();
    const loose: FabricStockEntry[] = [];
    for (const e of entries) {
      if (e.fabricColourId == null) loose.push(e);
      else m.set(e.fabricColourId, [...(m.get(e.fabricColourId) ?? []), e]);
    }
    return { m, loose };
  }, [entries]);

  const totalStock = useMemo(
    () => entries.reduce((sum, e) => sum + Number(e.quantity), 0),
    [entries],
  );

  /** Stock value = each colour's own stock at its own price; skip unpriced. */
  const stockValue = useMemo(() => {
    if (!fabric) return 0;
    return (fabric.colours ?? []).reduce((sum, c) => {
      if (c.pricePerUnit == null || c.availableQuantity == null) return sum;
      return sum + c.pricePerUnit * c.availableQuantity;
    }, 0);
  }, [fabric]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--color-muted-foreground)]">
        {t('common.loading')}
      </div>
    );
  }

  if (!fabric) {
    return (
      <div className="p-6 space-y-3">
        <BackLink onClick={() => navigate('/fabric-library')} label={t('admin.fabricLibrary.detail.back')} />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t('admin.fabricLibrary.detail.notFound')}
        </p>
      </div>
    );
  }

  const parentImg = fabric.imagePath ? imageUrls[fabric.imagePath] : undefined;

  return (
    <div className="space-y-6 pb-10">
      <BackLink onClick={() => navigate('/fabric-library')} label={t('admin.fabricLibrary.detail.back')} />

      {/* Header — identity, then the two actions that change this fabric. */}
      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex flex-wrap items-start gap-4">
          {parentImg && (
            <img
              src={parentImg}
              alt={fabric.name}
              className="h-24 w-24 shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{fabric.name}</h1>
              {fabric.isBlended && (
                <Badge variant="outline" className="text-[9px]">
                  {t('admin.fabricLibrary.blended')}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
              {[
                fabric.code,
                fabric.unitOfMeasure,
                fabric.gsm != null ? `${fabric.gsm} GSM` : null,
                fabric.cuttableWidth != null
                  ? `${Number(fabric.cuttableWidth)}″`
                  : null,
                ...(fabric.compositions ?? []).map(
                  (c) => `${Number(c.percent)}% ${c.fibre}`,
                ),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              {t('admin.fabricLibrary.edit')}
            </Button>
            <Button size="sm" onClick={() => navigate('/fabric-library/receive')}>
              <Truck size={14} className="mr-1.5" />
              {t('admin.fabricLibrary.receiveFabric')}
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('admin.fabricLibrary.detail.totalStock')} value={qty(totalStock)} />
        <Stat
          label={t('admin.fabricLibrary.detail.colours')}
          value={String((fabric.colours ?? []).length)}
        />
        <Stat
          label={t('admin.fabricLibrary.detail.stockValue')}
          value={stockValue > 0 ? `₹${stockValue.toLocaleString('en-IN')}` : '—'}
        />
      </div>

      {(fabric.colours ?? []).length === 0 && byColour.loose.length === 0 && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t('admin.fabricLibrary.detail.noColours')}
        </p>
      )}

      {(fabric.colours ?? []).map((c) => (
        <ColourSection
          key={c.id}
          colour={c}
          uom={uom}
          swatch={imageUrls[(c.imagePath ?? fabric.imagePath)!]}
          rows={withRunningBalance(byColour.m.get(c.id) ?? [])}
        />
      ))}

      {byColour.loose.length > 0 && (
        <section className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="px-4 py-2.5">
            <div className="text-sm font-medium">
              {t('admin.fabricLibrary.detail.unattributed')} ({byColour.loose.length})
            </div>
            <div className="text-[11px] text-[var(--color-muted-foreground)]">
              {t('admin.fabricLibrary.detail.unattributedHint')}
            </div>
          </div>
          <LedgerTable rows={withRunningBalance(byColour.loose)} uom={uom} />
        </section>
      )}

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidthClassName="max-w-3xl"
        title={`${t('admin.fabricLibrary.editFabric')} — ${fabric.name}`}
      >
        <FabricEditorForm
          editing={fabric}
          onCancel={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            void load();
          }}
        />
      </Dialog>
    </div>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
    >
      <ArrowLeft size={14} />
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--color-muted-foreground)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

/** One colour: its figures, then its own ledger. */
function ColourSection({
  colour,
  uom,
  swatch,
  rows,
}: {
  colour: FabricColour;
  uom: string;
  swatch?: string;
  rows: LedgerRow[];
}) {
  const { t } = useTranslation();
  const value =
    colour.pricePerUnit != null && colour.availableQuantity != null
      ? colour.pricePerUnit * colour.availableQuantity
      : null;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {swatch ? (
          <img
            src={swatch}
            alt=""
            className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] object-cover"
          />
        ) : (
          <span
            className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] border border-black/10"
            style={{ backgroundColor: colour.hex || colour.name.toLowerCase() }}
          />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium">{colour.name}</div>
          {colour.code && (
            <div className="text-[11px] tabular-nums text-[var(--color-muted-foreground)]">
              {colour.code}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-6">
          <Figure
            label={t('admin.fabricLibrary.detail.price')}
            value={
              colour.pricePerUnit != null
                ? `₹${colour.pricePerUnit}${uom ? ` / ${uom}` : ''}`
                : '—'
            }
          />
          <Figure
            label={t('admin.fabricLibrary.detail.inStock')}
            value={
              colour.availableQuantity != null
                ? `${colour.availableQuantity}${uom ? ` ${uom}` : ''}`
                : '—'
            }
          />
          <Figure
            label={t('admin.fabricLibrary.detail.value')}
            value={value != null ? `₹${value.toLocaleString('en-IN')}` : '—'}
          />
        </div>
      </div>
      <LedgerTable rows={rows} uom={uom} />
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--color-muted-foreground)]">
        {label}
      </div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  );
}

function LedgerTable({ rows, uom }: { rows: LedgerRow[]; uom: string }) {
  const { t } = useTranslation();
  const c = (k: string) => t(`admin.fabricLibrary.detail.cols.${k}`);

  if (rows.length === 0) {
    return (
      <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
        {t('admin.fabricLibrary.detail.noHistory')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-[var(--color-border)]">
      <table className="w-full text-xs">
        <thead className="bg-[var(--color-surface-2)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          <tr>
            <th className="px-3 py-1.5 text-left">{c('date')}</th>
            <th className="px-3 py-1.5 text-left">{c('direction')}</th>
            <th className="px-3 py-1.5 text-right">{c('qty')}</th>
            <th className="px-3 py-1.5 text-right">{c('rate')}</th>
            <th className="px-3 py-1.5 text-left">{c('challan')}</th>
            <th className="px-3 py-1.5 text-left">{c('party')}</th>
            <th className="px-3 py-1.5 text-left">{c('note')}</th>
            <th className="px-3 py-1.5 text-right">{c('balance')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entry, balance }) => {
            const q = Number(entry.quantity);
            const isIn = q >= 0;
            return (
              <tr key={entry.id} className="border-t border-[var(--color-border)]">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {new Date(
                    entry.challan?.challanDate ?? entry.createdAt,
                  ).toLocaleDateString()}
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className={
                      isIn
                        ? 'rounded-full bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] font-medium'
                        : 'rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700'
                    }
                  >
                    {isIn
                      ? t('admin.fabricLibrary.detail.in')
                      : t('admin.fabricLibrary.detail.out')}
                  </span>
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    isIn ? '' : 'text-red-700'
                  }`}
                >
                  {isIn ? '+' : '−'}
                  {Math.abs(q)}
                  {uom ? ` ${uom}` : ''}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {entry.pricePerUnit != null ? `₹${entry.pricePerUnit}` : '—'}
                </td>
                <td className="px-3 py-1.5 tabular-nums">
                  {entry.challan?.challanNo ?? '—'}
                </td>
                <td className="px-3 py-1.5">
                  {entry.challan?.vendor?.name || '—'}
                </td>
                <td className="px-3 py-1.5 text-[var(--color-muted-foreground)]">
                  {entry.note || ''}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {balance}
                  {uom ? ` ${uom}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
