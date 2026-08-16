import { Link, useLocation } from 'react-router-dom';
import {
  Download,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { useUiStore } from '../../store/ui';
import { Tooltip } from '../ui/Tooltip';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * Exactly one item may be active at a time, so each route family owns its
   * own matcher — `/accounts/:id/chats` belongs to «Чаты», not to «Аккаунты».
   */
  match: (pathname: string) => boolean;
}

/** The app mark: a vault outline, drawn in the accent, no gradient. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="h-[22px] w-[22px] shrink-0" fill="none" aria-hidden>
      <path
        d="M16 3.5 27 8v6.9C27 21.8 22.6 26.4 16 28.5 9.4 26.4 5 21.8 5 14.9V8z"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M16 12v9M11.5 16.5h9" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** `/accounts`, `/accounts/new` — but not `/accounts/1/chats`. */
const isAccountsRoute = (pathname: string): boolean =>
  pathname === '/accounts' || pathname === '/accounts/new';

/** `/chats/…` and `/accounts/:id/chats`. */
const isChatsRoute = (pathname: string): boolean =>
  pathname.startsWith('/chats') || /^\/accounts\/[^/]+\/chats/.test(pathname);

export function Sidebar({ chatsPath }: { chatsPath: string | null }) {
  const expanded = useUiStore((state) => state.sidebarExpanded);
  const toggle = useUiStore((state) => state.toggleSidebar);
  const { pathname } = useLocation();

  const items: NavItem[] = [
    { to: '/', label: 'Дашборд', icon: LayoutDashboard, match: (path) => path === '/' },
    { to: '/accounts', label: 'Аккаунты', icon: Users, match: isAccountsRoute },
    { to: chatsPath ?? '/accounts', label: 'Чаты', icon: MessagesSquare, match: isChatsRoute },
    { to: '/jobs', label: 'Экспорты', icon: Download, match: (path) => path.startsWith('/jobs') },
    { to: '/logs', label: 'Логи', icon: ScrollText, match: (path) => path.startsWith('/logs') },
    { to: '/settings', label: 'Настройки', icon: SettingsIcon, match: (path) => path.startsWith('/settings') },
  ];

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-surface',
        'transition-[width] duration-200 ease-out',
        expanded ? 'w-sidebar' : 'w-rail',
      )}
    >
      <div className={cn('flex h-topbar items-center gap-2.5 px-5', !expanded && 'justify-center px-0')}>
        <Mark />
        {expanded ? (
          <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-text">TgVault</span>
        ) : null}
      </div>

      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {items.map((item) => {
          const isActive = item.match(pathname);
          const link = (
            <Link
              key={item.label}
              to={item.to}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex h-9 items-center gap-2.5 rounded-control text-[13px] font-medium',
                'transition-colors duration-120',
                expanded ? 'px-2.5' : 'w-9 justify-center px-0',
                isActive ? 'bg-accent-soft text-accent' : 'text-dim hover:bg-veil hover:text-text',
              )}
            >
              {isActive ? (
                <span className="absolute -left-3 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-pill bg-accent" />
              ) : null}
              <item.icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
              {expanded ? <span className="truncate">{item.label}</span> : null}
            </Link>
          );

          return expanded ? (
            link
          ) : (
            <Tooltip key={item.label} label={item.label} side="bottom" className="w-full justify-center">
              {link}
            </Tooltip>
          );
        })}
      </nav>

      <div className="p-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? 'Свернуть меню' : 'Развернуть меню'}
          className={cn(
            'flex h-9 items-center gap-2.5 rounded-control text-[13px] text-muted',
            'transition-colors duration-120 hover:bg-veil hover:text-text',
            expanded ? 'w-full px-2.5' : 'w-9 justify-center px-0',
          )}
        >
          {expanded ? (
            <>
              <PanelLeftClose className="h-[17px] w-[17px]" aria-hidden />
              <span>Свернуть</span>
            </>
          ) : (
            <PanelLeftOpen className="h-[17px] w-[17px]" aria-hidden />
          )}
        </button>
      </div>
    </aside>
  );
}
