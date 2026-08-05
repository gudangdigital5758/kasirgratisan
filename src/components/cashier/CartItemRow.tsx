/**
 * Satu baris item di keranjang kasir — dipakai panel desktop & sheet mobile.
 * Presentasional murni: semua logika (qty/stock, notes, diskon) tetap di parent
 * lewat callback, sehingga perilaku identik di kedua layout.
 */
import { X, Minus, Plus, Pencil, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Product } from '@/lib/db';

export interface CartRowItem {
  product: Product;
  qty: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  notes?: string;
}

export interface CartItemRowProps {
  item: CartRowItem;
  /** Nilai diskon baris (dari parent, mis. lineDiscountAmount). */
  discountAmount: number;
  /** Subtotal baris setelah diskon (dari parent). */
  subtotal: number;
  /** Formatter uang (locale-aware). */
  formatPrice: (n: number) => string;
  /** i18n t() untuk label baris. */
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Apakah editor catatan sedang terbuka untuk item ini. */
  isEditingNotes: boolean;
  tempNotes: string;
  onNotesChange: (v: string) => void;
  onStartEditNotes: () => void;
  onCommitNotes: () => void;
  onCancelNotes: () => void;
  onOpenDiscount: () => void;
  /** Hapus item dari keranjang (saat qty = 1, tombol minus jadi X). */
  onRemove: () => void;
  onDecrease: () => void;
  onIncrease: () => void;
  /**
   * Commit qty dari input langsung. Mengembalikan nilai yang harus tampil di
   * input (mis. stok ter-clamp), atau `null` untuk reset ke qty semula.
   */
  onQtyCommit: (value: number) => number | null;
}

export default function CartItemRow({
  item,
  discountAmount,
  subtotal,
  formatPrice,
  t,
  isEditingNotes,
  tempNotes,
  onNotesChange,
  onStartEditNotes,
  onCommitNotes,
  onCancelNotes,
  onOpenDiscount,
  onRemove,
  onDecrease,
  onIncrease,
  onQtyCommit,
}: CartItemRowProps) {
  return (
    <div key={item.product.id} className="bg-muted/50 p-3 rounded-xl space-y-1.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{item.product.name}</p>
          <p className="text-xs text-muted-foreground">{formatPrice(item.product.price)} × {item.qty}</p>
          {item.discountType && discountAmount > 0 && (
            <p className="text-[10px] text-destructive">
              {t('cashier.cartDiscount.label')}: {item.discountType === 'percentage' ? `${item.discountValue}%` : formatPrice(item.discountValue)} (-{formatPrice(discountAmount)})
            </p>
          )}
          <p className="text-sm font-bold text-primary">{formatPrice(subtotal)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={item.qty === 1 ? onRemove : onDecrease}>
            {item.qty === 1 ? <X className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </Button>
          <input
            key={item.qty}
            type="number"
            inputMode="numeric"
            defaultValue={item.qty}
            onBlur={e => {
              const val = parseInt(e.target.value);
              const next = onQtyCommit(val);
              if (next === null) {
                e.target.value = String(item.qty);
              } else {
                e.target.value = String(next);
              }
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-10 h-8 text-center text-sm font-bold bg-transparent border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={onIncrease}>
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {item.notes ? (
          <button
            className="flex items-center gap-1 text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full"
            onClick={onStartEditNotes}
          >
            <Pencil className="w-2.5 h-2.5" />
            {item.notes}
          </button>
        ) : (
          <button
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
            onClick={onStartEditNotes}
          >
            <Pencil className="w-2.5 h-2.5" />
            {t('cashier.itemNotes.add')}
          </button>
        )}
        {item.discountType ? (
          <button
            className="flex items-center gap-1 text-[10px] text-destructive bg-destructive/10 px-2 py-0.5 rounded-full"
            onClick={onOpenDiscount}
          >
            <Tag className="w-2.5 h-2.5" />
            {t('cashier.itemDiscount.change')}
          </button>
        ) : (
          <button
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
            onClick={onOpenDiscount}
          >
            <Tag className="w-2.5 h-2.5" />
            {t('cashier.itemDiscount.add')}
          </button>
        )}
      </div>
      {isEditingNotes && (
        <div className="flex gap-2 items-center">
          <Input
            autoFocus
            value={tempNotes}
            onChange={e => onNotesChange(e.target.value)}
            placeholder={t('cashier.itemNotes.placeholder')}
            className="h-8 text-xs"
            onKeyDown={e => {
              if (e.key === 'Enter') onCommitNotes();
              if (e.key === 'Escape') onCancelNotes();
            }}
          />
          <Button size="sm" className="h-8 text-xs" onClick={onCommitNotes}>{t('cashier.buttons.ok')}</Button>
        </div>
      )}
    </div>
  );
}
