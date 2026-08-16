import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownUp,
  ArrowLeft,
  BadgeCheck,
  Download,
  FileDown,
  Paperclip,
  Search,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import type { ListMessagesParams, MessageFile, MessageSortField, SortOrder } from '../api/types';
import { useChat, useChatStats, useMessages } from '../hooks/queries';
import { useDebounce } from '../hooks/useDebounce';
import { chartSeries, useTokenColors } from '../store/theme';
import { CHAT_KIND_LABEL, CHAT_KIND_TONE, MESSAGE_MEDIA_TYPES, MESSAGE_MEDIA_TYPE_LABEL } from '../lib/labels';
import { formatBytes, formatDate, formatMonth, formatNumber, truncate } from '../lib/format';
import { PageHeader } from '../components/layout/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Section, SectionHeading } from '../components/ui/Card';
import { SelectField, TextField } from '../components/ui/Field';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonRows } from '../components/ui/Skeleton';
import { StatTile } from '../components/ui/StatTile';
import { ExportConfigurator } from '../components/export/ExportConfigurator';

const THUMBABLE = new Set(['photo', 'video', 'animation', 'video_note', 'sticker']);

/** Preview tile backed by GET /api/files/thumb — disappears when there is no thumb. */
function FileThumb({ file }: { file: MessageFile }) {
  const [broken, setBroken] = useState(false);
  if (broken || file.status !== 'done' || !THUMBABLE.has(file.kind)) return null;
  return (
    <a
      href={api.fileDownloadUrl(file.id)}
      target="_blank"
      rel="noreferrer"
      title={file.file_name ?? file.kind}
      className="block overflow-hidden rounded-control border border-border transition-colors duration-120 hover:border-border-strong"
    >
      <img
        src={api.fileThumbUrl(file.id)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-16 w-16 object-cover"
      />
    </a>
  );
}

export function ChatDetailPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId ? Number(params.chatId) : null;
  const tokens = useTokenColors();
  const series = useMemo(() => chartSeries(tokens), [tokens]);

  const [exportOpen, setExportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<MessageSortField>('date');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const { data: chat, isLoading: chatLoading, isError: chatError, error: chatErrorValue, refetch } = useChat(chatId);
  const { data: stats, isLoading: statsLoading } = useChatStats(chatId);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, mediaType, dateFrom, dateTo, sort, order]);

  const messageParams: ListMessagesParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      media_type: mediaType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      sort,
      order,
      page,
      page_size: 50,
    }),
    [debouncedSearch, mediaType, dateFrom, dateTo, sort, order, page],
  );

  const { data: messages, isLoading: messagesLoading, isFetching } = useMessages(chatId, messageParams);

  const monthData = useMemo(
    () => (stats?.by_month ?? []).map((item) => ({ ...item, label: formatMonth(item.month) })),
    [stats],
  );

  const mediaData = useMemo(
    () =>
      Object.entries(stats?.by_media_type ?? {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, name: MESSAGE_MEDIA_TYPE_LABEL[key] ?? key, value: count })),
    [stats],
  );

  const tooltipStyle = {
    background: tokens.surface,
    border: `1px solid ${tokens['border']}`,
    borderRadius: 10,
    fontSize: 12,
    color: tokens.text,
    padding: '6px 9px',
  };

  if (chatError) {
    return (
      <>
        <PageHeader title="Чат" subtitle="Не удалось загрузить" />
        <ErrorState description={api.errorMessage(chatErrorValue)} onRetry={() => void refetch()} />
      </>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={chatLoading ? 'Загрузка…' : (chat?.title ?? 'Чат')}
        subtitle={
          chat
            ? [
                CHAT_KIND_LABEL[chat.kind],
                chat.username ? `@${chat.username}` : `id ${chat.tg_chat_id}`,
                chat.participants_count !== null ? `${formatNumber(chat.participants_count)} участников` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Статистика и сообщения'
        }
      >
        <Link to={chat ? `/accounts/${chat.account_id}/chats` : '/accounts'}>
          <IconButton label="Назад к списку чатов" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        </Link>
        <Button
          variant="primary"
          size="sm"
          icon={<Download className="h-3.5 w-3.5" />}
          disabled={!chat}
          onClick={() => setExportOpen(true)}
        >
          Экспорт
        </Button>
      </PageHeader>

      {chat ? (
        <div className="flex flex-wrap items-center gap-2">
          <Avatar
            name={chat.title}
            seed={chat.id}
            src={chat.photo_path ? api.chatPhotoUrl(chat.photo_path) : null}
            size={32}
          />
          <Badge tone={CHAT_KIND_TONE[chat.kind]}>{CHAT_KIND_LABEL[chat.kind]}</Badge>
          {chat.is_verified ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-accent">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> верифицирован
            </span>
          ) : null}
          {chat.is_scam ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-danger">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> scam
            </span>
          ) : null}
          {chat.participants_count !== null ? (
            <span className="tnum inline-flex items-center gap-1 text-[12px] text-muted">
              <Users className="h-3.5 w-3.5" aria-hidden /> {formatNumber(chat.participants_count)}
            </span>
          ) : null}
          {stats?.active_job_id ? (
            <Link
              to="/jobs"
              className="ml-auto inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-1 text-[12px] text-accent"
            >
              <span className="h-1.5 w-1.5 animate-soft-pulse rounded-pill bg-accent" />
              Идёт экспорт · задача #{stats.active_job_id}
            </Link>
          ) : null}
        </div>
      ) : null}

      {chat?.about ? (
        <p className="max-w-3xl whitespace-pre-line text-[13px] leading-relaxed text-dim">
          {truncate(chat.about, 600)}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Сообщений"
          value={formatNumber(stats?.messages ?? chat?.messages_cached ?? 0)}
          loading={statsLoading}
          accent
        />
        <StatTile
          label="Медиафайлов"
          value={formatNumber(stats?.media_files ?? chat?.media_cached ?? 0)}
          loading={statsLoading}
        />
        <StatTile
          label="Объём"
          value={formatBytes(stats?.bytes ?? chat?.bytes_cached ?? 0)}
          loading={statsLoading}
        />
        <StatTile
          label="Первое сообщение"
          value={<span className="text-[16px]">{formatDate(stats?.first_message_date, false)}</span>}
          loading={statsLoading}
        />
        <StatTile
          label="Последнее сообщение"
          value={<span className="text-[16px]">{formatDate(stats?.last_message_date, false)}</span>}
          loading={statsLoading}
        />
      </div>

      {/* ----------------------------------------------------------- charts */}
      <div className="grid gap-8 border-t border-border pt-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section>
          <SectionHeading title="Активность по месяцам" />
          <div className="mt-3 h-[240px]">
            {monthData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-[13px] text-muted">Данных пока нет</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: tokens['text-muted'], fontSize: 11 }}
                    axisLine={{ stroke: tokens['border'] }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fill: tokens['text-muted'], fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                  <ReTooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: tokens['surface-2'], opacity: 0.5 }}
                    formatter={(value: number) => [formatNumber(value), 'сообщений']}
                  />
                  {/* isAnimationActive=false: the grow-in animation leaves bars at zero
                      height in non-compositing contexts (headless screenshots), and the
                      design calls for no decorative motion here anyway. */}
                  <Bar
                    dataKey="count"
                    fill={tokens.accent}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={34}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section>
          <SectionHeading title="Типы медиа" />
          <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="h-[150px]">
              {mediaData.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[13px] text-muted">Нет данных</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={mediaData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={40}
                      outerRadius={68}
                      paddingAngle={2}
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {mediaData.map((entry, index) => (
                        <Cell key={entry.key} fill={series[index % series.length]} />
                      ))}
                    </Pie>
                    <ReTooltip contentStyle={tooltipStyle} formatter={(value: number) => formatNumber(value)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <ul className="space-y-1 self-center">
              {mediaData.slice(0, 8).map((entry, index) => (
                <li key={entry.key} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: series[index % series.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-dim">{entry.name}</span>
                  <span className="tnum font-mono text-text">{formatNumber(entry.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {(stats?.top_senders?.length ?? 0) > 0 ? (
        <Section title="Топ отправителей">
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {stats?.top_senders.slice(0, 9).map((sender, index) => (
              <div key={`${sender.sender_id}-${index}`} className="flex items-center gap-2.5 border-b border-border py-2">
                <span className="tnum w-4 shrink-0 font-mono text-[11.5px] text-muted">{index + 1}</span>
                <Avatar name={sender.name} seed={sender.sender_id} size={26} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-text">{sender.name || 'Без имени'}</span>
                <span className="tnum font-mono text-[12.5px] text-dim">{formatNumber(sender.count)}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* --------------------------------------------------------- messages */}
      <Section
        title="Сообщения"
        description="Кэшированные сообщения с фильтрами"
        action={<span className="tnum font-mono text-[12px] text-muted">{formatNumber(messages?.total ?? 0)}</span>}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по тексту"
              aria-label="Поиск по сообщениям"
              className="field h-9 pl-9"
            />
          </div>
          <SelectField
            aria-label="Тип медиа"
            value={mediaType}
            onChange={(event) => setMediaType(event.target.value)}
            wrapClassName="w-[170px]"
            className="h-9 py-0"
          >
            <option value="">Любой тип</option>
            {MESSAGE_MEDIA_TYPES.map((type) => (
              <option key={type} value={type}>
                {MESSAGE_MEDIA_TYPE_LABEL[type]}
              </option>
            ))}
          </SelectField>
          <TextField
            type="date"
            aria-label="Дата с"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            wrapClassName="w-[150px]"
            className="h-9 py-0"
          />
          <TextField
            type="date"
            aria-label="Дата по"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            wrapClassName="w-[150px]"
            className="h-9 py-0"
          />
          <SelectField
            aria-label="Сортировка"
            value={sort}
            onChange={(event) => setSort(event.target.value as MessageSortField)}
            wrapClassName="w-[140px]"
            className="h-9 py-0"
          >
            <option value="date">По дате</option>
            <option value="size">По размеру</option>
            <option value="views">По просмотрам</option>
            <option value="type">По типу</option>
          </SelectField>
          <IconButton
            label={order === 'asc' ? 'Сортировка: по возрастанию' : 'Сортировка: по убыванию'}
            variant="secondary"
            onClick={() => setOrder((value) => (value === 'asc' ? 'desc' : 'asc'))}
          >
            <ArrowDownUp className={cn('h-4 w-4 transition-transform duration-150', order === 'asc' && 'rotate-180')} />
          </IconButton>
        </div>

        {messagesLoading ? (
          <SkeletonRows rows={6} className="mt-4" />
        ) : (messages?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Сообщений не найдено"
            description="Возможно, чат ещё не выгружался. Запустите экспорт, чтобы наполнить локальный кэш."
          />
        ) : (
          <div className={cn('mt-2 divide-y divide-border transition-opacity duration-150', isFetching && 'opacity-60')}>
            {messages?.items.map((message) => (
              <article key={message.id} className="flex gap-3 py-3">
                <Avatar name={message.sender_name ?? '—'} seed={message.sender_id ?? message.id} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <span className="text-[13px] font-medium text-text">
                      {message.sender_name ?? 'Без отправителя'}
                    </span>
                    <span className="tnum font-mono text-[11px] text-muted">#{message.tg_message_id}</span>
                    <span className="tnum text-[11.5px] text-muted">{formatDate(message.date)}</span>
                    {message.is_service ? <Badge>служебное</Badge> : null}
                    {message.media_type && message.media_type !== 'none' ? (
                      <Badge tone="accent">{MESSAGE_MEDIA_TYPE_LABEL[message.media_type] ?? message.media_type}</Badge>
                    ) : null}
                    {message.views !== null ? (
                      <span className="tnum text-[11.5px] text-muted">{formatNumber(message.views)} просмотров</span>
                    ) : null}
                  </div>
                  {message.text ? (
                    <p className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-dim">
                      {truncate(message.text, 480)}
                    </p>
                  ) : null}
                  {message.files.some((file) => THUMBABLE.has(file.kind) && file.status === 'done') ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.files.map((file) => (
                        <FileThumb key={`thumb-${file.id}`} file={file} />
                      ))}
                    </div>
                  ) : null}
                  {message.files.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.files.map((file) => {
                        const downloaded = file.status === 'done';
                        const body = (
                          <>
                            <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="max-w-[240px] truncate">{file.file_name ?? file.kind}</span>
                            {file.size ? <span className="tnum text-muted">{formatBytes(file.size)}</span> : null}
                            {downloaded ? <FileDown className="h-3 w-3 shrink-0" aria-hidden /> : null}
                          </>
                        );
                        return downloaded ? (
                          <a
                            key={file.id}
                            href={api.fileDownloadUrl(file.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-1 font-mono text-[11.5px] text-dim transition-colors duration-120 hover:border-accent/45 hover:text-accent"
                          >
                            {body}
                          </a>
                        ) : (
                          <span
                            key={file.id}
                            title={`Статус: ${file.status}`}
                            className="inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-1 font-mono text-[11.5px] text-muted"
                          >
                            {body}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}

        {(messages?.pages ?? 0) > 1 ? (
          <Pagination
            page={messages?.page ?? page}
            pages={messages?.pages ?? 1}
            total={messages?.total ?? 0}
            unitLabel="сообщений"
            onPage={setPage}
            className="border-t border-border"
          />
        ) : null}
      </Section>

      {chat ? (
        <ExportConfigurator open={exportOpen} onClose={() => setExportOpen(false)} chat={chat} stats={stats} />
      ) : null}
    </div>
  );
}
