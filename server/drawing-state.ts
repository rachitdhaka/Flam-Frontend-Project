// Drawing state manager
// Keeps track of operations, users, and cursor positions for each room

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

export interface User {
  id: string;
  name: string;
  color: string;
  cursorX?: number;
  cursorY?: number;
}

export class DrawingState {
  private operations: DrawingOperation[] = [];
  private users: Map<string, User> = new Map();

  // Assign colors to users as they join
  private userColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
  ];
  private colorIdx = 0;

  addUser(userId: string, userName: string): User {
    const color = this.userColors[this.colorIdx % this.userColors.length];
    this.colorIdx++;

    const user: User = {
      id: userId,
      name: userName,
      color: color
    };

    this.users.set(userId, user);
    return user;
  }

  removeUser(userId: string): void {
    this.users.delete(userId);
  }

  getUsers(): User[] {
    return Array.from(this.users.values());
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  updateUserCursor(userId: string, x: number, y: number): void {
    const user = this.users.get(userId);
    if (user) {
      user.cursorX = x;
      user.cursorY = y;
    }
  }

  addOperation(op: DrawingOperation): void {
    this.operations.push(op);
  }

  getAllOperations(): DrawingOperation[] {
    return [...this.operations];
  }

  // Undo - returns the operation that was removed
  undoLastOperation(): DrawingOperation | null {
    if (this.operations.length === 0) {
      return null;
    }
    return this.operations.pop() || null;
  }

  redoOperation(op: DrawingOperation): void {
    this.operations.push(op);
  }

  clearAll(): void {
    this.operations = [];
  }

  getOperationCount(): number {
    return this.operations.length;
  }
}
