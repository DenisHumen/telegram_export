import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Crown, LogOut, MessagesSquare, Plug, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import * as api from '../api/client';
import type { Account } from '../api/types';
import { useAccounts } from '../hooks/queries';
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from '../lib/labels';
import { formatNumber, formatRelative } from '../lib/format';
import { cn } from '../lib/cn';
import { confirmDialog, toast, useUiStore } from '../store/ui';
import { PageHeader } from '../components/layout/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Badge, StatusPill } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState, ErrorState, NoAccountsArt } from '../components/ui/EmptyState';
import { SkeletonCards } from '../components/ui/Skeleton';

function AccountCard({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setActiveAccountId = useUiStore((state) => state.setActiveAccountId);
  const [busy, setBusy] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['account', account.id] });
  };

  const run = async (kind: string, fn: () => Promise<unknown>, successText: string) => {
    setBusy(kind);
    try {
      await fn();
      invalidate();
      toast.success(successText);
    } catch (error) {
      toast.error('Ошибка', api.errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const fullName = [account.first_name, account.last_name].filter(Boolean).join(' ');

  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-5">
        <Avatar name={account.label} seed={account.id} size={40} square />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-medium text-text">{account.label}</h3>
            {account.is_premium ? (
              <Badge tone="warning" icon={<Crown className="h-3 w-3" />}>
                Premium
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-dim">
            {fullName || 'Имя не получено'}
            {account.username ? ` · @${account.username}` : ''}
          </p>
          <p className="tnum mt-0.5 truncate font-mono text-[12px] text-muted">
            {account.phone ?? 'номер не указан'}
          </p>
        </div>
        <span
          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-pill', account.connected ? 'bg-success' : 'bg-muted')}
          title={account.connected ? 'Клиент подключён' : 'Клиент не подключён'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3">
        <StatusPill tone={ACCOUNT_STATUS_TONE[account.status]} pulse={account.status === 'pending_code'}>
          {ACCOUNT_STATUS_LABEL[account.status]}
        </StatusPill>
        <Badge>api_id {account.api_id}</Badge>
        {account.proxy ? <Badge tone="accent">proxy</Badge> : null}
      </div>

      {account.last_error ? (
        <p className="mx-5 mt-3 flex items-start gap-2 rounded-control border border-danger/25 px-3 py-2 text-[12px] text-danger">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{account.last_error}</span>
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-px border-y border-border bg-border">
        <div className="bg-surface px-5 py-3">
          <p className="micro-label">Чатов</p>
          <p className="tnum mt-1 font-mono text-[14px] text-text">{formatNumber(account.chats_count)}</p>
        </div>
        <div className="bg-surface px-5 py-3">
          <p className="micro-label">Активность</p>
          <p className="mt-1 text-[13px] text-text">{formatRelative(account.last_seen_at)}</p>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 px-4 py-3">
        <Button
          size="sm"
          variant="primary"
          icon={<MessagesSquare className="h-3.5 w-3.5" />}
          onClick={() => {
            setActiveAccountId(account.id);
            navigate(`/accounts/${account.id}/chats`);
          }}
        >
          Чаты
        </Button>
        <Button
          size="sm"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          loading={busy === 'sync'}
          onClick={() => run('sync', () => api.syncChats(account.id, {}), 'Синхронизация чатов запущена')}
        >
          Синхронизировать
        </Button>
        {account.status === 'authorized' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plug className="h-3.5 w-3.5" />}
            loading={busy === 'connect'}
            onClick={() => run('connect', () => api.connectAccount(account.id), 'Клиент подключён')}
          >
            Подключить
          </Button>
        ) : (
          <Link to="/accounts/new">
            <Button size="sm" variant="ghost" icon={<Plug className="h-3.5 w-3.5" />}>
              Войти
            </Button>
          </Link>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="Выйти из аккаунта"
            size="sm"
            loading={busy === 'logout'}
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Выйти из аккаунта?',
                description: `Сессия «${account.label}» будет удалена, потребуется повторный вход. Данные чатов останутся в базе.`,
                confirmLabel: 'Выйти',
                danger: true,
              });
              if (ok) await run('logout', () => api.logoutAccount(account.id), 'Выход выполнен');
            }}
          >
            <LogOut className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Удалить аккаунт"
            size="sm"
            variant="danger"
            loading={busy === 'delete'}
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Удалить аккаунт?',
                description: `«${account.label}» будет удалён вместе со всеми чатами, сообщениями и медиа в базе. Действие необратимо.`,
                confirmLabel: 'Удалить навсегда',
                danger: true,
              });
              if (ok) await run('delete', () => api.deleteAccount(account.id), 'Аккаунт удалён');
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </article>
  );
}

function AddAccountCard() {
  return (
    <Link
      to="/accounts/new"
      className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border-strong p-6 text-center transition-colors duration-120 hover:border-accent/50"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-control border border-border text-dim transition-colors duration-120 group-hover:text-accent">
        <Plus className="h-5 w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-[14px] font-medium text-text">Добавить аккаунт</span>
        <span className="mt-1 block max-w-[240px] text-[12.5px] leading-snug text-muted">
          Вход по QR-коду или номеру телефона, поддержка облачного пароля 2FA
        </span>
      </span>
    </Link>
  );
}

export function AccountsPage() {
  const { data: accounts, isLoading, isError, error, refetch } = useAccounts();

  return (
    <div className="space-y-6">
      <PageHeader title="Аккаунты" subtitle="Telegram-аккаунты, от имени которых выполняется выгрузка">
        <Link to="/accounts/new">
          <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
            Добавить аккаунт
          </Button>
        </Link>
      </PageHeader>

      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState description={api.errorMessage(error)} onRetry={() => void refetch()} />
      ) : (accounts?.length ?? 0) === 0 ? (
        <EmptyState
          art={<NoAccountsArt />}
          title="Аккаунтов пока нет"
          description="Чтобы начать, добавьте аккаунт: понадобятся api_id и api_hash с my.telegram.org. Один api_id можно использовать для нескольких аккаунтов."
          action={
            <Link to="/accounts/new">
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>
                Добавить аккаунт
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {accounts?.map((account, index) => (
            <div
              key={account.id}
              className="animate-fade-in"
              style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
            >
              <AccountCard account={account} />
            </div>
          ))}
          <AddAccountCard />
        </div>
      )}
    </div>
  );
}
