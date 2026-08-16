import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Database, FolderOpen, Monitor, Moon, RefreshCw, Server, Sun, Zap } from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import { useHealth, useJobs } from '../hooks/queries';
import { useWsStatus } from '../hooks/useWebSocket';
import { useThemeStore, type ThemeMode } from '../store/theme';
import { formatDuration } from '../lib/format';
import { toast } from '../store/ui';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Section } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';

function ServiceRow({
  icon,
  name,
  ok,
  detail,
  loading,
}: {
  icon: ReactNode;
  name: string;
  ok: boolean | null;
  detail: string;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-text">{name}</p>
        <p className="truncate text-[12px] text-muted">{detail}</p>
      </div>
      {loading ? (
        <Skeleton className="h-2 w-2 rounded-pill" />
      ) : (
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-pill',
            ok === null ? 'bg-muted' : ok ? 'bg-success' : 'bg-danger',
          )}
          aria-label={ok ? 'работает' : 'недоступен'}
        />
      )}
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'dark', label: 'Тёмная', icon: Moon },
  { value: 'light', label: 'Светлая', icon: Sun },
  { value: 'system', label: 'Как в системе', icon: Monitor },
];

export function SettingsPage() {
  const { data: health, isLoading, isError, refetch, isFetching } = useHealth();
  const { data: jobs } = useJobs({ page: 1, page_size: 1 }, false);
  const wsStatus = useWsStatus();
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);

  const lastOutputDir = jobs?.items.find((job) => job.output_dir)?.output_dir ?? null;

  const openFolderMutation = useMutation({
    mutationFn: (path: string) => api.openFolder(path),
    onSuccess: () => toast.success('Папка открыта'),
    onError: (error) => toast.error('Не удалось открыть папку', api.errorMessage(error)),
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Настройки" subtitle="Внешний вид, состояние сервисов и информация о приложении">
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />}
          onClick={() => void refetch()}
        >
          Проверить
        </Button>
      </PageHeader>

      <Section title="Оформление" description="Тема сохраняется в этом браузере" divided={false}>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setThemeMode(option.value)}
              aria-pressed={themeMode === option.value}
              className={cn(
                'flex min-w-[150px] items-center gap-2.5 rounded-card border px-4 py-3 text-left transition-colors duration-120',
                themeMode === option.value
                  ? 'border-accent/45 bg-accent-soft text-accent'
                  : 'border-border text-dim hover:border-border-strong hover:text-text',
              )}
            >
              <option.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-[13px] font-medium">{option.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <div className="grid gap-8 border-t border-border pt-6 lg:grid-cols-2">
        <section>
          <h2 className="text-[13px] font-medium text-dim">Состояние системы</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {isError ? 'Backend недоступен' : `Статус: ${health?.status ?? '—'}`}
          </p>
          <div className="mt-3 divide-y divide-border">
            <ServiceRow
              icon={<Server className="h-4 w-4" />}
              name="Backend API"
              ok={isError ? false : !!health}
              detail="127.0.0.1:8077 · /api"
              loading={isLoading}
            />
            <ServiceRow
              icon={<Database className="h-4 w-4" />}
              name="MySQL"
              ok={health ? health.db : isError ? false : null}
              detail="Хранилище аккаунтов, чатов и сообщений"
              loading={isLoading}
            />
            <ServiceRow
              icon={<Zap className="h-4 w-4" />}
              name="Redis"
              ok={health ? health.redis : isError ? false : null}
              detail="Шина событий · при недоступности — in-memory fallback"
              loading={isLoading}
            />
            <ServiceRow
              icon={<Zap className="h-4 w-4" />}
              name="WebSocket"
              ok={wsStatus === 'open' ? true : wsStatus === 'connecting' ? null : false}
              detail="/ws · живые обновления прогресса и логов"
            />
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <h2 className="text-[13px] font-medium text-dim">Приложение</h2>
            <dl className="mt-3 divide-y divide-border">
              {[
                { label: 'Версия backend', value: health?.version ?? '—' },
                { label: 'Аптайм', value: health ? formatDuration(health.uptime_seconds) : '—' },
                { label: 'Frontend', value: 'React 18 · Vite · TypeScript' },
                { label: 'Порт dev-сервера', value: '5177' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-[13px] text-dim">{row.label}</dt>
                  <dd className="tnum font-mono text-[12.5px] text-text">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="text-[13px] font-medium text-dim">Каталог данных</h2>
            <div className="mt-3 space-y-3">
              <div className="rounded-card border border-border px-4 py-3">
                <p className="micro-label">Базовый каталог</p>
                <p className="mt-1 break-all font-mono text-[12.5px] text-text">
                  {'<TGV_DATA_DIR>'} · по умолчанию ./data
                </p>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">
                  Внутри: <span className="font-mono">logs/</span>, <span className="font-mono">exports/</span>,{' '}
                  <span className="font-mono">secret.key</span>
                </p>
              </div>
              {lastOutputDir ? (
                <div className="rounded-card border border-border px-4 py-3">
                  <p className="micro-label">Последний каталог экспорта</p>
                  <p className="mt-1 break-all font-mono text-[12.5px] text-text">{lastOutputDir}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2.5"
                    icon={<FolderOpen className="h-3.5 w-3.5" />}
                    loading={openFolderMutation.isPending}
                    onClick={() => openFolderMutation.mutate(lastOutputDir)}
                  >
                    Открыть в проводнике
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
