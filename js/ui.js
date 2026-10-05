/**
 * ui.js — All DOM reads/writes live here.
 * Nothing here knows about game rules.
 */

// Escape any user- or server-provided text before putting it into innerHTML
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

const UI = (() => {

    const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Restart a CSS animation class on an element
    function replay(el, cls) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
    }

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
        window.scrollTo(0, 0);
        document.dispatchEvent(new CustomEvent('screenchange', { detail: name }));
    }

    // ── Game HUD ──────────────────────────────────────────────────────────────

    function updateHUD(state) {
        document.getElementById('score-display').textContent  = state.score;
        const streakEl = document.getElementById('streak-display');
        streakEl.textContent = state.streak;
        // 🔥 from 3 in a row, hotter at 6 and 9 (same steps as the score multiplier)
        streakEl.dataset.heat = String(Math.min(Math.floor(state.streak / 3), 3));
        document.getElementById('level-display').textContent  = state.level;
    }

    function updateTimer(timeLeft, totalTime) {
        document.getElementById('timer-label').textContent = 'Time';   // may still say "Done" after a sprint
        document.getElementById('timer-display').textContent = timeLeft;
        document.getElementById('progress-fill').style.width = `${(timeLeft / totalTime) * 100}%`;
        const el = document.getElementById('timer-display');
        if      (timeLeft <= 10) el.style.color = 'var(--red)';
        else if (timeLeft <= 20) el.style.color = 'var(--yellow)';
        else                     el.style.color = 'var(--accent)';
    }

    function updateSprintProgress(answered, total) {
        document.getElementById('timer-label').textContent   = 'Done';
        document.getElementById('timer-display').textContent = `${answered}/${total}`;
        document.getElementById('timer-display').style.color = 'var(--accent)';
        document.getElementById('progress-fill').style.width = `${(answered / total) * 100}%`;
        document.getElementById('progress-fill').style.transition = 'width 0.2s ease';
    }

    function updateZenTimer(elapsed) {
        document.getElementById('timer-label').textContent   = 'Time';
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

    // Correct: the card flashes ball-yellow; wrong: it shakes
    function flashCard(card, correct) {
        replay(card, correct ? 'hit' : 'miss');
    }

    function showCombo(multiplier) {
        const el = document.getElementById('combo');
        if (multiplier > 1) {
            const text = `×${multiplier} combo`;
            if (el.textContent !== text) { el.textContent = text; replay(el, 'pop'); }
            el.classList.add('on');
        } else {
            el.classList.remove('on');
        }
    }

    function showFeedback(correct, pointsEarned, multiplier, correctAnswer) {
        const fb    = document.getElementById('feedback');
        const input = document.getElementById('answer-input');
        flashCard(document.getElementById('question-card'), correct);
        showCombo(correct ? multiplier : 1);

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
        el.style.left = `${rect.right + 6}px`;   // beside the score, not over its label
        el.style.top  = `${rect.top}px`;

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
            document.getElementById('results-sub').textContent   = 'Sprint, 10 questions';
        } else {
            document.getElementById('results-title').textContent = 'Game Over';
            document.getElementById('results-sub').textContent   =
                state.mode === 'classic' ? `Classic, ${state.totalTime} seconds` :
                state.mode === 'daily'   ? 'Daily challenge' :
                state.mode === 'community' ? 'Community problems' : 'Zen session';
        }

        document.getElementById('res-time').textContent = elapsed + 's';
        document.getElementById('new-best').style.display = isNewBest ? 'block' : 'none';
        showScreen('results');

        countUp('res-score',    state.score);
        countUp('res-correct',  state.correct);
        countUp('res-wrong',    state.wrong);
        countUp('res-accuracy', accuracy, '%');
        countUp('res-streak',   state.bestStreak);
    }

    // Results tick up from 0 like a scoreboard (instant with reduced motion)
    function countUp(id, target, suffix = '') {
        const el = document.getElementById(id);
        if (reduceMotion() || target <= 0) { el.textContent = target + suffix; return; }
        const duration = 700;
        const start = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
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
        Sound.rankUp();
        setTimeout(() => overlay.classList.remove('active'), 2800);
    }

    // ── History screen ────────────────────────────────────────────────────────

    const MODE_LABEL = { classic: 'Classic', sprint: 'Sprint', zen: 'Zen', daily: 'Daily', community: 'Community' };
    const DIFF_LABEL = { easy: 'easy', medium: 'medium', hard: 'hard' };

    function renderHistory(entries) {
        const list = document.getElementById('history-list');
        if (!entries.length) {
            list.innerHTML = '<p class="lb-empty">No games yet.</p>';
            return;
        }
        list.innerHTML = entries.map((e, i) => {
            const date    = new Date(e.ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const mode    = MODE_LABEL[e.mode] ?? escapeHtml(e.mode);
            const diff    = DIFF_LABEL[e.diff] ?? '';
            const elapsed = e.mode === 'sprint' ? ` · ${e.elapsed}s` : '';
            const total   = e.correct + e.wrong;
            const acc     = total > 0 ? Math.round((e.correct / total) * 100) : 0;

            const qaHtml = e.questions && e.questions.length
                ? `<div class="history-qa">` +
                  e.questions.map(q =>
                      `<div class="history-qa-item ${q.correct ? 'correct-q' : 'wrong-q'}">
                          <span>${escapeHtml(q.display)}</span>
                          <span>${escapeHtml(q.correct ? '✓ ' + q.answer : '✗ ' + q.given + ' → ' + q.answer)}</span>
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
                        <span class="history-score">${escapeHtml(e.score)} pts</span>
                    </div>
                    <span class="history-meta">${escapeHtml(`${e.correct}✓ ${e.wrong}✗ · ${acc}% · streak ×${e.streak}${elapsed} · ${date}`)}</span>
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
        flashCard,
        showCombo,
        showRankUp,
        renderHistory,
    };
})();
