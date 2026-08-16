import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import * as api from '../api/client';
import type {
  Account,
  AccountStats,
  AuthState,
  Chat,
  ChatStats,
  ExportJob,
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
  Paginated,
} from '../api/types';

export const qk = {
  health: ['health'] as const,
  accounts: ['accounts'] as const,
  account: (id: number) => ['account', id] as const,
  accountStats: (id: number) => ['account-stats', id] as const,
  authState: (id: number) => ['auth-state', id] as const,
  chats: (accountId: number, params: ListChatsParams) => ['chats', accountId, params] as const,
  chat: (id: number) => ['chat', id] as const,
  chatStats: (id: number) => ['chat-stats', id] as const,
  messages: (chatId: number, params: ListMessagesParams) => ['messages', chatId, params] as const,
  jobs: (params: ListJobsParams) => ['jobs', params] as const,
  job: (id: number) => ['job', id] as const,
  jobEvents: (id: number) => ['job-events', id] as const,
  logs: (params: ListLogsParams) => ['logs', params] as const,
  logFiles: ['log-files'] as const,
  logFile: (name: string, tail: number) => ['log-file', name, tail] as const,
};

export function useHealth(): UseQueryResult<Health> {
  return useQuery({
    queryKey: qk.health,
    queryFn: api.getHealth,
    refetchInterval: 15000,
    retry: false,
  });
}

export function useAccounts(): UseQueryResult<Account[]> {
  return useQuery({ queryKey: qk.accounts, queryFn: api.listAccounts });
}

export function useAccount(id: number | null): UseQueryResult<Account> {
  return useQuery({
    queryKey: qk.account(id ?? 0),
    queryFn: () => api.getAccount(id as number),
    enabled: id !== null,
  });
}

export function useAccountStats(id: number | null): UseQueryResult<AccountStats> {
  return useQuery({
    queryKey: qk.accountStats(id ?? 0),
    queryFn: () => api.getAccountStats(id as number),
    enabled: id !== null,
  });
}

export function useAuthState(id: number | null, pollMs: number | false): UseQueryResult<AuthState> {
  return useQuery({
    queryKey: qk.authState(id ?? 0),
    queryFn: () => api.getAuthState(id as number),
    enabled: id !== null,
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useChats(accountId: number | null, params: ListChatsParams): UseQueryResult<Paginated<Chat>> {
  return useQuery({
    queryKey: qk.chats(accountId ?? 0, params),
    queryFn: () => api.listChats(accountId as number, params),
    enabled: accountId !== null,
    placeholderData: (previous) => previous,
  });
}

export function useChat(chatId: number | null): UseQueryResult<Chat> {
  return useQuery({
    queryKey: qk.chat(chatId ?? 0),
    queryFn: () => api.getChat(chatId as number),
    enabled: chatId !== null,
  });
}

export function useChatStats(chatId: number | null): UseQueryResult<ChatStats> {
  return useQuery({
    queryKey: qk.chatStats(chatId ?? 0),
    queryFn: () => api.getChatStats(chatId as number),
    enabled: chatId !== null,
  });
}

export function useMessages(
  chatId: number | null,
  params: ListMessagesParams,
): UseQueryResult<Paginated<MessageRow>> {
  return useQuery({
    queryKey: qk.messages(chatId ?? 0, params),
    queryFn: () => api.listMessages(chatId as number, params),
    enabled: chatId !== null,
    placeholderData: (previous) => previous,
  });
}

export function useJobs(params: ListJobsParams, pollMs: number | false = 2000): UseQueryResult<Paginated<ExportJob>> {
  return useQuery({
    queryKey: qk.jobs(params),
    queryFn: () => api.listJobs(params),
    refetchInterval: pollMs,
    placeholderData: (previous) => previous,
  });
}

export function useJobEvents(jobId: number | null, enabled: boolean): UseQueryResult<JobEvent[]> {
  return useQuery({
    queryKey: qk.jobEvents(jobId ?? 0),
    queryFn: () => api.getJobEvents(jobId as number, { limit: 300 }),
    enabled: jobId !== null && enabled,
  });
}

export function useLogs(params: ListLogsParams, pollMs: number | false): UseQueryResult<LogRow[]> {
  return useQuery({
    queryKey: qk.logs(params),
    queryFn: () => api.listLogs(params),
    refetchInterval: pollMs,
    placeholderData: (previous) => previous,
  });
}

export function useLogFiles(): UseQueryResult<LogFile[]> {
  return useQuery({ queryKey: qk.logFiles, queryFn: api.listLogFiles });
}

export function useLogFile(name: string | null, tail: number): UseQueryResult<LogFileTail> {
  return useQuery({
    queryKey: qk.logFile(name ?? '', tail),
    queryFn: () => api.tailLogFile(name as string, tail),
    enabled: !!name,
  });
}
