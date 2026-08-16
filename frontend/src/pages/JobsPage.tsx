import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import * as api from '../api/client';
import type { JobStatus, ListJobsParams } from '../api/types';
import { useAccounts, useJobs } from '../hooks/queries';
import { JOB_STATUS_LABEL } from '../lib/labels';
import { formatNumber } from '../lib/format';
import { isJobActive } from '../lib/jobs';
import { cn } from '../lib/cn';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Chip, SelectField } from '../components/ui/Field';
import { EmptyState, ErrorState, NoJobsArt } from '../components/ui/EmptyState';
import { JobCard } from '../components/jobs/JobCard';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonRows } from '../components/ui/Skeleton';

const STATUS_FILTERS: (JobStatus | 'all')[] = [
  'all',
  'running',
  'queued',
  'paused',
  'completed',
  'failed',
  'cancelled',
];

export function JobsPage() {
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const [accountId, setAccountId] = useState<number | 'all'>('all');
  const [page, setPage] = useState(1);

  const { data: accounts } = useAccounts();

  useEffect(() => {
    setPage(1);
  }, [status, accountId]);

  const params: ListJobsParams = useMemo(
    () => ({
      status: status === 'all' ? undefined : status,
      account_id: accountId === 'all' ? undefined : accountId,
      page,
      page_size: 10,
    }),
    [status, accountId, page],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useJobs(params, 2000);
  const items = data?.items ?? [];
  const active = items.filter(isJobActive).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Экспорты" subtitle={`Задачи выгрузки · активных: ${formatNumber(active)}`}>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />}
          onClick={() => void refetch()}
        >
          Обновить
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((item) => (
          <Chip key={item} active={status === item} onClick={() => setStatus(item)}>
            {item === 'all' ? 'Все' : JOB_STATUS_LABEL[item]}
          </Chip>
        ))}
        <SelectField
          aria-label="Фильтр по аккаунту"
          value={accountId === 'all' ? 'all' : String(accountId)}
          onChange={(event) => setAccountId(event.target.value === 'all' ? 'all' : Number(event.target.value))}
          wrapClassName="ml-auto w-[200px]"
          className="h-8 py-0 text-[12.5px]"
        >
          <option value="all">Все аккаунты</option>
          {(accounts ?? []).map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </SelectField>
      </div>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : isError ? (
        <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          art={<NoJobsArt />}
          title="Задач нет"
          description="Откройте нужный чат и нажмите «Экспорт» — задача появится здесь с живым прогрессом."
          action={
            <Link to="/accounts">
              <Button variant="primary" icon={<Download className="h-3.5 w-3.5" />}>
                Выбрать чат
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="space-y-4">
            {items.map((job, index) => (
              <div
                key={job.id}
                className="animate-fade-in"
                style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
              >
                <JobCard job={job} />
              </div>
            ))}
          </div>
          {(data?.pages ?? 1) > 1 ? (
            <Pagination
              page={data?.page ?? page}
              pages={data?.pages ?? 1}
              total={data?.total ?? 0}
              unitLabel="задач"
              onPage={setPage}
              className="border-t border-border"
            />
          ) : null}
        </>
      )}
    </div>
  );
}
