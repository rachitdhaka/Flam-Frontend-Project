/**
 * All-in-one client bundle
 * Combined everything into this file because it's easier to deploy that way
 * - canvas drawing logic
 * - websocket stuff
 * - main app orchestration
 */

// Type definitions (keeping these for clarity)

interface DrawPoint {
  x: number;
  y: number;
}

interface DrawingOperation {
  id: string;
  userId: string;
  userName: string;
  type: 'draw' | 'erase';
  points: DrawPoint[];
  color: string;
  width: number;
  timestamp: number;
}

interface DrawingTool {
  type: 'brush' | 'eraser';
  color: string;
  width: number;
}

interface User {
  id: string;
  name: string;
  color: string;
  cursorX?: number;
  cursorY?: number;
}

interface WebSocketCallbacks {
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

// ===== Canvas Manager =====
// Handles all the drawing logic

class CanvasManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private isDrawing: boolean = false;
  private currentPoints: DrawPoint[] = [];
  private currentTool: DrawingTool;
  private operations: DrawingOperation[] = [];

  private lastRenderTime: number = 0;
  private frameRate: number = 60;
  private frameInterval: number = 1000 / this.frameRate;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', {
      willReadFrequently: false,
      alpha: false
    });

    if (!context) {
      throw new Error('Could not get canvas context');
    }

    this.ctx = context;
    this.currentTool = {
      type: 'brush',
      color: '#000000',
      width: 3
    };

    this.initializeCanvas();
  }

  private initializeCanvas(): void {
    this.resizeCanvas();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.imageSmoothingEnabled = true;
    this.clearCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private resizeCanvas(): void {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';

    this.ctx.scale(dpr, dpr);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    this.ctx.putImageData(imageData, 0, 0);
  }

  setTool(tool: Partial<DrawingTool>): void {
    this.currentTool = { ...this.currentTool, ...tool };
  }

  getTool(): DrawingTool {
    return { ...this.currentTool };
  }

  startDrawing(x: number, y: number): void {
    this.isDrawing = true;
    this.currentPoints = [{ x, y }];
  }

  continueDrawing(x: number, y: number): void {
    if (!this.isDrawing) return;
    this.currentPoints.push({ x, y });

    const now = Date.now();
    if (now - this.lastRenderTime >= this.frameInterval) {
      this.drawPath(this.currentPoints, this.currentTool.color, this.currentTool.width, this.currentTool.type === 'eraser');
      this.lastRenderTime = now;
    }
  }

  stopDrawing(userId: string, userName: string): DrawingOperation | null {
    if (!this.isDrawing || this.currentPoints.length === 0) {
      this.isDrawing = false;
      return null;
    }

    this.isDrawing = false;
    const optimizedPoints = this.optimizePath(this.currentPoints);

    const operation: DrawingOperation = {
      id: `${userId}-${Date.now()}-${Math.random()}`,
      userId,
      userName,
      type: this.currentTool.type === 'eraser' ? 'erase' : 'draw',
      points: optimizedPoints,
      color: this.currentTool.color,
      width: this.currentTool.width,
      timestamp: Date.now()
    };

    this.drawPath(optimizedPoints, operation.color, operation.width, operation.type === 'erase');
    this.operations.push(operation);
    this.currentPoints = [];

    return operation;
  }

  private optimizePath(points: DrawPoint[]): DrawPoint[] {
    if (points.length <= 2) return points;

    const optimized: DrawPoint[] = [points[0]];
    const tolerance = 2;

    for (let i = 1; i < points.length - 1; i++) {
      const prev = optimized[optimized.length - 1];
      const curr = points[i];
      const next = points[i + 1];

      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;

      const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (dist1 > tolerance || dist2 > tolerance) {
        optimized.push(curr);
      }
    }

    optimized.push(points[points.length - 1]);
    return optimized;
  }

  drawPath(points: DrawPoint[], color: string, width: number, isEraser: boolean = false): void {
    if (points.length === 0) return;

    this.ctx.save();

    if (isEraser) {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = color;
    }

    this.ctx.lineWidth = width;
    this.ctx.beginPath();

    if (points.length === 1) {
      const point = points[0];
      this.ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      this.ctx.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }

      const lastPoint = points[points.length - 1];
      const prevPoint = points[points.length - 2];
      this.ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, lastPoint.x, lastPoint.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  drawOperation(operation: DrawingOperation): void {
    this.drawPath(operation.points, operation.color, operation.width, operation.type === 'erase');
  }

  clearCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    this.operations = [];
  }

  redrawFromHistory(operations: DrawingOperation[]): void {
    this.clearCanvas();
    this.operations = operations;
    for (const operation of operations) {
      this.drawOperation(operation);
    }
  }

  getOperations(): DrawingOperation[] {
    return [...this.operations];
  }

  setOperations(operations: DrawingOperation[]): void {
    this.operations = operations;
  }

  addOperation(operation: DrawingOperation): void {
    this.operations.push(operation);
  }

  removeLastOperation(): DrawingOperation | undefined {
    return this.operations.pop();
  }
}

// ==================== WEBSOCKET MANAGER ====================

class WebSocketManager {
  private socket: any;
  private callbacks: WebSocketCallbacks = {};
  private connected: boolean = false;
  private roomId: string | null = null;
  private userId: string | null = null;
  private lastPingTime: number = 0;
  private latency: number = 0;
  private latencyCheckInterval: any = null;

  constructor(serverUrl: string = '') {
    // @ts-ignore
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    this.initializeSocketEvents();
  }

  private initializeSocketEvents(): void {
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

    this.socket.on('init-state', (data: any) => {
      console.log('Received initial state:', data);
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

    this.socket.on('error', (error: any) => {
      console.error('Socket error:', error);
      this.callbacks.onError?.(error);
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('Connection error:', error);
      this.callbacks.onError?.(error);
    });

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

  sendDrawOperation(operation: DrawingOperation): void {
    if (!this.connected) {
      console.warn('Not connected, cannot send operation');
      return;
    }
    this.socket.emit('draw-operation', operation);
  }

  sendCursorMove(x: number, y: number): void {
    if (!this.connected) return;
    this.socket.emit('cursor-move', { x, y });
  }

  sendUndo(): void {
    if (!this.connected) return;
    this.socket.emit('undo');
  }

  sendRedo(operation: DrawingOperation): void {
    if (!this.connected) return;
    this.socket.emit('redo', operation);
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

// ==================== MAIN APPLICATION ====================

class CollaborativeCanvas {
  private canvasManager!: CanvasManager;
  private cursorCanvasManager!: CanvasManager;
  private wsManager!: WebSocketManager;
  private currentUser: User | null = null;
  private users: Map<string, User> = new Map();
  private undoStack: DrawingOperation[] = [];
  private redoStack: DrawingOperation[] = [];
  private elements: { [key: string]: HTMLElement } = {};
  private fpsCounter: number = 0;
  private lastFpsUpdate: number = Date.now();
  private frameCount: number = 0;
  private lastCursorSend: number = 0;
  private cursorSendInterval: number = 50;

  constructor() {
    this.initializeElements();
    this.showJoinModal();
  }

  private initializeElements(): void {
    const elementIds = [
      'join-modal', 'username-input', 'room-input', 'join-btn',
      'app', 'current-room', 'current-user', 'main-canvas', 'cursor-canvas',
      'brush-tool', 'eraser-tool', 'color-picker', 'width-slider', 'width-value',
      'undo-btn', 'redo-btn', 'clear-btn',
      'users-list', 'user-count', 'fps-counter', 'latency-display'
    ];

    for (const id of elementIds) {
      const element = document.getElementById(id);
      if (element) {
        this.elements[id] = element;
      }
    }
  }

  private showJoinModal(): void {
    const joinBtn = this.elements['join-btn'] as HTMLButtonElement;
    const usernameInput = this.elements['username-input'] as HTMLInputElement;
    const roomInput = this.elements['room-input'] as HTMLInputElement;

    usernameInput.focus();
    joinBtn.addEventListener('click', () => this.joinRoom());
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });
    roomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });
  }

  private joinRoom(): void {
    const usernameInput = this.elements['username-input'] as HTMLInputElement;
    const roomInput = this.elements['room-input'] as HTMLInputElement;

    const username = usernameInput.value.trim();
    const roomId = roomInput.value.trim() || 'main';

    if (!username) {
      alert('Please enter your name');
      usernameInput.focus();
      return;
    }

    this.elements['join-modal'].style.display = 'none';
    this.elements['app'].style.display = 'flex';

    const mainCanvas = this.elements['main-canvas'] as HTMLCanvasElement;
    const cursorCanvas = this.elements['cursor-canvas'] as HTMLCanvasElement;
    this.canvasManager = new CanvasManager(mainCanvas);
    this.cursorCanvasManager = new CanvasManager(cursorCanvas);

    this.wsManager = new WebSocketManager();
    this.setupWebSocketCallbacks();
    this.wsManager.joinRoom(roomId, username);

    this.setupToolbar();
    this.setupCanvasEvents();
    this.setupKeyboardShortcuts();
    this.startPerformanceMonitoring();

    (this.elements['current-room'] as HTMLElement).textContent = roomId;
    (this.elements['current-user'] as HTMLElement).textContent = username;
  }

  private setupWebSocketCallbacks(): void {
    this.wsManager.setCallbacks({
      onInitState: (data) => {
        console.log('Initial state received:', data);
        this.currentUser = data.user;

        for (const operation of data.operations) {
          this.canvasManager.drawOperation(operation);
        }
        this.canvasManager.setOperations(data.operations);
        this.updateUsersList(data.users);
      },

      onUserJoined: (data) => {
        console.log('User joined:', data.user.name);
        this.updateUsersList(data.users);
        this.showNotification(`${data.user.name} joined`, data.user.color);
      },

      onUserLeft: (data) => {
        const user = this.users.get(data.userId);
        if (user) {
          this.showNotification(`${user.name} left`, user.color);
        }
        this.updateUsersList(data.users);
        this.users.delete(data.userId);
      },

      onDrawOperation: (operation) => {
        this.canvasManager.drawOperation(operation);
        this.canvasManager.addOperation(operation);
        this.clearRedoStack();
      },

      onCursorMove: (data) => {
        this.updateRemoteCursor(data.userId, data.x, data.y);
      },

      onUndo: (data) => {
        const operations = this.canvasManager.getOperations();
        const updatedOperations = operations.filter(op => op.id !== data.operationId);
        this.canvasManager.redrawFromHistory(updatedOperations);
        this.redoStack.push(data.operation);
        this.updateUndoRedoButtons();
      },

      onRedo: (operation) => {
        this.canvasManager.drawOperation(operation);
        this.canvasManager.addOperation(operation);
        this.redoStack = this.redoStack.filter(op => op.id !== operation.id);
        this.updateUndoRedoButtons();
      },

      onClearCanvas: () => {
        this.canvasManager.clearCanvas();
        this.clearUndoStack();
        this.clearRedoStack();
      },

      onConnect: () => {
        console.log('Connected to server');
      },

      onDisconnect: () => {
        console.log('Disconnected from server');
        this.showNotification('Disconnected from server', '#ff0000');
      }
    });
  }

  private setupToolbar(): void {
    this.elements['brush-tool'].addEventListener('click', () => this.selectTool('brush'));
    this.elements['eraser-tool'].addEventListener('click', () => this.selectTool('eraser'));

    const colorPicker = this.elements['color-picker'] as HTMLInputElement;
    colorPicker.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.canvasManager.setTool({ color: target.value });
    });

    const widthSlider = this.elements['width-slider'] as HTMLInputElement;
    const widthValue = this.elements['width-value'] as HTMLElement;
    widthSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const width = parseInt(target.value);
      widthValue.textContent = width.toString();
      this.canvasManager.setTool({ width });
    });

    this.elements['undo-btn'].addEventListener('click', () => this.undo());
    this.elements['redo-btn'].addEventListener('click', () => this.redo());
    this.elements['clear-btn'].addEventListener('click', () => {
      if (confirm('Clear the entire canvas? This affects all users.')) {
        this.wsManager.sendClearCanvas();
      }
    });
  }

  private selectTool(tool: 'brush' | 'eraser'): void {
    this.canvasManager.setTool({ type: tool });
    this.elements['brush-tool'].classList.toggle('active', tool === 'brush');
    this.elements['eraser-tool'].classList.toggle('active', tool === 'eraser');
  }

  private setupCanvasEvents(): void {
    const canvas = this.elements['main-canvas'] as HTMLCanvasElement;

    canvas.addEventListener('mousedown', (e) => this.handleDrawStart(e.offsetX, e.offsetY));
    canvas.addEventListener('mousemove', (e) => {
      this.handleDrawMove(e.offsetX, e.offsetY);
      this.handleCursorMove(e.offsetX, e.offsetY);
    });
    canvas.addEventListener('mouseup', () => this.handleDrawEnd());
    canvas.addEventListener('mouseleave', () => this.handleDrawEnd());

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      this.handleDrawStart(touch.clientX - rect.left, touch.clientY - rect.top);
    });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      this.handleDrawMove(x, y);
      this.handleCursorMove(x, y);
    });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleDrawEnd();
    });
  }

  private handleDrawStart(x: number, y: number): void {
    this.canvasManager.startDrawing(x, y);
  }

  private handleDrawMove(x: number, y: number): void {
    this.canvasManager.continueDrawing(x, y);
  }

  private handleDrawEnd(): void {
    if (!this.currentUser) return;

    const operation = this.canvasManager.stopDrawing(
      this.currentUser.id,
      this.currentUser.name
    );

    if (operation) {
      this.wsManager.sendDrawOperation(operation);
      this.clearRedoStack();
    }
  }

  private handleCursorMove(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursorSend < this.cursorSendInterval) return;
    this.lastCursorSend = now;
    this.wsManager.sendCursorMove(x, y);
  }

  private updateRemoteCursor(userId: string, x: number, y: number): void {
    const user = this.users.get(userId);
    if (!user) return;
    user.cursorX = x;
    user.cursorY = y;
    this.redrawCursors();
  }

  private redrawCursors(): void {
    const cursorCanvas = this.elements['cursor-canvas'] as HTMLCanvasElement;
    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    const rect = cursorCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    for (const user of this.users.values()) {
      if (user.id === this.currentUser?.id) continue;
      if (user.cursorX === undefined || user.cursorY === undefined) continue;

      ctx.fillStyle = user.color;
      ctx.beginPath();
      ctx.arc(user.cursorX, user.cursorY, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(user.cursorX + 12, user.cursorY + 12, ctx.measureText(user.name).width + 8, 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '12px sans-serif';
      ctx.fillText(user.name, user.cursorX + 16, user.cursorY + 26);
    }
  }

  private undo(): void {
    const operations = this.canvasManager.getOperations();
    if (operations.length === 0) return;
    this.wsManager.sendUndo();
    this.updateUndoRedoButtons();
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;
    const operation = this.redoStack[this.redoStack.length - 1];
    this.wsManager.sendRedo(operation);
    this.updateUndoRedoButtons();
  }

  private updateUndoRedoButtons(): void {
    const undoBtn = this.elements['undo-btn'] as HTMLButtonElement;
    const redoBtn = this.elements['redo-btn'] as HTMLButtonElement;
    undoBtn.disabled = this.canvasManager.getOperations().length === 0;
    redoBtn.disabled = this.redoStack.length === 0;
  }

  private clearUndoStack(): void {
    this.undoStack = [];
    this.updateUndoRedoButtons();
  }

  private clearRedoStack(): void {
    this.redoStack = [];
    this.updateUndoRedoButtons();
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        this.redo();
      }
      if (e.key === 'b' || e.key === 'B') {
        this.selectTool('brush');
      }
      if (e.key === 'e' || e.key === 'E') {
        this.selectTool('eraser');
      }
    });
  }

  private updateUsersList(users: User[]): void {
    this.users.clear();
    for (const user of users) {
      this.users.set(user.id, user);
    }

    const usersList = this.elements['users-list'] as HTMLUListElement;
    const userCount = this.elements['user-count'] as HTMLElement;

    usersList.innerHTML = '';
    userCount.textContent = users.length.toString();

    for (const user of users) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="user-color" style="background-color: ${user.color}"></div>
        <span class="user-name">${user.name}</span>
        ${user.id === this.currentUser?.id ? '<span style="font-size: 12px; color: #999;">(You)</span>' : ''}
        <div class="user-status"></div>
      `;
      usersList.appendChild(li);
    }
  }

  private startPerformanceMonitoring(): void {
    setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastFpsUpdate;
      if (elapsed >= 1000) {
        this.fpsCounter = Math.round((this.frameCount * 1000) / elapsed);
        this.frameCount = 0;
        this.lastFpsUpdate = now;

        const fpsElement = this.elements['fps-counter'];
        if (fpsElement) {
          fpsElement.textContent = `FPS: ${this.fpsCounter}`;
        }
      }
      this.frameCount++;

      const latency = this.wsManager.getLatency();
      const latencyElement = this.elements['latency-display'];
      if (latencyElement) {
        latencyElement.textContent = `Latency: ${latency}ms`;
      }

      this.redrawCursors();
    }, 16);
  }

  private showNotification(message: string, color: string): void {
    console.log(`%c${message}`, `color: ${color}; font-weight: bold;`);
  }
}

// ==================== INITIALIZE ====================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new CollaborativeCanvas();
  });
} else {
  new CollaborativeCanvas();
}
