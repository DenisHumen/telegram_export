import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import * as api from '../../api/client';
import { ApiError } from '../../api/client';
import type { ListJobFilesParams, MediaFileStatus } from '../../api/types';
import { useJobFiles } from '../../hooks/queries';
import { cn } from '../../lib/cn';
import { formatBytes, formatDate, formatNumber } from '../../lib/format';
import { ALL_FILE_KINDS, FILE_KIND_LABEL, FILE_STATUS_LABEL, FILE_STATUS_TONE } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { Chip, SelectField } from '../ui/Field';
import { EmptyState, NoFilesArt } from '../ui/EmptyState';
import { Pagination } from '../ui/Pagination';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { FileName } from './FileName';
import { KindIcon } from './KindIcon';

const STATUS_FILTERS: { value: 'all' | MediaFileStatus; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'done', label: 'Скачано' },
  { value: 'failed', label: 'Ошибки' },
  { value: 'skipped', label: 'Пропущено' },
  { value: 'pending', label: 'В очереди' },
];

const PAGE_SIZE = 50;

/** The backend may send `ext` with or without the leading dot. */
function extOf(ext: string | null): string {
  if (!ext) return '';
  return ext.startsWith('.') ? ext : `.${ext}`;
}

/** Per-job media browser backed by GET /api/export/jobs/{id}/files. */
export function JobFiles({ jobId, open }: { jobId: number; open: boolean }) {
  const [status, setStatus] = useState<'all' | MediaFileStatus>('all');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [status, kind]);

  const params: ListJobFilesParams = useMemo(
    () => ({ status, kind, page, page_size: PAGE_SIZE }),
    [status, kind, page],
  );

  const { data, isLoading, isError, error } = useJobFiles(jobId, params, open);

  if (!open) return null;

  const rows = data?.items ?? [];
  const unsupported = error instanceof ApiError && (error.status === 404 || error.status === 405);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Chip key={filter.value} active={status === filter.value} onClick={() => setStatus(filter.value)}>
            {filter.label}
          </Chip>
        ))}
        <SelectField
          aria-label="Тип файла"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          wrapClassName="ml-auto w-[170px]"
          className="h-8 py-0 text-[12.5px]"
        >
          <option value="all">Все типы</option>
          {ALL_FILE_KINDS.map((item) => (
            <option key={item} value={item}>
              {FILE_KIND_LABEL[item]}
            </option>
          ))}
        </SelectField>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-3.5" />
          ))}
        </div>
      ) : unsupported ? (
        <p className="mt-4 text-[12.5px] text-muted">
          Список файлов недоступен: backend этой версии не отдаёт{' '}
          <span className="font-mono">/api/export/jobs/{jobId}/files</span>.
        </p>
      ) : isError ? (
        <p className="mt-4 text-[12.5px] text-danger">{api.errorMessage(error)}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          art={<NoFilesArt />}
          title="Файлов не найдено"
          description="По выбранным фильтрам в этой задаче нет медиафайлов."
          className="py-8"
        />
      ) : (
        <>
          <div className="scroll-thin mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="micro-label py-2 pr-3 font-medium">Файл</th>
                  <th className="micro-label py-2 pr-3 font-medium">Тип</th>
                  <th className="micro-label py-2 pr-3 text-right font-medium">Размер</th>
                  <th className="micro-label py-2 pr-3 font-medium">Статус</th>
                  <th className="micro-label py-2 pr-3 font-medium">Скачан</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top transition-colors duration-120 hover:bg-veil">
                    <td className="max-w-[320px] py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <KindIcon kind={row.kind} />
                        <FileName
                          name={row.file_name ?? `${row.kind}_${row.id}${extOf(row.ext)}`}
                          className="font-mono text-[12px] text-dim"
                        />
                      </span>
                      {row.error ? (
                        <span className="mt-0.5 block break-words text-[11.5px] leading-snug text-danger">
                          {row.error}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-[12.5px] text-dim">{FILE_KIND_LABEL[row.kind] ?? row.kind}</td>
                    <td className="tnum py-2 pr-3 text-right font-mono text-[12px] text-dim">
                      {row.size !== null ? formatBytes(row.size) : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={FILE_STATUS_TONE[row.status] ?? 'neutral'}>
                        {FILE_STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </td>
                    <td className="tnum py-2 pr-3 text-[12px] text-muted">
                      {row.downloaded_at ? formatDate(row.downloaded_at) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {row.status === 'done' ? (
                        <Tooltip label="Скачать файл">
                          <a
                            href={api.fileDownloadUrl(row.id)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Скачать ${row.file_name ?? row.kind}`}
                            className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded-control text-dim',
                              'transition-colors duration-120 hover:bg-veil hover:text-text',
                            )}
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        </Tooltip>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(data?.pages ?? 1) > 1 ? (
            <Pagination
              page={data?.page ?? page}
              pages={data?.pages ?? 1}
              total={data?.total ?? 0}
              unitLabel="файлов"
              onPage={setPage}
            />
          ) : (
            <p className="mt-3 text-[12px] text-muted">
              Всего: <span className="tnum font-mono text-dim">{formatNumber(data?.total ?? rows.length)}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
