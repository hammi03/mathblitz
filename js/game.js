/**
 * game.js — Pure game logic. No DOM, no timers.
 * Supports classic, sprint, zen, daily, and community modes.
 * Questions may be supplied (server session / daily / community) or generated locally.
 */
const Game = (() => {

    // 💀 Hard: 13×17 style — no trivial ×10 numbers
    // 💀💀 Harder: 51–99 range
    // 💀💀💀 Hardest: 101–3000
    const DIFFICULTY = {
        easy:   { mulMin: 11,  mulMax: 49,   noMult: 10  },
        medium: { mulMin: 51,  mulMax: 99,   noMult: 10  },
        hard:   { mulMin: 101, mulMax: 3000, noMult: 100 },
    };

    const POINTS_BASE        = 10;
    const STREAK_BONUS_EVERY = 3;
    const SPRINT_QUESTIONS   = 10;
    const SCALE_EVERY        = 5;

    let state = {};

    // Modes that end after a fixed list of questions
    const FIXED_LIST_MODES = ['daily', 'community'];

    function freshState(settings) {
        const predefined = settings.predefinedQuestions ?? null;
        const totalQuestions =
            settings.mode === 'sprint'                 ? SPRINT_QUESTIONS :
            FIXED_LIST_MODES.includes(settings.mode)   ? predefined.length :
            null;
        return {
            mode:        settings.mode,
            difficulty:  settings.difficulty  ?? 'medium',
            operations:  ['mul'],
            score:       0,
            correct:     0,
            wrong:       0,
            streak:      0,
            bestStreak:  0,
            level:       1,
            timeLeft:    settings.mode === 'classic' ? settings.timeLimit : 0,
            totalTime:   settings.timeLimit ?? 60,
            questionIdx: 0,
            totalQuestions,
            predefined,
            currentQ:          null,
            answeredQuestions: [],   // first 30, for the history screen
            answers:           [],   // every answer given, sent to the server for scoring
            startTime:         Date.now(),
            endsAt:            null,    // classic: when the clock reaches 0 (ms)
            pausedAt:          null,    // set while the round is paused
            active:            false,
        };
    }

    // ── Question generation ───────────────────────────────────────────────────

    function rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randNoMult(min, max, divisor) {
        let n, attempts = 0;
        do { n = rand(min, max); attempts++; }
        while (n % divisor === 0 && attempts < 100);
        return n;
    }

    function generateQuestion(difficulty) {
        const cfg = DIFFICULTY[difficulty];
        const a = randNoMult(cfg.mulMin, cfg.mulMax, cfg.noMult);
        const b = randNoMult(cfg.mulMin, cfg.mulMax, cfg.noMult);
        return { display: `${a} × ${b}`, answer: a * b };
    }

    function nextQuestion() {
        if (state.predefined) {
            return state.predefined[state.questionIdx] ?? generateQuestion(state.difficulty);
        }
        return generateQuestion(state.difficulty);
    }

    // ── Level tracking (cosmetic — every SCALE_EVERY correct answers) ─────────

    function updateScale() {
        const newLevel  = Math.floor(state.correct / SCALE_EVERY) + 1;
        const leveledUp = newLevel > state.level;
        state.level     = newLevel;
        return leveledUp;
    }

    // ── Game over check ───────────────────────────────────────────────────────

    function isGameOver() {
        if (state.totalQuestions === null) return false;
        return state.questionIdx >= state.totalQuestions;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    function start(settings) {
        state = freshState(settings);
        state.currentQ = state.predefined ? state.predefined[0] : generateQuestion(state.difficulty);
        state.active = true;
        if (state.mode === 'classic') state.endsAt = state.startTime + state.totalTime * 1000;
        return snapshot();
    }

    // ── Clock: timestamps, so a pause shifts them and no time is lost ────────

    function now() { return state.pausedAt ?? Date.now(); }

    function pause() {
        if (state.active && state.pausedAt === null) state.pausedAt = Date.now();
    }

    function resume() {
        if (state.pausedAt === null) return;
        const paused = Date.now() - state.pausedAt;
        state.startTime += paused;
        if (state.endsAt !== null) state.endsAt += paused;
        state.pausedAt = null;
    }

    function isRunning() { return !!state.active; }
    function isPaused()  { return state.pausedAt !== null; }

    function submitAnswer(userAnswer) {
        if (!state.active || state.pausedAt !== null) return null;

        const isCorrect     = userAnswer === state.currentQ.answer;
        const correctAnswer = state.currentQ.answer;
        let pointsEarned = 0, multiplier = 1, leveledUp = false;

        if (isCorrect) {
            state.streak++;
            state.correct++;
            if (state.streak > state.bestStreak) state.bestStreak = state.streak;
            multiplier   = Math.floor(state.streak / STREAK_BONUS_EVERY) + 1;
            pointsEarned = POINTS_BASE * multiplier;
            state.score += pointsEarned;
            if (!FIXED_LIST_MODES.includes(state.mode)) leveledUp = updateScale();
        } else {
            state.streak = 0;
            state.wrong++;
        }

        if (state.answeredQuestions.length < 30) {
            state.answeredQuestions.push({
                display: state.currentQ.display,
                answer:  state.currentQ.answer,
                given:   userAnswer,
                correct: isCorrect,
            });
        }

        state.answers.push(userAnswer);
        state.questionIdx++;

        if (isGameOver()) {
            state.active = false;
            return { correct: isCorrect, correctAnswer, pointsEarned, multiplier, leveledUp, gameOver: true, state: snapshot() };
        }

        state.currentQ = nextQuestion();
        return { correct: isCorrect, correctAnswer, pointsEarned, multiplier, leveledUp, gameOver: false, state: snapshot() };
    }

    // Classic: whole seconds left, read from the clock (call it often; it is cheap)
    function tick() {
        if (!state.active || state.mode !== 'classic' || state.pausedAt !== null) return null;
        const msLeft = state.endsAt - Date.now();
        state.timeLeft = Math.max(0, Math.ceil(msLeft / 1000));
        if (msLeft <= 0) {
            state.active = false;
            return { timeLeft: 0, gameOver: true, state: snapshot() };
        }
        return { timeLeft: state.timeLeft, gameOver: false };
    }

    function elapsedSeconds() {
        return ((now() - state.startTime) / 1000).toFixed(2);
    }

    function getCurrentQuestion() { return state.currentQ; }
    function snapshot()           { return { ...state }; }

    return { start, submitAnswer, tick, pause, resume, isRunning, isPaused, elapsedSeconds, getCurrentQuestion, snapshot };
})();
