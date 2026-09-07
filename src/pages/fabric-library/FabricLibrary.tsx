import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Plus, ChevronUp, ChevronDown, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import FabricEditorForm from '@/components/fabrics/FabricEditorForm';
import { listFabrics } from '@/api/styles';
import { createFabricChallan } from '@/api/fabricChallans';
import { useSignedUrls } from '@/hooks/useSignedUrls';
import type { Fabric, FabricUnitOfMeasure } from '@/api/types';
import { cn } from '@/lib/utils';
import {
  ColumnFilter,
  type ColumnFilterOption,
} from '@/components/ui/column-filter';
import FabricFilterBar, {
  EMPTY_FILTERS,
  type FabricFilters,
  type ColumnFilters,
  type SortKey,
} from './FabricFilterBar';

const UOM_SHORT: Record<FabricUnitOfMeasure, string> = {
  meter: 'm',
  kg: 'kg',
  oz: 'oz',
};

/**
 * Price shown on the parent row — a rollup of the colour children's prices
 * (price now lives per child). Single price → `₹X`, a spread → `₹min–max`,
 * none captured → `—`.
 */
function childPriceLabel(f: Fabric): string {
  const prices = (f.colours ?? [])
    .map((c) => c.pricePerUnit)
    .filter((p): p is number => p != null);
  if (prices.length === 0) return '—';
  const uom = f.unitOfMeasure ? ` / ${UOM_SHORT[f.unitOfMeasure]}` : '';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `₹${min}${uom}` : `₹${min}–${max}${uom}`;
}

/**
 * Fabric Library — master data screen.
 *
 * Filters live in a horizontal bar at the top (search, type chips, price,
 * fibre/content, GSM / width ranges, UoM, construction, blended-only, sort).
 * All filtering is client-side — the dataset is small (~31 rows).
 */
export default function FabricLibrary() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();

  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [filters, setFilters] = useState<FabricFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);

  // Batch-resolve every image path (parent + colour swatches) in one call so
  // the thumbnails don't fire an N+1 of signed-URL requests.
  const imagePaths = useMemo(
    () =>
      fabrics.flatMap((f) => [
        f.imagePath ?? null,
        ...(f.colours ?? []).map((c) => c.imagePath ?? null),
      ]),
    [fabrics],
  );
  const imageUrls = useSignedUrls(imagePaths);

  const [dialogOpen, setDialogOpen] = useState(false);

  // ── Issue dialog (records an OUT challan — the sole ledger writer) ──
  const [stockFabric, setStockFabric] = useState<Fabric | null>(null);
  const [stockForm, setStockForm] = useState<{
    quantity: string;
    fabricColourId: number | '';
    note: string;
  }>({ quantity: '', fabricColourId: '', note: '' });
  const [stockSaving, setStockSaving] = useState(false);

  const openStock = (f: Fabric, fabricColourId?: number) => {
    setStockFabric(f);
    setStockForm({
      quantity: '',
      // Preselect the given colour child, else the only colour if there's one.
      fabricColourId:
        fabricColourId ?? (f.colours?.length === 1 ? f.colours[0].id : ''),
      note: '',
    });
  };

  const submitStock = async () => {
    if (!stockFabric) return;
    const qty = Number(stockForm.quantity);
    if (!(qty > 0)) return;
    // The colour child is the stocked unit — always required.
    if (stockForm.fabricColourId === '') {
      toast.show(
        t('admin.fabricLibrary.stock.colourRequired', {
          defaultValue: 'Pick the colour this stock is for.',
        }),
        'error',
      );
      return;
    }
    setStockSaving(true);
    // Local calendar date — toISOString() is UTC, which stamps an issue made
    // before 05:30 IST with yesterday's date.
    const today = new Date().toLocaleDateString('en-CA');
    try {
      // Reducing stock is an OUT challan (cap-checked server-side).
      await createFabricChallan({
        direction: 'out',
        challanNo: `ISSUE-${today}`,
        challanDate: today,
        note: stockForm.note.trim() || null,
        lines: [
          { fabricColourId: stockForm.fabricColourId, quantity: qty },
        ],
      });
      toast.show(t('admin.fabricLibrary.stockSavedToast'));
      setStockFabric(null);
      await load();
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      toast.show(
        m
          ? Array.isArray(m)
            ? m.join(', ')
            : String(m)
          : t('admin.fabricLibrary.stockSaveError'),
        'error',
      );
    } finally {
      setStockSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fs = await listFabrics();
      setFabrics(fs);
    } catch {
      // graceful empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Distinct value lists for each filterable column, with row counts —
   * computed once from the full dataset, feeds the header funnels.
   */
  const columnOptions = useMemo(() => {
    const tally = (values: (string | null | undefined)[]) => {
      const m = new Map<string, number>();
      for (const v of values) {
        if (v == null || v === '') continue;
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m.entries()]
        .map<ColumnFilterOption>(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    };

    return {
      typeLabel: tally(fabrics.map((f) => f.typeLabel)),
      unitOfMeasure: fabrics.map((f) => f.unitOfMeasure).some(Boolean)
        ? tally(
            fabrics.map((f) =>
              f.unitOfMeasure
                ? t(`admin.fabricLibrary.uom.${f.unitOfMeasure}`)
                : null,
            ),
          ).map((o) => o) // labels already localised; value === label
        : [],
    };
  }, [fabrics, t]);

  /** Set an Excel-style column-exclusion list. */
  const setColumnFilter = useCallback(
    (col: keyof ColumnFilters, excluded: string[]) => {
      setFilters((f) => ({
        ...f,
        columns: { ...f.columns, [col]: excluded },
      }));
    },
    [],
  );

  const filtered = useMemo(() => {
    let xs = fabrics.slice();
    const { columns } = filters;

    const q = filters.search.trim().toLowerCase();
    if (q) xs = xs.filter((f) => f.name.toLowerCase().includes(q));

    // type label — exclude rows whose label is in the excluded set
    if (columns.typeLabel.length > 0)
      xs = xs.filter(
        (f) => !columns.typeLabel.includes(f.typeLabel ?? ''),
      );

    // unit of measure — compared on the localised label
    if (columns.unitOfMeasure.length > 0)
      xs = xs.filter((f) => {
        const label = f.unitOfMeasure
          ? t(`admin.fabricLibrary.uom.${f.unitOfMeasure}`)
          : '';
        return !columns.unitOfMeasure.includes(label);
      });

    // content / fibre — keep a fabric if it has at least one non-excluded
    // fibre (a fully-excluded fabric drops out).
    // Sort on the same number the Price column shows — the cheapest colour
    // child. The parent's own `pricePerUnit` is deprecated and no longer
    // written, so sorting by it ordered rows by a value nobody can see.
    const price = (f: Fabric) => {
      const ps = (f.colours ?? [])
        .map((c) => c.pricePerUnit)
        .filter((p): p is number => p != null);
      return ps.length > 0 ? Math.min(...ps) : 0;
    };
    const updated = (f: Fabric) =>
      f.updatedAt ? new Date(f.updatedAt).getTime() : 0;
    switch (filters.sort) {
      case 'name_asc':
        xs.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        xs.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'price_asc':
        xs.sort((a, b) => price(a) - price(b));
        break;
      case 'price_desc':
        xs.sort((a, b) => price(b) - price(a));
        break;
      case 'recent':
        xs.sort((a, b) => updated(b) - updated(a));
        break;
    }
    return xs;
  }, [fabrics, filters]);

  const openCreate = () => setDialogOpen(true);

  /**
   * Click a sortable column header → toggle that column's asc/desc sort.
   */
  const cycleSort = (col: 'name' | 'price' | 'updated') => {
    const asc: SortKey =
      col === 'name' ? 'name_asc' : col === 'price' ? 'price_asc' : 'recent';
    const desc: SortKey =
      col === 'name'
        ? 'name_desc'
        : col === 'price'
          ? 'price_desc'
          : 'recent';
    if (col === 'updated') {
      setFilters((f) => ({ ...f, sort: 'recent' }));
      return;
    }
    setFilters((f) => ({ ...f, sort: f.sort === asc ? desc : asc }));
  };

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          {t('admin.fabricLibrary.title')}
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('receive')}>
            <Truck size={16} />
            <span className="ml-1">
              {t('admin.fabricLibrary.receiveFabric', {
                defaultValue: 'Receive fabric',
              })}
            </span>
          </Button>
          <Button onClick={openCreate}>
            <Plus size={16} />
            <span className="ml-1">{t('admin.fabricLibrary.newFabric')}</span>
          </Button>
        </div>
      </header>

      <FabricFilterBar
        filters={filters}
        onChange={setFilters}
        totalCount={fabrics.length}
        matchCount={filtered.length}
      />

      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[var(--color-surface-2)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <tr>
                <SortHeader
                  label={t('admin.fabricLibrary.cols.name')}
                  active={
                    filters.sort === 'name_asc' || filters.sort === 'name_desc'
                  }
                  direction={filters.sort === 'name_desc' ? 'desc' : 'asc'}
                  onClick={() => cycleSort('name')}
                  filter={
                    columnOptions.typeLabel.length > 0 ? (
                      <ColumnFilter
                        title={t('admin.fabricLibrary.cols.type')}
                        options={columnOptions.typeLabel}
                        excluded={filters.columns.typeLabel}
                        onChange={(next) =>
                          setColumnFilter('typeLabel', next)
                        }
                      />
                    ) : undefined
                  }
                />
                <th className="text-left px-3 py-2 hidden lg:table-cell">
                  {t('admin.fabricLibrary.cols.colours', {
                    defaultValue: 'Colours',
                  })}
                </th>
                <th className="text-right px-3 py-2 hidden md:table-cell">
                  {t('admin.fabricLibrary.cols.gsm')}
                </th>
                <th className="text-right px-3 py-2 hidden md:table-cell">
                  {t('admin.fabricLibrary.cols.width')}
                </th>
                <SortHeader
                  label={t('admin.fabricLibrary.cols.price')}
                  align="right"
                  active={
                    filters.sort === 'price_asc' ||
                    filters.sort === 'price_desc'
                  }
                  direction={filters.sort === 'price_desc' ? 'desc' : 'asc'}
                  onClick={() => cycleSort('price')}
                  filter={
                    columnOptions.unitOfMeasure.length > 0 ? (
                      <ColumnFilter
                        title={t('admin.fabricLibrary.cols.unit')}
                        options={columnOptions.unitOfMeasure}
                        excluded={filters.columns.unitOfMeasure}
                        onChange={(next) =>
                          setColumnFilter('unitOfMeasure', next)
                        }
                      />
                    ) : undefined
                  }
                />
                <th className="text-right px-3 py-2">
                  {t('admin.fabricLibrary.cols.available')}
                </th>
                <SortHeader
                  label={t('admin.fabricLibrary.cols.updated')}
                  className="hidden xl:table-cell"
                  active={filters.sort === 'recent'}
                  direction="desc"
                  onClick={() => cycleSort('updated')}
                />
                <th className="text-right px-3 py-2">
                  {t('admin.fabricLibrary.cols.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-[var(--color-muted-foreground)]"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-[var(--color-muted-foreground)]"
                  >
                    {t('admin.fabricLibrary.empty')}
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((f) => (
                  <tr
                    key={f.id}
                    className="group/row border-t border-[var(--color-border)] hover:bg-[var(--color-muted)] cursor-pointer"
                    onClick={() => navigate(`/fabric-library/${f.id}`)}
                  >
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-2">
                        {f.imagePath && imageUrls[f.imagePath] && (
                          <img
                            src={imageUrls[f.imagePath]}
                            alt={f.name}
                            className="h-7 w-7 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] object-cover"
                            loading="lazy"
                          />
                        )}
                        <div>
                          <div className="flex items-center">
                            <span className="text-[var(--color-primary)] group-hover/row:underline">
                              {f.name}
                            </span>
                            {f.isBlended && (
                              <Badge
                                variant="outline"
                                className="ml-1.5 text-[9px] align-middle"
                              >
                                {t('admin.fabricLibrary.blended')}
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] font-normal text-[var(--color-muted-foreground)]">
                            {[f.code, f.typeLabel].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      {f.colours && f.colours.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {f.colours.slice(0, 5).map((c) => (
                            <span
                              key={c.id}
                              title={[
                                c.code ? `${c.code} · ` : '',
                                c.name,
                                c.availableQuantity != null
                                  ? ` — ${c.availableQuantity}${
                                      f.unitOfMeasure
                                        ? ` ${UOM_SHORT[f.unitOfMeasure]}`
                                        : ''
                                    }`
                                  : '',
                                c.pricePerUnit != null
                                  ? ` · ₹${c.pricePerUnit}${
                                      f.unitOfMeasure
                                        ? `/${UOM_SHORT[f.unitOfMeasure]}`
                                        : ''
                                    }`
                                  : '',
                              ].join('')}
                              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] pl-1 pr-1.5 py-0.5 text-[11px] text-[var(--color-foreground)]"
                            >
                              {/* The colour's own swatch when it has one, else
                                  the fabric's image — the colour name beside it
                                  is what actually names the chip either way. */}
                              {(c.imagePath ?? f.imagePath) &&
                              imageUrls[(c.imagePath ?? f.imagePath)!] ? (
                                <img
                                  src={imageUrls[(c.imagePath ?? f.imagePath)!]}
                                  alt=""
                                  className="h-3.5 w-3.5 rounded-[2px] border border-black/10 object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <span
                                  className="h-2.5 w-2.5 rounded-full border border-black/10"
                                  style={{
                                    backgroundColor:
                                      c.hex || c.name.toLowerCase(),
                                  }}
                                />
                              )}
                              {c.name}
                            </span>
                          ))}
                          {f.colours.length > 5 && (
                            <span className="text-[11px] text-[var(--color-muted-foreground)]">
                              +{f.colours.length - 5}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--color-muted-foreground)]">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                      {f.gsm != null ? f.gsm : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                      {f.cuttableWidth != null
                        ? `${Number(f.cuttableWidth)}″`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {childPriceLabel(f)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.availableQuantity != null &&
                      f.availableQuantity > 0 ? (
                        <span>
                          {f.availableQuantity}
                          {f.unitOfMeasure
                            ? ` ${UOM_SHORT[f.unitOfMeasure]}`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-[var(--color-muted-foreground)]">
                          {t('admin.fabricLibrary.noStock')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden xl:table-cell text-xs text-[var(--color-muted-foreground)] tabular-nums">
                      {f.updatedAt
                        ? new Date(f.updatedAt).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStock(f);
                        }}
                      >
                        {t('admin.fabricLibrary.issue')}
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidthClassName="max-w-3xl"
        title={t('admin.fabricLibrary.newFabric')}
      >
        {/* Shared with the intake's FabricPicker — single source of truth for
            the fabric form. Editing an existing fabric lives on its detail
            page; this dialog only creates. */}
        <FabricEditorForm
          editing={null}
          onCancel={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            void load();
          }}
        />
      </Dialog>

      <Dialog
        open={stockFabric != null}
        onClose={() => setStockFabric(null)}
        title={
          stockFabric
            ? `${t('admin.fabricLibrary.issueFabric')} — ${stockFabric.name}`
            : t('admin.fabricLibrary.issueFabric')
        }
      >
        <div className="space-y-3">
          <div>
            <Label>
              {t('admin.fabricLibrary.stock.quantity')}
              {stockFabric?.unitOfMeasure
                ? ` (${UOM_SHORT[stockFabric.unitOfMeasure]})`
                : ''}
            </Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={stockForm.quantity}
              onChange={(e) =>
                setStockForm((s) => ({ ...s, quantity: e.target.value }))
              }
              autoFocus
            />
          </div>
          {(stockFabric?.colours?.length ?? 0) > 0 && (
            <div>
              <Label>
                {t('admin.fabricLibrary.stock.colour', {
                  defaultValue: 'Colour',
                })}{' '}
                *
              </Label>
              <Select
                value={stockForm.fabricColourId === '' ? '' : String(stockForm.fabricColourId)}
                onChange={(e) =>
                  setStockForm((s) => ({
                    ...s,
                    fabricColourId: e.target.value ? Number(e.target.value) : '',
                  }))
                }
              >
                <option value="">
                  {t('admin.fabricLibrary.stock.colourPlaceholder', {
                    defaultValue: 'Choose a colour…',
                  })}
                </option>
                {stockFabric?.colours?.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                    {c.availableQuantity != null
                      ? ` — ${c.availableQuantity}${
                          stockFabric?.unitOfMeasure
                            ? ` ${UOM_SHORT[stockFabric.unitOfMeasure]}`
                            : ''
                        }`
                      : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label>{t('admin.fabricLibrary.stock.note')}</Label>
            <Input
              value={stockForm.note}
              onChange={(e) =>
                setStockForm((s) => ({ ...s, note: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStockFabric(null)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              size="sm"
              disabled={stockSaving || !(Number(stockForm.quantity) > 0)}
              onClick={() => void submitStock()}
            >
              {stockSaving
                ? t('common.saving', 'Saving…')
                : t('admin.fabricLibrary.issue')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * A sortable table-header cell — click to sort, shows a direction caret.
 * Optionally renders a column-filter funnel beside the sort button.
 */
function SortHeader({
  label,
  active,
  direction,
  onClick,
  align = 'left',
  className,
  filter,
}: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onClick: () => void;
  align?: 'left' | 'right';
  className?: string;
  filter?: ReactNode;
}) {
  return (
    <th
      className={cn(
        'px-3 py-2',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        <button
          type="button"
          onClick={onClick}
          className={cn(
            // `uppercase` is re-stated here because Tailwind's preflight sets
            // `button { text-transform: none }`, so the thead's caps don't reach in.
            'inline-flex items-center gap-1 uppercase transition-colors hover:text-[var(--color-foreground)]',
            align === 'right' && 'flex-row-reverse',
            active && 'text-[var(--color-primary)]',
          )}
        >
          <span>{label}</span>
          {active &&
            (direction === 'asc' ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            ))}
        </button>
        {filter}
      </span>
    </th>
  );
}

