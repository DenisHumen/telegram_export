import { Outlet } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { useUiStore } from '../../store/ui';
import { useWsCacheBridge } from '../../hooks/useWsCacheBridge';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppLayout() {
  const expanded = useUiStore((state) => state.sidebarExpanded);
  const activeAccountId = useUiStore((state) => state.activeAccountId);

  useWebSocket();
  useWsCacheBridge();

  return (
    <div className="min-h-screen">
      <Sidebar chatsPath={activeAccountId !== null ? `/accounts/${activeAccountId}/chats` : null} />
      <div className={cn('transition-[padding] duration-200 ease-out', expanded ? 'pl-[240px]' : 'pl-[72px]')}>
        <Topbar />
        <main className="mx-auto w-full max-w-content px-5 py-6 lg:px-7 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
