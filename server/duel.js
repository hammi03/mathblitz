/**
 * duel.js — Server-side duel game logic.
 * Generates questions and validates answers.
 * Kept separate from server.js so it can be unit tested.
 */

const DURATION        = 60;   // seconds
const POINTS_BASE     = 10;
const STREAK_EVERY    = 3;
const QUESTION_POOL   = 80;   // pre-generate plenty so players never run out

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function seededRandom(seed) {
    return function () {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}

function randNoMult(rng, min, max, divisor) {
    let n, attempts = 0;
    do { n = randInt(rng, min, max); attempts++; }
    while (n % divisor === 0 && attempts < 100);
    return n;
}

// ── Question generation — multiplication only, 💀💀 tier (51–99) ─────────────

function generateQuestions(seed, count) {
    const rng = seededRandom(seed);
    const out = [];

    for (let i = 0; i < count; i++) {
        const a = randNoMult(rng, 51, 99, 10);
        const b = randNoMult(rng, 51, 99, 10);
        out.push({ display: `${a} × ${b}`, answer: a * b });
    }
    return out;
}

// ── Room management ───────────────────────────────────────────────────────────

function createRoom(roomId, p0username, p1username) {
    // Derive a numeric seed from the room ID
    const seed = [...roomId].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;
    const questions = generateQuestions(seed, QUESTION_POOL);

    return {
        id: roomId,
        questions,
        duration: DURATION,
        active:   false,
        ended:    false,
        startTime: null,
        timer:     null,
        players: [
            { username: p0username, score: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0, qIdx: 0 },
            { username: p1username, score: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0, qIdx: 0 },
        ],
    };
}

function processAnswer(room, playerIdx, userAnswer) {
    const player   = room.players[playerIdx];
    const question = room.questions[player.qIdx];
    if (!question) return null;

    const isCorrect = userAnswer === question.answer;
    let pointsEarned = 0, multiplier = 1;

    if (isCorrect) {
        player.streak++;
        player.correct++;
        if (player.streak > player.bestStreak) player.bestStreak = player.streak;
        multiplier   = Math.floor(player.streak / STREAK_EVERY) + 1;
        pointsEarned = POINTS_BASE * multiplier;
        player.score += pointsEarned;
    } else {
        player.streak = 0;
        player.wrong++;
    }

    player.qIdx++;
    const nextQ = room.questions[player.qIdx] ?? null;

    return {
        correct:      isCorrect,
        correctAnswer: question.answer,
        pointsEarned,
        multiplier,
        nextQuestion: nextQ,
    };
}

module.exports = { createRoom, processAnswer, DURATION };
