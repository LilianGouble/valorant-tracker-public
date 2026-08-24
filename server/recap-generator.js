// ==========================================
// GÉNÉRATEUR DE CARTES DE RÉCAP (Wrapped KSL)
// ==========================================
// Construit un SVG à la main puis le rasterise en PNG via @resvg/resvg-js
// (binaire Rust, zéro dépendance système — idéal pour un VPS Linux).
// Les images distantes (agents, bannières) sont embarquées en base64 car
// resvg ne fait aucune requête réseau.

import { Resvg } from '@resvg/resvg-js';

// --- Utilitaires ---

// Échappe le texte pour l'insérer dans du SVG/XML.
const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Tronque un texte trop long (les cartes ont une largeur fixe).
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Télécharge une image et la renvoie en data URI base64 (embarquable dans le SVG).
const toDataUri = async (url) => {
    if (!url) return null;
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = r.headers.get('content-type') || 'image/png';
        return `data:${ct};base64,${buf.toString('base64')}`;
    } catch {
        return null;
    }
};

// Rasterise un SVG (string) en PNG (Buffer) à la largeur voulue.
const svgToPng = (svg, width) => {
    const r = new Resvg(svg, {
        fitTo: { mode: 'width', value: width },
        font: { loadSystemFonts: true },
        background: 'rgba(0,0,0,0)',
    });
    return r.render().asPng();
};

// Police : pile de fallbacks robustes (resvg prend la 1ère dispo sur le système).
const FONT = "'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif";

// --- Primitives de dessin SVG ---

const defs = () => `
    <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#1c252e"/>
            <stop offset="60%" stop-color="#0f1923"/>
            <stop offset="100%" stop-color="#0a1017"/>
        </linearGradient>
        <linearGradient id="redGlow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ff4655" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#ff4655" stop-opacity="0"/>
        </linearGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>`;

// Cadre commun (fond + halo + branding).
const frame = (w, h, accent, inner) => `
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    <rect width="${w}" height="${h}" rx="28" fill="url(#bgGrad)"/>
    <circle cx="${w - 60}" cy="70" r="150" fill="${accent}" opacity="0.18" filter="url(#soft)"/>
    <rect width="${w}" height="${h}" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>
    ${inner}
    <text x="${w - 34}" y="${h - 30}" font-family="${FONT}" font-size="22" font-weight="700"
          fill="#ffffff" fill-opacity="0.35" text-anchor="end" letter-spacing="2">KSL TRACKER</text>
</svg>`;

// ==========================================
// TEMPLATE 1 : CARTE DE SOIRÉE (collective)
// ==========================================
export const buildSessionCard = async ({ dateLabel, collective, mvp, topPlayers = [] }) => {
    const W = 1000, H = 560;
    const accent = collective.rr >= 0 ? '#10b981' : '#ef4444';
    const rrSign = collective.rr >= 0 ? '+' : '';

    // Lignes joueurs (max 5)
    let rows = '';
    topPlayers.slice(0, 5).forEach((p, i) => {
        const y = 375 + i * 44;
        const pRR = (p.rr >= 0 ? '+' : '') + p.rr;
        const pColor = p.rr >= 0 ? '#34d399' : '#f87171';
        rows += `
            <text x="70" y="${y}" font-family="${FONT}" font-size="26" font-weight="800" fill="#6b7280">${i + 1}</text>
            <circle cx="118" cy="${y - 9}" r="7" fill="${esc(p.color || '#888')}"/>
            <text x="140" y="${y}" font-family="${FONT}" font-size="27" font-weight="700" fill="#ffffff">${esc(clip(p.name, 16))}</text>
            <text x="640" y="${y}" font-family="${FONT}" font-size="24" font-weight="700" fill="#9ca3af" text-anchor="end">${p.wins}V ${p.losses}D</text>
            <text x="930" y="${y}" font-family="${FONT}" font-size="27" font-weight="900" fill="${pColor}" text-anchor="end">${esc(pRR)} RR</text>`;
    });

    // Le gros nombre RR : on estime sa largeur pour poser le "RR" juste après,
    // sans chevaucher. ~72px par glyphe à font-size 110.
    const rrText = `${rrSign}${collective.rr}`;
    const rrWidth = rrText.length * 66;

    const inner = `
        <text x="60" y="78" font-family="${FONT}" font-size="26" font-weight="800" fill="#9ca3af" letter-spacing="3">SOIRÉE KSL</text>
        <text x="60" y="116" font-family="${FONT}" font-size="30" font-weight="700" fill="#e5e7eb">${esc(dateLabel)}</text>

        <text x="940" y="78" font-family="${FONT}" font-size="30" font-weight="800" fill="#34d399" text-anchor="end">${collective.wins}V</text>
        <text x="940" y="116" font-family="${FONT}" font-size="30" font-weight="800" fill="#f87171" text-anchor="end">${collective.losses}D</text>
        <text x="940" y="152" font-family="${FONT}" font-size="22" font-weight="700" fill="#6b7280" text-anchor="end">${collective.games} games</text>

        <text x="60" y="232" font-family="${FONT}" font-size="110" font-weight="900" fill="${accent}" font-style="italic">${rrText}</text>
        <text x="${60 + rrWidth}" y="232" font-family="${FONT}" font-size="40" font-weight="800" fill="#6b7280">RR</text>

        ${mvp ? `<rect x="60" y="256" width="420" height="48" rx="12" fill="#facc15" fill-opacity="0.12" stroke="#facc15" stroke-opacity="0.3"/>
        <text x="80" y="288" font-family="${FONT}" font-size="24" font-weight="800" fill="#facc15">MVP — ${esc(clip(mvp.name, 16))} (+${mvp.rr} RR)</text>` : ''}

        <line x1="60" y1="330" x2="940" y2="330" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>
        ${rows}`;

    return svgToPng(frame(W, H, accent, inner), W);
};

// ==========================================
// TEMPLATE 2 : CARTE DE PROFIL JOUEUR
// ==========================================
export const buildPlayerCard = async ({ name, tag, color, rankName, rankIconUri, bannerUri, stats, peak }) => {
    const W = 1000, H = 500;
    const accent = color || '#ff4655';

    const inner = `
        ${bannerUri ? `<clipPath id="bannerClip"><rect width="${W}" height="${H}" rx="28"/></clipPath>
        <image href="${bannerUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" opacity="0.5" clip-path="url(#bannerClip)"/>
        <rect width="${W}" height="${H}" rx="28" fill="#0f1923" fill-opacity="0.68"/>
        <rect x="0" y="${H - 180}" width="${W}" height="180" rx="28" fill="#0f1923" fill-opacity="0.5"/>` : ''}

        ${rankIconUri ? `<image href="${rankIconUri}" x="740" y="50" width="180" height="180"/>` : ''}

        <text x="60" y="110" font-family="${FONT}" font-size="66" font-weight="900" font-style="italic" fill="#ffffff">${esc(clip(name, 14))}</text>
        <text x="64" y="150" font-family="${FONT}" font-size="30" font-weight="700" fill="#9ca3af">#${esc(tag)}</text>
        ${rankName ? `<text x="64" y="200" font-family="${FONT}" font-size="30" font-weight="800" fill="${accent}">${esc(rankName)}</text>` : ''}
        ${peak ? `<text x="64" y="238" font-family="${FONT}" font-size="22" font-weight="700" fill="#facc15" fill-opacity="0.8">🏆 Peak ${esc(peak)}</text>` : ''}

        ${statBlock(60, 300, 'GAMES', stats.games, '#ffffff')}
        ${statBlock(250, 300, 'WINRATE', stats.winrate + '%', stats.winrate >= 50 ? '#34d399' : '#f87171')}
        ${statBlock(440, 300, 'K/D', stats.kd, stats.kd >= 1 ? '#ffffff' : '#9ca3af')}
        ${statBlock(630, 300, 'HS%', stats.hsPct + '%', '#ffffff')}
        ${statBlock(820, 300, 'ADR', stats.adr, '#22d3ee')}`;

    return svgToPng(frame(W, H, accent, inner), W);
};

// Bloc stat compact (label + valeur).
const statBlock = (x, y, label, value, color) => `
    <text x="${x}" y="${y}" font-family="${FONT}" font-size="20" font-weight="800" fill="#6b7280" letter-spacing="1">${esc(label)}</text>
    <text x="${x}" y="${y + 48}" font-family="${FONT}" font-size="46" font-weight="900" fill="${color}">${esc(value)}</text>`;

// ==========================================
// TEMPLATE 3 : CARTE DE BADGE DÉBLOQUÉ
// ==========================================
export const buildBadgeCard = async ({ playerName, badgeTitle, badgeIcon, badgeDesc, tierColor }) => {
    const W = 900, H = 420;
    const accent = tierColor || '#facc15';

    const inner = `
        <circle cx="${W / 2}" cy="150" r="90" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.5" stroke-width="3"/>
        <text x="${W / 2}" y="185" font-family="${FONT}" font-size="90" text-anchor="middle">${esc(badgeIcon)}</text>
        <text x="${W / 2}" y="290" font-family="${FONT}" font-size="44" font-weight="900" fill="#ffffff" text-anchor="middle" font-style="italic">${esc(clip(badgeTitle, 22))}</text>
        <text x="${W / 2}" y="330" font-family="${FONT}" font-size="24" font-weight="700" fill="#9ca3af" text-anchor="middle">${esc(clip(badgeDesc, 48))}</text>
        <text x="${W / 2}" y="375" font-family="${FONT}" font-size="26" font-weight="800" fill="${accent}" text-anchor="middle">${esc(clip(playerName, 20))}</text>`;

    return svgToPng(frame(W, H, accent, inner), W);
};

// Exposé pour que le serveur puisse embarquer des images distantes.
export { toDataUri };
