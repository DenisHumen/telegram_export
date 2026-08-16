/**
 * Mirror of docs/CONTRACT.md §4 / §5.
 * Field names are snake_case exactly as the backend returns them — never rename.
 */

/* ------------------------------------------------------------------ 4.0 */

export interface Health {
  status: string;
  db: boolean;
  redis: boolean;
  version: string;
  uptime_seconds: number;
}

/* ------------------------------------------------------------------ 4.1 */

export type AccountStatus =
  | 'new'
  | 'pending_code'
  | 'pending_password'
  | 'authorized'
  | 'unauthorized'
  | 'error';

export interface Account {
  id: number;
  label: string;
  phone: string | null;
  tg_user_id: number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_premium: boolean;
  api_id: number;
  status: AccountStatus;
  last_error: string | null;
  proxy: string | null;
  connected: boolean; // client is currently in memory and online
  chats_count: number;
  created_at: string;
  last_seen_at: string | null;
}

export interface AccountStats {
  account_id: number;
  chats: number;
  messages: number;
  media_files: number;
  bytes: number;
  jobs: number;
  by_kind: Record<string, number>; // 'channel' -> 12
}

export interface CreateAccountRequest {
  label: string;
  api_id: number;
  api_hash: string;
  proxy?: string | null;
}

export interface UpdateAccountRequest {
  label?: string;
  proxy?: string | null;
}

/* ------------------------------------------------------------------ 4.2 */

export type AuthStatus =
  | 'idle'
  | 'code_sent'
  | 'password_required'
  | 'qr_waiting'
  | 'qr_expired'
  | 'authorized'
  | 'error';

export interface AuthUser {
  id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  is_premium: boolean;
}

export interface AuthState {
  account_id: number;
  status: AuthStatus;
  phone: string | null;
  qr_url: string | null; // tg://login?token=…
  qr_expires_at: string | null;
  code_type: string | null; // 'app' | 'sms' | 'call' | 'flash_call' | ...
  password_hint: string | null;
  error: string | null;
  error_code: string | null; // PHONE_CODE_INVALID | PASSWORD_INVALID | FLOOD_WAIT | ...
  retry_after: number | null; // seconds, on FLOOD_WAIT
  user: AuthUser | null;
}

/* ------------------------------------------------------------------ 4.3 */

export type ChatKind = 'user' | 'bot' | 'group' | 'supergroup' | 'channel';

export interface Chat {
  id: number;
  account_id: number;
  tg_chat_id: number;
  kind: ChatKind;
  title: string;
  username: string | null;
  about: string | null;
  participants_count: number | null;
  is_broadcast: boolean;
  is_megagroup: boolean;
  is_verified: boolean;
  is_scam: boolean;
  is_creator: boolean;
  is_archived: boolean;
  is_pinned: boolean;
  photo_path: string | null; // served through GET /api/files/photo?path=…
  last_message_id: number | null;
  last_message_date: string | null;
  unread_count: number;
  messages_cached: number;
  media_cached: number;
  bytes_cached: number;
  last_synced_at: string | null;
}

export interface ChatStats {
  chat_id: number;
  messages: number;
  media_files: number;
  bytes: number;
  first_message_date: string | null;
  last_message_date: string | null;
  by_media_type: Record<string, number>;
  by_month: { month: string; count: number }[]; // '2026-01'
  top_senders: { sender_id: number; name: string; count: number }[];
  active_job_id: number | null;
}

export interface MessageFile {
  id: number;
  kind: string;
  file_name: string | null;
  size: number | null;
  status: string;
  rel_path: string | null;
}

export interface MessageRow {
  id: number;
  tg_message_id: number;
  date: string;
  sender_id: number | null;
  sender_name: string | null;
  text: string | null;
  media_type: string;
  has_media: boolean;
  grouped_id: number | null;
  views: number | null;
  reply_to_msg_id: number | null;
  is_service: boolean;
  files: MessageFile[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface ChatSyncResult {
  synced: number;
  created: number;
  updated: number;
}

export type ChatSortField = 'last_message' | 'title' | 'messages' | 'participants' | 'created';
export type SortOrder = 'asc' | 'desc';

export interface ListChatsParams {
  search?: string;
  kind?: 'all' | ChatKind;
  sort?: ChatSortField;
  order?: SortOrder;
  page?: number;
  page_size?: number;
  only_cached?: boolean;
}

export type MessageSortField = 'date' | 'size' | 'views' | 'type';

export interface ListMessagesParams {
  search?: string;
  media_type?: string;
  sender_id?: number;
  date_from?: string;
  date_to?: string;
  sort?: MessageSortField;
  order?: SortOrder;
  page?: number;
  page_size?: number;
}

/* ------------------------------------------------------------------ 4.6 */

export type MediaKind =
  | 'photo'
  | 'video'
  | 'video_note'
  | 'voice'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'animation';

export type LayoutStrategy =
  | 'flat'
  | 'by_type'
  | 'by_date'
  | 'by_date_type'
  | 'by_type_date'
  | 'by_sender'
  | 'by_album'
  | 'by_size';

export type SortField = 'date' | 'type' | 'sender' | 'size' | 'views' | 'id';

export type ExportFormat = 'json' | 'jsonl' | 'html' | 'csv' | 'txt';

export interface ExportOptions {
  // WHAT to fetch
  download_media: boolean;
  media_types: MediaKind[];
  include_service_messages: boolean;
  include_text_only: boolean;
  date_from: string | null;
  date_to: string | null;
  min_id: number | null;
  max_id: number | null;
  limit: number | null;
  max_file_size_mb: number | null;
  search: string | null;

  // HOW to fetch
  order: SortOrder;
  concurrency: number;
  use_takeout: boolean;
  skip_existing: boolean;
  incremental: boolean;
  download_thumbs: boolean;
  download_avatars: boolean;

  // HOW to lay out
  layout: LayoutStrategy;
  sort_field: SortField;
  sort_order: SortOrder;
  filename_template: string;

  // WHAT comes out
  formats: ExportFormat[];
  output_dir: string | null;
}

/* ------------------------------------------------------------------ 4.4 */

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type JobPhase = 'init' | 'counting' | 'fetching' | 'downloading' | 'rendering' | 'done';

export interface CreateJobRequest {
  account_id: number;
  chat_id: number;
  options: ExportOptions;
}

/** A file the exporter is downloading right now (payload of `ExportJob.active_files`). */
export interface ActiveFile {
  media_id: number;
  file_name: string;
  kind: string; // photo | video | video_note | voice | audio | document | sticker | animation | thumb | avatar
  received: number; // bytes so far
  total: number | null; // bytes expected, may be null
  speed_bps: number; // this file's own speed
}

export interface ExportJob {
  id: number;
  account_id: number;
  chat_id: number;
  chat_title: string;
  status: JobStatus;
  phase: JobPhase;
  options: ExportOptions;
  output_dir: string | null;
  total_messages: number;
  processed_messages: number;
  total_files: number;
  downloaded_files: number;
  failed_files: number;
  skipped_files: number;
  bytes_total: number;
  bytes_downloaded: number;
  /** Current speed, rolling ~10s window. */
  speed_bps: number;
  /** Average over the whole run. Added by a newer backend — read defensively. */
  avg_speed_bps: number;
  /** Currently downloading files, may be empty. Added by a newer backend. */
  active_files: ActiveFile[];
  eta_seconds: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/* --- GET /api/export/jobs/{id}/files ------------------------------------ */

export type MediaFileStatus = 'pending' | 'downloading' | 'done' | 'failed' | 'skipped';

/** Row of the `media_files` table (§2.4), as returned by the job files endpoint. */
export interface MediaFileRow {
  id: number;
  message_id: number;
  tg_message_id: number;
  kind: string;
  file_name: string | null;
  ext: string | null;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  rel_path: string | null;
  status: string;
  error: string | null;
  attempts: number;
  downloaded_at: string | null;
}

export interface ListJobFilesParams {
  status?: 'all' | MediaFileStatus;
  kind?: string; // 'all' | photo | video | …
  page?: number;
  page_size?: number;
}

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface JobEvent {
  id: number;
  job_id: number;
  ts: string;
  level: LogLevel;
  message: string;
  data: unknown | null;
}

export interface ListJobsParams {
  account_id?: number;
  chat_id?: number;
  status?: JobStatus;
  page?: number;
  page_size?: number;
}

export interface RebuildJobRequest {
  formats?: ExportFormat[];
  layout?: LayoutStrategy;
  sort_field?: SortField;
  sort_order?: SortOrder;
}

export interface ExportManifest {
  tgvault_version: string;
  exported_at: string;
  account: { id: number; tg_user_id: number | null; username: string | null };
  chat: {
    id: number;
    tg_chat_id: number;
    title: string;
    kind: ChatKind;
    username: string | null;
  };
  options: ExportOptions;
  stats: {
    messages: number;
    media_files: number;
    bytes: number;
    by_media_type: Record<string, number>;
    date_from: string | null;
    date_to: string | null;
  };
  files: { id: number; message_id: number; kind: string; rel_path: string; size: number }[];
}

/* ------------------------------------------------------------------ 4.5 */

/** Row of the `app_logs` table (§2.7), payload of the `log` WS message. */
export interface LogRow {
  id: number;
  ts: string;
  level: LogLevel;
  logger: string;
  message: string;
  account_id: number | null;
  job_id: number | null;
  data: unknown | null;
}

export interface LogFile {
  name: string;
  size: number;
  modified: string;
}

export interface LogFileTail {
  name: string;
  lines: string[];
}

export interface ListLogsParams {
  level?: LogLevel;
  account_id?: number;
  job_id?: number;
  search?: string;
  limit?: number;
  after_id?: number;
}

export interface OkResponse {
  ok: boolean;
}

/* ------------------------------------------------------------------ 5   */

export interface ChatSyncProgress {
  account_id: number;
  synced: number;
  done: boolean;
}

export type WsMessage =
  | { type: 'hello'; ts: string; version: string }
  | { type: 'auth_state'; ts: string; payload: AuthState }
  | { type: 'job_progress'; ts: string; payload: ExportJob }
  | { type: 'job_event'; ts: string; payload: JobEvent }
  | { type: 'chat_sync'; ts: string; payload: ChatSyncProgress }
  | { type: 'log'; ts: string; payload: LogRow }
  | { type: 'account'; ts: string; payload: Account }
  | { type: 'pong'; ts?: string };

export type WsMessageType = WsMessage['type'];

export type WsPayloadOf<T extends WsMessageType> = Extract<WsMessage, { type: T }>;
