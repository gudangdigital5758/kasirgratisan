import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BUSINESS_CATEGORIES, type BusinessCategory } from '@/lib/product-fields';

interface Props {
  selectedId: string | null;
  onSelect: (cat: BusinessCategory) => void;
  className?: string;
  maxHeight?: string;
}

/**
 * Picker Kategori Usaha (search + daftar single-select), seperti aplikasi
 * kompetitor. Dipakai di wizard tambah toko, onboarding, dan settings.
 */
export default function BusinessCategoryPicker({
  selectedId,
  onSelect,
  className,
  maxHeight = 'min(50vh, 320px)',
}: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return BUSINESS_CATEGORIES;
    return BUSINESS_CATEGORIES.filter((c) =>
      t(c.labelKey).toLowerCase().includes(query),
    );
  }, [q, t]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('productFields:catSearch')}
          className="w-full h-10 rounded-xl border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>
      <div className="overflow-y-auto rounded-xl border border-border" style={{ maxHeight }}>
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {t('productFields:catEmpty')}
          </p>
        ) : (
          filtered.map((cat) => {
            const active = cat.id === selectedId;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelect(cat)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b border-border/50 last:border-b-0',
                  active ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-muted/60',
                )}
              >
                <span className="text-lg leading-none">{cat.icon}</span>
                <span className="flex-1 min-w-0 truncate">{t(cat.labelKey)}</span>
                <span
                  className={cn(
                    'w-4 h-4 rounded-full border-2 shrink-0',
                    active ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                  )}
                />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
