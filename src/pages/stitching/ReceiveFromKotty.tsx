import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Plus, X } from 'lucide-react';
import FloorShell from '@/components/layout/FloorShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { toast as sonnerToast } from 'sonner';
import { cn } from '@/lib/utils';
import { listVendors } from '@/api/vendors';
import { listCategories } from '@/api/categories';
import { createInbound } from '@/api/inbound';
import CategoryPicker from '@/components/styles/intake/CategoryPicker';
import type {
  CategoryWithStyleCode,
  Vendor,
  SizeMatrix,
  InboundLotPayload,
  StyleGender,
} from '@/api/types';

type Preset = 'alpha' | 'numeric';

const PRESETS: Record<Preset, readonly string[]> = {
  alpha: ['S', 'M', 'L', 'XL', 'XXL'],
  numeric: ['26', '28', '30', '32', '34', '36', '38', '40'],
};

interface LotRow {
  key: number;
  /** Vendor's own style code from the paper challan (e.g. Kotty `724`). */
  vendorStyleId: string;
  /** Vendor's lot id from the paper for THIS lot (e.g. `560MM`). */
  vendorLotNo: string;
  /** Used only when minting a fresh NOWI Style. */
  gender: StyleGender;
  /** Category id (resolved from the dropdown). 0 = unselected. */
  categoryId: number;
  preset: Preset;
  sizes: string[];
  matrix: SizeMatrix;
}

function makeMatrix(sizes: readonly string[]): SizeMatrix {
  return sizes.reduce<SizeMatrix>((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {});
}

function matrixTotal(m: SizeMatrix): number {
  return Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
}

function newRow(key: number, preset: Preset = 'alpha'): LotRow {
  const sizes = [...PRESETS[preset]];
  return {
    key,
    vendorStyleId: '',
    vendorLotNo: '',
    gender: 'W',
    categoryId: 0,
    preset,
    sizes,
    matrix: makeMatrix(sizes),
  };
}

export default function ReceiveFromKottyPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<CategoryWithStyleCode[]>([]);
  const [vendorId, setVendorId] = useState<string>('');
  const [challanNo, setChallanNo] = useState('');
  const [remark, setRemark] = useState('');
  const [rows, setRows] = useState<LotRow[]>([newRow(1)]);
  const nextKeyRef = useRef(2);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    listVendors()
      .then((vs) => {
        if (cancelled) return;
        setVendors(vs);
        const kotty =
          vs.find((v) => v.code?.toUpperCase() === 'KOTTY') ??
          vs.find((v) => v.consumptionApiEnabled) ??
          vs[0];
        if (kotty) setVendorId(kotty.id);
      })
      .catch(() => {
        if (!cancelled) setVendors([]);
      });
    listCategories()
      .then((cs) => {
        if (!cancelled) {
          // Only categories with a configured style code are usable —
          // the BE rejects others when minting a Style.
          setCategories(cs.filter((c) => c.styleCode && c.isActive));
        }
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grandTotal = useMemo(
    () => rows.reduce((sum, r) => sum + matrixTotal(r.matrix), 0),
    [rows],
  );

  const canSubmit =
    !!vendorId &&
    challanNo.trim().length > 0 &&
    rows.every(
      (r) =>
        r.vendorStyleId.trim().length > 0 &&
        r.vendorLotNo.trim().length > 0 &&
        r.categoryId > 0,
    ) &&
    grandTotal > 0;

  function updateMatrix(key: number, size: string, raw: string) {
    const qty = Math.max(0, parseInt(raw, 10) || 0);
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, matrix: { ...r.matrix, [size]: qty } } : r,
      ),
    );
  }

  function updateVendorLotNo(key: number, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, vendorLotNo: value } : r)),
    );
  }

  function updateVendorStyleId(key: number, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, vendorStyleId: value } : r)),
    );
  }

  function updateGender(key: number, value: StyleGender) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, gender: value } : r)),
    );
  }

  function updateCategoryId(key: number, value: number) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, categoryId: value } : r)),
    );
  }

  function addRow() {
    const key = nextKeyRef.current;
    nextKeyRef.current += 1;
    // Inherit the previous row's preset so a "bottoms" challan stays numeric
    const prevPreset = rows[rows.length - 1]?.preset ?? 'alpha';
    setRows((prev) => [...prev, newRow(key, prevPreset)]);
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  /**
   * Copy this row's size preset + matrix to every other row. Useful when
   * one challan has the same per-size qty across multiple styles (Kotty
   * often sends 100/100/100/100/100 across 3 style codes in one bundle).
   * Preserves each target row's vendorStyleId, vendorLot, gender, category.
   */
  /**
   * Within-lot copy: take the qty in `sourceSize` and broadcast to every
   * other size in the same row. Overwrites silently (per UX call). Used
   * when the lot has the same qty across all sizes — type one number,
   * tap ↪, done.
   */
  function copyValueToAllSizes(rowKey: number, sourceSize: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== rowKey) return r;
        const value = r.matrix[sourceSize] ?? 0;
        if (value <= 0) return r;
        const matrix: SizeMatrix = r.sizes.reduce((acc, s) => {
          acc[s] = value;
          return acc;
        }, {} as SizeMatrix);
        return { ...r, matrix };
      }),
    );
  }

  function applyMatrixToAll(sourceKey: number) {
    setRows((prev) => {
      const source = prev.find((r) => r.key === sourceKey);
      if (!source) return prev;
      return prev.map((r) => {
        if (r.key === sourceKey) return r;
        return {
          ...r,
          preset: source.preset,
          sizes: [...source.sizes],
          matrix: { ...source.matrix },
        };
      });
    });
  }

  function setPreset(key: number, preset: Preset) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const sizes = [...PRESETS[preset]];
        // Carry over any existing values for sizes that survive the swap.
        const matrix: SizeMatrix = sizes.reduce((acc, s) => {
          acc[s] = r.matrix[s] ?? 0;
          return acc;
        }, {} as SizeMatrix);
        return { ...r, preset, sizes, matrix };
      }),
    );
  }

  function addSize(key: number, label: string) {
    const clean = label.trim();
    if (!clean) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (r.sizes.includes(clean)) return r; // de-dupe silently
        return {
          ...r,
          sizes: [...r.sizes, clean],
          matrix: { ...r.matrix, [clean]: 0 },
        };
      }),
    );
  }

  function removeSize(key: number, size: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (r.sizes.length <= 1) return r; // keep at least one column
        const { [size]: _, ...rest } = r.matrix;
        return {
          ...r,
          sizes: r.sizes.filter((s) => s !== size),
          matrix: rest,
        };
      }),
    );
  }

  async function doSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const lots: InboundLotPayload[] = rows.map((r) => ({
        // lotNo intentionally omitted — BE generates LOT-YY-NNNNN.
        vendorStyleId: r.vendorStyleId.trim(),
        vendorLotNo: r.vendorLotNo.trim(),
        gender: r.gender,
        categoryId: r.categoryId,
        qtyIn: r.matrix,
      }));
      const res = await createInbound({
        vendorId: Number(vendorId),
        vendorChallanNo: challanNo.trim(),
        notes: remark.trim() || undefined,
        lots,
      });
      // Rich success toast: show the generated lot numbers + their
      // resolved Style IDs, with "(new)" tag on freshly minted styles.
      sonnerToast.success(
        res.lots.length === 1
          ? `Recorded ${res.lots[0].lotNo}`
          : `Recorded ${res.lots.length} lots`,
        {
          description: res.lots
            .map(
              (l) =>
                `${l.lotNo}  →  ${l.styleCode}${l.styleCreated ? '  (new)' : ''}`,
            )
            .join('\n'),
          duration: 6000,
        },
      );
      navigate('/floor');
    } catch {
      toast.show(t('stitching.receiveFromKotty.errorToast'), 'error');
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <FloorShell>
      {/* Page heading + back */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate('/floor')}
          className="inline-flex items-center gap-1 pr-3.5 pl-2 py-2 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[14px] font-medium text-[var(--color-foreground)] shadow-[0_1px_1px_rgba(14,23,48,0.03)] hover:bg-[var(--color-muted)] transition-colors"
        >
          <ArrowLeft size={18} />
          {t('common.back')}
        </button>
        <span className="text-[13px] text-[var(--color-muted-foreground)]">
          {t('common.total')}:{' '}
          <span className="tabular-nums font-semibold font-mono text-[var(--color-foreground)]">
            {grandTotal}
          </span>
        </span>
      </div>
      <h1 className="font-semibold text-[26px] leading-[1.1] tracking-[-0.01em] text-[var(--color-foreground)] mb-1">
        {t('stitching.receiveFromKotty.title')}
      </h1>
      <p className="mb-5 text-[13px] text-[var(--color-muted-foreground)]">
        {t('stitching.receiveFromKotty.subtitle', {
          defaultValue: 'Capture the challan, then the per-size quantities for each lot.',
        })}
      </p>

      {/* Form body — single column on mobile, two on desktop */}
      <div className="grid lg:grid-cols-[1fr_2fr] gap-4 pb-32">
        <Card>
          <CardHeader className="px-4 py-3">
            <CardTitle>{t('stitching.receiveFromKotty.challanSection', { defaultValue: 'Challan' })}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {/* Vendor picker collapses to a static label when only one
                active vendor exists — saves a select on the most
                common path. */}
            <div>
              <Label htmlFor="vendor" required>
                {t('stitching.receiveFromKotty.vendor')}
              </Label>
              {vendors.length <= 1 ? (
                <div className="flex items-center h-12 px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-muted)]/40 text-[15px]">
                  {vendors[0]?.name ?? '—'}
                  {vendors[0]?.code && (
                    <span className="ml-2 text-[var(--color-muted-foreground)] font-mono text-xs">
                      ({vendors[0].code})
                    </span>
                  )}
                </div>
              ) : (
                <Select
                  id="vendor"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    —
                  </option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.code})
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <Label htmlFor="challanNo" required>
                {t('stitching.receiveFromKotty.challanNo')}
              </Label>
              <Input
                id="challanNo"
                value={challanNo}
                onChange={(e) => setChallanNo(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="remark">
                {t('stitching.receiveFromKotty.remark', { defaultValue: 'Remark (optional)' })}
              </Label>
              <Input
                id="remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 py-3">
            <CardTitle>
              {t('stitching.receiveFromKotty.lotsSection', { defaultValue: 'Lots' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {rows.map((row, idx) => (
              <div
                key={row.key}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)] font-medium">
                    {t('stitching.receiveFromKotty.lotN', {
                      defaultValue: 'Lot {{n}}',
                      n: idx + 1,
                    })}
                  </span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label={t('stitching.receiveFromKotty.removeLot')}
                      className="text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] p-1"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                {/* Vendor's own style code from the paper. Drives the
                    NOWI Style ID lookup (or mint, if unseen). */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`vstyle-${row.key}`} required>
                      {t('stitching.receiveFromKotty.vendorStyleId', {
                        defaultValue: 'Vendor style ID (SKU)',
                      })}
                    </Label>
                    <Input
                      id={`vstyle-${row.key}`}
                      value={row.vendorStyleId}
                      onChange={(e) => updateVendorStyleId(row.key, e.target.value)}
                      placeholder="e.g. 724"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={`vlot-${row.key}`} required>
                      {t('stitching.receiveFromKotty.vendorLotNo')}
                    </Label>
                    <Input
                      id={`vlot-${row.key}`}
                      value={row.vendorLotNo}
                      onChange={(e) => updateVendorLotNo(row.key, e.target.value)}
                      placeholder="e.g. 560MM"
                      required
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`gender-${row.key}`} required>
                      {t('stitching.receiveFromKotty.gender', {
                        defaultValue: 'Gender',
                      })}
                    </Label>
                    <Select
                      id={`gender-${row.key}`}
                      value={row.gender}
                      onChange={(e) =>
                        updateGender(row.key, e.target.value as StyleGender)
                      }
                    >
                      <option value="W">
                        {t('stitching.receiveFromKotty.genderW', {
                          defaultValue: 'Women',
                        })}
                      </option>
                      <option value="M">
                        {t('stitching.receiveFromKotty.genderM', {
                          defaultValue: 'Men',
                        })}
                      </option>
                      <option value="U">
                        {t('stitching.receiveFromKotty.genderU', {
                          defaultValue: 'Unisex',
                        })}
                      </option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`cat-${row.key}`} required>
                      {t('stitching.receiveFromKotty.category', {
                        defaultValue: 'Category',
                      })}
                    </Label>
                    {/* Same searchable CategoryPicker the PD intake
                        uses — gives the floor manager search + the
                        "+ Add new" affordance when a Kotty challan
                        carries an unfamiliar category, instead of
                        scrolling a 20-item dropdown. */}
                    <CategoryPicker
                      categories={categories}
                      value={row.categoryId === 0 ? null : row.categoryId}
                      fallbackCode={null}
                      gender={
                        row.gender === 'M'
                          ? 'men'
                          : row.gender === 'U'
                            ? 'unisex'
                            : 'women'
                      }
                      onChange={({ categoryId }) =>
                        updateCategoryId(row.key, categoryId ?? 0)
                      }
                      onCategoryCreated={(c) => {
                        setCategories((all) => [...all, c]);
                        updateCategoryId(row.key, c.id);
                      }}
                    />
                  </div>
                </div>

                <SizeMatrixEditor
                  row={row}
                  onPreset={(p) => setPreset(row.key, p)}
                  onUpdate={(s, v) => updateMatrix(row.key, s, v)}
                  onAddSize={(label) => addSize(row.key, label)}
                  onRemoveSize={(s) => removeSize(row.key, s)}
                  onCopyToAll={(s) => copyValueToAllSizes(row.key, s)}
                  totalLabel={t('common.total')}
                />
                <div className="flex items-center justify-between gap-2">
                  {/* "Apply to all styles" — broadcasts this row's size
                      matrix to every other row in the form. Only renders
                      with 2+ rows and a non-empty matrix (nothing to
                      broadcast otherwise). */}
                  {rows.length > 1 && matrixTotal(row.matrix) > 0 ? (
                    <button
                      type="button"
                      onClick={() => applyMatrixToAll(row.key)}
                      className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                    >
                      {t('stitching.receiveFromKotty.applyToAll', {
                        defaultValue: 'Apply size matrix to all styles',
                      })}
                    </button>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    {t('common.total')}:{' '}
                    <span className="tabular-nums font-medium text-[var(--color-foreground)]">
                      {matrixTotal(row.matrix)}
                    </span>
                  </span>
                </div>
              </div>
            ))}
            {/* Dashed accent-on-hover plus button — matches design's
                "Add another style" affordance. */}
            <button
              type="button"
              onClick={addRow}
              className="group w-full mt-1 px-3 py-3 rounded-[10px] border border-dashed border-[var(--color-border-strong)] text-[14px] font-medium text-[var(--color-foreground)] bg-transparent hover:bg-[var(--color-primary-soft)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus size={16} />
              {t('stitching.receiveFromKotty.addLot')}
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 lg:bottom-auto lg:top-auto inset-x-0 lg:left-auto lg:right-6 lg:bottom-6 z-10 lg:z-30 border-t lg:border lg:rounded-[var(--radius-lg)] border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur lg:shadow-[var(--shadow-pop)] pb-[env(safe-area-inset-bottom)] lg:pb-3 lg:pt-3 lg:px-4">
        <div className="max-w-3xl lg:max-w-none mx-auto px-4 lg:px-0 py-3 lg:py-0 flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--color-muted-foreground)]">
            {t('common.total')}:{' '}
            <span className="tabular-nums font-medium text-[var(--color-foreground)]">
              {grandTotal}
            </span>{' '}
            {t('common.units')}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/floor')}
              disabled={submitting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!canSubmit || submitting}
            >
              {t('common.submit')}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('stitching.receiveFromKotty.confirmTitle')}
        initialFocusRef={cancelBtnRef}
        footer={
          <>
            <Button
              ref={cancelBtnRef}
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={doSubmit} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('stitching.receiveFromKotty.totalUnits', { total: grandTotal })}</p>
      </Dialog>
    </FloorShell>
  );
}

function SizeMatrixEditor({
  row,
  onPreset,
  onUpdate,
  onAddSize,
  onRemoveSize,
  onCopyToAll,
}: {
  row: LotRow;
  onPreset: (p: Preset) => void;
  onUpdate: (size: string, raw: string) => void;
  onAddSize: (label: string) => void;
  onRemoveSize: (size: string) => void;
  onCopyToAll: (sourceSize: string) => void;
  totalLabel: string;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(e?: FormEvent | KeyboardEvent) {
    e?.preventDefault();
    const v = draft.trim();
    if (v) onAddSize(v);
    setDraft('');
    setAdding(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="mb-0">{t('stitching.receiveFromKotty.sizeMatrix')}</Label>
        <div className="inline-flex p-[3px] rounded-full bg-[var(--color-muted)] border border-[var(--color-border)]">
          {(['alpha', 'numeric'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPreset(p)}
              className={cn(
                'px-3 py-1 text-[12px] font-semibold rounded-full transition-colors',
                row.preset === p
                  ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[0_1px_2px_rgba(14,23,48,0.08),0_0_0_1px_var(--color-border)]'
                  : 'text-[var(--color-muted-foreground)]',
              )}
            >
              {t(`stitching.receiveFromKotty.presets.${p}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">
        {row.sizes.map((s) => (
          <div key={s} className="flex flex-col">
            <div className="relative h-5 mb-1 flex items-center justify-center group">
              <span className="text-xs font-medium tabular-nums">{s}</span>
              {row.sizes.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveSize(s)}
                  aria-label={t('stitching.receiveFromKotty.removeSize', {
                    defaultValue: 'Remove {{size}}',
                    size: s,
                  })}
                  className="absolute -top-1 -right-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)] hover:text-white"
                >
                  <X size={10} />
                </button>
              )}
            </div>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="0"
              value={row.matrix[s] ? String(row.matrix[s]) : ''}
              onChange={(e) =>
                onUpdate(s, e.target.value.replace(/\D/g, ''))
              }
              className="text-center px-1"
            />
            {/* ↪ "copy this value to every other size in this lot".
                Renders only when this cell has a positive value AND
                there's more than one size in the row (nothing to fill
                otherwise). Tap = silent overwrite of all other cells. */}
            {(row.matrix[s] ?? 0) > 0 && row.sizes.length > 1 ? (
              <button
                type="button"
                onClick={() => onCopyToAll(s)}
                className="mt-1 text-[10px] font-semibold text-[var(--color-primary)] hover:underline"
                title={t('stitching.receiveFromKotty.copyToAll', {
                  defaultValue: 'Use {{n}} for all sizes',
                  n: row.matrix[s] ?? 0,
                })}
              >
                {t('stitching.receiveFromKotty.copyToAllShort', {
                  defaultValue: '↪ all',
                })}
              </button>
            ) : (
              <span className="mt-1 h-3" />
            )}
          </div>
        ))}

        {/* Add-size cell */}
        <div className="flex flex-col">
          <div className="h-5 mb-1" />
          {adding ? (
            <form onSubmit={commit}>
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setDraft('');
                    setAdding(false);
                  }
                }}
                autoFocus
                placeholder="e.g. 42"
                className="text-center px-1"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="h-12 rounded-[10px] border border-dashed border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] flex items-center justify-center"
              aria-label={t('stitching.receiveFromKotty.addSize', { defaultValue: 'Add size' })}
              title={t('stitching.receiveFromKotty.addSize', { defaultValue: 'Add size' })}
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
