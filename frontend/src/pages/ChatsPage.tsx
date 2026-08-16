import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownUp,
  BadgeCheck,
  Download,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import type { Chat, ChatKind, ChatSortField, ListChatsParams, SortOrder } from '../api/types';
import { useAccount, useChats } from '../hooks/queries';
import { useDebounce } from '../hooks/useDebounce';
import { useWsSubscribe } from '../hooks/useWebSocket';
import { CHAT_KIND_LABEL, CHAT_KIND_TONE } from '../lib/labels';
import { formatBytes, formatDate, formatNumber } from '../lib/format';
import { toast, useUiStore } from '../store/ui';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Card, SectionTitle } from '../components/ui/Card';
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
    if (payload.done) {
      window.setTimeout(() => setSyncProgress(null), 2500);
    }
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
      <SectionTitle
        title="Чаты"
        subtitle={
          account
            ? `${account.label}${account.username ? ` · @${account.username}` : ''} · ${formatNumber(account.chats_count)} чатов`
            : 'Диалоги и каналы аккаунта'
        }
        action={
          <Button
            variant="primary"
            icon={<RefreshCw className={cn('h-4 w-4', syncMutation.isPending && 'animate-spin')} />}
            loading={false}
            disabled={syncMutation.isPending || accountId === null}
            onClick={() => syncMutation.mutate()}
          >
            Синхронизировать из Telegram
          </Button>
        }
      />

      {syncProgress || syncMutation.isPending ? (
        <Card className="p-4">
          <ProgressBar
            value={syncProgress?.done ? 1 : 0.35}
            total={1}
            running={!syncProgress?.done}
            label={syncProgress?.done ? 'Синхронизация завершена' : 'Получаем диалоги из Telegram…'}
            right={`${formatNumber(syncProgress?.synced ?? 0)} чатов`}
          />
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию или @username…"
              aria-label="Поиск по чатам"
              className="field h-10 pl-10"
            />
          </div>
          <SelectField
            aria-label="Сортировка"
            value={sort}
            onChange={(event) => setSort(event.target.value as ChatSortField)}
            wrapClassName="w-[220px]"
            className="h-10 py-0"
          >
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <IconButton
            label={order === 'asc' ? 'По возрастанию' : 'По убыванию'}
            onClick={() => setOrder((value) => (value === 'asc' ? 'desc' : 'asc'))}
            variant="secondary"
          >
            <ArrowDownUp className={cn('h-4 w-4 transition-transform duration-150', order === 'asc' && 'rotate-180')} />
          </IconButton>
          <Chip active={onlyCached} onClick={() => setOnlyCached((value) => !value)} icon={<SlidersHorizontal className="h-3.5 w-3.5" />}>
            Только с кэшем
          </Chip>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {KIND_FILTERS.map((filter) => (
            <Chip key={filter.value} active={kind === filter.value} onClick={() => setKind(filter.value)}>
              {filter.label}
            </Chip>
          ))}
        </div>
      </Card>

      {isLoading ? (
        <SkeletonRows rows={8} />
      ) : isError ? (
        <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            art={<NoChatsArt />}
            title={debouncedSearch ? 'Ничего не найдено' : 'Чатов пока нет'}
            description={
              debouncedSearch
                ? 'Попробуйте изменить запрос или сбросить фильтры.'
                : 'Нажмите «Синхронизировать из Telegram», чтобы загрузить список диалогов и каналов этого аккаунта.'
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
                  Синхронизировать из Telegram
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className={cn('overflow-hidden transition-opacity duration-150', isFetching && 'opacity-70')}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Чат</th>
                  <th className="px-4 py-3 font-medium">Тип</th>
                  <th className="px-4 py-3 font-medium text-right">Участники</th>
                  <th className="px-4 py-3 font-medium">Последнее сообщение</th>
                  <th className="px-4 py-3 font-medium text-right">В кэше</th>
                  <th className="px-4 py-3 font-medium text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((chat) => (
                  <tr
                    key={chat.id}
                    onClick={() => navigate(`/chats/${chat.id}`)}
                    className="group cursor-pointer transition-colors duration-150 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={chat.title}
                          seed={chat.id}
                          src={chat.photo_path ? api.chatPhotoUrl(chat.photo_path) : null}
                          size={36}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13.5px] font-medium text-ink">{chat.title}</span>
                            {chat.is_verified ? (
                              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Верифицирован" />
                            ) : null}
                            {chat.is_scam ? (
                              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="Scam" />
                            ) : null}
                          </div>
                          <p className="truncate text-[11.5px] text-ink-faint">
                            {chat.username ? `@${chat.username}` : `id ${chat.tg_chat_id}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={CHAT_KIND_TONE[chat.kind]}>{CHAT_KIND_LABEL[chat.kind]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-muted">
                      {chat.participants_count !== null ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
                          {formatNumber(chat.participants_count)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-ink-muted">{formatDate(chat.last_message_date)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-[13px] text-ink">{formatNumber(chat.messages_cached)}</span>
                      <span className="block text-[11px] text-ink-faint">
                        {formatNumber(chat.media_cached)} медиа · {formatBytes(chat.bytes_cached)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<Download className="h-3.5 w-3.5" />}
                          onClick={() => setExportChat(chat)}
                        >
                          Экспорт
                        </Button>
                        <Link to={`/chats/${chat.id}`}>
                          <Button size="sm" variant="ghost">
                            Детали
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data?.page ?? page}
            pages={data?.pages ?? 1}
            total={data?.total ?? 0}
            unitLabel="чатов"
            onPage={setPage}
            className="border-t border-line px-4"
          />
        </Card>
      )}

      {exportChat ? (
        <ExportConfigurator open onClose={() => setExportChat(null)} chat={exportChat} />
      ) : null}
    </div>
  );
}
