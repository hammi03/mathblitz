/**
 * ui.js — All DOM reads/writes live here.
 * Nothing here knows about game rules.
 */
const UI = (() => {

    const screens = {
        menu:        document.getElementById('screen-menu'),
        game:        document.getElementById('screen-game'),
        results:     document.getElementById('screen-results'),
        leaderboard: document.getElementById('screen-leaderboard'),
        duel:        document.getElementById('screen-duel'),
        history:     document.getElementById('screen-history'),
    };

    // ── Screens ───────────────────────────────────────────────────────────────

    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[name].classList.add('active');
    }

    // ── Game HUD ──────────────────────────────────────────────────────────────

    function updateHUD(state) {
        document.getElementById('score-display').textContent  = state.score;
        document.getElementById('streak-display').textContent = state.streak;
        document.getElementById('level-display').textContent  = state.level;
    }

    function updateTimer(timeLeft, totalTime) {
        document.getElementById('timer-display').textContent = timeLeft;
        document.getElementById('progress-fill').style.width = `${(timeLeft / totalTime) * 100}%`;
        const el = document.getElementById('timer-display');
        if      (timeLeft <= 10) el.style.color = 'var(--red)';
        else if (timeLeft <= 20) el.style.color = 'var(--yellow)';
        else                     el.style.color = 'var(--accent)';
    }

    function updateSprintProgress(answered, total) {
        document.getElementById('timer-label').textContent   = 'DONE';
        document.getElementById('timer-display').textContent = `${answered}/${total}`;
        document.getElementById('timer-display').style.color = 'var(--accent)';
        document.getElementById('progress-fill').style.width = `${(answered / total) * 100}%`;
        document.getElementById('progress-fill').style.transition = 'width 0.2s ease';
    }

    function updateZenTimer(elapsed) {
        document.getElementById('timer-label').textContent   = 'TIME';
        document.getElementById('timer-display').textContent = elapsed + 's';
        document.getElementById('timer-display').style.color = 'var(--accent)';
    }

    // ── Question ──────────────────────────────────────────────────────────────

    function showQuestion(question) {
        document.getElementById('question-display').textContent = question.display;
        const input = document.getElementById('answer-input');
        input.value = '';
        input.className = '';
        input.focus();
        clearFeedback();
    }

    // ── Feedback ──────────────────────────────────────────────────────────────

    function showFeedback(correct, pointsEarned, multiplier, correctAnswer) {
        const fb    = document.getElementById('feedback');
        const input = document.getElementById('answer-input');

        if (correct) {
            const bonus = multiplier > 1 ? ` ×${multiplier}` : '';
            fb.textContent = `+${pointsEarned}${bonus}`;
            fb.className   = 'feedback correct';
            input.classList.add('correct');
            spawnScorePop(pointsEarned, multiplier);
        } else {
            fb.textContent = `✗  →  ${correctAnswer}`;
            fb.className   = 'feedback wrong';
            input.classList.add('wrong');
        }
    }

    function clearFeedback() {
        const fb = document.getElementById('feedback');
        fb.textContent = '\u00A0';
        fb.className   = 'feedback';
    }

    // ── Floating score pop ────────────────────────────────────────────────────

    function spawnScorePop(points, multiplier) {
        const el       = document.createElement('div');
        el.className   = 'score-pop';
        el.textContent = multiplier > 1 ? `+${points} ×${multiplier}` : `+${points}`;

        const anchor = document.getElementById('score-display');
        const rect   = anchor.getBoundingClientRect();
        el.style.left = `${rect.left + rect.width / 2 - 24}px`;
        el.style.top  = `${rect.top - 8}px`;

        document.body.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
    }

    // ── Level-up flash ────────────────────────────────────────────────────────

    function flashLevelUp(level) {
        const el = document.getElementById('level-display');
        el.style.color = 'var(--yellow)';
        el.style.transform = 'scale(1.4)';
        setTimeout(() => {
            el.style.color = '';
            el.style.transform = '';
        }, 600);
    }

    // ── Results ───────────────────────────────────────────────────────────────

    function showResults(state, elapsed, isNewBest) {
        const total    = state.correct + state.wrong;
        const accuracy = total > 0 ? Math.round((state.correct / total) * 100) : 0;

        if (state.mode === 'sprint') {
            document.getElementById('results-title').textContent = elapsed + 's';
            document.getElementById('results-sub').textContent   = '10 questions · sprint';
        } else {
            document.getElementById('results-title').textContent = 'Game Over';
            document.getElementById('results-sub').textContent   =
                state.mode === 'classic' ? `${state.totalTime}s classic` : 'zen session';
        }

        document.getElementById('res-score').textContent    = state.score;
        document.getElementById('res-correct').textContent  = state.correct;
        document.getElementById('res-wrong').textContent    = state.wrong;
        document.getElementById('res-accuracy').textContent = accuracy + '%';
        document.getElementById('res-streak').textContent   = state.bestStreak;
        document.getElementById('res-time').textContent     = elapsed + 's';

        document.getElementById('new-best').style.display = isNewBest ? 'block' : 'none';
        showScreen('results');
    }

    function updateBestDisplay(value) {
        document.getElementById('best-display').textContent = value;
    }

    // ── Rank-up overlay ───────────────────────────────────────────────────────

    function showRankUp(oldRank, newRank) {
        const overlay = document.getElementById('rankup-overlay');
        document.getElementById('rankup-icon').textContent = newRank.icon;
        document.getElementById('rankup-name').textContent = newRank.name;
        overlay.classList.add('active');
        setTimeout(() => overlay.classList.remove('active'), 2800);
    }

    // ── History screen ────────────────────────────────────────────────────────

    const MODE_LABEL = { classic: '⚡ Classic', sprint: '🏁 Sprint', zen: '∞ Zen', daily: '📅 Daily', community: '🌐 Community' };
    const DIFF_LABEL = { easy: '💀', medium: '💀💀', hard: '💀💀💀' };

    function renderHistory(entries) {
        const list = document.getElementById('history-list');
        if (!entries.length) {
            list.innerHTML = '<p class="lb-empty">No games yet.</p>';
            return;
        }
        list.innerHTML = entries.map((e, i) => {
            const date    = new Date(e.ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const mode    = MODE_LABEL[e.mode] ?? e.mode;
            const diff    = DIFF_LABEL[e.diff] ?? '';
            const elapsed = e.mode === 'sprint' ? ` · ${e.elapsed}s` : '';
            const total   = e.correct + e.wrong;
            const acc     = total > 0 ? Math.round((e.correct / total) * 100) : 0;

            const qaHtml = e.questions && e.questions.length
                ? `<div class="history-qa">` +
                  e.questions.map(q =>
                      `<div class="history-qa-item ${q.correct ? 'correct-q' : 'wrong-q'}">
                          <span>${q.display}</span>
                          <span>${q.correct ? '✓ ' + q.answer : '✗ ' + q.given + ' → ' + q.answer}</span>
                       </div>`
                  ).join('') +
                  `</div>`
                : '';

            const toggleBtn = e.questions && e.questions.length
                ? `<button class="history-toggle" data-idx="${i}">▼ Questions</button>`
                : '';

            return `
                <div class="history-entry" data-idx="${i}">
                    <div class="history-header">
                        <span class="history-mode">${mode} ${diff}</span>
                        <span class="history-score">${e.score} pts</span>
                    </div>
                    <span class="history-meta">${e.correct}✓ ${e.wrong}✗ · ${acc}% · streak ×${e.streak}${elapsed} · ${date}</span>
                    ${toggleBtn}
                    ${qaHtml}
                </div>`;
        }).join('');

        list.querySelectorAll('.history-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const entry = btn.closest('.history-entry');
                const open  = entry.classList.toggle('expanded');
                btn.textContent = open ? '▲ Questions' : '▼ Questions';
            });
        });
    }

    return {
        showScreen,
        updateHUD,
        updateTimer,
        updateSprintProgress,
        updateZenTimer,
        showQuestion,
        showFeedback,
        showResults,
        updateBestDisplay,
        flashLevelUp,
        showRankUp,
        renderHistory,
    };
})();
