import { useEffect, useRef, useState } from 'react';
import type { ActiveFile } from '../../api/types';
import { cn } from '../../lib/cn';
import { activeFileName } from '../../lib/jobs';
import { formatBytes, formatSpeed, percent } from '../../lib/format';
import { LiveValue } from '../ui/LiveValue';
import { FileName } from './FileName';
import { KindIcon } from './KindIcon';

const EXIT_MS = 200;

function FileRow({ file, exiting }: { file: ActiveFile; exiting?: boolean }) {
  const name = activeFileName(file);
  const known = typeof file.total === 'number' && file.total > 0;
  const pct = known ? percent(file.received, file.total as number) : 0;

  return (
    <li className={cn('px-5 py-2', exiting ? 'row-exit' : 'animate-row-in')}>
      <div className="flex items-center gap-2.5">
        <KindIcon kind={file.kind} />
        <FileName name={name} className="min-w-0 flex-1 font-mono text-[12px] text-dim" />
        <LiveValue
          value={`${formatBytes(file.received)} / ${known ? formatBytes(file.total) : '—'}`}
          className="shrink-0 font-mono text-[11.5px] text-muted"
        />
        <LiveValue
          value={formatSpeed(file.speed_bps)}
          className="w-[86px] shrink-0 text-right font-mono text-[11.5px] text-dim"
        />
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-pill bg-surface-2">
        <div
          className="relative h-full overflow-hidden rounded-pill bg-accent"
          style={{ width: `${known ? pct : 100}%`, transition: 'width 400ms ease-out', opacity: known ? 1 : 0.35 }}
        >
          <span className="progress-sheen" aria-hidden />
        </div>
      </div>
    </li>
  );
}

/**
 * Files being downloaded right now (`ExportJob.active_files`). Rows fade and
 * collapse when a download finishes, so the list reads as a live surface.
 */
export function ActiveDownloads({ files }: { files: ActiveFile[] }) {
  const [exiting, setExiting] = useState<ActiveFile[]>([]);
  const previousRef = useRef<ActiveFile[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const currentIds = new Set(files.map((file) => file.media_id));
    const removed = previousRef.current.filter((file) => !currentIds.has(file.media_id));
    previousRef.current = files;
    if (removed.length === 0) return;

    setExiting((previous) => [...previous, ...removed]);
    // Timers are tracked in a ref, not cleaned up per-run: the effect re-runs on
    // every poll (a fresh `files` array), and a per-run cleanup would cancel the
    // pending removal and leave ghost rows on screen forever.
    const timer = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((id) => id !== timer);
      setExiting((previous) => previous.filter((file) => !removed.some((item) => item.media_id === file.media_id)));
    }, EXIT_MS);
    timersRef.current.push(timer);
  }, [files]);

  useEffect(
    () => () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    },
    [],
  );

  const currentIds = new Set(files.map((file) => file.media_id));
  const ghosts = exiting.filter((file) => !currentIds.has(file.media_id));

  if (files.length === 0 && ghosts.length === 0) {
    return <p className="px-5 py-3 text-[12.5px] text-muted">Нет активных загрузок</p>;
  }

  return (
    <ul className="py-1">
      {files.map((file) => (
        <FileRow key={file.media_id} file={file} />
      ))}
      {ghosts.map((file) => (
        <FileRow key={`exit-${file.media_id}`} file={file} exiting />
      ))}
    </ul>
  );
}
