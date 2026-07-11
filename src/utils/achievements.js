// ==========================================
// MOTEUR DE BADGES / ACHIEVEMENTS
// ==========================================
// Fonction pure : à partir d'une liste de matchs (déjà filtrés sur un joueur
// et une période), calcule les badges débloqués + leur progression.
// Aucune dépendance réseau, réutilisable côté Discord plus tard.

import { safeDiv } from './calculations';

// Tiers visuels (couleur + libellé) selon la rareté/difficulté du badge.
export const TIERS = {
    bronze:  { label: 'Bronze',  ring: '#cd7f32', glow: 'rgba(205,127,50,0.35)' },
    silver:  { label: 'Argent',  ring: '#c0c0c0', glow: 'rgba(192,192,192,0.35)' },
    gold:    { label: 'Or',      ring: '#facc15', glow: 'rgba(250,204,21,0.4)' },
    diamond: { label: 'Diamant', ring: '#22d3ee', glow: 'rgba(34,211,238,0.4)' },
    shame:   { label: 'Honte',   ring: '#ef4444', glow: 'rgba(239,68,68,0.35)' },
};

// Helper : plus longue série de victoires (en parcourant du plus ancien au plus récent).
const longestWinStreak = (rankedSortedAsc) => {
    let best = 0, cur = 0;
    for (const m of rankedSortedAsc) {
        if (m.result === 'WIN') { cur++; best = Math.max(best, cur); }
        else if (m.result === 'LOSS') { cur = 0; }
        // DRAW : on ne casse pas la série mais on ne l'incrémente pas
    }
    return best;
};

// Série de victoires EN COURS (à la fin de la période, depuis le match le plus récent).
const currentWinStreak = (rankedSortedDesc) => {
    let cur = 0;
    for (const m of rankedSortedDesc) {
        if (m.result === 'WIN') cur++;
        else if (m.result === 'LOSS') break;
    }
    return cur;
};

// Regroupe les parties par jour (clé YYY-MM-DD locale) et renvoie le max de games/jour.
const maxGamesInOneDay = (matches) => {
    const byDay = {};
    matches.forEach(m => {
        const ts = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
        const key = new Date(ts).toISOString().slice(0, 10);
        byDay[key] = (byDay[key] || 0) + 1;
    });
    return Object.values(byDay).reduce((mx, v) => Math.max(mx, v), 0);
};

/**
 * @param {Array} matches  Matchs du joueur (toutes files confondues)
 * @returns {Array} badges  [{ id, title, desc, icon, tier, unlocked, progress (0..1), valueLabel }]
 *   `icon` est un nom d'emoji-token résolu côté composant (on reste découplé de lucide ici).
 */
export const computeBadges = (matches = []) => {
    const ranked = matches.filter(m => m.type === 'ranked');
    const rankedAsc = [...ranked].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const rankedDesc = [...ranked].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // --- Agrégats globaux ---
    const games = ranked.length;
    const wins = ranked.filter(m => m.result === 'WIN').length;
    const kills = ranked.reduce((s, m) => s + (m.kills || 0), 0);
    const deaths = ranked.reduce((s, m) => s + (m.deaths || 0), 0);
    const hs = ranked.reduce((s, m) => s + (m.headshots || 0), 0);
    const allShots = ranked.reduce((s, m) => s + (m.headshots || 0) + (m.bodyshots || 0) + (m.legshots || 0), 0);
    const aces = ranked.reduce((s, m) => s + (m.mk5 || 0), 0);
    const clutches = ranked.reduce((s, m) => s + (m.clutches || 0), 0);
    const firstKills = ranked.reduce((s, m) => s + (m.firstKills || 0), 0);
    const netRR = ranked.reduce((s, m) => s + (m.rrChange || 0), 0);
    const rrLost = ranked.reduce((s, m) => s + Math.min(0, m.rrChange || 0), 0);
    // ADR moyen (dégâts infligés vs subis) — dispo après le fix damage.dealt
    const withAdr = ranked.filter(m => m.adr != null);
    const avgAdr = withAdr.length ? withAdr.reduce((s, m) => s + m.adr, 0) / withAdr.length : 0;
    const withAdrRec = ranked.filter(m => m.adrReceived != null);
    const avgAdrRec = withAdrRec.length ? withAdrRec.reduce((s, m) => s + m.adrReceived, 0) / withAdrRec.length : 0;
    // Cérémonies & comportement (v4) — tolérant : 0 si absent sur les vieux matchs.
    const flawless = ranked.reduce((s, m) => s + (m.ceremonies?.flawless || 0), 0);
    const closers = ranked.reduce((s, m) => s + (m.ceremonies?.closer || 0), 0);
    const afkRounds = ranked.reduce((s, m) => s + (m.behavior?.afkRounds || 0), 0);
    const ffOutgoing = ranked.reduce((s, m) => s + (m.behavior?.ffOutgoing || 0), 0);

    const kd = safeDiv(kills, Math.max(1, deaths));
    const hsPct = allShots > 0 ? (hs / allShots) * 100 : 0;
    const winrate = games > 0 ? (wins / games) * 100 : 0;
    const bestStreak = longestWinStreak(rankedAsc);
    const curStreak = currentWinStreak(rankedDesc);
    const peakRR = ranked.reduce((mx, m) => Math.max(mx, m.rankValue || 0), 0);
    const maxDay = maxGamesInOneDay(ranked);

    // MVP de match : top score parmi allPlayers
    const mvpCount = ranked.filter(m => {
        if (!m.allPlayers || !m.score) return false;
        const maxScore = Math.max(...m.allPlayers.map(p => p.stats?.score || 0));
        return m.score >= maxScore && maxScore > 0;
    }).length;

    // Helper de construction avec progression linéaire vers un seuil.
    const mk = (id, title, desc, icon, tier, value, threshold, opts = {}) => {
        const unlocked = opts.unlocked !== undefined ? opts.unlocked : value >= threshold;
        const progress = threshold > 0 ? Math.min(1, value / threshold) : (unlocked ? 1 : 0);
        const valueLabel = opts.valueLabel ?? `${Math.round(value)} / ${threshold}`;
        return { id, title, desc, icon, tier, unlocked, progress, valueLabel, hidden: !!opts.hidden };
    };

    const badges = [
        // ----- VALORISANTS -----
        mk('sniper', 'Sniper', 'Plus de 25% de précision à la tête sur 20+ games.', '🎯', 'gold',
            games >= 20 ? hsPct : 0, 25, { valueLabel: `${hsPct.toFixed(1)}% HS`, unlocked: games >= 20 && hsPct >= 25 }),

        mk('butcher', 'Boucher', 'Ratio K/D supérieur à 1.50 sur 20+ games.', '🔪', 'gold',
            games >= 20 ? kd : 0, 1.5, { valueLabel: `${kd.toFixed(2)} K/D`, unlocked: games >= 20 && kd >= 1.5 }),

        mk('streak', 'Rouleau Compresseur', 'Enchaîner 5 victoires d\'affilée.', '🔥', 'gold',
            bestStreak, 5, { valueLabel: `${bestStreak} d'affilée` }),

        mk('climber', 'Grimpeur', 'Gagner +100 RR net sur la période.', '💎', 'diamond',
            Math.max(0, netRR), 100, { valueLabel: `${netRR >= 0 ? '+' : ''}${netRR} RR` }),

        mk('acer', 'Aceur', 'Réaliser au moins un ACE (5 kills en un round).', '🗡️', 'silver',
            aces, 1, { valueLabel: `${aces} ACE${aces > 1 ? 's' : ''}` }),

        mk('clutch', 'Clutch King', 'Gagner 10 situations en clutch.', '🧊', 'diamond',
            clutches, 10, { valueLabel: `${clutches} clutchs` }),

        mk('mvp', 'Pièce Maîtresse', 'Être MVP du match 10 fois.', '👑', 'gold',
            mvpCount, 10, { valueLabel: `${mvpCount} MVP` }),

        mk('entry', 'Fer de Lance', 'Réaliser 30 first kills.', '⚔️', 'silver',
            firstKills, 30, { valueLabel: `${firstKills} FK` }),

        mk('peak', 'Sommet', 'Atteindre le palier Immortel (ou plus haut).', '🏔️', 'diamond',
            peakRR, 2100, { valueLabel: peakRR >= 2100 ? 'Immortel+' : 'Pas encore', unlocked: peakRR >= 2100 }),

        mk('grinder', 'Marathonien', 'Jouer 10 parties classées en une seule journée.', '🎮', 'silver',
            maxDay, 10, { valueLabel: `${maxDay} en 1 jour` }),

        mk('winner', 'Machine à Gagner', 'Maintenir 60% de winrate sur 30+ games.', '🏆', 'gold',
            games >= 30 ? winrate : 0, 60, { valueLabel: `${winrate.toFixed(0)}% WR`, unlocked: games >= 30 && winrate >= 60 }),

        mk('veteran', 'Vétéran', 'Jouer 100 parties classées.', '🎖️', 'silver',
            games, 100, { valueLabel: `${games} games` }),

        mk('wall', 'Le Mur', 'Infliger plus de 150 dégâts par round en moyenne (20+ games).', '🧱', 'diamond',
            games >= 20 ? avgAdr : 0, 150, { valueLabel: `${Math.round(avgAdr)} ADR`, unlocked: games >= 20 && avgAdr >= 150 }),

        mk('tank', 'Éponge à Balles', 'Subir plus de 160 dégâts par round en moyenne (20+ games).', '🩹', 'shame',
            games >= 20 && avgAdrRec >= 160 ? 1 : 0, 1, { valueLabel: `${Math.round(avgAdrRec)} subis/rnd`, unlocked: games >= 20 && avgAdrRec >= 160 }),

        mk('flawless', 'Sans Accroc', 'Remporter 15 rounds "Flawless" (aucun coéquipier mort).', '✨', 'gold',
            flawless, 15, { valueLabel: `${flawless} flawless` }),

        mk('closer', 'Le Dernier Mot', 'Réaliser 25 derniers kills de round (Closer).', '🎯', 'silver',
            closers, 25, { valueLabel: `${closers} closers` }),

        mk('teamkiller', 'Ami des Balles', 'Blesser ses coéquipiers 5 fois (tir ami).', '🔫', 'shame',
            ffOutgoing, 5, { valueLabel: `${ffOutgoing} tirs amis` }),

        mk('deserter', 'Déserteur', 'Cumuler 3 rounds en AFK.', '💤', 'shame',
            afkRounds, 3, { valueLabel: `${afkRounds} rounds AFK` }),

        // ----- VANNES / HONTE -----
        mk('stormtrooper', 'Stormtrooper', 'Moins de 12% de précision à la tête sur 20+ games.', '🤖', 'shame',
            games >= 20 && hsPct < 12 ? 1 : 0, 1, { valueLabel: `${hsPct.toFixed(1)}% HS`, unlocked: games >= 20 && hsPct < 12 && allShots > 0 }),

        mk('donor', 'Donateur de RR', 'Avoir cumulé -150 RR de défaites sur la période.', '💸', 'shame',
            Math.abs(rrLost), 150, { valueLabel: `${rrLost} RR perdus` }),

        mk('tilt', 'En PLS', 'Enchaîner 4 défaites d\'affilée (au pire moment).', '🫠', 'shame',
            (() => { // plus longue série de défaites
                let best = 0, cur = 0;
                for (const m of rankedAsc) { if (m.result === 'LOSS') { cur++; best = Math.max(best, cur); } else if (m.result === 'WIN') cur = 0; }
                return best;
            })(), 4, { valueLabel: 'série noire' }),
    ];

    // Stats brutes utiles à la page profil (évite de recalculer ailleurs).
    const stats = {
        games, wins, losses: ranked.filter(m => m.result === 'LOSS').length,
        kd, hsPct, winrate, netRR, peakRR, bestStreak, curStreak, aces, clutches, mvpCount, firstKills,
    };

    return { badges, stats };
};
