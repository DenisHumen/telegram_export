import { useMutation } from '@tanstack/react-query';
import { Database, FolderOpen, HardDrive, Info, RefreshCw, Server, Zap } from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import { useHealth, useJobs } from '../hooks/queries';
import { useWsStatus } from '../hooks/useWebSocket';
import { formatDuration } from '../lib/format';
import { toast } from '../store/ui';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, SectionTitle } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';

function ServiceRow({
  icon,
  name,
  ok,
  detail,
  loading,
}: {
  icon: React.ReactNode;
  name: string;
  ok: boolean | null;
  detail: string;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-ink">{name}</p>
        <p className="truncate text-[12px] text-ink-faint">{detail}</p>
      </div>
      {loading ? (
        <Skeleton className="h-2.5 w-2.5 rounded-full" />
      ) : (
        <span
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            ok === null ? 'bg-ink-faint' : ok ? 'bg-success' : 'bg-danger',
          )}
          aria-label={ok ? 'работает' : 'недоступен'}
        />
      )}
    </div>
  );
}

export function SettingsPage() {
  const { data: health, isLoading, isError, refetch, isFetching } = useHealth();
  const { data: jobs } = useJobs({ page: 1, page_size: 1 }, false);
  const wsStatus = useWsStatus();

  const lastOutputDir = jobs?.items.find((job) => job.output_dir)?.output_dir ?? null;

  const openFolderMutation = useMutation({
    mutationFn: (path: string) => api.openFolder(path),
    onSuccess: () => toast.success('Папка открыта'),
    onError: (error) => toast.error('Не удалось открыть папку', api.errorMessage(error)),
  });

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Настройки"
        subtitle="Состояние сервисов и информация о приложении"
        action={
          <Button
            variant="secondary"
            icon={<RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
            onClick={() => void refetch()}
          >
            Проверить
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Состояние системы"
            subtitle={isError ? 'Backend недоступен' : `Статус: ${health?.status ?? '—'}`}
            icon={<Server className="h-4 w-4" />}
          />
          <div className="divide-y divide-line">
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
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Приложение" subtitle="TgVault — локальный архиватор Telegram" icon={<Info className="h-4 w-4" />} />
            <dl className="divide-y divide-line">
              {[
                { label: 'Версия backend', value: health?.version ?? '—' },
                { label: 'Аптайм', value: health ? formatDuration(health.uptime_seconds) : '—' },
                { label: 'Frontend', value: 'React 18 · Vite · TypeScript' },
                { label: 'Порт dev-сервера', value: '5177' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 px-5 py-3">
                  <dt className="text-[13px] text-ink-muted">{row.label}</dt>
                  <dd className="font-mono text-[13px] text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Каталог данных" subtitle="Логи, экспорты и ключ шифрования" icon={<HardDrive className="h-4 w-4" />} />
            <div className="space-y-3 p-5">
              <div className="panel-inset px-3.5 py-3">
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">Базовый каталог</p>
                <p className="mt-1 break-all font-mono text-[12.5px] text-ink">
                  {'<TGV_DATA_DIR>'} · по умолчанию <span className="text-accent-soft">./data</span>
                </p>
                <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">
                  Внутри: <span className="font-mono">logs/</span>, <span className="font-mono">exports/</span>,{' '}
                  <span className="font-mono">secret.key</span>
                </p>
              </div>
              {lastOutputDir ? (
                <div className="panel-inset px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-faint">Последний каталог экспорта</p>
                  <p className="mt-1 break-all font-mono text-[12.5px] text-ink">{lastOutputDir}</p>
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
          </Card>
        </div>
      </div>
    </div>
  );
}
