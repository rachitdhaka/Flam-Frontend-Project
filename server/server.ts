// WebSocket server for collaborative drawing
// Handles connections, rooms, and broadcasting drawing operations

import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { RoomManager } from './rooms';
import { DrawingOperation } from './drawing-state';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Handle WebSocket connections
io.on('connection', (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

  let currentRoom: string | null = null;
  let currentUserId: string | null = null;

  // User joins a room
  socket.on('join-room', (data: { roomId: string; userName: string }) => {
    const { roomId, userName } = data;
    currentRoom = roomId;
    currentUserId = socket.id;

    socket.join(roomId);

    // Get or create room state
    const roomState = roomManager.getRoom(roomId);

    // Add user
    const user = roomState.addUser(socket.id, userName);

    console.log(`${userName} (${socket.id}) joined room ${roomId}`);

    // Send current state to the new user
    socket.emit('init-state', {
      userId: socket.id,
      user: user,
      operations: roomState.getAllOperations(),
      users: roomState.getUsers()
    });

    // Notify others
    socket.to(roomId).emit('user-joined', {
      user: user,
      users: roomState.getUsers()
    });
  });

  // Drawing operation
  socket.on('draw-operation', (op: DrawingOperation) => {
    if (!currentRoom) return;

    const roomState = roomManager.getRoom(currentRoom);

    roomState.addOperation(op);

    // Broadcast to others
    socket.to(currentRoom).emit('draw-operation', op);
  });

  // Cursor movement
  socket.on('cursor-move', (data: { x: number; y: number }) => {
    if (!currentRoom || !currentUserId) return;

    const roomState = roomManager.getRoom(currentRoom);
    roomState.updateUserCursor(currentUserId, data.x, data.y);

    // Broadcast cursor position
    socket.to(currentRoom).emit('cursor-move', {
      userId: currentUserId,
      x: data.x,
      y: data.y
    });
  });

  // Undo operation (global for all users)
  socket.on('undo', () => {
    if (!currentRoom) return;

    const roomState = roomManager.getRoom(currentRoom);
    const undoneOp = roomState.undoLastOperation();

    if (undoneOp) {
      // Broadcast to everyone including sender
      io.to(currentRoom).emit('undo', {
        operationId: undoneOp.id,
        operation: undoneOp
      });
    }
  });

  // Redo operation
  socket.on('redo', (op: DrawingOperation) => {
    if (!currentRoom) return;

    const roomState = roomManager.getRoom(currentRoom);
    roomState.redoOperation(op);

    io.to(currentRoom).emit('redo', op);
  });

  // Clear canvas
  socket.on('clear-canvas', () => {
    if (!currentRoom) return;

    const roomState = roomManager.getRoom(currentRoom);
    roomState.clearAll();

    io.to(currentRoom).emit('clear-canvas');
  });

  // User disconnects
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);

    if (currentRoom && currentUserId) {
      const roomState = roomManager.getRoom(currentRoom);
      roomState.removeUser(currentUserId);

      // Notify others
      socket.to(currentRoom).emit('user-left', {
        userId: currentUserId,
        users: roomState.getUsers()
      });

      // Clean up empty rooms
      roomManager.deleteRoomIfEmpty(currentRoom);
    }
  });

  socket.on('error', (err) => {
    console.error(`Socket error for ${socket.id}:`, err);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server');
  httpServer.close(() => {
    console.log('Server closed');
  });
});
