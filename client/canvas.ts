// Canvas drawing stuff
// Manages the actual drawing, optimizing paths, rendering everything

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawingOperation {
  id: string;
  userId: string;
  userName: string;
  type: 'draw' | 'erase';
  points: DrawPoint[];
  color: string;
  width: number;
  timestamp: number;
}

export interface DrawingTool {
  type: 'brush' | 'eraser';
  color: string;
  width: number;
}

export class CanvasManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private isDrawing = false;
  private currentPoints: DrawPoint[] = [];
  private currentTool: DrawingTool;
  private operations: DrawingOperation[] = [];

  // Throttle rendering so we don't kill performance
  private lastRenderTime = 0;
  private targetFPS = 60;
  private frameInterval = 1000 / this.targetFPS;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', {
      willReadFrequently: false,
      alpha: false  // we don't need transparency
    });

    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    this.ctx = ctx;
    this.currentTool = {
      type: 'brush',
      color: '#000000',
      width: 3
    };

    this.setupCanvas();
  }

  private setupCanvas(): void {
    this.resizeCanvas();

    // Make strokes look nice and smooth
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.imageSmoothingEnabled = true;

    this.clearCanvas();

    // TODO: might want to debounce this
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private resizeCanvas(): void {
    // Save what we have drawn so far
    const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';

    // Scale for retina displays
    this.ctx.scale(dpr, dpr);

    // Reapply settings after resize
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.imageSmoothingEnabled = true;

    // White background
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.fillRect(0, 0, rect.width, rect.height);

    // Restore previous drawing
    this.ctx.putImageData(imgData, 0, 0);
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

    // Throttle rendering - don't want to redraw on every single mousemove
    const now = Date.now();
    if (now - this.lastRenderTime >= this.frameInterval) {
      this.drawPath(
        this.currentPoints,
        this.currentTool.color,
        this.currentTool.width,
        this.currentTool.type === 'eraser'
      );
      this.lastRenderTime = now;
    }
  }

  stopDrawing(userId: string, userName: string): DrawingOperation | null {
    if (!this.isDrawing || this.currentPoints.length === 0) {
      this.isDrawing = false;
      return null;
    }

    this.isDrawing = false;

    // Clean up the path - remove unnecessary points
    const cleanedPoints = this.simplifyPath(this.currentPoints);

    const operation: DrawingOperation = {
      id: `${userId}-${Date.now()}-${Math.random()}`,
      userId,
      userName,
      type: this.currentTool.type === 'eraser' ? 'erase' : 'draw',
      points: cleanedPoints,
      color: this.currentTool.color,
      width: this.currentTool.width,
      timestamp: Date.now()
    };

    // Draw the final path
    this.drawPath(cleanedPoints, operation.color, operation.width, operation.type === 'erase');

    this.operations.push(operation);
    this.currentPoints = [];

    return operation;
  }

  // Simplify the path by removing redundant points
  // Using a simplified Douglas-Peucker-ish algorithm
  private simplifyPath(points: DrawPoint[]): DrawPoint[] {
    if (points.length <= 2) return points;

    const result: DrawPoint[] = [points[0]];
    const tolerance = 2; // pixels

    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const next = points[i + 1];

      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;

      const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      // Keep points that create significant angles or distances
      if (dist1 > tolerance || dist2 > tolerance) {
        result.push(curr);
      }
    }

    result.push(points[points.length - 1]);
    return result;
  }

  drawPath(points: DrawPoint[], color: string, width: number, isEraser = false): void {
    if (points.length === 0) return;

    this.ctx.save();

    if (isEraser) {
      // Eraser works by removing pixels
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = color;
    }

    this.ctx.lineWidth = width;
    this.ctx.beginPath();

    if (points.length === 1) {
      // Single click - just draw a dot
      const pt = points[0];
      this.ctx.arc(pt.x, pt.y, width / 2, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      // Draw smooth curves through the points
      this.ctx.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }

      // Last segment
      const lastPt = points[points.length - 1];
      const prevPt = points[points.length - 2];
      this.ctx.quadraticCurveTo(prevPt.x, prevPt.y, lastPt.x, lastPt.y);

      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  drawOperation(op: DrawingOperation): void {
    this.drawPath(op.points, op.color, op.width, op.type === 'erase');
  }

  clearCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    this.operations = [];
  }

  // Redraw everything from history
  redrawFromHistory(ops: DrawingOperation[]): void {
    this.clearCanvas();
    this.operations = ops;

    for (const op of ops) {
      this.drawOperation(op);
    }
  }

  getOperations(): DrawingOperation[] {
    return [...this.operations];
  }

  setOperations(ops: DrawingOperation[]): void {
    this.operations = ops;
  }

  addOperation(op: DrawingOperation): void {
    this.operations.push(op);
  }

  removeLastOperation(): DrawingOperation | undefined {
    return this.operations.pop();
  }

  getDimensions(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  // Convert to relative coords (0-1 range) - not using this yet but might be useful
  toRelativeCoords(x: number, y: number): DrawPoint {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: x / rect.width,
      y: y / rect.height
    };
  }

  toCanvasCoords(x: number, y: number): DrawPoint {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: x * rect.width,
      y: y * rect.height
    };
  }
}
