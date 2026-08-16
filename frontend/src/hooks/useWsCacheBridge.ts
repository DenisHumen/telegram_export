import { useQueryClient } from '@tanstack/react-query';
import type { Account, ExportJob, JobEvent, Paginated } from '../api/types';
import { qk } from './queries';
import { useWsSubscribe } from './useWebSocket';

/**
 * Patches the react-query cache directly from WS messages so the UI updates
 * without waiting for the polling fallback.
 */
export function useWsCacheBridge(): void {
  const queryClient = useQueryClient();

  useWsSubscribe('job_progress', ({ payload }) => {
    queryClient.setQueryData<ExportJob>(qk.job(payload.id), payload);
    queryClient.setQueriesData<Paginated<ExportJob>>({ queryKey: ['jobs'] }, (previous) => {
      if (!previous) return previous;
      const index = previous.items.findIndex((item) => item.id === payload.id);
      if (index === -1) return previous;
      const items = previous.items.slice();
      items[index] = payload;
      return { ...previous, items };
    });
  });

  useWsSubscribe('job_event', ({ payload }) => {
    queryClient.setQueryData<JobEvent[]>(qk.jobEvents(payload.job_id), (previous) => {
      if (!previous) return previous;
      if (previous.some((event) => event.id === payload.id)) return previous;
      return [...previous, payload].slice(-500);
    });
  });

  useWsSubscribe('auth_state', ({ payload }) => {
    queryClient.setQueryData(qk.authState(payload.account_id), payload);
  });

  useWsSubscribe('account', ({ payload }) => {
    queryClient.setQueryData<Account>(qk.account(payload.id), payload);
    queryClient.setQueryData<Account[]>(qk.accounts, (previous) => {
      if (!previous) return previous;
      const index = previous.findIndex((item) => item.id === payload.id);
      if (index === -1) return [...previous, payload];
      const next = previous.slice();
      next[index] = payload;
      return next;
    });
  });

  useWsSubscribe('chat_sync', ({ payload }) => {
    if (payload.done) {
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: qk.accounts });
      void queryClient.invalidateQueries({ queryKey: qk.accountStats(payload.account_id) });
    }
  });
}
