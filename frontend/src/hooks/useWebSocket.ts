import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { WsMessage, WsMessageType, WsPayloadOf } from '../api/types';

export type WsStatus = 'connecting' | 'open' | 'closed';

type AnyHandler = (message: WsMessage) => void;

const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 30000;
const PING_INTERVAL = 25000;

function wsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** One shared WebSocket for the whole app, with exponential-backoff reconnect. */
class WsClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<WsMessageType, Set<AnyHandler>>();
  private statusListeners = new Set<() => void>();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private attempt = 0;
  private started = false;

  status: WsStatus = 'closed';
  lastConnectedAt: number | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
    window.addEventListener('online', this.handleOnline);
  }

  stop(): void {
    this.started = false;
    window.removeEventListener('online', this.handleOnline);
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  private handleOnline = () => {
    if (this.status !== 'open') {
      this.attempt = 0;
      this.connect();
    }
  };

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener());
  }

  private connect(): void {
    if (!this.started) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.lastConnectedAt = Date.now();
      this.setStatus('open');
      this.pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, PING_INTERVAL);
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: WsMessage;
      try {
        message = JSON.parse(event.data) as WsMessage;
      } catch {
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      this.handlers.get(message.type)?.forEach((handler) => {
        try {
          handler(message);
        } catch (err) {
          console.error('[ws] handler failed', err);
        }
      });
    };

    socket.onerror = () => {
      /* onclose follows */
    };

    socket.onclose = () => {
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.socket = null;
      this.setStatus('closed');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer !== null) return;
    const delay = Math.min(MAX_BACKOFF, MIN_BACKOFF * Math.pow(2, this.attempt));
    this.attempt = Math.min(this.attempt + 1, 6);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Force an immediate reconnect attempt (used by the "reconnect" affordance). */
  reconnectNow(): void {
    this.clearTimers();
    this.attempt = 0;
    this.socket?.close();
    this.socket = null;
    this.connect();
  }

  subscribe<T extends WsMessageType>(type: T, handler: (message: WsPayloadOf<T>) => void): () => void {
    const wrapped = handler as AnyHandler;
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(wrapped);
    return () => {
      this.handlers.get(type)?.delete(wrapped);
    };
  }

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  getStatus = (): WsStatus => this.status;
}

export const wsClient = new WsClient();

/** Live connection status for the top bar dot. */
export function useWsStatus(): WsStatus {
  return useSyncExternalStore(wsClient.subscribeStatus, wsClient.getStatus, () => 'closed' as WsStatus);
}

/** Typed subscription to a single WS message type; handler identity may change freely. */
export function useWsSubscribe<T extends WsMessageType>(
  type: T,
  handler: (message: WsPayloadOf<T>) => void,
  enabled = true,
): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return wsClient.subscribe(type, (message) => ref.current(message));
  }, [type, enabled]);
}

/** Mount once at the app root. */
export function useWebSocket(): WsStatus {
  useEffect(() => {
    wsClient.start();
  }, []);
  return useWsStatus();
}
