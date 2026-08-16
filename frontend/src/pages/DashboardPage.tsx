import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, Database, Download, HardDrive, Image, MessagesSquare, Plus, Users } from 'lucide-react';
import * as api from '../api/client';
import { qk, useAccounts, useJobs, useLogs } from '../hooks/queries';
import type { AccountStats } from '../api/types';
import { formatBytes, formatNumber, formatRelative, formatTime } from '../lib/format';
import { LOG_LEVEL_CLASS } from '../lib/labels';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, SectionTitle } from '../components/ui/Card';
import { EmptyState, ErrorState, NoAccountsArt } from '../components/ui/EmptyState';
import { JobCard } from '../components/jobs/JobCard';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { StatTile } from '../components/ui/StatTile';

export function DashboardPage() {
  const {
    data: accounts,
    isLoading: accountsLoading,
    isError: accountsError,
    error: accountsErrorValue,
    refetch: refetchAccounts,
  } = useAccounts();
  const { data: jobs, isLoading: jobsLoading } = useJobs({ page: 1, page_size: 6 });
  const { data: logs, isLoading: logsLoading } = useLogs({ limit: 14 }, 5000);

  const statsQueries = useQueries({
    queries: (accounts ?? []).map((account) => ({
      queryKey: qk.accountStats(account.id),
      queryFn: () => api.getAccountStats(account.id),
    })),
  });

  const totals = useMemo(() => {
    const acc = { chats: 0, messages: 0, media_files: 0, bytes: 0, jobs: 0 };
    for (const query of statsQueries) {
      const data = query.data as AccountStats | undefined;
      if (!data) continue;
      acc.chats += data.chats;
      acc.messages += data.messages;
      acc.media_files += data.media_files;
      acc.bytes += data.bytes;
      acc.jobs += data.jobs;
    }
    return acc;
  }, [statsQueries]);

  const statsLoading = accountsLoading || statsQueries.some((query) => query.isLoading);
  const jobItems = jobs?.items ?? [];
  const runningCount = jobItems.filter((job) => job.status === 'running' || job.status === 'queued').length;

  if (accountsError) {
    return (
      <>
        <SectionTitle title="Дашборд" subtitle="Обзор архива и активных экспортов" />
        <ErrorState
          title="Backend недоступен"
          description={api.errorMessage(accountsErrorValue)}
          onRetry={() => void refetchAccounts()}
        />
      </>
    );
  }

  if (!accountsLoading && (accounts?.length ?? 0) === 0) {
    return (
      <>
        <SectionTitle title="Дашборд" subtitle="Обзор архива и активных экспортов" />
        <Card>
          <EmptyState
            art={<NoAccountsArt />}
            title="Аккаунтов пока нет"
            description="Добавьте Telegram-аккаунт, чтобы синхронизировать чаты и начать выгружать архив: сообщения, фото, видео, кружочки и голосовые."
            action={
              <Link to="/accounts/new">
                <Button variant="primary" size="lg" icon={<Plus className="h-4 w-4" />}>
                  Добавить аккаунт
                </Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Дашборд"
        subtitle="Обзор архива и активных экспортов"
        action={
          <div className="flex gap-2.5">
            <Link to="/accounts/new">
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />}>
                Аккаунт
              </Button>
            </Link>
            <Link to="/jobs">
              <Button variant="primary" icon={<Download className="h-4 w-4" />}>
                Экспорты{runningCount > 0 ? ` (${runningCount})` : ''}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          icon={<Users className="h-4 w-4" />}
          label="Аккаунты"
          value={formatNumber(accounts?.length ?? 0)}
          hint={`${formatNumber((accounts ?? []).filter((a) => a.status === 'authorized').length)} авторизовано`}
          loading={accountsLoading}
        />
        <StatTile
          icon={<MessagesSquare className="h-4 w-4" />}
          label="Чаты"
          value={formatNumber(totals.chats)}
          loading={statsLoading}
          tone="accent"
        />
        <StatTile
          icon={<Database className="h-4 w-4" />}
          label="Сообщений в кэше"
          value={formatNumber(totals.messages)}
          loading={statsLoading}
          tone="success"
        />
        <StatTile
          icon={<Image className="h-4 w-4" />}
          label="Медиафайлы"
          value={formatNumber(totals.media_files)}
          loading={statsLoading}
          tone="warning"
        />
        <StatTile
          icon={<HardDrive className="h-4 w-4" />}
          label="Заархивировано"
          value={formatBytes(totals.bytes)}
          hint={`${formatNumber(totals.jobs)} задач экспорта`}
          loading={statsLoading}
          tone="neutral"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Экспорты</h2>
            <Link to="/jobs" className="text-[12.5px] text-accent-soft transition-colors hover:text-accent">
              Все задачи →
            </Link>
          </div>
          {jobsLoading ? (
            <SkeletonRows rows={3} />
          ) : jobItems.length === 0 ? (
            <Card>
              <EmptyState
                title="Экспортов ещё не было"
                description="Откройте любой чат и нажмите «Экспорт», чтобы настроить и запустить выгрузку."
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {jobItems.map((job) => (
                <JobCard key={job.id} job={job} compact />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Последние аккаунты</h2>
            <Link to="/accounts" className="text-[12.5px] text-accent-soft transition-colors hover:text-accent">
              Все →
            </Link>
          </div>
          <Card>
            <div className="divide-y divide-line">
              {(accounts ?? []).slice(0, 4).map((account) => (
                <Link
                  key={account.id}
                  to={`/accounts/${account.id}/chats`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.03]"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${account.connected ? 'bg-success' : 'bg-ink-faint'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{account.label}</span>
                    <span className="block truncate text-[11.5px] text-ink-faint">
                      {account.username ? `@${account.username}` : (account.phone ?? '—')} ·{' '}
                      {formatNumber(account.chats_count)} чатов
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ink-faint">{formatRelative(account.last_seen_at)}</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Журнал"
              subtitle="Последние события системы"
              icon={<Activity className="h-4 w-4" />}
              action={
                <Link to="/logs" className="text-[12.5px] text-accent-soft transition-colors hover:text-accent">
                  Открыть
                </Link>
              }
            />
            <div className="max-h-[320px] overflow-y-auto scroll-thin p-3">
              {logsLoading ? (
                <div className="space-y-2 p-1">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-3.5" />
                  ))}
                </div>
              ) : (logs?.length ?? 0) === 0 ? (
                <p className="px-2 py-4 text-center text-[12.5px] text-ink-faint">Логи пока пусты</p>
              ) : (
                <ol className="space-y-1 font-mono text-[11.5px] leading-relaxed">
                  {logs?.slice(0, 14).map((row) => (
                    <li key={row.id} className="flex gap-2.5 rounded px-1.5 py-0.5 hover:bg-white/[0.03]">
                      <span className="shrink-0 text-ink-faint/70">{formatTime(row.ts)}</span>
                      <span className={`w-14 shrink-0 uppercase ${LOG_LEVEL_CLASS[row.level]}`}>{row.level}</span>
                      <span className="min-w-0 break-words text-ink-muted">{row.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
