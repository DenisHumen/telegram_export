import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, FileText, RefreshCw, ScrollText, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import type { ListLogsParams, LogLevel, LogRow } from '../api/types';
import { useAccounts, useJobs, useLogFile, useLogFiles, useLogs } from '../hooks/queries';
import { useDebounce } from '../hooks/useDebounce';
import { useWsSubscribe } from '../hooks/useWebSocket';
import { LOG_LEVELS, LOG_LEVEL_BORDER, LOG_LEVEL_CLASS, LOG_LEVEL_LABEL } from '../lib/labels';
import { formatBytes, formatDate, formatTime } from '../lib/format';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Chip, Segmented, SelectField } from '../components/ui/Field';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';

type Tab = 'live' | 'files';

/** Hard DOM cap — the live stream never renders more than this many rows. */
const MAX_ROWS = 500;

const CHIP_TONE: Record<LogLevel, string> = {
  debug: 'border-transparent bg-surface-2 text-dim',
  info: 'border-transparent bg-accent-soft text-accent',
  warning: 'border-transparent bg-warning/12 text-warning',
  error: 'border-transparent bg-danger/12 text-danger',
};

function LiveLogs() {
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<number | 'all'>('all');
  const [jobId, setJobId] = useState<number | 'all'>('all');
  const [stick, setStick] = useState(true);
  const [live, setLive] = useState<LogRow[]>([]);

  const debouncedSearch = useDebounce(search, 300);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setLive((previous) => [...previous.filter((row) => row.id !== payload.id), payload].slice(-MAX_ROWS));
  });

  const rows = useMemo(() => {
    const map = new Map<number, LogRow>();
    for (const row of data ?? []) map.set(row.id, row);
    for (const row of live) map.set(row.id, row);
    return Array.from(map.values())
      .sort((a, b) => a.id - b.id)
      .slice(-MAX_ROWS);
  }, [data, live]);

  /* Stick to the bottom while the user is there; release as soon as they scroll up. */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stick) return;
    node.scrollTop = node.scrollHeight;
  }, [rows.length, stick]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    setStick(node.scrollHeight - node.scrollTop - node.clientHeight < 40);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по сообщениям"
            aria-label="Поиск по логам"
            className="field h-9 pl-9"
          />
        </div>
        <SelectField
          aria-label="Фильтр по аккаунту"
          value={accountId === 'all' ? 'all' : String(accountId)}
          onChange={(event) => setAccountId(event.target.value === 'all' ? 'all' : Number(event.target.value))}
          wrapClassName="w-[180px]"
          className="h-9 py-0"
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
          wrapClassName="w-[180px]"
          className="h-9 py-0"
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
          icon={<RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />}
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
          <button
            key={item}
            type="button"
            onClick={() => setLevel(item)}
            aria-pressed={level === item}
            className={cn(
              'rounded-pill border px-2.5 py-1 text-[12.5px] font-medium transition-colors duration-120',
              level === item
                ? CHIP_TONE[item]
                : 'border-border text-dim hover:border-border-strong hover:text-text',
            )}
          >
            {LOG_LEVEL_LABEL[item]}
          </button>
        ))}
        <Chip
          className="ml-auto"
          active={stick}
          onClick={() => setStick((value) => !value)}
          icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
        >
          Автопрокрутка
        </Chip>
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="h-3" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} className="m-4" />
        ) : rows.length === 0 ? (
          <EmptyState title="Логи пусты" description="Записей по заданным фильтрам пока нет." />
        ) : (
          <div ref={scrollRef} onScroll={onScroll} className="scroll-thin max-h-[62vh] overflow-y-auto px-3 py-2">
            <ol className="space-y-0.5 font-mono text-[11.5px] leading-relaxed">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'flex gap-3 border-l-2 py-0.5 pl-2.5 transition-colors duration-120 hover:bg-veil',
                    LOG_LEVEL_BORDER[row.level],
                  )}
                >
                  <span className="tnum shrink-0 text-muted" title={formatDate(row.ts)}>
                    {formatTime(row.ts)}
                  </span>
                  <span className={cn('w-14 shrink-0 uppercase', LOG_LEVEL_CLASS[row.level])}>{row.level}</span>
                  <span className="hidden w-36 shrink-0 truncate text-muted lg:block" title={row.logger}>
                    {row.logger}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-dim">{row.message}</span>
                  {row.job_id !== null ? <span className="shrink-0 text-muted">job#{row.job_id}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <p className="text-[11.5px] text-muted">
        Показаны последние {Math.min(rows.length, MAX_ROWS)} записей
        {rows.length >= MAX_ROWS ? ` (лимит ${MAX_ROWS})` : ''}
      </p>
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
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <p className="micro-label mb-2">Файлы логов</p>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-8" />
            ))}
          </div>
        ) : (files?.length ?? 0) === 0 ? (
          <p className="text-[12.5px] text-muted">Файлов нет</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border">
            {files?.map((file) => (
              <li key={file.name}>
                <button
                  type="button"
                  onClick={() => setSelected(file.name)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-120 hover:bg-veil',
                    selected === file.name && 'bg-accent-soft',
                  )}
                >
                  <FileText
                    className={cn('h-4 w-4 shrink-0', selected === file.name ? 'text-accent' : 'text-muted')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate font-mono text-[12.5px]',
                        selected === file.name ? 'text-accent' : 'text-text',
                      )}
                    >
                      {file.name}
                    </span>
                    <span className="tnum block truncate text-[11px] text-muted">
                      {formatBytes(file.size)} · {formatDate(file.modified)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[12.5px] text-dim">{selected ?? '—'}</span>
          <SelectField
            aria-label="Количество строк"
            value={String(tail)}
            onChange={(event) => setTail(Number(event.target.value))}
            wrapClassName="w-[160px]"
            className="h-8 py-0 text-[12.5px]"
          >
            <option value="200">последние 200</option>
            <option value="500">последние 500</option>
            <option value="2000">последние 2000</option>
          </SelectField>
        </div>
        {contentLoading ? (
          <div className="space-y-2 rounded-card border border-border p-4">
            {Array.from({ length: 14 }).map((_, index) => (
              <Skeleton key={index} className="h-3" />
            ))}
          </div>
        ) : (content?.lines.length ?? 0) === 0 ? (
          <div className="rounded-card border border-border">
            <EmptyState title="Файл пуст" description="В выбранном файле нет строк." />
          </div>
        ) : (
          <pre className="scroll-thin max-h-[62vh] overflow-auto rounded-card border border-border p-4 font-mono text-[11.5px] leading-relaxed text-dim">
            {content?.lines.slice(-MAX_ROWS).join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}

export function LogsPage() {
  const [tab, setTab] = useState<Tab>('live');

  return (
    <div className="space-y-5">
      <PageHeader title="Логи" subtitle="Живой поток событий и файлы журналов">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'live', label: 'Поток', icon: <ScrollText className="h-3.5 w-3.5" aria-hidden /> },
            { value: 'files', label: 'Файлы', icon: <FileText className="h-3.5 w-3.5" aria-hidden /> },
          ]}
        />
      </PageHeader>

      {tab === 'live' ? <LiveLogs /> : <LogFilesTab />}
    </div>
  );
}
