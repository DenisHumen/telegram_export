import type {
  AccountStatus,
  AuthStatus,
  ChatKind,
  ExportFormat,
  JobPhase,
  JobStatus,
  LayoutStrategy,
  LogLevel,
  MediaKind,
  SortField,
} from '../api/types';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  new: 'Новый',
  pending_code: 'Ожидает код',
  pending_password: 'Ожидает пароль',
  authorized: 'Авторизован',
  unauthorized: 'Не авторизован',
  error: 'Ошибка',
};

export const ACCOUNT_STATUS_TONE: Record<AccountStatus, Tone> = {
  new: 'neutral',
  pending_code: 'warning',
  pending_password: 'warning',
  authorized: 'success',
  unauthorized: 'neutral',
  error: 'danger',
};

export const AUTH_STATUS_LABEL: Record<AuthStatus, string> = {
  idle: 'Ожидание',
  code_sent: 'Код отправлен',
  password_required: 'Нужен пароль 2FA',
  qr_waiting: 'Ожидание сканирования',
  qr_expired: 'QR-код истёк',
  authorized: 'Авторизован',
  error: 'Ошибка',
};

export const CHAT_KIND_LABEL: Record<ChatKind, string> = {
  user: 'Личный',
  bot: 'Бот',
  group: 'Группа',
  supergroup: 'Супергруппа',
  channel: 'Канал',
};

export const CHAT_KIND_TONE: Record<ChatKind, Tone> = {
  user: 'neutral',
  bot: 'warning',
  group: 'accent',
  supergroup: 'accent',
  channel: 'success',
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  paused: 'На паузе',
  completed: 'Завершён',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  queued: 'neutral',
  running: 'accent',
  paused: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const JOB_PHASE_LABEL: Record<JobPhase, string> = {
  init: 'Инициализация',
  counting: 'Подсчёт сообщений',
  fetching: 'Загрузка сообщений',
  downloading: 'Скачивание медиа',
  rendering: 'Сборка отчётов',
  done: 'Готово',
};

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  photo: 'Фото',
  video: 'Видео',
  video_note: 'Кружочки',
  voice: 'Голосовые',
  audio: 'Аудио',
  document: 'Документы',
  sticker: 'Стикеры',
  animation: 'GIF',
};

export const ALL_MEDIA_KINDS: MediaKind[] = [
  'photo',
  'video',
  'video_note',
  'voice',
  'audio',
  'document',
  'sticker',
  'animation',
];

/** media_type values from the DB enum (§2.3) — used for the message browser filter. */
export const MESSAGE_MEDIA_TYPE_LABEL: Record<string, string> = {
  none: 'Без медиа',
  photo: 'Фото',
  video: 'Видео',
  video_note: 'Кружочки',
  voice: 'Голосовые',
  audio: 'Аудио',
  document: 'Документы',
  sticker: 'Стикеры',
  animation: 'GIF',
  contact: 'Контакт',
  poll: 'Опрос',
  geo: 'Геопозиция',
  venue: 'Место',
  webpage: 'Ссылка',
  game: 'Игра',
  invoice: 'Счёт',
  dice: 'Кубик',
  unsupported: 'Не поддерживается',
};

export const MESSAGE_MEDIA_TYPES = Object.keys(MESSAGE_MEDIA_TYPE_LABEL);

export const EXPORT_FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'json', label: 'JSON', hint: 'Полный дамп одним массивом' },
  { value: 'jsonl', label: 'JSONL', hint: 'По одному сообщению в строке' },
  { value: 'html', label: 'HTML', hint: 'Офлайн-просмотрщик index.html' },
  { value: 'csv', label: 'CSV', hint: 'Таблица для Excel' },
  { value: 'txt', label: 'TXT', hint: 'Простой текст' },
];

export const SORT_FIELD_LABEL: Record<SortField, string> = {
  date: 'Дата',
  type: 'Тип',
  sender: 'Отправитель',
  size: 'Размер',
  views: 'Просмотры',
  id: 'ID сообщения',
};

export interface LayoutInfo {
  value: LayoutStrategy;
  title: string;
  description: string;
  /** Tiny rendered folder-tree preview. */
  tree: string[];
}

export const LAYOUTS: LayoutInfo[] = [
  {
    value: 'flat',
    title: 'Плоская',
    description: 'Все файлы в одной папке media/',
    tree: ['media/', '  2026-01-04_15_photo.jpg', '  2026-01-04_16_video.mp4', '  2026-02-11_31_voice.ogg'],
  },
  {
    value: 'by_type',
    title: 'По типу',
    description: 'Отдельная папка на каждый тип медиа',
    tree: ['media/', '  photos/', '    …jpg', '  video_notes/', '    …mp4', '  voices/', '    …ogg'],
  },
  {
    value: 'by_date',
    title: 'По дате',
    description: 'Год → месяц',
    tree: ['media/', '  2026/', '    2026-01/', '      …', '    2026-02/', '      …'],
  },
  {
    value: 'by_date_type',
    title: 'Дата → тип',
    description: 'Год → месяц → тип медиа',
    tree: ['media/', '  2026/', '    2026-01/', '      photos/', '      video_notes/'],
  },
  {
    value: 'by_type_date',
    title: 'Тип → дата',
    description: 'Тип медиа → месяц (рекомендуется)',
    tree: ['media/', '  photos/', '    2026-01/', '    2026-02/', '  video_notes/', '    2026-01/'],
  },
  {
    value: 'by_sender',
    title: 'По отправителю',
    description: 'Папка на каждого автора сообщений',
    tree: ['media/', '  Ivan_Petrov_123/', '    …', '  Anna_Smirnova_456/', '    …'],
  },
  {
    value: 'by_album',
    title: 'По альбомам',
    description: 'Альбомы отдельно, одиночные файлы отдельно',
    tree: ['media/', '  albums/', '    1029384756/', '      …', '  single/', '    …'],
  },
  {
    value: 'by_size',
    title: 'По размеру',
    description: 'Мелкие / средние / крупные файлы',
    tree: ['media/', '  small_lt10mb/', '  medium_lt100mb/', '  large/'],
  },
];

export const FILENAME_PLACEHOLDERS: { token: string; description: string; sample: string }[] = [
  { token: '{id}', description: 'ID сообщения', sample: '1042' },
  { token: '{date}', description: 'Дата (YYYY-MM-DD)', sample: '2026-01-14' },
  { token: '{time}', description: 'Время (HH-MM-SS)', sample: '18-42-07' },
  { token: '{datetime}', description: 'Дата и время', sample: '2026-01-14_18-42-07' },
  { token: '{name}', description: 'Исходное имя файла', sample: 'IMG_0421' },
  { token: '{ext}', description: 'Расширение', sample: 'jpg' },
  { token: '{kind}', description: 'Тип медиа', sample: 'photo' },
  { token: '{sender}', description: 'Отправитель', sample: 'Ivan_Petrov' },
  { token: '{chat}', description: 'Название чата', sample: 'Tech_News' },
  { token: '{album}', description: 'ID альбома', sample: '1029384756' },
];

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];

export const LOG_LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'Debug',
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

export const LOG_LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-muted',
  info: 'text-dim',
  warning: 'text-warning',
  error: 'text-danger',
};

export const LOG_LEVEL_TONE: Record<LogLevel, Tone> = {
  debug: 'neutral',
  info: 'accent',
  warning: 'warning',
  error: 'danger',
};

/** Left border of a timeline row, by level. */
export const LOG_LEVEL_BORDER: Record<LogLevel, string> = {
  debug: 'border-l-border-strong',
  info: 'border-l-accent/45',
  warning: 'border-l-warning/70',
  error: 'border-l-danger/80',
};

/* ------------------------------------------------------- media files */

/** `media_files.kind` — a superset of MediaKind (§2.4). */
export const FILE_KIND_LABEL: Record<string, string> = {
  photo: 'Фото',
  video: 'Видео',
  video_note: 'Кружочек',
  voice: 'Голосовое',
  audio: 'Аудио',
  document: 'Документ',
  sticker: 'Стикер',
  animation: 'GIF',
  thumb: 'Превью',
  avatar: 'Аватар',
};

export const ALL_FILE_KINDS: string[] = Object.keys(FILE_KIND_LABEL);

export const FILE_STATUS_LABEL: Record<string, string> = {
  pending: 'В очереди',
  downloading: 'Скачивается',
  done: 'Скачано',
  failed: 'Ошибка',
  skipped: 'Пропущено',
};

export const FILE_STATUS_TONE: Record<string, Tone> = {
  pending: 'neutral',
  downloading: 'accent',
  done: 'success',
  failed: 'danger',
  skipped: 'warning',
};

export const AUTH_ERROR_HINT: Record<string, string> = {
  PHONE_CODE_INVALID: 'Неверный код. Проверьте цифры и попробуйте снова.',
  PHONE_CODE_EXPIRED: 'Код устарел. Запросите новый.',
  PASSWORD_INVALID: 'Неверный облачный пароль.',
  FLOOD_WAIT: 'Telegram временно ограничил попытки входа.',
  PHONE_NUMBER_INVALID: 'Неверный формат номера телефона.',
  API_ID_INVALID: 'Неверные api_id / api_hash.',
  SESSION_EXPIRED: 'Сессия истекла, войдите заново.',
};

export function codeTypeLabel(codeType: string | null): string {
  switch (codeType) {
    case 'app':
      return 'Код отправлен в приложение Telegram';
    case 'sms':
      return 'Код отправлен по SMS';
    case 'call':
      return 'Код будет продиктован во входящем звонке';
    case 'flash_call':
      return 'Код — последние цифры номера входящего звонка';
    case 'email':
      return 'Код отправлен на e-mail';
    default:
      return 'Код отправлен';
  }
}
