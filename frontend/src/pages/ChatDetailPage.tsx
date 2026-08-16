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
  CalendarDays,
  Download,
  FileDown,
  HardDrive,
  Image as ImageIcon,
  MessageSquare,
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
import {
  CHAT_KIND_LABEL,
  CHAT_KIND_TONE,
  MESSAGE_MEDIA_TYPES,
  MESSAGE_MEDIA_TYPE_LABEL,
} from '../lib/labels';
import { formatBytes, formatDate, formatMonth, formatNumber, truncate } from '../lib/format';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Card, CardHeader, SectionTitle } from '../components/ui/Card';
import { SelectField, TextField } from '../components/ui/Field';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonRows } from '../components/ui/Skeleton';
import { StatTile } from '../components/ui/StatTile';
import { ExportConfigurator } from '../components/export/ExportConfigurator';

const PIE_COLORS = ['#3390EC', '#5CC8FF', '#3DD68C', '#F5A524', '#F2555A', '#A78BFA', '#22D3EE', '#F472B6'];

const TOOLTIP_STYLE = {
  background: '#111823',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  fontSize: 12,
  color: '#E8EEF6',
  padding: '8px 10px',
};

const THUMBABLE = new Set(['photo', 'video', 'animation', 'video_note', 'sticker']);

/** Preview tile backed by GET /api/files/thumb — silently disappears when there is no thumb. */
function FileThumb({ file }: { file: MessageFile }) {
  const [broken, setBroken] = useState(false);
  if (broken || file.status !== 'done' || !THUMBABLE.has(file.kind)) return null;
  return (
    <a
      href={api.fileDownloadUrl(file.id)}
      target="_blank"
      rel="noreferrer"
      title={file.file_name ?? file.kind}
      className="block overflow-hidden rounded-lg border border-line transition-all duration-150 hover:border-accent/50"
    >
      <img
        src={api.fileThumbUrl(file.id)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-20 w-20 object-cover"
      />
    </a>
  );
}

export function ChatDetailPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId ? Number(params.chatId) : null;

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

  if (chatError) {
    return <ErrorState description={api.errorMessage(chatErrorValue)} onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title={
          <span className="flex items-center gap-3">
            <Link to={chat ? `/accounts/${chat.account_id}/chats` : '/accounts'} aria-label="Назад к чатам">
              <IconButton label="Назад к чатам" size="sm">
                <ArrowLeft className="h-4 w-4" />
              </IconButton>
            </Link>
            {chatLoading ? 'Загрузка…' : (chat?.title ?? 'Чат')}
          </span>
        }
        subtitle={
          chat ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={CHAT_KIND_TONE[chat.kind]}>{CHAT_KIND_LABEL[chat.kind]}</Badge>
              {chat.username ? <span className="font-mono text-[12px]">@{chat.username}</span> : null}
              <span className="font-mono text-[12px]">id {chat.tg_chat_id}</span>
              {chat.is_verified ? <BadgeCheck className="h-3.5 w-3.5 text-accent" aria-label="Верифицирован" /> : null}
              {chat.is_scam ? <ShieldAlert className="h-3.5 w-3.5 text-danger" aria-label="Scam" /> : null}
              {chat.participants_count !== null ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" aria-hidden /> {formatNumber(chat.participants_count)}
                </span>
              ) : null}
            </span>
          ) : null
        }
        action={
          <Button
            variant="primary"
            size="lg"
            icon={<Download className="h-4 w-4" />}
            disabled={!chat}
            onClick={() => setExportOpen(true)}
          >
            Экспорт
          </Button>
        }
      />

      {chat?.about ? (
        <Card className="p-4">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-muted">{truncate(chat.about, 600)}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          icon={<MessageSquare className="h-4 w-4" />}
          label="Сообщений"
          value={formatNumber(stats?.messages ?? chat?.messages_cached ?? 0)}
          loading={statsLoading}
        />
        <StatTile
          icon={<ImageIcon className="h-4 w-4" />}
          label="Медиафайлов"
          value={formatNumber(stats?.media_files ?? chat?.media_cached ?? 0)}
          loading={statsLoading}
          tone="warning"
        />
        <StatTile
          icon={<HardDrive className="h-4 w-4" />}
          label="Объём"
          value={formatBytes(stats?.bytes ?? chat?.bytes_cached ?? 0)}
          loading={statsLoading}
          tone="success"
        />
        <StatTile
          icon={<CalendarDays className="h-4 w-4" />}
          label="Первое сообщение"
          value={<span className="text-[16px]">{formatDate(stats?.first_message_date, false)}</span>}
          loading={statsLoading}
          tone="neutral"
        />
        <StatTile
          icon={<CalendarDays className="h-4 w-4" />}
          label="Последнее сообщение"
          value={<span className="text-[16px]">{formatDate(stats?.last_message_date, false)}</span>}
          loading={statsLoading}
          tone="neutral"
        />
      </div>

      {stats?.active_job_id ? (
        <Link
          to="/jobs"
          className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/[0.08] px-4 py-3 text-[13px] text-accent-soft transition-colors duration-150 hover:bg-accent/[0.12]"
        >
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
          Для этого чата уже выполняется экспорт (задача #{stats.active_job_id}) — открыть страницу задач
        </Link>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Активность по месяцам" subtitle="Количество сообщений" />
          <div className="h-[260px] p-4">
            {monthData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-[13px] text-ink-faint">Данных пока нет</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#5E6E82', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: '#5E6E82', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <ReTooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(value: number) => [formatNumber(value), 'сообщений']}
                  />
                  <Bar dataKey="count" fill="#3390EC" radius={[4, 4, 0, 0]} maxBarSize={38} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Типы медиа" subtitle="Распределение вложений" />
          <div className="grid gap-3 p-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div className="h-[160px]">
              {mediaData.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[13px] text-ink-faint">Нет данных</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={mediaData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={44}
                      outerRadius={72}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {mediaData.map((entry, index) => (
                        <Cell key={entry.key} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => formatNumber(value)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <ul className="space-y-1.5 self-center">
              {mediaData.slice(0, 8).map((entry, index) => (
                <li key={entry.key} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink-muted">{entry.name}</span>
                  <span className="font-mono text-ink">{formatNumber(entry.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {(stats?.top_senders?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader title="Топ отправителей" subtitle="По количеству сообщений" />
          <div className="grid gap-px bg-line/40 sm:grid-cols-2 lg:grid-cols-3">
            {stats?.top_senders.slice(0, 9).map((sender, index) => (
              <div key={`${sender.sender_id}-${index}`} className="flex items-center gap-3 bg-surface px-4 py-3">
                <span className="w-5 shrink-0 font-mono text-[12px] text-ink-faint">{index + 1}</span>
                <Avatar name={sender.name} seed={sender.sender_id} size={30} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{sender.name || 'Без имени'}</span>
                <span className="font-mono text-[12.5px] text-accent-soft">{formatNumber(sender.count)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* -------------------------------------------------- messages */}
      <Card>
        <CardHeader
          title="Сообщения"
          subtitle="Просмотр кэшированных сообщений с фильтрами"
          action={
            <span className="font-mono text-[12px] text-ink-faint">{formatNumber(messages?.total ?? 0)}</span>
          }
        />

        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по тексту…"
              aria-label="Поиск по сообщениям"
              className="field h-10 pl-10"
            />
          </div>
          <SelectField
            aria-label="Тип медиа"
            value={mediaType}
            onChange={(event) => setMediaType(event.target.value)}
            wrapClassName="w-[180px]"
            className="h-10 py-0"
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
            wrapClassName="w-[160px]"
            className="h-10 py-0"
          />
          <TextField
            type="date"
            aria-label="Дата по"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            wrapClassName="w-[160px]"
            className="h-10 py-0"
          />
          <SelectField
            aria-label="Сортировка"
            value={sort}
            onChange={(event) => setSort(event.target.value as MessageSortField)}
            wrapClassName="w-[150px]"
            className="h-10 py-0"
          >
            <option value="date">По дате</option>
            <option value="size">По размеру</option>
            <option value="views">По просмотрам</option>
            <option value="type">По типу</option>
          </SelectField>
          <IconButton
            label={order === 'asc' ? 'По возрастанию' : 'По убыванию'}
            variant="secondary"
            onClick={() => setOrder((value) => (value === 'asc' ? 'desc' : 'asc'))}
          >
            <ArrowDownUp className={cn('h-4 w-4 transition-transform duration-150', order === 'asc' && 'rotate-180')} />
          </IconButton>
        </div>

        {messagesLoading ? (
          <div className="p-4">
            <SkeletonRows rows={6} />
          </div>
        ) : (messages?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Сообщений не найдено"
            description="Возможно, чат ещё не выгружался. Запустите экспорт, чтобы наполнить локальный кэш."
          />
        ) : (
          <div className={cn('divide-y divide-line transition-opacity duration-150', isFetching && 'opacity-70')}>
            {messages?.items.map((message) => (
              <article key={message.id} className="flex gap-3 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.02]">
                <Avatar name={message.sender_name ?? '—'} seed={message.sender_id ?? message.id} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[13px] font-medium text-ink">{message.sender_name ?? 'Без отправителя'}</span>
                    <span className="font-mono text-[11.5px] text-ink-faint">#{message.tg_message_id}</span>
                    <span className="text-[11.5px] text-ink-faint">{formatDate(message.date)}</span>
                    {message.is_service ? <Badge tone="neutral">служебное</Badge> : null}
                    {message.media_type && message.media_type !== 'none' ? (
                      <Badge tone="accent">{MESSAGE_MEDIA_TYPE_LABEL[message.media_type] ?? message.media_type}</Badge>
                    ) : null}
                    {message.views !== null ? (
                      <span className="text-[11.5px] text-ink-faint">{formatNumber(message.views)} просмотров</span>
                    ) : null}
                  </div>
                  {message.text ? (
                    <p className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink-muted">
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
                            {file.size ? <span className="text-ink-faint">{formatBytes(file.size)}</span> : null}
                            {downloaded ? <FileDown className="h-3 w-3 shrink-0" aria-hidden /> : null}
                          </>
                        );
                        return downloaded ? (
                          <a
                            key={file.id}
                            href={api.fileDownloadUrl(file.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1 font-mono text-[11.5px] text-accent-soft transition-colors duration-150 hover:bg-accent/20"
                          >
                            {body}
                          </a>
                        ) : (
                          <span
                            key={file.id}
                            title={`Статус: ${file.status}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.03] px-2 py-1 font-mono text-[11.5px] text-ink-faint"
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
            className="border-t border-line px-4"
          />
        ) : null}
      </Card>

      {chat ? (
        <ExportConfigurator open={exportOpen} onClose={() => setExportOpen(false)} chat={chat} stats={stats} />
      ) : null}
    </div>
  );
}
