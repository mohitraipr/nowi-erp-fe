import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import FabricEditorForm from '@/components/fabrics/FabricEditorForm';
import { useToast } from '@/components/ui/toast';
import { listFabrics } from '@/api/styles';
import { createFabricChallan } from '@/api/fabricChallans';
import { createVendor, listVendors } from '@/api/vendors';
import type { Fabric, FabricUnitOfMeasure, Vendor } from '@/api/types';
import { useAuth } from '@/context/auth';
import { hasAnyRole } from '@/lib/userRoles';

const UOM_SHORT: Record<FabricUnitOfMeasure, string> = {
  meter: 'm',
  kg: 'kg',
  oz: 'oz',
};

/** A single editable challan line. `key` is a stable local id for React. */
interface LineRow {
  key: number;
  fabricId: number | null;
  fabricColourId: number | null;
  quantity: string;
  /** Rate per unit (₹ / UoM). Optional — blank means "not captured". */
  price: string;
}

const emptyLine = (key: number): LineRow => ({
  key,
  fabricId: null,
  fabricColourId: null,
  quantity: '',
  price: '',
});

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * "Receive fabric" — records one supplier challan as a header plus N receipt
 * lines. Each line is the shared `FabricPicker` (pick existing fabric+colour
 * or create one inline) with its own quantity. Submitting writes a positive
 * receipt to every fabric's stock ledger, grouped under the new challan.
 */
export default function ReceiveFabricChallan() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [header, setHeader] = useState({
    challanNo: '',
    challanDate: todayIso(),
    vendorId: '' as number | '',
    note: '',
  });
  const { user } = useAuth();
  // Creating a vendor is gated to admin / production_lead on the server, so
  // only offer the quick-add to roles that would not get a 403.
  const canAddVendor = hasAnyRole(user, ['admin', 'production_lead']);
  const [fabricSeed, setFabricSeed] = useState('');
  const [fabricForKey, setFabricForKey] = useState<number | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorSaving, setVendorSaving] = useState(false);
  const vendorRef = useRef<HTMLInputElement>(null);

  const nextKey = useRef(2);
  const [lines, setLines] = useState<LineRow[]>([emptyLine(1)]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void listFabrics().then((rows) => {
      if (alive) setFabrics(rows);
    });
    void listVendors()
      .then((rows) => {
        if (alive) setVendors(rows.filter((v) => v.isActive));
      })
      .catch(() => {
        // A supplier is required, so a silent failure would leave the form
        // permanently unsubmittable with nothing on screen to explain it.
        if (alive) {
          toast.show(
            t('admin.fabricChallan.vendorLoadError', {
              defaultValue: 'Could not load suppliers. Reload to try again.',
            }),
            'error',
          );
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const fabricById = useMemo(
    () => new Map(fabrics.map((f) => [f.id, f])),
    [fabrics],
  );

  /**
   * Fabric options. Stock lives on the colour child, so a fabric with no
   * colours has nowhere to put it — those are listed but not selectable,
   * with the reason inline rather than a silent rejection at submit.
   */
  const fabricOptions = useMemo(
    () =>
      fabrics.map((f) => {
        const colours = f.colours?.length ?? 0;
        return {
          value: f.id,
          label: f.name,
          // Just the fabric's own identity — the colour is the next dropdown's
          // job. The only sublabel worth adding is why a row can't be picked.
          sublabel: colours
            ? (f.code ?? undefined)
            : t('admin.fabricChallan.noColours', {
                defaultValue: 'Add a colour first',
              }),
          disabled: colours === 0,
          searchText: `${f.name} ${f.code ?? ''}`,
        };
      }),
    [fabrics, t],
  );

  /** Colour options for the fabric chosen on this line. */
  const colourOptionsFor = (fabricId: number | null) => {
    const f = fabricId != null ? fabricById.get(fabricId) : undefined;
    const uom = f?.unitOfMeasure ? UOM_SHORT[f.unitOfMeasure] : '';
    return (f?.colours ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      sublabel: [
        c.code,
        c.availableQuantity != null
          ? `${c.availableQuantity}${uom ? ` ${uom}` : ''} in stock`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      searchText: `${c.name} ${c.code ?? ''}`,
    }));
  };

  /**
   * Picking a fabric preselects its colour when there is exactly one. `known`
   * lets a just-created fabric be passed in directly — it isn't in `fabricById`
   * yet, because that memo is derived from state this render hasn't seen.
   */
  const chooseFabric = (key: number, fabricId: number | null, known?: Fabric) => {
    const f = known ?? (fabricId != null ? fabricById.get(fabricId) : undefined);
    const only = f?.colours?.length === 1 ? f.colours[0].id : null;
    patchLine(key, { fabricId, fabricColourId: only });
  };

  const addLine = () => {
    setLines((ls) => [...ls, emptyLine(nextKey.current++)]);
  };
  const removeLine = (key: number) => {
    setLines((ls) => (ls.length <= 1 ? ls : ls.filter((l) => l.key !== key)));
  };
  const patchLine = (key: number, patch: Partial<LineRow>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  // The colour child is the stocked unit, so every line must name one —
  // mirror the server rule client-side so the operator sees the gap inline.
  const colourMissing = (l: LineRow): boolean =>
    l.fabricId != null && l.fabricColourId == null;

  // A line is complete when it names a fabric colour and a positive quantity.
  // Price is optional; if given it must be non-negative.
  const lineReady = (l: LineRow) =>
    l.fabricId != null &&
    l.fabricColourId != null &&
    Number(l.quantity) > 0 &&
    (l.price === '' || Number(l.price) >= 0);

  const headerReady =
    header.challanNo.trim() !== '' &&
    header.challanDate !== '' &&
    header.vendorId !== '';

  const canSubmit = headerReady && lines.every(lineReady) && !saving;

  const uomFor = (fabricId: number | null): string => {
    const f = fabricId != null ? fabricById.get(fabricId) : undefined;
    return f?.unitOfMeasure ? UOM_SHORT[f.unitOfMeasure] : '';
  };

  /** Quick-add a supplier: create it, merge into the list, select it. */
  const submitVendor = async () => {
    const name = vendorName.trim();
    if (!name) return;
    setVendorSaving(true);
    try {
      const v = await createVendor(name);
      setVendors((vs) => [...vs, v].sort((a, b) => a.name.localeCompare(b.name)));
      setHeader((h) => ({ ...h, vendorId: Number(v.id) }));
      setVendorOpen(false);
      setVendorName('');
    } catch {
      toast.show(
        t('admin.fabricChallan.addVendorError', {
          defaultValue: 'Could not add that supplier.',
        }),
        'error',
      );
    } finally {
      setVendorSaving(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await createFabricChallan({
        direction: 'in',
        challanNo: header.challanNo.trim(),
        challanDate: header.challanDate,
        vendorId: header.vendorId === '' ? null : header.vendorId,
        note: header.note.trim() || null,
        lines: lines.map((l) => ({
          fabricColourId: l.fabricColourId as number,
          quantity: Number(l.quantity),
          pricePerUnit: l.price === '' ? null : Number(l.price),
        })),
      });
      toast.show(
        t('admin.fabricChallan.savedToast', {
          defaultValue: 'Challan recorded — stock updated.',
        }),
      );
      navigate('/fabric-library');
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        t('admin.fabricChallan.saveError', {
          defaultValue: 'Could not record the challan.',
        });
      toast.show(Array.isArray(msg) ? msg.join(' ') : String(msg), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <button
        type="button"
        onClick={() => navigate('/fabric-library')}
        className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft size={15} />
        {t('admin.fabricChallan.back', { defaultValue: 'Back to Fabric Library' })}
      </button>

      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">
          {t('admin.fabricChallan.title', { defaultValue: 'Receive fabric' })}
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          {t('admin.fabricChallan.subtitle', {
            defaultValue:
              'Record a supplier challan. Each line adds stock to that fabric.',
          })}
        </p>
      </div>

      {/* ── Challan header ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="challanNo">
            {t('admin.fabricChallan.challanNo', { defaultValue: 'Challan no.' })}
          </Label>
          <Input
            id="challanNo"
            autoFocus
            value={header.challanNo}
            onChange={(e) =>
              setHeader((h) => ({ ...h, challanNo: e.target.value }))
            }
            placeholder="13428"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="challanDate">
            {t('admin.fabricChallan.challanDate', { defaultValue: 'Challan date' })}
          </Label>
          <Input
            id="challanDate"
            type="date"
            value={header.challanDate}
            onChange={(e) =>
              setHeader((h) => ({ ...h, challanDate: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendor">
            {t('admin.fabricChallan.vendor', { defaultValue: 'Supplier' })}
          </Label>
          <Combobox
            value={header.vendorId === '' ? null : header.vendorId}
            options={vendors.map((v) => ({
              value: Number(v.id),
              label: v.name,
            }))}
            onChange={(id) =>
              setHeader((h) => ({ ...h, vendorId: (id as number) ?? '' }))
            }
            onAddNew={
              canAddVendor
                ? (typed) => {
                    setVendorName(typed);
                    setVendorOpen(true);
                  }
                : undefined
            }
            addNewLabel={t('admin.fabricChallan.addVendor', {
              defaultValue: 'Add supplier',
            })}
            placeholder={t('admin.fabricChallan.vendorNone', {
              defaultValue: 'Choose a supplier…',
            })}
            ariaLabel={t('admin.fabricChallan.vendor', { defaultValue: 'Supplier' })}
          />
        </div>
      </div>

      {/* ── Lines ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-[var(--color-foreground)]">
            {t('admin.fabricChallan.lines', { defaultValue: 'Fabrics on this challan' })}
          </h2>
          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus size={15} />
            <span className="ml-1">
              {t('admin.fabricChallan.addLine', { defaultValue: 'Add line' })}
            </span>
          </Button>
        </div>

        {lines.map((line, idx) => (
          <div
            key={line.key}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>
                {t('admin.fabricChallan.fabric', { defaultValue: 'Fabric' })}{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  #{idx + 1}
                </span>
              </Label>
              <Combobox
                value={line.fabricId}
                options={fabricOptions}
                onChange={(id) => chooseFabric(line.key, (id as number) ?? null)}
                onAddNew={(typed) => {
                  setFabricSeed(typed);
                  setFabricForKey(line.key);
                }}
                addNewLabel={t('admin.fabricChallan.addFabric', {
                  defaultValue: 'Add fabric',
                })}
                placeholder={t('admin.fabricChallan.fabricPh', {
                  defaultValue: 'Choose a fabric…',
                })}
                ariaLabel={t('admin.fabricChallan.fabric', { defaultValue: 'Fabric' })}
              />
            </div>
            <div className="w-full sm:w-44 space-y-1.5">
              <Label>
                {t('admin.fabricChallan.colour', { defaultValue: 'Colour' })}
              </Label>
              <Combobox
                value={line.fabricColourId}
                options={colourOptionsFor(line.fabricId)}
                onChange={(id) =>
                  patchLine(line.key, { fabricColourId: (id as number) ?? null })
                }
                disabled={line.fabricId == null}
                placeholder={t('admin.fabricChallan.colourPh', {
                  defaultValue: 'Choose a colour…',
                })}
                ariaLabel={t('admin.fabricChallan.colour', { defaultValue: 'Colour' })}
              />
            </div>
            <div className="w-full sm:w-28 space-y-1.5">
              <Label>
                {t('admin.fabricChallan.quantity', { defaultValue: 'Quantity' })}
                {uomFor(line.fabricId) ? ` (${uomFor(line.fabricId)})` : ''}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={line.quantity}
                onChange={(e) =>
                  patchLine(line.key, { quantity: e.target.value })
                }
                placeholder="22.5"
              />
            </div>
            <div className="w-full sm:w-28 space-y-1.5">
              <Label>
                {t('admin.fabricChallan.price', { defaultValue: 'Price' })}
                {uomFor(line.fabricId) ? ` (₹/${uomFor(line.fabricId)})` : ' (₹)'}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={line.price}
                onChange={(e) => patchLine(line.key, { price: e.target.value })}
                placeholder={t('admin.fabricChallan.pricePh', {
                  defaultValue: 'optional',
                })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeLine(line.key)}
              disabled={lines.length <= 1}
              aria-label={t('admin.fabricChallan.removeLine', {
                defaultValue: 'Remove line',
              })}
            >
              <Trash2 size={16} />
            </Button>
            </div>
            {colourMissing(line) && (
              <p className="mt-2 text-xs text-[var(--color-destructive)]">
                {t('admin.fabricChallan.colourRequired', {
                  defaultValue: 'Pick the colour this stock is for.',
                })}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── Optional note + submit ─────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="note">
          {t('admin.fabricChallan.note', { defaultValue: 'Note (optional)' })}
        </Label>
        <Textarea
          id="note"
          rows={2}
          value={header.note}
          onChange={(e) => setHeader((h) => ({ ...h, note: e.target.value }))}
          placeholder={t('admin.fabricChallan.notePh', {
            defaultValue: 'Transport mode, vehicle no., anything off the slip…',
          })}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" onClick={() => navigate('/fabric-library')}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {saving
            ? t('admin.fabricChallan.saving', { defaultValue: 'Recording…' })
            : t('admin.fabricChallan.record', { defaultValue: 'Record challan' })}
        </Button>
      </div>

      {/* "+ Add fabric" from the picker — the same editor the library uses, so
          a fabric created here has every field, colours included. */}
      <Dialog
        open={fabricForKey != null}
        onClose={() => {
          setFabricForKey(null);
          setFabricSeed('');
        }}
        maxWidthClassName="max-w-3xl"
        title={t('admin.fabricLibrary.newFabric', { defaultValue: 'New fabric' })}
      >
        <FabricEditorForm
          key={`new-${fabricSeed}`}
          editing={null}
          initialName={fabricSeed}
          initialUnitOfMeasure="meter"
          onCancel={() => {
            setFabricForKey(null);
            setFabricSeed('');
          }}
          onSaved={(created) => {
            if (created) {
              setFabrics((fs) => [...fs, created]);
              // Selecting a fabric with no colour child would strand the line:
              // stock lives on the colour, and the list marks such fabrics
              // unselectable for exactly that reason. Say so instead.
              if (fabricForKey != null) {
                if (created.colours?.length) {
                  chooseFabric(fabricForKey, created.id, created);
                } else {
                  toast.show(
                    t('admin.fabricChallan.createdWithoutColour', {
                      defaultValue:
                        'Fabric added. Give it a colour before stocking it.',
                    }),
                  );
                }
              }
            }
            setFabricForKey(null);
            setFabricSeed('');
          }}
        />
      </Dialog>

      <Dialog
        open={vendorOpen}
        onClose={() => {
          setVendorOpen(false);
          setVendorName('');
        }}
        title={t('admin.fabricChallan.addVendor', { defaultValue: 'Add supplier' })}
        initialFocusRef={vendorRef}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setVendorOpen(false);
                setVendorName('');
              }}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              size="sm"
              disabled={!vendorName.trim() || vendorSaving}
              onClick={() => void submitVendor()}
            >
              {vendorSaving
                ? t('common.saving', { defaultValue: 'Saving…' })
                : t('common.create', { defaultValue: 'Create' })}
            </Button>
          </>
        }
      >
        <Label>
          {t('admin.fabricChallan.vendorName', { defaultValue: 'Supplier name' })}
        </Label>
        <Input
          ref={vendorRef}
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && vendorName.trim()) {
              e.preventDefault();
              void submitVendor();
            }
          }}
          placeholder="Shree Textiles Mills"
        />
      </Dialog>
    </div>
  );
}
