import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus, Search, Wifi, WifiOff } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAccounts, useChats } from '../../hooks/queries';
import { useDebounce } from '../../hooks/useDebounce';
import { useWsStatus, wsClient } from '../../hooks/useWebSocket';
import { useUiStore } from '../../store/ui';
import { CHAT_KIND_LABEL } from '../../lib/labels';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { chatPhotoUrl } from '../../api/client';

const WS_LABEL: Record<string, string> = {
  open: 'Соединение активно',
  connecting: 'Переподключение…',
  closed: 'Нет соединения',
};

function WsIndicator() {
  const status = useWsStatus();
  const tone = status === 'open' ? 'bg-success' : status === 'connecting' ? 'bg-warning' : 'bg-danger';
  return (
    <button
      type="button"
      onClick={() => wsClient.reconnectNow()}
      title={`${WS_LABEL[status]} · нажмите, чтобы переподключиться`}
      aria-label={WS_LABEL[status]}
      className="flex items-center gap-2 rounded-full border border-line bg-surface2/70 px-3 py-1.5 text-[12px] text-ink-muted transition-colors duration-150 hover:border-line2 hover:text-ink"
    >
      <span className={cn('h-2 w-2 rounded-full', tone, status !== 'open' && 'animate-pulse-dot')} />
      {status === 'open' ? <Wifi className="h-3.5 w-3.5" aria-hidden /> : <WifiOff className="h-3.5 w-3.5" aria-hidden />}
      <span className="hidden lg:inline">{WS_LABEL[status]}</span>
    </button>
  );
}

function AccountSwitcher() {
  const { data: accounts } = useAccounts();
  const activeAccountId = useUiStore((state) => state.activeAccountId);
  const setActiveAccountId = useUiStore((state) => state.setActiveAccountId);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const active = accounts?.find((account) => account.id === activeAccountId) ?? null;

  useEffect(() => {
    if (!accounts || accounts.length === 0) return;
    if (!accounts.some((account) => account.id === activeAccountId)) {
      const preferred = accounts.find((account) => account.status === 'authorized') ?? accounts[0];
      setActiveAccountId(preferred.id);
    }
  }, [accounts, activeAccountId, setActiveAccountId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl border border-line bg-surface2/70 py-1.5 pl-1.5 pr-3 transition-colors duration-150 hover:border-line2"
      >
        {active ? (
          <Avatar name={active.label} seed={active.id} size={28} square />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-dashed border-line2 text-ink-faint">
            <Plus className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[160px] truncate text-[13px] font-medium leading-tight text-ink">
            {active ? active.label : 'Нет аккаунта'}
          </span>
          <span className="block max-w-[160px] truncate text-[11px] leading-tight text-ink-faint">
            {active?.username ? `@${active.username}` : (active?.phone ?? 'Добавьте аккаунт')}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] overflow-hidden rounded-2xl border border-line2 bg-surface/95 shadow-lift backdrop-blur-xl animate-scale-in"
        >
          <div className="max-h-[320px] overflow-y-auto scroll-thin p-1.5">
            {(accounts ?? []).map((account) => (
              <button
                key={account.id}
                type="button"
                role="option"
                aria-selected={account.id === activeAccountId}
                onClick={() => {
                  setActiveAccountId(account.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-white/[0.05]"
              >
                <Avatar name={account.label} seed={account.id} size={30} square />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{account.label}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {account.username ? `@${account.username}` : (account.phone ?? '—')}
                  </span>
                </span>
                {account.connected ? <span className="h-2 w-2 rounded-full bg-success" /> : null}
                {account.id === activeAccountId ? <Check className="h-4 w-4 text-accent-soft" aria-hidden /> : null}
              </button>
            ))}
            {(accounts ?? []).length === 0 ? (
              <p className="px-3 py-4 text-center text-[12.5px] text-ink-faint">Аккаунтов пока нет</p>
            ) : null}
          </div>
          <Link
            to="/accounts/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-line px-3.5 py-3 text-[13px] text-accent-soft transition-colors duration-150 hover:bg-accent/10"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Добавить аккаунт
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const activeAccountId = useUiStore((state) => state.activeAccountId);
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(value, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const params = useMemo(
    () => ({ search: debounced, page: 1, page_size: 8, sort: 'last_message' as const, order: 'desc' as const }),
    [debounced],
  );
  const { data, isFetching } = useChats(debounced.trim().length >= 2 ? activeAccountId : null, params);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const results = data?.items ?? [];

  return (
    <div className="relative min-w-0 flex-1 max-w-[520px]" ref={boxRef}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Поиск по чатам…"
        aria-label="Глобальный поиск по чатам"
        className="field h-10 pl-10 pr-16"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint md:block">
        Ctrl K
      </kbd>

      {open && debounced.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-line2 bg-surface/95 shadow-lift backdrop-blur-xl animate-scale-in">
          {activeAccountId === null ? (
            <p className="px-4 py-4 text-[12.5px] text-ink-faint">Сначала выберите аккаунт</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-ink-faint">
              {isFetching ? 'Ищем…' : 'Ничего не найдено'}
            </p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto scroll-thin p-1.5">
              {results.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setValue('');
                    navigate(`/chats/${chat.id}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-white/[0.05]"
                >
                  <Avatar
                    name={chat.title}
                    seed={chat.id}
                    src={chat.photo_path ? chatPhotoUrl(chat.photo_path) : null}
                    size={30}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{chat.title}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {chat.username ? `@${chat.username}` : CHAT_KIND_LABEL[chat.kind]}
                    </span>
                  </span>
                  <Badge tone="neutral">{CHAT_KIND_LABEL[chat.kind]}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-5 lg:gap-5 lg:px-7">
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-2.5">
          <WsIndicator />
          <AccountSwitcher />
        </div>
      </div>
    </header>
  );
}
