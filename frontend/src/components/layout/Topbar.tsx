import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAccounts, useChats } from '../../hooks/queries';
import { useDebounce } from '../../hooks/useDebounce';
import { useWsStatus, wsClient } from '../../hooks/useWebSocket';
import { usePageStore, useUiStore } from '../../store/ui';
import { CHAT_KIND_LABEL } from '../../lib/labels';
import { chatPhotoUrl } from '../../api/client';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';
import { ThemeToggle } from './ThemeToggle';

const WS_LABEL: Record<string, string> = {
  open: 'Соединение активно',
  connecting: 'Переподключение…',
  closed: 'Нет соединения',
};

/** Small dot + text, not a button-looking chunk. */
function WsIndicator() {
  const status = useWsStatus();
  const tone = status === 'open' ? 'bg-success' : status === 'connecting' ? 'bg-warning' : 'bg-danger';

  return (
    <Tooltip label={`${WS_LABEL[status]} · нажмите, чтобы переподключиться`}>
      <button
        type="button"
        onClick={() => wsClient.reconnectNow()}
        aria-label={WS_LABEL[status]}
        className="flex items-center gap-2 rounded-control px-1.5 py-1 text-[12px] text-muted transition-colors duration-120 hover:text-dim"
      >
        <span className={cn('h-[7px] w-[7px] rounded-pill', tone, status !== 'open' && 'animate-soft-pulse')} />
        <span className="hidden xl:inline">{status === 'open' ? 'на связи' : WS_LABEL[status]}</span>
      </button>
    </Tooltip>
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
        aria-label={active ? `Аккаунт: ${active.label} — сменить` : 'Выбрать аккаунт'}
        className="flex h-8 items-center gap-2 rounded-control pl-1 pr-1.5 transition-colors duration-120 hover:bg-veil"
      >
        {active ? (
          <Avatar name={active.label} seed={active.id} size={24} square />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-control border border-dashed border-border-strong text-muted">
            <Plus className="h-3 w-3" />
          </span>
        )}
        <span className="hidden max-w-[130px] truncate text-[12.5px] text-dim sm:block">
          {active ? active.label : 'Нет аккаунта'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      </button>

      {open ? (
        <div
          role="listbox"
          className="elevated absolute right-0 top-[calc(100%+8px)] z-50 w-[270px] animate-scale-in overflow-hidden"
        >
          <div className="scroll-thin max-h-[320px] overflow-y-auto p-1.5">
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
                className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-120 hover:bg-veil"
              >
                <Avatar name={account.label} seed={account.id} size={26} square />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-text">{account.label}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {account.username ? `@${account.username}` : (account.phone ?? '—')}
                  </span>
                </span>
                {account.connected ? <span className="h-1.5 w-1.5 rounded-pill bg-success" /> : null}
                {account.id === activeAccountId ? <Check className="h-4 w-4 text-accent" aria-hidden /> : null}
              </button>
            ))}
            {(accounts ?? []).length === 0 ? (
              <p className="px-3 py-4 text-center text-[12.5px] text-muted">Аккаунтов пока нет</p>
            ) : null}
          </div>
          <Link
            to="/accounts/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-[12.5px] text-dim transition-colors duration-120 hover:bg-veil hover:text-text"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
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
    <div className="relative hidden md:block md:w-[190px] lg:w-[240px]" ref={boxRef}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Поиск чатов"
        aria-label="Глобальный поиск по чатам"
        className="field h-8 border-transparent bg-surface-2 pl-8 pr-12 text-[12.5px]"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 font-mono text-[10px] text-muted lg:block">
        ⌘K
      </kbd>

      {open && debounced.trim().length >= 2 ? (
        <div className="elevated absolute left-0 right-0 top-[calc(100%+8px)] z-50 animate-scale-in overflow-hidden md:min-w-[320px]">
          {activeAccountId === null ? (
            <p className="px-4 py-4 text-[12.5px] text-muted">Сначала выберите аккаунт</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-muted">{isFetching ? 'Ищем…' : 'Ничего не найдено'}</p>
          ) : (
            <div className="scroll-thin max-h-[360px] overflow-y-auto p-1.5">
              {results.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setValue('');
                    navigate(`/chats/${chat.id}`);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-120 hover:bg-veil"
                >
                  <Avatar
                    name={chat.title}
                    seed={chat.id}
                    src={chat.photo_path ? chatPhotoUrl(chat.photo_path) : null}
                    size={26}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-text">{chat.title}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      {chat.username ? `@${chat.username}` : CHAT_KIND_LABEL[chat.kind]}
                    </span>
                  </span>
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
  const title = usePageStore((state) => state.title);
  const subtitle = usePageStore((state) => state.subtitle);
  const setActionsSlot = usePageStore((state) => state.setActionsSlot);

  const slotRef = useCallback(
    (node: HTMLDivElement | null) => {
      setActionsSlot(node);
    },
    [setActionsSlot],
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-topbar w-full max-w-content items-center gap-3 px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-text">{title}</h1>
          {subtitle ? <p className="truncate text-[12px] leading-tight text-muted">{subtitle}</p> : null}
        </div>

        <div ref={slotRef} className="flex shrink-0 items-center gap-2" />

        <div className="flex shrink-0 items-center gap-1.5">
          <GlobalSearch />
          <ThemeToggle />
          <WsIndicator />
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <AccountSwitcher />
        </div>
      </div>
    </header>
  );
}
