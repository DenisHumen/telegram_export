import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import * as api from '../api/client';
import type { JobStatus, ListJobsParams } from '../api/types';
import { useAccounts, useJobs } from '../hooks/queries';
import { JOB_STATUS_LABEL } from '../lib/labels';
import { formatNumber } from '../lib/format';
import { Button } from '../components/ui/Button';
import { Card, SectionTitle } from '../components/ui/Card';
import { Chip, SelectField } from '../components/ui/Field';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
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
  const active = items.filter((job) => job.status === 'running' || job.status === 'queued').length;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Экспорты"
        subtitle={`Задачи выгрузки · активных: ${formatNumber(active)}`}
        action={
          <Button
            variant="secondary"
            icon={<RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
            onClick={() => void refetch()}
          >
            Обновить
          </Button>
        }
      />

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((item) => (
            <Chip key={item} active={status === item} onClick={() => setStatus(item)}>
              {item === 'all' ? 'Все' : JOB_STATUS_LABEL[item]}
            </Chip>
          ))}
        </div>
        <SelectField
          aria-label="Фильтр по аккаунту"
          value={accountId === 'all' ? 'all' : String(accountId)}
          onChange={(event) => setAccountId(event.target.value === 'all' ? 'all' : Number(event.target.value))}
          wrapClassName="ml-auto w-[220px]"
          className="h-10 py-0"
        >
          <option value="all">Все аккаунты</option>
          {(accounts ?? []).map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </SelectField>
      </Card>

      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : isError ? (
        <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="Задач нет"
            description="Откройте нужный чат и нажмите «Экспорт» — задача появится здесь с живым прогрессом."
            action={
              <Link to="/accounts">
                <Button variant="primary" icon={<Download className="h-4 w-4" />}>
                  Выбрать чат
                </Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <div className="space-y-4">
            {items.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
          {(data?.pages ?? 1) > 1 ? (
            <Card>
              <Pagination
                page={data?.page ?? page}
                pages={data?.pages ?? 1}
                total={data?.total ?? 0}
                unitLabel="задач"
                onPage={setPage}
                className="px-4"
              />
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
