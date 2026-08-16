import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, FileText, RefreshCw, Search, ScrollText } from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import type { ListLogsParams, LogLevel, LogRow } from '../api/types';
import { useAccounts, useJobs, useLogFile, useLogFiles, useLogs } from '../hooks/queries';
import { useDebounce } from '../hooks/useDebounce';
import { useWsSubscribe } from '../hooks/useWebSocket';
import { LOG_LEVELS, LOG_LEVEL_CLASS, LOG_LEVEL_LABEL } from '../lib/labels';
import { formatBytes, formatDate, formatTime } from '../lib/format';
import { Button } from '../components/ui/Button';
import { Card, SectionTitle } from '../components/ui/Card';
import { Chip, SelectField } from '../components/ui/Field';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';

type Tab = 'live' | 'files';

function LiveLogs() {
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<number | 'all'>('all');
  const [jobId, setJobId] = useState<number | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [live, setLive] = useState<LogRow[]>([]);

  const debouncedSearch = useDebounce(search, 300);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: accounts } = useAccounts();
  const { data: jobs } = useJobs({ page: 1, page_size: 30 }, false);

  const params: ListLogsParams = useMemo(
    () => ({
      level: level === 'all' ? undefined : level,
      search: debouncedSearch || undefined,
      account_id: accountId === 'all' ? undefined : accountId,
      job_id: jobId === 'all' ? undefined : jobId,
      limit: 200,
    }),
    [level, debouncedSearch, accountId, jobId],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useLogs(params, 4000);

  useEffect(() => {
    setLive([]);
  }, [level, debouncedSearch, accountId, jobId]);

  useWsSubscribe('log', ({ payload }) => {
    if (level !== 'all' && payload.level !== level) return;
    if (accountId !== 'all' && payload.account_id !== accountId) return;
    if (jobId !== 'all' && payload.job_id !== jobId) return;
    if (debouncedSearch && !payload.message.toLowerCase().includes(debouncedSearch.toLowerCase())) return;
    setLive((previous) => [...previous.filter((row) => row.id !== payload.id), payload].slice(-400));
  });

  const rows = useMemo(() => {
    const map = new Map<number, LogRow>();
    for (const row of data ?? []) map.set(row.id, row);
    for (const row of live) map.set(row.id, row);
    return Array.from(map.values()).sort((a, b) => a.id - b.id);
  }, [data, live]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows.length, autoScroll]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по сообщениям…"
              aria-label="Поиск по логам"
              className="field h-10 pl-10"
            />
          </div>
          <SelectField
            aria-label="Фильтр по аккаунту"
            value={accountId === 'all' ? 'all' : String(accountId)}
            onChange={(event) => setAccountId(event.target.value === 'all' ? 'all' : Number(event.target.value))}
            wrapClassName="w-[190px]"
            className="h-10 py-0"
          >
            <option value="all">Все аккаунты</option>
            {(accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            aria-label="Фильтр по задаче"
            value={jobId === 'all' ? 'all' : String(jobId)}
            onChange={(event) => setJobId(event.target.value === 'all' ? 'all' : Number(event.target.value))}
            wrapClassName="w-[190px]"
            className="h-10 py-0"
          >
            <option value="all">Все задачи</option>
            {(jobs?.items ?? []).map((job) => (
              <option key={job.id} value={job.id}>
                #{job.id} · {job.chat_title}
              </option>
            ))}
          </SelectField>
          <Button
            variant="secondary"
            icon={<RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
            onClick={() => void refetch()}
          >
            Обновить
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip active={level === 'all'} onClick={() => setLevel('all')}>
            Все уровни
          </Chip>
          {LOG_LEVELS.map((item) => (
            <Chip key={item} active={level === item} onClick={() => setLevel(item)}>
              {LOG_LEVEL_LABEL[item]}
            </Chip>
          ))}
          <Chip
            className="ml-auto"
            active={autoScroll}
            onClick={() => setAutoScroll((value) => !value)}
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
          >
            Автопрокрутка
          </Chip>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="h-3.5" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} className="m-4" />
        ) : rows.length === 0 ? (
          <EmptyState title="Логи пусты" description="Записей по заданным фильтрам пока нет." />
        ) : (
          <div className="max-h-[62vh] overflow-y-auto scroll-thin bg-base/50 p-3">
            <ol className="space-y-0.5 font-mono text-[12px] leading-relaxed">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex gap-3 rounded px-2 py-1 transition-colors duration-150 hover:bg-white/[0.035]"
                >
                  <span className="shrink-0 text-ink-faint/70" title={formatDate(row.ts)}>
                    {formatTime(row.ts)}
                  </span>
                  <span className={cn('w-16 shrink-0 uppercase', LOG_LEVEL_CLASS[row.level])}>{row.level}</span>
                  <span className="hidden w-40 shrink-0 truncate text-ink-faint/80 lg:block" title={row.logger}>
                    {row.logger}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-ink-muted">{row.message}</span>
                  {row.job_id !== null ? (
                    <span className="shrink-0 text-accent/70">job#{row.job_id}</span>
                  ) : null}
                </li>
              ))}
            </ol>
            <div ref={bottomRef} />
          </div>
        )}
      </Card>
    </div>
  );
}

function LogFilesTab() {
  const { data: files, isLoading, isError, error, refetch } = useLogFiles();
  const [selected, setSelected] = useState<string | null>(null);
  const [tail, setTail] = useState(500);
  const { data: content, isLoading: contentLoading } = useLogFile(selected, tail);

  useEffect(() => {
    if (!selected && files && files.length > 0) setSelected(files[0].name);
  }, [files, selected]);

  if (isError) return <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-[13px] font-medium text-ink">Файлы логов</div>
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-8" />
            ))}
          </div>
        ) : (files?.length ?? 0) === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-ink-faint">Файлов нет</p>
        ) : (
          <ul className="divide-y divide-line">
            {files?.map((file) => (
              <li key={file.name}>
                <button
                  type="button"
                  onClick={() => setSelected(file.name)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]',
                    selected === file.name && 'bg-accent/[0.08]',
                  )}
                >
                  <FileText
                    className={cn('h-4 w-4 shrink-0', selected === file.name ? 'text-accent-soft' : 'text-ink-faint')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12.5px] text-ink">{file.name}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {formatBytes(file.size)} · {formatDate(file.modified)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span className="font-mono text-[13px] text-ink">{selected ?? '—'}</span>
          <SelectField
            aria-label="Количество строк"
            value={String(tail)}
            onChange={(event) => setTail(Number(event.target.value))}
            wrapClassName="w-[150px]"
            className="h-9 py-0"
          >
            <option value="200">последние 200</option>
            <option value="500">последние 500</option>
            <option value="2000">последние 2000</option>
          </SelectField>
        </div>
        {contentLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 14 }).map((_, index) => (
              <Skeleton key={index} className="h-3.5" />
            ))}
          </div>
        ) : (content?.lines.length ?? 0) === 0 ? (
          <EmptyState title="Файл пуст" description="В выбранном файле нет строк." />
        ) : (
          <pre className="max-h-[62vh] overflow-auto scroll-thin bg-base/50 p-4 font-mono text-[12px] leading-relaxed text-ink-muted">
            {content?.lines.join('\n')}
          </pre>
        )}
      </Card>
    </div>
  );
}

export function LogsPage() {
  const [tab, setTab] = useState<Tab>('live');

  return (
    <div className="space-y-5">
      <SectionTitle title="Логи" subtitle="Живой поток событий и файлы журналов" />

      <div className="inline-flex rounded-xl border border-line bg-surface2/50 p-1">
        {(
          [
            { id: 'live' as Tab, label: 'Живой поток', icon: ScrollText },
            { id: 'files' as Tab, label: 'Файлы', icon: FileText },
          ]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors duration-150',
              tab === item.id ? 'bg-accent/15 text-accent-soft' : 'text-ink-muted hover:text-ink',
            )}
          >
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'live' ? <LiveLogs /> : <LogFilesTab />}
    </div>
  );
}
