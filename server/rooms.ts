// Room manager
// Handles multiple drawing rooms/sessions

import { DrawingState } from './drawing-state';

export class RoomManager {
  private rooms: Map<string, DrawingState> = new Map();

  // Get existing room or create new one
  getRoom(roomId: string): DrawingState {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new DrawingState());
    }
    return this.rooms.get(roomId)!;
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  // Delete room if it's empty (no users)
  deleteRoomIfEmpty(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room && room.getUsers().length === 0) {
      this.rooms.delete(roomId);
      return true;
    }
    return false;
  }

  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  getRoomCount(): number {
    return this.rooms.size;
  }
}
