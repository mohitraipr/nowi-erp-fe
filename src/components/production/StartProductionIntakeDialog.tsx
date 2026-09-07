import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Factory, X, AlertTriangle, ArrowLeft, Loader2, Upload } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import QtyTable from '@/components/production/QtyTable';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/lib/useDebounced';
import { listColourMaster, createColourMaster } from '@/api/styles';
import { searchCatalog, type CatalogStyle, type CreateBatchBody } from '@/api/production';
import { getBrands, createBrand, type Brand } from '@/api/brands';
import TailorPicker from '@/components/production/TailorPicker';
import { uploadPhoto } from '@/api/storage';
import type { Colour } from '@/api/types';

type Mode = 'existing' | 'external';

/** Common apparel size presets for external entries — one alpha row, one numeric. */
const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '26', '28', '30', '32', '34', '36', '38', '40'];

interface ExistingSel {
  /** EasyEcom style key — the batch's real identity. Always present. */
  styleKey: string;
  /** ERP style behind it, when one exists. Null for catalog-only styles. */
  styleId: number | null;
  styleRef: string | null;
  name: string | null;
  imageUrl: string | null;
  sizes: { sku: string; size: string; inFlightQty: number }[];
  alreadyInProduction: boolean;
}

/**
 * The header "Start production" intake — modelled on the intake form's
 * "relive an old style" search: one combobox finds an existing Nowi style,
 * and its "+ Add" row switches to the new-item (another brand's SKU) form,
 * carrying the typed text over as the SKU. Quantities are captured here;
 * "Add to pipeline" stages it, "Send to production" opens it on the floor.
 */
export default function StartProductionIntakeDialog({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (body: CreateBatchBody) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('existing');

  // ── existing-style search (server-side over the EasyEcom catalog) ──
  const [results, setResults] = useState<CatalogStyle[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<ExistingSel | null>(null);

  // ── external brand ───────────────────────────────────────────────
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<number | ''>('');
  const [colours, setColours] = useState<Colour[]>([]);
  const [colourId, setColourId] = useState<number | ''>('');
  const [externalSku, setExternalSku] = useState('');
  const [extSizes, setExtSizes] = useState<Record<string, boolean>>({});
  // Uploaded image for the brand batch (optional): GCS object path + preview.
  const [imagePath, setImagePath] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [uploading, setUploading] = useState(false);

  // ── shared qty map (keyed by item sku) ───────────────────────────
  const [qty, setQty] = useState<Record<string, number>>({});
  // Only used when the lot opens straight on the floor — that's when the lot
  // number gains its `-RAJ`. A lot going to the pipeline is named later.
  const [tailorId, setTailorId] = useState<number | ''>('');

  // Reset everything when the dialog opens; load the picker's data once.
  useEffect(() => {
    if (!open) return;
    setMode('existing');
    setSel(null);
    setBrandId('');
    setColourId('');
    setExternalSku('');
    setExtSizes({});
    setImagePath('');
    setImagePreview('');
    setQty({});
    setQuery('');
    setTailorId('');
    void getBrands().then(setBrands).catch(() => undefined);
    void listColourMaster().then(setColours).catch(() => undefined);
  }, [open]);

  // Server-side search over the EasyEcom catalog — everything Nowi sells is
  // producible, whether or not the ERP design pipeline ever knew about it. The
  // BE collapses versions, signs images and returns each style's sizes, so
  // picking one needs no second round-trip.
  const debouncedQuery = useDebounced(query, 250);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    void searchCatalog(debouncedQuery)
      .then((r) => {
        if (!cancelled) setResults(r.rows);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedQuery]);

  const styleOptions = useMemo<ComboboxOption<string>[]>(
    () =>
      results.map((s) => ({
        value: s.styleKey,
        label: s.styleKey,
        sublabel: s.name && s.name !== s.styleKey ? s.name : undefined,
        leading: s.imageUrl ? (
          <img src={s.imageUrl} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
        ) : (
          <div className="h-7 w-7 shrink-0 rounded bg-[var(--color-muted)]" />
        ),
      })),
    [results],
  );

  const pickStyle = (styleKey: string) => {
    const s = results.find((x) => x.styleKey === styleKey);
    if (!s) return;
    setSel({
      styleKey: s.styleKey,
      styleId: s.linkedStyleId,
      styleRef: s.erpStyleId ?? s.styleKey,
      name: s.name,
      imageUrl: s.imageUrl,
      sizes: s.sizes,
      alreadyInProduction: s.alreadyInProduction,
    });
    const seeded: Record<string, number> = {};
    for (const z of s.sizes) seeded[z.sku] = 0;
    setQty(seeded);
    setExtSizes({}); // fresh manual-size picker when the style has no resolved sizes
  };

  // "+ Add" on the combobox → switch to the new-item form, carrying the typed
  // text over as the SKU (mirrors relive's typed-code path).
  const startExternal = (typed: string) => {
    setMode('external');
    setExternalSku(typed.trim());
    setExtSizes({});
    setQty({});
  };

  const backToPicker = () => {
    setMode('existing');
    setExternalSku('');
    setExtSizes({});
    setBrandId('');
    setColourId('');
    setImagePath('');
    setImagePreview('');
    setQty({});
  };

  // "+ Add" inside the colour dropdown creates the typed colour and selects it.
  const addColour = (typed: string) => {
    const name = typed.trim();
    if (!name) return;
    void createColourMaster({ name })
      .then((c) => {
        setColours((prev) =>
          [...prev.filter((x) => x.id !== c.id), c].sort((a, z) => a.name.localeCompare(z.name)),
        );
        setColourId(c.id);
      })
      .catch(() =>
        toast.show(
          t('admin.production.intake.colourFailed', { defaultValue: "Couldn't add that colour." }),
          'error',
        ),
      );
  };

  const onImageFile = (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setImagePreview(URL.createObjectURL(file));
    void uploadPhoto('production_batch', 'new', file)
      .then(({ objectPath }) => setImagePath(objectPath))
      .catch(() => {
        setImagePreview('');
        toast.show(
          t('admin.production.intake.imageFailed', { defaultValue: "Couldn't upload that image." }),
          'error',
        );
      })
      .finally(() => setUploading(false));
  };

  // "+ Add" inside the brand dropdown creates the typed brand and selects it.
  const addBrand = (typed: string) => {
    const name = typed.trim();
    if (!name) return;
    void createBrand(name)
      .then((b) => {
        setBrands((prev) =>
          [...prev.filter((x) => x.id !== b.id), b].sort((a, z) => a.name.localeCompare(z.name)),
        );
        setBrandId(b.id);
      })
      .catch(() =>
        toast.show(
          t('admin.production.intake.brandFailed', { defaultValue: "Couldn't add that brand." }),
          'error',
        ),
      );
  };

  const setQtyFor = (sku: string, raw: string) =>
    setQty((prev) => ({ ...prev, [sku]: Math.max(0, Number.parseInt(raw, 10) || 0) }));

  const toggleExtSize = (size: string) =>
    setExtSizes((prev) => ({ ...prev, [size]: !prev[size] }));

  const extActiveSizes = useMemo(() => SIZE_PRESETS.filter((s) => extSizes[s]), [extSizes]);
  // External qty is keyed by SIZE (not the SKU), so editing the SKU text after
  // typing quantities doesn't orphan them. The SKU is derived only at submit.
  const extSku = (size: string) => `${externalSku.trim()}-${size}`;

  const total = useMemo(() => {
    if (mode === 'existing') {
      if (!sel) return 0;
      // No resolved sizes → the manual size-picker (qty keyed by size, like external).
      if (sel.sizes.length === 0) return extActiveSizes.reduce((a, s) => a + (qty[s] ?? 0), 0);
      return sel.sizes.reduce((a, z) => a + (qty[z.sku] ?? 0), 0);
    }
    return extActiveSizes.reduce((a, s) => a + (qty[s] ?? 0), 0);
  }, [mode, sel, qty, extActiveSizes]);

  const canSubmit =
    total > 0 &&
    !uploading &&
    (mode === 'existing'
      ? sel != null && (sel.sizes.length > 0 || extActiveSizes.length > 0)
      : brandId !== '' &&
        colourId !== '' &&
        externalSku.trim().length > 0 &&
        extActiveSizes.length > 0);

  const build = (directToProduction: boolean): CreateBatchBody | null => {
    if (mode === 'existing') {
      if (!sel) return null;
      const items =
        sel.sizes.length > 0
          ? sel.sizes
              .filter((z) => (qty[z.sku] ?? 0) > 0)
              .map((z) => ({ sku: z.sku, size: z.size, qtyPlanned: qty[z.sku] ?? 0 }))
          : // No resolved sizes → manually-picked; SKU follows the ERP form
            // `<styleId>-<size>` so the BE persists them to `skus` (create()).
            extActiveSizes
              .filter((s) => (qty[s] ?? 0) > 0)
              .map((s) => ({ sku: `${sel.styleRef ?? ''}-${s}`, size: s, qtyPlanned: qty[s] ?? 0 }));
      // styleKey is the identity; styleId is the optional ERP link, absent for
      // the many catalog styles that never went through the design pipeline.
      return {
        origin: 'style',
        styleKey: sel.styleKey,
        styleId: sel.styleId ?? undefined,
        directToProduction,
        tailorId: directToProduction && tailorId !== '' ? tailorId : undefined,
        items,
      };
    }
    if (brandId === '' || colourId === '') return null;
    return {
      origin: 'external',
      brandId,
      externalSku: externalSku.trim(),
      colourId,
      imagePath: imagePath || undefined,
      directToProduction,
      tailorId: directToProduction && tailorId !== '' ? tailorId : undefined,
      items: extActiveSizes
        .filter((s) => (qty[s] ?? 0) > 0)
        .map((s) => ({ sku: extSku(s), size: s, qtyPlanned: qty[s] ?? 0 })),
    };
  };

  const submit = (directToProduction: boolean) => {
    const body = build(directToProduction);
    if (body) onConfirm(body);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidthClassName="max-w-2xl"
      title={
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary)]">
          {t('admin.production.intake.title', { defaultValue: 'Start production' })}
        </div>
      }
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !canSubmit}
            onClick={() => submit(false)}
          >
            {t('admin.production.intake.addToPlanning', {
              defaultValue: 'Add to pipeline · {{n}}',
              n: total,
            })}
          </Button>
          {/* Straight to the floor needs the tailor — their code is minted into
              the lot number, so it can't be filled in afterwards. */}
          <Button
            size="sm"
            disabled={busy || !canSubmit || tailorId === ''}
            onClick={() => submit(true)}
          >
            <Factory size={14} />
            <span className="ml-1">
              {t('admin.production.intake.sendDirect', {
                defaultValue: 'Send to production · {{n}}',
                n: total,
              })}
            </span>
          </Button>
        </>
      }
    >
      {mode === 'existing' ? (
        <div className="space-y-3">
          {!sel && (
            <>
              <Label>{t('admin.production.intake.styleLabel', { defaultValue: 'Style' })}</Label>
              <Combobox<string>
                value={null}
                options={styleOptions}
                onChange={(key) => {
                  if (key != null) pickStyle(key);
                }}
                onQueryChange={setQuery}
                serverFiltered
                loading={searching}
                loadingLabel={t('common.loading', { defaultValue: 'Loading…' })}
                placeholder={t('admin.production.intake.searchStyle', {
                  defaultValue: 'Search a style by name, code or SKU…',
                })}
                ariaLabel={t('admin.production.intake.styleLabel', { defaultValue: 'Style' })}
              />
              {/* External-brand entry is a deliberate, secondary action — not a
                  row inside the style dropdown (which was too easy to mis-click). */}
              <button
                type="button"
                onClick={() => startExternal('')}
                className="text-xs font-medium text-[var(--color-primary)] hover:underline"
              >
                {t('admin.production.intake.addExternal', {
                  defaultValue: "Add another brand's SKU",
                })}
              </button>
            </>
          )}

          {sel && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-2.5">
                {sel.imageUrl ? (
                  <img
                    src={sel.imageUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded bg-[var(--color-muted)]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{sel.styleKey}</div>
                  {sel.name && sel.name !== sel.styleKey && (
                    <div className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {sel.name}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSel(null)}
                  className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  aria-label={t('admin.production.intake.change', { defaultValue: 'Change style' })}
                >
                  <X size={16} />
                </button>
              </div>

              {sel.alreadyInProduction && (
                <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                  <AlertTriangle size={14} className="shrink-0" />
                  {t('admin.production.intake.alreadyInProduction', {
                    defaultValue: 'Already in production',
                  })}
                </div>
              )}

              {sel.sizes.length > 0 ? (
                <QtyTable
                  showInFlight
                  rows={sel.sizes.map((z) => ({
                    key: z.sku,
                    size: z.size,
                    sku: z.sku,
                    inFlight: z.inFlightQty,
                    qty: qty[z.sku] ?? 0,
                  }))}
                  onQty={setQtyFor}
                />
              ) : (
                // Style not yet on EasyEcom (no resolved sizes) → pick sizes manually.
                // The chosen sizes persist to `skus` on produce, so it auto-resolves next time.
                <>
                  <div>
                    <Label>
                      {t('admin.production.intake.pickSizes', {
                        defaultValue: 'Pick sizes — not yet on EasyEcom',
                      })}
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {SIZE_PRESETS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleExtSize(s)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                            extSizes[s]
                              ? 'bg-[var(--color-primary)] text-white'
                              : 'bg-[var(--color-surface-2)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  {extActiveSizes.length > 0 && (
                    <QtyTable
                      rows={extActiveSizes.map((s) => ({
                        key: s,
                        size: s,
                        sku: `${sel.styleRef ?? ''}-${s}`,
                        inFlight: 0,
                        qty: qty[s] ?? 0,
                      }))}
                      onQty={setQtyFor}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={backToPicker}
            className="flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline"
          >
            <ArrowLeft size={13} />
            {t('admin.production.intake.backToStyles', { defaultValue: 'Back to styles' })}
          </button>

          <div>
            <Label>{t('admin.production.intake.brand', { defaultValue: 'Brand' })}</Label>
            <Combobox<number>
              value={brandId === '' ? null : brandId}
              options={brands.map((b) => ({ value: b.id, label: b.name }))}
              onChange={(id) => setBrandId(id ?? '')}
              onAddNew={addBrand}
              addNewLabel={t('admin.production.intake.addBrand', { defaultValue: 'Add a new brand' })}
              placeholder={t('admin.production.intake.pickBrand', { defaultValue: 'Choose a brand…' })}
              ariaLabel={t('admin.production.intake.brand', { defaultValue: 'Brand' })}
            />
          </div>

          <div>
            <Label required>{t('admin.production.intake.colour', { defaultValue: 'Colour' })}</Label>
            <Combobox<number>
              value={colourId === '' ? null : colourId}
              options={colours.map((c) => ({
                value: c.id,
                label: c.name,
                leading: (
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-[var(--color-border)]"
                    style={{ background: c.hex ?? c.name.toLowerCase() }}
                  />
                ),
              }))}
              onChange={(id) => setColourId(id ?? '')}
              onAddNew={addColour}
              addNewLabel={t('admin.production.intake.addColour', { defaultValue: 'Add a new colour' })}
              placeholder={t('admin.production.intake.pickColour', { defaultValue: 'Choose a colour…' })}
              ariaLabel={t('admin.production.intake.colour', { defaultValue: 'Colour' })}
            />
          </div>

          <div>
            <Label>{t('admin.production.intake.image', { defaultValue: 'Image (optional)' })}</Label>
            <div className="flex items-center gap-3">
              {imagePreview ? (
                <img
                  src={imagePreview}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                </div>
              )}
              <label className="cursor-pointer text-sm font-semibold text-[var(--color-primary)] hover:underline">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => onImageFile(e.target.files?.[0])}
                />
                {uploading
                  ? t('common.uploading', { defaultValue: 'Uploading…' })
                  : imagePath
                    ? t('admin.production.intake.changeImage', { defaultValue: 'Change image' })
                    : t('admin.production.intake.uploadImage', { defaultValue: 'Upload image' })}
              </label>
            </div>
          </div>

          <div>
            <Label>{t('admin.production.intake.sku', { defaultValue: 'SKU code' })}</Label>
            <Input
              value={externalSku}
              onChange={(e) => setExternalSku(e.target.value)}
              placeholder={t('admin.production.intake.skuPlaceholder', {
                defaultValue: 'e.g. AZRT-SHIRT-2201',
              })}
            />
          </div>

          <div>
            <Label>{t('admin.production.intake.sizes', { defaultValue: 'Sizes to make' })}</Label>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleExtSize(s)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    extSizes[s]
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {extActiveSizes.length > 0 && (
            <QtyTable
              rows={extActiveSizes.map((s) => ({
                key: s,
                size: s,
                sku: externalSku.trim() ? extSku(s) : '—',
                inFlight: 0,
                qty: qty[s] ?? 0,
              }))}
              onQty={setQtyFor}
            />
          )}
        </div>
      )}

      {/* Shared by both modes. Only "Send to production" needs it — a lot added
          to the pipeline is named on its way out — so it shows as soon as
          there's something to make, not once quantities are typed: the button
          it gates would otherwise sit disabled with no visible cause. */}
      {(mode === 'external' || sel) && (
        <div className="mt-4">
          <Label>
            {t('admin.production.intake.tailorLabel', {
              defaultValue: 'Tailor (to send straight to the floor)',
            })}
          </Label>
          <TailorPicker
            value={tailorId === '' ? null : tailorId}
            onChange={(id) => setTailorId(id ?? '')}
          />
        </div>
      )}
    </Dialog>
  );
}
