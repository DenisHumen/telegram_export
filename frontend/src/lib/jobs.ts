import type { ActiveFile, ExportJob } from '../api/types';

/**
 * `avg_speed_bps` and `active_files` were added to ExportJob after the first
 * release. A backend that predates them simply omits the keys, so every read
 * goes through these guards — the job card must never crash on old data.
 */

export function activeFilesOf(job: ExportJob): ActiveFile[] {
  const raw: unknown = job.active_files;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ActiveFile => {
    if (!item || typeof item !== 'object') return false;
    const file = item as Partial<ActiveFile>;
    return typeof file.media_id === 'number' && typeof file.kind === 'string';
  });
}

export function avgSpeedOf(job: ExportJob): number {
  const raw: unknown = job.avg_speed_bps;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function isJobActive(job: ExportJob): boolean {
  return job.status === 'running' || job.status === 'queued';
}

export function isJobLive(job: ExportJob): boolean {
  return job.status === 'running' || job.status === 'queued' || job.status === 'paused';
}

/** Split 'IMG_0421.jpeg' -> ['IMG_0421', '.jpeg'] so the extension stays visible. */
export function splitExtension(name: string): [string, string] {
  const match = /^(.*)(\.[^.\\/]{1,8})$/.exec(name);
  return match ? [match[1], match[2]] : [name, ''];
}

/** Best-effort display name for an active file. */
export function activeFileName(file: ActiveFile): string {
  const name = (file.file_name ?? '').trim();
  return name || `${file.kind} #${file.media_id}`;
}
