// ── Supabase credentials ──────────────────────────────────────────────────────
const SUPABASE_URL = 'https://luigbtlwavsdlzdbtbot.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1aWdidGx3YXZzZGx6ZGJ0Ym90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDQwMDksImV4cCI6MjA4NzUyMDAwOX0.mmJVwQ5CgdgU4f43rR0rQT0STRagXI341QrD0QgtLGE';

// ── Duel server ───────────────────────────────────────────────────────────────
const DUEL_SERVER_URL = 'https://mathblitz-production.up.railway.app';
// false = never contact the duel server; ⚔️ starts a duel against a bot in the browser.
// Set to true once the server (server/) is running again.
const DUELS_ONLINE = false;

// ── Reminders ─────────────────────────────────────────────────────────────────
// false = hide the 🔔 button. Turn on only once push reminders are really sent
// (push subscriptions stored + a scheduled sender); until then it would promise
// something that never arrives.
const PUSH_REMINDERS = false;
