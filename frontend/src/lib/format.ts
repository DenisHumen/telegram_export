/** Formatters — Russian locale everywhere. */

const numberFmt = new Intl.NumberFormat('ru-RU');

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return numberFmt.format(value);
}

const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];

export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes <= 0) return '0 Б';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  const digits = exponent === 0 ? 0 : value >= 100 ? 0 : fractionDigits;
  return `${value.toFixed(digits).replace('.', ',')} ${BYTE_UNITS[exponent]}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/с`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  if (total < 60) return `${total} с`;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600) % 24;
  const d = Math.floor(total / 86400);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  const s = total % 60;
  return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateOnlyFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatDate(value: string | number | Date | null | undefined, withTime = true): string {
  const d = toDate(value);
  if (!d) return '—';
  return withTime ? dateTimeFmt.format(d) : dateOnlyFmt.format(d);
}

export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return timeFmt.format(d);
}

const relativeFmt = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });

const RELATIVE_STEPS: { limit: number; div: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60, div: 1, unit: 'second' },
  { limit: 3600, div: 60, unit: 'minute' },
  { limit: 86400, div: 3600, unit: 'hour' },
  { limit: 2592000, div: 86400, unit: 'day' },
  { limit: 31536000, div: 2592000, unit: 'month' },
  { limit: Number.POSITIVE_INFINITY, div: 31536000, unit: 'year' },
];

export function formatRelative(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const deltaSeconds = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(deltaSeconds);
  if (abs < 10) return 'только что';
  for (const step of RELATIVE_STEPS) {
    if (abs < step.limit) {
      return relativeFmt.format(Math.round(deltaSeconds / step.div), step.unit);
    }
  }
  return formatDate(d);
}

/** '2026-01' -> 'янв 2026' */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-');
  const year = Number(y);
  const monthIdx = Number(m) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIdx)) return month;
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${names[monthIdx] ?? m} ${year}`;
}

export function percent(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

/** Russian pluralisation: plural(5, 'сообщение', 'сообщения', 'сообщений') */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function initialsOf(...parts: (string | null | undefined)[]): string {
  const source = parts.filter(Boolean).join(' ').trim();
  if (!source) return '??';
  const words = source.split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || '??';
}

/** Deterministic hue for avatar placeholders. */
export function hueFor(seed: string | number): number {
  const s = String(seed);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 360;
  return hash;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Date -> 'YYYY-MM-DD' for <input type="date"> */
export function toDateInput(value: string | null | undefined): string {
  const d = toDate(value ?? null);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
