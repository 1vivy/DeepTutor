import type { ClientCommand, ServerEvent, StreamEvent } from "@/contracts/generated/turn-protocol";
import { buildPing, buildResumeTurn } from "@/contracts/parse/turn-command";
import { parseTurnEvent } from "@/contracts/parse/turn-event";

import {
  browserSocketFactory,
  SOCKET_CONNECTING,
  SOCKET_OPEN,
  type TurnSocket,
  type TurnSocketFactory,
} from "./socket";
import { reconnectDelay, shouldReconnect } from "./reconnect-policy";

export type RuntimeConnectionState = "idle" | "connecting" | "connected" | "recovering" | "stopped";

export interface RuntimeScheduler {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TurnRuntimeClientOptions {
  url?: string;
  socketFactory?: TurnSocketFactory;
  scheduler?: RuntimeScheduler;
  random?: () => number;
  maxBufferedGap?: number;
  onEvent: (event: ServerEvent) => void;
  onStateChange?: (state: RuntimeConnectionState) => void;
  onDiagnostic?: (diagnostic: string) => void;
  onReconcile?: (cursor: { turnId: string; afterSeq: number }) => void;
}

interface PendingCommand {
  command: ClientCommand;
  acknowledgedAfter: number;
  sentGeneration: number;
}

const defaultScheduler: RuntimeScheduler = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class TurnRuntimeClient {
  private readonly options: Required<
    Pick<TurnRuntimeClientOptions, "url" | "socketFactory" | "scheduler" | "random" | "maxBufferedGap">
  > &
    Omit<
      TurnRuntimeClientOptions,
      "url" | "socketFactory" | "scheduler" | "random" | "maxBufferedGap"
    >;
  private socket: TurnSocket | null = null;
  private reconnectHandle: unknown = null;
  private reconnectAttempt = 0;
  private generation = 0;
  private stopped = false;
  private pageVisible = true;
  private turnId: string | null = null;
  private lastSeq = 0;
  private buffered = new Map<number, StreamEvent>();
  private pending: PendingCommand[] = [];
  private connectionState: RuntimeConnectionState = "idle";

  constructor(options: TurnRuntimeClientOptions) {
    this.options = {
      url: "/api/v1/ws",
      socketFactory: browserSocketFactory,
      scheduler: defaultScheduler,
      random: Math.random,
      maxBufferedGap: 32,
      ...options,
    };
  }

  get state(): RuntimeConnectionState {
    return this.connectionState;
  }

  get cursor(): { turnId: string | null; afterSeq: number } {
    return { turnId: this.turnId, afterSeq: this.lastSeq };
  }

  connect(): void {
    if (this.stopped) this.stopped = false;
    if (this.socket && this.socket.readyState <= SOCKET_OPEN) return;
    this.clearReconnect();
    this.setState(this.turnId ? "recovering" : "connecting");
    const socket = this.options.socketFactory(this.options.url);
    this.socket = socket;

    socket.addEventListener("open", () => this.handleOpen(socket));
    socket.addEventListener("message", (event) => this.handleMessage(socket, event.data));
    socket.addEventListener("close", () => this.handleClose(socket));
    socket.addEventListener("error", () => {
      if (socket === this.socket) this.options.onDiagnostic?.("turn socket error; awaiting close");
    });
  }

  setResumeCursor(turnId: string | null, afterSeq: number): void {
    if (!Number.isInteger(afterSeq) || afterSeq < 0) throw new TypeError("afterSeq is invalid");
    this.turnId = turnId?.trim() || null;
    this.lastSeq = afterSeq;
    this.buffered.clear();
  }

  setPageVisible(visible: boolean): void {
    this.pageVisible = visible;
    if (visible && !this.stopped && !this.socket) this.manualRetry();
  }

  send(command: ClientCommand, options: { durable?: boolean } = {}): void {
    const durable = options.durable ?? command.type !== "ping";
    if (!durable) {
      this.sendNow(command);
      return;
    }
    const pending: PendingCommand = {
      command,
      acknowledgedAfter: this.lastSeq,
      sentGeneration: -1,
    };
    this.pending.push(pending);
    this.flushPending();
  }

  cancel(command: ClientCommand): void {
    this.send(command);
  }

  ping(): void {
    this.send(buildPing(), { durable: false });
  }

  manualRetry(): void {
    if (this.stopped) return;
    this.reconnectAttempt = 0;
    if (this.socket?.readyState === SOCKET_CONNECTING) return;
    this.socket?.close();
    this.socket = null;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "client stopped");
    this.pending = [];
    this.buffered.clear();
    this.setState("stopped");
  }

  private handleOpen(socket: TurnSocket): void {
    if (socket !== this.socket || this.stopped) return;
    this.generation += 1;
    this.reconnectAttempt = 0;
    this.setState("connected");
    if (this.turnId) {
      this.sendNow(buildResumeTurn({ turnId: this.turnId, afterSeq: this.lastSeq }));
    }
    this.flushPending();
  }

  private handleMessage(socket: TurnSocket, raw: unknown): void {
    if (socket !== this.socket || this.stopped) return;
    const parsed = parseTurnEvent(raw);
    if (!parsed.ok) {
      if (parsed.reason !== "heartbeat") this.options.onDiagnostic?.(parsed.diagnostic);
      return;
    }
    const event = parsed.value;
    if (event.type === "active_turn_info") {
      if (event.turn_id) this.turnId = event.turn_id;
      this.options.onEvent(event);
      return;
    }
    if (event.type === "pong") return;
    this.acceptStreamEvent(event as StreamEvent);
  }

  private acceptStreamEvent(event: StreamEvent): void {
    const seq = event.seq ?? 0;
    if (event.turn_id) this.turnId = event.turn_id;
    if (seq <= this.lastSeq) return;
    const gap = seq - this.lastSeq;
    if (gap > 1) {
      if (gap <= this.options.maxBufferedGap) {
        this.buffered.set(seq, event);
      } else if (this.turnId) {
        this.options.onDiagnostic?.(`turn event gap exceeded buffer; after_seq=${this.lastSeq}`);
        this.options.onReconcile?.({ turnId: this.turnId, afterSeq: this.lastSeq });
      }
      return;
    }

    this.emitInOrder(event);
    let next = this.buffered.get(this.lastSeq + 1);
    while (next) {
      this.buffered.delete(this.lastSeq + 1);
      this.emitInOrder(next);
      next = this.buffered.get(this.lastSeq + 1);
    }
  }

  private emitInOrder(event: StreamEvent): void {
    this.lastSeq = event.seq ?? this.lastSeq;
    this.pending = this.pending.filter((item) => this.lastSeq <= item.acknowledgedAfter);
    this.options.onEvent(event);
  }

  private handleClose(socket: TurnSocket): void {
    if (socket !== this.socket) return;
    this.socket = null;
    if (this.stopped) return;
    this.setState(this.turnId ? "recovering" : "connecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (
      !shouldReconnect({
        attempt: this.reconnectAttempt,
        activeTurnId: this.turnId,
        pageVisible: this.pageVisible,
      })
    ) {
      this.setState("idle");
      return;
    }
    const delay = reconnectDelay(this.reconnectAttempt, this.options.random);
    this.reconnectAttempt += 1;
    this.reconnectHandle = this.options.scheduler.setTimeout(() => {
      this.reconnectHandle = null;
      this.connect();
    }, delay);
  }

  private flushPending(): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;
    for (const pending of this.pending) {
      if (pending.sentGeneration === this.generation) continue;
      this.sendNow(pending.command);
      pending.sentGeneration = this.generation;
    }
  }

  private sendNow(command: ClientCommand): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;
    this.socket.send(JSON.stringify(command));
  }

  private clearReconnect(): void {
    if (this.reconnectHandle === null) return;
    this.options.scheduler.clearTimeout(this.reconnectHandle);
    this.reconnectHandle = null;
  }

  private setState(state: RuntimeConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.options.onStateChange?.(state);
  }
}
