/**
 * server.js — MathBlitz duel server
 * Express + Socket.io. Handles matchmaking and real-time duels.
 *
 * Usage: node server.js
 */

const express  = require('express');
const http     = require('http');
const path     = require('path');
const { Server } = require('socket.io');
const cors     = require('cors');
const { createRoom, processAnswer, DURATION } = require('./duel');

const PORT = 3002;

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.static(path.join(__dirname, '..')));  // serve the frontend
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── State ─────────────────────────────────────────────────────────────────────

const queue = [];   // [{ socketId, username }]
const rooms = {};   // { roomId: room }

function uid() {
    return Math.random().toString(36).slice(2, 10);
}

// ── Socket.io ─────────────────────────────────────────────────────────────────

io.on('connection', socket => {
    console.log(`+ ${socket.id}`);

    // ── Matchmaking ───────────────────────────────────────────────────────────

    socket.on('find_match', ({ username }) => {
        if (queue.find(p => p.socketId === socket.id)) return; // already queued

        queue.push({ socketId: socket.id, username });
        socket.emit('searching');
        console.log(`Queue (${queue.length}): ${username} waiting`);

        tryMatch();
    });

    socket.on('cancel_match', () => {
        removeFromQueue(socket.id);
        socket.emit('match_cancelled');
    });

    // ── Gameplay ──────────────────────────────────────────────────────────────

    socket.on('submit_answer', ({ answer }) => {
        const { roomId, playerIdx } = socket.data;
        const room = rooms[roomId];
        if (!room || !room.active || room.ended) return;

        const result = processAnswer(room, playerIdx, answer);
        if (!result) return;

        // Send personalised result back to the answering player
        socket.emit('answer_result', {
            correct:       result.correct,
            correctAnswer: result.correctAnswer,
            pointsEarned:  result.pointsEarned,
            multiplier:    result.multiplier,
            score:         room.players[playerIdx].score,
            nextQuestion:  result.nextQuestion,
        });

        // Broadcast score update to opponent
        socket.to(roomId).emit('opponent_update', {
            score:   room.players[playerIdx].score,
            correct: room.players[playerIdx].correct,
        });
    });

    socket.on('forfeit', () => {
        const { roomId, playerIdx } = socket.data;
        const room = rooms[roomId];
        if (!room || room.ended) return;
        endRoom(roomId, 1 - playerIdx, 'forfeit');
    });

    // ── Disconnect ────────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
        console.log(`- ${socket.id}`);
        removeFromQueue(socket.id);

        const { roomId, playerIdx } = socket.data;
        const room = rooms[roomId];
        if (room && !room.ended) {
            endRoom(roomId, 1 - playerIdx, 'disconnect');
        }
    });
});

// ── Matchmaking logic ─────────────────────────────────────────────────────────

function tryMatch() {
    if (queue.length < 2) return;

    const [p0, p1] = queue.splice(0, 2);
    const roomId   = uid();
    const room     = createRoom(roomId, p0.username, p1.username);
    rooms[roomId]  = room;

    const s0 = io.sockets.sockets.get(p0.socketId);
    const s1 = io.sockets.sockets.get(p1.socketId);

    if (!s0 || !s1) {
        // One of them disconnected before match was made
        if (s0) queue.unshift({ socketId: p0.socketId, username: p0.username });
        if (s1) queue.unshift({ socketId: p1.socketId, username: p1.username });
        delete rooms[roomId];
        return;
    }

    s0.join(roomId); s0.data.roomId = roomId; s0.data.playerIdx = 0;
    s1.join(roomId); s1.data.roomId = roomId; s1.data.playerIdx = 1;

    console.log(`Room ${roomId}: ${p0.username} vs ${p1.username}`);

    // Notify both players
    s0.emit('matched', { opponent: p1.username, playerIdx: 0, firstQuestion: room.questions[0], duration: DURATION });
    s1.emit('matched', { opponent: p0.username, playerIdx: 1, firstQuestion: room.questions[0], duration: DURATION });

    // 3-2-1 countdown then start
    let count = 3;
    const iv = setInterval(() => {
        io.to(roomId).emit('countdown', count);
        count--;
        if (count < 0) {
            clearInterval(iv);
            startRoom(roomId);
        }
    }, 1000);
}

function removeFromQueue(socketId) {
    const idx = queue.findIndex(p => p.socketId === socketId);
    if (idx !== -1) queue.splice(idx, 1);
}

// ── Room lifecycle ────────────────────────────────────────────────────────────

function startRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.active    = true;
    room.startTime = Date.now();
    io.to(roomId).emit('duel_start');

    let timeLeft = DURATION;
    room.timer = setInterval(() => {
        if (!rooms[roomId]) { clearInterval(room.timer); return; }
        timeLeft--;
        io.to(roomId).emit('timer_tick', { timeLeft });
        if (timeLeft <= 0) {
            clearInterval(room.timer);
            endRoom(roomId, -1, 'timeout');
        }
    }, 1000);
}

function endRoom(roomId, forcedWinner, reason) {
    const room = rooms[roomId];
    if (!room || room.ended) return;
    room.ended = true;
    if (room.timer) clearInterval(room.timer);

    const [p0, p1] = room.players;
    let winner;
    if (forcedWinner !== undefined && forcedWinner !== -1) {
        winner = forcedWinner;
    } else {
        winner = p0.score > p1.score ? 0 : p1.score > p0.score ? 1 : -1;
    }

    console.log(`Room ${roomId} ended (${reason}): ${p0.username}=${p0.score} ${p1.username}=${p1.score} winner=${winner}`);

    io.to(roomId).emit('duel_end', {
        winner,
        reason,
        players: [
            { username: p0.username, score: p0.score, correct: p0.correct, bestStreak: p0.bestStreak },
            { username: p1.username, score: p1.score, correct: p1.correct, bestStreak: p1.bestStreak },
        ],
    });

    setTimeout(() => { delete rooms[roomId]; }, 15000);
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`\nMathBlitz duel server → http://localhost:${PORT}`);
    console.log('Waiting for players...\n');
});
