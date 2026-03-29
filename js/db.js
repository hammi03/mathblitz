/**
 * db.js — All Supabase operations: auth, scores, leaderboard, daily, streaks.
 */

const SUPABASE_CONFIGURED =
    typeof SUPABASE_URL !== 'undefined' &&
    SUPABASE_URL !== 'YOUR_PROJECT_URL';

const _client = SUPABASE_CONFIGURED
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

const DB = (() => {

    // ── Auth ──────────────────────────────────────────────────────────────────

    async function signUp(email, password, username) {
        if (!_client) throw new Error('Supabase not configured');
        const { data, error } = await _client.auth.signUp({
            email, password, options: { data: { username } },
        });
        if (error) throw error;
        return data;
    }

    async function signIn(email, password) {
        if (!_client) throw new Error('Supabase not configured');
        const { data, error } = await _client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    }

    async function signOut() {
        if (!_client) return;
        const { error } = await _client.auth.signOut();
        if (error) throw error;
    }

    async function getUser() {
        if (!_client) return null;
        const { data: { user } } = await _client.auth.getUser();
        return user;
    }

    async function getProfile(userId) {
        if (!_client) return null;
        const { data } = await _client
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        return data;
    }

    function onAuthChange(callback) {
        if (!_client) return { data: { subscription: { unsubscribe: () => {} } } };
        return _client.auth.onAuthStateChange((event, session) => {
            callback(event, session?.user ?? null);
        });
    }

    // ── Regular scores ────────────────────────────────────────────────────────

    async function saveScore(userId, gameState, elapsed, settings) {
        if (!_client) return;
        const { error } = await _client.from('scores').insert({
            user_id:         userId,
            mode:            gameState.mode,
            difficulty:      gameState.difficulty,
            time_limit:      settings.timeLimit ?? 60,
            score:           gameState.score,
            correct:         gameState.correct,
            wrong:           gameState.wrong,
            best_streak:     gameState.bestStreak,
            elapsed_seconds: parseFloat(elapsed),
        });
        if (error) throw error;

        // Update cumulative total_xp in profile
        const { data: pData } = await _client
            .from('profiles').select('total_xp').eq('id', userId).single();
        const newXP = (pData?.total_xp || 0) + gameState.score;
        await _client.from('profiles').update({ total_xp: newXP }).eq('id', userId);
    }

    // ── Streaks ───────────────────────────────────────────────────────────────

    async function updateStreak(userId) {
        if (!_client || !userId) return null;

        const { data: profile } = await _client
            .from('profiles')
            .select('current_streak, longest_streak, last_played_date')
            .eq('id', userId)
            .single();

        if (!profile) return null;

        const today     = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        // Already played today — don't reset or increment
        if (profile.last_played_date === today) {
            return { current: profile.current_streak, longest: profile.longest_streak };
        }

        const newStreak = profile.last_played_date === yesterday
            ? (profile.current_streak || 0) + 1
            : 1;
        const longest = Math.max(newStreak, profile.longest_streak || 0);

        await _client
            .from('profiles')
            .update({ current_streak: newStreak, longest_streak: longest, last_played_date: today })
            .eq('id', userId);

        return { current: newStreak, longest };
    }

    // ── Daily challenge ───────────────────────────────────────────────────────

    async function saveDailyScore(userId, gameState, elapsed) {
        if (!_client) return;
        const today = new Date().toISOString().split('T')[0];
        const { error } = await _client.from('daily_scores').upsert({
            user_id:         userId,
            date:            today,
            score:           gameState.score,
            correct:         gameState.correct,
            wrong:           gameState.wrong,
            best_streak:     gameState.bestStreak,
            elapsed_seconds: parseFloat(elapsed),
        }, { onConflict: 'user_id,date' });
        if (error) throw error;
    }

    async function getDailyLeaderboard(date, limit = 25) {
        if (!_client) return [];
        const { data, error } = await _client
            .from('daily_scores')
            .select('score, elapsed_seconds, correct, wrong, best_streak, profiles(username)')
            .eq('date', date)
            .order('score', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data ?? [];
    }

    // ── Community questions ───────────────────────────────────────────────────

    async function getCommunityQuestions(limit = 20) {
        if (!_client) return [];
        const { data, error } = await _client
            .from('community_questions')
            .select('question_text, answer')
            .eq('approved', true)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) return [];
        return (data ?? []).map(q => ({ display: q.question_text, answer: q.answer }));
    }

    async function submitCommunityQuestion(userId, a, b) {
        if (!_client) throw new Error('Supabase not configured');
        const { error } = await _client.from('community_questions').insert({
            submitted_by:  userId,
            question_text: `${a} × ${b}`,
            answer:        a * b,
            approved:      false,
        });
        if (error) throw error;
    }

    async function hasUserCompletedDaily(userId, date) {
        if (!_client || !userId) return false;
        const { data } = await _client
            .from('daily_scores')
            .select('id')
            .eq('user_id', userId)
            .eq('date', date)
            .single();
        return !!data;
    }

    // ── Global leaderboard ────────────────────────────────────────────────────

    async function getLeaderboard(mode, difficulty, timeLimit, limit = 25) {
        if (!_client) return [];

        let query = _client
            .from('scores')
            .select('score, elapsed_seconds, correct, wrong, best_streak, created_at, profiles(username)')
            .eq('mode', mode)
            .eq('difficulty', difficulty);

        if (mode === 'classic') query = query.eq('time_limit', timeLimit);

        query = mode === 'sprint'
            ? query.order('elapsed_seconds', { ascending: true })
            : query.order('score', { ascending: false });

        const { data, error } = await query.limit(limit);
        if (error) throw error;
        return data ?? [];
    }

    async function getGlobalLeaderboard(limit = 25) {
        if (!_client) return [];
        const { data, error } = await _client
            .from('profiles')
            .select('username, total_xp, current_streak, longest_streak')
            .order('total_xp', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data ?? [];
    }

    async function getUserProfileByUsername(username) {
        if (!_client) return null;
        const { data } = await _client
            .from('profiles')
            .select('username, total_xp, current_streak, longest_streak')
            .eq('username', username)
            .single();
        return data;
    }

    return {
        isConfigured: SUPABASE_CONFIGURED,
        signUp, signIn, signOut, getUser, getProfile, onAuthChange,
        saveScore, updateStreak,
        saveDailyScore, getDailyLeaderboard, hasUserCompletedDaily,
        getLeaderboard, getGlobalLeaderboard, getUserProfileByUsername,
        getCommunityQuestions, submitCommunityQuestion,
    };
})();
