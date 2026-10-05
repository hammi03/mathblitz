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
const { createRoom, processAnswer, DURATION, DIFFICULTY, BOT } = require('./duel');

const PORT = process.env.PORT || 3002;

// Public values (same as js/config.js) — override via env for another project
const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://luigbtlwavsdlzdbtbot.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1aWdidGx3YXZzZGx6ZGJ0Ym90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDQwMDksImV4cCI6MjA4NzUyMDAwOX0.mmJVwQ5CgdgU4f43rR0rQT0STRagXI341QrD0QgtLGE';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const corsOrigin = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : '*';

const REACTIONS           = new Set(['🔥', '😂', '💀', '🤯']);
const MIN_ANSWER_GAP_MS   = 100;
const MIN_REACTION_GAP_MS = 1000;
const BOT_AFTER_MS        = Number(process.env.BOT_AFTER_MS) || 8000;   // no opponent → bot
const CHALLENGE_TTL_MS    = 10 * 60 * 1000;

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

const queue      = [];   // [{ socketId, userId, username, difficulty, botTimer }]
const rooms      = {};   // { roomId: room }
const challenges = {};   // { code: { player, expires } }

function uid() {
    return Math.random().toString(36).slice(2, 10);
}

function challengeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
    let code;
    do {
        code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (challenges[code]);
    return code;
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

function validDifficulty(d) {
    return Object.hasOwn(DIFFICULTY, d) ? d : 'medium';
}

// ── Auth: registered players by Supabase token, everyone else as guest ────────

async function lookupAccount(token) {
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

// Guest names contain '-', which registered usernames can't, so they can't be impersonated
async function resolvePlayer(socket, token) {
    let account = null;
    try {
        account = await lookupAccount(token);
    } catch (err) {
        console.error('auth check failed:', err.message);
    }
    if (account) return account;

    socket.data.guestName ??= `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
    return { userId: null, username: socket.data.guestName };
}

function inActiveRoom(socket) {
    const room = rooms[socket.data.roomId];
    return !!(room && !room.ended);
}

// ── Socket.io ─────────────────────────────────────────────────────────────────

io.on('connection', socket => {
    console.log(`+ ${socket.id}`);

    // ── Matchmaking ───────────────────────────────────────────────────────────

    socket.on('find_match', safe(async payload => {
        if (queue.find(p => p.socketId === socket.id) || inActiveRoom(socket)) return;

        const player = await resolvePlayer(socket, payload?.token);
        if (!socket.connected) return;
        const difficulty = validDifficulty(payload?.difficulty);

        // Same account in two tabs: keep only the newest search
        if (player.userId) {
            const dupIdx = queue.findIndex(p => p.userId === player.userId);
            if (dupIdx !== -1) {
                const [old] = queue.splice(dupIdx, 1);
                clearTimeout(old.botTimer);
                io.sockets.sockets.get(old.socketId)?.emit('match_cancelled');
            }
        }

        enqueue({ socketId: socket.id, ...player, difficulty });
        socket.emit('searching');
    }));

    socket.on('cancel_match', safe(() => {
        removeFromQueue(socket.id);
        removeChallenge(socket);
        socket.emit('match_cancelled');
    }));

    // ── Challenge links ───────────────────────────────────────────────────────

    socket.on('create_challenge', safe(async payload => {
        if (inActiveRoom(socket)) return;
        removeFromQueue(socket.id);   // leave public matchmaking (and its bot timer)
        removeChallenge(socket);

        const player = await resolvePlayer(socket, payload?.token);
        if (!socket.connected) return;

        const code = challengeCode();
        challenges[code] = {
            player:  { socketId: socket.id, ...player, difficulty: validDifficulty(payload?.difficulty) },
            expires: Date.now() + CHALLENGE_TTL_MS,
        };
        socket.data.challengeCode = code;
        socket.emit('challenge_created', { code });
        console.log(`Challenge ${code} by ${player.username}`);
    }));

    socket.on('join_challenge', safe(async payload => {
        if (inActiveRoom(socket)) return;
        const code = typeof payload?.code === 'string' ? payload.code.toUpperCase() : '';
        const challenge = challenges[code];

        const player = await resolvePlayer(socket, payload?.token);
        if (!socket.connected) return;

        const creatorSocket = challenge && io.sockets.sockets.get(challenge.player.socketId);
        if (!challenge || challenge.expires < Date.now() || !creatorSocket) {
            delete challenges[code];
            socket.emit('duel_error', { message: 'This challenge link has expired. Start a new duel instead!' });
            return;
        }
        if (challenge.player.socketId === socket.id ||
            (player.userId && player.userId === challenge.player.userId)) {
            socket.emit('duel_error', { message: "That's your own challenge link. Send it to a friend!" });
            return;
        }

        delete challenges[code];
        delete creatorSocket.data.challengeCode;
        startMatch([challenge.player, { socketId: socket.id, ...player }], challenge.player.difficulty);
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
        removeChallenge(socket);

        const { roomId, playerIdx } = socket.data;
        const room = rooms[roomId];
        if (room && !room.ended) {
            endRoom(roomId, 1 - playerIdx, 'disconnect');
        }
    }));
});

// ── Matchmaking logic ─────────────────────────────────────────────────────────

function enqueue(entry) {
    entry.botTimer = setTimeout(() => startBotMatch(entry), BOT_AFTER_MS);
    queue.push(entry);
    console.log(`Queue (${queue.length}): ${entry.username} waiting [${entry.difficulty}]`);
    tryMatch(entry.difficulty);
}

function tryMatch(difficulty) {
    const waiting = queue.filter(p => p.difficulty === difficulty);
    if (waiting.length < 2) return;

    const [p0, p1] = waiting;
    removeFromQueue(p0.socketId);
    removeFromQueue(p1.socketId);
    startMatch([p0, p1], difficulty);
}

function startBotMatch(entry) {
    if (!queue.includes(entry)) return;   // matched or cancelled meanwhile
    removeFromQueue(entry.socketId);
    startMatch([entry], entry.difficulty);
}

// players: two humans, or one human (opponent becomes the bot)
function startMatch(players, difficulty) {
    const vsBot  = players.length === 1;
    const [p0, p1] = players;
    const roomId = uid();
    const room   = createRoom(roomId, p0.username, vsBot ? BOT[difficulty].name : p1.username, difficulty, vsBot);
    rooms[roomId] = room;

    const sockets = players.map(p => io.sockets.sockets.get(p.socketId));
    if (sockets.some(s => !s)) {
        // Someone disconnected before the match was made: the others search again
        delete rooms[roomId];
        players.forEach((p, i) => { if (sockets[i]) enqueue({ ...p, difficulty }); });
        return;
    }

    sockets.forEach((s, i) => {
        s.join(roomId);
        s.data.roomId    = roomId;
        s.data.playerIdx = i;
    });

    console.log(`Room ${roomId} [${difficulty}]: ${room.players[0].username} vs ${room.players[1].username}`);

    room.players.forEach((_, i) => {
        sockets[i]?.emit('matched', {
            you:           room.players[i].username,
            opponent:      room.players[1 - i].username,
            opponentIsBot: !!room.players[1 - i].isBot,
            playerIdx:     i,
            firstQuestion: room.questions[0],
            duration:      DURATION,
            difficulty,
        });
    });

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
    if (idx === -1) return;
    clearTimeout(queue[idx].botTimer);
    queue.splice(idx, 1);
}

function removeChallenge(socket) {
    const code = socket.data.challengeCode;
    if (code) delete challenges[code];
    delete socket.data.challengeCode;
}

// Drop expired challenge links
setInterval(() => {
    const now = Date.now();
    for (const [code, c] of Object.entries(challenges)) {
        if (c.expires < now) delete challenges[code];
    }
}, 60_000).unref();

// ── Bot ───────────────────────────────────────────────────────────────────────

function scheduleBotAnswer(room) {
    const cfg   = BOT[room.difficulty];
    const delay = Math.max(0.8, cfg.mean + (Math.random() * 2 - 1) * cfg.jitter) * 1000;

    room.botTimeout = setTimeout(() => {
        if (room.ended || !room.active) return;
        const bot = room.players[1];
        const q   = room.questions[bot.qIdx];
        if (!q) return;

        const answer = Math.random() < cfg.accuracy
            ? q.answer
            : q.answer + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 20));
        processAnswer(room, 1, answer);
        io.to(room.id).emit('opponent_update', { score: bot.score, correct: bot.correct });

        scheduleBotAnswer(room);
    }, delay);
}

// ── Room lifecycle ────────────────────────────────────────────────────────────

function startRoom(roomId) {
    const room = rooms[roomId];
    if (!room || room.ended) return;

    room.active    = true;
    room.startTime = Date.now();
    io.to(roomId).emit('duel_start');
    if (room.players[1].isBot) scheduleBotAnswer(room);

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
    if (room.timer)      clearInterval(room.timer);
    if (room.botTimeout) clearTimeout(room.botTimeout);

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
