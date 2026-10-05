/**
 * main.js — App controller.
 * Wires menu, auth, countdown, game loop, results, leaderboard, daily, streaks.
 */

// ── Rank system (global so ui.js leaderboard rendering can access) ─────────
const RANKS = [
    { name: 'Bronze',    icon: '🥉', min: 0,    cls: 'rank-bronze'  },
    { name: 'Silver I',  icon: '🥈', min: 1000, cls: 'rank-silver'  },
    { name: 'Silver II', icon: '🥈', min: 2500, cls: 'rank-silver2' },
    { name: 'Gold',      icon: '🥇', min: 5000, cls: 'rank-gold'    },
];
function getRankForXP(xp) {
    let r = RANKS[0];
    for (const rk of RANKS) if (xp >= rk.min) r = rk;
    return r;
}

const App = (() => {

    let settings = {
        mode:       'classic',
        difficulty: 'easy',
        operations: ['mul'],
        timeLimit:  60,
    };

    let currentUser     = null;
    let currentUsername = null;
    let classicTimer    = null;
    let zenTimer        = null;
    let zenElapsed      = 0;
    let countdownActive = false;
    let currentXP       = 0;      // server-side total_xp of the signed-in user
    let dailyDone       = false;  // signed-in user has started today's daily
    let session         = null;   // { sessionId, questions } of the running server-scored game
    let currentStreak   = 0;      // day streak of the signed-in user
    let lastResult      = null;   // { state, elapsed } of the last finished game, for sharing

    const lb = { mode: 'classic', difficulty: 'medium', timeLimit: 60 };

    // ── XP & Rank helpers ─────────────────────────────────────────────────────

    function canSubmit(xp)   { return xp >= RANKS[2].min; }  // Silver II+ (enforced server-side too)

    function updateRankBadge(xp) {
        const badge = document.getElementById('rank-badge');
        if (!currentUser) { badge.className = 'rank-badge hidden'; return; }
        const rank = getRankForXP(xp);
        badge.textContent = `${rank.icon} ${rank.name}`;
        badge.className   = `rank-badge ${rank.cls}`;
    }

    // ── History helpers ───────────────────────────────────────────────────────

    function saveGameHistory(state, elapsed) {
        const key  = 'quantquiz_history';
        const hist = JSON.parse(localStorage.getItem(key) || '[]');
        hist.unshift({
            ts:        Date.now(),
            mode:      state.mode,
            diff:      state.difficulty,
            score:     state.score,
            correct:   state.correct,
            wrong:     state.wrong,
            streak:    state.bestStreak,
            elapsed:   parseFloat(elapsed),
            questions: state.answeredQuestions ?? [],
        });
        if (hist.length > 20) hist.pop();
        localStorage.setItem(key, JSON.stringify(hist));
    }

    // ── Daily goal + play streak (local, works for guests too) ────────────────

    const DAILY_GOAL   = 3;   // rounds per day
    const PROGRESS_KEY = 'quantquiz_progress';

    function localISO(d = new Date()) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function yesterdayISO() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return localISO(d);
    }

    // { last: 'YYYY-MM-DD', streak, rounds } — rounds counts today's finished games
    function loadProgress() {
        try {
            const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
            const today = localISO();
            const alive = p.last === today || p.last === yesterdayISO();
            return {
                last:   p.last ?? null,
                streak: alive ? (p.streak ?? 0) : 0,
                rounds: p.last === today ? (p.rounds ?? 0) : 0,
            };
        } catch {
            return { last: null, streak: 0, rounds: 0 };
        }
    }

    function recordRound() {
        const p     = loadProgress();
        const today = localISO();
        const firstToday = p.last !== today;
        const next = {
            last:   today,
            streak: firstToday ? p.streak + 1 : p.streak,
            rounds: p.rounds + 1,
        };
        try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
        return { ...next, goalJustMet: next.rounds === DAILY_GOAL };
    }

    // Pips + one line of text; shared by the menu and the results screen
    function renderToday(el) {
        const p       = loadProgress();
        const done    = Math.min(p.rounds, DAILY_GOAL);
        const atRisk  = p.rounds === 0 && p.streak > 0;
        const pips    = Array.from({ length: DAILY_GOAL }, (_, i) =>
            `<span class="pip${i < done ? ' on' : ''}"></span>`).join('');
        const text =
            atRisk                    ? 'Play today to keep your streak alive' :
            p.rounds === 0            ? `Today's goal: ${DAILY_GOAL} rounds` :
            p.rounds < DAILY_GOAL     ? `${DAILY_GOAL - p.rounds} more ${DAILY_GOAL - p.rounds === 1 ? 'round' : 'rounds'} to today's goal` :
                                        `Goal done for today`;
        const streak = p.streak > 0 ? `<span class="today-streak">🔥 ${p.streak}</span>` : '';
        el.classList.toggle('at-risk', atRisk);
        el.classList.toggle('goal-done', p.rounds >= DAILY_GOAL);
        el.innerHTML = `<span class="pips">${pips}</span><span class="today-text">${text}</span>${streak}`;
    }

    function refreshToday() {
        document.querySelectorAll('.today-strip').forEach(renderToday);
    }

    // ── Local storage ─────────────────────────────────────────────────────────

    function storageKey(mode, diff, time) {
        return mode === 'classic'
            ? `quantquiz_best_${mode}_${diff}_${time}s`
            : `quantquiz_best_${mode}_${diff}`;
    }
    function getBest(mode, diff, time) {
        const v = localStorage.getItem(storageKey(mode, diff, time));
        return v !== null ? parseFloat(v) : null;
    }
    function setBest(mode, diff, time, value) {
        const cur    = getBest(mode, diff, time);
        const better = cur === null || (mode === 'sprint' ? value < cur : value > cur);
        if (better) localStorage.setItem(storageKey(mode, diff, time), value);
        return better;
    }
    function formatBest(mode, diff, time) {
        if (mode === 'daily') return dailyDone ? 'Done today ✓' : '—';
        const v = getBest(mode, diff, time);
        if (v === null) return '—';
        return mode === 'sprint' ? v + 's' : String(v);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    function initAuth() {
        DB.onAuthChange((event, user) => {
            if (event === 'TOKEN_REFRESHED') return;
            loadUser(user);
        });

        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.modal-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            });
        });

        document.getElementById('signin-btn').addEventListener('click', async () => {
            const email = document.getElementById('signin-email').value.trim();
            const pass  = document.getElementById('signin-password').value;
            const errEl = document.getElementById('signin-error');
            errEl.textContent = '';
            try {
                setLoading('signin-btn', true);
                await DB.signIn(email, pass);
                closeAuthModal();
            } catch (e) {
                errEl.textContent = e.message;
            } finally {
                setLoading('signin-btn', false);
            }
        });

        document.getElementById('signup-btn').addEventListener('click', async () => {
            const username = document.getElementById('signup-username').value.trim();
            const email    = document.getElementById('signup-email').value.trim();
            const pass     = document.getElementById('signup-password').value;
            const errEl    = document.getElementById('signup-error');
            errEl.textContent = '';
            errEl.style.color = '';
            if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
                errEl.textContent = 'Username: 3–20 characters, only letters, numbers and _.';
                return;
            }
            try {
                setLoading('signup-btn', true);
                if (!(await DB.isUsernameAvailable(username))) {
                    errEl.textContent = 'That username is already taken.';
                    return;
                }
                const data = await DB.signUp(email, pass, username);
                track('signup');
                if (data.session) {
                    closeAuthModal();
                } else {
                    errEl.style.color = 'var(--green)';
                    errEl.textContent = 'Account created! Check your email to confirm, then sign in.';
                }
            } catch (e) {
                errEl.textContent = e.message;
            } finally {
                setLoading('signup-btn', false);
            }
        });

        document.getElementById('auth-close').addEventListener('click', () => {
            track('guest_continue');
            closeAuthModal();
        });
        document.getElementById('sign-in-menu-btn').addEventListener('click', openAuthModal);
        document.getElementById('sign-out-btn').addEventListener('click', async () => {
            await DB.signOut();
        });
    }

    async function loadUser(user) {
        currentUser = user;
        if (user) {
            const profile = await DB.getProfile(user.id);
            currentUsername = profile?.username ?? user.email.split('@')[0];
            currentXP       = profile?.total_xp ?? 0;
            updateStreakDisplay(profile?.current_streak ?? 0);
            dailyDone = await DB.hasUserCompletedDaily(user.id, Daily.getTodayISO());
        } else {
            currentUsername = null;
            currentXP       = 0;
            loadGuestDaily();
        }
        updateUserBar();
        updateDailyButton();
    }

    function openAuthModal() {
        if (!DB.isConfigured) { alert('Supabase not configured. Fill in js/config.js first.'); return; }
        document.getElementById('auth-modal').classList.add('active');
    }
    function closeAuthModal() {
        document.getElementById('auth-modal').classList.remove('active');
    }

    function updateUserBar() {
        document.getElementById('user-guest').classList.toggle('hidden', !!currentUser);
        document.getElementById('user-loggedin').classList.toggle('hidden', !currentUser);
        if (currentUser) document.getElementById('user-display-name').textContent = currentUsername;
        updateRankBadge(currentXP);
        refreshBest();
    }

    function updateStreakDisplay(streak) {
        currentStreak = streak;
        document.getElementById('streak-count').textContent = streak;
        document.getElementById('streak-badge').classList.toggle('hidden', !(streak > 0));
    }

    // Guests: daily state and streak live in this browser
    function loadGuestDaily() {
        dailyDone = Daily.guestDone();
        updateStreakDisplay(Daily.guestStreak());
    }

    function setLoading(btnId, loading) {
        const btn = document.getElementById(btnId);
        btn.disabled = loading;
        btn.textContent = loading ? '...' : (btnId === 'signin-btn' ? 'Sign in' : 'Create account');
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    function initMenu() {
        loadPrefs();

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.id === 'community-mode-btn' && !DB.isConfigured) {
                    alert('Community mode needs Supabase configured in js/config.js.');
                    return;
                }
                settings.mode = btn.dataset.mode;
                savePrefs();
                refreshMenu();
            });
        });

        document.querySelectorAll('[data-diff]').forEach(btn => {
            btn.addEventListener('click', () => {
                settings.difficulty = btn.dataset.diff;
                savePrefs();
                refreshMenu();
            });
        });

        document.querySelectorAll('[data-time]').forEach(btn => {
            btn.addEventListener('click', () => {
                settings.timeLimit = parseInt(btn.dataset.time, 10);
                savePrefs();
                refreshMenu();
            });
        });

        document.getElementById('start-btn').addEventListener('click', startGame);
        document.getElementById('play-teaser').textContent = teaserQuestion();
        initSoundToggles();
        document.getElementById('daily-mode-btn').addEventListener('click', startDaily);

        // Back on the menu after a daily: Play uses the remembered settings again
        document.addEventListener('screenchange', e => {
            if (e.detail !== 'menu') return;
            loadPrefs();
            refreshMenu();
        });
        document.getElementById('leaderboard-btn').addEventListener('click', showLeaderboard);
        document.getElementById('history-btn').addEventListener('click', showHistory);
        const notifBtn = document.getElementById('notif-btn');
        notifBtn.classList.toggle('hidden', !PUSH_REMINDERS);
        if (PUSH_REMINDERS) notifBtn.addEventListener('click', requestNotificationPermission);

        // Daily mode setup
        document.getElementById('daily-date-label').textContent = Daily.getDateLabel();
        updateDailyButton();
        // Keep the "next daily" countdown and the today strip current while the menu is open
        setInterval(() => {
            if (!document.getElementById('screen-menu').classList.contains('active')) return;
            document.getElementById('daily-date-label').textContent = Daily.getDateLabel();
            updateDailyButton();
            refreshToday();
        }, 60000);
    }

    // A taste of the game on the Play card, new on every load: "47 × 8 = ?"
    function teaserQuestion() {
        const pick = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
        let a;
        do { a = pick(12, 49); } while (a % 10 === 0);
        return `${a} × ${pick(3, 9)} = ?`;
    }

    function updateDailyButton() {
        const done    = dailyDone;
        const badge   = document.getElementById('daily-done-badge');
        const desc    = document.getElementById('daily-mode-desc');
        const btn     = document.getElementById('daily-mode-btn');
        badge.classList.toggle('hidden', !done);
        btn.classList.toggle('done', done);
        desc.textContent  = done          ? `Done ✓ Next one in ${timeToNextDaily()}`
                          : !currentUser  ? '20 questions, a new set every day'
                          :                 '20 questions, the same for everyone';
    }

    // The daily resets at 00:00 UTC
    function timeToNextDaily() {
        const now  = new Date();
        const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
        const mins = Math.max(1, Math.ceil((next - now) / 60000));
        const h = Math.floor(mins / 60), m = mins % 60;
        return h > 0 ? `${h} h ${m} min` : `${m} min`;
    }

    // The daily starts straight from its card and doesn't change the remembered mode
    function startDaily() {
        if (dailyDone || countdownActive) return;
        settings.mode = 'daily';
        startGame();
    }

    // ── Sound switch (menu and game screen) ───────────────────────────────────

    // Speaker icon; the state is in aria-pressed, the name stays "Sound"
    const SPEAKER = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>';
    const ICON_ON  = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${SPEAKER}` +
                     '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const ICON_OFF = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${SPEAKER}` +
                     '<path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    function initSoundToggles() {
        const buttons = document.querySelectorAll('.sound-toggle');
        const render  = () => buttons.forEach(b => {
            b.innerHTML = Sound.isEnabled() ? ICON_ON : ICON_OFF;
            b.setAttribute('aria-pressed', String(Sound.isEnabled()));
            b.title = Sound.isEnabled() ? 'Sound on' : 'Sound off';
        });
        buttons.forEach(b => b.addEventListener('click', () => { Sound.toggle(); render(); }));
        render();
    }

    // ── Remembered settings ───────────────────────────────────────────────────

    const PREFS_KEY  = 'quantquiz_prefs';
    const MENU_MODES = ['classic', 'sprint', 'zen', 'community'];

    function loadPrefs() {
        try {
            const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
            settings.mode       = MENU_MODES.includes(p.mode) ? p.mode : 'classic';
            if (['easy', 'medium', 'hard'].includes(p.difficulty)) settings.difficulty = p.difficulty;
            if ([30, 60, 90].includes(p.timeLimit))                settings.timeLimit  = p.timeLimit;
        } catch {
            settings.mode = 'classic';
        }
    }

    function savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                mode: settings.mode, difficulty: settings.difficulty, timeLimit: settings.timeLimit,
            }));
        } catch { /* private mode: settings just aren't remembered */ }
    }

    function describeSettings() {
        const diff = settings.difficulty;
        switch (settings.mode) {
            case 'sprint':    return `Sprint, 10 questions, ${diff}`;
            case 'zen':       return `Zen, no clock, ${diff}`;
            case 'community': return 'Community problems';
            default:          return `Classic, ${settings.timeLimit} seconds, ${diff}`;
        }
    }

    function refreshMenu() {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === settings.mode));
        document.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('active', b.dataset.diff === settings.difficulty));
        document.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.time, 10) === settings.timeLimit));
        document.getElementById('play-config').textContent = describeSettings();
        updateTimeSectionVisibility();
        refreshBest();
        refreshToday();
    }

    function updateTimeSectionVisibility() {
        const isClassic   = settings.mode === 'classic';
        const hideSettings = settings.mode === 'daily' || settings.mode === 'community';
        document.getElementById('settings-row').classList.toggle('hidden', hideSettings);
        document.getElementById('time-section').classList.toggle('hidden', !isClassic);
    }

    function refreshBest() {
        UI.updateBestDisplay(formatBest(settings.mode, settings.difficulty, settings.timeLimit));
    }

    // ── Push notifications ────────────────────────────────────────────────────

    function initServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {
                // Fails silently on file:// — will work when hosted on HTTPS
            });
        }
    }

    async function requestNotificationPermission() {
        if (!('Notification' in window)) {
            alert('Your browser does not support notifications.');
            return;
        }
        const permission = await Notification.requestPermission();
        const btn = document.getElementById('notif-btn');
        if (permission === 'granted') {
            btn.textContent = '🔔✓';
            btn.style.color = 'var(--green)';
            new Notification('QuantQuiz', { body: 'Notifications are on.', icon: '/icons/icon-192.png' });
        } else {
            btn.textContent = '🔕';
        }
    }

    // ── Countdown ─────────────────────────────────────────────────────────────

    function runCountdown() {
        return new Promise(resolve => {
            const overlay = document.getElementById('countdown-overlay');
            const numEl   = document.getElementById('countdown-number');

            function show(n) {
                numEl.textContent = n === 0 ? 'GO!' : String(n);
                numEl.style.animation = 'none';
                numEl.offsetHeight;
                numEl.style.animation = '';
                Sound.countdown(n);
            }

            overlay.classList.add('active');
            let n = 3;
            show(n);

            const iv = setInterval(() => {
                n--;
                if (n === 0) {
                    show(0);
                    setTimeout(() => {
                        overlay.classList.remove('active');
                        clearInterval(iv);
                        countdownActive = false;
                        resolve();
                    }, 650);
                } else if (n > 0) {
                    show(n);
                }
            }, 900);
        });
    }

    // ── Game start ────────────────────────────────────────────────────────────

    async function startGame() {
        if (countdownActive) return;
        if (settings.mode === 'daily' && dailyDone) return;

        countdownActive = true;
        stopTimers();
        session = null;
        UI.showScreen('game');
        await runCountdown();

        // Questions are fetched after the countdown so the server clock starts with the game
        const gameSettings = { ...settings };
        try {
            if (settings.mode === 'daily' && !currentUser) {
                // Guests: local question set, the attempt is used up on start
                updateStreakDisplay(Daily.markGuestStarted());
                dailyDone = true;
                updateDailyButton();
                gameSettings.predefinedQuestions = Daily.guestQuestions();
            } else if (settings.mode === 'daily') {
                session   = await DB.startDaily();
                dailyDone = true;
                updateDailyButton();
                gameSettings.predefinedQuestions = session.questions;
            } else if (settings.mode === 'community') {
                const qs = await DB.getCommunityQuestions(20);
                if (!qs.length) {
                    alert('No community problems yet. Check back soon!');
                    UI.showScreen('menu');
                    return;
                }
                gameSettings.predefinedQuestions = qs;
            } else if ((settings.mode === 'classic' || settings.mode === 'sprint') && currentUser) {
                session = await DB.startGame(settings.mode, settings.difficulty, settings.timeLimit);
                gameSettings.predefinedQuestions = session.questions;
            }
        } catch (e) {
            if (settings.mode === 'daily') {
                if (String(e.message).includes('daily_already_played')) {
                    dailyDone = true;
                    updateDailyButton();
                    alert("You've already played today's daily challenge.");
                } else {
                    alert('Could not start the daily challenge. Check your connection and try again.');
                }
                UI.showScreen('menu');
                return;
            }
            session = null;   // play locally; finishGame reports that the score wasn't saved
        }

        Sound.gameStart();
        UI.showCombo(1);
        track('game_start', {
            mode:       settings.mode,
            difficulty: settings.mode === 'daily' ? 'mixed' : settings.difficulty,
            time:       settings.mode === 'classic' ? settings.timeLimit : 0,
        });
        const state = Game.start(gameSettings);
        UI.updateHUD(state);
        UI.showQuestion(Game.getCurrentQuestion());

        if (settings.mode === 'classic') {
            UI.updateTimer(state.timeLeft, state.totalTime);
            startClassicTimer(state.totalTime);
        } else if (settings.mode === 'sprint' || settings.mode === 'daily' || settings.mode === 'community') {
            const total = state.totalQuestions;
            UI.updateSprintProgress(0, total);
        } else {
            zenElapsed = 0;
            UI.updateZenTimer(0);
            document.getElementById('progress-fill').style.width = '100%';
            zenTimer = setInterval(() => { zenElapsed++; UI.updateZenTimer(zenElapsed); }, 1000);
        }

        document.getElementById('answer-input').focus();
    }

    function startClassicTimer(totalTime) {
        classicTimer = setInterval(() => {
            const result = Game.tick();
            if (!result) return;
            UI.updateTimer(result.timeLeft, totalTime);
            if (result.timeLeft > 0 && result.timeLeft <= 5) Sound.tick(result.timeLeft);
            if (result.gameOver) { stopTimers(); finishGame(result.state); }
        }, 1000);
    }

    // ── Answer submission ─────────────────────────────────────────────────────

    function initAnswerInput() {
        const input  = document.getElementById('answer-input');
        const submit = document.getElementById('submit-btn');

        function handleSubmit() {
            const value = parseInt(input.value, 10);
            if (isNaN(value)) return;
            input.value = '';

            const result = Game.submitAnswer(value);
            if (!result) return;

            if (result.correct) {
                if (result.state.streak > 0 && result.state.streak % 3 === 0) {
                    Sound.streakMilestone(Math.floor(result.state.streak / 3));
                } else {
                    Sound.correct(result.state.streak);
                }
            } else {
                Sound.wrong();
            }

            UI.showFeedback(result.correct, result.pointsEarned, result.multiplier, result.correctAnswer);
            UI.updateHUD(result.state);
            if (result.leveledUp) UI.flashLevelUp(result.state.level);

            const isCountable = settings.mode === 'sprint' || settings.mode === 'daily' || settings.mode === 'community';
            if (isCountable) {
                UI.updateSprintProgress(result.state.questionIdx, result.state.totalQuestions);
            }

            if (result.gameOver) {
                stopTimers();
                setTimeout(() => finishGame(result.state), 400);
            } else {
                setTimeout(() => { UI.showQuestion(Game.getCurrentQuestion()); input.focus(); }, 160);
            }
        }

        input.addEventListener('keydown',  e => { if (e.key === 'Enter') handleSubmit(); });
        [input, document.getElementById('duel-input')].forEach(el => el.addEventListener('input', () => {
            el.classList.remove('typed');
            void el.offsetWidth;
            el.classList.add('typed');
        }));
        submit.addEventListener('click', handleSubmit);
    }

    // ── Game end ──────────────────────────────────────────────────────────────

    const REJECT_MESSAGES = {
        implausible_speed:  'Score not saved: answers came in faster than humanly possible.',
        session_expired:    'Score not saved: the game took too long to submit.',
        finished_too_early: 'Score not saved: the game ended too early.',
        incomplete:         'Score not saved: not all questions were answered.',
        too_many_answers:   'Score not saved: invalid game data.',
    };

    function setSaveStatus(text, color = 'muted') {
        const el = document.getElementById('save-status');
        el.textContent = text;
        el.style.color = `var(--${color})`;
    }

    async function finishGame(state) {
        const elapsed   = Game.elapsedSeconds();
        const submitBtn = document.getElementById('submit-problem-btn');

        // Save to local history (all modes)
        saveGameHistory(state, elapsed);

        let isNewBest = false;
        let prevBest  = null;
        if (state.mode === 'classic' || state.mode === 'sprint' || state.mode === 'zen') {
            const bestValue = state.mode === 'sprint' ? parseFloat(elapsed) : state.score;
            prevBest  = getBest(state.mode, state.difficulty, settings.timeLimit);
            isNewBest = setBest(state.mode, state.difficulty, settings.timeLimit, bestValue);
            refreshBest();
        }
        const progress = recordRound();
        lastResult = { state, elapsed };

        // A real new best (not the very first round) gets the fanfare and confetti
        const celebrate = isNewBest && prevBest !== null && state.score > 0;
        if (celebrate) Sound.newBest(); else Sound.gameEnd();
        UI.showResults(state, elapsed, { isNewBest, prevBest, celebrate });
        if (progress.goalJustMet) setTimeout(() => Sound.goal(), celebrate ? 1100 : 600);
        refreshToday();
        updateResultButtons(state.mode, isNewBest ? null : prevBest);
        prepareShareCard();

        const answered = state.correct + state.wrong;
        track('game_end', {
            mode:     state.mode,
            score:    state.score,
            accuracy: answered ? Math.round((state.correct / answered) * 100) : 0,
        });
        if (state.mode === 'daily') track('daily_played');
        submitBtn.classList.toggle('hidden', !(currentUser && canSubmit(currentXP)));
        setSaveStatus('');

        if (!session) {
            // Zen and community are practice modes: no leaderboard, no XP
            if (state.mode === 'zen' || state.mode === 'community') return;
            if (currentUser)          setSaveStatus('Offline: score not saved.', 'red');
            else if (state.mode === 'daily') setSaveStatus('Sign in to save your streak and rank.');
            else if (DB.isConfigured) setSaveStatus('Sign in to compete on the leaderboard');
            return;
        }

        const { sessionId } = session;
        session = null;
        setSaveStatus(state.mode === 'daily' ? 'Saving daily score...' : 'Saving score...');

        try {
            const res = await DB.submitGame(sessionId, state.answers);
            if (!res.ok) {
                setSaveStatus(REJECT_MESSAGES[res.reason] ?? 'Score not saved.', 'red');
                return;
            }

            const oldRank = getRankForXP(res.old_xp);
            const newRank = getRankForXP(res.total_xp);
            currentXP = res.total_xp;
            updateRankBadge(currentXP);
            if (newRank.name !== oldRank.name) setTimeout(() => UI.showRankUp(oldRank, newRank), 600);
            updateStreakDisplay(res.current_streak);
            submitBtn.classList.toggle('hidden', !canSubmit(currentXP));

            if (state.mode === 'sprint') {
                // Show the server-measured time, which is what the leaderboard uses
                document.getElementById('res-hero').textContent = res.elapsed + 's';
                document.getElementById('res-time').textContent = res.elapsed + 's';
                lastResult.elapsed = String(res.elapsed);
            }

            prepareShareCard();

            if (state.mode === 'daily')                           setSaveStatus('Daily score saved! ✓', 'green');
            else if (state.mode === 'sprint' && res.correct < 10) setSaveStatus('Saved ✓ · Sprint leaderboard needs 10/10 correct', 'green');
            else                                                  setSaveStatus('Score saved to leaderboard ✓', 'green');
        } catch {
            setSaveStatus('Could not save score.', 'red');
        }
    }

    // ── Leaderboard ───────────────────────────────────────────────────────────

    function showLeaderboard() {
        if (!DB.isConfigured) {
            alert('Fill in js/config.js with your Supabase credentials first.');
            return;
        }
        const validLbModes = ['global', 'classic', 'sprint', 'daily'];
        lb.mode = validLbModes.includes(settings.mode) ? settings.mode : 'classic';
        lb.difficulty = settings.difficulty;
        lb.timeLimit  = settings.timeLimit;
        syncLbFilterUI();
        UI.showScreen('leaderboard');
        loadLeaderboard();
    }

    function syncLbFilterUI() {
        document.querySelectorAll('[data-lb-mode]').forEach(b =>
            b.classList.toggle('active', b.dataset.lbMode === lb.mode));
        document.querySelectorAll('[data-lb-diff]').forEach(b =>
            b.classList.toggle('active', b.dataset.lbDiff === lb.difficulty));
        document.querySelectorAll('[data-lb-time]').forEach(b =>
            b.classList.toggle('active', parseInt(b.dataset.lbTime) === lb.timeLimit));
        const showTime = lb.mode === 'classic';
        const showDiff = lb.mode !== 'daily' && lb.mode !== 'global';
        document.getElementById('lb-time-section').classList.toggle('hidden', !showTime);
        document.querySelectorAll('[data-lb-diff]').forEach(b =>
            b.closest('.section')?.classList.toggle('hidden', !showDiff));
    }

    function initLeaderboard() {
        document.getElementById('lb-back').addEventListener('click', () => UI.showScreen('menu'));

        document.querySelectorAll('[data-lb-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-lb-mode]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                lb.mode = btn.dataset.lbMode;
                syncLbFilterUI();
                loadLeaderboard();
            });
        });

        document.querySelectorAll('[data-lb-diff]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-lb-diff]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                lb.difficulty = btn.dataset.lbDiff;
                loadLeaderboard();
            });
        });

        document.querySelectorAll('[data-lb-time]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-lb-time]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                lb.timeLimit = parseInt(btn.dataset.lbTime, 10);
                loadLeaderboard();
            });
        });
    }

    async function loadLeaderboard() {
        const list = document.getElementById('lb-list');
        list.innerHTML = '<p class="lb-empty">Loading...</p>';

        try {
            let rows;
            if (lb.mode === 'global') {
                rows = await DB.getGlobalLeaderboard();
            } else if (lb.mode === 'daily') {
                rows = await DB.getDailyLeaderboard(Daily.getTodayISO());
            } else {
                rows = await DB.getLeaderboard(lb.mode, lb.difficulty, lb.timeLimit);
            }

            if (rows.length === 0) {
                list.innerHTML = '<p class="lb-empty">No scores yet. Be the first!</p>';
                return;
            }

            list.innerHTML = rows.map((row, i) => {
                const username  = row.username ?? 'anonymous';
                const pos       = i + 1;
                const isMe      = currentUsername && username === currentUsername;
                const medal     = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `#${pos}`;

                let primary, secondary, rankBadge = '';
                if (lb.mode === 'global') {
                    const r  = getRankForXP(row.total_xp ?? 0);
                    rankBadge = `<span class="rank-badge ${r.cls}" style="font-size:0.62rem;margin-left:0.3rem">${r.icon} ${r.name}</span>`;
                    primary   = (row.total_xp ?? 0) + ' XP';
                    secondary = `streak ${row.current_streak ?? 0} days`;
                } else if (lb.mode === 'sprint') {
                    primary   = row.elapsed_seconds.toFixed(2) + 's';
                    secondary = `${row.correct}/10 correct`;
                } else if (lb.mode === 'daily') {
                    primary   = row.score + ' pts';
                    secondary = `${row.correct}/${row.correct + row.wrong} correct · ${row.elapsed_seconds.toFixed(1)}s`;
                } else {
                    primary   = row.score + ' pts';
                    secondary = `streak ×${row.best_streak}`;
                }

                return `
                    <div class="lb-row ${isMe ? 'lb-row-me' : ''}">
                        <span class="lb-rank">${medal}</span>
                        <span class="lb-name">
                            <button type="button" class="lb-name-link" data-username="${escapeHtml(username)}">${escapeHtml(username)}${isMe ? ' (you)' : ''}</button>${rankBadge}
                        </span>
                        <div class="lb-scores">
                            <span class="lb-primary">${primary}</span>
                            <span class="lb-secondary">${secondary}</span>
                        </div>
                    </div>`;
            }).join('');

            list.querySelectorAll('.lb-name-link').forEach(el => {
                el.addEventListener('click', () => showProfile(el.dataset.username));
            });
        } catch (e) {
            list.innerHTML = `<p class="lb-empty" style="color:var(--red)">Failed to load: ${escapeHtml(e.message)}</p>`;
        }
    }

    // ── Duel ─────────────────────────────────────────────────────────────────

    let _duelPlayerIdx = 0;
    let _duelDuration  = 60;
    let _duelVsBot     = false;
    let _duelAwaiting  = false;   // answer sent, waiting for the server's verdict
    let _duelLastTick  = 0;
    let _duelWatchdog  = null;

    function showDuelPhase(phase) {
        document.getElementById('duel-searching').classList.toggle('hidden', phase !== 'searching');
        document.getElementById('duel-active').classList.toggle('hidden',    phase !== 'active');
        document.getElementById('duel-result').classList.toggle('hidden',    phase !== 'result');
        if (phase !== 'active') stopDuelWatchdog();
        if (phase === 'result' && duelScreenActive()) UI.focusHeading(document.getElementById('screen-duel'));
    }

    function duelScreenActive() {
        return document.getElementById('screen-duel').classList.contains('active');
    }

    function currentDuelPhase() {
        return ['searching', 'active', 'result'].find(p =>
            !document.getElementById(`duel-${p}`).classList.contains('hidden'));
    }

    function showDuelProblem(icon, title) {
        showDuelPhase('result');
        document.getElementById('duel-result-icon').textContent  = icon;
        document.getElementById('duel-result-title').textContent = title;
    }

    // No timer tick for a while = the connection died without a disconnect event
    function startDuelWatchdog() {
        stopDuelWatchdog();
        _duelLastTick = Date.now();
        _duelWatchdog = setInterval(() => {
            if (Date.now() - _duelLastTick < 6000) return;
            DuelClient.disconnect();
            showDuelProblem('⚠️', 'Connection lost');
        }, 1000);
    }

    function stopDuelWatchdog() {
        if (_duelWatchdog) { clearInterval(_duelWatchdog); _duelWatchdog = null; }
    }

    function initDuel() {
        document.getElementById('duel-btn').addEventListener('click', startDuelSearch);
        document.getElementById('cancel-duel-btn').addEventListener('click', () => {
            DuelClient.cancelMatch();
            DuelClient.disconnect();   // also leaves a match that formed at the same moment
            UI.showScreen('menu');
        });
        document.getElementById('forfeit-btn').addEventListener('click', () => {
            if (!confirm('Give up this duel?')) return;
            DuelClient.forfeit();
            UI.showScreen('menu');
        });
        document.getElementById('duel-again-btn').addEventListener('click', startDuelSearch);
        document.getElementById('duel-menu-btn').addEventListener('click', () => {
            DuelClient.disconnect();
            UI.showScreen('menu');
        });
        document.getElementById('challenge-btn').addEventListener('click', createChallenge);

        // Online-only parts: friend challenges and emoji reactions (the bot doesn't react)
        const online = DuelClient.isOnline();
        document.getElementById('duel-btn').textContent = online ? 'Duel a player' : 'Duel the bot';
        document.getElementById('challenge-btn').classList.toggle('hidden', !online);
        document.querySelector('.reaction-bar').classList.toggle('hidden', !online);

        // Duel answer input
        const duelInput  = document.getElementById('duel-input');
        const duelSubmit = document.getElementById('duel-submit-btn');

        function handleDuelSubmit() {
            if (_duelAwaiting) return;   // a double Enter would be graded against the next question
            const val = parseInt(duelInput.value, 10);
            if (isNaN(val)) return;
            _duelAwaiting = true;
            DuelClient.submitAnswer(val);
            duelInput.value = '';
        }

        duelInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleDuelSubmit(); });
        duelSubmit.addEventListener('click', handleDuelSubmit);

        // Socket event handlers
        DuelClient.on('connect_error', () => {
            DuelClient.disconnect();
            UI.showScreen('menu');
            alert('Could not connect to the duel server. Please try again in a moment.');
        });

        DuelClient.on('duel_error', ({ message }) => {
            DuelClient.disconnect();
            UI.showScreen('menu');
            alert(message);
        });

        DuelClient.on('searching', () => {
            setSearchText('Finding Opponent', 'Waiting for another player...');
            document.getElementById('duel-pre-search').classList.remove('hidden');
            document.getElementById('duel-pre-countdown').classList.add('hidden');
        });

        DuelClient.on('challenge_created', async ({ code }) => {
            const url = new URL(location.origin + location.pathname);
            url.searchParams.set('duel', code);
            url.searchParams.set('utm_source', 'share');
            url.searchParams.set('utm_campaign', 'duel');
            _challengeLink = url.toString();

            setSearchText('Waiting for your friend', 'Send them the link. It works without an account and stays valid for 10 minutes.');
            document.getElementById('challenge-btn').textContent = '🔗 Share invite link';
            // Not triggered by a tap, so mobile browsers may refuse; then the button does it
            await shareChallengeLink({ fromTap: false });
        });

        DuelClient.on('matched', ({ you, opponent, opponentIsBot, offline, playerIdx, firstQuestion, duration }) => {
            track('duel_matched', { opponent: opponentIsBot ? 'bot' : 'human' });
            _duelPlayerIdx = playerIdx;
            _duelDuration  = duration || 60;
            _duelVsBot     = !!opponentIsBot;

            const myName  = you || currentUsername || 'You';
            const oppName = opponentIsBot ? `🤖 ${opponent}` : opponent;
            document.getElementById('duel-my-name').textContent  = myName;
            document.getElementById('duel-opp-name').textContent = oppName;
            document.getElementById('dr-my-name').textContent    = myName;
            document.getElementById('dr-opp-name').textContent   = oppName;
            document.getElementById('duel-opp-found').textContent = oppName;
            document.getElementById('duel-found-label').textContent =
                offline       ? 'Online duels are coming soon. Warm up against our bot!' :
                opponentIsBot ? 'Nobody online right now. Warm up against a bot!' :
                                'Opponent found!';
            document.getElementById('duel-question').textContent  = firstQuestion.display;

            // Switch to countdown sub-phase
            document.getElementById('duel-pre-search').classList.add('hidden');
            document.getElementById('duel-pre-countdown').classList.remove('hidden');
            UI.focusHeading(document.getElementById('screen-duel'));
        });

        DuelClient.on('countdown', n => {
            const el = document.getElementById('duel-countdown-num');
            el.textContent = n === 0 ? 'GO!' : String(n);
            Sound.countdown(n);
        });

        DuelClient.on('duel_start', () => {
            // Reset HUD
            ['duel-my-score','duel-opp-score'].forEach(id => document.getElementById(id).textContent = '0');
            ['duel-my-correct','duel-opp-correct'].forEach(id => document.getElementById(id).textContent = '0 ✓');
            document.getElementById('duel-timer').textContent = _duelDuration;
            document.getElementById('duel-timer').style.color = '';
            document.getElementById('duel-progress').style.width = '100%';
            _duelAwaiting = false;
            showDuelPhase('active');
            startDuelWatchdog();
            document.getElementById('duel-input').focus();
        });

        DuelClient.on('answer_result', ({ correct, correctAnswer, pointsEarned, multiplier, score, nextQuestion }) => {
            const input = document.getElementById('duel-input');
            const fb    = document.getElementById('duel-feedback');

            document.getElementById('duel-my-score').textContent = score;

            UI.flashCard(document.querySelector('#duel-active .question-card'), correct);
            if (correct) {
                const bonus = multiplier > 1 ? ` ×${multiplier}` : '';
                fb.textContent = `✓ Correct +${pointsEarned}${bonus}`;
                fb.className   = 'feedback correct';
                input.classList.add('correct');
                Sound.correct();
            } else {
                fb.textContent = `✗ Wrong, it's ${correctAnswer}`;
                fb.className   = 'feedback wrong';
                input.classList.add('wrong');
                Sound.wrong();
            }

            setTimeout(() => {
                if (nextQuestion) document.getElementById('duel-question').textContent = nextQuestion.display;
                input.className = '';
                fb.textContent  = ' ';
                fb.className    = 'feedback';
                _duelAwaiting   = false;
                input.focus();
            }, 160);
        });

        DuelClient.on('opponent_update', ({ score, correct }) => {
            document.getElementById('duel-opp-score').textContent   = score;
            document.getElementById('duel-opp-correct').textContent = correct + ' ✓';
            // Flash to show they answered
            const el = document.getElementById('duel-opp-score');
            el.style.color = 'var(--accent2)';
            setTimeout(() => el.style.color = '', 350);
        });

        DuelClient.on('timer_tick', ({ timeLeft }) => {
            _duelLastTick = Date.now();
            const el = document.getElementById('duel-timer');
            el.textContent = timeLeft;
            el.style.color = timeLeft <= 20 ? 'var(--yellow)' : '';
            document.getElementById('duel-progress').style.width = `${(timeLeft / _duelDuration) * 100}%`;
        });

        DuelClient.on('duel_end', ({ winner, reason, players }) => {
            track('duel_finished', {
                result: winner === -1 ? 'draw' : winner === _duelPlayerIdx ? 'win' : 'loss',
                reason,
                opponent: _duelVsBot ? 'bot' : 'human',
            });
            const me  = players[_duelPlayerIdx];
            const opp = players[1 - _duelPlayerIdx];

            document.getElementById('dr-my-score').textContent    = me.score;
            document.getElementById('dr-opp-score').textContent   = opp.score;
            document.getElementById('dr-my-correct').textContent  = me.correct + ' ✓';
            document.getElementById('dr-opp-correct').textContent = opp.correct + ' ✓';

            const isTie  = winner === -1;
            const isWin  = winner === _duelPlayerIdx;
            const oppLeft = isWin && (reason === 'disconnect' || reason === 'forfeit');

            document.getElementById('duel-result-icon').textContent  = isTie ? '🤝' : isWin ? '🏆' : '💀';
            document.getElementById('duel-result-title').textContent =
                isTie ? 'Draw!' : oppLeft ? 'Opponent left. You win!' : isWin ? 'Victory!' : 'Defeat';

            showDuelPhase('result');
            UI.announce(`${document.getElementById('duel-result-title').textContent} ${me.score} to ${opp.score}.`);
            DuelClient.disconnect();
        });

        DuelClient.on('disconnect', reason => {
            if (reason === 'io client disconnect' || !duelScreenActive()) return;   // we left on purpose
            const phase = currentDuelPhase();
            if (phase === 'active') {
                showDuelProblem('⚠️', 'Disconnected');
            } else if (phase === 'searching') {
                UI.showScreen('menu');
                alert('Lost connection to the duel server. Please try again.');
            }
        });

        DuelClient.on('match_cancelled', () => {
            DuelClient.disconnect();
            if (duelScreenActive()) UI.showScreen('menu');
        });

        DuelClient.on('reaction', ({ emoji }) => {
            spawnReaction(emoji);
        });

        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                DuelClient.sendReaction(btn.dataset.emoji);
            });
        });
    }

    function setSearchText(title, sub) {
        document.getElementById('duel-search-title').textContent = title;
        document.getElementById('duel-search-sub').textContent   = sub;
    }

    function spawnReaction(emoji) {
        const overlay = document.getElementById('reaction-overlay');
        const el      = document.createElement('div');
        el.className  = 'reaction-float';
        el.textContent = emoji;
        el.style.left  = `${20 + Math.random() * 60}%`;
        el.style.top   = `${30 + Math.random() * 30}%`;
        overlay.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
    }

    function enterDuelSearch(title, sub) {
        DuelClient.disconnect(); // clean up any previous connection
        _challengeLink = null;
        showDuelPhase('searching');
        setSearchText(title, sub);
        document.getElementById('challenge-btn').textContent = '🔗 Challenge a friend';
        document.getElementById('duel-pre-search').classList.remove('hidden');
        document.getElementById('duel-pre-countdown').classList.add('hidden');
        UI.showScreen('duel');
    }

    // Guests can duel too; signed-in players are identified by their token
    async function startDuelSearch() {
        enterDuelSearch('Finding Opponent', 'Waiting for another player...');
        track('duel_search_started');
        DuelClient.findMatch(await DB.getAccessToken(), settings.difficulty);
    }

    // ── Challenge links ───────────────────────────────────────────────────────

    let _challengeLink = null;

    async function createChallenge() {
        if (!DuelClient.isOnline()) return;
        if (_challengeLink) { await shareChallengeLink({ fromTap: true }); return; }
        DuelClient.createChallenge(await DB.getAccessToken(), settings.difficulty);
    }

    async function shareChallengeLink({ fromTap }) {
        if (!_challengeLink) return;
        const result = await shareOrCopy(
            `Can you beat me at mental math? ⚔️ Duel me on QuantQuiz: ${_challengeLink}`,
            { allowPrompt: fromTap },
        );
        const sub = document.getElementById('duel-search-sub');
        if (result === 'copied') {
            sub.textContent = 'Link copied! Send it to a friend. It works without an account and stays valid for 10 minutes.';
        } else if (result === 'failed' && !fromTap) {
            sub.textContent = 'Tap "Share invite link" to send it to a friend. No account needed, valid for 10 minutes.';
        }
    }

    // Opened via ?duel=CODE: join the friend's duel right away
    async function joinChallengeFromUrl() {
        const params = new URLSearchParams(location.search);
        const code   = params.get('duel');
        if (!code) return;

        params.delete('duel');
        const rest = params.toString();
        history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));

        if (!DuelClient.isOnline()) {
            alert('Online duels are coming soon! Until then, tap ⚔️ to duel our bot.');
            return;
        }

        enterDuelSearch('Joining duel', 'Connecting to your friend...');
        track('duel_search_started', { via: 'challenge' });
        DuelClient.joinChallenge(await DB.getAccessToken(), code.slice(0, 12));
    }

    // Web Share API with clipboard fallback → 'shared' | 'copied' | 'failed'.
    // allowPrompt: as a last resort show the text to copy by hand (only after a tap).
    async function shareOrCopy(text, { allowPrompt = true } = {}) {
        if (navigator.share) {
            try {
                await navigator.share({ text });
                return 'shared';
            } catch (e) {
                if (e?.name === 'AbortError') return 'failed';   // user closed the share sheet
            }
        }
        try {
            await navigator.clipboard.writeText(text);
            return 'copied';
        } catch {
            if (allowPrompt) prompt('Copy this:', text);
            return 'failed';
        }
    }

    // ── History ───────────────────────────────────────────────────────────────

    function showHistory() {
        const hist = JSON.parse(localStorage.getItem('quantquiz_history') || '[]');
        UI.renderHistory(hist);
        UI.showScreen('history');
    }

    function initHistory() {
        document.getElementById('history-back').addEventListener('click', () => UI.showScreen('menu'));
    }

    // ── Share ─────────────────────────────────────────────────────────────────

    const DIFF_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

    // Link back to the app, tagged so shares show up in analytics
    function shareLink(mode) {
        const url = new URL(location.origin + location.pathname);
        url.searchParams.set('utm_source', 'share');
        url.searchParams.set('utm_campaign', mode);
        return url.toString();
    }

    // Wordle-style result text, e.g.
    // "QuantQuiz Daily Oct 5 · 18/20 ✅ · 42s · 🔥 Streak 5\n🟩🟩🟥…\nBeat me: <link>"
    function buildShareText(state, elapsed) {
        const answered = state.correct + state.wrong;
        const acc      = answered ? Math.round((state.correct / answered) * 100) : 0;
        const secs     = Math.round(parseFloat(elapsed));
        const diff     = DIFF_NAMES[state.difficulty] ?? '';
        let line;

        if (state.mode === 'daily') {
            const parts = [`QuantQuiz Daily ${Daily.getDateLabel()}`, `${state.correct}/${state.totalQuestions} ✅`, `${secs}s`];
            if (currentStreak > 0) parts.push(`🔥 Streak ${currentStreak}`);
            const squares = state.answeredQuestions.map(q => q.correct ? '🟩' : '🟥');
            const rows = [];
            for (let i = 0; i < squares.length; i += 10) rows.push(squares.slice(i, i + 10).join(''));
            line = [parts.join(' · '), ...rows].join('\n');
        } else if (state.mode === 'sprint') {
            line = `QuantQuiz Sprint (${diff}) · ${state.correct}/10 ✅ in ${parseFloat(elapsed).toFixed(1)}s`;
        } else if (state.mode === 'classic') {
            line = `QuantQuiz ${state.totalTime}s (${diff}) · ${state.score} pts · ${state.correct} ✅ · ${acc}%`;
        } else {
            line = `QuantQuiz ${state.mode === 'zen' ? 'Zen' : 'Community'} · ${state.correct} ✅ · ${acc}%`;
        }
        return `${line}\nBeat me: ${shareLink(state.mode)}`;
    }

    // Facts for the image card (js/share-card.js); same numbers as the text
    function buildCardData(state, elapsed) {
        const answered = state.correct + state.wrong;
        const acc      = answered ? Math.round((state.correct / answered) * 100) : 0;
        const secs     = parseFloat(elapsed);
        const diff     = (DIFF_NAMES[state.difficulty] ?? '').toLowerCase();
        const host     = new URL(shareLink(state.mode)).host;
        const streak   = currentStreak > 0 ? [['Day streak', String(currentStreak)]] : [];
        const grid     = state.answeredQuestions.map(q => q.correct);

        switch (state.mode) {
            case 'daily':
                return { title: 'Daily challenge', date: Daily.getDateLabel(),
                         headline: `${state.correct}/${state.totalQuestions}`, headlineLabel: 'correct',
                         stats: [['Time', `${Math.round(secs)}s`], ['Accuracy', `${acc}%`], ...streak], grid, host };
            case 'sprint':
                return { title: `Sprint, ${diff}`, date: '10 questions',
                         headline: `${secs.toFixed(1)}s`, headlineLabel: `${state.correct} of 10 correct`,
                         stats: [['Accuracy', `${acc}%`], ['Best streak', String(state.bestStreak)], ...streak], grid, host };
            case 'classic':
                return { title: `Classic, ${diff}`, date: `${state.totalTime} seconds`,
                         headline: String(state.score), headlineLabel: 'points',
                         stats: [['Correct', String(state.correct)], ['Accuracy', `${acc}%`], ...streak], grid: null, host };
            default:
                return { title: state.mode === 'zen' ? 'Zen' : 'Community problems', date: null,
                         headline: String(state.correct), headlineLabel: 'correct answers',
                         stats: [['Accuracy', `${acc}%`], ['Best streak', String(state.bestStreak)]], grid: null, host };
        }
    }

    // Rendered ahead of the tap: iOS only opens the share sheet right after a tap
    function prepareShareCard() {
        const result = lastResult;
        if (!result) return;
        result.cardFile = null;
        ShareCard.render(buildCardData(result.state, result.elapsed))
            .then(blob => {
                if (blob && lastResult === result) {
                    result.cardFile = new File([blob], 'quantquiz-result.png', { type: 'image/png' });
                }
            })
            .catch(() => { /* text sharing still works */ });
    }

    function initShare() {
        const btn = document.getElementById('share-btn');
        btn.addEventListener('click', async () => {
            if (!lastResult) return;
            const text = buildShareText(lastResult.state, lastResult.elapsed);
            const file = lastResult.cardFile;
            track('share_clicked', { mode: lastResult.state.mode, image: !!file });

            if (file && navigator.canShare?.({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], text });
                    return;
                } catch (e) {
                    if (e?.name === 'AbortError') return;   // closed the share sheet
                }
            }
            const result = await shareOrCopy(text);
            if (result === 'copied') {
                btn.textContent = 'Copied! ✓';
                setTimeout(() => { btn.textContent = '↗ Share'; }, 2000);
            }
        });
    }

    // Daily results put Share front and centre; Play Again only leads back to the menu there
    // Play Again names the target when there is a best still to beat
    function updateResultButtons(mode, bestToBeat) {
        const isDaily = mode === 'daily';
        const share   = document.getElementById('share-btn');
        share.classList.toggle('btn-primary',   isDaily);
        share.classList.toggle('btn-secondary', !isDaily);
        share.textContent = '↗ Share';
        const again = document.getElementById('play-again-btn');
        again.classList.toggle('hidden', isDaily);
        again.textContent = bestToBeat === null || mode === 'zen' ? 'Play again'
                          : mode === 'sprint' ? `Play again · beat ${bestToBeat}s`
                          :                     `Play again · beat ${bestToBeat}`;
    }

    // ── Profile modal ─────────────────────────────────────────────────────────

    function initProfileModal() {
        document.getElementById('profile-close-btn').addEventListener('click', () => {
            document.getElementById('profile-modal').classList.remove('active');
        });
    }

    async function showProfile(username) {
        document.getElementById('profile-username').textContent = username;
        document.getElementById('profile-xp').textContent      = '...';
        document.getElementById('profile-streak').textContent  = '...';
        document.getElementById('profile-longest').textContent = '...';
        document.getElementById('profile-rank').innerHTML      = '';
        document.getElementById('profile-modal').classList.add('active');

        const data = await DB.getUserProfileByUsername(username);
        if (!data) return;

        const rank = getRankForXP(data.total_xp ?? 0);
        document.getElementById('profile-xp').textContent      = data.total_xp ?? 0;
        document.getElementById('profile-streak').textContent  = data.current_streak ?? 0;
        document.getElementById('profile-longest').textContent = data.longest_streak ?? 0;
        document.getElementById('profile-rank').innerHTML =
            `<span class="rank-badge ${rank.cls}">${rank.icon} ${rank.name}</span>`;
    }

    // ── Submit Problem ────────────────────────────────────────────────────────

    function initSubmitProblem() {
        const modal  = document.getElementById('submit-modal');
        const aInput = document.getElementById('submit-a');
        const bInput = document.getElementById('submit-b');
        const prev   = document.getElementById('submit-preview-ans');
        const msgEl  = document.getElementById('submit-msg');

        function updatePreview() {
            const a = parseInt(aInput.value, 10);
            const b = parseInt(bInput.value, 10);
            prev.textContent = (!isNaN(a) && !isNaN(b)) ? `= ${a * b}` : '= ?';
        }
        aInput.addEventListener('input', updatePreview);
        bInput.addEventListener('input', updatePreview);

        document.getElementById('submit-problem-btn').addEventListener('click', () => {
            if (!currentUser) { openAuthModal(); return; }
            aInput.value = ''; bInput.value = ''; prev.textContent = '= ?'; msgEl.textContent = '';
            modal.classList.add('active');
            aInput.focus();
        });

        document.getElementById('submit-close-btn').addEventListener('click', () => modal.classList.remove('active'));

        document.getElementById('submit-confirm-btn').addEventListener('click', async () => {
            const a = parseInt(aInput.value, 10);
            const b = parseInt(bInput.value, 10);
            if (isNaN(a) || isNaN(b) || a < 2 || b < 2 || a > 999 || b > 999) {
                msgEl.style.color = 'var(--red)';
                msgEl.textContent = 'Both numbers must be between 2 and 999.';
                return;
            }
            msgEl.style.color = 'var(--muted)';
            msgEl.textContent = 'Submitting...';
            try {
                await DB.submitCommunityQuestion(a, b);
                msgEl.style.color = 'var(--green)';
                msgEl.textContent = 'Submitted! It will appear after review ✓';
                setTimeout(() => modal.classList.remove('active'), 1800);
            } catch (e) {
                msgEl.style.color = 'var(--red)';
                msgEl.textContent = e.message;
            }
        });
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    function initNav() {
        document.getElementById('quit-btn').addEventListener('click', () => {
            if (settings.mode === 'daily' &&
                !confirm("Quit the daily challenge? Today's attempt will be used up.")) return;
            session = null;
            stopTimers();
            UI.showScreen('menu');
            refreshBest();
        });
        document.getElementById('play-again-btn').addEventListener('click', () => {
            // Don't allow replay of daily or community
            if (settings.mode === 'daily' || settings.mode === 'community') { UI.showScreen('menu'); return; }
            startGame();
        });
        document.getElementById('menu-btn').addEventListener('click', () => {
            UI.showScreen('menu');
            refreshBest();
        });
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    function stopTimers() {
        if (classicTimer) { clearInterval(classicTimer); classicTimer = null; }
        if (zenTimer)     { clearInterval(zenTimer);     zenTimer     = null; }
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    async function init() {
        UI.mountNumpads();
        UI.initDialogs();
        UI.initPressedState();
        initMenu();
        initAnswerInput();
        initNav();
        initAuth();
        initLeaderboard();
        initDuel();
        initServiceWorker();
        initHistory();
        initSubmitProblem();
        initShare();
        initProfileModal();
        loadGuestDaily();   // replaced by the account's state once a signed-in user arrives
        refreshMenu();
        updateRankBadge(currentXP);
        updateDailyButton();
        refreshBest();
        UI.showScreen('menu');
        // The signed-in user (if any) arrives via onAuthChange → loadUser
        joinChallengeFromUrl();
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
