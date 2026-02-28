/**
 * bg.js — Animated pixel-art background canvas.
 * Each theme draws pixel sprites on a low-res canvas scaled up 6× for the chunky look.
 */
const ThemeBG = (() => {

    const PX = window.innerWidth < 480 ? 4 : 6;   // smaller grid on mobile
    let canvas, ctx, raf;
    let artW, artH;
    let objects = [];
    let tick    = 0;
    let current = 'void';

    // ── Sprites ───────────────────────────────────────────────────────────────

    const CLOUD_S = [          // small cloud
        [0,0,1,1,1,0,0,0],
        [0,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1],
    ];
    const CLOUD_L = [          // large cloud
        [0,0,0,1,1,1,1,0,0,0,0],
        [0,0,1,1,1,1,1,1,1,0,0],
        [0,1,1,1,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1,1,1,1],
    ];
    const TREE = [
        [0,0,1,1,1,0,0],
        [0,1,1,1,1,1,0],
        [1,1,1,1,1,1,1],
        [0,0,1,2,1,0,0],
        [0,0,1,2,1,0,0],
        [0,0,1,2,1,0,0],
    ];
    const MOON = [
        [0,0,1,1,1,0,0],
        [0,1,1,1,1,1,0],
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1],
        [0,1,1,1,1,1,0],
        [0,0,1,1,1,0,0],
    ];

    // ── Init ──────────────────────────────────────────────────────────────────

    function init() {
        canvas = document.createElement('canvas');
        canvas.id = 'theme-bg-canvas';
        Object.assign(canvas.style, {
            position:        'fixed',
            inset:           '0',
            zIndex:          '1',
            pointerEvents:   'none',
            imageRendering:  'pixelated',
        });
        document.body.prepend(canvas);
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
    }

    function resize() {
        artW = Math.ceil(window.innerWidth  / PX);
        artH = Math.ceil(window.innerHeight / PX);
        canvas.width        = artW;
        canvas.height       = artH;
        canvas.style.width  = window.innerWidth  + 'px';
        canvas.style.height = window.innerHeight + 'px';
    }

    // ── Apply theme ───────────────────────────────────────────────────────────

    function apply(theme) {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        objects = [];
        tick    = 0;
        current = theme;
        ctx.clearRect(0, 0, artW, artH);
        if (theme === 'void') return;

        ({ clouds: initClouds, meadow: initMeadow,
           synthwave: initSynthwave, space: initSpace }[theme] || (() => {}))();
        loop();
    }

    function loop() {
        tick++;
        ctx.clearRect(0, 0, artW, artH);
        ({ clouds: drawClouds, meadow: drawMeadow,
           synthwave: drawSynthwave, space: drawSpace }[current] || (() => {}))();
        raf = requestAnimationFrame(loop);
    }

    // ── Sprite helper ─────────────────────────────────────────────────────────

    function spr(sprite, colors, ox, oy, scale, alpha) {
        ctx.globalAlpha = alpha ?? 1;
        for (let r = 0; r < sprite.length; r++) {
            for (let c = 0; c < sprite[r].length; c++) {
                const v = sprite[r][c];
                if (!v) continue;
                ctx.fillStyle = Array.isArray(colors) ? colors[v - 1] : colors;
                ctx.fillRect(Math.round(ox + c * scale), Math.round(oy + r * scale), scale, scale);
            }
        }
        ctx.globalAlpha = 1;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ☁️  PIXEL CLOUDS
    // ══════════════════════════════════════════════════════════════════════════

    function initClouds() {
        // Twinkling stars
        for (let i = 0; i < 55; i++) {
            objects.push({
                k: 'star',
                x: Math.random() * artW,
                y: Math.random() * artH * 0.65,
                a: 0.2 + Math.random() * 0.55,
                ph: Math.random() * Math.PI * 2,
                sp: 0.015 + Math.random() * 0.025,
                sz: Math.random() < 0.15 ? 2 : 1,
            });
        }
        // Clouds — mix of small and large, different speeds
        const configs = [
            { sp: CLOUD_S, scale: 1, speed: 0.12, y: 0.08, a: 0.20 },
            { sp: CLOUD_S, scale: 1, speed: 0.09, y: 0.20, a: 0.15 },
            { sp: CLOUD_L, scale: 2, speed: 0.05, y: 0.12, a: 0.13 },
            { sp: CLOUD_S, scale: 2, speed: 0.07, y: 0.30, a: 0.12 },
            { sp: CLOUD_L, scale: 1, speed: 0.10, y: 0.05, a: 0.18 },
            { sp: CLOUD_S, scale: 3, speed: 0.04, y: 0.35, a: 0.10 },
        ];
        configs.forEach(cfg => {
            objects.push({
                k: 'cloud',
                sprite: cfg.sp,
                x: Math.random() * artW,
                y: cfg.y * artH,
                speed: cfg.speed,
                scale: cfg.scale,
                a: cfg.a,
            });
        });
    }

    function drawClouds() {
        for (const o of objects) {
            if (o.k === 'star') {
                const a = o.a * (0.5 + 0.5 * Math.sin(tick * o.sp + o.ph));
                ctx.globalAlpha = a;
                ctx.fillStyle = '#b8d4ff';
                ctx.fillRect(Math.round(o.x), Math.round(o.y), o.sz, o.sz);
                ctx.globalAlpha = 1;
            } else {
                o.x -= o.speed;
                const w = o.sprite[0].length * o.scale;
                if (o.x < -w - 2) o.x = artW + 4;
                spr(o.sprite, '#c8e2ff', o.x, o.y, o.scale, o.a);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  🌿  MEADOW
    // ══════════════════════════════════════════════════════════════════════════

    function initMeadow() {
        // Moon top-right
        objects.push({ k: 'moon', x: artW - 18, y: 5 });

        // Trees along horizon
        for (let i = 0; i < Math.max(4, Math.floor(artW / 25)); i++) {
            objects.push({
                k: 'tree',
                x: Math.floor(Math.random() * artW),
                scale: 1 + Math.floor(Math.random() * 2),
                a: 0.15 + Math.random() * 0.12,
            });
        }
        // Dense grass strip
        for (let x = 0; x < artW; x++) {
            objects.push({
                k: 'grass',
                x,
                h: 3 + Math.floor(Math.random() * 5),
                ph: Math.random() * Math.PI * 2,
                sp: 0.016 + Math.random() * 0.012,
                col: Math.random() < 0.3 ? '#0d4a1a' : (Math.random() < 0.5 ? '#145c22' : '#1a7a2e'),
            });
        }
        // Fireflies
        for (let i = 0; i < 18; i++) {
            objects.push({
                k: 'fly',
                x: Math.random() * artW,
                y: artH * 0.25 + Math.random() * artH * 0.5,
                vx: (Math.random() - 0.5) * 0.022,
                vy: -(0.012 + Math.random() * 0.018),
                life: Math.random(),
                rate: 0.0025 + Math.random() * 0.003,
            });
        }
    }

    function drawMeadow() {
        for (const o of objects) {
            if (o.k === 'moon') {
                spr(MOON, '#fff8d4', o.x, o.y, 1, 0.2);
            } else if (o.k === 'tree') {
                const y = artH - TREE.length * o.scale - 1;
                spr(TREE, ['#0b3d12', '#062808'], o.x, y, o.scale, o.a);
            } else if (o.k === 'grass') {
                const sway = Math.sin(tick * o.sp + o.ph);
                ctx.globalAlpha = 0.28;
                ctx.fillStyle = o.col;
                for (let i = 0; i < o.h; i++) {
                    const lean = Math.round(sway * (i / o.h) * 1.8);
                    ctx.fillRect(o.x + lean, artH - 1 - i, 1, 1);
                }
                ctx.globalAlpha = 1;
            } else if (o.k === 'fly') {
                o.life += o.rate;
                if (o.life >= 1) {
                    o.life = 0;
                    o.x = Math.random() * artW;
                    o.y = artH * 0.3 + Math.random() * artH * 0.45;
                }
                o.x += o.vx;
                o.y += o.vy;
                const g = Math.sin(o.life * Math.PI);
                if (g > 0.12) {
                    ctx.globalAlpha = g * 0.85;
                    ctx.fillStyle = '#7dff8a';
                    ctx.fillRect(Math.round(o.x), Math.round(o.y), 1, 1);
                    ctx.globalAlpha = g * 0.18;
                    ctx.fillRect(Math.round(o.x) - 1, Math.round(o.y) - 1, 3, 3);
                    ctx.globalAlpha = 1;
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  🌆  SYNTHWAVE
    // ══════════════════════════════════════════════════════════════════════════

    function initSynthwave() { /* purely procedural — no objects needed */ }

    function drawSynthwave() {
        const hy = Math.floor(artH * 0.50);
        const cx = artW >> 1;

        // Sun with horizontal scanline cuts
        const sr = 11;
        for (let dy = -sr; dy <= sr; dy++) {
            for (let dx = -sr; dx <= sr; dx++) {
                if (Math.sqrt(dx*dx + dy*dy) > sr) continue;
                const scanY = Math.floor(hy - 3 + dy + tick * 0.07) & 3;
                if (scanY === 0) continue;
                const t   = 1 - Math.sqrt(dx*dx + dy*dy) / sr;
                const col = dy < 0 ? `rgba(255,200,60,${t * 0.28})` : `rgba(247,37,133,${t * 0.22})`;
                ctx.fillStyle   = col;
                ctx.globalAlpha = 1;
                ctx.fillRect(cx + dx, hy - 3 + dy, 1, 1);
            }
        }

        // Horizontal grid lines (perspective-scrolling toward viewer)
        const scroll = (tick * 0.07) % 1;
        for (let i = 0; i < 12; i++) {
            const t   = ((i / 12) + scroll) % 1;
            const y   = Math.round(hy + t * t * (artH - hy));
            const brt = t * 0.30 + 0.02 * Math.sin(tick * 0.05 + i);
            ctx.globalAlpha = Math.min(brt, 0.35);
            ctx.fillStyle   = '#f72585';
            ctx.fillRect(0, y, artW, 1);
        }

        // Vertical lines converging to horizon center
        for (let i = 0; i <= 14; i++) {
            const bx = (i / 14) * artW;
            for (let y = hy; y < artH; y++) {
                const frac = (y - hy) / (artH - hy);
                const lx   = Math.round(cx + (bx - cx) * frac);
                ctx.globalAlpha = frac * 0.20;
                ctx.fillStyle   = '#4cc9f0';
                ctx.fillRect(lx, y, 1, 1);
            }
        }

        // Neon horizon line
        ctx.globalAlpha = 0.5;
        ctx.fillStyle   = '#f72585';
        ctx.fillRect(0, hy, artW, 1);

        ctx.globalAlpha = 1;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ✨  DEEP SPACE
    // ══════════════════════════════════════════════════════════════════════════

    function initSpace() {
        // Stars in two layers (different drift speeds for parallax)
        for (let i = 0; i < 80; i++) {
            objects.push({
                k: 'star',
                x: Math.random() * artW,
                y: Math.random() * artH,
                sz: Math.random() < 0.1 ? 2 : 1,
                a: 0.25 + Math.random() * 0.65,
                ph: Math.random() * Math.PI * 2,
                twSp: 0.01 + Math.random() * 0.035,
                drift: Math.random() < 0.4 ? 0.004 : 0.001,
            });
        }
        // One shooting star slot
        objects.push({ k: 'shooter', active: false, cd: 220 + Math.random() * 350, trail: [] });
    }

    function drawSpace() {
        for (const o of objects) {
            if (o.k === 'star') {
                o.y += o.drift;
                if (o.y > artH) o.y = 0;
                const a = o.a * (0.55 + 0.45 * Math.sin(tick * o.twSp + o.ph));
                ctx.globalAlpha = a;
                ctx.fillStyle   = '#ffffff';
                ctx.fillRect(Math.round(o.x), Math.round(o.y), o.sz, o.sz);
            } else if (o.k === 'shooter') {
                if (!o.active) {
                    if (--o.cd <= 0) {
                        o.active = true;
                        o.x  = artW + 5;
                        o.y  = Math.random() * artH * 0.45;
                        o.dx = -(0.55 + Math.random() * 0.45);
                        o.dy =   0.18 + Math.random() * 0.22;
                        o.trail = [];
                    }
                } else {
                    o.x += o.dx; o.y += o.dy;
                    o.trail.push([o.x, o.y]);
                    if (o.trail.length > 10) o.trail.shift();
                    o.trail.forEach(([tx, ty], ti) => {
                        ctx.globalAlpha = (ti / o.trail.length) * 0.8;
                        ctx.fillStyle   = '#ffffff';
                        ctx.fillRect(Math.round(tx), Math.round(ty), 1, 1);
                    });
                    if (o.x < -5) {
                        o.active = false;
                        o.cd = 220 + Math.random() * 400;
                        o.trail = [];
                    }
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    return { init, apply };
})();
