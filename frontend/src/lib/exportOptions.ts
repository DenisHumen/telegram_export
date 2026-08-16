import type { ExportOptions } from '../api/types';
import { ALL_MEDIA_KINDS } from './labels';

const STORAGE_KEY = 'tgvault.export-options.v1';

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  download_media: true,
  media_types: [...ALL_MEDIA_KINDS],
  include_service_messages: true,
  include_text_only: true,
  date_from: null,
  date_to: null,
  min_id: null,
  max_id: null,
  limit: null,
  max_file_size_mb: null,
  search: null,

  order: 'asc',
  concurrency: 4,
  use_takeout: false,
  skip_existing: true,
  incremental: true,
  download_thumbs: false,
  download_avatars: false,

  layout: 'by_type_date',
  sort_field: 'date',
  sort_order: 'asc',
  filename_template: '{date}_{id}_{name}',

  formats: ['json', 'html'],
  output_dir: null,
};

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  patch: Partial<ExportOptions>;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'full',
    name: 'Всё целиком',
    description: 'Все сообщения и все типы медиа, отчёты во всех форматах',
    patch: {
      download_media: true,
      media_types: [...ALL_MEDIA_KINDS],
      include_service_messages: true,
      include_text_only: true,
      download_thumbs: true,
      download_avatars: true,
      limit: null,
      max_file_size_mb: null,
      formats: ['json', 'jsonl', 'html', 'csv', 'txt'],
      layout: 'by_type_date',
    },
  },
  {
    id: 'media-only',
    name: 'Только медиа',
    description: 'Медиафайлы без текстовых сообщений и служебных событий',
    patch: {
      download_media: true,
      media_types: [...ALL_MEDIA_KINDS],
      include_service_messages: false,
      include_text_only: false,
      download_thumbs: false,
      download_avatars: false,
      formats: ['json', 'html'],
      layout: 'by_type_date',
    },
  },
  {
    id: 'text-only',
    name: 'Только текст',
    description: 'Ничего не скачиваем, собираем только текстовый архив',
    patch: {
      download_media: false,
      media_types: [],
      include_service_messages: true,
      include_text_only: true,
      download_thumbs: false,
      download_avatars: false,
      formats: ['json', 'html', 'txt'],
      layout: 'flat',
    },
  },
];

function isMediaKindArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Merge unknown persisted data over the defaults, keeping every field well-typed. */
export function normalizeOptions(input: unknown): ExportOptions {
  const base: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, media_types: [...ALL_MEDIA_KINDS] };
  if (!input || typeof input !== 'object') return base;
  const raw = input as Record<string, unknown>;
  const draft: Record<string, unknown> = { ...base };

  const bools = [
    'download_media',
    'include_service_messages',
    'include_text_only',
    'use_takeout',
    'skip_existing',
    'incremental',
    'download_thumbs',
    'download_avatars',
  ];
  for (const key of bools) {
    const value = raw[key];
    if (typeof value === 'boolean') draft[key] = value;
  }

  const nullableNumbers = ['min_id', 'max_id', 'limit', 'max_file_size_mb'];
  for (const key of nullableNumbers) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) draft[key] = value;
    else if (value === null) draft[key] = null;
  }

  const nullableStrings = ['date_from', 'date_to', 'search', 'output_dir'];
  for (const key of nullableStrings) {
    const value = raw[key];
    if (typeof value === 'string') draft[key] = value;
    else if (value === null) draft[key] = null;
  }

  const out = draft as unknown as ExportOptions;

  if (raw.order === 'asc' || raw.order === 'desc') out.order = raw.order;
  if (raw.sort_order === 'asc' || raw.sort_order === 'desc') out.sort_order = raw.sort_order;
  if (typeof raw.concurrency === 'number') out.concurrency = Math.min(16, Math.max(1, Math.round(raw.concurrency)));
  if (typeof raw.filename_template === 'string' && raw.filename_template.trim())
    out.filename_template = raw.filename_template;
  if (typeof raw.layout === 'string') out.layout = raw.layout as ExportOptions['layout'];
  if (typeof raw.sort_field === 'string') out.sort_field = raw.sort_field as ExportOptions['sort_field'];
  if (isMediaKindArray(raw.media_types)) out.media_types = raw.media_types as ExportOptions['media_types'];
  if (isMediaKindArray(raw.formats)) out.formats = raw.formats as ExportOptions['formats'];

  return out;
}

export function loadStoredOptions(): ExportOptions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeOptions(null);
    return normalizeOptions(JSON.parse(raw));
  } catch {
    return normalizeOptions(null);
  }
}

export function storeOptions(options: ExportOptions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    /* localStorage unavailable — ignore */
  }
}

const EXT_BY_KIND: Record<string, string> = {
  photo: 'jpg',
  video: 'mp4',
  video_note: 'mp4',
  voice: 'ogg',
  audio: 'mp3',
  document: 'pdf',
  sticker: 'webp',
  animation: 'gif',
};

/** Render a sample filename from a template, for the live preview. */
export function previewFilename(template: string, chatTitle: string): string {
  const kind = 'photo';
  const values: Record<string, string> = {
    '{id}': '1042',
    '{date}': '2026-01-14',
    '{time}': '18-42-07',
    '{datetime}': '2026-01-14_18-42-07',
    '{name}': 'IMG_0421',
    '{ext}': EXT_BY_KIND[kind] ?? 'bin',
    '{kind}': kind,
    '{sender}': 'Ivan_Petrov',
    '{chat}': (chatTitle || 'chat').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 24),
    '{album}': '1029384756',
  };
  let result = template || '{date}_{id}_{name}';
  for (const [token, value] of Object.entries(values)) {
    result = result.split(token).join(value);
  }
  if (!/\.[a-z0-9]{1,5}$/i.test(result)) result += `.${values['{ext}']}`;
  return result;
}

/** Strip empty/default noise so the request body stays readable. */
export function toRequestOptions(options: ExportOptions): ExportOptions {
  return {
    ...options,
    search: options.search?.trim() ? options.search.trim() : null,
    output_dir: options.output_dir?.trim() ? options.output_dir.trim() : null,
    date_from: options.date_from || null,
    date_to: options.date_to || null,
    filename_template: options.filename_template.trim() || DEFAULT_EXPORT_OPTIONS.filename_template,
  };
}
