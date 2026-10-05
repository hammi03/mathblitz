/**
 * server.js — QuantQuiz duel server
 * Express + Socket.io. Handles matchmaking and real-time duels.
 *
 * Usage: node server.js
 *
 * Env:
 *   PORT              — listen port (default 3002)
 *   ALLOWED_ORIGINS   — comma-separated list of allowed origins (default: any)
 *   SUPABASE_URL      — used to verify players' login tokens
 *   SUPABASE_ANON_KEY — public anon key of the same project
 */

const express  = require('express');
const http     = require('http');
const path     = require('path');
const { Server } = require('socket.io');
const cors     = require('cors');
const { createRoom, processAnswer, DURATION } = require('./duel');

const PORT = process.env.PORT || 3002;

// Public values (same as js/config.js) — override via env for another project
const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://luigbtlwavsdlzdbtbot.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1aWdidGx3YXZzZGx6ZGJ0Ym90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDQwMDksImV4cCI6MjA4NzUyMDAwOX0.mmJVwQ5CgdgU4f43rR0rQT0STRagXI341QrD0QgtLGE';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const corsOrigin = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : '*';

const REACTIONS         = new Set(['🔥', '😂', '💀', '🤯']);
const MIN_ANSWER_GAP_MS = 100;
const MIN_REACTION_GAP_MS = 1000;

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 10_000,
});

app.use(cors({ origin: corsOrigin }));
app.use(express.static(path.join(__dirname, '..')));  // serve the frontend
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── State ─────────────────────────────────────────────────────────────────────

const queue = [];   // [{ socketId, userId, username }]
const rooms = {};   // { roomId: room }

function uid() {
    return Math.random().toString(36).slice(2, 10);
}

// A throwing handler would otherwise crash the whole process (= every duel)
function safe(handler) {
    return (...args) => {
        try {
            const result = handler(...args);
            if (result && typeof result.catch === 'function') {
                result.catch(err => console.error('handler error:', err));
            }
        } catch (err) {
            console.error('handler error:', err);
        }
    };
}

// ── Auth: resolve the player's username from their Supabase access token ──────

async function resolvePlayer(token) {
    if (typeof token !== 'string' || !token || token.length > 4096) return null;
    const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
    if (!userRes.ok) return null;
    const user = await userRes.json();
    if (!user?.id) return null;

    const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=username`,
        { headers },
    );
    if (!profRes.ok) return null;
    const [profile] = await profRes.json();
    if (!profile?.username) return null;

    return { userId: user.id, username: profile.username };
}

// ── Socket.io ─────────────────────────────────────────────────────────────────

io.on('connection', socket => {
    console.log(`+ ${socket.id}`);

    // ── Matchmaking ───────────────────────────────────────────────────────────

    socket.on('find_match', safe(async payload => {
        if (queue.find(p => p.socketId === socket.id)) return; // already queued
        const current = rooms[socket.data.roomId];
        if (current && !current.ended) return;                // already in a duel

        let player;
        try {
            player = await resolvePlayer(payload?.token);
        } catch (err) {
            console.error('auth check failed:', err.message);
            socket.emit('duel_error', { message: 'Could not verify your login. Please try again.' });
            return;
        }
        if (!socket.connected) return;
        if (!player) {
            socket.emit('duel_error', { message: 'Please sign in again to play duels.' });
            return;
        }

        // Same account in two tabs: keep only the newest search
        const dupIdx = queue.findIndex(p => p.userId === player.userId);
        if (dupIdx !== -1) {
            const [old] = queue.splice(dupIdx, 1);
            io.sockets.sockets.get(old.socketId)?.emit('match_cancelled');
        }

        queue.push({ socketId: socket.id, ...player });
        socket.emit('searching');
        console.log(`Queue (${queue.length}): ${player.username} waiting`);

        tryMatch();
    }));

    socket.on('cancel_match', safe(() => {
        removeFromQueue(socket.id);
        socket.emit('match_cancelled');
    }));

    // ── Gameplay ──────────────────────────────────────────────────────────────

    socket.on('submit_answer', safe(payload => {
        const answer = payload?.answer;
        if (!Number.isSafeInteger(answer)) return;

        const now = Date.now();
        if (now - (socket.data.lastAnswerAt ?? 0) < MIN_ANSWER_GAP_MS) return;
        socket.data.lastAnswerAt = now;

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
    }));

    socket.on('send_reaction', safe(payload => {
        const emoji = payload?.emoji;
        if (!REACTIONS.has(emoji)) return;

        const now = Date.now();
        if (now - (socket.data.lastReactionAt ?? 0) < MIN_REACTION_GAP_MS) return;
        socket.data.lastReactionAt = now;

        const { roomId } = socket.data;
        if (!roomId) return;
        socket.to(roomId).emit('reaction', { emoji });
    }));

    socket.on('forfeit', safe(() => {
        const { roomId, playerIdx } = socket.data;
        const room = rooms[roomId];
        if (!room || room.ended) return;
        endRoom(roomId, 1 - playerIdx, 'forfeit');
    }));

    // ── Disconnect ────────────────────────────────────────────────────────────

    socket.on('disconnect', safe(() => {
        console.log(`- ${socket.id}`);
        removeFromQueue(socket.id);

        const { roomId, playerIdx } = socket.data;
        const room = rooms[roomId];
        if (room && !room.ended) {
            endRoom(roomId, 1 - playerIdx, 'disconnect');
        }
    }));
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
        if (s0) queue.unshift(p0);
        if (s1) queue.unshift(p1);
        delete rooms[roomId];
        return;
    }

    s0.join(roomId); s0.data.roomId = roomId; s0.data.playerIdx = 0;
    s1.join(roomId); s1.data.roomId = roomId; s1.data.playerIdx = 1;

    console.log(`Room ${roomId}: ${p0.username} vs ${p1.username}`);

    // Notify both players
    s0.emit('matched', { opponent: p1.username, playerIdx: 0, firstQuestion: room.questions[0], duration: DURATION });
    s1.emit('matched', { opponent: p0.username, playerIdx: 1, firstQuestion: room.questions[0], duration: DURATION });

    // 3-2-1 countdown then start — aborted if someone leaves during it
    let count = 3;
    const iv = setInterval(() => {
        if (room.ended) { clearInterval(iv); return; }
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
    if (!room || room.ended) return;

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
    room.ended  = true;
    room.active = false;
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
    console.log(`\nQuantQuiz duel server → http://localhost:${PORT}`);
    console.log('Waiting for players...\n');
});
