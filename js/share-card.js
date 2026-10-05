/**
 * share-card.js — Draws the 1080×1350 result card that is shared as an image.
 * Uses the same colours and fonts as the app (css/style.css tokens).
 */
const ShareCard = (() => {

    const W = 1080, H = 1350, PAD = 88;
    const C = {
        court: '#0C2340', court2: '#13335C', line: '#F4F7FB',
        haze: '#9FB4D1', ball: '#DCFF4A', clay: '#FF7A50',
    };
    const NUM = '"Big Shoulders Display", "Arial Narrow", sans-serif';
    const UI  = '"Atkinson Hyperlegible Next", system-ui, sans-serif';

    let markImg = null;

    function loadMark() {
        if (markImg) return markImg;
        markImg = new Promise(resolve => {
            const img = new Image();
            img.onload  = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = 'icons/qq-mark.svg';
        });
        return markImg;
    }

    async function fontsReady() {
        try {
            await Promise.all([
                document.fonts.load(`900 100px ${NUM}`),
                document.fonts.load(`400 40px ${UI}`),
                document.fonts.load(`700 40px ${UI}`),
            ]);
        } catch { /* fall back to system fonts */ }
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /**
     * data: { title, date, headline, headlineLabel, stats: [[label, value]],
     *         grid: [bool] | null, host }
     */
    async function render(data) {
        await fontsReady();
        const mark = await loadMark();

        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        // Court
        ctx.fillStyle = C.court;
        ctx.fillRect(0, 0, W, H);

        // Logo row
        let y = PAD;
        if (mark) ctx.drawImage(mark, PAD, y, 110, 100);
        ctx.fillStyle = C.line;
        ctx.font = `900 96px ${NUM}`;
        ctx.textBaseline = 'top';
        ctx.fillText('QuantQuiz', PAD + (mark ? 134 : 0), y + 4);

        // Mode + date
        y += 190;
        ctx.font = `700 48px ${UI}`;
        ctx.fillStyle = C.line;
        ctx.fillText(data.title, PAD, y);
        if (data.date) {
            ctx.font = `400 40px ${UI}`;
            ctx.fillStyle = C.haze;
            ctx.fillText(data.date, PAD, y + 64);
        }

        // Headline number: the thing people compare
        y += 150;
        ctx.font = `900 260px ${NUM}`;
        ctx.fillStyle = C.ball;
        ctx.fillText(data.headline, PAD - 8, y);
        ctx.font = `400 40px ${UI}`;
        ctx.fillStyle = C.haze;
        ctx.fillText(data.headlineLabel, PAD, y + 275);

        // Stats row, separated by court lines
        y += 350;
        const colW = (W - PAD * 2) / data.stats.length;
        data.stats.forEach(([label, value], i) => {
            const x = PAD + i * colW;
            if (i > 0) {
                ctx.fillStyle = 'rgba(244, 247, 251, 0.22)';
                ctx.fillRect(x - 24, y, 3, 120);
            }
            ctx.font = `400 36px ${UI}`;
            ctx.fillStyle = C.haze;
            ctx.fillText(label, x, y);
            ctx.font = `800 84px ${NUM}`;
            ctx.fillStyle = C.line;
            ctx.fillText(value, x, y + 44);
        });

        // Answer grid (10 per row)
        if (data.grid?.length) {
            y += 175;
            const size = 64, gap = 16;
            data.grid.slice(0, 20).forEach((ok, i) => {
                const gx = PAD + (i % 10) * (size + gap);
                const gy = y + Math.floor(i / 10) * (size + gap);
                ctx.fillStyle = ok ? C.ball : C.clay;
                roundRect(ctx, gx, gy, size, size, 10);
                ctx.fill();
            });
        }

        // Baseline + where to play
        ctx.fillStyle = C.line;
        ctx.fillRect(0, H - 150, W, 6);
        ctx.font = `700 40px ${UI}`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Beat me:', PAD, H - 64);
        ctx.fillStyle = C.ball;
        ctx.fillText(data.host, PAD + ctx.measureText('Beat me: ').width, H - 64);

        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }

    return { render };
})();
