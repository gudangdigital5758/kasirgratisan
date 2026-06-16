import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export interface SearchableOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  className,
}: SearchableSelectProps) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = options.filter(o => o.label.toLowerCase().includes(q));

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm"
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : (placeholder ?? t('searchableSelect.placeholder'))}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border bg-popover shadow-lg">
          <div className="relative p-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={searchPlaceholder ?? t('searchableSelect.searchPlaceholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
          <div className="max-h-52 overflow-y-auto divide-y border-t">
            {matches.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6">{t('searchableSelect.notFound')}</p>
            ) : (
              matches.map(o => (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/60 active:bg-muted"
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <Check className="w-4 h-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
