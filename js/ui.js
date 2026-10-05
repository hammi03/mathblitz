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
        const fill = document.getElementById('progress-fill');
        fill.style.width = `${(timeLeft / totalTime) * 100}%`;
        const el = document.getElementById('timer-display');
        const color = timeLeft <= 20 ? 'var(--yellow)' : 'var(--accent)';   // orange is kept for mistakes
        el.style.color = color;
        fill.style.background = timeLeft <= 20 ? color : '';
        // Final seconds: the clock beats once per second
        if (timeLeft > 0 && timeLeft <= 5) replay(el, 'beat');
        else el.classList.remove('beat');
    }

    function updateSprintProgress(answered, total) {
        document.getElementById('timer-label').textContent   = 'Done';
        document.getElementById('timer-display').textContent = `${answered}/${total}`;
        document.getElementById('timer-display').style.color = 'var(--accent)';
        document.getElementById('progress-fill').style.background = '';
        document.getElementById('progress-fill').style.width = `${(answered / total) * 100}%`;
        document.getElementById('progress-fill').style.transition = 'width 0.2s ease';
    }

    function updateZenTimer(elapsed) {
        document.getElementById('timer-label').textContent   = 'Time';
        document.getElementById('timer-display').textContent = elapsed + 's';
        document.getElementById('timer-display').style.color = 'var(--accent)';
        document.getElementById('progress-fill').style.background = '';
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

    // Headline for the result: frames it against the personal best (peak-end)
    function verdict(state, elapsed, { isNewBest, prevBest }) {
        const sprint = state.mode === 'sprint';
        const value  = sprint ? parseFloat(elapsed) : state.score;
        if (state.mode === 'daily') return { title: 'Daily done', delta: '' };
        if (isNewBest && prevBest !== null && state.score > 0) {
            const delta = sprint ? `${(prevBest - value).toFixed(1)}s faster than your old best`
                                 : `+${value - prevBest} on your old best`;
            return { title: 'New best!', delta };
        }
        if (prevBest === null || state.mode === 'zen' || state.mode === 'community') {
            return { title: prevBest === null && state.score > 0 ? 'First score set' : 'Round over', delta: '' };
        }
        const gap   = sprint ? value - prevBest : prevBest - value;
        const close = sprint ? gap <= prevBest * 0.15 : gap <= Math.max(10, prevBest * 0.15);
        const shown = sprint ? `${gap.toFixed(1)}s` : String(gap);
        return close
            ? { title: 'So close', delta: `${shown} short of your best (${sprint ? prevBest + 's' : prevBest})` }
            : { title: 'Round over', delta: `Your best: ${sprint ? prevBest + 's' : prevBest}` };
    }

    function showResults(state, elapsed, best) {
        const total    = state.correct + state.wrong;
        const accuracy = total > 0 ? Math.round((state.correct / total) * 100) : 0;
        const sprint   = state.mode === 'sprint';

        document.getElementById('results-sub').textContent =
            state.mode === 'classic'   ? `Classic, ${state.totalTime} seconds, ${state.difficulty}` :
            sprint                     ? `Sprint, 10 questions, ${state.difficulty}` :
            state.mode === 'daily'     ? 'Daily challenge' :
            state.mode === 'community' ? 'Community problems' : 'Zen session';

        const v = verdict(state, elapsed, best);
        const screen = screens.results;
        document.getElementById('results-title').textContent = v.title;
        document.getElementById('res-delta').textContent     = v.delta;
        document.getElementById('res-hero-label').textContent = sprint ? 'seconds' : 'points';
        screen.classList.toggle('is-best',  !!best.celebrate);
        screen.classList.toggle('is-close', v.title === 'So close');

        document.getElementById('res-time').textContent = elapsed + 's';
        showScreen('results');

        if (sprint) document.getElementById('res-hero').textContent = elapsed + 's';
        else        countUp('res-hero', state.score, '', 900);
        countUp('res-correct',  state.correct, `/${total}`);
        countUp('res-accuracy', accuracy, '%');
        countUp('res-streak',   state.bestStreak);

        if (best.celebrate) setTimeout(confetti, 350);
    }

    // ── Confetti: ball-yellow and court-white bits from the score ─────────────

    function confetti() {
        if (reduceMotion()) return;
        const origin = document.getElementById('res-hero').getBoundingClientRect();
        const colors = ['var(--ball)', 'var(--line)', 'var(--amber)', 'var(--rally)'];
        const layer  = document.createElement('div');
        layer.className = 'confetti';
        for (let i = 0; i < 46; i++) {
            const bit   = document.createElement('i');
            const angle = Math.random() * Math.PI * 2;
            const dist  = 90 + Math.random() * 170;
            bit.style.left = `${origin.left + origin.width / 2}px`;
            bit.style.top  = `${origin.top + origin.height / 2}px`;
            bit.style.background = colors[i % colors.length];
            bit.style.setProperty('--dx',  `${Math.cos(angle) * dist}px`);
            bit.style.setProperty('--dy',  `${Math.sin(angle) * dist - 60}px`);
            bit.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
            bit.style.animationDelay = `${Math.random() * 0.08}s`;
            layer.appendChild(bit);
        }
        document.body.appendChild(layer);
        setTimeout(() => layer.remove(), 1600);
    }

    // Results tick up from 0 like a scoreboard (instant with reduced motion)
    function countUp(id, target, suffix = '', duration = 700) {
        const el = document.getElementById(id);
        if (reduceMotion() || target <= 0) { el.textContent = target + suffix; return; }
        const start = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    // Lives inside the Play button; hidden until there is a best to show
    function updateBestDisplay(value) {
        document.getElementById('best-display').textContent = value;
        document.getElementById('play-best').classList.toggle('hidden', value === '—');
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

    // ── Number pad (touch screens) ────────────────────────────────────────────
    // Fills every .numpad with keys that type into its answer field and press its
    // Enter button. On touch screens the system keyboard is suppressed
    // (inputmode="none"); a physical keyboard still types into the field.

    const coarse = () => window.matchMedia?.('(pointer: coarse)').matches;

    function mountNumpads() {
        document.querySelectorAll('.numpad').forEach(pad => {
            const input  = document.getElementById(pad.dataset.input);
            const submit = document.getElementById(pad.dataset.submit);
            if (coarse()) input.setAttribute('inputmode', 'none');

            const keys = [
                ['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'],
                ['−', 'minus', 'Minus'], ['0'], ['⌫', 'del', 'Delete'],
            ];
            pad.innerHTML = keys.map(([label, key = label, aria]) =>
                `<button type="button" class="key" data-key="${key}"${aria ? ` aria-label="${aria}"` : ''}>${label}</button>`
            ).join('') + '<button type="button" class="key key-enter" data-key="enter">Enter</button>';

            // Keep the focus (and caret) in the answer field
            pad.addEventListener('pointerdown', e => { if (e.target.closest('.key')) e.preventDefault(); });
            pad.addEventListener('click', e => {
                const key = e.target.closest('.key')?.dataset.key;
                if (!key) return;
                if (key === 'enter') { submit.click(); return; }
                let v = input.value;
                if      (key === 'del')   v = v.slice(0, -1);
                else if (key === 'minus') v = v.startsWith('-') ? v.slice(1) : '-' + v;
                else if (v.replace('-', '').length < 9) v += key;
                input.value = v;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });

            // Typed or pasted text: digits and one leading minus only
            input.addEventListener('input', () => {
                const clean = input.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '');
                if (clean !== input.value) input.value = clean;
            });
        });
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
        mountNumpads,
    };
})();
