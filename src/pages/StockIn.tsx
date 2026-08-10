import { useLiveQuery } from 'dexie-react-hooks';
import { db, isStockManaged } from '@/lib/db';
import { addStockLot, reconcileProductFromLots } from '@/lib/inventory';
import { useState } from 'react';
import { ArrowDownToLine, Plus, ChevronLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id as idLocale, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import ProductPicker from '@/components/ProductPicker';
import SearchableSelect from '@/components/SearchableSelect';
import NumberInput from '@/components/NumberInput';
import { useTranslation } from 'react-i18next';

const CURRENCY_SYMBOL: Record<string, string> = { id: 'Rp', en: 'Rp', ms: 'Rp' };
const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };
const LOCALES: Record<string, Locale> = { id: idLocale, en: enUS, ms };

export default function StockInPage() {
  const { currentUser, can } = useAuth();
  const { t, i18n } = useTranslation('settings');
  const dateLocale = LOCALES[i18n.language] ?? idLocale;
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';
  const currencySymbol = CURRENCY_SYMBOL[i18n.language] ?? 'Rp';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('all');

  const stockIns = useLiveQuery(() => db.stockIns.orderBy('date').reverse().toArray());
  const products = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const suppliers = useLiveQuery(() => db.suppliers.where('isDeleted').equals(0).toArray());

  if (!can('manage_stock_inout')) {
    return <LockedPage title={t('stockIn.locked.title')} permissionLabel={t('stockIn.locked.permissionLabel')} />;
  }

  const filtered = stockIns?.filter(si =>
    filterSupplier === 'all' || si.supplierId === Number(filterSupplier)
  ) ?? [];

  const getProductName = (pid: number) => products?.find(p => p.id === pid)?.name ?? '-';
  const getSupplierName = (sid: number) => suppliers?.find(s => s.id === sid)?.name ?? '-';

  const openAdd = () => {
    setProductId(''); setSupplierId(''); setQuantity(''); setBuyPrice(''); setNotes('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const qty = Number(quantity);
    const price = Number(buyPrice);
    if (!productId || !supplierId || qty <= 0 || price <= 0) {
      toast.error(t('stockIn.toast.fillAll'));
      return;
    }

    const product = products?.find(p => p.id === Number(productId));
    if (!product) return;

    const now = new Date();
    await db.transaction('rw', db.stockIns, db.stockLots, db.products, async () => {
      const stockInId = (await db.stockIns.add({
        productId: Number(productId),
        supplierId: Number(supplierId),
        quantity: qty,
        buyPrice: price,
        totalPrice: qty * price,
        date: now,
        notes: notes.trim(),
        createdBy: currentUser?.id,
      })) as number;

      // FIFO: stok masuk = batch baru dengan harga beli yang diinput.
      await addStockLot({
        productId: product.id!,
        quantity: qty,
        unitCost: price,
        date: now,
        source: 'stock_in',
        stockInId,
      });

      await db.products.update(product.id!, {
        stock: Math.round((product.stock + qty) * 1e6) / 1e6,
        updatedAt: now,
      });
      // HPP = harga batch tertua (FIFO), bukan rata-rata.
      await reconcileProductFromLots(product.id!);
    });

    toast.success(t('stockIn.toast.success', { product: product.name, qty, hpp: Math.round(price).toLocaleString(numberLocale) }));
    setDialogOpen(false);
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/settings">
            <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
          </Link>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ArrowDownToLine className="w-5 h-5 text-success" />
            {t('stockIn.title')}
          </h1>
        </div>
        <Button size="sm" onClick={openAdd} className="h-9 gap-1.5">
          <Plus className="w-4 h-4" /> {t('stockIn.add')}
        </Button>
      </div>

      <SearchableSelect
        value={filterSupplier}
        onChange={setFilterSupplier}
        placeholder={t('stockIn.supplierFilter.placeholder')}
        searchPlaceholder={t('stockIn.supplierFilter.searchPlaceholder')}
        options={[
          { value: 'all', label: t('stockIn.supplierFilter.all') },
          ...(suppliers?.map(s => ({ value: s.id!.toString(), label: s.name })) ?? []),
        ]}
      />

      <p className="text-xs text-muted-foreground">{t('stockIn.count', { count: filtered.length })}</p>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <ArrowDownToLine className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">{t('stockIn.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(si => (
            <Card key={si.id} className="border-0 shadow-sm">
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{getProductName(si.productId)}</h3>
                    <p className="text-xs text-muted-foreground">{t('stockIn.item.fromSupplier', { supplier: getSupplierName(si.supplierId) })}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs font-medium bg-success/10 text-success px-2 py-0.5 rounded">{t('stockIn.item.quantity', { qty: si.quantity })}</span>
                      <span className="text-xs text-muted-foreground">{t('stockIn.item.unitPrice', { price: si.buyPrice.toLocaleString(numberLocale) })}</span>
                    </div>
                    {si.notes && <p className="text-xs text-muted-foreground mt-1 italic">{si.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{format(new Date(si.date), 'dd MMM yy', { locale: dateLocale })}</p>
                    <p className="text-sm font-bold mt-1">{currencySymbol} {si.totalPrice.toLocaleString(numberLocale)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader><DialogTitle>{t('stockIn.dialog.title')}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('stockIn.dialog.productLabel')}</Label>
              <ProductPicker
                products={products ?? []}
                value={productId}
                onChange={setProductId}
                filter={p => isStockManaged(p)}
                showHpp
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('stockIn.dialog.supplierLabel')}</Label>
              <SearchableSelect
                value={supplierId}
                onChange={setSupplierId}
                placeholder={t('stockIn.supplierFilter.searchPlaceholder')}
                searchPlaceholder={t('stockIn.supplierFilter.searchPlaceholder')}
                options={suppliers?.map(s => ({ value: s.id!.toString(), label: s.name })) ?? []}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('stockIn.dialog.quantityLabel')}</Label>
                <NumberInput value={quantity} onChange={setQuantity} placeholder={t('stockIn.dialog.quantityPlaceholder')} className="h-11" decimal />
              </div>
              <div className="space-y-1.5">
                <Label>{t('stockIn.dialog.buyPriceLabel')}</Label>
                <NumberInput value={buyPrice} onChange={setBuyPrice} placeholder={t('stockIn.dialog.buyPricePlaceholder')} className="h-11" decimal />
              </div>
            </div>
            {quantity && buyPrice && (
              <div className="bg-muted/50 p-3 rounded-xl text-sm">
                {t('stockIn.dialog.total', { amount: (Number(quantity) * Number(buyPrice)).toLocaleString(numberLocale) })}
              </div>
            )}
            <div className="space-y-1.5"><Label>{t('stockIn.dialog.notesLabel')}</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('stockIn.dialog.notesPlaceholder')} className="h-11" /></div>
            <Button className="w-full h-12 text-base font-semibold" onClick={handleSave}>{t('stockIn.dialog.save')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
