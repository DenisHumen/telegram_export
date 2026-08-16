import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Database, Download, HardDrive, Image, MessagesSquare, Plus, Users } from 'lucide-react';
import * as api from '../api/client';
import { qk, useAccounts, useJobs, useLogs } from '../hooks/queries';
import type { AccountStats } from '../api/types';
import { cn } from '../lib/cn';
import { formatBytes, formatNumber, formatRelative, formatTime } from '../lib/format';
import { isJobActive } from '../lib/jobs';
import { LOG_LEVEL_BORDER, LOG_LEVEL_CLASS } from '../lib/labels';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Section, SectionHeading } from '../components/ui/Card';
import { EmptyState, ErrorState, NoAccountsArt, NoJobsArt } from '../components/ui/EmptyState';
import { JobCard } from '../components/jobs/JobCard';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { StatTile } from '../components/ui/StatTile';

const ICON = 'h-3.5 w-3.5';

export function DashboardPage() {
  const {
    data: accounts,
    isLoading: accountsLoading,
    isError: accountsError,
    error: accountsErrorValue,
    refetch: refetchAccounts,
  } = useAccounts();
  const { data: jobs, isLoading: jobsLoading } = useJobs({ page: 1, page_size: 8 });
  const { data: logs, isLoading: logsLoading } = useLogs({ limit: 12 }, 5000);

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
  const runningJobs = jobItems.filter(isJobActive);
  const recentJobs = jobItems.filter((job) => !isJobActive(job)).slice(0, 3);

  if (accountsError) {
    return (
      <>
        <PageHeader title="Дашборд" subtitle="Обзор архива и активных экспортов" />
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
        <PageHeader title="Дашборд" subtitle="Обзор архива и активных экспортов" />
        <EmptyState
          art={<NoAccountsArt />}
          title="Аккаунтов пока нет"
          description="Добавьте Telegram-аккаунт, чтобы синхронизировать чаты и начать выгружать архив: сообщения, фото, видео, кружочки и голосовые."
          action={
            <Link to="/accounts/new">
              <Button variant="primary" icon={<Plus className={ICON} />}>
                Добавить аккаунт
              </Button>
            </Link>
          }
        />
      </>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Дашборд" subtitle="Обзор архива и активных экспортов">
        <Link to="/accounts/new">
          <Button variant="secondary" size="sm" icon={<Plus className={ICON} />}>
            Аккаунт
          </Button>
        </Link>
        <Link to="/jobs">
          <Button variant="primary" size="sm" icon={<Download className={ICON} />}>
            Экспорты{runningJobs.length > 0 ? ` · ${runningJobs.length}` : ''}
          </Button>
        </Link>
      </PageHeader>

      {/* --------------------------------------------------------- hero row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          icon={<Users className={ICON} />}
          label="Аккаунты"
          value={formatNumber(accounts?.length ?? 0)}
          hint={`${formatNumber((accounts ?? []).filter((a) => a.status === 'authorized').length)} авторизовано`}
          loading={accountsLoading}
        />
        <StatTile
          icon={<MessagesSquare className={ICON} />}
          label="Чаты"
          value={formatNumber(totals.chats)}
          loading={statsLoading}
        />
        <StatTile
          icon={<Database className={ICON} />}
          label="Сообщений"
          value={formatNumber(totals.messages)}
          loading={statsLoading}
        />
        <StatTile
          icon={<Image className={ICON} />}
          label="Медиафайлов"
          value={formatNumber(totals.media_files)}
          loading={statsLoading}
        />
        <StatTile
          icon={<HardDrive className={ICON} />}
          label="Заархивировано"
          value={formatBytes(totals.bytes)}
          hint={`${formatNumber(totals.jobs)} задач экспорта`}
          loading={statsLoading}
          accent
        />
      </div>

      {/* ---------------------------------------------------- running jobs */}
      <Section
        title={runningJobs.length > 0 ? 'Идут сейчас' : 'Экспорты'}
        action={
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1 text-[12.5px] text-dim transition-colors duration-120 hover:text-text"
          >
            Все задачи <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        {jobsLoading ? (
          <SkeletonRows rows={2} />
        ) : jobItems.length === 0 ? (
          <EmptyState
            art={<NoJobsArt />}
            title="Экспортов ещё не было"
            description="Откройте любой чат и нажмите «Экспорт», чтобы настроить и запустить выгрузку."
          />
        ) : runningJobs.length > 0 ? (
          <div className="space-y-4">
            {runningJobs.map((job) => (
              <JobCard key={job.id} job={job} compact />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {recentJobs.map((job) => (
              <JobCard key={job.id} job={job} compact />
            ))}
          </div>
        )}
      </Section>

      {/* ------------------------------------------------- accounts + logs */}
      <div className="grid gap-8 border-t border-border pt-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section>
          <SectionHeading
            title="Аккаунты"
            action={
              <Link
                to="/accounts"
                className="text-[12.5px] text-dim transition-colors duration-120 hover:text-text"
              >
                Все
              </Link>
            }
          />
          <div className="mt-3 divide-y divide-border rounded-card border border-border">
            {(accounts ?? []).slice(0, 5).map((account) => (
              <Link
                key={account.id}
                to={`/accounts/${account.id}/chats`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-120 first:rounded-t-card last:rounded-b-card hover:bg-veil"
              >
                <span
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-pill', account.connected ? 'bg-success' : 'bg-muted')}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-text">{account.label}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {account.username ? `@${account.username}` : (account.phone ?? '—')} ·{' '}
                    {formatNumber(account.chats_count)} чатов
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] text-muted">{formatRelative(account.last_seen_at)}</span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <SectionHeading
            title="Последние события"
            action={
              <Link to="/logs" className="text-[12.5px] text-dim transition-colors duration-120 hover:text-text">
                Журнал
              </Link>
            }
          />
          <div className="scroll-thin mt-3 max-h-[300px] overflow-y-auto rounded-card border border-border px-3 py-2.5">
            {logsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-3" />
                ))}
              </div>
            ) : (logs?.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-muted">Логи пока пусты</p>
            ) : (
              <ol className="space-y-0.5 font-mono text-[11.5px] leading-relaxed">
                {logs?.slice(0, 12).map((row) => (
                  <li key={row.id} className={cn('flex gap-2.5 border-l-2 py-0.5 pl-2.5', LOG_LEVEL_BORDER[row.level])}>
                    <span className="tnum shrink-0 text-muted">{formatTime(row.ts)}</span>
                    <span className={cn('w-12 shrink-0 uppercase', LOG_LEVEL_CLASS[row.level])}>{row.level}</span>
                    <span className="min-w-0 break-words text-dim">{row.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
