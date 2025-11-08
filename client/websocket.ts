// WebSocket client stuff
// Handles the real-time connection to the server

import { DrawingOperation } from './canvas.js';

export interface User {
  id: string;
  name: string;
  color: string;
  cursorX?: number;
  cursorY?: number;
}

export interface WebSocketCallbacks {
  onInitState?: (data: { userId: string; user: User; operations: DrawingOperation[]; users: User[] }) => void;
  onUserJoined?: (data: { user: User; users: User[] }) => void;
  onUserLeft?: (data: { userId: string; users: User[] }) => void;
  onDrawOperation?: (operation: DrawingOperation) => void;
  onCursorMove?: (data: { userId: string; x: number; y: number }) => void;
  onUndo?: (data: { operationId: string; operation: DrawingOperation }) => void;
  onRedo?: (operation: DrawingOperation) => void;
  onClearCanvas?: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: any) => void;
}

export class WebSocketManager {
  private socket: any; // socket.io socket
  private callbacks: WebSocketCallbacks = {};
  private connected = false;
  private roomId: string | null = null;
  private userId: string | null = null;

  // Track latency for the UI
  private lastPingTime = 0;
  private latency = 0;
  private latencyCheckInterval: any = null;

  constructor(serverUrl: string = '') {
    // @ts-ignore - socket.io loaded from CDN
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.connected = true;
      this.startLatencyCheck();
      this.callbacks.onConnect?.();
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.connected = false;
      this.stopLatencyCheck();
      this.callbacks.onDisconnect?.();
    });

    // Initial state when we join a room
    this.socket.on('init-state', (data: any) => {
      console.log('Got initial state:', data);
      this.userId = data.userId;
      this.callbacks.onInitState?.(data);
    });

    this.socket.on('user-joined', (data: any) => {
      console.log('User joined:', data);
      this.callbacks.onUserJoined?.(data);
    });

    this.socket.on('user-left', (data: any) => {
      console.log('User left:', data);
      this.callbacks.onUserLeft?.(data);
    });

    this.socket.on('draw-operation', (operation: DrawingOperation) => {
      this.callbacks.onDrawOperation?.(operation);
    });

    this.socket.on('cursor-move', (data: any) => {
      this.callbacks.onCursorMove?.(data);
    });

    this.socket.on('undo', (data: any) => {
      this.callbacks.onUndo?.(data);
    });

    this.socket.on('redo', (operation: DrawingOperation) => {
      this.callbacks.onRedo?.(operation);
    });

    this.socket.on('clear-canvas', () => {
      this.callbacks.onClearCanvas?.();
    });

    // Error handling
    this.socket.on('error', (error: any) => {
      console.error('Socket error:', error);
      this.callbacks.onError?.(error);
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('Connection error:', error);
      this.callbacks.onError?.(error);
    });

    // Latency ping/pong
    this.socket.on('pong', () => {
      this.latency = Date.now() - this.lastPingTime;
    });
  }

  setCallbacks(callbacks: WebSocketCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  joinRoom(roomId: string, userName: string): void {
    this.roomId = roomId;
    this.socket.emit('join-room', { roomId, userName });
  }

  sendDrawOperation(op: DrawingOperation): void {
    if (!this.connected) {
      console.warn('Not connected, can\'t send operation');
      return;
    }
    this.socket.emit('draw-operation', op);
  }

  sendCursorMove(x: number, y: number): void {
    if (!this.connected) return;
    this.socket.emit('cursor-move', { x, y });
  }

  sendUndo(): void {
    if (!this.connected) return;
    this.socket.emit('undo');
  }

  sendRedo(op: DrawingOperation): void {
    if (!this.connected) return;
    this.socket.emit('redo', op);
  }

  sendClearCanvas(): void {
    if (!this.connected) return;
    this.socket.emit('clear-canvas');
  }

  private startLatencyCheck(): void {
    this.latencyCheckInterval = setInterval(() => {
      this.lastPingTime = Date.now();
      this.socket.emit('ping');
    }, 2000);
  }

  private stopLatencyCheck(): void {
    if (this.latencyCheckInterval) {
      clearInterval(this.latencyCheckInterval);
      this.latencyCheckInterval = null;
    }
  }

  getLatency(): number {
    return this.latency;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getUserId(): string | null {
    return this.userId;
  }

  getRoomId(): string | null {
    return this.roomId;
  }

  disconnect(): void {
    this.stopLatencyCheck();
    this.socket.disconnect();
  }
}
