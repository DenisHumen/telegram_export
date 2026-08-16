import { NavLink } from 'react-router-dom';
import {
  ChevronsLeft,
  ChevronsRight,
  Download,
  LayoutDashboard,
  MessagesSquare,
  ScrollText,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { useUiStore } from '../../store/ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

export function Sidebar({ chatsPath }: { chatsPath: string | null }) {
  const expanded = useUiStore((state) => state.sidebarExpanded);
  const toggle = useUiStore((state) => state.toggleSidebar);

  const items: NavItem[] = [
    { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true },
    { to: '/accounts', label: 'Аккаунты', icon: Users },
    { to: chatsPath ?? '/accounts', label: 'Чаты', icon: MessagesSquare },
    { to: '/jobs', label: 'Экспорты', icon: Download },
    { to: '/logs', label: 'Логи', icon: ScrollText },
    { to: '/settings', label: 'Настройки', icon: SettingsIcon },
  ];

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface/80 backdrop-blur-xl',
        'transition-[width] duration-200 ease-out',
        expanded ? 'w-[240px]' : 'w-[72px]',
      )}
    >
      <div className={cn('flex h-16 items-center gap-3 border-b border-line px-4', !expanded && 'justify-center px-0')}>
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-grad shadow-[0_6px_18px_-8px_rgba(51,144,236,0.9)]">
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path d="M13 2 4 14h6l-1.5 8L20 9h-7z" fill="#0B0F14" />
          </svg>
        </span>
        {expanded ? (
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight tracking-tight">TgVault</p>
            <p className="truncate text-[11px] text-ink-faint">Telegram Export</p>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto scroll-thin p-3">
        {items.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            title={expanded ? undefined : item.label}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium',
                'transition-all duration-150',
                !expanded && 'justify-center px-0',
                isActive
                  ? 'bg-accent/12 text-ink'
                  : 'text-ink-muted hover:bg-white/[0.04] hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-grad transition-opacity duration-150',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <item.icon className={cn('h-[18px] w-[18px] shrink-0', isActive && 'text-accent-soft')} aria-hidden />
                {expanded ? <span className="truncate">{item.label}</span> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? 'Свернуть меню' : 'Развернуть меню'}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-ink-faint',
            'transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink',
            !expanded && 'justify-center px-0',
          )}
        >
          {expanded ? <ChevronsLeft className="h-[18px] w-[18px]" /> : <ChevronsRight className="h-[18px] w-[18px]" />}
          {expanded ? <span>Свернуть</span> : null}
        </button>
      </div>
    </aside>
  );
}
