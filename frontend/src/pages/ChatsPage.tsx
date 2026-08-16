import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDownUp, BadgeCheck, Download, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import type { Chat, ChatKind, ChatSortField, ListChatsParams, SortOrder } from '../api/types';
import { useAccount, useChats } from '../hooks/queries';
import { useDebounce } from '../hooks/useDebounce';
import { useWsSubscribe } from '../hooks/useWebSocket';
import { CHAT_KIND_LABEL, CHAT_KIND_TONE } from '../lib/labels';
import { formatBytes, formatDate, formatNumber } from '../lib/format';
import { toast, useUiStore } from '../store/ui';
import { PageHeader } from '../components/layout/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Chip, SelectField } from '../components/ui/Field';
import { EmptyState, ErrorState, NoChatsArt } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { ProgressBar } from '../components/ui/ProgressBar';
import { SkeletonRows } from '../components/ui/Skeleton';
import { ExportConfigurator } from '../components/export/ExportConfigurator';

const KIND_FILTERS: { value: 'all' | ChatKind; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'channel', label: 'Каналы' },
  { value: 'supergroup', label: 'Супергруппы' },
  { value: 'group', label: 'Группы' },
  { value: 'user', label: 'Личные' },
  { value: 'bot', label: 'Боты' },
];

const SORTS: { value: ChatSortField; label: string }[] = [
  { value: 'last_message', label: 'Последнее сообщение' },
  { value: 'title', label: 'Название' },
  { value: 'messages', label: 'Сообщений в кэше' },
  { value: 'participants', label: 'Участников' },
  { value: 'created', label: 'Дата добавления' },
];

const TH = 'micro-label sticky top-topbar z-10 bg-bg py-2.5 font-medium';

export function ChatsPage() {
  const params = useParams<{ id: string }>();
  const accountId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveAccountId = useUiStore((state) => state.setActiveAccountId);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | ChatKind>('all');
  const [sort, setSort] = useState<ChatSortField>('last_message');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [onlyCached, setOnlyCached] = useState(false);
  const [page, setPage] = useState(1);
  const [exportChat, setExportChat] = useState<Chat | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ synced: number; done: boolean } | null>(null);

  const debouncedSearch = useDebounce(search, 300);
  const { data: account } = useAccount(accountId);

  useEffect(() => {
    if (accountId !== null) setActiveAccountId(accountId);
  }, [accountId, setActiveAccountId]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, kind, sort, order, onlyCached]);

  const listParams: ListChatsParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      kind,
      sort,
      order,
      page,
      page_size: 50,
      only_cached: onlyCached || undefined,
    }),
    [debouncedSearch, kind, sort, order, page, onlyCached],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useChats(accountId, listParams);

  useWsSubscribe('chat_sync', ({ payload }) => {
    if (payload.account_id !== accountId) return;
    setSyncProgress({ synced: payload.synced, done: payload.done });
    if (payload.done) window.setTimeout(() => setSyncProgress(null), 2500);
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncChats(accountId as number, {}),
    onSuccess: (result) => {
      toast.success(
        'Синхронизация завершена',
        `Всего ${formatNumber(result.synced)} · новых ${formatNumber(result.created)} · обновлено ${formatNumber(result.updated)}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error_) => toast.error('Не удалось синхронизировать чаты', api.errorMessage(error_)),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Чаты"
        subtitle={
          account
            ? `${account.label}${account.username ? ` · @${account.username}` : ''} · ${formatNumber(account.chats_count)} чатов`
            : 'Диалоги и каналы аккаунта'
        }
      >
        <Button
          variant="primary"
          size="sm"
          icon={<RefreshCw className={cn('h-3.5 w-3.5', syncMutation.isPending && 'animate-spin')} />}
          disabled={syncMutation.isPending || accountId === null}
          onClick={() => syncMutation.mutate()}
        >
          Синхронизировать
        </Button>
      </PageHeader>

      {syncProgress || syncMutation.isPending ? (
        <ProgressBar
          value={syncProgress?.done ? 1 : 0.35}
          total={1}
          running={!syncProgress?.done}
          label={syncProgress?.done ? 'Синхронизация завершена' : 'Получаем диалоги из Telegram…'}
          right={`${formatNumber(syncProgress?.synced ?? 0)} чатов`}
        />
      ) : null}

      {/* ------------------------------------------------------------ filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию или @username"
              aria-label="Поиск по чатам"
              className="field h-9 pl-9"
            />
          </div>
          <SelectField
            aria-label="Сортировка"
            value={sort}
            onChange={(event) => setSort(event.target.value as ChatSortField)}
            wrapClassName="w-[210px]"
            className="h-9 py-0"
          >
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <IconButton
            label={order === 'asc' ? 'Сортировка: по возрастанию' : 'Сортировка: по убыванию'}
            onClick={() => setOrder((value) => (value === 'asc' ? 'desc' : 'asc'))}
            variant="secondary"
          >
            <ArrowDownUp className={cn('h-4 w-4 transition-transform duration-150', order === 'asc' && 'rotate-180')} />
          </IconButton>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {KIND_FILTERS.map((filter) => (
            <Chip key={filter.value} active={kind === filter.value} onClick={() => setKind(filter.value)}>
              {filter.label}
            </Chip>
          ))}
          <Chip className="ml-auto" active={onlyCached} onClick={() => setOnlyCached((value) => !value)}>
            Только с кэшем
          </Chip>
        </div>
      </div>

      {isLoading ? (
        <SkeletonRows rows={8} />
      ) : isError ? (
        <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          art={<NoChatsArt />}
          title={debouncedSearch ? 'Ничего не найдено' : 'Чатов пока нет'}
          description={
            debouncedSearch
              ? 'Попробуйте изменить запрос или сбросить фильтры.'
              : 'Нажмите «Синхронизировать», чтобы загрузить список диалогов и каналов этого аккаунта.'
          }
          action={
            debouncedSearch ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setKind('all');
                  setOnlyCached(false);
                }}
              >
                Сбросить фильтры
              </Button>
            ) : (
              <Button variant="primary" loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
                Синхронизировать
              </Button>
            )
          }
        />
      ) : (
        <div className={cn('transition-opacity duration-150', isFetching && 'opacity-60')}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className={cn(TH, 'pr-3')}>Чат</th>
                <th className={cn(TH, 'hidden pr-3 sm:table-cell')}>Тип</th>
                <th className={cn(TH, 'hidden pr-3 text-right xl:table-cell')}>Участники</th>
                <th className={cn(TH, 'hidden pr-3 lg:table-cell')}>Последнее сообщение</th>
                <th className={cn(TH, 'pr-3 text-right')}>В кэше</th>
                <th className={cn(TH, 'w-[92px] text-right')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((chat) => (
                <tr
                  key={chat.id}
                  onClick={() => navigate(`/chats/${chat.id}`)}
                  className="group cursor-pointer transition-colors duration-120 hover:bg-veil"
                >
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={chat.title}
                        seed={chat.id}
                        src={chat.photo_path ? api.chatPhotoUrl(chat.photo_path) : null}
                        size={30}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] text-text">{chat.title}</span>
                          {chat.is_verified ? (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Верифицирован" />
                          ) : null}
                          {chat.is_scam ? (
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="Scam" />
                          ) : null}
                        </div>
                        <p className="truncate font-mono text-[11px] text-muted">
                          {chat.username ? `@${chat.username}` : `id ${chat.tg_chat_id}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden py-2 pr-3 sm:table-cell">
                    <Badge tone={CHAT_KIND_TONE[chat.kind]}>{CHAT_KIND_LABEL[chat.kind]}</Badge>
                  </td>
                  <td className="tnum hidden py-2 pr-3 text-right font-mono text-[12.5px] text-dim xl:table-cell">
                    {chat.participants_count !== null ? formatNumber(chat.participants_count) : '—'}
                  </td>
                  <td className="tnum hidden py-2 pr-3 text-[12.5px] text-dim lg:table-cell">
                    {formatDate(chat.last_message_date)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span className="tnum font-mono text-[12.5px] text-text">
                      {formatNumber(chat.messages_cached)}
                    </span>
                    <span className="tnum block font-mono text-[11px] text-muted">
                      {formatNumber(chat.media_cached)} медиа · {formatBytes(chat.bytes_cached)}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
                      <IconButton label="Настроить экспорт" size="sm" onClick={() => setExportChat(chat)}>
                        <Download className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination
            page={data?.page ?? page}
            pages={data?.pages ?? 1}
            total={data?.total ?? 0}
            unitLabel="чатов"
            onPage={setPage}
            className="border-t border-border"
          />
        </div>
      )}

      {exportChat ? <ExportConfigurator open onClose={() => setExportChat(null)} chat={exportChat} /> : null}
    </div>
  );
}
