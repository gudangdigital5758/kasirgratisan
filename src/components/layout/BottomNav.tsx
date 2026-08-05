import { Home, Package, BarChart3, Settings, ShoppingCart } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { canAccessMenu } from '@/lib/menu-permissions';

const navItems = [
  { to: '/', icon: Home, key: 'nav.home' as const },
  { to: '/products', icon: Package, key: 'nav.products' as const },
  { to: '/cashier', icon: ShoppingCart, key: 'nav.cashier' as const, isCta: true },
  { to: '/reports', icon: BarChart3, key: 'nav.reports' as const },
  { to: '/settings', icon: Settings, key: 'nav.more' as const },
];

export default function BottomNav() {
  const { t } = useTranslation('common');
  const { can } = useAuth();

  // Menu on/off sesuai role (ROLES-PERMISSIONS): sembunyikan item yang
  // permission-nya tidak dimiliki. Mode legacy (tanpa multi-user) → semua tampil.
  const visibleItems = navItems.filter(({ to }) => canAccessMenu(to, can));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-end justify-around h-16 max-w-lg md:max-w-6xl mx-auto px-2 md:px-4">
        {visibleItems.map(({ to, icon: Icon, key, isCta }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 transition-colors min-w-[52px]',
                isCta
                  ? 'relative -top-4'
                  : cn(
                      'px-2 py-1.5 rounded-xl',
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )
              )
            }
          >
            {({ isActive }) =>
              isCta ? (
                <>
                  <div className={cn(
                    'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95',
                    'bg-primary text-primary-foreground',
                    isActive && 'ring-4 ring-primary/20'
                  )}>
                    <Icon className="w-6 h-6" strokeWidth={2.5} />
                  </div>
                  <span className={cn(
                    'text-[10px] font-bold leading-tight mt-0.5',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}>{t(key)}</span>
                </>
              ) : (
                <>
                  <div className={cn(
                    'flex items-center justify-center w-10 h-7 rounded-full transition-colors',
                    isActive && 'bg-primary/10'
                  )}>
                    <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                  <span className="text-[10px] font-semibold leading-tight">{t(key)}</span>
                </>
              )
            }
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
