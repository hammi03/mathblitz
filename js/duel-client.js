/**
 * duel-client.js — Frontend Socket.io wrapper for duels.
 * Keeps all socket logic out of main.js.
 */
const DuelClient = (() => {

    const SERVER = typeof DUEL_SERVER_URL !== 'undefined'
        ? DUEL_SERVER_URL
        : 'http://localhost:3001';

    let socket    = null;
    let handlers  = {};

    function on(event, fn) { handlers[event] = fn; }

    function _dispatch(event, data) {
        if (handlers[event]) handlers[event](data);
    }

    function connect() {
        if (socket?.connected) return;

        socket = io(SERVER, {
            transports: ['websocket'],
            reconnection: false,
        });

        const events = [
            'searching', 'matched', 'countdown', 'duel_start',
            'answer_result', 'opponent_update', 'timer_tick',
            'duel_end', 'match_cancelled',
        ];
        events.forEach(e => socket.on(e, data => _dispatch(e, data)));

        socket.on('connect_error', err => _dispatch('connect_error', err));
        socket.on('disconnect',    ()  => _dispatch('disconnect'));
    }

    function disconnect() {
        socket?.disconnect();
        socket = null;
        // handlers are kept — they were registered once during init
    }

    function findMatch(username) {
        connect();
        socket.emit('find_match', { username });
    }

    function cancelMatch()        { socket?.emit('cancel_match'); }
    function submitAnswer(answer) { socket?.emit('submit_answer', { answer }); }
    function forfeit()            { socket?.emit('forfeit'); disconnect(); }

    return { on, connect, disconnect, findMatch, cancelMatch, submitAnswer, forfeit };
})();
