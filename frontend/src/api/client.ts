/**
 * Typed fetch wrapper for the TgVault REST API (docs/CONTRACT.md §4).
 * Base URL is relative ('') — dev server proxies /api to the backend.
 */
import type {
  Account,
  AccountStats,
  AuthState,
  Chat,
  ChatStats,
  ChatSyncResult,
  CreateAccountRequest,
  CreateJobRequest,
  ExportJob,
  ExportManifest,
  Health,
  JobEvent,
  ListChatsParams,
  ListJobsParams,
  ListLogsParams,
  ListMessagesParams,
  LogFile,
  LogFileTail,
  LogRow,
  MessageRow,
  OkResponse,
  Paginated,
  RebuildJobRequest,
  UpdateAccountRequest,
} from './types';

export const API_BASE = '';

/** Error thrown for any non-2xx response. Carries the backend `{detail, code}`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly detail: string;

  constructor(status: number, detail: string, code: string | null) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.append(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Сервер недоступен. Проверьте, что backend запущен на 127.0.0.1:8077.', 'NETWORK_ERROR');
  }

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const obj = (parsed ?? {}) as { detail?: unknown; code?: unknown };
    const detail =
      typeof obj.detail === 'string'
        ? obj.detail
        : raw
          ? raw.slice(0, 400)
          : `HTTP ${response.status}`;
    const code = typeof obj.code === 'string' ? obj.code : null;
    throw new ApiError(response.status, detail, code);
  }

  return parsed as T;
}

/* ------------------------------------------------------------------ 4.0 */

export const getHealth = () => request<Health>('/api/health');

/* ------------------------------------------------------------------ 4.1 */

export const listAccounts = () => request<Account[]>('/api/accounts');

export const createAccount = (body: CreateAccountRequest) =>
  request<Account>('/api/accounts', { method: 'POST', body });

export const getAccount = (id: number) => request<Account>(`/api/accounts/${id}`);

export const updateAccount = (id: number, body: UpdateAccountRequest) =>
  request<Account>(`/api/accounts/${id}`, { method: 'PATCH', body });

export const deleteAccount = (id: number) =>
  request<OkResponse>(`/api/accounts/${id}`, { method: 'DELETE' });

export const logoutAccount = (id: number) =>
  request<Account>(`/api/accounts/${id}/logout`, { method: 'POST' });

export const connectAccount = (id: number) =>
  request<Account>(`/api/accounts/${id}/connect`, { method: 'POST' });

export const getAccountStats = (id: number) => request<AccountStats>(`/api/accounts/${id}/stats`);

/* ------------------------------------------------------------------ 4.2 */

export const getAuthState = (accountId: number) => request<AuthState>(`/api/auth/${accountId}/state`);

export const authSendCode = (accountId: number, phone: string) =>
  request<AuthState>(`/api/auth/${accountId}/phone/send-code`, { method: 'POST', body: { phone } });

export const authSignIn = (accountId: number, code: string) =>
  request<AuthState>(`/api/auth/${accountId}/phone/sign-in`, { method: 'POST', body: { code } });

export const authPassword = (accountId: number, password: string) =>
  request<AuthState>(`/api/auth/${accountId}/password`, { method: 'POST', body: { password } });

export const authQrStart = (accountId: number) =>
  request<AuthState>(`/api/auth/${accountId}/qr/start`, { method: 'POST' });

export const authQrRefresh = (accountId: number) =>
  request<AuthState>(`/api/auth/${accountId}/qr/refresh`, { method: 'POST' });

export const authQrStatus = (accountId: number) => request<AuthState>(`/api/auth/${accountId}/qr/status`);

export const authCancel = (accountId: number) =>
  request<AuthState>(`/api/auth/${accountId}/cancel`, { method: 'POST' });

/* ------------------------------------------------------------------ 4.3 */

export const syncChats = (accountId: number, body: { archived?: boolean; limit?: number } = {}) =>
  request<ChatSyncResult>(`/api/accounts/${accountId}/chats/sync`, { method: 'POST', body });

export const listChats = (accountId: number, params: ListChatsParams = {}) =>
  request<Paginated<Chat>>(`/api/accounts/${accountId}/chats${buildQuery({ ...params })}`);

export const getChat = (chatId: number) => request<Chat>(`/api/chats/${chatId}`);

export const getChatStats = (chatId: number) => request<ChatStats>(`/api/chats/${chatId}/stats`);

export const listMessages = (chatId: number, params: ListMessagesParams = {}) =>
  request<Paginated<MessageRow>>(`/api/chats/${chatId}/messages${buildQuery({ ...params })}`);

/* ------------------------------------------------------------------ 4.4 */

export const createJob = (body: CreateJobRequest) =>
  request<ExportJob>('/api/export/jobs', { method: 'POST', body });

export const listJobs = (params: ListJobsParams = {}) =>
  request<Paginated<ExportJob>>(`/api/export/jobs${buildQuery({ ...params })}`);

export const getJob = (id: number) => request<ExportJob>(`/api/export/jobs/${id}`);

export const cancelJob = (id: number) =>
  request<ExportJob>(`/api/export/jobs/${id}/cancel`, { method: 'POST' });

export const pauseJob = (id: number) =>
  request<ExportJob>(`/api/export/jobs/${id}/pause`, { method: 'POST' });

export const resumeJob = (id: number) =>
  request<ExportJob>(`/api/export/jobs/${id}/resume`, { method: 'POST' });

export const deleteJob = (id: number) =>
  request<OkResponse>(`/api/export/jobs/${id}`, { method: 'DELETE' });

export const getJobEvents = (id: number, params: { after_id?: number; limit?: number } = {}) =>
  request<JobEvent[]>(`/api/export/jobs/${id}/events${buildQuery({ ...params })}`);

export const rebuildJob = (id: number, body: RebuildJobRequest = {}) =>
  request<ExportJob>(`/api/export/jobs/${id}/rebuild`, { method: 'POST', body });

export const getJobManifest = (id: number) => request<ExportManifest>(`/api/export/jobs/${id}/manifest`);

/* ------------------------------------------------------------------ 4.5 */

export const listLogs = (params: ListLogsParams = {}) =>
  request<LogRow[]>(`/api/logs${buildQuery({ ...params })}`);

export const listLogFiles = () => request<LogFile[]>('/api/logs/files');

export const tailLogFile = (name: string, tail = 500) =>
  request<LogFileTail>(`/api/logs/files/${encodeURIComponent(name)}${buildQuery({ tail })}`);

export const openFolder = (path: string) =>
  request<OkResponse>('/api/system/open-folder', { method: 'POST', body: { path } });

/** Direct URLs — used as href/src, not fetched through the wrapper. */
export const fileDownloadUrl = (mediaId: number) => `${API_BASE}/api/files/download?media_id=${mediaId}`;
export const fileThumbUrl = (mediaId: number) => `${API_BASE}/api/files/thumb?media_id=${mediaId}`;
export const chatPhotoUrl = (path: string) => `${API_BASE}/api/files/photo?path=${encodeURIComponent(path)}`;

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return 'Неизвестная ошибка';
}
