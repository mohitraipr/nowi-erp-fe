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

/** Render a fabric's composition as "98% Cotton · 2% Elastane". */
function contentSummary(f: Fabric): string {
  if (!f.compositions || f.compositions.length === 0) return '—';
  return f.compositions
    .map((c) => `${Number(c.percent)}% ${c.fibre}`)
    .join(' · ');
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Fabric | null>(null);

  // ── Take-stock dialog (records an OUT challan — the sole ledger writer) ──
  const [stockFabric, setStockFabric] = useState<Fabric | null>(null);
  const [stockForm, setStockForm] = useState<{
    quantity: string;
    fabricColourId: number | '';
    note: string;
  }>({ quantity: '', fabricColourId: '', note: '' });
  const [stockSaving, setStockSaving] = useState(false);

  const openStock = (f: Fabric) => {
    setStockFabric(f);
    setStockForm({
      quantity: '',
      // Preselect when the fabric has exactly one colour — one fewer click.
      fabricColourId: f.colours?.length === 1 ? f.colours[0].id : '',
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
    const today = new Date().toISOString().slice(0, 10);
    try {
      // Reducing stock is an OUT challan (cap-checked server-side).
      await createFabricChallan({
        direction: 'out',
        challanNo: `TAKE-${today}`,
        challanDate: today,
        supplier: '',
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

    // fibre: each fabric counts once per distinct fibre it contains
    const fibreMap = new Map<string, number>();
    for (const f of fabrics) {
      const seen = new Set<string>();
      for (const c of f.compositions ?? []) {
        if (seen.has(c.fibre)) continue;
        seen.add(c.fibre);
        fibreMap.set(c.fibre, (fibreMap.get(c.fibre) ?? 0) + 1);
      }
    }
    const fibre = [...fibreMap.entries()]
      .map<ColumnFilterOption>(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

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
      fibre,
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
    if (columns.fibre.length > 0)
      xs = xs.filter((f) =>
        (f.compositions ?? []).some(
          (c) => !columns.fibre.includes(c.fibre),
        ),
      );

    const price = (f: Fabric) => Number(f.pricePerUnit ?? 0);
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

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (f: Fabric) => {
    setEditing(f);
    setDialogOpen(true);
  };

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
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-[var(--color-primary)]">
            {t('admin.fabricLibrary.title')}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {t('admin.fabricLibrary.subtitle')}
          </p>
        </div>
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
      </div>

      <FabricFilterBar
        filters={filters}
        onChange={setFilters}
        totalCount={fabrics.length}
        matchCount={filtered.length}
      />

      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted-foreground)] text-xs">
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
                <FilterHeader
                  label={t('admin.fabricLibrary.cols.content')}
                  className="hidden lg:table-cell"
                  filter={
                    columnOptions.fibre.length > 0 ? (
                      <ColumnFilter
                        title={t('admin.fabricLibrary.cols.content')}
                        options={columnOptions.fibre}
                        excluded={filters.columns.fibre}
                        onChange={(next) => setColumnFilter('fibre', next)}
                      />
                    ) : (
                      <span />
                    )
                  }
                />
                <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">
                  {t('admin.fabricLibrary.cols.colours', {
                    defaultValue: 'Colours',
                  })}
                </th>
                <th className="text-right font-medium px-3 py-2 hidden md:table-cell">
                  {t('admin.fabricLibrary.cols.gsm')}
                </th>
                <th className="text-right font-medium px-3 py-2 hidden md:table-cell">
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
                <th className="text-right font-medium px-3 py-2">
                  {t('admin.fabricLibrary.cols.available')}
                </th>
                <SortHeader
                  label={t('admin.fabricLibrary.cols.updated')}
                  className="hidden xl:table-cell"
                  active={filters.sort === 'recent'}
                  direction="desc"
                  onClick={() => cycleSort('updated')}
                />
                <th className="text-right font-medium px-3 py-2">
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
                    className="border-t border-[var(--color-border)] hover:bg-[var(--color-muted)] cursor-pointer"
                    onClick={() => openEdit(f)}
                  >
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center">
                        {f.name}
                        {f.isBlended && (
                          <Badge
                            variant="outline"
                            className="ml-1.5 text-[9px] align-middle"
                          >
                            {t('admin.fabricLibrary.blended')}
                          </Badge>
                        )}
                      </div>
                      {f.typeLabel && (
                        <div className="text-[11px] font-normal text-[var(--color-muted-foreground)]">
                          {f.typeLabel}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell text-xs text-[var(--color-muted-foreground)]">
                      {contentSummary(f)}
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
                              <span
                                className="h-2.5 w-2.5 rounded-full border border-black/10"
                                style={{
                                  backgroundColor: c.hex || c.name.toLowerCase(),
                                }}
                              />
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
                      {f.pricePerUnit
                        ? `₹${Number(f.pricePerUnit)}${
                            f.unitOfMeasure
                              ? ` / ${UOM_SHORT[f.unitOfMeasure]}`
                              : ''
                          }`
                        : '—'}
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
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openStock(f);
                          }}
                        >
                          {t('admin.fabricLibrary.addStock')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(f);
                          }}
                        >
                          {t('admin.fabricLibrary.edit')}
                        </Button>
                      </div>
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
        title={
          editing
            ? `${t('admin.fabricLibrary.editFabric')} — ${editing.name}`
            : t('admin.fabricLibrary.newFabric')
        }
      >
        {/* Shared with the intake's FabricPicker — single source of
            truth for the fabric form. Key resets state when the
            dialog opens for a different row. */}
        <FabricEditorForm
          key={editing?.id ?? 'new'}
          editing={editing}
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
            ? `${t('admin.fabricLibrary.addStock')} — ${stockFabric.name}`
            : t('admin.fabricLibrary.addStock')
        }
      >
        <div className="space-y-3">
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            {t('admin.fabricLibrary.stockHelp')}
          </p>
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
                : t('admin.fabricLibrary.stock.record')}
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
        'font-medium px-3 py-2',
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
            'inline-flex items-center gap-1 transition-colors hover:text-[var(--color-foreground)]',
            align === 'right' && 'flex-row-reverse',
            active && 'text-[var(--color-primary)] font-semibold',
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

/** A plain (non-sortable) header cell that carries a column-filter funnel. */
function FilterHeader({
  label,
  align = 'left',
  className,
  filter,
}: {
  label: string;
  align?: 'left' | 'right';
  className?: string;
  filter: ReactNode;
}) {
  return (
    <th
      className={cn(
        'font-medium px-3 py-2',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        <span>{label}</span>
        {filter}
      </span>
    </th>
  );
}
