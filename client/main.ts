// Main app entry point
// Ties everything together - canvas, websockets, UI

import { CanvasManager, DrawingOperation } from './canvas.js';
import { WebSocketManager, User } from './websocket.js';

class CollaborativeCanvas {
  private canvasManager!: CanvasManager;
  private cursorCanvasManager!: CanvasManager;  // separate canvas for cursors
  private wsManager!: WebSocketManager;
  private currentUser: User | null = null;
  private users: Map<string, User> = new Map();

  // Undo/redo stacks
  private undoStack: DrawingOperation[] = [];
  private redoStack: DrawingOperation[] = [];

  // Cache DOM elements so we're not constantly querying
  private elements: { [key: string]: HTMLElement } = {};

  // FPS counter for debugging
  private fpsCounter = 0;
  private lastFpsUpdate = Date.now();
  private frameCount = 0;

  // Throttle cursor updates
  private lastCursorSend = 0;
  private cursorSendInterval = 50; // ms

  constructor() {
    this.cacheElements();
    this.showJoinModal();
  }

  private cacheElements(): void {
    const ids = [
      'join-modal', 'username-input', 'room-input', 'join-btn',
      'app', 'current-room', 'current-user', 'main-canvas', 'cursor-canvas',
      'brush-tool', 'eraser-tool', 'color-picker', 'width-slider', 'width-value',
      'undo-btn', 'redo-btn', 'clear-btn',
      'users-list', 'user-count', 'fps-counter', 'latency-display'
    ];

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        this.elements[id] = el;
      }
    }
  }

  private showJoinModal(): void {
    const joinBtn = this.elements['join-btn'] as HTMLButtonElement;
    const usernameInput = this.elements['username-input'] as HTMLInputElement;
    const roomInput = this.elements['room-input'] as HTMLInputElement;

    usernameInput.focus();

    joinBtn.addEventListener('click', () => this.joinRoom());

    // Enter key to join
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

    // Hide modal, show app
    this.elements['join-modal'].style.display = 'none';
    this.elements['app'].style.display = 'flex';

    // Setup canvases
    const mainCanvas = this.elements['main-canvas'] as HTMLCanvasElement;
    const cursorCanvas = this.elements['cursor-canvas'] as HTMLCanvasElement;
    this.canvasManager = new CanvasManager(mainCanvas);
    this.cursorCanvasManager = new CanvasManager(cursorCanvas);

    // Setup websocket
    this.wsManager = new WebSocketManager();
    this.setupWebSocketCallbacks();
    this.wsManager.joinRoom(roomId, username);

    // Wire up the UI
    this.setupToolbar();
    this.setupCanvasEvents();
    this.setupKeyboardShortcuts();
    this.startPerfMonitoring();

    // Update room display
    (this.elements['current-room'] as HTMLElement).textContent = roomId;
    (this.elements['current-user'] as HTMLElement).textContent = username;
  }

  private setupWebSocketCallbacks(): void {
    this.wsManager.setCallbacks({
      onInitState: (data) => {
        console.log('Got initial state:', data);
        this.currentUser = data.user;

        // Draw existing stuff
        for (const op of data.operations) {
          this.canvasManager.drawOperation(op);
        }
        this.canvasManager.setOperations(data.operations);

        this.updateUsersList(data.users);
      },

      onUserJoined: (data) => {
        console.log(`${data.user.name} joined`);
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

      onDrawOperation: (op) => {
        // Someone else drew something
        this.canvasManager.drawOperation(op);
        this.canvasManager.addOperation(op);
        this.clearRedoStack();
      },

      onCursorMove: (data) => {
        this.updateRemoteCursor(data.userId, data.x, data.y);
      },

      onUndo: (data) => {
        // Global undo - redraw without the undone operation
        const ops = this.canvasManager.getOperations();
        const updated = ops.filter(op => op.id !== data.operationId);
        this.canvasManager.redrawFromHistory(updated);

        this.redoStack.push(data.operation);
        this.updateUndoRedoButtons();
      },

      onRedo: (op) => {
        // Global redo
        this.canvasManager.drawOperation(op);
        this.canvasManager.addOperation(op);

        this.redoStack = this.redoStack.filter(o => o.id !== op.id);
        this.updateUndoRedoButtons();
      },

      onClearCanvas: () => {
        this.canvasManager.clearCanvas();
        this.clearUndoStack();
        this.clearRedoStack();
      },

      onConnect: () => {
        console.log('Connected');
      },

      onDisconnect: () => {
        console.log('Disconnected');
        this.showNotification('Disconnected from server', '#ff0000');
      }
    });
  }

  private setupToolbar(): void {
    // Tool buttons
    this.elements['brush-tool'].addEventListener('click', () => {
      this.selectTool('brush');
    });

    this.elements['eraser-tool'].addEventListener('click', () => {
      this.selectTool('eraser');
    });

    // Color picker
    const colorPicker = this.elements['color-picker'] as HTMLInputElement;
    colorPicker.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.canvasManager.setTool({ color: target.value });
    });

    // Width slider
    const widthSlider = this.elements['width-slider'] as HTMLInputElement;
    const widthValue = this.elements['width-value'] as HTMLElement;
    widthSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const w = parseInt(target.value);
      widthValue.textContent = w.toString();
      this.canvasManager.setTool({ width: w });
    });

    // Action buttons
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

    // Update active state
    this.elements['brush-tool'].classList.toggle('active', tool === 'brush');
    this.elements['eraser-tool'].classList.toggle('active', tool === 'eraser');
  }

  private setupCanvasEvents(): void {
    const canvas = this.elements['main-canvas'] as HTMLCanvasElement;

    // Mouse events
    canvas.addEventListener('mousedown', (e) => this.startDrawing(e.offsetX, e.offsetY));
    canvas.addEventListener('mousemove', (e) => {
      this.continueDrawing(e.offsetX, e.offsetY);
      this.sendCursor(e.offsetX, e.offsetY);
    });
    canvas.addEventListener('mouseup', () => this.stopDrawing());
    canvas.addEventListener('mouseleave', () => this.stopDrawing());

    // Touch support for mobile
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      this.startDrawing(touch.clientX - rect.left, touch.clientY - rect.top);
    });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      this.continueDrawing(x, y);
      this.sendCursor(x, y);
    });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.stopDrawing();
    });
  }

  private startDrawing(x: number, y: number): void {
    this.canvasManager.startDrawing(x, y);
  }

  private continueDrawing(x: number, y: number): void {
    this.canvasManager.continueDrawing(x, y);
  }

  private stopDrawing(): void {
    if (!this.currentUser) return;

    const op = this.canvasManager.stopDrawing(
      this.currentUser.id,
      this.currentUser.name
    );

    if (op) {
      this.wsManager.sendDrawOperation(op);
      this.clearRedoStack();
    }
  }

  // Throttle cursor updates so we don't spam the server
  private sendCursor(x: number, y: number): void {
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

    // Draw each remote user's cursor
    for (const user of this.users.values()) {
      if (user.id === this.currentUser?.id) continue;
      if (user.cursorX === undefined || user.cursorY === undefined) continue;

      // Cursor dot
      ctx.fillStyle = user.color;
      ctx.beginPath();
      ctx.arc(user.cursorX, user.cursorY, 6, 0, Math.PI * 2);
      ctx.fill();

      // White border
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Name label
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(user.cursorX + 12, user.cursorY + 12, ctx.measureText(user.name).width + 8, 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '12px sans-serif';
      ctx.fillText(user.name, user.cursorX + 16, user.cursorY + 26);
    }
  }

  private undo(): void {
    const ops = this.canvasManager.getOperations();
    if (ops.length === 0) return;

    this.wsManager.sendUndo();
    this.updateUndoRedoButtons();
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;

    const op = this.redoStack[this.redoStack.length - 1];
    this.wsManager.sendRedo(op);
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
      // Undo: Ctrl/Cmd + Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }

      // Redo: Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        this.redo();
      }

      // B key = Brush
      if (e.key === 'b' || e.key === 'B') {
        this.selectTool('brush');
      }

      // E key = Eraser
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

  // Performance monitoring for debugging
  private startPerfMonitoring(): void {
    setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastFpsUpdate;

      if (elapsed >= 1000) {
        this.fpsCounter = Math.round((this.frameCount * 1000) / elapsed);
        this.frameCount = 0;
        this.lastFpsUpdate = now;

        const fpsEl = this.elements['fps-counter'];
        if (fpsEl) {
          fpsEl.textContent = `FPS: ${this.fpsCounter}`;
        }
      }
      this.frameCount++;

      // Update latency display
      const latency = this.wsManager.getLatency();
      const latencyEl = this.elements['latency-display'];
      if (latencyEl) {
        latencyEl.textContent = `Latency: ${latency}ms`;
      }

      // Redraw cursors
      this.redrawCursors();
    }, 16); // ~60 FPS
  }

  private showNotification(msg: string, color: string): void {
    // Simple console notification for now
    // TODO: maybe add a toast notification UI later
    console.log(`%c${msg}`, `color: ${color}; font-weight: bold;`);
  }
}

// Init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new CollaborativeCanvas();
  });
} else {
  new CollaborativeCanvas();
}
