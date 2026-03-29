/**
 * game.js — Pure game logic. No DOM, no timers.
 * Supports classic, sprint, zen, and daily modes.
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

    function freshState(settings) {
        const predefined = settings.predefinedQuestions ?? null;
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
            totalQuestions: predefined ? predefined.length : (settings.mode === 'sprint' ? SPRINT_QUESTIONS : null),
            predefined,
            currentQ:          null,
            answeredQuestions: [],
            startTime:         Date.now(),
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
            return state.predefined[state.questionIdx] ?? state.predefined.at(-1);
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
        if (state.mode === 'sprint') return state.questionIdx >= SPRINT_QUESTIONS;
        if (state.mode === 'daily') return state.questionIdx >= state.predefined.length;
        return false;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    function start(settings) {
        state = freshState(settings);
        state.currentQ = state.predefined ? state.predefined[0] : generateQuestion(state.difficulty);
        state.active = true;
        return snapshot();
    }

    function submitAnswer(userAnswer) {
        if (!state.active) return null;

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
            if (!state.predefined) leveledUp = updateScale();
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

        state.questionIdx++;

        if (isGameOver()) {
            state.active = false;
            return { correct: isCorrect, correctAnswer, pointsEarned, multiplier, leveledUp, gameOver: true, state: snapshot() };
        }

        state.currentQ = nextQuestion();
        return { correct: isCorrect, correctAnswer, pointsEarned, multiplier, leveledUp, gameOver: false, state: snapshot() };
    }

    function tick() {
        if (!state.active || state.mode !== 'classic') return null;
        state.timeLeft = Math.max(0, state.timeLeft - 1);
        if (state.timeLeft === 0) {
            state.active = false;
            return { timeLeft: 0, gameOver: true, state: snapshot() };
        }
        return { timeLeft: state.timeLeft, gameOver: false };
    }

    function elapsedSeconds() {
        return ((Date.now() - state.startTime) / 1000).toFixed(2);
    }

    function getCurrentQuestion() { return state.currentQ; }
    function snapshot()           { return { ...state }; }

    return { start, submitAnswer, tick, elapsedSeconds, getCurrentQuestion, snapshot };
})();
