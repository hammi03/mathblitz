/**
 * duel-client.js — Frontend Socket.io wrapper for duels.
 * Keeps all socket logic out of main.js.
 *
 * With DUELS_ONLINE = false (config.js) it never touches the duel server;
 * duels run against BotDuel in the browser, which emits the same events.
 */
const DuelClient = (() => {

    const SERVER = typeof DUEL_SERVER_URL !== 'undefined'
        ? DUEL_SERVER_URL
        : 'http://localhost:3001';

    const ONLINE = typeof DUELS_ONLINE === 'undefined' || DUELS_ONLINE === true;

    let socket    = null;
    let handlers  = {};

    function on(event, fn) { handlers[event] = fn; }

    function _dispatch(event, data) {
        if (handlers[event]) handlers[event](data);
    }

    function isOnline() { return ONLINE; }

    function connect() {
        if (!ONLINE || socket?.connected) return;

        // Default transports: starts with HTTP long-polling and upgrades to
        // WebSocket, so it also works on networks that block WebSockets.
        socket = io(SERVER, { reconnection: false });

        const events = [
            'searching', 'matched', 'countdown', 'duel_start',
            'answer_result', 'opponent_update', 'timer_tick',
            'duel_end', 'match_cancelled', 'reaction', 'duel_error',
            'challenge_created',
        ];
        events.forEach(e => socket.on(e, data => _dispatch(e, data)));

        socket.on('connect_error', err    => _dispatch('connect_error', err));
        socket.on('disconnect',    reason => _dispatch('disconnect', reason));
    }

    function disconnect() {
        BotDuel.stop();
        socket?.disconnect();
        socket = null;
        // handlers are kept — they were registered once during init
    }

    // token = Supabase access token (null for guests); the server derives the name from it
    function findMatch(token, difficulty) {
        if (!ONLINE) { BotDuel.start(difficulty, _dispatch); return; }
        connect();
        socket.emit('find_match', { token, difficulty });
    }

    function createChallenge(token, difficulty) {
        if (!ONLINE) return;
        connect();
        socket.emit('create_challenge', { token, difficulty });
    }

    function joinChallenge(token, code) {
        if (!ONLINE) return;
        connect();
        socket.emit('join_challenge', { token, code });
    }

    function cancelMatch() {
        BotDuel.stop();
        socket?.emit('cancel_match');
    }

    function submitAnswer(answer) {
        if (!ONLINE) { BotDuel.submitAnswer(answer); return; }
        socket?.emit('submit_answer', { answer });
    }

    function forfeit() {
        if (!ONLINE) { BotDuel.forfeit(); return; }
        socket?.emit('forfeit');
        disconnect();
    }

    // The bot doesn't react to emojis
    function sendReaction(emoji) { socket?.emit('send_reaction', { emoji }); }

    return {
        on, isOnline, connect, disconnect, findMatch, createChallenge, joinChallenge,
        cancelMatch, submitAnswer, forfeit, sendReaction,
    };
})();
