import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { useUiStore } from '../../store/ui';
import { useThemeSync } from '../../store/theme';
import { useWsCacheBridge } from '../../hooks/useWsCacheBridge';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppLayout() {
  const expanded = useUiStore((state) => state.sidebarExpanded);
  const activeAccountId = useUiStore((state) => state.activeAccountId);
  const location = useLocation();

  useThemeSync();
  useWebSocket();
  useWsCacheBridge();

  return (
    <div className="min-h-screen">
      <Sidebar chatsPath={activeAccountId !== null ? `/accounts/${activeAccountId}/chats` : null} />
      <div className={cn('transition-[padding] duration-200 ease-out', expanded ? 'pl-sidebar' : 'pl-rail')}>
        <Topbar />
        <main className="mx-auto w-full max-w-content px-6 py-8 lg:px-8">
          {/* Route transition: 150ms fade + 4px lift, disabled under reduced motion. */}
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
