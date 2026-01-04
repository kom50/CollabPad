import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ONE_HOUR = 3600000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Store rooms data
const rooms = new Map();

// Get or create room
function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            content: `/**
 * Welcome to CollabPad!
 * Room: ${roomId}
 * 
 * Share this URL to collaborate in real-time.
 * All changes are synced instantly via Socket.IO.
 */

function hello() {
    console.log("Start coding together!");
}

hello();`,
            users: new Map()
        });
    }
    return rooms.get(roomId);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    let currentRoom = null;
    let currentUser = null;

    // Join a room
    socket.on('join-room', ({ roomId, user }) => {
        currentRoom = roomId;
        currentUser = { ...user, oduserId: socket.id };

        socket.join(roomId);

        const room = getRoom(roomId);
        room.users.set(socket.id, user);

        // Send current document state to the new user
        socket.emit('init', {
            content: room.content,
            users: Array.from(room.users.entries()).map(([id, u]) => ({ id, ...u }))
        });

        // Notify others about new user
        socket.to(roomId).emit('user-joined', {
            id: socket.id,
            ...user
        });

        // Send updated user list to everyone
        io.to(roomId).emit('users-update',
            Array.from(room.users.entries()).map(([id, u]) => ({ id, ...u }))
        );

        console.log(`User ${user.name} joined room ${roomId}`);
    });

    // Handle text changes
    socket.on('text-change', ({ roomId, content, cursorPos }) => {
        const room = getRoom(roomId);
        room.content = content;

        // Broadcast to others in the room
        socket.to(roomId).emit('text-update', {
            content,
            userId: socket.id,
            cursorPos
        });
    });

    // Handle cursor position updates
    socket.on('cursor-update', ({ roomId, cursorPos }) => {
        socket.to(roomId).emit('cursor-move', {
            userId: socket.id,
            cursorPos
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.users.delete(socket.id);

                // Notify others
                io.to(currentRoom).emit('user-left', { id: socket.id });
                io.to(currentRoom).emit('users-update',
                    Array.from(room.users.entries()).map(([id, u]) => ({ id, ...u }))
                );

                // Clean up empty rooms after 1 hour
                if (room.users.size === 0) {
                    setTimeout(() => {
                        const r = rooms.get(currentRoom);
                        if (r && r.users.size === 0) {
                            rooms.delete(currentRoom);
                            console.log(`Room ${currentRoom} deleted (empty)`);
                        }
                    }, ONE_HOUR);
                }
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════╗
    ║                                           ║
    ║   CollabPad Server Running!               ║
    ║                                           ║
    ║   Local:   http://localhost:${PORT}          ║
    ║                                           ║
    ║   Share the URL with others to collab!    ║
    ║                                           ║
    ╚═══════════════════════════════════════════╝
    `);
});
