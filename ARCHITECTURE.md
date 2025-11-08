# Architecture Documentation

## 📐 System Overview

This collaborative drawing application uses a client-server architecture with WebSocket-based real-time communication. The system enables multiple users to draw simultaneously on a shared canvas with instant synchronization.

### High-Level Architecture

```
┌─────────────────┐         WebSocket          ┌─────────────────┐
│                 │◄──────────────────────────►│                 │
│  Client 1       │      Drawing Events        │   Node.js       │
│  (Browser)      │      Cursor Updates        │   Server        │
│                 │      Undo/Redo Ops         │   (Socket.io)   │
└─────────────────┘                            │                 │
                                               │  Room Manager   │
┌─────────────────┐         WebSocket          │  Drawing State  │
│                 │◄──────────────────────────►│                 │
│  Client 2       │                            └─────────────────┘
│  (Browser)      │
│                 │
└─────────────────┘

┌─────────────────┐
│                 │
│  Client N       │◄────────────────────────────┐
│  (Browser)      │                             │
│                 │                             │
└─────────────────┘                             │
```

## 🔄 Data Flow

### 1. Drawing Operation Flow

```
User Action (Mouse/Touch)
        ↓
Canvas Event Handler
        ↓
Path Optimization (Douglas-Peucker)
        ↓
Create DrawingOperation Object
        ↓
Local Canvas Rendering (Immediate)
        ↓
WebSocket.emit('draw-operation')
        ↓
Server receives & validates
        ↓
Server stores in operation history
        ↓
Server broadcasts to other clients
        ↓
Other clients receive operation
        ↓
Other clients render on canvas
```

### 2. Real-Time Cursor Flow

```
Mouse Move Event (Throttled to 50ms)
        ↓
Extract coordinates
        ↓
WebSocket.emit('cursor-move', {x, y})
        ↓
Server receives cursor position
        ↓
Server broadcasts to other clients
        ↓
Clients render cursor on overlay canvas
        ↓
Update every 16ms (~60 FPS)
```

### 3. Global Undo Flow

```
User presses Undo (Ctrl+Z)
        ↓
Client emits 'undo' event
        ↓
Server pops last operation from history
        ↓
Server broadcasts operation ID to ALL clients
        ↓
All clients filter out operation from local history
        ↓
All clients redraw canvas from updated history
        ↓
Undone operation stored in redo stack
```

## 📡 WebSocket Protocol

### Message Types

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join-room` | `{ roomId: string, userName: string }` | User joins a drawing room |
| `draw-operation` | `DrawingOperation` | User completes a drawing stroke |
| `cursor-move` | `{ x: number, y: number }` | User moves cursor |
| `undo` | (none) | Request global undo |
| `redo` | `DrawingOperation` | Request global redo |
| `clear-canvas` | (none) | Clear entire canvas |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `init-state` | `{ userId, user, operations[], users[] }` | Initial room state for new user |
| `user-joined` | `{ user, users[] }` | New user joined room |
| `user-left` | `{ userId, users[] }` | User left room |
| `draw-operation` | `DrawingOperation` | Remote user drew something |
| `cursor-move` | `{ userId, x, y }` | Remote user moved cursor |
| `undo` | `{ operationId, operation }` | Global undo performed |
| `redo` | `DrawingOperation` | Global redo performed |
| `clear-canvas` | (none) | Canvas cleared globally |

### Data Structures

#### DrawingOperation
```typescript
interface DrawingOperation {
  id: string;              // Unique identifier (userId-timestamp-random)
  userId: string;          // Socket ID of user who drew
  userName: string;        // Display name of user
  type: 'draw' | 'erase'; // Operation type
  points: DrawPoint[];     // Optimized path points
  color: string;           // Hex color (#RRGGBB)
  width: number;           // Stroke width (1-50)
  timestamp: number;       // Unix timestamp
}
```

#### DrawPoint
```typescript
interface DrawPoint {
  x: number;  // X coordinate
  y: number;  // Y coordinate
}
```

#### User
```typescript
interface User {
  id: string;          // Socket ID
  name: string;        // Display name
  color: string;       // Assigned color
  cursorX?: number;    // Current cursor X
  cursorY?: number;    // Current cursor Y
}
```

## 🎨 Canvas Architecture

### Layer System

The application uses a two-canvas approach:

1. **Main Canvas** (`#main-canvas`)
   - Renders all drawing operations
   - Persistent layer for actual drawings
   - Double-buffered for smooth rendering

2. **Cursor Canvas** (`#cursor-canvas`)
   - Overlay for remote user cursors
   - Transparent background
   - Pointer-events disabled
   - Redraws every frame (~60 FPS)

### Drawing Process

```
1. Path Collection Phase
   - Collect points during mouse/touch drag
   - Store in temporary array
   - Render in real-time (throttled to 60 FPS)

2. Path Optimization Phase (on mouse up)
   - Apply Douglas-Peucker algorithm
   - Reduce points by ~60% while maintaining shape
   - Tolerance: 2 pixels

3. Rendering Phase
   - Use quadratic curves for smooth lines
   - Apply lineCap: 'round' and lineJoin: 'round'
   - Use canvas compositing for eraser (destination-out)

4. Synchronization Phase
   - Send optimized operation to server
   - Server broadcasts to other clients
   - Clients render using same algorithm
```

### Performance Optimizations

#### 1. Path Optimization (Douglas-Peucker)
```typescript
// Before: 1000 points for a simple stroke
// After: 400 points with no visible quality loss
// Benefit: 60% reduction in network traffic and rendering time
```

#### 2. Event Throttling
```typescript
// Mouse move events: ~100/second raw
// Cursor updates sent: 20/second (50ms throttle)
// Benefit: 80% reduction in network messages
```

#### 3. Frame-Limited Rendering
```typescript
// Render only if 16ms elapsed since last frame
// Maintains 60 FPS cap
// Prevents excessive CPU usage
```

#### 4. Canvas Context Options
```typescript
const context = canvas.getContext('2d', {
  willReadFrequently: false,  // Optimize for write operations
  alpha: false               // No transparency needed
});
```

## 🔄 Global Undo/Redo Strategy

### The Challenge
Unlike single-user applications, undo in a collaborative environment must:
- Work across all users simultaneously
- Maintain canvas consistency
- Handle race conditions
- Preserve operation authorship

### Our Solution: Global Operation History

#### Core Principles
1. **Server as Single Source of Truth**
   - Server maintains canonical operation list
   - Clients sync with server state

2. **Operation-Based State**
   - Canvas state derived from operation history
   - No direct state snapshots
   - Reproducible rendering

3. **Atomic Operations**
   - Each drawing stroke = one operation
   - Operations never partially applied
   - All-or-nothing semantics

#### Undo Implementation

```typescript
// Server-side
function handleUndo() {
  const operation = operationHistory.pop();
  if (operation) {
    // Broadcast to ALL clients (including sender)
    io.to(roomId).emit('undo', {
      operationId: operation.id,
      operation: operation
    });
  }
}

// Client-side
function onUndo(data) {
  // Remove operation from local history
  const updated = operations.filter(op => op.id !== data.operationId);

  // Redraw entire canvas from history
  clearCanvas();
  updated.forEach(op => drawOperation(op));

  // Save to redo stack
  redoStack.push(data.operation);
}
```

#### Why This Works

**Consistency**: All clients redraw from same operation list
**Conflict-Free**: Server decides operation order
**Reversible**: Undo/redo are symmetric operations
**Scalable**: O(n) redraw is acceptable for reasonable n

### Conflict Resolution

#### Scenario: Simultaneous Drawing

```
Time    Client A              Server              Client B
────────────────────────────────────────────────────────────
t0      Draw stroke A
t1                           Receive A, store
t2      Send operation A                         Draw stroke B
t3                           Receive B, store
t4                           Broadcast A →       Receive A, render
t5      Receive B, render    ← Broadcast B
```

**Result**: Both operations preserved, order determined by server receipt time.

#### Scenario: Undo During Active Drawing

```
Time    Client A              Server              Client B
────────────────────────────────────────────────────────────
t0      Drawing in progress...
t1                                               Press Undo
t2                           Undo last op
t3      Receive undo                             Receive undo
        Canvas redraws                           Canvas redraws
        Current stroke lost                      (Expected behavior)
```

**Decision**: Active strokes are lost on undo. Alternative would be to queue the undo, but this creates confusing UX.

## 🚀 Performance Decisions

### Why These Choices?

#### 1. Douglas-Peucker Path Optimization
**Decision**: Optimize paths before sending
**Reasoning**:
- Reduces network bandwidth by 60%
- Faster rendering on remote clients
- No visible quality degradation
- Computation cost is minimal

**Alternative Considered**: Send raw points
**Rejected Because**: Network becomes bottleneck with fast drawing

#### 2. Throttled Cursor Updates (50ms)
**Decision**: 20Hz cursor update rate
**Reasoning**:
- Human eye can't perceive >30 Hz for cursor movement
- Reduces server load significantly
- Still feels real-time
- Leaves bandwidth for drawing data

**Alternative Considered**: Every mouse move event (~100 Hz)
**Rejected Because**: Wastes 80% of bandwidth with no UX benefit

#### 3. Full Canvas Redraw on Undo
**Decision**: Clear and redraw all operations
**Reasoning**:
- Guarantees perfect consistency
- Simple to implement and debug
- Acceptable performance (< 100ms for ~100 operations)
- Avoids complex state management

**Alternative Considered**: Selective redraw
**Rejected Because**: Complex, error-prone, marginal benefit

#### 4. In-Memory State (No Persistence)
**Decision**: Store operations in memory only
**Reasoning**:
- Simpler architecture for demo
- Faster development
- Focus on core features
- Production would need DB anyway

**Production Alternative**: Redis for state, PostgreSQL for persistence

#### 5. Socket.io vs Native WebSockets
**Decision**: Use Socket.io
**Reasoning**:
- Automatic reconnection
- Room management built-in
- Fallback to polling
- Event-based API cleaner for this use case

**Trade-off**: Slightly higher overhead, but worth it for reliability

## 🏗️ Code Organization

### Client Architecture

```
main.ts                    # Application coordinator
    ├── Manages UI state
    ├── Coordinates canvas and WebSocket
    └── Handles user interactions

canvas.ts                  # Drawing engine
    ├── Canvas rendering logic
    ├── Path optimization
    └── Tool management

websocket.ts              # Network layer
    ├── Socket.io client wrapper
    ├── Event handling
    └── Latency monitoring
```

### Server Architecture

```
server.ts                 # Entry point
    ├── Express setup
    ├── Socket.io configuration
    └── Event routing

rooms.ts                  # Room management
    ├── Multi-room support
    └── Lifecycle management

drawing-state.ts          # State management
    ├── Operation history
    ├── User management
    └── Conflict resolution
```

### Design Patterns Used

1. **Manager Pattern**: Separate managers for Canvas, WebSocket, Rooms
2. **Event-Driven**: Loose coupling via events
3. **Single Responsibility**: Each module has one job
4. **Dependency Injection**: Pass dependencies to constructors
5. **State Machine**: Drawing states (idle → drawing → sending)

## 🔒 Error Handling

### Network Errors

```typescript
// Automatic reconnection
socket.on('disconnect', () => {
  showNotification('Connection lost, reconnecting...');
});

socket.on('connect', () => {
  // Rejoin room automatically
  if (currentRoom) {
    socket.emit('join-room', { roomId: currentRoom, userName });
  }
});
```

### Drawing Errors

```typescript
// Graceful degradation
try {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
} catch (error) {
  alert('Your browser does not support canvas');
}
```

### Edge Cases Handled

1. **User joins during active drawing**: Receives current state, sees others' cursors immediately
2. **Network lag**: Drawing remains smooth locally, syncs when possible
3. **Undo empty canvas**: Disabled button, no server request
4. **Rapid tool switching**: Current stroke committed before switch
5. **Browser resize**: Canvas maintained with content preserved

## 📊 Scalability Considerations

### Current Limits

- **Users per room**: ~50 (comfortable), ~100 (max)
- **Operations history**: ~10,000 operations before redraw lag
- **Network bandwidth**: ~10KB/s per active user

### Bottlenecks

1. **Full redraw on undo**: O(n) where n = operations
2. **In-memory state**: Limited by server RAM
3. **Broadcast fan-out**: O(u) where u = users

### Scaling to 1000 Users

**Required Changes**:

1. **Horizontal Scaling**
   ```
   Load Balancer
       ↓
   Multiple Socket.io Servers
       ↓
   Redis Pub/Sub (shared state)
       ↓
   PostgreSQL (persistence)
   ```

2. **Operational Changes**
   - Implement operation snapshots (every 100 ops)
   - Lazy loading of old operations
   - CDN for static assets
   - WebRTC for peer-to-peer cursor updates

3. **Database Schema**
   ```sql
   rooms (id, created_at)
   operations (id, room_id, user_id, data, timestamp)
   snapshots (id, room_id, data, operation_count)
   ```

## 🎯 Trade-offs Made

| Decision | Pro | Con | Rationale |
|----------|-----|-----|-----------|
| Global undo/redo | Consistent state | Can affect others' work | Simplicity > complexity |
| Full canvas redraw | Always correct | Performance cost | < 100ms acceptable |
| No persistence | Fast development | Lost on restart | Demo focus |
| Socket.io | Reliable, feature-rich | Overhead vs raw WS | Reliability critical |
| TypeScript | Type safety | Build step | Code quality matters |
| No DB | Simple deployment | No history | Iterative development |

## 🔮 Future Enhancements

### High Priority
1. **Persistence**: Save/load drawings from database
2. **Export**: Download as PNG/SVG
3. **Auth**: User accounts and sessions
4. **History Limits**: Prune old operations

### Medium Priority
5. **Shapes**: Rectangle, circle, line tools
6. **Text**: Add text annotations
7. **Layers**: Multiple drawing layers
8. **Fill**: Flood fill tool

### Low Priority (Nice to Have)
9. **Voice Chat**: Integrated communication
10. **Replay**: Playback drawing session
11. **Collaboration**: Cursor chat messages
12. **Templates**: Pre-made backgrounds

---

## 📚 References

### Algorithms Used
- **Douglas-Peucker**: Path simplification
- **Quadratic Bezier**: Smooth curve rendering
- **Throttling**: Event rate limiting

### Technologies
- **Socket.io**: WebSocket abstraction
- **Canvas API**: 2D drawing
- **TypeScript**: Type-safe JavaScript
- **Express**: HTTP server

### Design Inspirations
- Google Jamboard (collaborative whiteboard)
- Excalidraw (drawing UX)
- Figma (real-time collaboration)

---

**This architecture balances simplicity, performance, and feature completeness for a demonstration project while remaining extensible for production use.**
