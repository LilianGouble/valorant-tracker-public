export const safeDiv = (a, b, decimals = 2) => {
    // Si le dénominateur est 0, null ou indéfini, on renvoie 0 pour éviter NaN ou Infinity
    if (!b || b === 0) return 0;
    const res = a / b;
    return decimals !== null ? Number(res.toFixed(decimals)) : res;
};

export const calculateKD = (kills, deaths) => {
    // On considère au moins 1 mort pour éviter la division par 0
    return safeDiv(kills, Math.max(1, deaths), 2);
};

export const calculateHS = (headshots, totalShots) => {
    return totalShots > 0 ? Math.round((headshots / totalShots) * 100) : 0;
};

export const calculateWinrate = (wins, totalGames) => {
    return totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
};

export const calculateACS = (score, rounds) => {
    return rounds > 0 ? Math.round(score / rounds) : 0;
};

export const parseRoundsFromScore = (scoreString) => {
    if (!scoreString) return 0;
    const parts = scoreString.split('-').map(s => parseInt(s.trim(), 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return parts[0] + parts[1];
    }
    return 0; 
};

// NB : getGroupSize / findCfgByPuuid / getPlayerColor ont été déplacés dans
// utils/players.js (source unique de vérité, corrige le bug id ≠ puuid).