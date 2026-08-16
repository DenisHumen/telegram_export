import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  Copy,
  FileJson,
  FolderOpen,
  Hammer,
  ListTree,
  Pause,
  Play,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import * as api from '../../api/client';
import type { ExportJob } from '../../api/types';
import { JOB_PHASE_LABEL, JOB_STATUS_LABEL, JOB_STATUS_TONE } from '../../lib/labels';
import { formatBytes, formatDate, formatDuration, formatNumber, formatSpeed, percent } from '../../lib/format';
import { activeFilesOf, avgSpeedOf, isJobActive } from '../../lib/jobs';
import { confirmDialog, toast } from '../../store/ui';
import { IconButton } from '../ui/Button';
import { StatusPill } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { LiveValue } from '../ui/LiveValue';
import { Modal } from '../ui/Modal';
import { ProgressBar } from '../ui/ProgressBar';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { ActiveDownloads } from './ActiveDownloads';
import { JobEvents } from './JobEvents';
import { JobFiles } from './JobFiles';

/* ------------------------------------------------------------- manifest */

function ManifestModal({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['job-manifest', jobId],
    queryFn: () => api.getJobManifest(jobId),
    retry: false,
  });

  return (
    <Modal open onClose={onClose} size="lg" title={`Манифест задачи #${jobId}`} subtitle="manifest.json из каталога экспорта">
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-3" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-[13px] text-danger">{api.errorMessage(error)}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3">
            {[
              { label: 'Сообщений', value: formatNumber(data?.stats.messages ?? 0) },
              { label: 'Медиафайлов', value: formatNumber(data?.stats.media_files ?? 0) },
              { label: 'Объём', value: formatBytes(data?.stats.bytes ?? 0) },
            ].map((tile) => (
              <div key={tile.label} className="bg-surface px-4 py-3">
                <p className="micro-label">{tile.label}</p>
                <p className="tnum mt-1 font-mono text-[14px] text-text">{tile.value}</p>
              </div>
            ))}
          </div>
          <pre className="scroll-thin max-h-[46vh] overflow-auto rounded-card border border-border bg-surface-2/50 p-4 font-mono text-[11.5px] leading-relaxed text-dim">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- parts */

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="bg-surface px-5 py-3">
      <p className="micro-label">{label}</p>
      <p className="tnum mt-1 font-mono text-[13px] text-text">{value}</p>
      {hint ? <p className="tnum mt-0.5 font-mono text-[11.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

function Disclosure({
  icon,
  label,
  open,
  onToggle,
  right,
}: {
  icon: ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
  right?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-2 px-5 py-2.5 text-[12.5px] text-dim transition-colors duration-120 hover:bg-veil hover:text-text"
    >
      {icon}
      {label}
      {right ? <span className="tnum ml-2 font-mono text-[11.5px] text-muted">{right}</span> : null}
      <ChevronDown
        className={cn('ml-auto h-4 w-4 transition-transform duration-150', open && 'rotate-180')}
        aria-hidden
      />
    </button>
  );
}

/* ----------------------------------------------------------------- card */

export function JobCard({ job, compact }: { job: ExportJob; compact?: boolean }) {
  const [eventsOpen, setEventsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(false);
  const queryClient = useQueryClient();

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

  const active = isJobActive(job);
  const running = job.status === 'running';
  const activeFiles = activeFilesOf(job);
  const avgSpeed = avgSpeedOf(job);

  const messagesPct = percent(job.processed_messages, job.total_messages);
  const filesPct = percent(job.downloaded_files, job.total_files);

  const copyPath = async () => {
    if (!job.output_dir) return;
    try {
      await navigator.clipboard.writeText(job.output_dir);
      toast.success('Скопировано', 'Путь к каталогу экспорта в буфере обмена');
    } catch {
      toast.error('Не удалось скопировать путь');
    }
  };

  return (
    <article className={cn('card overflow-hidden', running && 'border-accent/30')}>
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 gap-3">
          <Avatar name={job.chat_title} seed={job.chat_id} size={34} square />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/chats/${job.chat_id}`}
                className="truncate text-[14px] font-medium text-text transition-colors duration-120 hover:text-accent"
              >
                {job.chat_title || `Чат #${job.chat_id}`}
              </Link>
              <StatusPill tone={JOB_STATUS_TONE[job.status]} pulse={running}>
                {JOB_STATUS_LABEL[job.status]}
              </StatusPill>
              <span className="tnum font-mono text-[11.5px] text-muted">#{job.id}</span>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
              <span>{JOB_PHASE_LABEL[job.phase]}</span>
              <span>создана {formatDate(job.created_at)}</span>
              {job.finished_at ? <span>завершена {formatDate(job.finished_at)}</span> : null}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-0.5">
          {running ? (
            <IconButton label="Пауза" size="sm" onClick={() => action.mutate('pause')}>
              <Pause className="h-4 w-4" />
            </IconButton>
          ) : null}
          {job.status === 'paused' ? (
            <IconButton label="Продолжить" size="sm" onClick={() => action.mutate('resume')}>
              <Play className="h-4 w-4" />
            </IconButton>
          ) : null}
          {active || job.status === 'paused' ? (
            <IconButton
              label="Отменить экспорт"
              size="sm"
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
            label="Пересобрать отчёты из базы"
            size="sm"
            onClick={() => action.mutate('rebuild')}
            disabled={active}
          >
            <Hammer className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Открыть папку экспорта"
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

      {/* -------------------------------------------------------- progress */}
      <div className="grid gap-4 border-t border-border px-5 py-4 lg:grid-cols-2">
        <ProgressBar
          value={job.processed_messages}
          total={job.total_messages}
          running={running}
          label="Сообщения"
          right={`${formatNumber(job.processed_messages)} / ${formatNumber(job.total_messages)} · ${messagesPct.toFixed(0)}%`}
        />
        <ProgressBar
          value={job.downloaded_files}
          total={job.total_files}
          running={running && job.phase === 'downloading'}
          tone={job.failed_files > 0 ? 'warning' : 'accent'}
          label="Файлы"
          right={`${formatNumber(job.downloaded_files)} / ${formatNumber(job.total_files)} · ${filesPct.toFixed(0)}%`}
        />
      </div>

      {/* ------------------------------------------------------------ stats */}
      <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Скачано"
          value={<LiveValue value={formatBytes(job.bytes_downloaded)} />}
          hint={job.bytes_total > 0 ? `из ${formatBytes(job.bytes_total)}` : undefined}
        />
        <Stat label="Скорость" value={<LiveValue value={running ? formatSpeed(job.speed_bps) : '—'} />} />
        <Stat label="Средняя" value={<LiveValue value={avgSpeed > 0 ? formatSpeed(avgSpeed) : '—'} />} />
        <Stat
          label="Осталось"
          value={<LiveValue value={job.eta_seconds !== null ? formatDuration(job.eta_seconds) : '—'} />}
        />
        <Stat
          label="Файлы"
          value={
            <span className="flex items-baseline gap-1">
              <span className="text-success">{formatNumber(job.downloaded_files)}</span>
              <span className="text-muted">/</span>
              <span className={job.failed_files > 0 ? 'text-danger' : 'text-muted'}>
                {formatNumber(job.failed_files)}
              </span>
              <span className="text-muted">/</span>
              <span className="text-muted">{formatNumber(job.skipped_files)}</span>
            </span>
          }
          hint="готово / ошибки / пропущено"
        />
      </div>

      {job.error ? (
        <p className="border-t border-border px-5 py-2.5 font-mono text-[12px] text-danger">{job.error}</p>
      ) : null}

      {/* --------------------------------------------------- live downloads */}
      {active || job.status === 'paused' || activeFiles.length > 0 ? (
        <div className="border-t border-border">
          <p className="micro-label px-5 pb-1 pt-3">Сейчас скачивается</p>
          <ActiveDownloads files={activeFiles} />
        </div>
      ) : null}

      {/* ------------------------------------------------------- disclosures */}
      {!compact ? (
        <>
          <div className="border-t border-border">
            <Disclosure
              icon={<ListTree className="h-4 w-4" aria-hidden />}
              label="Файлы задачи"
              open={filesOpen}
              onToggle={() => setFilesOpen((value) => !value)}
              right={job.total_files > 0 ? formatNumber(job.total_files) : undefined}
            />
            {filesOpen ? (
              <div className="border-t border-border">
                <JobFiles jobId={job.id} open={filesOpen} />
              </div>
            ) : null}
          </div>

          <div className="border-t border-border">
            <Disclosure
              icon={<Terminal className="h-4 w-4" aria-hidden />}
              label="Журнал событий"
              open={eventsOpen}
              onToggle={() => setEventsOpen((value) => !value)}
            />
            {eventsOpen ? (
              <div className="border-t border-border bg-surface-2/40">
                <JobEvents jobId={job.id} open={eventsOpen} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------ output path */}
      {job.output_dir ? (
        <div className="flex items-center gap-2 border-t border-border px-5 py-2">
          <Tooltip label="Скопировать путь" className="min-w-0 flex-1">
            <button
              type="button"
              onClick={copyPath}
              aria-label="Скопировать путь к каталогу экспорта"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-control py-1 text-left transition-colors duration-120 hover:text-text"
            >
              <Copy className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="truncate font-mono text-[11.5px] text-muted" title={job.output_dir}>
                {job.output_dir}
              </span>
            </button>
          </Tooltip>
          <IconButton
            label="Открыть папку экспорта"
            size="sm"
            onClick={() => job.output_dir && openFolderMutation.mutate(job.output_dir)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ) : null}

      {manifestOpen ? <ManifestModal jobId={job.id} onClose={() => setManifestOpen(false)} /> : null}
    </article>
  );
}
