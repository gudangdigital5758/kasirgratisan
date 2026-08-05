import { Loader2 } from 'lucide-react';

/** Fallback ringan saat route lazy loading sedang diunduh/parse. */
export default function PageLoader() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Memuat…</span>
      </div>
    </div>
  );
}
