import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  Download,
  FileText,
  Filter,
  FolderTree,
  Gauge,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import * as api from '../../api/client';
import type { Chat, ChatStats, ExportFormat, ExportOptions, MediaKind, SortField } from '../../api/types';
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_PRESETS,
  loadStoredOptions,
  previewFilename,
  storeOptions,
  toRequestOptions,
} from '../../lib/exportOptions';
import {
  ALL_MEDIA_KINDS,
  EXPORT_FORMATS,
  FILENAME_PLACEHOLDERS,
  MEDIA_KIND_LABEL,
  SORT_FIELD_LABEL,
} from '../../lib/labels';
import { formatNumber, plural, toDateInput } from '../../lib/format';
import { toast } from '../../store/ui';
import { Button } from '../ui/Button';
import { Chip, SelectField, Slider, TextField, Toggle } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { LayoutPicker } from './LayoutPicker';

function Section({
  title,
  description,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface2/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface2 text-accent-soft">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-ink">{title}</span>
          {description ? <span className="block truncate text-[12px] text-ink-faint">{description}</span> : null}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-ink-faint transition-transform duration-150', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open ? <div className="border-t border-line px-4 py-4">{children}</div> : null}
    </section>
  );
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ExportConfigurator({
  open,
  onClose,
  chat,
  stats,
}: {
  open: boolean;
  onClose: () => void;
  chat: Chat;
  stats?: ChatStats;
}) {
  const [options, setOptions] = useState<ExportOptions>(() => loadStoredOptions());
  const templateRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (open) setOptions(loadStoredOptions());
  }, [open]);

  const patch = (next: Partial<ExportOptions>) => setOptions((previous) => ({ ...previous, ...next }));

  const toggleIn = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((value) => value !== item) : [...list, item];

  const createMutation = useMutation({
    mutationFn: () =>
      api.createJob({
        account_id: chat.account_id,
        chat_id: chat.id,
        options: toRequestOptions(options),
      }),
    onSuccess: (job) => {
      storeOptions(options);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Экспорт запущен', `Задача #${job.id} · ${job.chat_title}`);
      onClose();
      navigate('/jobs');
    },
    onError: (error) => toast.error('Не удалось запустить экспорт', api.errorMessage(error)),
  });

  const estimate = useMemo(() => {
    const totalMessages = stats?.messages ?? chat.messages_cached ?? 0;
    const messages = options.limit ? Math.min(options.limit, totalMessages || options.limit) : totalMessages;
    let mediaFiles = 0;
    if (options.download_media && stats?.by_media_type) {
      for (const kind of options.media_types) {
        mediaFiles += stats.by_media_type[kind] ?? 0;
      }
    } else if (options.download_media) {
      mediaFiles = chat.media_cached ?? 0;
    }
    return { messages, mediaFiles };
  }, [options, stats, chat]);

  const insertPlaceholder = (token: string) => {
    const input = templateRef.current;
    const current = options.filename_template;
    if (!input) {
      patch({ filename_template: current + token });
      return;
    }
    const start = input.selectionStart ?? current.length;
    const end = input.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    patch({ filename_template: next });
    window.requestAnimationFrame(() => {
      input.focus();
      const caret = start + token.length;
      input.setSelectionRange(caret, caret);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Настройка экспорта"
      subtitle={chat.title}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink-muted">
            ≈ <span className="font-mono text-ink">{formatNumber(estimate.messages)}</span>{' '}
            {plural(estimate.messages, 'сообщение', 'сообщения', 'сообщений')}
            {options.download_media ? (
              <>
                {' · медиа: '}
                <span className="font-mono text-ink">{formatNumber(estimate.mediaFiles)}</span>{' '}
                {plural(estimate.mediaFiles, 'файл', 'файла', 'файлов')}
                <span className="text-ink-faint">
                  {' '}
                  ({options.media_types.length} из {ALL_MEDIA_KINDS.length} типов)
                </span>
              </>
            ) : (
              ' · медиа не скачиваем'
            )}
          </p>
          <div className="flex items-center gap-2.5">
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon={<Download className="h-4 w-4" />}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Начать экспорт
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* presets */}
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-line bg-base/40 px-4 py-3">
          <span className="flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-ink-faint">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Пресеты
          </span>
          {EXPORT_PRESETS.map((preset) => (
            <Chip key={preset.id} title={preset.description} onClick={() => patch(preset.patch)}>
              «{preset.name}»
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => setOptions({ ...DEFAULT_EXPORT_OPTIONS, media_types: [...ALL_MEDIA_KINDS] })}
            className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-ink-faint transition-colors duration-150 hover:text-ink"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Сбросить
          </button>
        </div>

        {/* -------------------------------------------------- what */}
        <Section title="Что экспортировать" description="Фильтры по типам медиа, датам и диапазону ID" icon={<Filter className="h-4 w-4" />}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Toggle
                checked={options.download_media}
                onChange={(next) => patch({ download_media: next })}
                label="Скачивать медиа"
                description="Файлы будут сохранены на диск"
              />
              <Toggle
                checked={options.include_service_messages}
                onChange={(next) => patch({ include_service_messages: next })}
                label="Служебные сообщения"
                description="Вход/выход участников, закрепления"
              />
              <Toggle
                checked={options.include_text_only}
                onChange={(next) => patch({ include_text_only: next })}
                label="Текстовые сообщения"
                description="Сообщения без вложений"
              />
            </div>

            <div>
              <p className="label">Типы медиа</p>
              <div className="flex flex-wrap gap-2">
                {ALL_MEDIA_KINDS.map((kind: MediaKind) => (
                  <Chip
                    key={kind}
                    active={options.media_types.includes(kind)}
                    onClick={() => patch({ media_types: toggleIn(options.media_types, kind) })}
                  >
                    {MEDIA_KIND_LABEL[kind]}
                  </Chip>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      media_types: options.media_types.length === ALL_MEDIA_KINDS.length ? [] : [...ALL_MEDIA_KINDS],
                    })
                  }
                  className="text-[12px] text-ink-faint underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
                >
                  {options.media_types.length === ALL_MEDIA_KINDS.length ? 'снять все' : 'выбрать все'}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextField
                type="date"
                label="Дата с"
                value={toDateInput(options.date_from)}
                onChange={(event) => patch({ date_from: event.target.value || null })}
              />
              <TextField
                type="date"
                label="Дата по"
                value={toDateInput(options.date_to)}
                onChange={(event) => patch({ date_to: event.target.value || null })}
              />
              <TextField
                type="number"
                label="min_id"
                mono
                placeholder="—"
                value={options.min_id ?? ''}
                onChange={(event) => patch({ min_id: numberOrNull(event.target.value) })}
                hint="Сообщения с id больше"
              />
              <TextField
                type="number"
                label="max_id"
                mono
                placeholder="—"
                value={options.max_id ?? ''}
                onChange={(event) => patch({ max_id: numberOrNull(event.target.value) })}
                hint="Сообщения с id меньше"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                type="number"
                label="Лимит сообщений"
                mono
                placeholder="все"
                value={options.limit ?? ''}
                onChange={(event) => patch({ limit: numberOrNull(event.target.value) })}
              />
              <TextField
                type="number"
                label="Макс. размер файла, МБ"
                mono
                placeholder="без ограничения"
                value={options.max_file_size_mb ?? ''}
                onChange={(event) => patch({ max_file_size_mb: numberOrNull(event.target.value) })}
              />
              <TextField
                label="Поиск по тексту"
                placeholder="фильтр на стороне Telegram"
                value={options.search ?? ''}
                onChange={(event) => patch({ search: event.target.value || null })}
              />
            </div>
          </div>
        </Section>

        {/* -------------------------------------------------- how */}
        <Section
          title="Как скачивать"
          description="Порядок обхода, параллельность и режим докачки"
          icon={<Gauge className="h-4 w-4" />}
          defaultOpen={false}
        >
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="Порядок обхода"
                value={options.order}
                onChange={(event) => patch({ order: event.target.value as ExportOptions['order'] })}
                hint="asc — от старых к новым"
              >
                <option value="asc">По возрастанию (старые → новые)</option>
                <option value="desc">По убыванию (новые → старые)</option>
              </SelectField>
              <Slider
                label="Параллельных загрузок"
                min={1}
                max={16}
                value={options.concurrency}
                onChange={(next) => patch({ concurrency: next })}
                format={(value) => `${value}`}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Toggle
                checked={options.skip_existing}
                onChange={(next) => patch({ skip_existing: next })}
                label="Пропускать скачанное"
                description="Не перекачивать существующие файлы"
              />
              <Toggle
                checked={options.incremental}
                onChange={(next) => patch({ incremental: next })}
                label="Инкрементально"
                description="Догрузить только новое с прошлого экспорта"
              />
              <Toggle
                checked={options.use_takeout}
                onChange={(next) => patch({ use_takeout: next })}
                label="Takeout-сессия"
                description="Официальный режим выгрузки Telegram"
              />
              <Toggle
                checked={options.download_thumbs}
                onChange={(next) => patch({ download_thumbs: next })}
                label="Скачивать превью"
                description="Миниатюры для видео и документов"
              />
              <Toggle
                checked={options.download_avatars}
                onChange={(next) => patch({ download_avatars: next })}
                label="Аватары отправителей"
                description="Фото профилей авторов сообщений"
              />
            </div>
          </div>
        </Section>

        {/* -------------------------------------------------- layout */}
        <Section
          title="Сортировка и раскладка"
          description="Структура папок и шаблон имени файла"
          icon={<FolderTree className="h-4 w-4" />}
          defaultOpen={false}
        >
          <div className="space-y-5">
            <LayoutPicker value={options.layout} onChange={(next) => patch({ layout: next })} />

            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="Поле сортировки в отчётах"
                value={options.sort_field}
                onChange={(event) => patch({ sort_field: event.target.value as SortField })}
              >
                {(Object.keys(SORT_FIELD_LABEL) as SortField[]).map((field) => (
                  <option key={field} value={field}>
                    {SORT_FIELD_LABEL[field]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Направление сортировки"
                value={options.sort_order}
                onChange={(event) => patch({ sort_order: event.target.value as ExportOptions['sort_order'] })}
              >
                <option value="asc">По возрастанию</option>
                <option value="desc">По убыванию</option>
              </SelectField>
            </div>

            <div>
              <TextField
                ref={templateRef}
                label="Шаблон имени файла"
                mono
                value={options.filename_template}
                onChange={(event) => patch({ filename_template: event.target.value })}
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {FILENAME_PLACEHOLDERS.map((placeholder) => (
                  <button
                    key={placeholder.token}
                    type="button"
                    title={`${placeholder.description} · например ${placeholder.sample}`}
                    onClick={() => insertPlaceholder(placeholder.token)}
                    className="rounded-md border border-line bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent-soft"
                  >
                    {placeholder.token}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 flex flex-wrap items-baseline gap-2 rounded-lg border border-line bg-base/70 px-3 py-2 text-[12px] text-ink-faint">
                Превью:
                <span className="font-mono text-[12.5px] text-accent-soft">
                  {previewFilename(options.filename_template, chat.title)}
                </span>
              </p>
            </div>
          </div>
        </Section>

        {/* -------------------------------------------------- output */}
        <Section
          title="Формат вывода"
          description="Файлы отчётов и каталог назначения"
          icon={<FileText className="h-4 w-4" />}
          defaultOpen={false}
        >
          <div className="space-y-4">
            <div>
              <p className="label">Форматы отчётов</p>
              <div className="flex flex-wrap gap-2">
                {EXPORT_FORMATS.map((format) => (
                  <Chip
                    key={format.value}
                    title={format.hint}
                    active={options.formats.includes(format.value)}
                    onClick={() => patch({ formats: toggleIn<ExportFormat>(options.formats, format.value) })}
                  >
                    {format.label}
                  </Chip>
                ))}
              </div>
            </div>
            <TextField
              label="Каталог экспорта"
              mono
              placeholder="data/exports/<chat>_<id>_<ts>/"
              value={options.output_dir ?? ''}
              onChange={(event) => patch({ output_dir: event.target.value || null })}
              hint="Пусто — использовать путь по умолчанию"
            />
          </div>
        </Section>
      </div>
    </Modal>
  );
}
