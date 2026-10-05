/**
 * db.js — All Supabase operations: auth, game sessions, leaderboard, daily.
 * Scores, XP and streaks are computed server-side (see supabase-security.sql).
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
            // Deferred: awaiting Supabase calls inside this callback can deadlock the auth client
            setTimeout(() => callback(event, session?.user ?? null), 0);
        });
    }

    async function getAccessToken() {
        if (!_client) return null;
        const { data } = await _client.auth.getSession();
        return data.session?.access_token ?? null;
    }

    async function isUsernameAvailable(username) {
        if (!_client) return true;
        const { data, error } = await _client.rpc('username_available', { p_username: username });
        if (error) return true;   // let the signup trigger decide
        return data;
    }

    // ── Games — questions and scoring happen server-side ──────────────────────

    function toQuestions(raw) {
        return raw.map(q => ({ display: `${q.a} × ${q.b}`, answer: q.a * q.b }));
    }

    async function startGame(mode, difficulty, timeLimit) {
        if (!_client) throw new Error('Supabase not configured');
        const { data, error } = await _client.rpc('start_game', {
            p_mode: mode, p_difficulty: difficulty, p_time_limit: timeLimit,
        });
        if (error) throw error;
        return { sessionId: data.session_id, questions: toQuestions(data.questions) };
    }

    async function startDaily() {
        if (!_client) throw new Error('Supabase not configured');
        const { data, error } = await _client.rpc('start_daily');
        if (error) throw error;
        return { sessionId: data.session_id, questions: toQuestions(data.questions) };
    }

    // Returns { ok, reason?, score, correct, wrong, elapsed, old_xp, total_xp, current_streak, ... }
    async function submitGame(sessionId, answers) {
        if (!_client) throw new Error('Supabase not configured');
        const MAX_INT = 2147483647;
        const { data, error } = await _client.rpc('submit_game', {
            p_session: sessionId,
            p_answers: answers.map(a => Math.abs(a) > MAX_INT ? -1 : a),
        });
        if (error) throw error;
        return data;
    }

    // ── Daily challenge ───────────────────────────────────────────────────────

    async function getDailyLeaderboard(date, limit = 25) {
        if (!_client) return [];
        const { data, error } = await _client
            .from('daily_scores')
            .select('score, elapsed_seconds, correct, wrong, best_streak, profiles(username)')
            .eq('date', date)
            .not('completed_at', 'is', null)
            .order('score', { ascending: false })
            .order('elapsed_seconds', { ascending: true })
            .limit(limit);
        if (error) throw error;
        return (data ?? []).map(r => ({ ...r, username: r.profiles?.username }));
    }

    // True once the user has *started* today's daily (one attempt per day)
    async function hasUserCompletedDaily(userId, date) {
        if (!_client || !userId) return false;
        const { data } = await _client
            .from('daily_scores')
            .select('id')
            .eq('user_id', userId)
            .eq('date', date)
            .maybeSingle();
        return !!data;
    }

    // ── Community questions ───────────────────────────────────────────────────

    async function getCommunityQuestions(count = 20) {
        if (!_client) return [];
        const { data, error } = await _client
            .from('community_questions')
            .select('question_text, answer')
            .eq('approved', true)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) return [];
        const qs = (data ?? []).map(q => ({ display: q.question_text, answer: q.answer }));
        for (let i = qs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [qs[i], qs[j]] = [qs[j], qs[i]];
        }
        return qs.slice(0, count);
    }

    async function submitCommunityQuestion(a, b) {
        if (!_client) throw new Error('Supabase not configured');
        const { error } = await _client.rpc('submit_community_question', { p_a: a, p_b: b });
        if (error) throw error;
    }

    // ── Global leaderboard ────────────────────────────────────────────────────

    async function getLeaderboard(mode, difficulty, timeLimit, limit = 25) {
        if (!_client) return [];
        const { data, error } = await _client.rpc('get_leaderboard', {
            p_mode: mode, p_difficulty: difficulty, p_time_limit: timeLimit, p_limit: limit,
        });
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
            .maybeSingle();
        return data;
    }

    return {
        isConfigured: SUPABASE_CONFIGURED,
        signUp, signIn, signOut, getUser, getProfile, onAuthChange,
        getAccessToken, isUsernameAvailable,
        startGame, startDaily, submitGame,
        getDailyLeaderboard, hasUserCompletedDaily,
        getLeaderboard, getGlobalLeaderboard, getUserProfileByUsername,
        getCommunityQuestions, submitCommunityQuestion,
    };
})();
