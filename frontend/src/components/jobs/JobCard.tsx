import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  FileJson,
  FolderOpen,
  Hammer,
  Pause,
  Play,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import * as api from '../../api/client';
import type { ExportJob } from '../../api/types';
import { JOB_PHASE_LABEL, JOB_STATUS_LABEL, JOB_STATUS_TONE, LOG_LEVEL_CLASS } from '../../lib/labels';
import { formatBytes, formatDate, formatDuration, formatNumber, formatSpeed, formatTime } from '../../lib/format';
import { confirmDialog, toast } from '../../store/ui';
import { useJobEvents } from '../../hooks/queries';
import { IconButton } from '../ui/Button';
import { StatusPill } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { ProgressBar } from '../ui/ProgressBar';
import { Skeleton } from '../ui/Skeleton';

function ManifestModal({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['job-manifest', jobId],
    queryFn: () => api.getJobManifest(jobId),
    retry: false,
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Манифест задачи #${jobId}`}
      subtitle="manifest.json из каталога экспорта"
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-3.5" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-[13px] text-danger">{api.errorMessage(error)}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Сообщений', value: formatNumber(data?.stats.messages ?? 0) },
              { label: 'Медиафайлов', value: formatNumber(data?.stats.media_files ?? 0) },
              { label: 'Объём', value: formatBytes(data?.stats.bytes ?? 0) },
            ].map((tile) => (
              <div key={tile.label} className="panel-inset px-3.5 py-3">
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">{tile.label}</p>
                <p className="mt-1 font-mono text-[15px] text-ink">{tile.value}</p>
              </div>
            ))}
          </div>
          <pre className="max-h-[46vh] overflow-auto scroll-thin rounded-xl border border-line bg-base/70 p-4 font-mono text-[11.5px] leading-relaxed text-ink-muted">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </Modal>
  );
}

export function JobCard({ job, compact }: { job: ExportJob; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: events, isLoading: eventsLoading } = useJobEvents(job.id, expanded);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    void queryClient.invalidateQueries({ queryKey: ['job', job.id] });
  };

  const action = useMutation({
    mutationFn: async (kind: 'pause' | 'resume' | 'cancel' | 'delete' | 'rebuild') => {
      switch (kind) {
        case 'pause':
          return api.pauseJob(job.id);
        case 'resume':
          return api.resumeJob(job.id);
        case 'cancel':
          return api.cancelJob(job.id);
        case 'rebuild':
          return api.rebuildJob(job.id, {});
        case 'delete':
          return api.deleteJob(job.id);
      }
    },
    onSuccess: (_data, kind) => {
      invalidate();
      const labels: Record<string, string> = {
        pause: 'Задача поставлена на паузу',
        resume: 'Задача возобновлена',
        cancel: 'Задача отменена',
        rebuild: 'Пересборка отчётов запущена',
        delete: 'Задача удалена',
      };
      toast.success(labels[kind] ?? 'Готово');
    },
    onError: (error) => toast.error('Не удалось выполнить действие', api.errorMessage(error)),
  });

  const openFolderMutation = useMutation({
    mutationFn: (path: string) => api.openFolder(path),
    onSuccess: () => toast.success('Папка открыта'),
    onError: (error) => toast.error('Не удалось открыть папку', api.errorMessage(error)),
  });

  const isActive = job.status === 'running' || job.status === 'queued';
  const messagesPct = job.total_messages > 0 ? (job.processed_messages / job.total_messages) * 100 : 0;

  return (
    <div className={cn('card overflow-hidden', isActive && 'border-accent/25')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to={`/chats/${job.chat_id}`}
              className="truncate text-[15px] font-semibold tracking-tight text-ink transition-colors duration-150 hover:text-accent-soft"
            >
              {job.chat_title || `Чат #${job.chat_id}`}
            </Link>
            <StatusPill tone={JOB_STATUS_TONE[job.status]} pulse={job.status === 'running'}>
              {JOB_STATUS_LABEL[job.status]}
            </StatusPill>
            <span className="font-mono text-[11.5px] text-ink-faint">#{job.id}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-faint">
            <span>Этап: {JOB_PHASE_LABEL[job.phase]}</span>
            <span>Создана {formatDate(job.created_at)}</span>
            {job.finished_at ? <span>Завершена {formatDate(job.finished_at)}</span> : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {job.status === 'running' ? (
            <IconButton label="Пауза" size="sm" onClick={() => action.mutate('pause')}>
              <Pause className="h-4 w-4" />
            </IconButton>
          ) : null}
          {job.status === 'paused' ? (
            <IconButton label="Продолжить" size="sm" variant="success" onClick={() => action.mutate('resume')}>
              <Play className="h-4 w-4" />
            </IconButton>
          ) : null}
          {isActive || job.status === 'paused' ? (
            <IconButton
              label="Отменить"
              size="sm"
              variant="danger"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: 'Отменить экспорт?',
                  description: `Задача #${job.id} будет остановлена. Уже скачанные файлы останутся на диске.`,
                  confirmLabel: 'Отменить экспорт',
                  danger: true,
                });
                if (ok) action.mutate('cancel');
              }}
            >
              <Square className="h-4 w-4" />
            </IconButton>
          ) : null}
          <IconButton
            label="Пересобрать отчёты"
            size="sm"
            onClick={() => action.mutate('rebuild')}
            disabled={isActive}
          >
            <Hammer className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Открыть папку"
            size="sm"
            disabled={!job.output_dir}
            onClick={() => job.output_dir && openFolderMutation.mutate(job.output_dir)}
          >
            <FolderOpen className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Манифест экспорта"
            size="sm"
            disabled={job.status !== 'completed'}
            onClick={() => setManifestOpen(true)}
          >
            <FileJson className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Удалить задачу"
            size="sm"
            variant="danger"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Удалить задачу?',
                description: `Задача #${job.id} и её журнал событий будут удалены из базы. Файлы на диске останутся.`,
                confirmLabel: 'Удалить',
                danger: true,
              });
              if (ok) action.mutate('delete');
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
        <ProgressBar
          value={job.processed_messages}
          total={job.total_messages}
          running={job.status === 'running'}
          label="Сообщения"
          right={`${formatNumber(job.processed_messages)} / ${formatNumber(job.total_messages)} · ${messagesPct.toFixed(0)}%`}
        />
        <ProgressBar
          value={job.downloaded_files}
          total={job.total_files}
          running={job.status === 'running' && job.phase === 'downloading'}
          tone={job.failed_files > 0 ? 'warning' : 'accent'}
          label="Файлы"
          right={`${formatNumber(job.downloaded_files)} / ${formatNumber(job.total_files)}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line/40 sm:grid-cols-4">
        {[
          { label: 'Скачано', value: formatBytes(job.bytes_downloaded) },
          { label: 'Скорость', value: job.status === 'running' ? formatSpeed(job.speed_bps) : '—' },
          { label: 'Осталось', value: job.eta_seconds !== null ? formatDuration(job.eta_seconds) : '—' },
          {
            label: 'Ошибки / пропуски',
            value: `${formatNumber(job.failed_files)} / ${formatNumber(job.skipped_files)}`,
          },
        ].map((tile) => (
          <div key={tile.label} className="bg-surface px-5 py-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-faint">{tile.label}</p>
            <p className="mt-1 font-mono text-[14px] text-ink">{tile.value}</p>
          </div>
        ))}
      </div>

      {job.error ? (
        <p className="border-t border-danger/20 bg-danger/[0.06] px-5 py-3 font-mono text-[12px] text-danger">
          {job.error}
        </p>
      ) : null}

      {job.output_dir ? (
        <p className="truncate border-t border-line px-5 py-2.5 font-mono text-[11.5px] text-ink-faint" title={job.output_dir}>
          {job.output_dir}
        </p>
      ) : null}

      {!compact ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-2 border-t border-line px-5 py-3 text-[12.5px] text-ink-muted transition-colors duration-150 hover:bg-white/[0.03] hover:text-ink"
          >
            <Terminal className="h-4 w-4" aria-hidden />
            Журнал событий
            <ChevronDown
              className={cn('ml-auto h-4 w-4 transition-transform duration-150', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>
          {expanded ? (
            <div className="max-h-[280px] overflow-y-auto scroll-thin border-t border-line bg-base/60 px-5 py-3">
              {eventsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-3.5" />
                  ))}
                </div>
              ) : (events?.length ?? 0) === 0 ? (
                <p className="py-2 text-[12.5px] text-ink-faint">Событий пока нет</p>
              ) : (
                <ol className="space-y-1 font-mono text-[12px] leading-relaxed">
                  {events?.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <span className="shrink-0 text-ink-faint/70">{formatTime(event.ts)}</span>
                      <span className={cn('w-16 shrink-0 uppercase', LOG_LEVEL_CLASS[event.level])}>{event.level}</span>
                      <span className="min-w-0 break-words text-ink-muted">{event.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {manifestOpen ? <ManifestModal jobId={job.id} onClose={() => setManifestOpen(false)} /> : null}
    </div>
  );
}
