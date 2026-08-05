import { Link } from 'react-router-dom';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface SettingsLinkCardProps {
  /** Route tujuan. */
  to: string;
  icon: LucideIcon;
  /** Kelas ikon wrapper (mis. 'bg-success/10 text-success'). Default primary. */
  iconClass?: string;
  title: string;
  description: string;
  /** Kelas tambahan pada Card (bawaan: 'mb-2'). Kosongkan jika tidak mau margin bawah. */
  className?: string;
}

/** Kartu navigasi standar di halaman Pengaturan (Link + Card + ikon + ChevronRight). */
export default function SettingsLinkCard({
  to,
  icon: Icon,
  iconClass = 'bg-primary/10 text-primary',
  title,
  description,
  className = 'mb-2',
}: SettingsLinkCardProps) {
  return (
    <Link to={to} className="block">
      <Card className={`border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow ${className}`}>
        <CardContent className="p-3 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconClass}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-[10px] text-muted-foreground">{description}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
