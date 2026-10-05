/**
 * bot-duel.js — Duel against a bot, entirely in the browser.
 * Used while DUELS_ONLINE is false. Port of server/duel.js + the bot in
 * server/server.js: emits the same events (searching → matched → countdown →
 * duel_start → answer_result / opponent_update / timer_tick → duel_end) so the
 * duel UI in main.js works unchanged.
 *
 * Bot duels are never saved: no XP, no leaderboard, nothing sent to Supabase.
 */
const BotDuel = (() => {

    const DURATION     = 60;   // seconds
    const POINTS_BASE  = 10;
    const STREAK_EVERY = 3;
    const QUESTION_POOL = 80;

    // Same ranges as js/game.js and server/duel.js
    const DIFFICULTY = {
        easy:   { min: 11,  max: 49,   noMult: 10  },
        medium: { min: 51,  max: 99,   noMult: 10  },
        hard:   { min: 101, max: 3000, noMult: 100 },
    };

    // Same as server/duel.js: seconds per answer (mean ± jitter) and accuracy
    const BOT = {
        easy:   { name: 'QuantBot · Easy',   mean: 3.5,  jitter: 1.5, accuracy: 0.90 },
        medium: { name: 'QuantBot · Medium', mean: 5.5,  jitter: 2.0, accuracy: 0.80 },
        hard:   { name: 'QuantBot · Hard',   mean: 11.0, jitter: 4.0, accuracy: 0.70 },
    };

    let room     = null;
    let timers   = [];
    let dispatch = () => {};

    // ── Helpers ───────────────────────────────────────────────────────────────

    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function every(fn, ms) { timers.push(setInterval(fn, ms)); }

    function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randNoMult(min, max, divisor) {
        let n, attempts = 0;
        do { n = randInt(min, max); attempts++; }
        while (n % divisor === 0 && attempts < 100);
        return n;
    }

    function generateQuestions(difficulty) {
        const cfg = DIFFICULTY[difficulty];
        return Array.from({ length: QUESTION_POOL }, () => {
            const a = randNoMult(cfg.min, cfg.max, cfg.noMult);
            const b = randNoMult(cfg.min, cfg.max, cfg.noMult);
            return { display: `${a} × ${b}`, answer: a * b };
        });
    }

    // Same scoring as server/duel.js processAnswer
    function processAnswer(player, userAnswer) {
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
        return {
            correct:       isCorrect,
            correctAnswer: question.answer,
            pointsEarned,
            multiplier,
            nextQuestion:  room.questions[player.qIdx] ?? null,
        };
    }

    function newPlayer(username) {
        return { username, score: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0, qIdx: 0 };
    }

    // ── Bot ───────────────────────────────────────────────────────────────────

    function scheduleBotAnswer() {
        const cfg   = BOT[room.difficulty];
        const delay = Math.max(0.8, cfg.mean + (Math.random() * 2 - 1) * cfg.jitter) * 1000;

        later(() => {
            if (!room?.active) return;
            const bot = room.players[1];
            const q   = room.questions[bot.qIdx];
            if (!q) return;

            const answer = Math.random() < cfg.accuracy
                ? q.answer
                : q.answer + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 20));
            processAnswer(bot, answer);
            dispatch('opponent_update', { score: bot.score, correct: bot.correct });

            scheduleBotAnswer();
        }, delay);
    }

    // ── Duel lifecycle ────────────────────────────────────────────────────────

    function start(difficulty, onEvent) {
        stop();
        dispatch = onEvent;
        const diff = DIFFICULTY[difficulty] ? difficulty : 'medium';

        room = {
            difficulty: diff,
            questions:  generateQuestions(diff),
            active:     false,
            ended:      false,
            players:    [newPlayer('You'), newPlayer(BOT[diff].name)],
        };

        dispatch('searching');

        // Short "searching" moment, then the clearly labelled bot appears
        later(() => {
            dispatch('matched', {
                you:           null,
                opponent:      BOT[diff].name,
                opponentIsBot: true,
                offline:       true,
                playerIdx:     0,
                firstQuestion: room.questions[0],
                duration:      DURATION,
                difficulty:    diff,
            });

            let count = 3;
            every(() => {
                if (!room || room.active || room.ended) return;
                dispatch('countdown', count);
                count--;
                if (count < 0) begin();
            }, 1000);
        }, randInt(1200, 1800));
    }

    function begin() {
        stop({ keepRoom: true });
        room.active = true;
        dispatch('duel_start');
        scheduleBotAnswer();

        let timeLeft = DURATION;
        every(() => {
            timeLeft--;
            dispatch('timer_tick', { timeLeft });
            if (timeLeft <= 0) end(-1, 'timeout');
        }, 1000);
    }

    function end(forcedWinner, reason) {
        if (!room || room.ended) return;
        room.ended  = true;
        room.active = false;
        stop({ keepRoom: true });

        const [p0, p1] = room.players;
        const winner = forcedWinner !== -1
            ? forcedWinner
            : p0.score > p1.score ? 0 : p1.score > p0.score ? 1 : -1;

        dispatch('duel_end', {
            winner,
            reason,
            players: room.players.map(p => ({
                username: p.username, score: p.score, correct: p.correct, bestStreak: p.bestStreak,
            })),
        });
    }

    function submitAnswer(answer) {
        if (!room?.active || !Number.isSafeInteger(answer)) return;
        const result = processAnswer(room.players[0], answer);
        if (!result) return;
        // Async like a network round trip, so the UI sees the same ordering as online
        later(() => dispatch('answer_result', { ...result, score: room.players[0].score }), 0);
    }

    function forfeit() {
        end(1, 'forfeit');
        stop();
    }

    // Cancel everything silently (leaving the screen, new duel, …)
    function stop({ keepRoom = false } = {}) {
        timers.forEach(t => { clearTimeout(t); clearInterval(t); });
        timers = [];
        if (!keepRoom) room = null;
    }

    return { start, submitAnswer, forfeit, stop };
})();
