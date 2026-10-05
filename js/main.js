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
            dailyDone       = false;
            updateStreakDisplay(0);
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
        document.getElementById('streak-count').textContent = streak;
        document.getElementById('streak-badge').style.display = streak > 0 ? 'inline-flex' : 'none';
    }

    function setLoading(btnId, loading) {
        const btn = document.getElementById(btnId);
        btn.disabled = loading;
        btn.textContent = loading ? '...' : (btnId === 'signin-btn' ? 'SIGN IN' : 'CREATE ACCOUNT');
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    function initMenu() {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.id === 'daily-mode-btn' && !currentUser && DB.isConfigured) { openAuthModal(); return; }
                if (btn.id === 'daily-mode-btn' && dailyDone) return;
                if (btn.id === 'community-mode-btn' && !DB.isConfigured) {
                    alert('Community mode needs Supabase configured in js/config.js.');
                    return;
                }
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                settings.mode = btn.dataset.mode;
                updateTimeSectionVisibility();
                refreshBest();
            });
        });

        document.querySelectorAll('[data-diff]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-diff]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                settings.difficulty = btn.dataset.diff;
                refreshBest();
            });
        });

        document.querySelectorAll('[data-time]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-time]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                settings.timeLimit = parseInt(btn.dataset.time, 10);
                refreshBest();
            });
        });

        document.getElementById('start-btn').addEventListener('click', startGame);
        document.getElementById('leaderboard-btn').addEventListener('click', showLeaderboard);
        document.getElementById('history-btn').addEventListener('click', showHistory);
        document.getElementById('notif-btn').addEventListener('click', requestNotificationPermission);

        // Daily mode setup
        document.getElementById('daily-date-label').textContent = Daily.getDateLabel();
        updateDailyButton();
    }

    function updateDailyButton() {
        const done    = !!currentUser && dailyDone;
        const badge   = document.getElementById('daily-done-badge');
        const desc    = document.getElementById('daily-mode-desc');
        const btn     = document.getElementById('daily-mode-btn');
        badge.classList.toggle('hidden', !done);
        btn.style.opacity = done ? '0.5' : '1';
        btn.style.cursor  = done ? 'default' : 'pointer';
        desc.textContent  = done          ? 'Come back tomorrow!'
                          : !currentUser  ? 'sign in to play · same for everyone'
                          :                 '20 questions · same for everyone';

        // Switch away from daily if it can't be played right now
        if (settings.mode === 'daily' && (done || !currentUser)) {
            document.querySelector('.mode-btn[data-mode="classic"]').click();
        }
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

    // ── Themes ───────────────────────────────────────────────────────────────

    function applyTheme(theme) {
        [...document.body.classList]
            .filter(c => c.startsWith('theme-'))
            .forEach(c => document.body.classList.remove(c));
        if (theme !== 'void') document.body.classList.add(`theme-${theme}`);
        document.querySelectorAll('.theme-dot').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.theme === theme));
        ThemeBG.apply(theme);
    }

    function initThemes() {
        ThemeBG.init();
        const saved = localStorage.getItem('quantquiz_theme') || 'void';
        applyTheme(saved);
        document.querySelectorAll('.theme-dot').forEach(btn => {
            btn.addEventListener('click', () => {
                applyTheme(btn.dataset.theme);
                localStorage.setItem('quantquiz_theme', btn.dataset.theme);
            });
        });
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
            // Show a test notification
            new Notification('QuantQuiz', {
                body: "Notifications enabled! We'll remind you about the daily challenge.",
                icon: '/icon.png',
            });
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
        if (settings.mode === 'daily' && (!currentUser || dailyDone)) return;

        countdownActive = true;
        stopTimers();
        session = null;
        UI.showScreen('game');
        await runCountdown();

        // Questions are fetched after the countdown so the server clock starts with the game
        const gameSettings = { ...settings };
        try {
            if (settings.mode === 'daily') {
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
                    Sound.correct();
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
        if (state.mode === 'classic' || state.mode === 'sprint' || state.mode === 'zen') {
            const bestValue = state.mode === 'sprint' ? parseFloat(elapsed) : state.score;
            isNewBest = setBest(state.mode, state.difficulty, settings.timeLimit, bestValue);
            refreshBest();
        }
        UI.showResults(state, elapsed, isNewBest);

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
                document.getElementById('results-title').textContent = res.elapsed + 's';
                document.getElementById('res-time').textContent      = res.elapsed + 's';
            }

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
                            <span class="lb-name-link" data-username="${escapeHtml(username)}">${escapeHtml(username)}${isMe ? ' (you)' : ''}</span>${rankBadge}
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

    function showDuelPhase(phase) {
        document.getElementById('duel-searching').classList.toggle('hidden', phase !== 'searching');
        document.getElementById('duel-active').classList.toggle('hidden',    phase !== 'active');
        document.getElementById('duel-result').classList.toggle('hidden',    phase !== 'result');
    }

    function initDuel() {
        document.getElementById('duel-btn').addEventListener('click', startDuelSearch);
        document.getElementById('cancel-duel-btn').addEventListener('click', () => {
            DuelClient.cancelMatch();
            UI.showScreen('menu');
        });
        document.getElementById('forfeit-btn').addEventListener('click', () => {
            DuelClient.forfeit();
            UI.showScreen('menu');
        });
        document.getElementById('duel-again-btn').addEventListener('click', startDuelSearch);
        document.getElementById('duel-menu-btn').addEventListener('click', () => {
            DuelClient.disconnect();
            UI.showScreen('menu');
        });

        // Duel answer input
        const duelInput  = document.getElementById('duel-input');
        const duelSubmit = document.getElementById('duel-submit-btn');

        function handleDuelSubmit() {
            const val = parseInt(duelInput.value, 10);
            if (isNaN(val)) return;
            DuelClient.submitAnswer(val);
            duelInput.value = '';
        }

        duelInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleDuelSubmit(); });
        duelSubmit.addEventListener('click', handleDuelSubmit);

        // Socket event handlers
        DuelClient.on('connect_error', () => {
            UI.showScreen('menu');
            alert('Could not connect to the duel server. Please try again in a moment.');
        });

        DuelClient.on('duel_error', ({ message }) => {
            DuelClient.disconnect();
            UI.showScreen('menu');
            alert(message);
        });

        DuelClient.on('searching', () => {
            document.getElementById('duel-pre-search').classList.remove('hidden');
            document.getElementById('duel-pre-countdown').classList.add('hidden');
        });

        DuelClient.on('matched', ({ opponent, playerIdx, firstQuestion }) => {
            track('duel_matched');
            _duelPlayerIdx = playerIdx;
            document.getElementById('duel-my-name').textContent  = currentUsername || 'You';
            document.getElementById('duel-opp-name').textContent = opponent;
            document.getElementById('dr-my-name').textContent    = currentUsername || 'You';
            document.getElementById('dr-opp-name').textContent   = opponent;
            document.getElementById('duel-opp-found').textContent = opponent;
            document.getElementById('duel-question').textContent  = firstQuestion.display;

            // Switch to countdown sub-phase
            document.getElementById('duel-pre-search').classList.add('hidden');
            document.getElementById('duel-pre-countdown').classList.remove('hidden');
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
            document.getElementById('duel-timer').textContent = '60';
            document.getElementById('duel-timer').style.color = '';
            document.getElementById('duel-progress').style.width = '100%';
            showDuelPhase('active');
            document.getElementById('duel-input').focus();
        });

        DuelClient.on('answer_result', ({ correct, correctAnswer, pointsEarned, multiplier, score, nextQuestion }) => {
            const input = document.getElementById('duel-input');
            const fb    = document.getElementById('duel-feedback');

            document.getElementById('duel-my-score').textContent = score;

            if (correct) {
                const bonus = multiplier > 1 ? ` ×${multiplier}` : '';
                fb.textContent = `+${pointsEarned}${bonus}`;
                fb.className   = 'feedback correct';
                input.classList.add('correct');
                Sound.correct();
            } else {
                fb.textContent = `✗ → ${correctAnswer}`;
                fb.className   = 'feedback wrong';
                input.classList.add('wrong');
                Sound.wrong();
            }

            setTimeout(() => {
                if (nextQuestion) document.getElementById('duel-question').textContent = nextQuestion.display;
                input.value     = '';
                input.className = '';
                fb.textContent  = '\u00A0';
                fb.className    = 'feedback';
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
            const el = document.getElementById('duel-timer');
            el.textContent = timeLeft;
            el.style.color = timeLeft <= 10 ? 'var(--red)' : timeLeft <= 20 ? 'var(--yellow)' : '';
            document.getElementById('duel-progress').style.width = `${(timeLeft / 60) * 100}%`;
        });

        DuelClient.on('duel_end', ({ winner, reason, players }) => {
            track('duel_finished', {
                result: winner === -1 ? 'draw' : winner === _duelPlayerIdx ? 'win' : 'loss',
                reason,
            });
            const me  = players[_duelPlayerIdx];
            const opp = players[1 - _duelPlayerIdx];

            document.getElementById('dr-my-score').textContent    = me.score;
            document.getElementById('dr-opp-score').textContent   = opp.score;
            document.getElementById('dr-my-correct').textContent  = me.correct + ' ✓';
            document.getElementById('dr-opp-correct').textContent = opp.correct + ' ✓';

            const isTie  = winner === -1;
            const isWin  = winner === _duelPlayerIdx;
            const isDisc = reason === 'disconnect' || reason === 'forfeit';

            document.getElementById('duel-result-icon').textContent  = isTie ? '🤝' : isWin ? '🏆' : '💀';
            document.getElementById('duel-result-title').textContent =
                isTie ? 'Draw!' : isWin ? 'Victory!' :
                (isDisc ? 'Opponent left' : 'Defeat');

            showDuelPhase('result');
        });

        DuelClient.on('disconnect', () => {
            // Only act if we were mid-duel
            const active = !document.getElementById('duel-active').classList.contains('hidden');
            if (active) {
                showDuelPhase('result');
                document.getElementById('duel-result-icon').textContent  = '⚠️';
                document.getElementById('duel-result-title').textContent = 'Disconnected';
            }
        });

        DuelClient.on('match_cancelled', () => UI.showScreen('menu'));

        DuelClient.on('reaction', ({ emoji }) => {
            spawnReaction(emoji);
        });

        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                DuelClient.sendReaction(btn.dataset.emoji);
            });
        });
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

    async function startDuelSearch() {
        if (!currentUsername) { openAuthModal(); return; }
        DuelClient.disconnect(); // clean up any previous connection
        showDuelPhase('searching');
        document.getElementById('duel-pre-search').classList.remove('hidden');
        document.getElementById('duel-pre-countdown').classList.add('hidden');
        UI.showScreen('duel');
        // The server looks up the username from this token, so it can't be spoofed
        track('duel_search_started');
        DuelClient.findMatch(await DB.getAccessToken());
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

    function initShare() {
        document.getElementById('share-btn').addEventListener('click', () => {
            track('share_clicked', { mode: settings.mode });
            const score   = document.getElementById('res-score').textContent;
            const correct = document.getElementById('res-correct').textContent;
            const acc     = document.getElementById('res-accuracy').textContent;
            const mode    = settings.mode.charAt(0).toUpperCase() + settings.mode.slice(1);
            const text    = `QuantQuiz ${mode} — ${score} pts | ${correct} correct | ${acc} accuracy\nPlay at https://mathblitz-jade.vercel.app`;

            if (navigator.share) {
                navigator.share({ title: 'QuantQuiz', text }).catch(() => {});
            } else {
                navigator.clipboard.writeText(text).then(() => {
                    const btn = document.getElementById('share-btn');
                    btn.textContent = 'Copied!';
                    setTimeout(() => { btn.textContent = '↗ Share'; }, 2000);
                });
            }
        });
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
            if (session && settings.mode === 'daily' &&
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
        initMenu();
        initAnswerInput();
        initNav();
        initAuth();
        initLeaderboard();
        initDuel();
        initThemes();
        initServiceWorker();
        initHistory();
        initSubmitProblem();
        initShare();
        initProfileModal();
        updateTimeSectionVisibility();
        updateRankBadge(currentXP);
        updateDailyButton();
        refreshBest();
        UI.showScreen('menu');
        // The signed-in user (if any) arrives via onAuthChange → loadUser
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
